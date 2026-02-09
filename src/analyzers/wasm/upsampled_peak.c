#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WINDOW_SIZE 3
#define UPSAMPLE_FACTOR 4

float** coef;
float* weights;
float** surroundingValues;
int idx = 0;

int channelCount;

int renderQuantumSize;
int peakUpdateSampleCount;
int holdPeakSampleCount;
int samplesSinceInstantaneousPeakUpdate = 0;
int samplesSinceHeldPeakUpdate = 0;

float* peaksInProgress;
float* instantaneousPeaks;
float* heldPeaks;
float* inputArray;

float sinc(float x) {
    if (x == 0.0) {
        return 1.0;
    } else {
        return sin(M_PI * x) / (M_PI * x);
    }
}

float** generateLanczosKernels() {
  float** kernels = calloc(sizeof(float*), UPSAMPLE_FACTOR - 1);
  int kernelSize = 2 * WINDOW_SIZE;

  // Generate kernel for each phase (skip phase 0 which is the original sample)
  for (int phase = 1; phase < UPSAMPLE_FACTOR; ++phase) {
    float t = phase * 1.0 / UPSAMPLE_FACTOR;
    float* kernel = calloc(sizeof(float), kernelSize);

    // Calculate coefficients for this phase
    for (int i = 0; i < kernelSize; ++i) {
      float x = i - WINDOW_SIZE + 1 - t; // Center around interpolation point
      kernel[i] = sinc(x) * sinc(x / WINDOW_SIZE);
    }

    kernels[phase - 1] = kernel;
  }

  return kernels;
}

float* getInstantaneousPeaks() {
  return instantaneousPeaks;
}

float* getHeldPeaks() {
  return heldPeaks;
}

float* getInputArray() {
  return inputArray;
}

void init(int channelCnt, int updateSampleCnt, int holdSampleCnt, int quantumSize) {
    channelCount = channelCnt;
    peakUpdateSampleCount = updateSampleCnt;
    holdPeakSampleCount = holdSampleCnt;
    renderQuantumSize = quantumSize;
    peaksInProgress = calloc(channelCount, sizeof(float));
    instantaneousPeaks = calloc(channelCount, sizeof(float));
    heldPeaks = calloc(channelCount, sizeof(float));
    inputArray = calloc(channelCount * renderQuantumSize, sizeof(float));
    coef = generateLanczosKernels();
    weights = calloc(sizeof(float), UPSAMPLE_FACTOR - 1);
    for (int j = 0; j < UPSAMPLE_FACTOR - 1; ++j) {
        for (int i = 0; i < 2 * WINDOW_SIZE; ++i) {
            weights[j] += coef[j][i];
        }
        for (int i = 0; i < 2 * WINDOW_SIZE; ++i) {
            coef[j][i] /= weights[j];
        }
    }
    surroundingValues = calloc(channelCount, sizeof(float*));
    for (int channel = 0; channel < channelCount; ++channel) {
      surroundingValues[channel] = calloc(2 * WINDOW_SIZE, sizeof(float));
    }
}

void lanczosInterpolatedPeak() {
  // assumes this will happen at most once per call.
  if (samplesSinceInstantaneousPeakUpdate >= peakUpdateSampleCount) {
    for (int channel = 0; channel < channelCount; ++channel) {
      if (peaksInProgress[channel] > 1) {
        printf("wow!! %f\n", peaksInProgress[channel]);
      }
      instantaneousPeaks[channel] = peaksInProgress[channel];
      if (heldPeaks[channel] < instantaneousPeaks[channel]) {
        heldPeaks[channel] = instantaneousPeaks[channel];
        samplesSinceHeldPeakUpdate = 0;
      }
      peaksInProgress[channel] = 0;
      samplesSinceInstantaneousPeakUpdate = 0;
    }
  }
  if (samplesSinceHeldPeakUpdate >= holdPeakSampleCount) {
    for (int channel = 0; channel < channelCount; ++channel) {
      heldPeaks[channel] = instantaneousPeaks[channel];
      samplesSinceHeldPeakUpdate = 0;
    }
  }
  for (int k = 0; k < renderQuantumSize; ++k) {
    for (int channel = 0; channel < channelCount; ++channel) {
      float x = inputArray[k * channelCount + channel];
      surroundingValues[channel][(idx + WINDOW_SIZE - 1) % (2 * WINDOW_SIZE)] = x;
      peaksInProgress[channel] = fmax(peaksInProgress[channel], fabs(surroundingValues[channel][idx]));
      for (int j = 0; j < UPSAMPLE_FACTOR - 1; ++j) {
        float y = 0;
        for (int i = 0; i < 2 * WINDOW_SIZE; ++i) {
          // windowSize + 1 == 2 * windowSize - (windowSize - 1)
          y +=
            surroundingValues[channel][(i + idx + WINDOW_SIZE + 1) % (2 * WINDOW_SIZE)] *
            coef[j][i];
        }
        peaksInProgress[channel] = fmax(peaksInProgress[channel], fabs(y));
      }
    }
    idx = (idx + 1) % (2 * WINDOW_SIZE);
  }
  samplesSinceInstantaneousPeakUpdate += renderQuantumSize;
  samplesSinceHeldPeakUpdate += renderQuantumSize;
}