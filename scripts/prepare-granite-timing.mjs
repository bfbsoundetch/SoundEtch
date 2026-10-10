#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import schema from '../node_modules/onnxruntime-web/lib/onnxjs/ort-schema/protobuf/onnx.js'

const { onnx } = schema
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const timingVersion = '2'
const targetPath = resolve(root, `tmp/granite-publish/onnx-ctc/granite_timing_v${timingVersion}_q4f16.onnx`)
const sourceUrl =
  'https://huggingface.co/spaces/ibm-granite/granite-speech-streaming-webgpu/resolve/245e1e52c6fc01ba065c35b4af884d89cdca60de/onnx-ctc/ctc_conformer_q4f16.onnx'
const modificationNotice =
  'Modified by SoundEtch from the IBM Granite Speech q4f16 ONNX export in ibm-granite/granite-speech-streaming-webgpu at revision 245e1e52c6fc01ba065c35b4af884d89cdca60de. Adds frame_ids, token_ids, ctc_scores, and vocab_log_probs outputs and prunes unused graph components. Reuses the original external-weight file ctc_conformer_q4f16.onnx.data.'
const externalWeights = 'ctc_conformer_q4f16.onnx.data'
const prefix = `/soundetch_timing_v${timingVersion}/`
const versionKey = 'soundetch.timing_version'
const logits = '/model/out/Add_output_0'
const argmax = '/ArgMax_output_0'

function valueInfo(name, elemType, dimensions) {
  return onnx.ValueInfoProto.fromObject({
    name,
    type: {
      tensorType: {
        elemType,
        shape: {
          dim: dimensions.map((value) => (typeof value === 'number' ? { dimValue: value } : { dimParam: value })),
        },
      },
    },
  })
}

const expectedOutputs = [
  valueInfo('frame_ids', 7, ['T']),
  valueInfo('token_ids', 7, ['N']),
  valueInfo('ctc_scores', 1, ['T', 'N+1']),
  valueInfo('vocab_log_probs', 1, ['T', 16384]),
]

function timingTail() {
  const integer = (name, value) => ({ name, type: 2, i: value })
  const integers = (name, values) => ({ name, type: 7, ints: values })
  const node = (name, opType, input, output, attribute = []) =>
    onnx.NodeProto.fromObject({
      name: prefix + name,
      opType,
      input,
      output: [output],
      attribute,
    })
  const tensor = (name, dataType, values) =>
    onnx.TensorProto.fromObject({
      name: prefix + name,
      dataType,
      dims: [values.length],
      ...(dataType === 7 ? { int64Data: values } : { int32Data: values }),
    })

  const axes = prefix + 'axes'
  const startZero = prefix + 'start_zero'
  const startOne = prefix + 'start_one'
  const endMinusOne = prefix + 'end_minus_one'
  const endMax = prefix + 'end_max'
  const stepOne = prefix + 'step_one'
  const blank = prefix + 'blank'
  const finalKeep = prefix + 'final_keep'
  const previous = prefix + 'previous_ids'
  const next = prefix + 'next_ids'
  const repeated = prefix + 'repeated'
  const changed = prefix + 'changed'
  const repeatKeep = prefix + 'repeat_keep'
  const isBlank = prefix + 'is_blank'
  const nonblank = prefix + 'nonblank'
  const keep = prefix + 'keep'
  const nonzero = prefix + 'nonzero'
  const positions = prefix + 'positions'
  const columns = prefix + 'columns'
  const compact = prefix + 'compact'
  const squeezed = prefix + 'squeezed'
  const vocabAxis = prefix + 'vocab_axis'
  const logitsFloat = prefix + 'logits_float'
  const nonblankLogits = prefix + 'nonblank_logits'
  const nonblankLogNorm = prefix + 'nonblank_log_norm'
  const batchedLogProbs = prefix + 'batched_vocab_log_probs'

  return {
    initializers: [
      tensor('axes', 7, [0]),
      tensor('start_zero', 7, [0]),
      tensor('start_one', 7, [1]),
      tensor('end_minus_one', 7, [-1]),
      tensor('end_max', 7, ['9223372036854775807']),
      tensor('step_one', 7, [1]),
      tensor('blank', 7, [0]),
      tensor('final_keep', 9, [1]),
      tensor('vocab_axis', 7, [2]),
    ],
    nodes: [
      node('frame_ids', 'Squeeze', [argmax, axes], 'frame_ids'),
      node('previous_ids', 'Slice', ['frame_ids', startZero, endMinusOne, axes, stepOne], previous),
      node('next_ids', 'Slice', ['frame_ids', startOne, endMax, axes, stepOne], next),
      node('repeated', 'Equal', [previous, next], repeated),
      node('changed', 'Not', [repeated], changed),
      // The adjacent comparison has T-1 entries. The final frame always ends a run.
      node('repeat_keep', 'Concat', [changed, finalKeep], repeatKeep, [integer('axis', 0)]),
      node('is_blank', 'Equal', ['frame_ids', blank], isBlank),
      node('nonblank', 'Not', [isBlank], nonblank),
      node('keep', 'And', [nonblank, repeatKeep], keep),
      node('nonzero', 'NonZero', [keep], nonzero),
      node('positions', 'Transpose', [nonzero], positions, [integers('perm', [1, 0])]),
      node('token_ids', 'GatherND', ['frame_ids', positions], 'token_ids'),
      node('columns', 'Concat', [blank, 'token_ids'], columns, [integer('axis', 0)]),
      node('compact', 'Gather', [logits, columns], compact, [integer('axis', 2)]),
      node('squeezed', 'Squeeze', [compact, axes], squeezed),
      node('ctc_scores', 'Cast', [squeezed], 'ctc_scores', [integer('to', 1)]),
      // log P(token | non-blank) for every vocabulary id; the blank column is not a probability.
      node('logits_float', 'Cast', [logits], logitsFloat, [integer('to', 1)]),
      node('nonblank_logits', 'Slice', [logitsFloat, startOne, endMax, vocabAxis, stepOne], nonblankLogits),
      node('nonblank_log_norm', 'ReduceLogSumExp', [nonblankLogits], nonblankLogNorm, [
        integers('axes', [2]),
        integer('keepdims', 1),
      ]),
      node('batched_vocab_log_probs', 'Sub', [logitsFloat, nonblankLogNorm], batchedLogProbs),
      node('vocab_log_probs', 'Squeeze', [batchedLogProbs, axes], 'vocab_log_probs'),
    ],
  }
}

