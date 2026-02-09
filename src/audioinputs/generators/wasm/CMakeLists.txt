add_executable(noise_generator noise_generator.c)

set_target_properties(noise_generator PROPERTIES
                      RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_LIST_DIR})
target_compile_options(noise_generator PRIVATE -msimd128)
target_link_options(noise_generator PUBLIC -sEXPORTED_FUNCTIONS=_init,_create_noise)
target_link_options(noise_generator PUBLIC -sSINGLE_FILE=1)
target_link_options(noise_generator PUBLIC -sUSE_PTHREADS=1)
target_link_options(noise_generator PUBLIC -sENVIRONMENT=web,node,shell)
target_link_options(noise_generator PUBLIC -sMODULARIZE=1)
target_link_options(noise_generator PUBLIC -sEXPORT_NAME=createModule)
set(CMAKE_EXECUTABLE_SUFFIX ".mjs")