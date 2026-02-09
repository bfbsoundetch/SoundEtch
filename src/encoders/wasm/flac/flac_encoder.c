#include "FLAC/metadata.h"
#include "FLAC/stream_encoder.h"
#include "share/compat.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

FLAC__StreamEncoder* encoder;
const FLAC__int32** inputBufferPointerInternal;

extern FLAC__StreamEncoderWriteStatus writeEncodedChunk(const FLAC__StreamEncoder *encoder,
                    const FLAC__byte buffer[], size_t bytes, uint32_t samples,
                    uint32_t current_frame, void *client_data);
extern FLAC__StreamEncoderSeekStatus seek(const FLAC__StreamEncoder *encoder,
                                            FLAC__uint64 absolute_byte_offset,
                                            void *client_data);
extern FLAC__StreamEncoderTellStatus tell(const FLAC__StreamEncoder *encoder,
                                            FLAC__uint64 *absolute_byte_offset,
                                            void *client_data);

EMSCRIPTEN_KEEPALIVE
void create_encoder(int bitsPerSample, int sampleRate,
                                    int channelCount, int compressionLevel,
                                    char **metadata) {
  FLAC__bool ok = true;
  encoder = FLAC__stream_encoder_new();
  if (encoder == NULL) {
    fprintf(stderr, "Error allocating encoder\n");
    return;
  }

  ok &= FLAC__stream_encoder_set_verify(encoder, true);
  ok &= FLAC__stream_encoder_set_compression_level(encoder, compressionLevel);
  ok &= FLAC__stream_encoder_set_channels(encoder, channelCount);
  ok &= FLAC__stream_encoder_set_bits_per_sample(encoder, bitsPerSample);
  ok &= FLAC__stream_encoder_set_sample_rate(encoder, sampleRate);
  ok &= FLAC__stream_encoder_set_metadata(encoder, NULL, 0);

  if (!ok) {
    fprintf(stderr, "Error setting up encoder %d\n", ok);
    return;
  }

  FLAC__StreamEncoderInitStatus initStatus = FLAC__stream_encoder_init_stream(
      encoder, writeEncodedChunk, seek, tell, NULL, NULL);
}

EMSCRIPTEN_KEEPALIVE
char encode_chunk(uint32_t length) {
  return FLAC__stream_encoder_process(encoder, inputBufferPointerInternal, length);
}

EMSCRIPTEN_KEEPALIVE
FLAC__StreamEncoderState get_encoder_state() {
  return FLAC__stream_encoder_get_state(encoder);
}

EMSCRIPTEN_KEEPALIVE
FLAC__int32* get_input_buffer_pointer(int channels, int size) {
  FLAC__int32* result = calloc(channels * size, sizeof(FLAC__int32));
  inputBufferPointerInternal = calloc(channels, sizeof(FLAC__int32*));
  for (int i = 0; i < channels; ++i) {
    inputBufferPointerInternal[i] = result + i * size;
  }
  return result;
}

EMSCRIPTEN_KEEPALIVE
char finish_encoding() {
  return FLAC__stream_encoder_finish(encoder);
}
