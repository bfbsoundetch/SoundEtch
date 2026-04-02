/*!
 * Copyright (c) 2025-present, Vanilagy and contributors
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#include <emscripten.h>
#include "lame.h"

#define OUTPUT_BUFFER_SIZE 1024 * 1024

lame_global_flags *gfp;
const float* leftBuffer;
const float* rightBuffer;
unsigned char* outputBuffer;

EMSCRIPTEN_KEEPALIVE
int init_lame(int number_of_channels, int input_sample_rate, int output_sample_rate, int inputBufferSampleSize, int bitrate, float vbrQuality) {
	leftBuffer = calloc(inputBufferSampleSize * number_of_channels, sizeof(float));
	rightBuffer = leftBuffer + inputBufferSampleSize;
	outputBuffer = malloc(OUTPUT_BUFFER_SIZE);
	
	gfp = lame_init();

	lame_set_num_channels(gfp, number_of_channels);
	lame_set_in_samplerate(gfp, input_sample_rate);
	lame_set_out_samplerate(gfp, output_sample_rate);
	if (bitrate > -1) {
		lame_set_brate(gfp, bitrate / 1000); // MP3 wants "kilobitrate"
	} else {
		lame_set_VBR(gfp, vbr_mtrh);
        lame_set_VBR_q(gfp, vbrQuality);
	}
	lame_set_bWriteVbrTag(gfp, 1);

	int ret_code = lame_init_params(gfp);
	return ret_code;
}

EMSCRIPTEN_KEEPALIVE
int encode_samples(int sample_count) {
	return lame_encode_buffer_ieee_float(gfp, leftBuffer, rightBuffer, sample_count, outputBuffer, OUTPUT_BUFFER_SIZE);
}

EMSCRIPTEN_KEEPALIVE
int flush_lame() {
	return lame_encode_flush(gfp, outputBuffer, OUTPUT_BUFFER_SIZE);
}

EMSCRIPTEN_KEEPALIVE
size_t get_lame_tag() {
	return lame_get_lametag_frame(gfp, outputBuffer, OUTPUT_BUFFER_SIZE);
}

EMSCRIPTEN_KEEPALIVE
const float* getLeftInputBufferPointer() {
	return leftBuffer;
}

EMSCRIPTEN_KEEPALIVE
const float* getRightInputBufferPointer() {
	return rightBuffer;
}

EMSCRIPTEN_KEEPALIVE
unsigned char* getOutputBufferPointer() {
	return outputBuffer;
}

EMSCRIPTEN_KEEPALIVE
void close_lame() {
	lame_close(gfp);
}