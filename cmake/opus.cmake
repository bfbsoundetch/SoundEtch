include(ExternalProject)

FetchContent_Declare(opus
    EXCLUDE_FROM_ALL
    GIT_REPOSITORY https://github.com/xiph/opus.git
    GIT_TAG v1.5.2
)
FetchContent_MakeAvailable(opus)

FetchContent_GetProperties(opus SOURCE_DIR opus_SOURCE_DIR BINARY_DIR opus_BINARY_DIR)

ExternalProject_Add(libopusenc
    GIT_REPOSITORY https://github.com/xiph/libopusenc.git
    CONFIGURE_COMMAND <SOURCE_DIR>/autogen.sh 
        COMMAND emconfigure <SOURCE_DIR>/configure 
            CFLAGS=-I${opus_SOURCE_DIR}/include\ -O3\ -msimd128
            LDFLAGS=-L${opus_BINARY_DIR}
            --host=wasm32-unknown-wasi
            --prefix=<INSTALL_DIR> 
            --enable-static 
            --disable-shared
            PKG_CONFIG_PATH=${opus_BINARY_DIR}
    BUILD_COMMAND emmake make
    INSTALL_COMMAND emmake make install
    BUILD_IN_SOURCE 1
    DEPENDS opus
)