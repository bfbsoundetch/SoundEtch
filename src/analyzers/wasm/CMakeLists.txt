add_executable(upsampled_peak upsampled_peak.c)
set_target_properties(upsampled_peak PROPERTIES
                      RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_LIST_DIR})
target_link_options(upsampled_peak PUBLIC -sEXPORTED_FUNCTIONS=_init,_lanczosInterpolatedPeak,_getInstantaneousPeaks,_getHeldPeaks,_getInputArray)
target_link_options(upsampled_peak PUBLIC -sSINGLE_FILE=1)
target_link_options(upsampled_peak PUBLIC -sUSE_PTHREADS=1)
target_link_options(upsampled_peak PUBLIC -sENVIRONMENT=shell,worker)
target_link_options(upsampled_peak PUBLIC -sMODULARIZE=1)
target_link_options(upsampled_peak PUBLIC -sEXPORT_NAME=createModule)

target_link_options(upsampled_peak PUBLIC --extern-post-js=${CMAKE_CURRENT_LIST_DIR}/../PeakFindingProcessor.js)

set(CMAKE_EXECUTABLE_SUFFIX ".mjs")