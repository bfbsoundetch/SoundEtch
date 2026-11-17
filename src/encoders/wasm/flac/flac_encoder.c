#include "FLAC/metadata.h"
#include "FLAC/stream_encoder.h"
#include "share/compat.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include <math.h>
#include <wasm_simd128.h>

FLAC__StreamEncoder* encoder;
FLAC__StreamMetadata* comments;
FLAC__int32** inputBufferPointerInternal;
float** inputBufferFloatView;
int channelCount;
int floatToIntFactor;
v128_t floatToIntSimd;
v128_t maxV128;
v128_t minV128;

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
int create_encoder(int bitsPerSample, int sampleRate,
                   int chanCnt, int compressionLevel,
                   const char *metadata) {
  #ifdef __wasm_simd128__
    const float floatToIntArray[] = {
      (1 << (bitsPerSample - 1)) - 1,
      (1 << (bitsPerSample - 1)) - 1,
      (1 << (bitsPerSample - 1)) - 1,
      (1 << (bitsPerSample - 1)) - 1,
    };
    const float maxArray[] = {
      1,1,1,1
    };
    const float minArray[] = {
      -1,-1,-1,-1
    };
    floatToIntSimd = wasm_v128_load(floatToIntArray);
    maxV128 = wasm_v128_load(maxArray);
    minV128 = wasm_v128_load(minArray);
  #else
    floatToIntFactor = (1 << (bitsPerSample - 1)) - 1;
  #endif
  channelCount = chanCnt;

  FLAC__bool ok = true;
  encoder = FLAC__stream_encoder_new();
  if (encoder == NULL) {
    fprintf(stderr, "Error allocating encoder\n");
    return -1;
  }

  ok &= FLAC__stream_encoder_set_verify(encoder, true);
  ok &= FLAC__stream_encoder_set_compression_level(encoder, compressionLevel);
  ok &= FLAC__stream_encoder_set_channels(encoder, channelCount);
  ok &= FLAC__stream_encoder_set_bits_per_sample(encoder, bitsPerSample);
  ok &= FLAC__stream_encoder_set_sample_rate(encoder, sampleRate);
  if (metadata && *metadata) {
    comments = FLAC__metadata_object_new(FLAC__METADATA_TYPE_VORBIS_COMMENT);
    if (!comments) {
      goto fail;
    }
    for (const char *entry = metadata; *entry; entry += strlen(entry) + 1) {
      FLAC__StreamMetadata_VorbisComment_Entry comment = {
        .length = strlen(entry),
        .entry = (FLAC__byte *)entry,
      };
      if (!FLAC__metadata_object_vorbiscomment_append_comment(comments, comment, true)) {
        goto fail;
      }
    }
    ok &= FLAC__stream_encoder_set_metadata(encoder, &comments, 1);
  } else {
    ok &= FLAC__stream_encoder_set_metadata(encoder, NULL, 0);
  }

  if (!ok) {
    fprintf(stderr, "Error setting up encoder %d\n", ok);
    goto fail;
  }

  FLAC__StreamEncoderInitStatus initStatus = FLAC__stream_encoder_init_stream(
      encoder, writeEncodedChunk, seek, tell, NULL, NULL);
  if (initStatus != FLAC__STREAM_ENCODER_INIT_STATUS_OK) {
    fprintf(stderr, "Error initializing encoder: %d\n", initStatus);
    goto fail;
  }
  return 0;

fail:
  FLAC__stream_encoder_delete(encoder);
  encoder = NULL;
  if (comments) {
    FLAC__metadata_object_delete(comments);
    comments = NULL;
  }
  return -1;
}

EMSCRIPTEN_KEEPALIVE
char encode_chunk(uint32_t length) {
  #ifdef __wasm_simd128__
  for (int channel = 0; channel < channelCount; ++channel) {
    for (int i = 0; i < length; i+=4) {
      v128_t in = wasm_v128_load(inputBufferFloatView[channel] + i);
      in = wasm_f32x4_max(in, minV128);
      in = wasm_f32x4_min(in, maxV128);
      v128_t outs = wasm_f32x4_mul(in, floatToIntSimd);
      inputBufferPointerInternal[channel][i]   = (FLAC__int32) wasm_f32x4_extract_lane(outs, 0);
      inputBufferPointerInternal[channel][i+1] = (FLAC__int32) wasm_f32x4_extract_lane(outs, 1);
      inputBufferPointerInternal[channel][i+2] = (FLAC__int32) wasm_f32x4_extract_lane(outs, 2);
      inputBufferPointerInternal[channel][i+3] = (FLAC__int32) wasm_f32x4_extract_lane(outs, 3);
    }
  }
  #else
  for (int channel = 0; channel < channelCount; ++channel) {
    for (int i = 0; i < length; i++) {
      inputBufferPointerInternal[channel][i] = (FLAC__int32) floatToIntFactor * (fmax(fmin(1, inputBufferFloatView[channel][i]),-1));
    }
  }
  #endif
  FLAC__stream_encoder_process(encoder, (const int *const *) inputBufferPointerInternal, length);
  return 0;
}

EMSCRIPTEN_KEEPALIVE
FLAC__StreamEncoderState get_encoder_state() {
  return FLAC__stream_encoder_get_state(encoder);
}

EMSCRIPTEN_KEEPALIVE
FLAC__int32* get_input_buffer_pointer(int channels, int size) {
  FLAC__int32* result = calloc(channels * size, sizeof(FLAC__int32));
  inputBufferPointerInternal = calloc(channels, sizeof(FLAC__int32*));
  inputBufferFloatView = (float**) inputBufferPointerInternal;
  for (int i = 0; i < channels; ++i) {
    inputBufferPointerInternal[i] = result + i * size;
    inputBufferFloatView[i] = (float*) inputBufferPointerInternal[i];
  }
  return result;
}

EMSCRIPTEN_KEEPALIVE
char finish_encoding() {
  FLAC__bool ok = FLAC__stream_encoder_finish(encoder);
  FLAC__stream_encoder_delete(encoder);
  encoder = NULL;
  if (comments) {
    FLAC__metadata_object_delete(comments);
    comments = NULL;
  }
  free(inputBufferPointerInternal[0]);
  free(inputBufferPointerInternal);
  inputBufferPointerInternal = NULL;
  inputBufferFloatView = NULL;
  return ok;
}
