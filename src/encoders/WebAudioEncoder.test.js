import Worker from 'web-worker'

test('convert', async () => {
  new AudioEncoder({
    output: (chunk, meta) => console.log(chunk + ' ' + meta),
    error: (e) => console.error(e),
  })
}, 10000)
