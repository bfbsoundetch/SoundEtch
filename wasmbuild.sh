mkdir build
pushd build
export ac_cv_exeext=yes
emcmake cmake ../CMakeLists.txt -DCMAKE_C_FLAGS="-Wno-unused-but-set-global" -DCMAKE_CXX_FLAGS="-Wno-unused-but-set-global"
emmake make
popd