function sameProto(type, actual, expected, message) {
  assert(Buffer.from(type.encode(actual).finish()).equals(Buffer.from(type.encode(expected).finish())), message)
}

function producers(graph) {
  const result = new Map()
  for (const node of graph.node) {
    assert(
      !node.attribute.some((attribute) => attribute.g || attribute.graphs.length),
      'Unexpected subgraph: dependency pruning needs lexical-scope handling',
    )
    for (const name of node.output.filter(Boolean)) {
      assert(!result.has(name), `Duplicate producer for ${name}`)
      result.set(name, node)
    }
  }
  return result
}

function attributeInteger(node, name) {
  return Number(node.attribute.find((attribute) => attribute.name === name)?.i)
}

function tensorType(graph, name) {
  return [...graph.valueInfo, ...graph.output].find((info) => info.name === name)?.type?.tensorType
}

function externalLocations(graph) {
  const locations = new Map()
  for (const tensor of graph.initializer) {
    if (tensor.dataLocation !== 1) continue
    const fields = Object.fromEntries(tensor.externalData.map((entry) => [entry.key, entry.value]))
    assert.equal(fields.location, externalWeights, `Unexpected weight location for ${tensor.name}`)
    locations.set(tensor.name, fields.location)
  }
  assert(locations.size >= 1, 'Expected external model weights')
  return locations
}

function checkCore(model, converted) {
  const graph = model.graph
  assert(graph, 'Missing graph')
  assert.deepEqual(
    graph.input.map((input) => input.name),
    ['input_features', 'padding_mask'],
  )
  if (!converted)
    assert.deepEqual(
      graph.output.map((output) => output.name),
      ['ids', 'top_logprob'],
    )
  assert.deepEqual(
    model.opsetImport.map((entry) => [entry.domain, Number(entry.version)]),
    [
      ['', 17],
      ['com.microsoft', 1],
    ],
    'Unexpected ONNX opsets',
  )

  const byOutput = producers(graph)
  const argmaxNode = byOutput.get(argmax)
  assert.equal(argmaxNode?.opType, 'ArgMax', 'Missing expected ArgMax')
  assert.equal(argmaxNode.input[0], logits, 'ArgMax must use original logits')
  assert.equal(attributeInteger(argmaxNode, 'axis'), -1, 'Expected vocabulary ArgMax')
  assert.equal(attributeInteger(argmaxNode, 'keepdims'), 0, 'Expected non-vocabulary dimensions retained')
  const rawType = tensorType(graph, logits)
  assert.equal(rawType?.elemType, 10, 'Expected fp16 raw logits')
  assert.equal(Number(rawType.shape?.dim[2]?.dimValue), 16384, 'Expected vocabulary size 16384')
  externalLocations(graph)

  if (!converted) {
    assert(!graph.node.some((node) => node.name.startsWith(prefix)), 'Original graph already contains timing operators')
    assert(
      !graph.initializer.some((tensor) => tensor.name.startsWith(prefix)),
      'Original graph already contains timing initializers',
    )
    assert(
      !model.metadataProps.some((entry) => entry.key === versionKey),
      'Original graph unexpectedly has timing metadata',
    )
  }
}

