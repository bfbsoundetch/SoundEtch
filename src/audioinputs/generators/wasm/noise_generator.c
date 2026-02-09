#include <math.h>
#include <wasm_simd128.h>
#include <stdlib.h>
#include <stdio.h>
#include <time.h>

#define SIZE 2200

float x[SIZE];
float a[SIZE];
float alpha;
float amplitude;
float scaling;
float leakage;
int shift = 0;
int outputSize;
float * output;

float * init(float alph, float amp, float scal, float leak, int outSize) {
    #ifndef __wasm_simd128__
        fprintf(stderr, "WASM SIMD not supported");
        return 0;
    #endif
    alpha = alph;
    amplitude = amp;
    scaling = scal;
    leakage = leak;
    outputSize = outSize;
    float prevA = 1;
    printf("a is going to give it to you: ");
    for (int k = 0; k < SIZE; ++k) {
      a[k] = prevA = ((k - alpha / 2) * prevA) / (k + 1);
      printf("%f,", a[k]);
      x[k] = 0;
    }
    printf("\n\n\n\n");
    srand(time(NULL));
    return output = calloc(outSize, sizeof(float));
}

float randFloat() {
    return (float)rand() / (float)RAND_MAX;
}

void create_noise() {
    #ifndef __wasm_simd128__
        fprintf(stderr, "WASM SIMD not supported");
        return;
    #endif

    for (int i = 0; i < outputSize; ++i) {
        float next = 0;
        float xarray[4];
        for (int j = 0; j < SIZE; ++j) {
            if (j > shift) {
                xarray[j % 4] = x[SIZE + shift - j];
            } else {
                xarray[j % 4] = x[shift - j];
            }
            if (j % 4 == 3) {
                v128_t as = wasm_v128_load(a+j-3);
                v128_t xs = wasm_v128_load(xarray);
                v128_t outs = wasm_f32x4_mul(as, xs);
                next -= wasm_f32x4_extract_lane(outs, 0);
                next -= wasm_f32x4_extract_lane(outs, 1);
                next -= wasm_f32x4_extract_lane(outs, 2);
                next -= wasm_f32x4_extract_lane(outs, 3);
                if (a[j] == 0) {
                    break;
                }
            }
        }
        float w = (randFloat() - 0.5f) * 2 * scaling;
        if (fabs(next + w) > 1) {
            next -= w;
        } else {
            next += w;
        }
        output[i] = next * amplitude;
        shift = (shift + 1) % SIZE;
        x[shift] = next * leakage;
    }
}