#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <opus/opusenc.h>
#include <opus.h>
#include <stdio.h>

OggOpusEnc* enc;
float* inputBuffer;

enum BitrateMode {
    VARIABLE, CONSTANT, CONSTRAINED
};

// Helper functions
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

EMSCRIPTEN_KEEPALIVE
extern int write_callback(void* user_data, const unsigned char* ptr, opus_int32 len);

EMSCRIPTEN_KEEPALIVE
extern int close_callback(void* user_data);

EMSCRIPTEN_KEEPALIVE
void create_encoder(int sample_rate, int channel_count, int bitrate, 
                                enum BitrateMode bitrate_mode, int complexity, 
                                int bandwidth, const int application) {
    int error;

    OggOpusComments* comments = ope_comments_create();
    if (!comments) {
        return;
    }
    ope_comments_add(comments, "ENCODER", "soundetch");
    
    OpusEncCallbacks callbacks = {
        .write = write_callback,
        .close = close_callback
    };
    
    int family = (channel_count <= 2) ? 0 : 1;
    enc = ope_encoder_create_callbacks(&callbacks, NULL, comments, 
                                             sample_rate, channel_count, family, &error);
    
    if (!enc || error != OPE_OK) {
        fprintf(stderr, "Failed to create encoder: %d\n", error);
        ope_comments_destroy(comments);
        return;
    }
    
    ope_encoder_ctl(enc, OPUS_SET_BITRATE(bitrate));
    ope_encoder_ctl(enc, OPUS_SET_COMPLEXITY(complexity));
    ope_encoder_ctl(enc, OPUS_SET_APPLICATION(application));
    
    switch (bitrate_mode) {
        case VARIABLE:
            ope_encoder_ctl(enc, OPUS_SET_VBR(0));
            break;
        case CONSTANT:
            ope_encoder_ctl(enc, OPUS_SET_VBR(1));
            ope_encoder_ctl(enc, OPUS_SET_VBR_CONSTRAINT(1));
            break;
        case CONSTRAINED:
            ope_encoder_ctl(enc, OPUS_SET_VBR(1));
            break;
    }
    
    if (bandwidth != 0) {
        ope_encoder_ctl(enc, OPUS_SET_BANDWIDTH(bandwidth));
    }
}

EMSCRIPTEN_KEEPALIVE
float* get_input_buffer_pointer(int channelCount, int inputBufferSize) {
    inputBuffer = calloc(channelCount * inputBufferSize, sizeof(float));
    return inputBuffer;
}

EMSCRIPTEN_KEEPALIVE
int encode_frame(int length) {    
    return ope_encoder_write_float(enc, inputBuffer, length);
}

EMSCRIPTEN_KEEPALIVE
int finalize_encoding() {   
    int result; 
    if ((result = ope_encoder_drain(enc)) == 0) { 
        ope_encoder_destroy(enc);
    }
    return result;
}