function prune(graph) {
  const byOutput = producers(graph)
  const leaves = new Set([...graph.input, ...graph.initializer].map((value) => value.name))
  assert.equal(graph.sparseInitializer.length, 0, 'Unexpected sparse initializers')
  const liveValues = new Set()
  const liveNodes = new Set()
  const pending = graph.output.map((output) => output.name)
  while (pending.length) {
    const name = pending.pop()
    if (!name || liveValues.has(name)) continue
    liveValues.add(name)
    const producer = byOutput.get(name)
    if (!producer) {
      assert(leaves.has(name), `Unresolved graph dependency: ${name}`)
      continue
    }
    if (!liveNodes.has(producer)) {
      liveNodes.add(producer)
      pending.push(...producer.input)
    }
  }
  graph.node = graph.node.filter((node) => liveNodes.has(node))
  graph.initializer = graph.initializer.filter((tensor) => liveValues.has(tensor.name))
  const retainedValues = new Set([...liveValues, ...graph.node.flatMap((node) => node.output)])
  const outputs = new Set(graph.output.map((output) => output.name))
  graph.valueInfo = graph.valueInfo.filter((info) => retainedValues.has(info.name) && !outputs.has(info.name))
  graph.quantizationAnnotation = graph.quantizationAnnotation.filter((annotation) =>
    retainedValues.has(annotation.tensorName),
  )
}

function checkConverted(model) {
  checkCore(model, true)
  assert(model.docString.endsWith(modificationNotice), 'Missing SoundEtch modification notice')
  assert.equal(
    model.metadataProps.filter((entry) => entry.key === versionKey).length,
    1,
    'Missing or duplicate timing version marker',
  )
  assert.equal(
    model.metadataProps.find((entry) => entry.key === versionKey).value,
    timingVersion,
    'Unsupported timing graph version',
  )
  assert.equal(model.graph.output.length, expectedOutputs.length, 'Unexpected timing outputs')
  expectedOutputs.forEach((output, index) =>
    sameProto(onnx.ValueInfoProto, model.graph.output[index], output, `Invalid output contract: ${output.name}`),
  )

  const tail = timingTail()
  const nodes = model.graph.node.filter((node) => node.name.startsWith(prefix))
  assert.equal(nodes.length, tail.nodes.length, 'Unexpected timing operators')
  tail.nodes.forEach((node, index) =>
    sameProto(onnx.NodeProto, nodes[index], node, `Invalid timing operator: ${node.name}`),
  )
  const initializers = model.graph.initializer.filter((tensor) => tensor.name.startsWith(prefix))
  assert.equal(initializers.length, tail.initializers.length, 'Unexpected timing initializers')
  tail.initializers.forEach((tensor, index) =>
    sameProto(onnx.TensorProto, initializers[index], tensor, `Invalid timing initializer: ${tensor.name}`),
  )

  const counts = [model.graph.node.length, model.graph.initializer.length, model.graph.valueInfo.length]
  prune(model.graph)
  assert.deepEqual(
    [model.graph.node.length, model.graph.initializer.length, model.graph.valueInfo.length],
    counts,
    'Timing graph contains unreachable nodes or values',
  )
  const error = onnx.ModelProto.verify(model)
  assert.equal(error, null, `Invalid ONNX protobuf: ${error}`)
}

async function readOptional(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function readSource() {
  const response = await fetch(sourceUrl)
  assert(response.ok, `Failed to fetch source graph: ${response.status} ${response.statusText}`)
  return Buffer.from(await response.arrayBuffer())
}

async function verifyBytes(bytes) {
  const model = onnx.ModelProto.decode(bytes)
  checkConverted(model)
  return model
}

const args = process.argv.slice(2)
if (args[0] === '--verify') {
  assert.equal(args.length, 2, 'Usage: node scripts/prepare-granite-timing.mjs --verify <file>')
  const path = resolve(args[1])
  const bytes = await readFile(path)
  const model = await verifyBytes(bytes)
  console.log(`Verified ${path}: ${bytes.length} bytes, ${model.graph.node.length} nodes`)
} else {
  assert.equal(args.length, 0, 'Usage: node scripts/prepare-granite-timing.mjs [--verify <file>]')
  const source = await readSource()
  const model = onnx.ModelProto.decode(source)
  checkCore(model, false)
  const originalLocations = externalLocations(model.graph)
  const tail = timingTail()
  model.graph.node.push(...tail.nodes)
  model.graph.initializer.push(...tail.initializers)
  model.graph.output = expectedOutputs
  model.metadataProps.push(onnx.StringStringEntryProto.fromObject({ key: versionKey, value: timingVersion }))
  prune(model.graph)
  model.docString = [model.docString, modificationNotice].filter(Boolean).join('\n\n')
  checkConverted(model)
  assert.deepEqual(externalLocations(model.graph), originalLocations, 'External weight locations changed')

  const bytes = Buffer.from(onnx.ModelProto.encode(model).finish())
  const decoded = await verifyBytes(bytes)
  assert.deepEqual(externalLocations(decoded.graph), originalLocations, 'Encoded external weight locations changed')
  const existing = await readOptional(targetPath)
  const unchanged = existing?.equals(bytes) ?? false
  if (!unchanged) {
    await mkdir(dirname(targetPath), { recursive: true })
    const temporary = `${targetPath}.tmp`
    await writeFile(temporary, bytes)
    await rename(temporary, targetPath)
  }
  console.log(
    `${unchanged ? 'Verified' : 'Wrote'} ${targetPath}: ${bytes.length} bytes, ${decoded.graph.node.length} nodes`,
  )
}
