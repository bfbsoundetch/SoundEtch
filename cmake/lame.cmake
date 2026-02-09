include(ExternalProject)

ExternalProject_Add(lame
  URL https://downloads.sourceforge.net/lame/lame-3.100.tar.gz
  URL_HASH MD5=83e260acbe4389b54fe08e0bdbf7cddb
  CONFIGURE_COMMAND emconfigure <SOURCE_DIR>/configure
    CFLAGS=-DNDEBUG\ -DNO_STDIO\ -O3\ -msimd128
    --disable-dependency-tracking
    --disable-shared
    --disable-gtktest
    --disable-analyzer-hooks
    --disable-decoder
    --disable-frontend
  BUILD_COMMAND emmake make clean
  INSTALL_COMMAND emmake make
  BUILD_IN_SOURCE 1
)