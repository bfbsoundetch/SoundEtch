mkdir build
pushd build
export ac_cv_exeext=yes
emcmake cmake ../CMakeLists.txt
emmake make
popd
