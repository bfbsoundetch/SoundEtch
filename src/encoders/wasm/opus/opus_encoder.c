#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <opus.h>
#include <opus/opusenc.h>
#include <stdio.h>

#define MAX_PACKET_SIZE 1276

int get_opus_application(const char* app_type) {
    if (strcmp(app_type, "voice") == 0) return OPUS_APPLICATION_VOIP;
    if (strcmp(app_type, "audio") == 0) return OPUS_APPLICATION_AUDIO;
    if (strcmp(app_type, "low delay") == 0) return OPUS_APPLICATION_RESTRICTED_LOWDELAY;
    return OPUS_APPLICATION_AUDIO;
}

int get_opus_bandwidth(const char* bandwidth_type) {
    if (strcmp(bandwidth_type, "narrowband") == 0) return OPUS_BANDWIDTH_NARROWBAND;
    if (strcmp(bandwidth_type, "mediumband") == 0) return OPUS_BANDWIDTH_MEDIUMBAND;
    if (strcmp(bandwidth_type, "wideband") == 0) return OPUS_BANDWIDTH_WIDEBAND;
    if (strcmp(bandwidth_type, "superwideband") == 0) return OPUS_BANDWIDTH_SUPERWIDEBAND;
    if (strcmp(bandwidth_type, "fullband") == 0) return OPUS_BANDWIDTH_FULLBAND;
    return OPUS_AUTO;
}

int frame_size_ms_to_samples(float frame_size_ms, int sample_rate) {
    return (int)(frame_size_ms * sample_rate / 1000.0f);
}

EMSCRIPTEN_KEEPALIVE
OpusEncoder* create_encoder(int sample_rate, int channel_count, int bitrate, 
                           const char* bitrate_mode, int complexity, 
                           const char* bandwidth, const char* application) {
    int err;
    OpusEncoder* encoder = opus_encoder_create(sample_rate, channel_count, get_opus_application(application), &err);
    if (err < 0) return NULL;
    
    // Set bitrate
    // opus_encoder_ctl(encoder, OPUS_SET_BITRATE(bitrate));
    
    // Set bitrate mode
    if (strcmp(bitrate_mode, "constant") == 0) {
        opus_encoder_ctl(encoder, OPUS_SET_VBR(0));
    } else if (strcmp(bitrate_mode, "constrained") == 0) {
        opus_encoder_ctl(encoder, OPUS_SET_VBR(1));
        opus_encoder_ctl(encoder, OPUS_SET_VBR_CONSTRAINT(1));
    } else {
        opus_encoder_ctl(encoder, OPUS_SET_VBR(1)); // variable (default)
    }
    
    // Set complexity
    opus_encoder_ctl(encoder, OPUS_SET_COMPLEXITY(complexity));
    
    // Set bandwidth if not auto
    int bw = get_opus_bandwidth(bandwidth);
    if (bw != OPUS_AUTO) {
        opus_encoder_ctl(encoder, OPUS_SET_BANDWIDTH(bw));
    }

    fprintf(stderr, "hi\n");
    
    return encoder;
}

EMSCRIPTEN_KEEPALIVE
int encode_frame(OpusEncoder* encoder, float* pcm_data, int frame_size_samples, 
                 unsigned char* output_buffer) {
    // printf("wthelly %p %p %d %p\n", encoder, pcm_data, frame_size_samples, output_buffer);
    printf("hi\n");
    return opus_encode_float(encoder, pcm_data, frame_size_samples, output_buffer, 5 * MAX_PACKET_SIZE);
}