class AudioForkingProcessor extends AudioWorkletProcessor {
  process([inputs], outputs) {
    for (let k = 0; k < outputs.length; ++k) {
      if (outputs[k].length == 0) {
        continue
      }
      for (let i = 0; i < inputs.length; ++i) {
        for (let j = 0; j < inputs[0].length; ++j) {
          outputs[k][i][j] = inputs[i][j]
        }
      }
    }
    return true
  }
}

registerProcessor('AudioForkingProcessor', AudioForkingProcessor)
