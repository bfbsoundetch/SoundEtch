import * as wasm from './df_bg.wasm'
import { __wbg_set_wasm } from './df_bg.js'
__wbg_set_wasm(wasm)
export * from './df_bg.js'
