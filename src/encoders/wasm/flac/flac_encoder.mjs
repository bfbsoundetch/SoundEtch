// This code implements the `-sMODULARIZE` settings by taking the generated
// JS program code (INNER_JS_CODE) and wrapping it in a factory function.

// When targeting node and ES6 we use `await import ..` in the generated code
// so the outer function needs to be marked as async.
async function createModule(moduleArg = {}) {
  var moduleRtn;

// include: shell.js
// include: minimum_runtime_check.js
(function() {
  // "30.0.0" -> 300000
  function humanReadableVersionToPacked(str) {
    str = str.split('-')[0]; // Remove any trailing part from e.g. "12.53.3-alpha"
    var vers = str.split('.').slice(0, 3);
    while(vers.length < 3) vers.push('00');
    vers = vers.map((n, i, arr) => n.padStart(2, '0'));
    return vers.join('');
  }
  // 300000 -> "30.0.0"
  var packedVersionToHumanReadable = n => [n / 10000 | 0, (n / 100 | 0) % 100, n % 100].join('.');

  var TARGET_NOT_SUPPORTED = 2147483647;

  // Note: We use a typeof check here instead of optional chaining using
  // globalThis because older browsers might not have globalThis defined.
  var currentNodeVersion = typeof process !== 'undefined' && process.versions?.node ? humanReadableVersionToPacked(process.versions.node) : TARGET_NOT_SUPPORTED;
  if (currentNodeVersion < 180300) {
    throw new Error(`This emscripten-generated code requires node v${ packedVersionToHumanReadable(180300) } (detected v${packedVersionToHumanReadable(currentNodeVersion)})`);
  }

  var userAgent = typeof navigator !== 'undefined' && navigator.userAgent;
  if (!userAgent) {
    return;
  }

  var currentSafariVersion = userAgent.includes("Safari/") && !userAgent.includes("Chrome/") && userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/) ? humanReadableVersionToPacked(userAgent.match(/Version\/(\d+\.?\d*\.?\d*)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentSafariVersion < 150000) {
    throw new Error(`This emscripten-generated code requires Safari v${ packedVersionToHumanReadable(150000) } (detected v${currentSafariVersion})`);
  }

  var currentFirefoxVersion = userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Firefox\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentFirefoxVersion < 79) {
    throw new Error(`This emscripten-generated code requires Firefox v79 (detected v${currentFirefoxVersion})`);
  }

  var currentChromeVersion = userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/) ? parseFloat(userAgent.match(/Chrome\/(\d+(?:\.\d+)?)/)[1]) : TARGET_NOT_SUPPORTED;
  if (currentChromeVersion < 85) {
    throw new Error(`This emscripten-generated code requires Chrome v85 (detected v${currentChromeVersion})`);
  }
})();

// end include: minimum_runtime_check.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = moduleArg;

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = !!globalThis.window;
var ENVIRONMENT_IS_WORKER = !!globalThis.WorkerGlobalScope;
// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {
  // When building an ES module `require` is not normally available.
  // We need to use `createRequire()` to construct the require()` function.
  const { createRequire } = await import('node:module');
  /** @suppress{duplicate} */
  var require = createRequire(import.meta.url);

}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)


var arguments_ = [];
var thisProgram = './this.program';
var quit_ = (status, toThrow) => {
  throw toThrow;
};

var _scriptName = import.meta.url;

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;

if (ENVIRONMENT_IS_NODE) {
  const isNode = globalThis.process?.versions?.node && globalThis.process?.type != 'renderer';
  if (!isNode) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require('node:fs');

  if (_scriptName.startsWith('file:')) {
    scriptDirectory = require('node:path').dirname(require('node:url').fileURLToPath(_scriptName)) + '/';
  }

// include: node_shell_read.js
readBinary = (filename) => {
  // We need to re-wrap `file://` strings to URLs.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename);
  assert(Buffer.isBuffer(ret));
  return ret;
};

readAsync = async (filename, binary = true) => {
  // See the comment in the `readBinary` function.
  filename = isFileURI(filename) ? new URL(filename) : filename;
  var ret = fs.readFileSync(filename, binary ? undefined : 'utf8');
  assert(binary ? Buffer.isBuffer(ret) : typeof ret == 'string');
  return ret;
};
// end include: node_shell_read.js
  if (process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, '/');
  }

  arguments_ = process.argv.slice(2);

  quit_ = (status, toThrow) => {
    process.exitCode = status;
    throw toThrow;
  };

} else
if (ENVIRONMENT_IS_SHELL) {

} else

// Note that this includes Node.js workers when relevant (pthreads is enabled).
// Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
// ENVIRONMENT_IS_NODE.
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  try {
    scriptDirectory = new URL('.', _scriptName).href; // includes trailing slash
  } catch {
    // Must be a `blob:` or `data:` URL (e.g. `blob:http://site.com/etc/etc`), we cannot
    // infer anything from them.
  }

  if (!(globalThis.window || globalThis.WorkerGlobalScope)) throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');

  {
// include: web_or_worker_shell_read.js
if (ENVIRONMENT_IS_WORKER) {
    readBinary = (url) => {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send(null);
      return new Uint8Array(/** @type{!ArrayBuffer} */(xhr.response));
    };
  }

  readAsync = async (url) => {
    assert(!isFileURI(url), "readAsync does not work with file:// URLs");
    var response = await fetch(url, { credentials: 'same-origin' });
    if (response.ok) {
      return response.arrayBuffer();
    }
    throw new Error(response.status + ' : ' + response.url);
  };
// end include: web_or_worker_shell_read.js
  }
} else
{
  throw new Error('environment detection error');
}

var out = console.log.bind(console);
var err = console.error.bind(console);

var IDBFS = 'IDBFS is no longer included by default; build with -lidbfs.js';
var PROXYFS = 'PROXYFS is no longer included by default; build with -lproxyfs.js';
var WORKERFS = 'WORKERFS is no longer included by default; build with -lworkerfs.js';
var FETCHFS = 'FETCHFS is no longer included by default; build with -lfetchfs.js';
var ICASEFS = 'ICASEFS is no longer included by default; build with -licasefs.js';
var JSFILEFS = 'JSFILEFS is no longer included by default; build with -ljsfilefs.js';
var OPFS = 'OPFS is no longer included by default; build with -lopfs.js';

var NODEFS = 'NODEFS is no longer included by default; build with -lnodefs.js';

// perform assertions in shell.js after we set up out() and err(), as otherwise
// if an assertion fails it cannot print the message

assert(!ENVIRONMENT_IS_WEB, 'web environment detected but not enabled at build time (add `web` to `-sENVIRONMENT` to enable)');

assert(!ENVIRONMENT_IS_SHELL, 'shell environment detected but not enabled at build time (add `shell` to `-sENVIRONMENT` to enable)');

// end include: shell.js

// include: preamble.js
// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html

var wasmBinary;

if (!globalThis.WebAssembly) {
  err('no native wasm support detected');
}

// Wasm globals

//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// In STRICT mode, we only define assert() when ASSERTIONS is set.  i.e. we
// don't define it at all in release modes.  This matches the behaviour of
// MINIMAL_RUNTIME.
// TODO(sbc): Make this the default even without STRICT enabled.
/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed' + (text ? ': ' + text : ''));
  }
}

// We used to include malloc/free by default in the past. Show a helpful error in
// builds with assertions.
function _malloc() {
  abort('malloc() called but not included in the build - add `_malloc` to EXPORTED_FUNCTIONS');
}
function _free() {
  // Show a helpful error since we used to include free by default in the past.
  abort('free() called but not included in the build - add `_free` to EXPORTED_FUNCTIONS');
}

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */
var isFileURI = (filename) => filename.startsWith('file://');

// include: runtime_common.js
// include: runtime_stack_check.js
// Initializes the stack cookie. Called at the startup of main and at the startup of each thread in pthreads mode.
function writeStackCookie() {
  var max = _emscripten_stack_get_end();
  assert((max & 3) == 0);
  // If the stack ends at address zero we write our cookies 4 bytes into the
  // stack.  This prevents interference with SAFE_HEAP and ASAN which also
  // monitor writes to address zero.
  if (max == 0) {
    max += 4;
  }
  // The stack grow downwards towards _emscripten_stack_get_end.
  // We write cookies to the final two words in the stack and detect if they are
  // ever overwritten.
  HEAPU32[((max)>>2)] = 0x02135467;
  HEAPU32[(((max)+(4))>>2)] = 0x89BACDFE;
  // Also test the global address 0 for integrity.
  HEAPU32[((0)>>2)] = 1668509029;
}

function checkStackCookie() {
  if (ABORT) return;
  var max = _emscripten_stack_get_end();
  // See writeStackCookie().
  if (max == 0) {
    max += 4;
  }
  var cookie1 = HEAPU32[((max)>>2)];
  var cookie2 = HEAPU32[(((max)+(4))>>2)];
  if (cookie1 != 0x02135467 || cookie2 != 0x89BACDFE) {
    abort(`Stack overflow! Stack cookie has been overwritten at ${ptrToString(max)}, expected hex dwords 0x89BACDFE and 0x2135467, but received ${ptrToString(cookie2)} ${ptrToString(cookie1)}`);
  }
  // Also test the global address 0 for integrity.
  if (HEAPU32[((0)>>2)] != 0x63736d65 /* 'emsc' */) {
    abort('Runtime error: The application has corrupted its heap memory area (address zero)!');
  }
}
// end include: runtime_stack_check.js
// include: runtime_exceptions.js
// Base Emscripten EH error class
class EmscriptenEH {}

class EmscriptenSjLj extends EmscriptenEH {}

// end include: runtime_exceptions.js
// include: runtime_debug.js
var runtimeDebug = true; // Switch to false at runtime to disable logging at the right times

// Used by XXXXX_DEBUG settings to output debug messages.
function dbg(...args) {
  if (!runtimeDebug && typeof runtimeDebug != 'undefined') return;
  // TODO(sbc): Make this configurable somehow.  Its not always convenient for
  // logging to show up as warnings.
  console.warn(...args);
}

// Endianness check
(() => {
  var h16 = new Int16Array(1);
  var h8 = new Int8Array(h16.buffer);
  h16[0] = 0x6373;
  if (h8[0] !== 0x73 || h8[1] !== 0x63) abort('Runtime error: expected the system to be little-endian! (Run with -sSUPPORT_BIG_ENDIAN to bypass)');
})();

function consumedModuleProp(prop) {
  if (!Object.getOwnPropertyDescriptor(Module, prop)) {
    Object.defineProperty(Module, prop, {
      configurable: true,
      set() {
        abort(`Attempt to set \`Module.${prop}\` after it has already been processed.  This can happen, for example, when code is injected via '--post-js' rather than '--pre-js'`);

      }
    });
  }
}

function makeInvalidEarlyAccess(name) {
  return () => assert(false, `call to '${name}' via reference taken before Wasm module initialization`);

}

function ignoredModuleProp(prop) {
  if (Object.getOwnPropertyDescriptor(Module, prop)) {
    abort(`\`Module.${prop}\` was supplied but \`${prop}\` not included in INCOMING_MODULE_JS_API`);
  }
}

// forcing the filesystem exports a few things by default
function isExportedByForceFilesystem(name) {
  return name === 'FS_createPath' ||
         name === 'FS_createDataFile' ||
         name === 'FS_createPreloadedFile' ||
         name === 'FS_preloadFile' ||
         name === 'FS_unlink' ||
         name === 'addRunDependency' ||
         // The old FS has some functionality that WasmFS lacks.
         name === 'FS_createLazyFile' ||
         name === 'FS_createDevice' ||
         name === 'removeRunDependency';
}

function missingLibrarySymbol(sym) {

  // Any symbol that is not included from the JS library is also (by definition)
  // not exported on the Module object.
  unexportedRuntimeSymbol(sym);
}

function unexportedRuntimeSymbol(sym) {
  if (!Object.getOwnPropertyDescriptor(Module, sym)) {
    Object.defineProperty(Module, sym, {
      configurable: true,
      get() {
        var msg = `'${sym}' was not exported. add it to EXPORTED_RUNTIME_METHODS (see the Emscripten FAQ)`;
        if (isExportedByForceFilesystem(sym)) {
          msg += '. Alternatively, forcing filesystem support (-sFORCE_FILESYSTEM) can export this for you';
        }
        abort(msg);
      },
    });
  }
}

// end include: runtime_debug.js
// include: binaryDecode.js
// Prevent Closure from minifying the binaryDecode() function, or otherwise
// Closure may analyze through the WASM_BINARY_DATA placeholder string into this
// function, leading into incorrect results.
/** @noinline */
function binaryDecode(bin) {
  for (var i = 0, l = bin.length, o = new Uint8Array(l), c; i < l; ++i) {
    c = bin.charCodeAt(i);
    o[i] = ~c >> 8 & c; // Recover the null byte in a manner that is compatible with https://crbug.com/453961758
  }
  return o;
}
// end include: binaryDecode.js
var readyPromiseResolve, readyPromiseReject;

// Memory management

var runtimeInitialized = false;



function updateMemoryViews() {
  var b = wasmMemory.buffer;
  HEAP8 = new Int8Array(b);
  HEAP16 = new Int16Array(b);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(b);
  HEAPU16 = new Uint16Array(b);
  Module['HEAP32'] = HEAP32 = new Int32Array(b);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(b);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(b);
  HEAPF64 = new Float64Array(b);
  HEAP64 = new BigInt64Array(b);
  HEAPU64 = new BigUint64Array(b);
}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// end include: runtime_common.js
assert(globalThis.Int32Array && globalThis.Float64Array && Int32Array.prototype.subarray && Int32Array.prototype.set,
       'JS engine does not provide full typed array support');

function preRun() {
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  consumedModuleProp('preRun');
  // Begin ATPRERUNS hooks
  callRuntimeCallbacks(onPreRuns);
  // End ATPRERUNS hooks
}

function initRuntime() {
  assert(!runtimeInitialized);
  runtimeInitialized = true;

  checkStackCookie();

  // Begin ATINITS hooks
  if (!Module['noFSInit'] && !FS.initialized) FS.init();
TTY.init();
  // End ATINITS hooks

  wasmExports['__wasm_call_ctors']();

  // Begin ATPOSTCTORS hooks
  FS.ignorePermissions = false;
  // End ATPOSTCTORS hooks
}

function postRun() {
  checkStackCookie();
   // PThreads reuse the runtime from the main thread.

  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  consumedModuleProp('postRun');

  // Begin ATPOSTRUNS hooks
  callRuntimeCallbacks(onPostRuns);
  // End ATPOSTRUNS hooks
}

/**
 * @param {string|number=} what
 */
function abort(what) {
  Module['onAbort']?.(what);

  what = `Aborted(${what})`;
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);

  ABORT = true;

  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.

  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);

  readyPromiseReject?.(e);
  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

function createExportWrapper(name, nargs) {
  return (...args) => {
    assert(runtimeInitialized, `native function \`${name}\` called before runtime initialization`);
    var f = wasmExports[name];
    assert(f, `exported native function \`${name}\` not found`);
    // Only assert for too many arguments. Too few can be valid since the missing arguments will be zero filled.
    assert(args.length <= nargs, `native function \`${name}\` called with ${args.length} args but expects ${nargs}`);
    return f(...args);
  };
}

var wasmBinaryFile;

function findWasmBinary() {
  return binaryDecode(' asm   üA````~` `` ` ` ``~~`|` `~`  ` ` ` `~`~ `~``~`||`|||`\n````~``	```~`} `}}} ``~`~`~`|}`}`}}`||`||`|`|`|~~|` |`| ` `~~~~ `~~ `~~`~~ `~`|`~`~`|~`~~~~`| `} `~~|ö\nenvwriteEncodedChunk envseek envtell  env\r__assert_fail wasi_snapshot_preview1fd_write wasi_snapshot_preview1fd_read wasi_snapshot_preview1fd_close 	wasi_snapshot_preview1fd_seek \renv	_abort_js envemscripten_resize_heap 	ÐÎ	 					 	 	 		     	 							 	    		          	 	 							 	   		  	 				 		  		 !" ##$$	 %	 	&	&				\'				 (					 ))*+,-..-/012		- \n  		   		 							.---//\n  3			 -	\n	 		45647	89%	:;; <	 	 	45==4>?5444@		pAA A ømemory __wasm_call_ctors \ncreate_encoder encode_chunk get_encoder_state \rget_input_buffer_pointer finish_encoding __indirect_function_table fflush Øemscripten_stack_get_end Ðemscripten_stack_get_base Ïstrerror ×emscripten_stack_init Íemscripten_stack_get_free Î_emscripten_stack_restore Ó_emscripten_stack_alloc Ôemscripten_stack_get_current Õ	5 A Y±ÑÈopqÉÊËÌàÝÜÞ°±\n¿Î ÍÀ\n# A k! $    6  6  6  6  6 A6» !A  6© @@A (© A FAqE\r A (Ð AÐÞ A á  A (© AÓ  (q6 A (©  (¾  (q6 A (©  (Ô  (q6 A (©  (Õ  (q6 A (©  (Ö  (q6A (© !A !    â  (q6@ (\r A (Ð !	  (6  	A¯ß  á A (© !\nA !A !A !\rA !  \n   \r  Æ 6 A j$ L# Ak! $    6A (© A (©  (å À! Aj$   A (© ã Æ# Ak! $    6  6  ( (lA¼ 6 (A¼ !A  6©  A 6 @@ (  (HAqE\r ( (  (lAtj!A (©  ( Atj 6   ( Aj6   (! Aj$   A (© ¿ À# Ak!   6  6 A : @@ (!  Aj6 E\rAÿ - ! (!  Aj6Aÿ   -  s- Ðß :  Aÿ - ¥(# Ak!   6  6 A ;@@ (AOAqE\r (!Aÿ -  At! (!Aÿ  - r!Aÿÿ   /s;Aÿÿ /Au!AÐá Aj Atj!Aÿÿ / !	Aÿÿ /Aÿq!\nAÐá Aj \nAtj!Aÿÿ 	 / s! (!\rAÿ \r- !AÐá Aj Atj!Aÿÿ  / s! (!Aÿ - !AÐá Aj Atj!Aÿÿ  / s! (!Aÿ - !AÐá Aj Atj!Aÿÿ  / s! (!Aÿ - !AÐá Aj Atj!Aÿÿ  / s! (!Aÿ - !AÐá Aj Atj!Aÿÿ  / s!  (!!Aÿ !- !"AÐá  "Atj!#Aÿÿ    #/ s;  (Aj6  (Ak6 @@ (!$  $Aj6 $E\rAÿÿ /At!%Aÿÿ /Au!& (!\'  \'Aj6Aÿ & \'-  s!(AÐá  (Atj!)Aÿÿ  % )/ s; Aÿÿ /~# Ak!   6  6  ;@@ (!  Aj6 E\r () B0!Aÿÿ   3§;Aÿÿ /Au!AÐá Aj Atj!Aÿÿ / !Aÿÿ /Aÿq!	AÐá Aj 	Atj!\nAÿÿ  \n/ s! () B(Bÿ§!AÐá Aj Atj!\rAÿÿ  \r/ s! () B Bÿ§!AÐá Aj Atj!Aÿÿ  / s! () BBÿ§!AÐá Aj Atj!Aÿÿ  / s! () BBÿ§!AÐá Aj Atj!Aÿÿ  / s! () BBÿ§!AÐá Aj Atj!Aÿÿ  / s! () Bÿ§!AÐá  Atj!Aÿÿ   / s;  (Aj6 Aÿÿ /B# Ak!   6@@ (Aÿÿ?KAqE\r  A 6 A6 (t# Ak!   6  6@@ (AKAqE\r  A 6@ (A÷MAqE\r  (A$KAqE\r  A 6 A6 (# Ak! $    6@@@ ( E\r  (A(OAq\r  (AOAqE\r (A\npE\r A 6 A6 (! Aj$  ¾# A k! $    6 B 7 A 6@ (A GAq\r AÅ¡ A±¨ AøA¯   @@ (5 B~BZAqE\r  A 6 A 6@@ ( (( IAqE\r@ (E\r @ (( (Alj) BRAqE\r  (( (Alj)  )XAqE\r  A 6  (( (Alj) 7 A6  (Aj6  A6 (! A j$  # A k! $    6@ (A GAq\r AÅ¡ A±¨ AA÷   @@ (( \r  A 6 (( (( AA   A6 A 6 A 6@@ ( (( IAqE\r@@ (( (Alj) BRAqE\r @ (\r @ (( (Alj)  (( (AkAlj) QAqE\r  A 6 ((! (!  Aj6  Alj! (( (Alj!  )7  )7  ) 7   (Aj6   (6@@ ( (( IAqE\r (( (AljB7  (( (AljB 7 (( (AljA 6  (Aj6   (6 (! A j$  s# Ak!   6  6@@ ()  () QAqE\r  A 6@ ()  () TAqE\r  A6 A6 (û	%# Ak! $    6@ (A GAq\r Añ» A±¨ AÄAØ²    (!Aÿ@@ -  Aq\r  A6 (!Aÿ@ -  AàqAÀFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ@ -  AþqAÀFAqE\r  A 6 A6 (!Aÿ@ -  AðqAàFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!	Aÿ@ 	-  AàFAqE\r  (!\nAÿ \n- AàqAFAqE\r  A 6 (!Aÿ@ -  AíFAqE\r  (!Aÿ - AàqA FAqE\r  A 6 (!\rAÿ@ \r-  AïFAqE\r  (!Aÿ - A¿FAqE\r  (!Aÿ - AþqA¾FAqE\r  A 6 A6 (!Aÿ@ -  AøqAðFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ@ -  AðFAqE\r  (!Aÿ - AðqAFAqE\r  A 6 A6 (!Aÿ@ -  AüqAøFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ@ -  AøFAqE\r  (!Aÿ - AøqAFAqE\r  A 6 A6 (!Aÿ@ -  AþqAüFAqE\r  (!Aÿ - AÀqAFAqE\r  (!Aÿ - AÀqAFAqE\r  (! Aÿ  - AÀqAFAqE\r  (!!Aÿ !- AÀqAFAqE\r  (!"Aÿ "- AÀqAFAqE\r  (!#Aÿ@ #-  AüFAqE\r  (!$Aÿ $- AüqAFAqE\r  A 6 A6 A 6 (!% Aj$  %\n\r# A k!   6  6  6@@ (E\r @ ()B±TAqE\r @ (A GAqE\r  (AÐ 6  A 6@ ()BÌB RAqE\r @ (A GAqE\r  (Aé 6  A 6@ ((\r @ (A GAqE\r  (AßÍ 6  A 6@ (E\r  (( ((AkAtj!Aÿ - AªGAqE\r @ (A GAqE\r  (AüÙ 6  A 6 A 6@@ ( ((IAqE\r (( (Atj!Aÿ@ - \r @ (A GAqE\r  (AÃ 6  A 6@ (E\r  (( (Atj!Aÿ@@ - ANAqE\r  (( (Atj!Aÿ - Aã LAq\r (( (Atj!Aÿ - AªFAq\r @ (A GAqE\r  (AÖÂ 6  A 6@ (E\r  (( (Atj) BÌB RAqE\r @ (A GAqE\r @@ ( ((AkFAqE\r  (AÜ 6  (A¤ 6  A 6@ ( ((AkIAqE\r  (( (Atj!	Aÿ@ 	- \r @ (A GAqE\r  (A 6  A 6 (( (Atj(!\nAÿ@ \n- AJAqE\r @ (A GAqE\r  (A¢Â 6  A 6 A 6@@ (! (( (Atj!Aÿ  - IAqE\r@ (E\r  (( (Atj( (Atj) BÌB RAqE\r @ (A GAqE\r  (A 6  A 6@ (A KAqE\r  (( (Atj( (Atj!\rAÿ \r- ! (( (Atj( (AkAtj!Aÿ@  - AjGAqE\r @ (A GAqE\r  (AñÁ 6  A 6  (Aj6   (Aj6  A6 (ß# A k! $    6  6  ((6@@@ (!A !Aÿ -   AÿqGAqE\r@@ (,  A HAq\r  (,  Aþ JAqE\r@ (A GAqE\r  (AÓ 6  A 6  (Aj6   ((6@@ (!A !Aÿ -   AÿqGAqE\r  ( 6@ (\r @ (A GAqE\r  (A¼ 6  A 6  ( (j6  A6 (! A j$  {# Ak!   6 A 6@@ (AqA GAsAqE\r  (Aj6  (Av6  (!@@A IAqE\r A! (! ü# Ak! $    6  6  6  (6 @ ( A K!A ! Aq! !@ E\r  ( ( v (M!@ AqE\r   ( Aj6 @@ ( \r  ( (OAq\r@ ( A KAqE\r  ( ( v (KAq\rAÎ A±¨ A°Aè    ( ! Aj$  t# Ak! $    6@ (A GAq\r A§ A±¨ A·AÕ    (A 6  (A 6 (A 6 Aj$ ¥# Ak! $    6@ (A GAq\r A§ A±¨ AÀA²   @ (( A GAqE\r  (( ¸ @ ((A GAqE\r  ((¸  (  Aj$ ó\r# Ak! $    6  6@ (A GAq\r A§ A±¨ AÐA¾   @@@ (( (IAq\r  (( A FAq\r  ((A FAqE\r (( ! (! A tAt¡ ! ( 6 @ A FAqE\r  A 6 ((! (! A tAt¡ ! ( 6@ A FAqE\r  A 6 ((!	 (!\nA \ntAt!A !@ E\r  	  ü  (!\r ( \r6 A6 (! Aj$  # Ak! $    6  6  (6  ( (¹ 6 @ (A KAqE\r  ( A FAqE\r  (¸  ( ! Aj$  ;# Ak!   $   AA ¼ 6  (!  Aj$  l# Ak! $    6@ (A GAq\r A² Aô¨ A¦A     (¤  (¸  Aj$  # Ak! $    6@ (A GAq\r A² Aô¨ AÁAÕ¡   @ (( A GAqE\r  (( ¸  (A 6  (A 6 (A 6 (A 6 Aj$ Â# Ak! $    6@ (A GAq\r A² Aô¨ A´A    (A 6 (A 6 (A 6 ((At¶ ! ( 6 @@ (( A FAqE\r  A 6 A6 (! Aj$  +# Ak!   6 (A 6 (A 6»# A k! $    6  6@ ((AqE\r AÉ Aô¨ AÔAò¼   @@ ( Aj Aj¨ \r  A 6 ( ( ! ( ;  (©  A6 (! A j$  ~~# Ak! $    6  6  6 @ ((AqE\r AÉ Aô¨ AùAò   @@ ((AqE\r  A 6@ ((E\r @ (( ((MAq\r A¥ Aô¨ AÿAò   @ (( ((FAqE\r  (AÀ ª \r  A 6 ()! ((! AÀ  k­!B8!  !B(!	  	!\nBþ!  \n !B!\r  \r!Bü!  !B!  !Bø!          \r     	! ((  ((Atj 7  (( ! ( 6  ((At ((Avj! (  6  A6 (! Aj$  # Ak!   6«# A k! $    6  6@ (A GAq\r A² Aô¨ Aó AÜ¯   @ (( A GAq\r A Aô¨ Aô AÜ¯     (( (( (jAÀ jAkAvj6@@ (( (OAqE\r  A6 (At!A ( !@ A tKAqE\r  A 6@ ( ((k ((AvIAqE\r   (( ((Avj6@ ( ((KAq\r A Aô¨ AAÜ¯   @ ( (( (( (jAÀ jAkAvjOAq\r AÛ Aô¨ AAÜ¯    (( ! (!  A ® 6@ (A FAqE\r  A 6 (! ( 6  (! ( 6 A6 (!	 A j$  	»# A k! $    6  6@ ((AqE\r AÉ Aô¨ AãAû»   @@ ( Aj Aj¨ \r  A 6 ( ( ! ( :   (©  A6 (! A j$  (# Ak!   6 ((AqA FAq+# Ak!   6 ((At ((j°# Ak! $    6  6  6 @@@ (E\r  ( \r  (A ¹ 6 (! ( !@ A nKAqE\r  A 6  ( ( ( l¹ 6 (! Aj$  ô	~# Ak! $    6  6@ (A GAq\r A² Aô¨ AAí   @ (( A GAq\r A Aô¨ AAí   @@ (\r  A6@ (( (( (jMAqE\r  ( (ª \r  A 6@ ((E\r  ((!@@AÀ  k (IAqE\r  ((!AÀ  k! (!  6  ( ! (!  ) ­7 ( !  ( k6 ( !	 (!\n \n 	 \n(j6@@ ((AÀ FAqE\r  ()!B8!  !\rB(!  !Bþ! \r  !B!  !Bü!  !B!  !Bø!               ! (( ! (! (!  Aj6  Atj 7  (A 6 A6@@ (AÀ OAqE\r (( ! (! (!  Aj6  AtjB 7   (AÀ k6 @ (A KAqE\r  (B 7 (!  (  6 A6 (!! Aj$  !# Ak! $    6  6  6 @@ ( A IAqE\r  ( ( vE\r  A 6  ( ( ( ± 6 (! Aj$  	~~~~# A k! $    6  6  6@@@ (A FAq\r  (( A FAqE\r A 6@ (A KAqE\r  A 6@ (\r  A6@ (A FAq\r  ( (vE\r AÝÜ Aô¨ AÉA·   @ (( (( (jMAqE\r  ( (ª \r  A 6 ((! AÀ  k6@@ ( (IAqE\r  (! (!  ) ­7 5! (!   )7 (!	 (!\n \n 	 \n(j6@@ ((E\r  (! (!  ) ­7 (!\r ( (k! ( 6 \r v­! (!   )7 ()!B8!  !B(!  !Bþ!   !B!  !Bü!  !B!  !Bø!               ! (( !  (!! !(!" ! "Aj6   "Atj 7  5!# ( #7 5!$B8!% $ %!&B(!\' $ \'!(Bþ!) & ( )!*B!+ $ +!,Bü!- , -!.B!/ $ /!0Bø!1 * . 0 1 $ 1 / $ - + $ % $ ) \'!2 (( !3 (!4 4(!5 4 5Aj6 3 5Atj 27  A6 (!6 A j$  6|# Ak! $    6  6  6@ (A IAqE\r  (! A tAs (q6 ( ( (± ! Aj$  ¾# A k! $    6  7  6@@ (A KAqE\r  ( )B § (A k° !A !@ E\r  ( )§A ± A G!  Aq6  ( )§ (° 6 (! A j$  ~# A k! $    6  7  6  )7 @ (AÀ IAqE\r  5! B B ) 7  ( )  (³ ! A j$  Ù# Ak! $    6  6@@ ( (AÿqA± \r  A 6@ ( (AvAÿqA± \r  A 6@ ( (AvAÿqA± \r  A 6@ ( (AvA± \r  A 6 A6 (! Aj$  ñ# A k! $    6  6  6@@ (( (( (AvjAjMAqE\r  ( (Atª \r  A 6 A 6@@ ( (IAqE\r (! ( (j!Aÿ@  -  A± \r  A 6  (Aj6  A6 (! A j$  ½# Ak! $    6  6@@ (A IAqE\r  (! (Aj!  6  A ± 6 ( (¯ !A !@ E\r  (!A!   ± A G!  Aq6 (!	 Aj$  	)	~~~~~~~~~~~~~~~~~~~~# AÐ k! $    6H  6D  6@  6< (<! A t68 (<!A k! A v64  (<Aj6, B 7 AÀ 6@ (HA GAq\r A² Aô¨ AÆAÏ   @ (H( A GAq\r A Aô¨ AÇAÏ   @ (<AIAq\r AÁÁ Aô¨ AÈAÏ   @@ (H(A KAqE\r  (H(A IAqE\r  (H(!  ( k6  (H) 57 (HA 6@ (H(A KAqE\r  (H(A k!	  ( 	k6  (H) 57 (H(A k!\n (H!  ) \n­7 (HA 6@@ (H(At (H(At (@Atj (H(jMAqE\r  (H (@Atª \r  A 6L@@ (@E\r  (D( 60  (0At60  (D( Au (0s60  (0 (<v6(  (, ((j6$  (8 (0r60  (4 (0q60@@ ($ (MAqE\r   50 ( ($k­ )7 ($!  ( k6@ (A MAqE\r @ (H(AqE\r AÈ Aô¨ A÷AÏ   @@ (H(\r  )B !\r (H \r7  )B 7 (HA 6 (H!  )B 7 )B ! (H!   )|7 (H)!B8!  !B(!  !Bþ!   !B!  !Bü!  !B!  !Bø!               ! (H( !  (H!! !(!" ! "Aj6   "Atj 7   )B 7 (HA 6  (A j6@ ($AÀ KAqE\r   ($AÀ k6  (H(At (H(j (@Atj (j6@ (H(At (MAqE\r  (H (@At (jª \r  A 6L@@ (( (KAqE\r  (A k!#  (( #k6( A 6@ (H(AqE\r AÈ Aô¨ AAÏ   @@ (H(\r  )B !$ (H $7  )B 7 (HA 6 (H!% % %)B 7 )B !& (H!\' \' & \')|7 (H)!(B8!) ( )!*B(!+ ( +!,Bþ!- * , -!.B!/ ( /!0Bü!1 0 1!2B!3 ( 3!4Bø!5 . 2 4 5 ( 5 3 ( 1 / ( ) ( - +!6 (H( !7 (H!8 8(!9 8 9Aj6 7 9Atj 67   )B 7 (HA 6  (A j6@@ (( (KAqE\r@ (H(AqE\r AÈ Aô¨ AAÏ   @@ (H(\r  )B !: (H :7  )B 7 (HA 6 (H!; ; ;)B 7 )B !< (H!= = < =)|7 (H)!>B8!? > ?!@B(!A > A!BBþ!C @ B C!DB!E > E!FBü!G F G!HB!I > I!JBø!K D H J K > K I > G E > ? > C A!L (H( !M (H!N N(!O N OAj6 M OAtj L7   )B 7 (HA 6  (A j6  (A k6  ((A k6(  ((!P  ( Pk6@ (A MAqE\r @ (H(AqE\r AÈ Aô¨ AAÏ   @@ (H(\r  )B !Q (H Q7  )B 7 (HA 6 (H!R R R)B 7 )B !S (H!T T S T)|7 (H)!UB8!V U V!WB(!X U X!YBþ!Z W Y Z![B!\\ U \\!]Bü!^ ] ^!_B!` U `!aBø!b [ _ a b U b ` U ^ \\ U V U Z X!c (H( !d (H!e e(!f e fAj6 d fAtj c7   )B 7 (HA 6  (A j6 ((!g  ( gk6@ (A MAqE\r @ (H(AqE\r AÈ Aô¨ AAÏ   @@ (H(\r  )B !h (H h7  )B 7 (HA 6 (H!i i i)B 7 )B !j (H!k k j k)|7 (H)!lB8!m l m!nB(!o l o!pBþ!q n p q!rB!s l s!tBü!u t u!vB!w l w!xBø!y r v x y l y w l u s l m l q o!z (H( !{ (H!| |(!} | }Aj6 { }Atj z7   )B 7 (HA 6  (A j6  50 ( (,k­ )7 (,!~  ( ~k6@ (A MAqE\r @ (H(AqE\r AÈ Aô¨ A AÏ   @@ (H(\r  )B ! (H 7  )B 7 (HA 6 (H!  )B 7 )B ! (H!   )|7 (H)!B8!  !B(!  !Bþ!   !B!  !Bü!  !B!  !Bø!               ! (H( ! (H! (!  Aj6  Atj 7   )B 7 (HA 6  (A j6  (DAj6D  (@Aj6@ @ (AÀ IAqE\r @@ (H(\r  ) 5! (H 7 (!AÀ  k! (H 6@@ (H(A FAqE\r  (!AÀ  k! (H!  ) ­7 ) 5! (H!   )7 (!Aà  k! (H 6AÊ Aô¨ A¸AÏ    A6L (L! AÐ j$  ¾# Ak! $    6  6 A6 @ (A GAq\r A² Aô¨ AÁA¿   @ (( A GAq\r A Aô¨ AÂA¿   @@ (AxqE\r  A 6@ (AIAqE\r   ( (A± 6@@ (AIAqE\r   ( (AvAÀrA±  ( q6   ( (A?qArA±  ( q6 @@ (AIAqE\r   ( (AvAàrA±  ( q6   ( (AvA?qArA±  ( q6   ( (A?qArA±  ( q6 @@ (AIAqE\r   ( (AvAðrA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (A?qArA±  ( q6 @@ (A IAqE\r   ( (AvAørA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (A?qArA±  ( q6   ( (AvAürA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (AvA?qArA±  ( q6   ( (A?qArA±  ( q6   ( 6 (! Aj$  ü\n# A k! $    6  7 A6@ (A GAq\r A² Aô¨ AðAí½   @ (( A GAq\r A Aô¨ AñAí½   @@ )B~B RAqE\r  A 6@ )BTAqE\r   ( )§A± 6@@ )BTAqE\r   ( )B§AÀrA±  (q6  ( )B?§ArA±  (q6@@ )BTAqE\r   ( )B§AàrA±  (q6  ( )BB?§ArA±  (q6  ( )B?§ArA±  (q6@@ )BTAqE\r   ( )B§AðrA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )B?§ArA±  (q6@@ )B TAqE\r   ( )B§AørA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )B?§ArA±  (q6@@ )BTAqE\r   ( )B§AürA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )B?§ArA±  (q6  (AþA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )BB?§ArA±  (q6  ( )B?§ArA±  (q6  (6 (! A j$  v# Ak! $    6@@ ((AqE\r  (! ((Aq!  A k¯ 6 A6 (! Aj$  ;# Ak!   $   AA8¼ 6  (!  Aj$  l# Ak! $    6@ (A GAq\r Aª A« AA·    (¾  (¸  Aj$ æ# Ak! $    6@ (A GAq\r Aª A« A³Aê¡   @ (( A GAqE\r  (( ¸  (A 6  (A 6 (A 6 (A 6 (A 6 (A 6 (A 60 (A 64 (A 6$ (A6( (A6, Aj$ ¤# Ak! $    6  6  6 @ (A GAq\r Aª A« A A¬    (A 6 (A 6 (A 6 (A 6 (A6 ((At¶ ! ( 6 @@ (( A FAqE\r  A 6 (! ( 60 ( ! ( 64 (A 6$ (A6( (A6, A6 (! Aj$  _# Ak!   6 (A 6 (A 6 (A 6 (A 6 (A 6$ (A6( (A6,A:# Ak!   6 ((At ((Avj! ( 6,# Ak!   6@@ ((,AFAqE\r  (A 6 (A 6 A 6 ((,AjAv! ( 6 ((,AjAqAt! ( 6 A6 (÷# Ak! $    6  ;\n@ (A GAq\r Aª A« AàA½   @ (( A GAq\r A A« AáA½   @ ((AqE\r AöÈ A« AâA½   Aÿÿ /\n! ( 6 ((! ( 6 ((! ( 6  Aj$ Î~# Ak! $    6@ (A GAq\r Aª A« AëA³½   @ (( A GAq\r A A« AìA³½    (Å @ ((AqE\r AöÈ A« AñA³½   @ ((  ((MAq\r AÖ A« AòA³½   @ ((E\r   ((  ((Atj) 7 @@ ((  ((IAqE\r ((AtAÿÿq! ((Av! ) ! (( !  A8 k­Bÿ§s!AÐá  Atj!Aÿÿ  / s! ( 6 (!	 	 	( Aj6   ((Aÿÿq!\n Aj$  \nø# Ak! $    6@ (( ((KAqE\r  (( E\r  (! (( ! (! (!  Aj6   Atj) Æ @ (( ((KAqE\r  ((  ((Atj (( ((k ((Aÿÿq Aÿÿq! ( 6 (A 6 Aj$ ù~# A k!   6  7  ((6@@ (( AÀ IAqE\r (( ! A8 k6 (AtAÿÿq! (Av!@@ (AÀ IAqE\r  ) 5Bÿ!B !  §s!AÐá  Atj!Aÿÿ   / s6 (!	 	 	( Aj6   (!\n ( \n6 (A 6 (# Ak!   6 ((AqA FAq)# Ak!   6 ((Aq!A k@# Ak!   6 (( ((kAt ((Atj ((k9# Ak!   6  6 (! ( 6( (A6$+# Ak!   6 (A 6$ (A6(_# Ak! $    6@ (($\r A A« AA£    (((! Aj$  !# Ak!   6 (A6(ú	~~~~# AÀ k! $    68  64  60@ (8A GAq\r Aª A« A¤Að¾   @ (8( A GAq\r A A« A¥Að¾   @ (0A MAq\r AªÀ A« A§Að¾   @ (8(AtAt (0OAq\r Aû A« A¨Að¾   @ (8( (8(MAq\r A° A« A©Að¾   @@ (0\r  (4A 6  A6<@ (8($E\r  (8((AIAqE\r @ (8(( (0IAqE\r  (8A6( A 6< (0! (8!  (( k6(@@ (8( (8(kAt (8(Atj (8(k (0IAqE\r@ (8Ï \r  A 6< @ (8( (8(IAqE\r @ (8(E\r  (8(! AÀ  k6,  (8(  (8(Atj) 7 @@ (8(AÀ IAqE\r  (85!B !B !  7@ (0 (,IAqE\r   (, (0k6@@ (AÀ IAqE\r  )  ) 5§!	A !	 	!\n (4 \n6  (0! (8!   (j6 A6< )  )§!\r (4 \r6  (,!  (0 k60 (8!  (Aj6 (8A 6@ (0E\r  (0! AÀ  k6@@ (0A IAqE\r  (4(  (0t!A ! ! (4 6 @@ (AÀ IAqE\r  (8(  (8(Atj)  5§!A ! ! (4!   ( r6  (0! (8 6 A6<  (8(  (8(Atj) 7@ (0AÀ IAqE\r  )! (0! AÀ  k­§! (4 6  (0! (8 6 A6< )§! (4 6  (8!  (Aj6 A6<@ (8(E\r @ (8( (0j (8(AtMAq\r AÁ¼ A« AïAð¾    (8(  (8(Atj) ! (85! B ! (8(!  AÀ   k (0k­§!! (4 !6  (0!" (8!# # " #(j6 A6< (8(  (8(Atj) !$ (0!% $AÀ  %k­§!& (4 &6  (0!\' (8!( ( \' ((j6 A6< (<!) AÀ j$  )ß~~# A k! $    6@ ((A KAqE\r  (A6, (Å   ((6 ((! ((!  AA  j6 (( ! ((  (Atj! ( (kAt!@ E\r    ü\n   (! (!  ( k6 (A 6  (( ((kAt ((k6@@ (\r  A 6  ((  ((Atj ((j6  ((  ((Atj) 7 @ ((E\r  ((  ((Atj) !	B8!\n 	 \n!B(! 	 !\rBþ!  \r !B! 	 !Bü!  !B! 	 !Bø!     	   	   	 \n 	  ! ((  ((Atj 7  ((0! (! ((4!@  Aj    \r  ) ! ((  ((Atj 7  A 6  ((At ((j (jAjAv6  ((6@@ ( (IAqE\r ((  (Atj) !B8!  !B(!  ! Bþ!!    !!"B!#  #!$Bü!% $ %!&B!\'  \'!(Bø!) " & ( )  ) \'  % #    ! !* ((  (Atj *7   (Aj6   ((At ((j (j6 (Av!+ ( +6 (Aq!, ( ,6 A6 (!- A j$  -Õ# A k! $    6  6  6@@@ (AIAq\r  (! (!  Aj Î \r A 6@@ (A!OAqE\r A ! (Ak!A t!  6 ( (s (k! ( 6  A6 (!	 A j$  	·~~~# A k! $    6  6  6@@@ (A KAqE\r  (! (A k!@  Aj Î \r  A 6@ ( AjA Î \r  A 6 5! ( 7  (!  ) B 7  5! (!	 	  	) 7  (!\n (!@ \n Aj Î \r  A 6 5! ( 7  A6 (!\r A j$  \rÛ~# A k! $    6  6  6@@@ (AIAq\r  (! (!  Aj Ñ \r A 6@@ (AÁ OAqE\r B ! (Ak­!B !  7  ) )  ) }! ( 7  A6 (!	 A j$  	# A k! $    6  6 A 6@@ ( AjAÎ \r  A 6@ ( AjAÎ \r  A 6  (At (r6@ ( AjAÎ \r  A 6  (At (r6@ ( AjAÎ \r  A 6  (At (r6 (! ( 6  A6 (! A j$  Ë\n# A k! $    6  6@ (A GAq\r Aª A« AÊAº¥   @ (( A GAq\r A A« AËAº¥   @@ (A KAqE\r   ((Aq6@ (E\r  (!@@A k (IAqE\r  (!A k! (!  6 (! (!@  Aj Î \r  A 6 (!  ( k6  (Av6@ (A KAqE\r @ ( (Õ \r  A 6  (Aq6@ (A KAqE\r  (!	 (!\n@ 	 Aj \nÎ \r  A 6 A6 (! A j$  ×# Ak! $    6  6@ (A GAq\r Aª A« AëAÛ¥   @ (( A GAq\r A A« AìAÛ¥   @ (Ç \r AøÏ A« AíAÛ¥   @@ (($E\r  (((AIAqE\r @ ((( (AtIAqE\r  (A6( A 6@ (!A !@ E\r  ((A G!@ AqE\r @ ( AÎ \r  A 6  (Aj6@ (A FAqE\r  A6@@ (AOAqE\r@@ (( ((IAqE\r  (!  (Aj6  (Ak6@ (($E\r  (!  ((AÀ k6(@ (Ï \r  A 6 @@ (E\r@ ( AÎ \r  A 6  (Aj6  A6 (! Aj$  ò# A k! $    6  6  6@ (A GAq\r Aª A« AA¦   @ (( A GAq\r A A« AA¦   @ (Ç \r AøÏ A« AA¦   @@ (($E\r  (((AIAqE\r @ ((( (AtIAqE\r  (A6( A 6@ (!A !@ E\r  ((A G!@ AqE\r @ ( AjAÎ \r  A 6 (! (!  Aj6  :    (Aj6@ (A FAqE\r  A6@@ (AOAqE\r@@ (( ((IAqE\r  (( ! (!	 	(!\n 	 \nAj6   \nAtj) 7  ) B8§! ( :   ) B0§! ( :  ) B(§!\r ( \r:  ) B §! ( :  ) B§! ( :  ) B§! ( :  ) B§! ( :  ) §! ( :   (Aj6  (Ak6@ (($E\r  (!  ((AÀ k6(@ (Ï \r  A 6 @@ (E\r@ ( AjAÎ \r  A 6 (! (!  Aj6  :    (Aj6  A6 (! A j$  ~	~~# A0k! $    6(  6$@ ((A GAq\r Aª A« AìAË¤   @ ((( A GAq\r A A« AíAË¤    ($A 6 @@@@ ((( (((IAqE\r@@ (((AÀ IAqE\r  (((  (((Atj)  ((5!B !  7@ )B RAqE\r   )Ø 6  ( ! ($!   ( j6   ( Aj6  ( ! ((!   (j6@ (((AÀ OAqE\r  ((!  (Aj6 ((A 6 A6, (((!	AÀ  	k!\n ($!  \n ( j6  ((!  (Aj6 ((A 6 @ (((At (((KAqE\r   (((At6 (((  (((Atj) !\r (!AÀ  k­!  \rB  ((57@ )B RAqE\r   )Ø 6  ( ! ($!   ( j6   ( Aj6  ( ! ((!   (j6@ (((AÀ IAq\r A¾ A« AAË¤    A6, ( (((k! ($!   ( j6  (! (( 6@ (((AÀ IAq\r A¾ A« AAË¤   @ ((Ï \r  A 6, (,! A0j$  a# Ak! $    7@ )B VAq\r A¿Ã AÅ Aè AÜ½    )y§! Aj$  ¡!^~~~~\n~~~~\n~~~~~~]~~!# !AÐ !  k! $    6H  6D  6@  6< (H!A !  G!	A!\n 	 \nq!@ \r Aª !AÊ¬ !\rA\n!A÷ !  \r     (H! ( !A !  G!A!  q!@ \r A !AÊ¬ !A!A÷ !       (<!A !  I!A!  q!@ \r AÁÀ !AÊ¬ ! A!!A÷ !"    ! "   (<!#A!$ $ #v!%  %6  (D!&  &6 (D!\' (@!(A!) ( )t!* \' *j!+  +6 (<!,@@ ,\r @@ (!- (!. - .I!/A!0 / 0q!1 1E\r (H!2A,!3  3j!4 4!5 2 5× !6@ 6\r A !7  76L (,!8A!9 8 9v!: (,!;A!< ; <q!=A !> > =k!? : ?s!@ (!AA!B A Bj!C  C6 A @6  A!D  D6L (<!EA !F E FK!GA!H G Hq!I@ I\r AÄ !JAÊ¬ !KA#!LA÷ !M J K L M   (H!N N(!O  O68 (H!P P(!Q  Q64 (8!R (4!S R SO!TA!U T Uq!V@@@ VE\r A !W  W6( (H!X X(!YAÀ !Z Z Yk![  [6 (H!\\ \\( !] (8!^A!_ ^ _t!` ] `j!a a) !b (H!c c5!d b d!e  e7A !fA!f@@@@@@@@@@ f  (!g (!h g hI!iA!j i jq!k kE\r )!l lÚ !m  m6$  m6( ((!nAÀ !o n oF!pA!q p qq!r@ rE\r  (!s  s6(@ (8!tA!u t uj!v  v68 (8!w (4!x w xO!yA!z y zq!{@ {E\r  (H!| |( !} (8!~A! ~ t! } j! ) !  7 )! Ú !  6$ ($! ((!  j!  6( ($!AÀ !  F!A!  q! \r  ($! )! ! ­!  !  7 )!B!  !  7 (! ((!  k!A!  k!A?!  q!  6 ((!  6, ((! ( !  K!A!    q!¡@ ¡E\r A !¢  ¢6L\n )!£ (<!¤AÀ !¥ ¥ ¤k!¦ ¦!§ §­!¨ £ ¨!© ©§!ª  ª6( (<!« (!¬ « ¬M!­A!® ­ ®q!¯@@ ¯E\r  (<!° (!± ± °k!²  ²6 (<!³ )!´ ³!µ µ­!¶ ´ ¶!·  ·7 (8!¸A!¹ ¸ ¹j!º  º68 (8!» (4!¼ » ¼O!½A!¾ ½ ¾q!¿@ ¿E\r  (H!À À( !Á (8!ÂA!Ã Â Ãt!Ä Á Äj!Å Å) !Æ  Æ7 (<!ÇAÀ !È È Çk!É (!Ê Ê Éj!Ë  Ë6 )!Ì 5!Í Ì Í!Î Î§!Ï ((!Ð Ð Ïr!Ñ  Ñ6( (!ÒAÀ !Ó Ó Òk!Ô )!Õ Ô!Ö Ö­!× Õ ×!Ø  Ø7 ((!Ù  Ù60 (,!Ú (<!Û Ú Ût!Ü (0!Ý Ü Ýr!Þ  Þ6( ((!ßA!à ß àv!á ((!âA!ã â ãq!äA !å å äk!æ á æs!ç (!èA!é è éj!ê  ê6 è ç6 A !ëA!ì ë ìq!í íE\r (H!îA !ï î ï6 (8!ð (H!ñ ñ ð6 (H!òA,!ó  ój!ô ô!õ ò õ× !ö@ ö\r A !÷  ÷6L ((!ø (,!ù ù øj!ú  ú6,A !û  û6A !ü  ü6(A !ýA!þ ý þq!ÿ ÿE\r (H!A !  6 (8! (H!  6 (H! (<! (!  k!A0!  j! !   Î !@ \r A !  6L ((! (0!  r!  60 (,! (<!  t! (0!  r!  6( ((!A!  v! ((!A!  q!A !  k!  s! (!A!  j!    6  6 A !¡  ¡6( (H!¢ ¢(!£  £68 (H!¤ ¤(!¥  ¥64 (H!¦ ¦(!§AÀ !¨ ¨ §k!©  ©6 (8!ª (H!« «(!¬ ª ¬I!­A!® ­ ®q!¯@@ ¯E\r  (H!° °( !± (8!²A!³ ² ³t!´ ± ´j!µ µ) !¶ (H!· ·5!¸ ¶ ¸!¹ ¹!ºB !» »!º º!¼  ¼7 (8!½ (4!¾ ½ ¾O!¿A !ÀA!Á ¿ Áq!Â À!Ã@ ÂE\r  (!Ä (!Å Ä ÅI!Æ Æ!Ã Ã!ÇA!È Ç Èq!É É\r (!Ê@ Ê\r  (8!Ë (4!Ì Ë ÌI!ÍA!Î Í Îq!Ï ÏE\r  (8!ÐA!Ñ Ð Ñj!Ò  Ò68AÀ !Ó  Ó6 (!ÔAÀ !Õ Õ Ôk!Ö (H!× × Ö6 (8!Ø (H!Ù Ù Ø6A!Ú  Ú6LA !fA!f  (L!ÛAÐ !Ü  Üj!Ý Ý$  Û`# Ak! $    7 @@ ) B RAq\r  AÀ 6  ) Ø 6 (! Aj$  ¼# A k! $    6  6  6  6 A 6@@ ( AjAÎ \r  A 6@ (A GAqE\r  (! (! (! ( !  Aj6   j :  @@ (Aq\r   (6 A 6 @@ (AàqAÀFAqE\r   (Aq6 A6 @@ (AðqAàFAqE\r   (Aq6 A6 @@ (AøqAðFAqE\r   (Aq6 A6 @@ (AüqAøFAqE\r   (Aq6 A6 @@ (AþqAüFAqE\r   (Aq6 A6  (A6  A6@@ ( E\r@ ( AjAÎ \r  A 6@ (A GAqE\r  (!	 (!\n (! ( !  Aj6  \n j 	:  @@ (AqE\r  (AÀ qE\r (A6  A6  (At6  (A?q (r6  ( Aj6   (!\r ( \r6  A6 (! A j$  ë	~# A0k! $    6(  6$  6   6 B 7@@ (( AjAÎ \r  A 6,@ ( A GAqE\r  (! ( ! (! ( !  Aj6   j :  @@ (Aq\r   57 A 6@@ (AàqAÀFAqE\r   (Aq­7 A6@@ (AðqAàFAqE\r   (Aq­7 A6@@ (AøqAðFAqE\r   (Aq­7 A6@@ (AüqAøFAqE\r   (Aq­7 A6@@ (AþqAüFAqE\r   (Aq­7 A6@@ (AþFAqE\r  B 7 A6 ($B7  A6,@@ (E\r@ (( AjAÎ \r  A 6,@ ( A GAqE\r  (!	 ( !\n (! ( !  Aj6  \n j 	:  @@ (AqE\r  (AÀ qE\r ($B7  A6,  )B7  (A?q­ )7  (Aj6  )!\r ($ \r7  A6, (,! A0j$  w# Ak!   6 (AÆº6@ (A×¶þ~6D (Aþ¹ëÅy6H (Aö¨É6L (A 6P (A 6T (A 6X (A 6\\¹# Ak! $    6  6  ((PA?q6  ( (j6  ( !  Aj6  A:   (! A7 k6@ (A HAqE\r  ( ! (Aj!A !@ E\r    ü  (AÀ j (ß   (6  A86 ( ! (!	A !\n@ 	E\r   \n 	ü  ((PAt! ( 68 ((TAt ((PAvr! ( 6< (AÀ j (ß  (!\r (AÀ j! \r ) 7  \r )  7  @ ((XA GAqE\r  ((X¸  (A 6X (A 6\\ (!Aà ! A  ü  Aj$ ¡\'	# A k!   6  6  (( 6  ((6  ((6  ((6  ( ( ( (sqs (( jAøÈª»}j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÖîÆ~j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÛá¡j (j6  (At (Avr (j6  ( ( ( (sqs ((jAî÷|j (j6  (At (A\nvr (j6  ( ( ( (sqs ((jA¯ð«j (j6  (At (Avr (j6  ( ( ( (sqs ((jAª¼j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÁÁzj (j6  (At (Avr (j6  ( ( ( (sqs ((jAªjj (j6  (At (A\nvr (j6  ( ( ( (sqs (( jAØ±Ìj (j6  (At (Avr (j6  ( ( ( (sqs (($jA¯ïÚxj (j6  (At (Avr (j6  ( ( ( (sqs (((jA±·}j (j6  (At (Avr (j6  ( ( ( (sqs ((,jA¾¯óÊxj (j6  (At (A\nvr (j6  ( ( ( (sqs ((0jA¢¢ÀÜj (j6  (At (Avr (j6  ( ( ( (sqs ((4jAãálj (j6  (At (Avr (j6  ( ( ( (sqs ((8jAå³zj (j6  (At (Avr (j6  ( ( ( (sqs ((<jA¡ÐÍj (j6  (At (A\nvr (j6  ( ( ( (sqs ((jAâÊø°j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÀæ|j (j6  (A	t (Avr (j6  ( ( ( (sqs ((,jAÑ´ù²j (j6  (At (Avr (j6  ( ( ( (sqs (( jAªÛÍ~j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÝ ¼±}j (j6  (At (Avr (j6  ( ( ( (sqs (((jAÓ¨j (j6  (A	t (Avr (j6  ( ( ( (sqs ((<jAÍÅ}j (j6  (At (Avr (j6  ( ( ( (sqs ((jAÈ÷Ï¾~j (j6  (At (Avr (j6  ( ( ( (sqs (($jAæj (j6  (At (Avr (j6  ( ( ( (sqs ((8jAÖÜ|j (j6  (A	t (Avr (j6  ( ( ( (sqs ((jAÔ¦j (j6  (At (Avr (j6  ( ( ( (sqs (( jAí©èªj (j6  (At (Avr (j6  ( ( ( (sqs ((4jAÒÏzj (j6  (At (Avr (j6  ( ( ( (sqs ((jAøÇ¾gj (j6  (A	t (Avr (j6  ( ( ( (sqs ((jAÙ¼»j (j6  (At (Avr (j6  ( ( ( (sqs ((0jA©éxj (j6  (At (Avr (j6  ( (s (s ((jAÂòhj (j6  (At (Avr (j6  ( (s (s (( jAíÇ»xj (j6  (At (Avr (j6  ( (s (s ((,jA¢Âõìj (j6  (At (Avr (j6  ( (s (s ((8jAðoj (j6  (At (A	vr (j6  ( (s (s ((jAÄÔû¥zj (j6  (At (Avr (j6  ( (s (s ((jA©ûÞj (j6  (At (Avr (j6  ( (s (s ((jAàíµj (j6  (At (Avr (j6  ( (s (s (((jAðøþõ{j (j6  (At (A	vr (j6  ( (s (s ((4jAÆýíÄj (j6  (At (Avr (j6  ( (s (s (( jAúÏÕ~j (j6  (At (Avr (j6  ( (s (s ((jAá¼§}j (j6  (At (Avr (j6  ( (s (s ((jAº $j (j6  (At (A	vr (j6  ( (s (s (($jA¹ ÓÎ}j (j6  (At (Avr (j6  ( (s (s ((0jAå³î¶~j (j6  (At (Avr (j6  ( (s (s ((<jAøùýj (j6  (At (Avr (j6  ( (s (s ((jAå¬±¥|j (j6  (At (A	vr (j6  ( ( (Asrs (( jAÄÄ¤¡j (j6  (At (Avr (j6  ( ( (Asrs ((jAÿ«j (j6  (A\nt (Avr (j6  ( ( (Asrs ((8jA§ÇÐÜzj (j6  (At (Avr (j6  ( ( (Asrs ((jA¹ÀÎdj (j6  (At (Avr (j6  ( ( (Asrs ((0jAÃ³íªj (j6  (At (Avr (j6  ( ( (Asrs ((jA³øxj (j6  (A\nt (Avr (j6  ( ( (Asrs (((jAýè¿j (j6  (At (Avr (j6  ( ( (Asrs ((jAÑ»¬xj (j6  (At (Avr (j6  ( ( (Asrs (( jAÏü¡ýj (j6  (At (Avr (j6  ( ( (Asrs ((<jAàÍ³qj (j6  (A\nt (Avr (j6  ( ( (Asrs ((jAzj (j6  (At (Avr (j6  ( ( (Asrs ((4jA¡£ ðj (j6  (At (Avr (j6  ( ( (Asrs ((jAýÍºj (j6  (At (Avr (j6  ( ( (Asrs ((,jAµäëé{j (j6  (A\nt (Avr (j6  ( ( (Asrs ((jA»¥ßÖj (j6  (At (Avr (j6  ( ( (Asrs (($jA§Ü~j (j6  (At (Avr (j6 (! (!   ( j6  (! (!   (j6 (! (!   (j6 (!	 (!\n \n 	 \n(j6	# A k! $    6  6  6  6  6  ( (l (l6 (! (!@@ A nKAqE\r  A 6 ( (l! (!	@ A 	nKAqE\r  A 6@ ((\\ (IAqE\r  ((X (á !\n ( \n6X@ \nA FAqE\r  (â ! ( 6X@ A FAqE\r  (A 6\\ A 6 (! ( 6\\ (AØ j ( ( ( (ã  ( ((X (ä  A6 (!\r A j$  \r# Ak! $    6  6  (6  ( (¹ 6 @ (A KAqE\r  ( A FAqE\r  (¸  ( ! Aj$  P# Ak! $    6@ (\r   (Aj6 (¶ ! Aj$  )# A0k!   6,  6(  6$  6   6  (,( 6  (,( 6  (,( 6 (Aä l ($j!@@@@@@@@@@@@@@@@@@@ Aå F\r  Aæ F\r Aè F\r Aê F\r Aì F\r AÉF\r AÊF\r AÌF\r AÎF\r AÐF\r	 A­F\r\n A®F\r AF\r AF\r\r AF\r AF\r AF\r A 6@@ ( ( IAqE\r (((  (Atj( ! (!  Aj6  :    (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !	 (!\n  \nAj6 \n 	:   ((( (Atj( ! (!  Aj6  :    (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !\r (!  Aj6  \r:   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :    (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!  Aj6  :   ((( (Atj( ! (!    Aj6   :    (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !! (!"  "Aj6 " !:   ((( (Atj( !# (!$  $Aj6 $ #:   ((( (Atj( !% (!&  &Aj6 & %:   ((( (Atj( !\' (!(  (Aj6 ( \':   ((( (Atj( !) (!*  *Aj6 * ):   ((( (Atj( !+ (!,  ,Aj6 , +:   ((( (Atj( !- (!.  .Aj6 . -:   ((( (Atj( !/ (!0  0Aj6 0 /:    (Aj6 \r A 6@@ ( ( IAqE\r (((  (Atj( !1 (!2  2Aj6 2 1;   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !3 (!4  4Aj6 4 3;  ((( (Atj( !5 (!6  6Aj6 6 5;   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !7 (!8  8Aj6 8 7;  ((( (Atj( !9 (!:  :Aj6 : 9;  ((( (Atj( !; (!<  <Aj6 < ;;  ((( (Atj( != (!>  >Aj6 > =;   (Aj6 \n A 6@@ ( ( IAqE\r (((  (Atj( !? (!@  @Aj6 @ ?;  ((( (Atj( !A (!B  BAj6 B A;  ((( (Atj( !C (!D  DAj6 D C;  ((( (Atj( !E (!F  FAj6 F E;  ((( (Atj( !G (!H  HAj6 H G;  ((( (Atj( !I (!J  JAj6 J I;   (Aj6 	 A 6@@ ( ( IAqE\r (((  (Atj( !K (!L  LAj6 L K;  ((( (Atj( !M (!N  NAj6 N M;  ((( (Atj( !O (!P  PAj6 P O;  ((( (Atj( !Q (!R  RAj6 R Q;  ((( (Atj( !S (!T  TAj6 T S;  ((( (Atj( !U (!V  VAj6 V U;  ((( (Atj( !W (!X  XAj6 X W;  ((( (Atj( !Y (!Z  ZAj6 Z Y;   (Aj6  A 6@@ ( ( IAqE\r  (((  (Atj( 6 (![ (!\\  \\Aj6 \\ [:    (Au6 (!] (!^  ^Aj6 ^ ]:    (Au6 (!_ (!`  `Aj6 ` _:    (Aj6  A 6@@ ( ( IAqE\r  (((  (Atj( 6 (!a (!b  bAj6 b a:    (Au6 (!c (!d  dAj6 d c:    (Au6 (!e (!f  fAj6 f e:    ((( (Atj( 6 (!g (!h  hAj6 h g:    (Au6 (!i (!j  jAj6 j i:    (Au6 (!k (!l  lAj6 l k:    (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !m (!n  nAj6 n m6   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !o (!p  pAj6 p o6  ((( (Atj( !q (!r  rAj6 r q6   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !s (!t  tAj6 t s6  ((( (Atj( !u (!v  vAj6 v u6  ((( (Atj( !w (!x  xAj6 x w6  ((( (Atj( !y (!z  zAj6 z y6   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( !{ (!|  |Aj6 | {6  ((( (Atj( !} (!~  ~Aj6 ~ }6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6   (Aj6  A 6@@ ( ( IAqE\r (((  (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6  ((( (Atj( ! (!  Aj6  6   (Aj6  (Aj! AK@@@@@   A 6@@ ( ( IAqE\r A 6@@ ( ($IAqE\r (( (Atj(  (Atj( ! (!  Aj6  :    (Aj6   (Aj6  A 6@@ ( ( IAqE\r A 6@@ ( ($IAqE\r (( (Atj(  (Atj( ! (!  Aj6  ;   (Aj6   (Aj6  A 6@@ ( ( IAqE\r A 6@@ ( ($IAqE\r  (( (Atj(  (Atj( 6 (! (!  Aj6  :    (Au6 (! (!  Aj6  :    (Au6 (!  (!¡  ¡Aj6 ¡  :    (Aj6   (Aj6  A 6@@ ( ( IAqE\r A 6@@ ( ($IAqE\r (( (Atj(  (Atj( !¢ (!£  £Aj6 £ ¢6   (Aj6   (Aj6 «# Ak! $    6  6  6  ((P6  (  (j! ( 6P@  ( IAqE\r  (!  (TAj6T ( A?q! AÀ  k6 @@ (  (KAqE\r  (AÀ j! ( ! A  kj!	 (!\n (!@ E\r  	 \n ü\n   (AÀ j! ( !\r A  \rkj! (! ( !@ E\r    ü\n   (AÀ j (ß   (  (j6 ( !  ( k6@@ (AÀ OAqE\r (! (!  ) 87 8  ) 07 0  ) (7 (  )  7    ) 7   ) 7   ) 7   )  7   (AÀ j (ß   (AÀ j6  (AÀ k6  (! (! (!@ E\r    ü\n   Aj$ £~# Ak! $    6 (! A 68B !  70  7(  7   7  7  7  7  (A6@@ ((AK\r  (æ  (A 6  Aj$ !# Ak!   6 (A 6 # Ak! $    6  6@ (A GAq\r A AÐ¦ A2Aï¤     (è 6 (! ( 6  (! Aj$  P# Ak! $    6@ (\r   (Aj6 (¶ ! Aj$  # A k! $    6  6  6@ (A KAq\r AÅÃ AÐ¦ AÇ Aî   @ (A GAq\r AÂ AÐ¦ AÈ Aî   @ (A GAq\r Aþ AÐ¦ AÉ Aî   @ ( (GAq\r AÙ AÐ¦ AÊ Aî   @@ (AÿÿÿÿKAqE\r  A 6  (At Ajç 6@ (A FAqE\r  A 6@ (( A GAqE\r  (( ¸  (! ( 6  (! ( 6  A6 (! A j$  # A k! $    6  6  6@ (A KAq\r AÅÃ AÐ¦ Aä AÆ   @ (A GAq\r AÂ AÐ¦ Aå AÆ   @ (A GAq\r Aþ AÐ¦ Aæ AÆ   @ ( (GAq\r AÙ AÐ¦ Aç AÆ   @@ (AÿÿÿÿKAqE\r  A 6  (At Ajç 6@ (A FAqE\r  A 6@ (( A GAqE\r  (( ¸  (! ( 6  (! ( 6  A6 (! A j$  # A k! $    6  6  6@ (A KAq\r AÅÃ AÐ¦ AA   @ (A GAq\r AÂ AÐ¦ AA   @ (A GAq\r Aþ AÐ¦ AA   @ ( (GAq\r AÙ AÐ¦ AA   @@ (AÿÿÿÿKAqE\r  A 6  (At Ajç 6@ (A FAqE\r  A 6@ (( A GAqE\r  (( ¸  (! ( 6  (! ( 6  A6 (! A j$  # A k! $    6  6  6@ (A KAq\r AÅÃ AÐ¦ AA÷   @ (A GAq\r AÂ AÐ¦ AA÷   @ (A GAq\r Aþ AÐ¦ A A÷   @ ( (GAq\r AÙ AÐ¦ A¡A÷   @@ (AÿÿÿÿKAqE\r  A 6  (At Ajç 6@ (A FAqE\r  A 6@ (( A GAqE\r  (( ¸  (! ( 6  (! ( 6  A6 (! A j$  # A k! $    6  6  6@ (A KAq\r AÅÃ AÐ¦ A½AÑ   @ (A GAq\r AÂ AÐ¦ A¾AÑ   @ (A GAq\r Aþ AÐ¦ A¿AÑ   @ ( (GAq\r AÙ AÐ¦ AÀAÑ   @@ (AÿÿÿÿKAqE\r  A 6  (At Ajç 6@ (A FAqE\r  A 6@ (( A GAqE\r  (( ¸  (! ( 6  (! ( 6  A6 (! A j$  # Ak! $    6  6@@@ (E\r  (\r A¶ 6 (! (!@ A nKAqE\r  A 6  ( (l¶ 6 (! Aj$  á|}|}|}|}|}# A0k! $    6,  6(  6$ A 6  A 6 A 6 A 6 A 6 A 6@@ ( ((HAqE\r@@ (, (Atj( A HAqE\r  (, (Atj( !A  k! (, (Atj( !   ( j6 @@ (, (Atj(  (, (AkAtj( kA HAqE\r  (, (Atj(  (, (AkAtj( k!A  k! (, (Atj(  (, (AkAtj( k!   (j6@@ (, (Atj(  (, (AkAtj( Atk (, (AkAtj( jA HAqE\r  (, (Atj(  (, (AkAtj( Atk (, (AkAtj( j!A  k!	 (, (Atj(  (, (AkAtj( Atk (, (AkAtj( j!	  	 (j6@@ (, (Atj(  (, (AkAtj( Alk (, (AkAtj( Alj (, (AkAtj( kA HAqE\r  (, (Atj(  (, (AkAtj( Alk (, (AkAtj( Alj (, (AkAtj( k!\nA  \nk! (, (Atj(  (, (AkAtj( Alk (, (AkAtj( Alj (, (AkAtj( k!   (j6@@ (, (Atj(  (, (AkAtj( Atk (, (AkAtj( Alj (, (AkAtj( Atk (, (AkAtj( jA HAqE\r  (, (Atj(  (, (AkAtj( Atk (, (AkAtj( Alj (, (AkAtj( Atk (, (AkAtj( j!A  k!\r (, (Atj(  (, (AkAtj( Atk (, (AkAtj( Alj (, (AkAtj( Atk (, (AkAtj( j!\r  \r (j6  (Aj6  ( !@@ ( (IAqE\r  (! (!@@  (IAqE\r @@ ( (IAqE\r  (! (! ! (!@@  (IAqE\r @@ ( (IAqE\r  (! (!@@  (IAqE\r @@ ( (IAqE\r  (! (! ! (! ! (!@@  MAqE\r  A 6 (!@@ ( (IAqE\r  (! (!@@  (IAqE\r @@ ( (IAqE\r  (! (! ! (!@@  MAqE\r  A6 (!@@ ( (IAqE\r  (! (!@@  MAqE\r  A6@@ ( (MAqE\r  A6 A6@ ((A KAq\r  ( E\r AÓÈ A® AA   @ ((A KAq\r  (E\r A°È A® AA   @ ((A KAq\r  (E\r AúÇ A® AA   @ ((A KAq\r  (E\r A×Ç A® AA   @ ((A KAq\r  (E\r A´Ç A® AA   @@ ( A KAqE\r  ( ¸Dï9úþB.æ?¢ ((¸£ù Dï9úþB.æ?£!A ·! ¶! ($ 8 @@ (A KAqE\r  (¸Dï9úþB.æ?¢ ((¸£ù Dï9úþB.æ?£!A ·! ¶! ($ 8@@ (A KAqE\r  (¸Dï9úþB.æ?¢ ((¸£ù Dï9úþB.æ?£! A ·!   ¶!! ($ !8@@ (A KAqE\r  (¸Dï9úþB.æ?¢ ((¸£ù Dï9úþB.æ?£!"A ·!" "¶!# ($ #8@@ (A KAqE\r  (¸Dï9úþB.æ?¢ ((¸£ù Dï9úþB.æ?£!$A ·!$ $¶!% ($ %8 (!& A0j$  &\r~|}|}|}|}|}# AÀ k! $    6<  68  64 B 7( B 7  B 7 B 7 B 7 A 6 @@ (  (8HAqE\r@@ (< ( Atj( A HAqE\r  (< ( Atj( !A  k! (< ( Atj( !  ­ )(|7(@@ (< ( Atj(  (< ( AkAtj( kA HAqE\r  (< ( Atj(  (< ( AkAtj( k!A  k! (< ( Atj(  (< ( AkAtj( k!  ­ ) |7 @@ (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( jA HAqE\r  (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( j!A  k!	 (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( j!	  	­ )|7@@ (< ( Atj(  (< ( AkAtj( Alk (< ( AkAtj( Alj (< ( AkAtj( kA HAqE\r  (< ( Atj(  (< ( AkAtj( Alk (< ( AkAtj( Alj (< ( AkAtj( k!\nA  \nk! (< ( Atj(  (< ( AkAtj( Alk (< ( AkAtj( Alj (< ( AkAtj( k!  ­ )|7@@ (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( Alj (< ( AkAtj( Atk (< ( AkAtj( jA HAqE\r  (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( Alj (< ( AkAtj( Atk (< ( AkAtj( j!A  k!\r (< ( Atj(  (< ( AkAtj( Atk (< ( AkAtj( Alj (< ( AkAtj( Atk (< ( AkAtj( j!\r  \r­ )|7  ( Aj6   )(!@@ )  )TAqE\r  ) ! )!@@  )TAqE\r @@ )  )TAqE\r  ) ! )! ! )!@@  )TAqE\r @@ )  )TAqE\r  ) ! )!@@  )TAqE\r @@ )  )TAqE\r  ) ! )! ! )! ! )!@@  XAqE\r  A 6 ) !@@ ) )TAqE\r  )! )!@@  )TAqE\r @@ ) )TAqE\r  )! )! ! )!@@  XAqE\r  A6 )!@@ ) )TAqE\r  )! )!@@  XAqE\r  A6@@ ) )XAqE\r  A6 A6@ (8A KAq\r  )(B QAq\r AÓÈ A® AÍAµ¢   @ (8A KAq\r  ) B QAq\r A°È A® AÎAµ¢   @ (8A KAq\r  )B QAq\r AúÇ A® AÏAµ¢   @ (8A KAq\r  )B QAq\r A×Ç A® AÐAµ¢   @ (8A KAq\r  )B QAq\r A´Ç A® AÑAµ¢   @@ )(B VAqE\r  )(ºDï9úþB.æ?¢ (8¸£ù Dï9úþB.æ?£!A ·! ¶! (4 8 @@ ) B VAqE\r  ) ºDï9úþB.æ?¢ (8¸£ù Dï9úþB.æ?£!A ·! ¶! (4 8@@ )B VAqE\r  )ºDï9úþB.æ?¢ (8¸£ù Dï9úþB.æ?£! A ·!   ¶!! (4 !8@@ )B VAqE\r  )ºDï9úþB.æ?¢ (8¸£ù Dï9úþB.æ?£!"A ·!" "¶!# (4 #8@@ )B VAqE\r  )ºDï9úþB.æ?¢ (8¸£ù Dï9úþB.æ?£!$A ·!$ $¶!% (4 %8 (!& AÀ j$  &¤\r~|}|}|}|}|}# Ak! $    6  6  6 B 7x B 7p B 7h B 7` B 7X B7P A6$ A6  A6 A6 A6 A 6 A|6@@ ( (HAqE\r@@ ( (Atj4 B SAqE\r  ( (Atj4 !B  }! ( (Atj4 !  7H@@ (A|JAqE\r @@ ( (Atj4  ( (AkAtj4 }B SAqE\r  ( (Atj4  ( (AkAtj4 }!B  }! ( (Atj4  ( (AkAtj4 }! !B !  7@@@ (A}JAqE\r @@ ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 |B SAqE\r  ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 |!	B  	}!\n ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 |!\n \n!B !  78@@ (A~JAqE\r @@ ( (Atj4  ( (AkAtj4 B~} ( (AkAtj4 B~| ( (AkAtj4 }B SAqE\r  ( (Atj4  ( (AkAtj4 B~} ( (AkAtj4 B~| ( (AkAtj4 }!B  }!\r ( (Atj4  ( (AkAtj4 B~} ( (AkAtj4 B~| ( (AkAtj4 }!\r \r!B !  70@@ (AJAqE\r @@ ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 B~| ( (AkAtj4 B} ( (AkAtj4 |B SAqE\r  ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 B~| ( (AkAtj4 B} ( (AkAtj4 |!B  }! ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 B~| ( (AkAtj4 B} ( (AkAtj4 |! !B !  7(  )H )x|7x  )@ )p|7p  )8 )h|7h  )0 )`|7`  )( )X|7X@ )HBÿÿÿÿVAqE\r  A 6$@ )@BÿÿÿÿVAqE\r  A 6 @ )8BÿÿÿÿVAqE\r  A 6@ )0BÿÿÿÿVAqE\r  A 6@ )(BÿÿÿÿVAqE\r  A 6  (Aj6 @@ ($E\r  )x )PTAqE\r  A 6  )x7P@@ )xB VAqE\r  )xºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8  (C  B8 @@ ( E\r  )p )PTAqE\r  A6  )p7P@@ )pB VAqE\r  )pºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )h )PTAqE\r  A6  )h7P@@ )hB VAqE\r  )hºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )` )PTAqE\r  A6  )`7P@@ )`B VAqE\r  )`ºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )X )PTAqE\r  A6  )X7P@@ )XB VAqE\r  )XºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8 (! Aj$  ¤\r~|}|}|}|}|}# Ak! $    6  6  6 B 7x B 7p B 7h B 7` B 7X B7P A6$ A6  A6 A6 A6 A 6 A|6@@ ( (HAqE\r@@ ( (Atj) B SAqE\r  ( (Atj) !B  }! ( (Atj) !  7H@@ (A|JAqE\r @@ ( (Atj)  ( (AkAtj) }B SAqE\r  ( (Atj)  ( (AkAtj) }!B  }! ( (Atj)  ( (AkAtj) }! !B !  7@@@ (A}JAqE\r @@ ( (Atj)  ( (AkAtj) B} ( (AkAtj) |B SAqE\r  ( (Atj)  ( (AkAtj) B} ( (AkAtj) |!	B  	}!\n ( (Atj)  ( (AkAtj) B} ( (AkAtj) |!\n \n!B !  78@@ (A~JAqE\r @@ ( (Atj)  ( (AkAtj) B~} ( (AkAtj) B~| ( (AkAtj) }B SAqE\r  ( (Atj)  ( (AkAtj) B~} ( (AkAtj) B~| ( (AkAtj) }!B  }!\r ( (Atj)  ( (AkAtj) B~} ( (AkAtj) B~| ( (AkAtj) }!\r \r!B !  70@@ (AJAqE\r @@ ( (Atj)  ( (AkAtj) B} ( (AkAtj) B~| ( (AkAtj) B} ( (AkAtj) |B SAqE\r  ( (Atj)  ( (AkAtj) B} ( (AkAtj) B~| ( (AkAtj) B} ( (AkAtj) |!B  }! ( (Atj)  ( (AkAtj) B} ( (AkAtj) B~| ( (AkAtj) B} ( (AkAtj) |! !B !  7(  )H )x|7x  )@ )p|7p  )8 )h|7h  )0 )`|7`  )( )X|7X@ )HBÿÿÿÿVAqE\r  A 6$@ )@BÿÿÿÿVAqE\r  A 6 @ )8BÿÿÿÿVAqE\r  A 6@ )0BÿÿÿÿVAqE\r  A 6@ )(BÿÿÿÿVAqE\r  A 6  (Aj6 @@ ($E\r  )x )PTAqE\r  A 6  )x7P@@ )xB VAqE\r  )xºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8  (C  B8 @@ ( E\r  )p )PTAqE\r  A6  )p7P@@ )pB VAqE\r  )pºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )h )PTAqE\r  A6  )h7P@@ )hB VAqE\r  )hºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )` )PTAqE\r  A6  )`7P@@ )`B VAqE\r  )`ºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8@@ (E\r  )X )PTAqE\r  A6  )X7P@@ )XB VAqE\r  )XºDï9úþB.æ?¢ (¸£ù Dï9úþB.æ?£!A ·! ¶! ( 8 (C  B8 (! Aj$  õ	# A k! $    6  6  6  6  (6 (! AK@@@@@@@   (! (! (At!@ E\r    ü\n   A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( k!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Atk ( (AkAtj( j!\n ( (Atj \n6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Alk ( (AkAtj( Alj ( (AkAtj( k! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Atk ( (AkAtj( Alj ( (AkAtj( Atk ( (AkAtj( j! ( (Atj 6   (Aj6 AÊ A® AñAÞ    A j$ ù	# A k! $    6  6  6  6  (6 (! AK@@@@@@@   (! (! (At!@ E\r    ü\n   A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 }§!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 |§!\n ( (Atj \n6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B~} ( (AkAtj4 B~| ( (AkAtj4 }§! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B} ( (AkAtj4 B~| ( (AkAtj4 B} ( (AkAtj4 |§! ( (Atj 6   (Aj6 AÊ A® AAÝ¢    A j$ £# A k! $    6  6  6  6  (6 (! AK@@@@@@@   A 6@@ ( (HAqE\r ( (Atj) §! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj)  ( (AkAtj) }§! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj)  ( (AkAtj) B} ( (AkAtj) |§! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj)  ( (AkAtj) B~} ( (AkAtj) B~| ( (AkAtj) }§!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r ( (Atj)  ( (AkAtj) B} ( (AkAtj) B~| ( (AkAtj) B} ( (AkAtj) |§!\n ( (Atj \n6   (Aj6 AÊ A® A¯A    A j$ õ	# A k! $    6  6  6  6  (6 (! AK@@@@@@@   (! (! (At!@ E\r    ü\n   A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( j!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Atj ( (AkAtj( k!\n ( (Atj \n6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Alj ( (AkAtj( Alk ( (AkAtj( j! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ( (AkAtj( Atj ( (AkAtj( Alk ( (AkAtj( Atj ( (AkAtj( k! ( (Atj 6   (Aj6 AÊ A® AÕAû    A j$ ù	# A k! $    6  6  6  6  (6 (! AK@@@@@@@   (! (! (At!@ E\r    ü\n   A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 |§!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B| ( (AkAtj4 }§!\n ( (Atj \n6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B~| ( (AkAtj4 B~} ( (AkAtj4 |§! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj4 B| ( (AkAtj4 B~} ( (AkAtj4 B| ( (AkAtj4 }§! ( (Atj 6   (Aj6 AÊ A® AóAÿ¢    A j$  ~# A k! $    6  6  6  6  (6 (! AK@@@@@@@   A 6@@ ( (HAqE\r ( (Atj4 ! ( (Atj 7   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj) |! ( (Atj 7   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj) B| ( (AkAtj) }! ( (Atj 7   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj) B~| ( (AkAtj) B~} ( (AkAtj) |!	 ( (Atj 	7   (Aj6  A 6@@ ( (HAqE\r ( (Atj4  ( (AkAtj) B| ( (AkAtj) B~} ( (AkAtj) B| ( (AkAtj) }!\n ( (Atj \n7   (Aj6 AÊ A® AA¯    A j$ ¶~# Ak! $    7 @@ ) B QAqE\r  A 6@ ) BQAqE\r  A6@@ ) B SAqE\r  ) B|!B  }! ) !  7   ) ú Aj6 (! Aj$  d# Ak! $    7@ )B VAq\r A¿Ã AÅ A®A½£    )y§A?s! Aj$  }# A k!   6  6  6  6 A 6@@ ( (IAqE\r ( (Atj( ² ( (Atj* ! ( (Atj 8   (Aj6 }# A k!   6  6  6  6 A 6@@ ( (IAqE\r ( (Atj) ´ ( (Atj* ! ( (Atj 8   (Aj6 ¶}}# A k!   6  6  6  6  6  6@ ( (j (IAqE\r  A 6@@ ( (IAqE\r ( ( (jAtj( ² ( (Atj* ! ( (Atj 8   (Aj6 @@ ( ( (k (kIAqE\r  (! ( (k (k!  6  ( (k6 @@ (  (IAqE\r ( ( (jAtj( ² ( ( Atj* !	 ( (Atj 	8   (Aj6  ( Aj6  @ ( (IAqE\r  ( (AtjA ²8 ¶}}# A k!   6  6  6  6  6  6@ ( (j (IAqE\r  A 6@@ ( (IAqE\r ( ( (jAtj) ´ ( (Atj* ! ( (Atj 8   (Aj6 @@ ( ( (k (kIAqE\r  (! ( (k (k!  6  ( (k6 @@ (  (IAqE\r ( ( (jAtj) ´ ( ( Atj* !	 ( (Atj 	8   (Aj6  ( Aj6  @ ( (IAqE\r  ( (AtjA ²8 ||||||||# AÀ k! $    6<  68  64  60@@@ (8A IAq\r  (4AKAqE\r  (8 (4k6@ (4A KAq\r AÀÄ AÊ® AA´   @ (4 (8MAq\r A¤ AÊ® AA´    A 6 @@ (  (4IAqE\r (0 ( AtjA ·9   ( Aj6   A 6$@@ ($ (MAqE\r  (< ($Atj* »9( A 6 @@ (  (4IAqE\r +(! (< ($ ( jAtj* »! (0 ( Atj!  +   ¢ 9   ( Aj6    ($Aj6$ @@ ($ (8IAqE\r  (< ($Atj* »9( A 6 @@ (  (8 ($kIAqE\r +(! (< ($ ( jAtj* »!	 (0 ( Atj!\n \n \n+   	¢ 9   ( Aj6    ($Aj6$ @@ (4AMAqE\r @ (4AMAq\r Aé¼ AÝ« AA´    A 6@@ (AHAqE\r (0 (AtjA ·9   (Aj6  A 6@@ (AHAqE\r A 6@@ ( (LAqE\r (<! (!A!\r   \rtj* »!   (k \rtj* »! (0 (Atj!  +   ¢ 9   (Aj6   (Aj6  A6@@ ( (8HAqE\r A 6@@ (AHAqE\r (<! (!A!   tj* »!   (k tj* »! (0 (Atj!  +   ¢ 9   (Aj6   (Aj6 @@ (4AMAqE\r @ (4AMAq\r AÐÀ AÝ« AA´    A 6@@ (AHAqE\r (0 (AtjA ·9   (Aj6  A 6@@ (AHAqE\r A 6@@ ( (LAqE\r (<! (!A!   tj* »!   (k tj* »! (0 (Atj!  +   ¢ 9   (Aj6   (Aj6  A6@@ ( (8HAqE\r A 6@@ (AHAqE\r (<! (!A!   tj* »!    (k tj* »!! (0 (Atj!" " "+    !¢ 9   (Aj6   (Aj6 @ (4AMAqE\r @ (4AMAq\r AÒ½ AÝ« AA´    A 6@@ (AHAqE\r (0 (AtjA ·9   (Aj6  A 6@@ (AHAqE\r A 6@@ ( (LAqE\r (<!# (!$A!% # $ %tj* »!& # $ (k %tj* »!\' (0 (Atj!( ( (+  & \'¢ 9   (Aj6   (Aj6  A6@@ ( (8HAqE\r A 6@@ (AHAqE\r (<!) (!*A!+ ) * +tj* »!, ) * (k +tj* »!- (0 (Atj!. . .+  , -¢ 9   (Aj6   (Aj6  AÀ j$ ½||||||}|# AÀk! $    6¼  6¸  6´  6°@ (¸A GAq\r A¼ AÊ® AµA    (¸( !@A  IAq\r A­ AÊ® A¶A   @ (¸( A MAq\r AÍ AÊ® A·A   @ (¼+ A ·bAq\r AÃ AÊ® A¸A     (¼+ 9 A 6¬@@ (¬ (¸( IAqE\r  (¼ (¬AjAtj+ 9  A 6¨@@ (¨ (¬IAqE\r (¨! Aj Atj+ ! (¼ (¬ (¨kAtj+ !  +   ¢ 9   (¨Aj6¨  +!	  +  	£9  + !\n (¬! Aj Atj \n9  A 6¨@@ (¨ (¬AvIAqE\r (¨!  Aj Atj+ 9 + !\r (¬Ak (¨k! Aj Atj+ ! (¨! Aj Atj!  +  \r ¢ 9  + ! +! (¬Ak (¨k! Aj Atj!  +   ¢ 9   (¨Aj6¨ @ (¬AqE\r  (¨! Aj Atj+ ! + ! (¨! Aj Atj!  +   ¢ 9  + !  +  ¢D      ð?  +¢9 A 6¨@@ (¨ (¬MAqE\r (¨At Ajj+ ¶! (´ (¬Atj (¨Atj 8   (¨Aj6¨  +! (° (¬Atj 9 @ +A ·aAqE\r  (¬Aj! (¸ 6   (¬Aj6¬  AÀj$ 		}|}|# Ak! $    6x  6t  6p  6l  6h@ (pA KAq\r A²Ä AÊ® AâA¶   @ (pAOAq\r AçÌ AÊ® AãA¶     (pAj6p (p! A t6T (T! A  k6P  (TAj6T A ·9X A 6d@@ (d (tIAqE\r  (x (dAtj* »9H@ +H +XdAqE\r   +H9X  (dAj6d @@ +XA ·eAqE\r  A6|A (Ô Ak! A tAk6D (D!	 A  	kAk6@ +X A<jå   (<Aj6< (p (<kAk!\n (h \n6 @@ (h(  (DJAqE\r  (D! (h 6 @ (h(  (@HAqE\r  A6|@@ (h( A NAqE\r  A ·90 A 6d@@ (d (tIAqE\r (x (dAtj* ! (h( !\r  A \rt²» +0 90  +0û 6,@@ (, (TJAqE\r   (T6,@ (, (PHAqE\r   (P6, (,·!  +0 ¡90 (,! (l (dAtj 6   (dAj6d  (h( ! A  k6( A ·9 A (Ð ! (h( ! (t!  +X9  6  6  AêÞ  á  A 6d@@ (d (tIAqE\r (x (dAtj* ! ((!  A t²» +  9   + û 6@@ ( (TJAqE\r   (T6@ ( (PHAqE\r   (P6 (·!  +  ¡9  (! (l (dAtj 6   (dAj6d  (hA 6  A 6| (|! Aj$  Ü0# A k! $    6  6  6  6  6  6@ (A KAq\r AÄ AÊ® AìAã   @ (A MAq\r AµÀ AÊ® AíAã   @@ (AMAqE\r @@ (AKAqE\r @@ (A\nKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   ((, ( (AkAtj( l ( j6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6 @@ (A\nFAqE\r  A 6@@ ( (HAqE\r A 6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r A 6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk!\n ( (Atj \n6   (Aj6 @@ (AKAqE\r @@ (AKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6 @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk!\r ( (Atj \r6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6 @@ (AKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6 @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ((  ( (AkAtj( l (uk! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6  (Asj! AK@@@@@@@@@@@@@@@@@@@@@ \r\n	   ((| ( (A kAtj( l ( j6   ((x ( (AkAtj( l ( j6   ((t ( (AkAtj( l ( j6   ((p ( (AkAtj( l ( j6   ((l ( (AkAtj( l ( j6   ((h ( (AkAtj( l ( j6   ((d ( (AkAtj( l ( j6   ((` ( (AkAtj( l ( j6   ((\\ ( (AkAtj( l ( j6   ((X ( (AkAtj( l ( j6   ((T ( (AkAtj( l ( j6   ((P ( (AkAtj( l ( j6   ((L ( (AkAtj( l ( j6   ((H ( (AkAtj( l ( j6   ((D ( (AkAtj( l ( j6   ((@ ( (AkAtj( l ( j6   ((< ( (AkAtj( l ( j6   ((8 ( (AkAtj( l ( j6   ((4 ( (AkAtj( l ( j6   ((0 ( (A\rkAtj( l ( j6   ((, ( (AkAtj( l ( j6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uk! ( (Atj 6   (Aj6  A j$ é0# A0k! $    6,  6(  6$  6   6  6@ ( A KAq\r AÄ AÊ® AæAÿ¡   @ ( A MAq\r AµÀ AÊ® AçAÿ¡   @@ ( AMAqE\r @@ ( AKAqE\r @@ ( A\nKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4, (, (AkAtj4 ~ )|7  ($4( (, (AkAtj4 ~ )|7  ($4$ (, (A\nkAtj4 ~ )|7  ($4  (, (A	kAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4( (, (AkAtj4 ~ )|7  ($4$ (, (A\nkAtj4 ~ )|7  ($4  (, (A	kAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6 @@ ( A\nFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4$ (, (A\nkAtj4 ~ )|7  ($4  (, (A	kAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§!	 ( (Atj 	6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4  (, (A	kAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§!\n ( (Atj \n6   (Aj6 @@ ( AKAqE\r @@ ( AKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6 @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§!\r ( (Atj \r6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6 @@ ( AKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6 @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r (, (Atj4  ($4  (, (AkAtj4 ~ 5}§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7 ( Asj! AK@@@@@@@@@@@@@@@@@@@@@ \r\n	   ($4| (, (A kAtj4 ~ )|7  ($4x (, (AkAtj4 ~ )|7  ($4t (, (AkAtj4 ~ )|7  ($4p (, (AkAtj4 ~ )|7  ($4l (, (AkAtj4 ~ )|7  ($4h (, (AkAtj4 ~ )|7  ($4d (, (AkAtj4 ~ )|7  ($4` (, (AkAtj4 ~ )|7  ($4\\ (, (AkAtj4 ~ )|7  ($4X (, (AkAtj4 ~ )|7  ($4T (, (AkAtj4 ~ )|7  ($4P (, (AkAtj4 ~ )|7  ($4L (, (AkAtj4 ~ )|7  ($4H (, (AkAtj4 ~ )|7  ($4D (, (AkAtj4 ~ )|7  ($4@ (, (AkAtj4 ~ )|7  ($4< (, (AkAtj4 ~ )|7  ($48 (, (AkAtj4 ~ )|7  ($44 (, (AkAtj4 ~ )|7  ($40 (, (A\rkAtj4 ~ )|7  ($4, (, (AkAtj4 ~ )|7  ($4( (, (AkAtj4 ~ )|7  ($4$ (, (A\nkAtj4 ~ )|7  ($4  (, (A	kAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4 (, (AkAtj4 ~ )|7  ($4  (, (AkAtj4 ~ )|7 (, (Atj4  ) 5}§! ( (Atj 6   (Aj6  A0j$ ó\r# A0k! $    6(  6$  6   6  6  6@ (A KAq\r AÄ AÊ® AÅA   @ (A MAq\r AµÀ AÊ® AÆA    A 6@@@ ( ($HAqE\r B 7 (Aj! AK@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  \r\n	    ( 4| (( (A kAtj4 ~ )|7  ( 4x (( (AkAtj4 ~ )|7  ( 4t (( (AkAtj4 ~ )|7  ( 4p (( (AkAtj4 ~ )|7  ( 4l (( (AkAtj4 ~ )|7  ( 4h (( (AkAtj4 ~ )|7  ( 4d (( (AkAtj4 ~ )|7  ( 4` (( (AkAtj4 ~ )|7  ( 4\\ (( (AkAtj4 ~ )|7  ( 4X (( (AkAtj4 ~ )|7  ( 4T (( (AkAtj4 ~ )|7  ( 4P (( (AkAtj4 ~ )|7  ( 4L (( (AkAtj4 ~ )|7  ( 4H (( (AkAtj4 ~ )|7  ( 4D (( (AkAtj4 ~ )|7  ( 4@ (( (AkAtj4 ~ )|7  ( 4< (( (AkAtj4 ~ )|7  ( 48 (( (AkAtj4 ~ )|7  ( 44 (( (AkAtj4 ~ )|7  ( 40 (( (A\rkAtj4 ~ )|7  ( 4, (( (AkAtj4 ~ )|7  ( 4( (( (AkAtj4 ~ )|7  ( 4$ (( (A\nkAtj4 ~ )|7  ( 4  (( (A	kAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4 (( (AkAtj4 ~ )|7  ( 4  (( (AkAtj4 ~ )|7  (( (Atj4  ) 5}7 @@ ) BxWAq\r  ) BÿÿÿÿUAqE\r A 6, ) §! ( (Atj 6   (Aj6  A6, (,!	 A0j$  	ó\r# A0k! $    6(  6$  6   6  6  6@ (A KAq\r AÄ AÊ® AûAÁ   @ (A MAq\r AµÀ AÊ® AüAÁ    A 6@@@ ( ($HAqE\r B 7 (Aj! AK@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  \r\n	    ( 4| (( (A kAtj) ~ )|7  ( 4x (( (AkAtj) ~ )|7  ( 4t (( (AkAtj) ~ )|7  ( 4p (( (AkAtj) ~ )|7  ( 4l (( (AkAtj) ~ )|7  ( 4h (( (AkAtj) ~ )|7  ( 4d (( (AkAtj) ~ )|7  ( 4` (( (AkAtj) ~ )|7  ( 4\\ (( (AkAtj) ~ )|7  ( 4X (( (AkAtj) ~ )|7  ( 4T (( (AkAtj) ~ )|7  ( 4P (( (AkAtj) ~ )|7  ( 4L (( (AkAtj) ~ )|7  ( 4H (( (AkAtj) ~ )|7  ( 4D (( (AkAtj) ~ )|7  ( 4@ (( (AkAtj) ~ )|7  ( 4< (( (AkAtj) ~ )|7  ( 48 (( (AkAtj) ~ )|7  ( 44 (( (AkAtj) ~ )|7  ( 40 (( (A\rkAtj) ~ )|7  ( 4, (( (AkAtj) ~ )|7  ( 4( (( (AkAtj) ~ )|7  ( 4$ (( (A\nkAtj) ~ )|7  ( 4  (( (A	kAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4 (( (AkAtj) ~ )|7  ( 4  (( (AkAtj) ~ )|7  (( (Atj)  ) 5}7 @@ ) BxWAq\r  ) BÿÿÿÿUAqE\r A 6, ) §! ( (Atj 6   (Aj6  A6, (,!	 A0j$  	ª~# A k!   6  6  6 (Ak­! B 7 A 6 A 6 @@ (  (IAqE\r ( ( Atj( ! Au!   s k (j6  ( Aj6   ) 5~W# Ak! $    6  6  6 ( ( ( ù ! Aj$  ~# A0k! $    6,  6(  6$  6  (,Ak­! B 7  (, (( ($ B~ 5 B~7  ) )|7 )ù ! A0j$  Ü0# A k! $    6  6  6  6  6  6@ (A KAq\r AÄ AÊ® AÿA   @ (A MAq\r AµÀ AÊ® AA   @@ (AMAqE\r @@ (AKAqE\r @@ (A\nKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   ((, ( (AkAtj( l ( j6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6 @@ (A\nFAqE\r  A 6@@ ( (HAqE\r A 6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj!	 ( (Atj 	6   (Aj6  A 6@@ ( (HAqE\r A 6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj!\n ( (Atj \n6   (Aj6 @@ (AKAqE\r @@ (AKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6 @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj!\r ( (Atj \r6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6 @@ (AKAqE\r @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6 @@ (AFAqE\r  A 6@@ ( (HAqE\r A 6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r ( (Atj(  ((  ( (AkAtj( l (uj! ( (Atj 6   (Aj6  A 6@@ ( (HAqE\r A 6  (Asj! AK@@@@@@@@@@@@@@@@@@@@@ \r\n	   ((| ( (A kAtj( l ( j6   ((x ( (AkAtj( l ( j6   ((t ( (AkAtj( l ( j6   ((p ( (AkAtj( l ( j6   ((l ( (AkAtj( l ( j6   ((h ( (AkAtj( l ( j6   ((d ( (AkAtj( l ( j6   ((` ( (AkAtj( l ( j6   ((\\ ( (AkAtj( l ( j6   ((X ( (AkAtj( l ( j6   ((T ( (AkAtj( l ( j6   ((P ( (AkAtj( l ( j6   ((L ( (AkAtj( l ( j6   ((H ( (AkAtj( l ( j6   ((D ( (AkAtj( l ( j6   ((@ ( (AkAtj( l ( j6   ((< ( (AkAtj( l ( j6   ((8 ( (AkAtj( l ( j6   ((4 ( (AkAtj( l ( j6   ((0 ( (A\rkAtj( l ( j6   ((, ( (AkAtj( l ( j6   ((( ( (AkAtj( l ( j6   (($ ( (A\nkAtj( l ( j6   ((  ( (A	kAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   (( ( (AkAtj( l ( j6   ((  ( (AkAtj( l ( j6  ( (Atj(  (  (uj! ( (Atj 6   (Aj6  A j$ é0# A0k! $    6,  6(  6$  6   6  6@ ( A KAq\r AÄ AÊ® Aû	A£   @ ( A MAq\r AµÀ AÊ® Aü	A£   @@ ( AMAqE\r @@ ( AKAqE\r @@ ( A\nKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4, ( (AkAtj4 ~ )|7  ($4( ( (AkAtj4 ~ )|7  ($4$ ( (A\nkAtj4 ~ )|7  ($4  ( (A	kAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4( ( (AkAtj4 ~ )|7  ($4$ ( (A\nkAtj4 ~ )|7  ($4  ( (A	kAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6 @@ ( A\nFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4$ ( (A\nkAtj4 ~ )|7  ($4  ( (A	kAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§!	 ( (Atj 	6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4  ( (A	kAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§!\n ( (Atj \n6   (Aj6 @@ ( AKAqE\r @@ ( AKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6 @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§!\r ( (Atj \r6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6 @@ ( AKAqE\r @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6 @@ ( AFAqE\r  A 6@@ ( ((HAqE\r B 7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r (, (Atj4  ($4  ( (AkAtj4 ~ 5|§! ( (Atj 6   (Aj6  A 6@@ ( ((HAqE\r B 7 ( Asj! AK@@@@@@@@@@@@@@@@@@@@@ \r\n	   ($4| ( (A kAtj4 ~ )|7  ($4x ( (AkAtj4 ~ )|7  ($4t ( (AkAtj4 ~ )|7  ($4p ( (AkAtj4 ~ )|7  ($4l ( (AkAtj4 ~ )|7  ($4h ( (AkAtj4 ~ )|7  ($4d ( (AkAtj4 ~ )|7  ($4` ( (AkAtj4 ~ )|7  ($4\\ ( (AkAtj4 ~ )|7  ($4X ( (AkAtj4 ~ )|7  ($4T ( (AkAtj4 ~ )|7  ($4P ( (AkAtj4 ~ )|7  ($4L ( (AkAtj4 ~ )|7  ($4H ( (AkAtj4 ~ )|7  ($4D ( (AkAtj4 ~ )|7  ($4@ ( (AkAtj4 ~ )|7  ($4< ( (AkAtj4 ~ )|7  ($48 ( (AkAtj4 ~ )|7  ($44 ( (AkAtj4 ~ )|7  ($40 ( (A\rkAtj4 ~ )|7  ($4, ( (AkAtj4 ~ )|7  ($4( ( (AkAtj4 ~ )|7  ($4$ ( (A\nkAtj4 ~ )|7  ($4  ( (A	kAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4 ( (AkAtj4 ~ )|7  ($4  ( (AkAtj4 ~ )|7 (, (Atj4  ) 5|§! ( (Atj 6   (Aj6  A0j$ ¥\r~# A0k! $    6,  6(  6$  6   6  6@ ( A KAq\r AÄ AÊ® AúAÕ   @ ( A MAq\r AµÀ AÊ® AûAÕ    A 6@@ ( ((HAqE\r B 7 ( Aj! AK@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@  \r\n	    ($4| ( (A kAtj) ~ )|7  ($4x ( (AkAtj) ~ )|7  ($4t ( (AkAtj) ~ )|7  ($4p ( (AkAtj) ~ )|7  ($4l ( (AkAtj) ~ )|7  ($4h ( (AkAtj) ~ )|7  ($4d ( (AkAtj) ~ )|7  ($4` ( (AkAtj) ~ )|7  ($4\\ ( (AkAtj) ~ )|7  ($4X ( (AkAtj) ~ )|7  ($4T ( (AkAtj) ~ )|7  ($4P ( (AkAtj) ~ )|7  ($4L ( (AkAtj) ~ )|7  ($4H ( (AkAtj) ~ )|7  ($4D ( (AkAtj) ~ )|7  ($4@ ( (AkAtj) ~ )|7  ($4< ( (AkAtj) ~ )|7  ($48 ( (AkAtj) ~ )|7  ($44 ( (AkAtj) ~ )|7  ($40 ( (A\rkAtj) ~ )|7  ($4, ( (AkAtj) ~ )|7  ($4( ( (AkAtj) ~ )|7  ($4$ ( (A\nkAtj) ~ )|7  ($4  ( (A	kAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4 ( (AkAtj) ~ )|7  ($4  ( (AkAtj) ~ )|7 (, (Atj4  ) 5|! ( (Atj 7   (Aj6  A0j$ |# A k! $    9  6@ (A KAq\r AúÃ AÊ® A°AÚ     (¸! D      à? £9 + + ! A j$  Í|# A k! $    9  9@@ +A ·dAqE\r   + +¢ù D      à?¢Dï9úþB.æ?£9 @ + A ·fAqE\r   + 9 A ·9@ +A ·cAqE\r  Dnµµ¸F9 A ·9 +! A j$  ||# AÀ k! $    6<  68  64  60@ (8A KAq\r AÄ AÊ® AÍAË   @ (4A KAq\r AúÃ AÊ® AÎAË    (4¸! D      à? £9 A 6$ D  àÿÿÿïA9 A 6( A6,@@ (( (8IAqE\r (< ((Atj+  + ! (4! (,!  k¸!	   (0l¸  	¢ 9@ + +cAqE\r   ((6$  +9  ((Aj6(  (,Aj6,  ($Aj!\n AÀ j$  \nï# Ak!   $   AA 6@@  (A FAqE\r   A 6AAØ !  ( 6 @  (( A FAqE\r   (¸   A 6AAèÁ  !  ( 6@  ((A FAqE\r   (( ¸   (¸   A 6¼ !  (( 6,@  (((,A FAqE\r   ((¸   (( ¸   (¸   A 6  ((A6àA (ü Av  (((àl¶ !  (( 6Ø@ A FAqE\r   (((,½   ((¸   (( ¸   (¸   A 6  A 6@@  (AIAqE\r  ((A0j  (AtjA 6   ((AÐ j  (AtjA 6   ((AÜ$j  (AtjA 6     (Aj6   ((A 6p  ((A 6Ø  ((A 6Ü  ((A 6ô  A 6@@  (AIAqE\r  ((Aø j  (Alj     (Aj6   ((A 6(  (   (( A	6     (6  (!  Aj$  v# Ak! $    6  6@@@ (E\r  (\r A¶ 6  ( (¼ 6 (! Aj$  # Ak! $    6 ((A 6  ((A 6 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6  ((A 6$ ((AØj!A! A  ü  ((A6Ø ((A 6Ü (( A 6 (( A j  Aj$ # Ak! $    6 A 6@ (A GAq\r A AÌª AëA½   @ ((A GAq\r A»³ AÌª AìA½   @ (( A GAq\r A¶ AÌª AíA½   @@ (( ( A	FAqE\r  A6 ((Aì%j ((A%jÞ  (((¼¸  ((A 6¼ ((A 6ô (((,¾  A 6 @@ ( AIAqE\r@ ((A0j ( Atj( A GAqE\r  ((A0j ( Atj( Apj¸  ((A0j ( AtjA 6 @ ((AÜ$j ( Atj( A GAqE\r  ((AÜ$j ( Atj( ¸  ((AÐ j ( AtjA 6  ((AÜ$j ( AtjA 6   ( Aj6  @ (((pA GAqE\r  (((p¸  ((A 6p ((A 6Ø ((A 6Ü@ ((( E\r  (( A j @ ((((A GAqE\r @ ((((A (Ô GAqE\r  ((((×  ((A 6(@ (((ü$E\r @ ((AøjAjA(j ((Aì%jAþ E\r  A6 ((A 6% ((A 6% (  (( A	6   (A GAsAq6 (! Aj$  §# A0k!\n \n$  \n  6, \n 6( \n 6$ \n 6  \n 6 \n 6 \n 6 \n 6 \n 6 \n 	6 \n(, \n(( \n($ \n(  \n( \n( \n( \n( \n( \n(A  ! \nA0j$  Ï# A0k! $    6(  6$  6   6  6  6  6  6  6  	6  \n6 @ ((A GAq\r A AÌª AîAá²   @@ ((( ( A	GAqE\r  A6,@@ ($A FAq\r  (A FAq\r  (A FAq\r  ( A GAqE\r (A FAq\r  (A FAq\r  (A FAqE\r A6, ( ! ((( 6 @ ( E\r  ((( A j \r  ((( A j  ((( A6 A6, (((A$jå  (((A 6ØA ((((,!\r ((!@ \rA  ¿ \r  ((( A6  A6, ($! ((( 6 ( ! ((( 6 (! ((( 6 (! ((( 6 (! ((( 6 (! ((( 6 (! ((( 6 (! ((( 6  (! ((( 6$ (((A 6ä (((A 6à (((B 7è (((A 6ð (((A 6$ ((( (! ((( 6ü$ (((A 6% (((A 6% (((A6%@ (( \r  A6, A 6, (,! A0j$  Ã# A k! $    6  6  6  (6@@ ((( \r  (((A GAqE\r  (((! ( ((($   E\r  (A 6  (( A6  A 6@ (( A KAqE\r @ (((%E\r  (((ÐAAKAqE\r  (( A6  A 6@@ ((( E\r  ( ( (² ! (((! ( ( ( ((($   !  6@ (AFAqE\r @ (((àAE\r  (( A6  A 6 (( A6  A 6@ (( \r @ (AFAqE\r @@ (((,Ç E\r  (( A\n6  (( A6  A 6@@ (AFAq\r  ((( \r (((A GAqE\r (((! ( ((($   E\r (( A6  A 6 A6 A6 (( A6  A 6 (! A j$  ¢# Ak! $    6@ (A GAq\r A AÌª AêAù   @ ((A GAq\r A»³ AÌª AëAù   @ (( A GAq\r A¶ AÌª AìAù   @@ ( \r  A 6@ ((( E\r  (( A j @ (((%\r @ ((((A (Ô FAqE\r  A 6@ (((A GAqE\r  (((! (! ((($! B     AFAqE\r  A 6 (  A6 (! Aj$  »# Ak! $    6  6  6 @@@ (E\r  ( \r  (A ¹ 6 (! ( !@ A nKAqE\r  (¸  A 6  ( ( ( l 6 (! Aj$  # Ak! $    6  6  (6  ( (¹ 6 @ (A KAqE\r  ( A FAqE\r  (¸  ( ! Aj$  # Ak! $    6@ (A GAq\r A AÌª AÀAí   @ (( A GAq\r A¶ AÌª AÁAí    (( ( ! Aj$  Á~# Ak! $    6  6@ (A GAq\r A AÌª AAØ   @ ((A GAq\r A»³ AÌª AAØ   @ (A GAq\r A AÌª AAØ   @@ ((( E\r  A 6@ (((A FAqE\r  A 6 (((!@ ( ( ((($   E\r  A 6@ (((,Ç \r  A 6@ ()  ( ­ZAq\r A²Ï AÌª AAØ    ( ­! (!  )  }7  A6 (! Aj$  Ö# Ak! $    6@ (A GAq\r A AÌª AïA¥   @ (((,Ç \r AÍ AÌª AðA¥   @ (((,É AqE\r A¹Ú AÌª AñA¥    (((,É Av! Aj$  ¨# Ak! $    6@ (A GAq\r A AÌª A£A   @ ((A GAq\r A»³ AÌª A¤A   @ (( A GAq\r A¶ AÌª A¥A   @@ (((%\r  (( ( A	FAqE\r  A 6@ (( ( AFAqE\r  A 6 ((B 7è ((A 6ü$ ((B 7ÀA ((A 6°A@ ((( E\r  (( A j @ (((,À \r  (( A6  A 6 (( A6  A6 (! Aj$  Ä# Ak! $    6 (( A 6  ((A 6ð (((¼¸  ((A 6¼ ((A 6ô (( (! (( 6ü$ ((A 6ä ((A 6à@@ (((%\r  ((Aì%j ((A%jÞ  ((A 6% ((A%jÝ  ((B 7¸A ((A 6ÐA ((B 7ÀA ((A 6°A ((A 6ÜA Aj$ î# Ak! $    6@ (A GAq\r A AÌª AA¡   @ (( A GAq\r A¶ AÌª AA¡   @@ (( ( ! A\nK@@@@@@@  @ ( \r  A 6@ (  \r  A 6 A6@ (¡ \r  A6@ ( AjA¢ \r  A 6@ (E\r  A6 A6 A 6  (! Aj$  Ä\n# A k! $    6 A6@ (((,Ç \r AÍ AÌª AüAõ¶    A 6 A 6@@@ (AIAqE\r@@ ((($E\r  ((!Aÿ  - Ú$6 ((A 6$@ (((, AjAÎ \r  A 6 (! (!Aÿ@  - Ð FAqE\r  A6  (Aj6 A 6@ (AOAqE\r  A 6 (! (!Aÿ@  - ô FAqE\r   (Aj6 A 6@ (AFAqE\r @ (£ \r  A 6 A 6@ (AÿFAqE\r  (! (( : Ø$@ (((, AjAÎ \r  A 6@@ (AÿFAqE\r  (! (( : Ú$ ((A6$@ (AvAü FAqE\r  (!	 (( 	: Ù$ (( A6  A6 A 6@ (E\r  (A ¤  A 6  (( A6  A6 (!\n A j$  \ný# Aàk! $    6Ø@ (Ø((,Ç \r AÍ AÌª A¼\rA·    (Ø((,!A (ü !@@  AÌj Î \r  A 6Ü (Ì! AA  6Ô (Ø((,!A ( !@  AÈj Î \r  A 6Ü (Ø((,!A ( !@  AÄj Î \r  A 6Ü@@ (È\r @ (Ø (Ô (Ä¥ \r  A 6Ü (Ø(A6ð@ (Ø(AøjAjA(jA÷ Aþ A FAqE\r  (Ø(A 6ü$@ (Ø((%\r  (Ø((ØE\r  (Ø((A GAqE\r  (Ø((!	 (Ø (Ø(Aøj (Ø(($ 	  @@ (ÈAFAqE\r  (Ø(A 6ô@ (ÄA KAqE\r @ (Ø (Ô (Ä¦ \r  A 6Ü (Ø(A6ô@ (Ø((%\r  (Ø((äE\r  (Ø((A GAqE\r  (Ø((!\n (Ø (Ø(A¨j (Ø(($ \n    (Ø(AØj (ÈAtj( A GAsAq6À  (Ä6¼A°!A ! Aj  ü   (Ô6  (È6  (Ä6@ (ÈAFAqE\r @ (Ø((, AjAjA (ü AvÖ \r  A 6Ü@ (¼A (ü AvIAqE\r  (Ø( A6  A 6ÜA (ü Av!\r  (¼ \rk6¼@ (Ø((ÜA KAqE\r  (Ø AjAj§ E\r   (ÀA GAsAq6À@@ (ÀE\r @ (Ø((, (¼Õ \r  A 6Ü A6 (Ø((, (¼AtÊ  (È! AK@@@@@@@@  @ (Ø((, (¼Õ \r  A 6@@ (¼A KAqE\r  (¼¶ !  6@@ A FAqE\r  (Ø( A6  A 6@ (Ø((, ( (¼Ö \r  A 6 A 6@ (Ø AjAj (¼¨ \r  A 6@ (Ø AjAj© \r  A 6@ (Ø AjAjª \r  A 6AÊ AÌª A A·   @@ (¼A KAqE\r  (¼¶ !  6@@ A FAqE\r  (Ø( A6  A 6@ (Ø((, ( (¼Ö \r  A 6 A 6@ (Ø((,Ì A KAqE\r  (ØA¤ @ (Ø( ( AFAqE\r  (Ø( A6  A 6 (Ø((,Ë @ (E\r  (Ø((%\r  (Ø((A GAqE\r  (Ø((! (Ø! (Ø(($!  Aj     (È! AK@@@@@@@@  @ (A GAqE\r  (¸ @ (A GAqE\r  (¸ @ ( A KAqE\r  A 6Ð@@ (Ð ( IAqE\r@ ($ (ÐAtj(A GAqE\r  ($ (ÐAtj(¸   (ÐAj6Ð @ ($A GAqE\r  ($¸ @ (¬A KAqE\r  (°A GAqE\r  A 6Ð@@ (Ð (¬IAqE\r@ (° (ÐAtj(A GAqE\r  (° (ÐAtj(¸   (ÐAj6Ð @ (°A GAqE\r  (°¸ @ (A GAqE\r  (¸ @ ( A GAqE\r  ( ¸ @ (8A GAqE\r  (8¸ AÊ AÌª AàA·   @ (A GAqE\r  (¸ @ (\r  A 6Ü@ (ÔE\r @ (Ø (Ø(A¸Á j \r  (Ø(B 7¸A (Ø( A6  A6Ü (Ü! Aàj$  # Ak! $    6 A6 @@ (((,Ç \r  (((,! (((,È !@  Aj Î \r  A 6@@@ ((($E\r  ((!Aÿ  - Ú$6 ((A 6$@ (((, AjAÎ \r  A 6@ (AÿFAqE\r  (! (( : Ø$@ (((, AjAÎ \r  A 6@@ (AÿFAqE\r  (! (( : Ú$ ((A6$@ (AvAü FAqE\r  (! (( : Ù$ (( A6  (((,Á @ ( ((AÀÁ j \r  ((B 7ÀA A6@ ( E\r  (A ¤  A 6   (! Aj$  ~	~~# A k! $    6  6  6 (A 6  ((A 6t A 6 (AtAÿÿq! (Av! ((!Aÿ  - Ø$s!AÐá  Atj!Aÿÿ   / s6 (AtAÿÿq!	 (Av!\n ((!Aÿ \n - Ù$s!AÐá  Atj!\rAÿÿ  	 \r/ s6 (((, (AÿÿqÃ @@ (« \r  A 6@ (( ( AFAqE\r  A6@ ( (((è (((ð (((ø¬ \r  A 6 A 6@@ ( (((ðIAqE\r  (((ø6ü (((ô! AK@@@@@@  @ (((ðAFAq\r AÁ AÌª AåA¾´   @ (AFAqE\r   (üAj6ü@ (((ðAFAq\r AÁ AÌª AêA¾´   @ (\r   (üAj6ü@ (((ðAFAq\r AÁ AÌª AïA¾´   @ (AFAqE\r   (üAj6üAÊ AÌª AôA¾´   @ ( ( (ü (­ \r @ (( ( AFAqE\r  A 6@ (( ( AGAqE\r   (Aj6 @ (( ( AGAqE\r @ (® \r  A 6@ (( ( AFAqE\r   (((,Ä Aÿÿq6 (((,!A (° !@  Aj Î \r @ (( ( AGAqE\r  A 6@@ (( ( AFAqE\r  ( (FAqE\r @ (E\r  (¯  A 6@@ ( (((ðIAqE\r (((ø! A  k6ø (ø! Ax u6ô (ø! Aÿÿÿÿ u6ð A 6@@ ( (((èIAqE\r@@ ((A0j (Atj(  (Atj(  (ôHAq\r  ((A0j (Atj(  (Atj(  (ðJAqE\r (A¤  (( A6   (Aj6   (Aj6 @ (( ( AFAqE\r  (A¤  (( A6 @ (((°AE\r  (( ( AFAqE\r  (((%\r  (E\r @ (((üAFAq\r A¤º AÌª AµA¾´   @ (((&AFAq\r AÊ¹ AÌª A¶A¾´   @ (()& ((5&| (()	TAqE\r   (()	 (()& ((5&|}§6ì@ (((ÜA\r  (A¤ @ (((& (((ìFAqE\r  (((& (((ðFAqE\r  (((& (((øFAqE\r  (((&AOAqE\r B !  7(  7   7  7 A8j! ((A&j!  ) 7   )7  )7  )7  ) 7  A ;à A 6@@ ( (@IAqE\r (8A ! (! Aj Atj 6  (!@ Aj Atj( A FAqE\r  A 6@@ ( (@IAqE\r (!@ Aj Atj( A GAqE\r  (! Aj Atj( ¸   (Aj6  (( A6  A 6  (Aj6 @ (ì (<AlKAqE\r   (<Al6ì@ (ì (8A2lKAqE\r   (8A2l6ì@@ (ìE\r  58 )P|7P@ (ì (8IAqE\r   (ì68 (8!  (ì k6ì (8! ((  6@ (LAFAq\r A¹ AÌª AãA¾´    )P 58|! (( 7è A 6@@ ( (@IAqE\r A8jA(j (A°ljA 6  A8jA(j (A°ljB 7 A8jA(j (A°ljA 6¨  (Aj6  (! Aj! @  A8j  ° E\r  (( A6  A 6@@ ( (@IAqE\r (!!@ Aj !Atj( A GAqE\r  (!" Aj "Atj( ¸   (Aj6  A 6  A 6@@ ( (@IAqE\r (!#@ Aj #Atj( A GAqE\r  (!$ Aj $Atj( ¸   (Aj6  ((A 6ÜA@@@ (( ( AFAq\r  (( ( AFAqE\r@@ (((,Â \r A (Ð AÞ A á @ (((A GAqE\r  (()ÀAB RAqE\r @ ( Aj E\r A (Ð !%  ) (()ÀA}7  %A°Þ  á  (((!&@ ( (()ÀA ((($ &  AFAqE\r  (( A6  A 6@ (((,À \r  (( A6  A 6A (Ð AðÝ A á  (A6 @ (((äE\r  (((ä!\' (( \'6à (((ð!( ((  (6 (((ô!) ((  )6 (((ø!* ((  *6 (((ì!+ ((  +6 (((è!, ((  ,6@ (((üAFAq\r A¤º AÌª A°A¾´    (()	 ((5è|!- (( -7è@ (E\r @ ( ((Aèj ((A0j° E\r  (( A6  A 6 (( A6  A6 (!. A j$  .ÿ# A k! $    6@@ (((, AjAÎ \r  A 6 A 6 A 6@@ (AIAqE\r@ (((, AjAÎ \r  A 6  (At6  (Aÿ q (r6  (Aj6 @ (((, (Õ \r  A 6 A6 (! A j$  ®# Ak! $    6  6@@ (((%\r  ((A6ÜA ((( ! ( ( ((($   @ (AFAqE\r  ((!  (ÐAAj6ÐA Aj$ ´	# A k! $    6  6  6 A 6@ (((,Ç \r AÍ AÌª AûA§²    ((A 6ø (! (( 6ü (! (( 6 A (Ü 6 (((,! (!@@  Aj Î \r  A 6 (! (( 6  ( (j6 A (à 6 (((,!	A (à !\n@ 	 Aj \nÎ \r  A 6 (! (( 6  ( (j6 A (ä 6 (((,!A (ä !\r@  Aj \rÎ \r  A 6 (! (( 6  ( (j6 A (è 6 (((,!A (è !@  Aj Î \r  A 6 (! (( 6  ( (j6 A (ì 6 (((,!A (ì !@  Aj Î \r  A 6 (! (( 6  ( (j6 A (ð 6 (((,!A (ð !@  Aj Î \r  A 6 (Aj! (( 6  ( (j6 A (ô 6 (((,!A (ô !@  Aj Î \r  A 6 (Aj! (( 6   ( (j6 A (ø 6@ (((, ((AøjAjA jA (ø Ñ \r  A 6  ( (j6@ (((, ((AøjAjA(jAÖ \r  A 6  (Aj6@ (AqE\r A©Æ AÌª AµA§²   @ ( (AvIAqE\r  A 6 (Av!  ( k6@ (((, (Õ \r  A 6 A6 (! A j$  Æ~~# A k! $    6  6  6@ (((,Ç \r AÍ AÌª AÄAÊ´    ((A6¨ (! (( 6¬ (! (( 6°@@ (ApE\r  (((,Í  A 6 (An! (( 6¸ (((¼ (((¸A ! (( 6¼@ A FAqE\r  (( A6  A 6 A 6@@ ( (((¸IAqE\r (((,!A ( !	@   	Ñ \r  A 6 ) !\n (((¼ (Alj \n7  (((,!A ( !@   Ñ \r  A 6 ) !\r (((¼ (Alj \r7 (((,!A ( !@  Aj Î \r  A 6 (! (((¼ (Alj 6  (Aj6  (((¸Al!  ( k6@ (E\r AñÅ AÌª AåAÊ´    A6 (! A j$  # Ak! $    6  6@ (A GAq\r A AÌª AìA ¶   @ ((A GAq\r A»³ AÌª AíA ¶    A 6 @@@ (  (((ÜIAqE\r@ (((Ø ( A (ü Avlj (A (ü Avþ A FAqE\r  A6  ( Aj6   A 6 (! Aj$  ×# A k! $    6  6  6@ (((,Ç \r AÍ AÌª AîAì¯   @@@@ (AOAqE\r   (Ak6@A ( A FAq\r Aî¿ AÌª AóAì¯   @ (((, (Ó \r  A 6@ ( (( IAqE\r  (A 6  (A 6 (( !  ( k6 (( A³ ! ( 6@ A FAqE\r  (( A6  A 6@ (((, (( (( Ö \r  A 6 (( (( jA :  @A ( A FAq\r A²¿ AÌª AAì¯   @ (((, (AjÓ \r  A 6@ ((A KAqE\r  (A 6 A 6@ ((A KAqE\r  ((Aî ! ( 6@ A FAqE\r  (A 6 (( A6  A 6 A 6@@ ( ((IAqE\r (( (AtjA 6  (( (AtjA 6@A ( A FAq\r Aî¿ AÌª AAì¯   @ (AIAqE\r  (! ( 6  (Ak6@ (((, (( (AtjÓ \r  (! ( 6 A 6@ ( (( (Atj( IAqE\r  (!	 ( 	6 (((,Í  A 6 (( (Atj( !\n  ( \nk6 (( (Atj( A³ ! (( (Atj 6@ A FAqE\r  (( A6  (! ( 6 A 6 (( (Atj(!\r (( (Atj( !A !@ E\r  \r  ü @ (((, (( (Atj( (( (Atj( Ö \r  (( (Atj(¸  (( (AtjA 6 (! ( 6 (( (Atj( (( (Atj( jA :    (Aj6  (((,Í  A 6@ (A KAqE\r @ ((AIAqE\r  ((¸  (A 6 (((,Í  A 6 A6 (! A j$  å%# A k! $    6  6@ (((,Ç \r AÍ AÌª AÕA¦°    (!A ! A  ü @A (È AqE\r A¼Æ AÌª AÙA¦°   @@ (((, (A (È AvÖ \r  A 6@ (((, (AjA (Ì Ñ \r  A 6 (((,!A (Ð !@  Aj Î \r  A 6 (!AA  ! ( 6@ (((,A (Ô Ô \r  A 6 (((,!	A (Ø !\n@ 	 Aj \nÎ \r  A 6 (! ( 6@@ ((A KAqE\r  ((A  ! ( 6@ A FAqE\r  (( A6  A 6 A 6@@ ( ((IAqE\r  (( (Atj6@ (((, (A (¬ Ñ \r  A 6 (((,!\rA (° !@ \r Aj Î \r  A 6 (! ( : @A (´ AqE\r AýÆ AÌª AùA¦°   @ (((, (A	jA (´ AvÖ \r  A 6 (((,!A (¸ !@  Aj Î \r  A 6 - ! (! - !  Aq A~qr:  (((,!A (¼ !@  Aj Î \r  A 6 - ! (! - !A!   q t A}qr: @ (((,A (À Ô \r  A 6 (((,!A (Ä !@  Aj Î \r  A 6 (! ( :  (!Aÿ@ - A JAqE\r  (!Aÿ - A !  (  6@  A FAqE\r  (( A6  A 6 A 6@@ (!! (!"Aÿ ! "- IAqE\r  (( (Atj6 @ (((, ( A (  Ñ \r  A 6 (((,!#A (¤ !$@ # Aj $Î \r  A 6 (!% (  %: @ (((,A (¨ Ô \r  A 6  (Aj6   (Aj6  (((,Í  A 6 A6 (!& A j$  &ù# Ak! $    6  6@ (((,Ç \r AÍ AÌª A¬AÒ³    (((,!A (Ü !@@   Î \r  A 6@@ ( AIAqE\r  ( ! ( 6  (A 6  (((,!A (à !@   Î \r  A 6@ (((,Ì  ( IAqE\r  (((,Í  A 6 ( A³ ! ( 6@ A FAqE\r  (( A6  A 6@ ( A KAqE\r @ (((, (( ( Ö \r  A 6 (( ( jA :   (((,!	A (ä !\n@ 	  \nÎ \r  A 6@ (((,Ì  ( IAqE\r  (((,Í  A 6 ( A³ ! ( 6@ A FAqE\r  (( A6  A 6@ ( A KAqE\r @ (((, (( ( Ö \r  A 6 (( ( jA :  @ (((, (AjA (è Î \r  A 6@ (((, (AjA (ì Î \r  A 6@ (((, (AjA (ð Î \r  A 6@ (((, (AjA (ô Î \r  A 6@ (((, (AjA (ø Î \r  A 6@ (((,Ì  ((IAqE\r  (((,Í  A 6 ((´ ! ( 6 @ A FAqE\r  (( A6  A 6@ ((A KAqE\r @ (((, ((  ((Ö \r  A 6 A6 (!\r Aj$  \r·~~~# AÐ k! $    6H A 60 A 6, A 6@ (H((,Ç \r AÍ AÌª AÉA²     (H(- Ø$:   (H(- Ù$:  A6Aÿ@ - AqE\r  A6 A 64@@@ (4AIAqE\r@ (H((, AÄ jAÎ \r  A 6L@ (DAÿFAqE\r  (D! (H( : Ú$ (H(A6$ (HA¤  (H( A6  A6L (D! (!  Aj6  Ajj :    (4Aj64  - Av!  6D AK@@@@@@@   A6 (H(AÀ6è (DAk!AÀ t! (H( 6è  (D60 (DAk!A t!	 (H( 	6èAÊ AÌª AA²    - !\nA! \n q!  6D  K@@@@@@@@@@@@@@@@  	\n\r@@ (H((ðE\r  (H((!\r (H( \r6ì A6 (H(A±6ì\r (H(Aâ\n6ì (H(AÜ6ì (H(AÀ>6ì\n (H(Aý 6ì	 (H(A¢¬6ì (H(AÀ»6ì (H(Aú6ì (H(AÄØ6ì (H(A÷6ì (H(Aî6ì  (D6, (HA¤  (H( A6  A6LAÊ AÌª AÊA²   Aÿ  - Au6D@@ (DAqE\r  (H(!A!  6ð (DAq!  K@@@@@   (H(A6ô (H(A6ô (H(A6ô A6 (DAj! (H( 6ð (H(A 6ô - AqAv!  6D AK@@@@@@@@@@  @@ (H((ðE\r  (H(( ! (H( 6ø A6 (H(A6ø (H(A6ø A6 (H(A6ø (H(A6ø (H(A6ø (H(A 6øAÊ AÌª AA²   Aÿ@ - AqE\r  A6Aÿ@@@ - Aq\r  (H((ðE\r (H(( (H((GAqE\r (H((,! Aj!@  A8j  AjÜ \r  A 6L@ )8BQAqE\r  (Ak Ajj-  ! (H( : Ú$ (H(A6$ (HA¤  (H( A6  A6L (H(A6ü )8! (H( 7	 (H((,! Aj!@  AÄ j  AjÛ \r  A 6L@ (DAFAqE\r  (Ak Ajj-  ! (H( : Ú$ (H(A6$ (HA¤  (H( A6  A6L (H(A 6ü (D! (H( 6	@ (0E\r @ (H((, AÄ jAÎ \r  A 6L (D! (!  Aj6  Ajj :  @ (0AFAqE\r @ (H((, AjAÎ \r  A 6L (! (!  Aj6  Ajj :    (DAt (r6D (DAj!  (H(  6è@ (H((èAÿÿKAqE\r  (Ak Ajj-  !! (H( !: Ú$ (H(A6$ (HA¤  (H( A6  A6L@ (,E\r @ (H((, AÄ jAÎ \r  A 6L (D!" (!#  #Aj6 # Ajj ":  @ (,AGAqE\r @ (H((, AÎ \r  A 6L ( !$ (!%  %Aj6 % Ajj $:    (DAt ( r6D@@ (,AFAqE\r  (DAèl!& (H( &6ì@@ (,A\rFAqE\r  (D!\' (H( \'6ì (DA\nl!( (H( (6ì@ (H((, AÄ jAÎ \r  A 6L  (D: + Aj ( Aÿq!)Aÿ@ ) - +GAqE\r  (HA¤  (H( A6  A6L (H(A 6ä@ (H((ü\r   (H((	6D (H(A6ü@@ (H((àE\r  (H(5à 5D~!* (H( *7	@@ (H((ðE\r @@ (H(( (H((FAqE\r  (H(5 5D~!+ (H( +7	 (H((!, (H( ,6ä A6@@ (D\r  (H(B 7	 (H((è!- (H( -6ä (H(5è 5D~!. (H( .7	@ (E\r  (HA¤  (H( A6  A6L A6L (L!/ AÐ j$  /~# A k! $    6  6  6  6@@ ( (((ØMAqE\r  ( (((ÜMAqE\r @ (A IAq\r  (((pA GAqE\r A6 A 6@@ (AIAqE\r@ ((A0j (Atj( A GAqE\r  ((A0j (Atj( Apj¸  ((A0j (AtjA 6 @ ((AÜ$j (Atj( A GAqE\r  ((AÜ$j (Atj( ¸  ((AÐ j (AtjA 6  ((AÜ$j (AtjA 6   (Aj6 @ (((pA GAqE\r  (((p¸  ((A 6p@ (((Ø (KAqE\r   (((Ø6 A 6@@ ( (IAqE\r (!A!    µ 6@ (A FAqE\r  (( A6  A 6 (!B !  7  7  (Aj!	 ((A0j (Atj 	6 @ ( ((AÜ$j (Atj ((AÐ j (Atjé \r  (( A6  A 6  (Aj6 @ (A FAqE\r  (!\nA \nî ! (( 6p@ (((pA FAqE\r  (( A6  A 6 (! (( 6Ø (!\r (( \r6Ü A6 (! A j$  ~# AÀ k! $    68  64  60  6,@@ (8((, A(jAÎ \r  A 6<  ((Aq6$  ((Aþq6(@@ ($E\r @ (8((, Aj× \r  A 6< (Aj! (8(AèjA(j (4A°lj 6¨@ (8(AèjA(j (4A°lj(¨ (0OAqE\r  (8A ¤  (8( A6  A6< (8(AèjA(j (4A°lj(¨!  (0 k60 (8(AèjA(j (4A°ljA 6¨@ ((AqE\r  (8A ¤  (8( A6  A6<@@ ((\r @ (8 (4 (0 (,¶ \r  A 6<@@ ((AFAqE\r @ (8 (4 (0 (,· \r  A 6<@ ((AIAqE\r  (8A¤  (8( A6  A6<@@ ((AMAqE\r   ((AvAq6@ (8((è (MAqE\r  (8A ¤  (8( A6  A6<@ (8 (4 (0 ( (,¸ \r  A 6<@ (8( ( AFAqE\r  A6<@ ((AÀ IAqE\r  (8A¤  (8( A6  A6<  ((AvAqAj6@ (8((è (MAqE\r  (8A ¤  (8( A6  A6<@ (8 (4 (0 ( (,¹ \r  A 6<@ (8( ( AFAqE\r  A6<@ ($E\r  (,E\r   (8(AèjA(j (4A°lj(¨6(@@ (0 ((jA!IAqE\r  A 6 @@ (  (8((èIAqE\r  (8(A0j (4Atj(  ( Atj( 6 ( ((t! (8(A0j (4Atj(  ( Atj 6   ( Aj6  @ (8((tE\r Aß AÌª AßA´    (8(A6t A 6 @@ (  (8((èIAqE\r  (8(A0j (4Atj(  ( Atj4 7 ) 5(! (8((p ( Atj 7   ( Aj6   A6< (<!	 AÀ j$  	¼# Ak! $    6@@ (((,Ç \r  A 6 (((,! (((,È !@  Aj Î \r  A 6@ (E\r  (A ¤  (( A6  A6 (! Aj$  »\n# A k! $    6 (((ô! AK@@@@@@  @ (((ðAFAq\r AÁ AÌª AAË   @ (((t (((øA IAqGAq\r AÜÛ AÌª AAË    A 6@@ ( (((èIAqE\r@@ (((tE\r  (((0 (Atj4  (((p (Atj) }§! (((4 (Atj 6  (((0 (Atj(  (((4 (Atj( k! (((4 (Atj 6   (Aj6 @ (((ðAFAq\r AÁ AÌª A¥AË   @ (((t (((øA IAqGAq\r AÜÛ AÌª A¦AË    A 6@@ ( (((èIAqE\r@@ (((tE\r  (((4 (Atj4  (((p (Atj) |§! (((0 (Atj 6  (((4 (Atj( ! (((0 (Atj!   ( j6   (Aj6 @ (((ðAFAq\r AÁ AÌª A®AË   @ (((t (((øA IAqGAq\r AÜÛ AÌª A¯AË    A 6@@ ( (((èIAqE\r@@ (((t\r   (((0 (Atj( 6  (((4 (Atj( 6  (At6  (Aq (r6 ( (jAu! (((0 (Atj 6  ( (kAu!	 (((4 (Atj 	6   (((0 (Atj4 B7  (((p (Atj) B )7 ) (((p (Atj) |B§!\n (((0 (Atj \n6  ) (((p (Atj) }B§! (((4 (Atj 6   (Aj6 AÊ AÌª AÄAË    A j$ «~# AÐ k! $    6H  6D  6@ (H(A&j (DA°ü\n   (H(A6°A@@ (H((%E\r  (H((%\r   (D)78  )8 (D5 |70  (H()ÈA7(@ (D(AFAq\r A¿¸ AÌª AA°    (H(A6ÔA@ )8 )(XAqE\r  )( )0TAqE\r   )( )8}§6$ (H(A 6%@ ($A KAqE\r  A 6 @@ (  (D(IAqE\r (@ ( Atj(  ($Atj! ( !  Atj 6  (H(A&jA(j ( A°ljA6  (H(A&jA(j ( A°ljA 6 ( !  Atj( ! (H(A&jA(j ( A°lj 6  ( Aj6   ($! (H(!	 	 	(& k6& 5$!\n (H(!  \n )&|7& (H((!  (H (H(A&j  (H(($   6L (H((!\r  (H (D (@ (H(($ \r  6L A 6L@ (H((%\r @ (H((ð\r  (H(A 6ü$@ (H((ü$E\r @ (H(A%j (@ (D( (D(  (D(AjAvà \r  A6L (H((!  (H (D (@ (H(($   6L A 6L (L! AÐ j$  ×# A k! $    6  6  6  6  (6 (! ((!  ( ( (   ! AK@@@@@   A 6 A6 A6AÊ AÌª AõAÇ¯    (! A j$  \n# Ak! $    6  6  6  (! ( A j! (! ( ! (! (!	 ($!\n   A  	  \n ! AK@@@@@@@@ 	  A 6 A 6 A6 A6 A6 ((A6àA A6AÊ AÌª AâA¾°    (! Aj$  z# Ak! $    6  6  ( (j6@@ ( (IAqE\r  A 6  (´ 6 (! Aj$  P# Ak! $    6@ (\r   (Aj6 (¶ ! Aj$  Ú# Ak! $    6  6  6 @@@ (E\r  (\r ( \r A¶ 6  (  (j6@ ( ( IAqE\r  A 6 (! (!@ A nKAqE\r  A 6  ( (l¶ 6 (! Aj$  Ò~~# A0k! $    6(  6$  6   6  (((AèjA(j ($A°ljAj6 (((AèjA(j ($A°ljA 6  ((((,! ( !@@  Aj Ò \r  A 6, )! ( 7 @ (E\r @@ ( A MAqE\r   (((A0j ($Atj( 6 A 6@@ ( ((((èIAqE\r )§! ( (Atj 6   (Aj6   ((((p6 (((A6t A 6@@ ( ((((èIAqE\r )!	 ( (Atj 	7   (Aj6  A6, (,!\n A0j$  \nì~# AÀ k! $    68  64  60  6,  (8(AèjA(j (4A°ljAj6( (8(AèjA(j (4A°ljA6 @@@ (0A!IAqE\r   (8(AÐ j (4Atj( 6 ((A 6 (! (( 6  A 6$@@ ($ (8((èIAqE\r (8((,! (0!@  A j Ð \r  A 6< ( ! ( ($Atj 6   ($Aj6$ @ (,E\r  (8(A0j (4Atj( !	 ((( !\n (8((èAt!@ E\r  	 \n ü\n    (8((p6 ((A6 (! (( 6  (8(A6t A 6$@@ ($ (8((èIAqE\r (8((,!\r (0!@ \r Aj Ò \r  A 6< )! ( ($Atj 7   ($Aj6$  A6< (<! AÀ j$  \n~# AÀ k! $    68  64  60  6,  6(  (8(AèjA(j (4A°ljAj6$ (8(AèjA(j (4A°ljA6  (8(AÐ j (4Atj( ! ($ 60 (,! ($ 6 A 6@@@ ( (,IAqE\r (8((,! (0!	@  Aj 	Ò \r  A 6< )!\n ($Aj (Atj \n7   (Aj6  (8((,!A (´ !@  Aj Î \r  A 6< (!\r ($ \r6 @@ ($( AK\r  (8((,!A (¸ !@  Aj Î \r  A 6<@@ (8((è (v (,IAq\r  (8((è! (! A tpA KAqE\r (8A ¤  (8( A6  A6< (! ($ 6 (8(Aø j (4Alj! ($ 6 (8A¤  (8( A6  A6<@@ ($( AK\r @ (8 (, ($( (8(Aø j (4Alj (8(AÐ j (4Atj(  ($( AFAqº \r  A 6<AÊ AÌª A¼AÙµ   @ ((E\r @@ (0A!IAqE\r  A 6@@ ( (,IAqE\r ($Aj (Atj) §! (8(A0j (4Atj(  (Atj 6   (Aj6 @@ (0 (,jA MAqE\r  (8(AÐ j (4Atj(  (8((è (,k (, (8(A0j (4Atj(  (,Atjö  (8(AÐ j (4Atj(  (8((è (,k (, (8(A0j (4Atj(  (,Atj÷  (8(A6t (8((p! ($Aj! (,At!@ E\r    ü\n   (8(AÐ j (4Atj(  (8((è (,k (, (8((p (,Atjø  A6< (<! AÀ j$  þ\r~# AÀ k! $    68  64  60  6,  6(  (8(AèjA(j (4A°ljAj6$ (8(AèjA(j (4A°ljA6  (8(AÐ j (4Atj( ! ($ 6 (,! ($ 6 A 6@@@ ( (,IAqE\r (8((,! (0!	@  Aj 	Ò \r  A 6< )!\n ($Aj (Atj \n7   (Aj6  (8((,!A (Ð !@  Aj Î \r  A 6< (!\rA (Ð !@ \rA tAkFAqE\r  (8A ¤  (8( A6  A6< (Aj! ($ 6 (8((,!A (Ô !@  A j Ð \r  A 6<@ ( A HAqE\r  (8A ¤  (8( A6  A6< ( ! ($ 6 A 6@@ ( (,IAqE\r (8((,! ($(!@  A j Ð \r  A 6< ( ! ($Aj (Atj 6   (Aj6  (8((,!A (´ !@  Aj Î \r  A 6< (! ($ 6 @@ ($( AK\r  (8((,!A (¸ !@  Aj Î \r  A 6<@@ (8((è (v (,IAq\r  (8((è! (! A tpA KAqE\r (8A ¤  (8( A6  A6< (! ($ 6 (8(Aø j (4Alj! ($ 6 (8A¤  (8( A6  A6<@@ ($( AK\r @ (8 (, ($( (8(Aø j (4Alj (8(AÐ j (4Atj(  ($( AFAqº \r  A 6<AÊ AÌª A£A¼¶   @ ((E\r @@ (0A MAqE\r  A 6@@ ( (,IAqE\r ($Aj (Atj) §! (8(A0j (4Atj(  (Atj 6   (Aj6 @@ (0 ($Aj (, ($( A MAqE\r  (0 ($Aj (, A MAqE\r  (8(AÐ j (4Atj(  (8((è (,k ($Aj (, ($( (8(A0j (4Atj(  (,Atj  (8(AÐ j (4Atj(  (8((è (,k ($Aj (, ($( (8(A0j (4Atj(  (,Atj  (8(A6t (8((p!  ($Aj!! (,At!"@ "E\r    ! "ü\n   (8(AÐ j (4Atj(  (8((è (,k ($Aj (, ($( (8((p (,Atj  A6< (<!# AÀ j$  #é# AÀ k! $    68  64  60  6,  6(  6$ (0! A t6  (8((è (0v6@@ ($E\r A (À !A (¼ !  6@@ ($E\r A (Ì !	A (È !	  	6 @@@ (0A KAqE\r  ( (4OAq\r (8((è (4OAq\rAí AÌª AïAµ    (,!\n (0!@@A KAqE\r A! (0!@@ \n   \r  (8( A6  A 6< A 6 A 6@@ ( (IAqE\r (8((,!\r (!@ \r A j Î \r  A 6< ( ! (,(  (Atj 6 @@ (  ( IAqE\r  (,( (AtjA 6 @@ (\r  ( (4k! (!  6 (8((ØA!@ (8((, (( (Atj ( (    \r @ (8( ( AFAqE\r  (8A ¤  (8( A6  A6< A 6<  ( (j6 (8((,!A (Ä !@  A j Î \r  A 6< ( ! (,( (Atj 6 @@ ( \r @@ (\r  (4!A !  6@@ ( (IAqE\r (( (AtjA 6   (Aj6  (Aj6 @@ (\r  (4!A !  6@@ ( (IAqE\r (8((,! ( !@  Aj Ð \r  A 6< (! (( (Atj 6   (Aj6  (Aj6   (Aj6  A6< (<! AÀ j$  # Ak!   $   AA¼ 6@@  (A FAqE\r   A 6AA¼ !  ( 6 @  (( A FAqE\r   (¸   A 6AAè¼ !  ( 6@  ((A FAqE\r   (( ¸   (¸   A 6AAì ¼ !  (( 6 @  ((( A FAqE\r   ((¸   (( ¸   (¸   A 6¢ !  (((  6J@  ((( (JA FAqE\r   ((( ¸   ((¸   (( ¸   (¸   A 6  ((A 6Ô  (( A6   (½   ((A 6Ð  A 6@@  (AIAqE\r  ((( A¨j  (Aàlj!  ((( AèÄ j  (Atj 6   ((( A¨j  (AàljA°j!  ((( AèÄ j  (Atj 6    (Aj6   A 6@@  (AIAqE\r  ((( A¨7j  (Aàlj!  ((( A¨Å j  (Atj 6   ((( A¨7j  (AàljA°j!  ((( A¨Å j  (Atj 6    (Aj6   A 6@@  (AIAqE\r  ((( A¸Å j  (Alj!	  ((( A¸È j  (Atj 	6   ((( A¸Å j  (AljAj!\n  ((( A¸È j  (Atj \n6    (Aj6   A 6@@  (AIAqE\r  ((( AøÆ j  (Alj!  ((( AøÈ j  (Atj 6   ((( AøÆ j  (AljAj!  ((( AøÈ j  (Atj 6    (Aj6   A 6@@  (AIAqE\r  ((( A¸Å j  (Alj   ((( A¸Å j  (AljAj     (Aj6   A 6@@  (AIAqE\r  ((( AøÆ j  (Alj   ((( AøÆ j  (AljAj     (Aj6   A 6@@  (AIAqE\r  ((( A ë j  (Alj     (Aj6     (6  (!\r  Aj$  \rv# Ak! $    6  6@@@ (E\r  (\r A¶ 6  ( (¼ 6 (! Aj$  Õ# Ak! $    6@ (A GAq\r Aù Aª AºAØ°    (( A 6 (( A6 (( A6 (( A 6 (( A 6 (( A6 (( A6 (( AÄØ6  (( A 6$ (( A6( (( A\r6, (( C   ?80 (( A 6¬ (( A 6° (( A 6´ (( A 6¸ (( A 6¼ (( A 6À (( A 6Ä (( A 6È (( B 7Ð (( A 6Ø (( A 6Ü (( A 6à (( A6ä ((A 6À	 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6 ((A 6¤ ((A 6¨ ((A 6¬ ((A 6° ((A 6´ ((A 6À ((A 6¸ ((A 6¼ ((A 6Ä ((A 6È ((A 6Ì ((A6Ô ((A6Ø ((A6Ü ((A6è ((A6à ((A 6ä ((A 6¸ ((A6ì ((A 6° ((A 6´ (( Aj   (A¾  Aj$  # Ak! $    6  6 A6 @ (A GAq\r Aù Aª AÔAå   @ ((A GAq\r A¤³ Aª AÕAå   @ (( A GAq\r Aîµ Aª AÖAå   @@ (( ( AGAqE\r  A 6@ (A	OAqE\r  A6 (! (!  A  A,lj( ×  ( q6  (! (!  A  A,lj(Ø  ( q6  (! (!  A  A,lj((Ù  ( q6  (!	 (!\n  	A  \nA,lj(Ú  ( q6  (! (!  A  A,lj(Û  ( q6  (!\r (!  \rA  A,lj(Ü  ( q6  (! (!  A  A,lj(Ý  ( q6  (! (!  A  A,lj(Þ  ( q6  (! (!  A  A,lj(ß  ( q6  (! (!  A  A,lj( à  ( q6  (! (!  A  A,lj($á  ( q6   ( 6 (! Aj$  ©# A0k! $    6( A 6$@@ ((A FAqE\r  A 6,@ (((A GAq\r A¤³ Aª AàA¡   @ ((( A GAq\r Aîµ Aª AáA¡   @ ((( ( AFAqE\r @ ((( (ÜA GAqE\r  ((( (Ü¸  ((( A 6Ü ((( A 6à@ ((((ÔA GAqE\r @ ((((ÔA (Ø GAqE\r  ((((Ô×  (((A 6Ô A6,@ ((( ( \r  ((((Ð\r  A6 @ ((( (äAKAqE\r @@ ((((à ((((ÔIAqE\r  A6  ((((à6  ((((Ü6  ((((Ü ((((ÔjAk6  (6@@ ( (IAqE\r@ (A KAq\r A¨Ä Aª A\rA¡     (Ak ((((ÔAkpAj6 ((( (Atj( A¼ë jë @@ ((( (Atj( (lA GAsAqE\r ((( (Atj( AÔë j ((( (Atj( A¼ë jñ  @ ((( (Atj( (l\r  A 6 @ ( E\r  (( ((( (Atj(  ((( ($A À \r  A 6  ((( (Atj( A¼ë jì   (Aj6  (((A\rjë @ ((((°!A!@ \r  ((((àA K!@ AqE\r  (((A \rj (((A\rjñ  (((A\rjì @ ( E\r  ((((Ä	E\r  ((((Ä	! (((  6$@ (( ((( ($Á \r  A6,@ ((AÂ \r  A6$@ ((( (äAKAqE\r  (((A\rjë  A6@@ ( ((((ØIAqE\r (((A6´  (Aj6  (((Ajó  (((AÐ\rjó  (((A\rjì  A6@@ ( ((((ØIAqE\r (((Aj (Atj( A ð   (Aj6 @ ((( (E\r  (((AjAjA(j (((AÌ	jÞ @ ((((Ð\r @ ((( ( \r @ ((((¸A GAqE\r @@ ((((°E\r  ((Ã  ((Ä @ ((( ( E\r  A6$@ ((((ÄA GAqE\r  ((((Ä! (( (((Aj ((((Ì   @ ((( (E\r  ((((ðA GAqE\r  ((((ð \r @ ($\r  ((( A6  A6$@ ((((ÔA GAqE\r @ ((((ÔA (Ø GAqE\r  ((((Ô×  (((A 6Ô@ ((((°E\r  ((( Aj  ((Å  ((½ @ ($\r  ((( A6   ($A GAsAq6, (,! A0j$  Â# A k! $    6  6  6  6@ ((J¬ \r A­Ñ Aª A¥Aè±   @@ ((J Aj Aj¨ \r  (( A6  A 6@ (( (E\r  (! (( 6¤ (! (( 6¬@@ (((ô\r  ((A6ø@@ (((ð E\r @ (\r  (Î AFAq\r (( ( AFAqE\r ((J©  ((J¦ @ (( ( AGAqE\r  (( A6  A 6@ ( ( ( ( (Ï E\r  ((J©  ((J¦  (( A6  A 6 ((J©  ((J¦ @ (A KAqE\r @@ ( (((¨IAqE\r  (! (((¨! ! (( 6¨@@ ( (((¬KAqE\r  (!	 (((¬!	 	!\n (( \n6¬ A6 (! A j$  À\n~~*# A k! $    6  6@ (A KAq\r AÈÄ Aª AýAæ°   @ (( ( E\r A®» Aª AþAæ°    A6@ ( (((KAqE\r @ (E\r  (( (¬A KAqE\r  A 6@ (!A !@ E\r  ( (( ((I!@ AqE\r  (!A !@ E\r  ( ((Aj (Atj ((Aj (Atjí A G!  Aq6  (Aj6 A 6@@ ( (((ÔIAqE\r A 6@ (!A !@ E\r  ( (( (I!@ AqE\r  (!	A !\n@ 	E\r  (AjAj (( (Atj( AÊ j (Atj (( (Atj(  (Atjé A G!\n  \nAq6@ (E\r  (( (Atj(  (Atj( !B !  7  7  (( (Atj(  (Atj!\r \r \r( Aj6   (Aj6 A 6@ (!A !@ E\r  (AI!@ AqE\r  (!A !@ E\r  (AjAj (( (Atj( A¸Ê j (Atj (( (Atj( A j (Atjé A G!  Aq6@ (E\r  (( (Atj( A j (Atj( !B !  7  7  (( (Atj( A j (Atj!  ( Aj6   (Aj6 (!A !@ E\r  (AjAj (( (Atj( AÀÊ j (( (Atj( A(jë A G!  Aq6@ (E\r  (( (¬A KAqE\r  (!A !@ E\r  ( (( (Atj( AÄÊ j (( (Atj( A,jí A G!  Aq6 A 6@ (!A !@ E\r  ( (( (I!@ AqE\r  A 6@ (!A !@ E\r  (AI!@ AqE\r  (!A !@ E\r  ( (( (Atj( AÈÊ j (Atj (Atj (( (Atj( AØ j (Atj (Atjé A G!  Aq6  (Aj6  (Aj6 A 6@ (!A ! @ E\r  ( (( (I! @  AqE\r  A 6@ (!!A !"@ !E\r  (AI!"@ "AqE\r  (!#A !$@ #E\r  (( (Atj( A¸Å j (Alj (Alj (( (Ä  A G!$  $Aq6 (!%A !&@ %E\r  (( (Atj( A¸Å j (Alj (Alj (( (Ä  A G!&  &Aq6  (Aj6  (Aj6 A 6@ (!\'A !(@ \'E\r  (AI!(@ (AqE\r  A 6@ (!)A !*@ )E\r  (AI!*@ *AqE\r  (!+A !,@ +E\r  ( (( (Atj( AË j (Atj (Atj (( (Atj( Aj (Atj (Atjé A G!,  ,Aq6  (Aj6  (Aj6 A 6@ (!-A !.@ -E\r  (AI!.@ .AqE\r  A 6@ (!/A !0@ /E\r  (AI!0@ 0AqE\r  (!1A !2@ 1E\r  (( (Atj( AøÆ j (Alj (Alj (( (Ä  A G!2  2Aq6  (Aj6  (Aj6 A 6@ (!3A !4@ 3E\r  (AI!4@ 4AqE\r  (!5A !6@ 5E\r  (( (Atj( A ë j (Alj (( (Ä  A G!6  6Aq6  (Aj6 (!7A !8@ 7E\r  (At (( (Atj( AË j (( (Atj( AÊ jì A G!8  8Aq6@ (( (¼E\r  (!9A !:@ 9E\r  (At (( (Atj( AË j (( (Atj( AÊ jê A G!:  :Aq6  (Aj6 @@@ (E\r  (!; (( ;6 (( A6   (6@ (( (¬A KAqE\r  (AKAqE\r  A 6@@ ( (( ((IAqE\r ((  (Atj(,!< <AK@@@@@@@@@@@@@@@@@@@@ < 	\n\r ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  ( \r ((Aj (Atj(  ( (( A,j (Atj*  ((Aj (Atj(  (  ((Aj (Atj(  ( \n ((Aj (Atj(  ( 	 ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  (  ((Aj (Atj(  ( (( A,j (Atj*  ((Aj (Atj(  ( (( A,j (Atj* (( A,j (Atj* (( A,j (Atj*  ((Aj (Atj(  ( (( A,j (Atj* (( A,j (Atj* (( A,j (Atj*  ((Aj (Atj(  ( (( A,j (Atj*  ((Aj (Atj(  ( AÊ Aª AAæ°     (Aj6 @ (A MAqE\r  ((A 6ø\n A6 (!= A j$  =Ñ~# A k! $    6  6@@@@ (( (äAIAq\r  (E\r@ (( ( E\r A®» Aª AçA¯´   @ (( (E\r  ((AÌ	j (((  (( ( (( ($ (( (AjAvà \r  (( A6  A 6 (((È	! (((  6J@ ( ((( Ð \r  A 6@ ((( (J» \r  (( A6  A 6@ ((( (J¬ \r AÒ Aª AA¯´   @@ ((( (J Aj§ E\r  ((( (J!Aÿÿ  /A (° ° \r (( A6  A 6@ ( (((  (( ($ (À \r  A 6@@ (((Ø (( (äIAqE\r  ((Aj (((ÜAtj! (! A A  ï  ((!  (ØAj6Ø@ (((à (((ÔFAqE\r   (( (((ÜAtj( A¼ë jí 6@ (!A!	@ \r  (( (((ÜAtj( (lA GAs!	@ 	AqE\r @ (\r  (( (((ÜAtj( A¼ë jì  ((A\rjë @@ (((ä (( (äAkKAqE\r  A 6  (( (((ìAtj( 6 ((!\n \n \n(äAj6ä ((!  (ìAj6ì@ (((ì (((ÔFAqE\r  ((A6ì ((A\rjì  (A¼ë jë  ( (Ò   (( (((ÜAtj( A¼ë jí 6 ((A\rjì  (( (((ÜAtj( A¼ë jë @@ (( (((ÜAtj( (lA GAsAqE\r (( (((ÜAtj( AÔë j (( (((ÜAtj( A¼ë jñ   A 6@ (( (((ÜAtj( (l\r  (( (((ÜAtj( A¼ë jì  A 6@ ( (( (((ÜAtj(  (( ($ (À \r  (( (((ÜAtj( A¼ë jì  A 6 (( (((ÜAtj( A¼ë jì @ (( (E\r  ((A\rjë @@ (((à (( ($j (((ÜKAqE\r ((A \rj ((A\rjñ   ((A\rjì  ((Aðjë  A 6@@ ( (( (IAqE\r ((A¼j (Atj(  (((àAtj! (((  (Atj( !\r (( ($At!@ E\r   \r ü\n    (Aj6  ((A\rjë  (( ($! ((!   (àj6à ((AÐ\rjò  ((A\rjì  ((Aðjì  (( (((ÜAtj( A¼ë jë  A 6@@ ( (( (IAqE\r (( (((ÜAtj(  (Atj( ! (((  (Atj( ! (( ($At!@ E\r    ü\n    (Aj6  (((È	! (( (((ÜAtj(  6J (( (((ÜAtj( A¼ë jì  ((A\rjë @ (((à (((ÔIAqE\r  ((!  (àAj6à ((!  (äAj6ä (( (((ÜAtj( A 6l ((AÐ\rjò  ((A\rjì  ((!  (ÜAj6Ü@ (((Ü (((ÔFAqE\r  ((A6Ü ((A 6Ä	 ((!  (È	Aj6È	 (( 5$! ((!   )À|7À A6 (! A j$  ·	~~# Aà k! $    6\\  (\\(Aj6<  (<)070  (<(6,  (<(6(@ (<( E\r Aùº Aª AíAÏ¶   @ (\\((¸A GAq\r Aà Aª AîAÏ¶    (\\((¸! (\\! (\\((Ì!@@ B     AFAqE\r  Aj¢  (\\! (\\( )è! (\\((¸! (\\((´! (\\((Ì!	@   Aj   	¤ \r  Aj£  A (Ü A (à jA (ä jA (è jA (ì jA (ð jA (ô jA (ø jAvAj6@ (Aj ($KAqE\r  (\\( A6  Aj£  (  (j!\n (<AjA(j! \n ) 7  \n )  7   A (Ü A (à jA (ä jA (è jA (ì jA (ð jA (ô jAkAvAj6@ (Aj ($KAqE\r  (\\( A6  Aj£  (  (j!Aÿ  -  Aðq: @ )0B B§Aÿq!\rAÿ  \r - @r: @  )0BBÿ§: A  )0BBÿ§: B  )0BBÿ§: C  )0Bÿ§: D (  (j! AÀ j!  - :   (  6   A (Ü A (à jAvAj6@ (Aj ($KAqE\r  (\\( A6  Aj£   (,AvAÿq: @  (,AvAÿq: A  (,Aÿq: B  ((AvAÿq: C  ((AvAÿq: D  ((Aÿq: E (  (j! AÀ j!  / ;   (  6   (\\! (\\( )è! (\\((¸! (\\((À! (\\((Ì!@   Aj   § \r  Aj£  Aj£  Aà j$ 	~~# Að k! $    6l  (l(Aj6L  (L)07@  (L(6<  (L(68  (L((64@ (L( E\r Aùº Aª AÁAä¶    A (Ü A (à jA (ä jA (è jA (ì jA (ð jA (ô jA (ø jAvAj6, (l((¸! (l (l( )è 5,| (l((Ì   !  60@@ E\r @ (0AFAqE\r  (l( A6  (l((À! (l! (LAjA(j! (l((Ì!A!A !	@    	 	    E\r  (l( A6  A (Ü A (à jA (ä jA (è jA (ì jA (ð jA (ô jAkAvAj6(  )@7  )@!\nA 5ø !@ \nB VAqE\r  B 7   (4AkAÿqAt ) B B§Aÿqr: P  ) BBÿ§: Q  ) BBÿ§: R  ) BBÿ§: S  ) Bÿ§: T (l((¸! (l (l( )è 5(| (l((Ì   !\r  \r60@ \rE\r @ (0AFAqE\r  (l( A6  (l((À! (l! AÐ j! (l((Ì!A!A !@         E\r  (l( A6  A (Ü A (à jAvAj6  (<AvAÿq: P  (<AvAÿq: Q  (<Aÿq: R  (8AvAÿq: S  (8AvAÿq: T  (8Aÿq: U (l((¸! (l (l( )è 5| (l((Ì   !  60@ E\r @ (0AFAqE\r  (l( A6  (l((À! (l! AÐ j! (l((Ì!A!A !@         E\r  (l( A6  (l((À	A GAqE\r  (l((À	( A KAqE\r  (l( )ðB VAqE\r  A 6@@ ( (l((À	( IAqE\r@ (l((À	( (Alj)  )@VAqE\r A ) ! (l((À	( (Alj 7   (Aj6  (l((À	 @ (l((À	 \r AÝÒ Aª A±Aä¶    (l((¸! (l (l( )ðB| (l((Ì   !  60@ E\r @ (0AFAqE\r  (l( A6  A 6@@ ( (l((À	( IAqE\r  (l((À	( (Alj) 7  )§: W  )B7  )§: V  )B7  )§: U  )B7  )§: T  )B7  )§: S  )B7  )§: R  )B7  )§: Q  )B7  )§: P  )B7  (l((À	( (Alj)7  )§: _  )B7  )§: ^  )B7  )§: ]  )B7  )§: \\  )B7  )§: [  )B7  )§: Z  )B7  )§: Y  )B7  )§: X  )B7  (l((À	( (Alj(6  (: a  (Av6  (: `  (Av6 (l((À! (l!  AÐ j!! (l((Ì!"A!#A !$@   ! # $ $ "   E\r  (l( A6   (Aj6  Að j$ ï# Ak! $    6@ (A GAq\r Aù Aª AAã´   @ (( (ÜA GAqE\r  (( (Ü¸  (( A 6Ü (( A 6à A 6@@ ( (( ((IAqE\r@ ((Aj (Atj( A GAqE\r  ((Aj (Atj( ¸  ((Aj (AtjA 6   (Aj6  A 6@@ ( (((ÔIAqE\r@@ (( (Atj( A FAqE\r  A 6@@ ( (( (IAqE\r@ (( (Atj( AÊ j (Atj( A GAqE\r  (( (Atj( AÊ j (Atj( ¸  (( (Atj( AÊ j (AtjA 6   (Aj6  A 6@@ (AIAqE\r@ (( (Atj( A¸Ê j (Atj( A GAqE\r  (( (Atj( A¸Ê j (Atj( ¸  (( (Atj( A¸Ê j (AtjA 6   (Aj6 @ (( (Atj( (ÀJA GAqE\r  (( (Atj( (ÀJ¸  (( (Atj( A 6ÀJ@ (( (Atj( (ÄJA GAqE\r  (( (Atj( (ÄJ¸  (( (Atj( A 6ÄJ A 6 @@ (  (( (IAqE\r A 6@@ (AIAqE\r@ (( (Atj( AÈÊ j ( Atj (Atj( A GAqE\r  (( (Atj( AÈÊ j ( Atj (Atj( ¸  (( (Atj( AÈÊ j ( Atj (AtjA 6   (Aj6   ( Aj6   A 6 @@ ( AIAqE\r A 6@@ (AIAqE\r@ (( (Atj( AË j ( Atj (Atj( A GAqE\r  (( (Atj( AË j ( Atj (Atj( ¸  (( (Atj( AË j ( Atj (AtjA 6   (Aj6   ( Aj6  @ (( (Atj( (KA GAqE\r  (( (Atj( (K¸  (( (Atj( A 6K@ (( (Atj( (KA GAqE\r  (( (Atj( (K¸  (( (Atj( A 6K A 6@@ (AIAqE\r (( (Atj( A¸Å j (Alj  (( (Atj( A¸Å j (AljAj   (Aj6  A 6@@ (AIAqE\r (( (Atj( AøÆ j (Alj  (( (Atj( AøÆ j (AljAj   (Aj6  A 6@@ (AIAqE\r (( (Atj( A ë j (Alj   (Aj6 @ (A KAqE\r  (( (Atj( (J£  (( (Atj( A¼ë jî  (( (Atj( AÔë jõ  (( (Atj( ¸  (( (AtjA 6   (Aj6 @ (( (äAKAqE\r  ((Aðjî  ((A\rjî  ((A \rjõ  ((AÐ\rjõ  ((Ajõ @ (( (E\r  A 6@@ ( (( (IAqE\r@ ((A¼j (Atj( A GAqE\r  ((A¼j (Atj( ¸  ((A¼j (AtjA 6   (Aj6 @ (( (E\r  A 6@@ ( (( (IAqE\r@ ((AðjAj (Atj( A GAqE\r  ((AðjAj (Atj( ¸  ((AðjAj (AtjA 6   (Aj6  Aj$ 	# A k! $    6  6  6  6  6  6 (! (! (!	 (!\n (! (!A !\r  \r  	 \n   \rÇ ! A j$  ÈN3~~# Ak! $    6ø  6ô  6ð  6ì  6è  6ä  6à  6Ü@ (øA GAq\r Aù Aª AÑAá²   @@ (ø( ( AGAqE\r  A\r6ü@@ (ðA FAq\r  (ìA GAqE\r (èA FAqE\r A6ü@@ (ø( (E\r  (ø( (AKAqE\r A6ü@@ (ø( (AGAqE\r  (ø( A 6 (ø( A 6@ (ø( (\r  (ø( A 6@@ (ø( (AIAq\r  (ø( (A KAqE\r A6ü@ (ø( (  \r  A6ü@ (ø( ($\r @@ (ø( (¬\r  (ø( A	6$ (ø( A 6$@@ (ø( ($AIAq\r  (ø( ($AÿÿKAqE\r A6ü@ (ø( (¬A KAqE\r  A6ü@ (ø( ($ (ø( (¬IAqE\r  A\n6ü@@ (ø( (°\r @@ (ø( (AIAqE\r  (ø( (AvAj!	@@A 	KAqE\r A!\n (ø( (AvAj!\n \n! (ø(  6°@@ (ø( (AFAqE\r @@ (ø( ($AÀMAqE\r  (ø( A6°@@ (ø( ($AMAqE\r  (ø( A6°@@ (ø( ($AÀMAqE\r  (ø( A	6°@@ (ø( ($A	MAqE\r  (ø( A\n6°@@ (ø( ($AMAqE\r  (ø( A6°@@ (ø( ($A$MAqE\r  (ø( A6° (ø( A\r6°@@ (ø( ($AMAqE\r  (ø( A\r6°@@ (ø( ($A	MAqE\r  (ø( A6° (ø( A6°@ (ø( (°AMAq\r AµÌ Aª AAá²   @@ (ø( (°AIAq\r  (ø( (°AKAqE\r A	6ü@ (ø( (E\r @ (ø( ($ (ø( (  \r  A6ü@ (ø( (  \r  A6ü@ (ø( (AGAqE\r  (ø( (AGAqE\r  (ø( (AGAqE\r  (ø( (AGAqE\r  (ø( (AGAqE\r  (ø( (A GAqE\r  A6ü@ (ø( (ÄAKAqE\r  A6ü@ (ø( ( A÷MAqE\r @ (ø( ($A$KAq\r  (ø( (¬AKAqE\r A6ü (ø( (Ä!A (¸ !\r@ A \rtOAqE\r A (¸ !A tAk! (ø(  6Ä@ (ø( (À (ø( (ÄOAqE\r  (ø( (Ä! (ø(  6À@ (ÜE\r  (ø( (ÜA GAqE\r  (ø( (àA KAqE\r  A 6À@@ (À (ø( (àIAqE\r@ (ø( (Ü (ÀAtj( A GAqE\r  (ø( (Ü (ÀAtj( ( AFAqE\r  (ø( !  (àAj6à@@ (À (ø( (àIAqE\r (ø( (Ü (ÀAjAtj( ! (ø( (Ü (ÀAtj 6   (ÀAj6À   (ÀAj6À @ (ÜE\r  (ø( (ÜA GAqE\r  (ø( (àAKAqE\r  A6¼@@ (¼ (ø( (àIAqE\r@ (ø( (Ü (¼Atj( A GAqE\r  (ø( (Ü (¼Atj( ( AFAqE\r   (ø( (Ü (¼Atj( 6¸@@ (¼A KAqE\r (ø( (Ü (¼AkAtj( ! (ø( (Ü (¼Atj 6   (¼Aj6¼  (¸! (ø( (Ü 6   (¼Aj6¼ @ (ø( (ÜA GAqE\r  (ø( (àA KAqE\r  A 6´@@ (´ (ø( (àIAqE\r@ (ø( (Ü (´Atj( A GAqE\r  (ø( (Ü (´Atj( ( AFAqE\r  (ø( (Ü (´Atj( Aj! (ø( 6À	  (´Aj6´ @ (ø( (ÜA FAqE\r  (ø( (àA KAqE\r  A6ü A 6Ð A 6Ì A 6È A 6Ä A 6Ø@@ (Ø (ø( (àIAqE\r  (ø( (Ü (ØAtj( 6°@ (°( \r  A6ü@@ (°( AFAqE\r @ (ÐE\r  A6ü A6Ð@ (°Aj \r  A6ü@@ (°( AFAqE\r @ (ÌE\r  A6ü A6Ì@@ (°( AFAqE\r @ (°Aj (°( A  \r  A6ü@ (°( AFAqE\r @ (°AjA  \r  A6ü@@ (°(AFAqE\r @ (ÈE\r  A6ü	 A6È@ (°(AFAqE\r @@ (°(A  E\r  (°(Aí»  \r (°(A GAq\r  (°( A GAqE\r A6ü	@ (°(AFAqE\r @ (ÄE\r  A6ü	 A6Ä  (ØAj6Ø  (ø(A 6 (ø(A 6Ä	 (ø(A 6È	 (ø(A¬\njå @ (ø((E\r  (ø(A 6¼\n@ (ø((E\r  (ø(A 6Ä\n@ (ø((E\r  (ø(A 6Ì\n@ (ø((E\r  (ø(A 6Ð\n@ (ø((E\r  (ø(A 6Ô\n@ (ø((E\r  (ø(A 6Ü\n@ (ø(( E\r  (ø(A 6à\n (ø(A 6ø\n (ø(A 6è\n (ø(A 6ì\n (ø(A 6ð\n (ø(A 6ô\n (ø(A 6ü\n (ø(A 6 (ø(A 6@ (ø((¬\nE\r  (ø( A 6  (Ü! (ø( 6°@ (ÜE\r  (ø( Aj \r  (ø( A6  A6ü (ô! (ø( 6´ (ð! (ø( 6À (ì! (ø( 6¸ (è! (ø( 6¼ (ä! (ø( 6Ä (à! (ø( 6Ì@ (ø( (äAKAqE\r  (ø( (äAtAj! (ø( 6Ô@ (ø(AðjA ê E\r  (ø( A6  A6ü@ (ø(A\rjA ê E\r  (ø(Aðjî  (ø( A6  A6ü@ (ø(A \rjA ô E\r  (ø(Aðjî  (ø(A\rjî  (ø( A6  A6ü@ (ø(AÐ\rjA ô E\r  (ø(Aðjî  (ø(A\rjî  (ø(A \rjõ  (ø( A6  A6ü@ (ø(AjA ô E\r  (ø(Aðjî  (ø(A\rjî  (ø(A \rjõ  (ø(AÐ\rjõ  (ø( A6  A6ü@ (ø( (E\r  (ø( ($Aj (ø((ÔAjl! (ø( 6Ü A 6Ø@@ (Ø (ø( (IAqE\r (ø((Ü!A î !  (ø(A¼j (ØAtj  6 @  A FAqE\r  (ø(Aðjî  (ø(A\rjî  (ø(A \rjõ  (ø(AÐ\rjõ  (ø(Ajõ  (ø( A6  A6ü  (ØAj6Ø  (ø(A 6à A6Ô@@ (Ô (ø((ÔIAqE\rAAì ¼ !! (ø( (ÔAtj !6 @ (ø( (ÔAtj( A FAqE\r  (ø( A6  A6ü¢ !" (ø( (ÔAtj(  "6J@ (ø( (ÔAtj( (JA FAqE\r  (ø( (ÔAtj( ¸  (ø( (ÔAtjA 6  (ø( A6  A6ü@ (ø( (ÔAtj( A¼ë jA ê E\r  (ø( (ÔAtj( (J£  (ø( (ÔAtj( ¸  (ø( (ÔAtjA 6  (ø( A6  A6ü@ (ø( (ÔAtj( AÔë jA ô E\r  (ø( (ÔAtj( A¼ë jî  (ø( (ÔAtj( (J£  (ø( (ÔAtj( ¸  (ø( (ÔAtjA 6  (ø( A6  A6ü A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A¨j (ØAàlj!# (ø( (ÔAtj( AèÄ j (ØAtj #6  (ø( (ÔAtj( A¨j (ØAàljA°j!$ (ø( (ÔAtj( AèÄ j (ØAtj $6  (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A¨7j (ØAàlj!% (ø( (ÔAtj( A¨Å j (ØAtj %6  (ø( (ÔAtj( A¨7j (ØAàljA°j!& (ø( (ÔAtj( A¨Å j (ØAtj &6  (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A¸Å j (ØAlj!\' (ø( (ÔAtj( A¸È j (ØAtj \'6  (ø( (ÔAtj( A¸Å j (ØAljAj!( (ø( (ÔAtj( A¸È j (ØAtj (6  (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( AøÆ j (ØAlj!) (ø( (ÔAtj( AøÈ j (ØAtj )6  (ø( (ÔAtj( AøÆ j (ØAljAj!* (ø( (ÔAtj( AøÈ j (ØAtj *6  (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A¸Å j (ØAlj  (ø( (ÔAtj( A¸Å j (ØAljAj   (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( AøÆ j (ØAlj  (ø( (ÔAtj( AøÆ j (ØAljAj   (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A ë j (ØAlj   (ØAj6Ø   (ÔAj6Ô  A 6Ø@@ (Ø (ø( ((IAqE\r (ø(Aj (ØAtjA 6  (ø(Aj (ØAtjA 6   (ØAj6Ø  A 6Ô@@ (Ô (ø((ÔIAqE\r A 6Ø@@ (Ø (ø( (IAqE\r (ø( (ÔAtj(  (ØAtjA 6  (ø( (ÔAtj( AÊ j (ØAtjA 6   (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( A j (ØAtjA 6  (ø( (ÔAtj( A¸Ê j (ØAtjA 6   (ØAj6Ø  (ø( (ÔAtj( A 6( (ø( (ÔAtj( A 6ÀJ (ø( (ÔAtj( A 6, (ø( (ÔAtj( A 6ÄJ A 6Ø@@ (Ø (ø( (IAqE\r (ø( (ÔAtj( AØ j (ØAtjA 6  (ø( (ÔAtj( AÈÊ j (ØAtjA 6  (ø( (ÔAtj( AØ j (ØAtjA 6 (ø( (ÔAtj( AÈÊ j (ØAtjA 6 (ø( (ÔAtj( A¸É j (ØAtjA 6   (ØAj6Ø  A 6Ø@@ (ØAIAqE\r (ø( (ÔAtj( Aj (ØAtjA 6  (ø( (ÔAtj( AË j (ØAtjA 6  (ø( (ÔAtj( Aj (ØAtjA 6 (ø( (ÔAtj( AË j (ØAtjA 6 (ø( (ÔAtj( AØÉ j (ØAtjA 6   (ØAj6Ø  (ø( (ÔAtj( A 6J (ø( (ÔAtj( A 6K (ø( (ÔAtj( A 6J (ø( (ÔAtj( A 6K  (ÔAj6Ô @ (ø (ø( ($Á \r  A6ü A 6Ô@@ (Ô (ø((ÔIAqE\r@ (ø( (ÔAtj( (J¥ \r  (ø( A6  A6ü  (ÔAj6Ô @ (ø( (E\r  (ø( ($Aj (ø((Ôl!+ (ø( +6 A 6Ø@@ (Ø (ø( (IAqE\r (ø((!,A ,î !- (ø(AðjAj (ØAtj -6 @ -A FAqE\r  (ø( A6  A6ü  (ØAj6Ø  (ø(A 6 @ (ø((ðA FAqE\r  !. (ø( .6ð@ (ø((ðA FAqE\r  (ø( A6  A6ü (ø((ð!/ (ø!0A !1A !2@ / 1 2 2 2 2A A A  0 E\r  (ø( A6  A6ü (ø(B 7° (ø(A 6¸ (ø(A 6¼ (ø(A 6À (ø(A 6Ä (ø(A 6È (ø(A 6Ð (ø(B 7à (ø( B 7è (ø( B 7ð (ø( B 7ø@ (ø( (E\r  (ø(A 6ô@ (ø(( (JA (Ô A (Ø ° \r  (ø( A6  A6ü (ø!3 (ø(( !4A !5@ 3 4 5 5À \r  A6ü@ (ø( (E\r  (ø(A6ô (ø(A 6 (ø(A 6 (ø(A"6 (ø( ($!6 (ø( 66  (ø( ($!7 (ø( 76¤ (ø(A 6¨ (ø(A 6¬ (ø( ( !8 (ø( 86° (ø( (!9 (ø( 96´ (ø( (!: (ø( :6¸ (ø( )Ð!; (ø( ;7À (ø(AjAjA(j!<B != < =7 < =7 @ (ø( (E\r  (ø(AÌ	jÝ @ (ø(Aj (ø(( (JAø \r  (ø( A6  A6ü (ø!> (ø(( !?A !@@ > ? @ @À \r  A6üA (ä !AA AtAk!B (ø( B6¨ (ø(B 7À@ (Ì\r  A6   (ø( (àA FAq6 A6 A 6 A 6 A 6 A 6 (ø(( (J!C@  CAø \r  (ø( A6  A6ü (ø!D (ø(( !EA !F@ D E F FÀ \r  A6ü A 6Ø@@ (Ø (ø( (àIAqE\r (Ø (ø( (àAkFAq!G (ø( (Ü (ØAtj(  G6@ (ø( (Ü (ØAtj(  (ø(( (JAø \r  (ø( A6  A6ü (ø!H (ø(( !IA !J@ H I J JÀ \r  A6ü  (ØAj6Ø @ (ø((¼A GAqE\r  (ø((¼!K (ø (ø( Aøj (ø((Ì K  AFAqE\r  (ø( A6  A6ü@ (ø( (E\r  (ø(A6ô A 6ü (ü!L Aj$  LÁ~~# AÐ k! $    6L  6H  6D  6@  6<  68  64  (D (@j (8v60 (8! A t6,@ (0 (@KAq\r AÁ Aª A¾%Aö°    (0ë !	 A  	k6( (@!\n A  \nk6@@ (4Aj ((IAqE\r  A 6  A 6$@@ ($ (,IAqE\r A 6  (0 (j6@@ (  (IAqE\r (L ( Atj( ! Au!   s k (j6  ( Aj6   5!\r (H ($Atj \r7   ($Aj6$  A 6  A 6$@@ ($ (,IAqE\r B 7  (0 (j6@@ (  (IAqE\r (L ( Atj( ! Au!   s k¬ )|7  ( Aj6   )! (H ($Atj 7   ($Aj6$  A 6  (,6  (8Ak6@@ ( (<NAqE\r  (,Av6, A 6 @@ (  (,IAqE\r (H (Atj)  (H (AjAtj) |! (H! (!  Aj6  Atj 7   (Aj6  ( Aj6    (Aj6  AÐ j$ ®\r# A k! $    6  6  6  6  (6  (((¬6@@ (((øE\r @ (( AOAq\r AùÌ Aª A(A³    (A6  (! (( !AÐ !@ E\r    ü\n   ((A 6ø@ (\r AÊ Aª A©(A³   @ ( (( IAqE\r  (! ( 6  (!	 (((¤!\n (( !@ E\r  	 \n ü\n   (( ! ((!\r \r  \r(¤j6¤ (( ! ((!  (¬ k6¬A ! A j$  »~# AÀ k! $    68  64  60  6,  (,6(  (4(6   (4( 6  (At6@@ ((( ( AFAqE\r  A6< A 6$@@ ($ ( IAqE\r@ (0 ($Atj(  (((AðjAj ($Atj(  (þ A GAqE\r  A 6 A 6 A 6 A 6@@ ( (IAqE\r@ (0 ($Atj(  (Atj(  (((AðjAj ($Atj(  (Atj( GAqE\r   (6  (((AðjAj ($Atj(  (Atj( 6  (0 ($Atj(  (Atj( 6  (Aj6 @ ( (IAq\r A° Aª AÒ(A÷²   @ (4(AFAq\r A¿¸ Aª AÓ(A÷²    (4) 5|! ((( 7° (4) 5§! ((( 6¸ ($! ((( 6¼ (! ((( 6À (!	 ((( 	6Ä (!\n ((( \n6È ((( A6  A6<  ($Aj6$  (! (((!  (  k6  A 6$@@ ($ ( IAqE\r (((AðjAj ($Atj( !\r (((AðjAj ($Atj(  (Atj! (((( At!@ E\r  \r  ü\n    ($Aj6$  A 6< (<! AÀ j$  %# Ak!   6  6  6<# Ak!   6  6  6  (6  ( ( A6 Ã# Ak! $    6@ (A GAq\r Aù Aª AãA   @ ((A GAq\r A¤³ Aª AäA   @ (( A GAq\r Aîµ Aª AåA    (( ($! Aj$  # Ak! $    6@ (A GAq\r Aù Aª AA   @ ((A GAq\r A¤³ Aª AA   @ (( A GAq\r Aîµ Aª AA   @@ (( (E\r @ (((ðA FAqE\r  A6  (((ð 6 A	6 (! Aj$  \n	~~~~# AÐ k! $    6H  6D  6@  6<  68 B 7(@@ (<\r  (D!Aÿ  -  Aÿ q6$@ (H((¼A GAqE\r  (H((¼! (H! (H((Ì!	  A(j 	   AFAqE\r  (H( A6  A6L@@ ($\r  )(!\n (H(  \n7è@ ($AFAqE\r  (H( )ðB QAqE\r  )(! (H(  7ð@ (H((À	A GAqE\r  (H( )øB VAqE\r  (H((À	( A KAqE\r   (HÍ 6   (H()à7  ) 5 |B}7  (H((Ð6@@ ( (H((À	( IAqE\r  (H((À	( (Alj) 7@ ) )VAqE\r @@ ) )ZAqE\r @ )(B QAqE\r  (H((¼A GAqE\r  (H((¼! (H!\r (H((Ì! \r A(j    AFAqE\r  (H( A6  A6L )! (H((À	( (Alj 7  )( (H( )ø}! (H((À	( (Alj 7 ( ! (H((À	( (Alj 6 (H(!  (ÐAj6Ð (H(!  (ÐAj6Ð  (Aj6 @@ (H((°E\r   (H( Aj (D (@ (< (H((È	 (8 (H((À (H (H((Ì¡ 64 (H((À!  (H (D (@ (< (H((È	 (H((Ì   64@@ (4\r  5@! (H(!   )Ø|7Ø 5<! (H(!   )à|7à@@ (H((è (H((È	AjKAqE\r  (H((è! (H((È	Aj! ! (H( 6è (H( A6   (46L (L! AÐ j$  Ö$\n~~&# AÐk! $    6È  6Ä  (È( (À6 A6 (È((¤! (Ä 6¸k  (È( ($ 6@@ ( (È( (ÄIAqE\r  (! (È( (Ä!  6@@ ( (IAqE\r  (! (!  6  (È( ($6  (È( ( 6  (È( (6  A 6¤  (È( (6¨ A 6¬  (Ä(J6°@@ (È( (E\r @@ (È( (E\r  B 7x B 7p@@ (È( (AIAqE\r  A6l@@ (l (È( ($IAqE\r  (Ä(  (lAtj(  (Ä(  (lAkAtj( k6h  (Ä( (lAtj(  (Ä( (lAkAtj( k6d (h! Au!  s k! (d!	 	Au!\n   	 \ns \nkj¬ )x|7x (h (djAu! Au!  s k!\r (h (dk! Au!  \r  s kj¬ )p|7p  (lAj6l  A6l@@ (l (È( ($IAqE\r  (Ä(  (lAtj4  (Ä(  (lAkAtj4 }7X  (Ä( (lAtj4  (Ä( (lAkAtj4 }7P@@ )XB SAqE\r  )X!B  }! )X! !@@ )PB SAqE\r  )P!B  }! )P!   | )x|7x@@ )X )P|BB SAqE\r  )X )P|B!B  }! )X )P|B! !@@ )X )P}B SAqE\r  )X )P}!B  }! )X )P}!   | )p|7p  (lAj6l @@ )x )pTAqE\r  A6 A 6 A 6¤ A 6 A6 A6¤ A6 A6 A6 A 6@ (\r  (\r AÖ£ Aª AÞA¹±   @ (E\r @ (È( (AFAq\r AðÀ Aª AåA¹±   @@ (È( (A IAqE\r  A 6L@@ (L (È( ($IAqE\r (Ä(  (LAtj(  (Ä( (LAtj( k! (Ä($ (LAtj 6  (Ä(  (LAtj(  (Ä( (LAtj( jAu! (Ä(  (LAtj 6   (LAj6L  A 6L@@ (L (È( ($MAqE\r (Ä(  (LAtj4  (Ä( (LAtj4 }! (Ä(( (LAtj 7  (Ä(  (LAtj4  (Ä( (LAtj4 |B§! (Ä(  (LAtj 6   (LAj6L @ (E\r  A 6@@ ( (È( (IAqE\r  (Ä (Atj(  (È( ($ç 6H@ (H (È( (KAqE\r   (È( (6H (H! (ÄA¨j (Aàlj 6Ø (ÄA¨j (Aàlj 6¨ (È( ( (Hk! (ÄA0j (Atj 6   (Aj6 @ (E\r @ (È( (AFAq\r AðÀ Aª AA¹±    A 6@@ (AIAqE\r@@@ (È( (A IAq\r  (\r  (ÄA j (Atj(  (È( ($ç 6D  (Ä(( (ÄA j (Atj(  (È( ($è 6D@ (D (È( (KAqE\r   (È( (6D (D!  (ÄA¨7j (Aàlj  6Ø (ÄA¨7j (Aàlj  6¨ (È( ( (Dk!! (!"A !# !A # "j!$ (ÄAÐ j (Atj $6   (Aj6 @@ (E\r  A 6@@ ( (È( (IAqE\r@ (È( (ØE\r  (E\r  (Aj (È( (FAqE\r  (ÄA6¸k (È!% (Ä!& (!\' (!( (ÄA0j (Atj( !) (Ä (Atj( !* (ÄAèÄ j (Atj!+ (ÄA¸È j (Atj!, (ÄAØ j (Atj!- (ÄA¸É j (Atj!. (ÄAàÉ j (Atj!/@ % & \' ( Aj ) * + , - . /é \r  A 6Ì@ (ÄA¨j (Aàlj (ÄA¸É j (Atj( A°lj( E\r  A 6  (Aj6 @ (E\r @ (È( (AFAq\r AðÀ Aª A¶A¹±    A 6@@ (AIAqE\r@@ (ÄAÐ j (Atj( A MAqE\r   (ÄA j (Atj( 6@  (Ä((6@ (È!0 (Ä!1 (!2 (!3 (ÄAÐ j (Atj( !4 (@!5 (ÄA¨Å j (Atj!6 (ÄAøÈ j (Atj!7 (ÄAj (Atj!8 (ÄAØÉ j (Atj!9 (ÄAÊ j (Atj!:@ 0 1 2 3 Aj 4 5 6 7 8 9 :é \r  A 6Ì  (Aj6 @@@@ (E\r  (\r (È( (E\r A 6< A 68 A 64 A 60@ (È( (AFAq\r AðÀ Aª AÚA¹±   @ (È( (\r   (Ä(àI (Ä(äIj6  (Ä(àI (Ä(Jj6  (Ä(äI (Ä(Jj6  (Ä(J (Ä(Jj6 A 6, (,!;  Aj ;Atj( 6 A6@@ (ALAqE\r (!<@ Aj <Atj(  (IAqE\r  (!=  Aj =Atj( 6  (6,  (Aj6   (,6¤ (Ä(J!>@ Aj >ù \r  (È( A6  A 6Ì (¤!? ?AK@@@@@@ ?   (ÄA¨j (Ä(¸IA°lj64  (ÄA¨jAàj (Ä(¼IA°lj60  (ÄA¨j (Ä(¸IA°lj64  (ÄA¨7jAàj (Ä(ÜIA°lj60  (ÄA¨7jAàj (Ä(ÜIA°lj64  (ÄA¨jAàj (Ä(¼IA°lj60  (ÄA¨7j (Ä(ØIA°lj64  (ÄA¨7jAàj (Ä(ÜIA°lj60AÊ Aª AA¹±    (¤!@ @AK@@@@@@ @   (Ä(06<  (Ä(468  (Ä(06<  (Ä(T68  (Ä(T6<  (Ä(468  (Ä(P6<  (Ä(T68AÊ Aª A¦A¹±   @ (È ( (< (4 (Ä(Jê \r  A 6Ì@ (È ( (8 (0 (Ä(Jê \r  A 6Ì@ (\r AÆ Aª A°A¹±    (Ä(J!A@ Aj Aù \r  (È( A6  A 6Ì A 6@@ ( (È( (IAqE\r@ (È ( (ÄA0j (Atj(  (ÄA¨j (Aàlj (ÄA¸É j (Atj( A°lj (Ä(Jê \r  A 6Ì  (Aj6  A6Ì (Ì!B AÐj$  B§# A k! $    6  (6 ((A\rjë  ((!  (èAj6è ((A\rjì @@ ((A\rjë @ (((´E\r  ((A\rjì  A 6@@ (((ä\r  ((!  (¸Aj6¸@ (((ä (((èKAqE\r  ((!  (¸Aj6¸@@ (((¸AlHAqE\r  ((A 6¸ ((Ajò @ (((¸AJAqE\r  (((èAKAqE\r  ((A 6¸ ((!  (èAj6è ((Aj ((A\rjñ  ((!  (èAj6è@ (((ä!A !@ \r  (((°!	A!\n@ 	\r  (((àA F!\n \n!@ AqE\r @ (((´E\r  ((A\rjì  A 6 ((AÐ\rj ((A\rjñ @@ (( (E\r  (((°\r  (((àA KAqE\r  A 6 ((A6°@@ (((àA KAqE\r  (((à6 ((A\rjì @ ((AÌ	j ((A¼j (( ( ( (( (AjAvà \r  (( A6  A 6 ((Aðjë  A 6@@ ( (( (IAqE\r ((A¼j (Atj( ! ((A¼j (Atj(  (Atj! (((à (kAt!\r@ \rE\r    \rü\n    (Aj6  ((A\rjë  (! ((!  (à k6à ((A \rjò  ((Aðjì   ((A 6° ((A\rjì @@ (((äA KAqE\r  A 6  (( (((ìAtj( 6 ((!  (äAj6ä ((!  (ìAj6ì@ (((ì (((ÔFAqE\r  ((A6ì ((A\rjì  (A¼ë jë @ ( (Ò \r  A 6 ((A\rjì   (! A j$  ê# Ak! $    6  6 A6@ (E\r  ( (Ð \r  A 6@ (E\r  ((J» \r  (( A6  A 6@ (E\r  ((J¬ \r AàÑ Aª AAÌ±   @ (E\r @ ((J Aj§ E\r  ((J!Aÿÿ  /A (° ° \r (( A6  A 6 (! ( 6l (A6l (AÔë jò  (A¼ë jì A! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AA±   @ ((A GAq\r A¤³ Aª AA±   @ (( A GAq\r Aîµ Aª AA±   @@ (( ( AGAqE\r  A 6 (! ((  6 A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª A²AË   @ ((A GAq\r A¤³ Aª A³AË   @ (( A GAq\r Aîµ Aª A´AË   @@ (( ( AGAqE\r  A 6 (! ((  6 A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª A½A    @ ((A GAq\r A¤³ Aª A¾A    @ (( A GAq\r Aîµ Aª A¿A    @@ (( ( AGAqE\r  A 6 (! ((  6 A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AÈAº   @ ((A GAq\r A¤³ Aª AÉAº   @ (( A GAq\r Aîµ Aª AÊAº   @@ (( ( AGAqE\r  A 6 (! ((  6  A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AÿAý   @ ((A GAq\r A¤³ Aª AAý   @ (( A GAq\r Aîµ Aª AAý   @@ (( ( AGAqE\r  A 6 (! ((  6 A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AA©   @ ((A GAq\r A¤³ Aª AA©   @ (( A GAq\r Aîµ Aª AA©   @@ (( ( AGAqE\r  A 6 (! ((  6 A6 (! Aj$  ­!!}"}}}}}}}|}	# Aà k! $    6X  6T@ (XA GAq\r Aù Aª AA   @ (X(A GAq\r A¤³ Aª AA   @ (X( A GAq\r Aîµ Aª AA   @ (TA GAq\r AÖ Aª AA   @@ (X( ( AGAqE\r  A 6\\ (X( A 6(@  (TA; 6P@@ (PA GAqE\r  (P (Tk! (T !  6L@@ (LAFAqE\r  (T! (L!Aº    A FAqE\r  (X( A,j! (X( ! ((!  Aj6(  AtjA 6 @@ (LA\rFAqE\r  (T!	 (L!\nA  	 \n A FAqE\r  (X( A,j! (X( ! ((!\r  \rAj6(  \rAtjA6 @@ (LAFAqE\r  (T! (L!A¸    A FAqE\r  (X( A,j! (X( ! ((!  Aj6(  AtjA6 @@ (LAFAqE\r  (T! (L!A¯    A FAqE\r  (X( A,j! (X( ! ((!  Aj6(  AtjA6 @@ (LAFAqE\r  (T! (L!A    A FAqE\r  (X( A,j! (X( ! ((!  Aj6(  AtjA6 @@ (LAFAqE\r  (T! (L!Aõ    A FAqE\r  (X( A,j! (X( !   ((!!   !Aj6(  !AtjA6 @@ (LAKAqE\r  (T!"AéÝ  "A A FAqE\r   (TAjA ¤ ¶8H@ *H»A ·dAqE\r  *H»D      à?eAqE\r  *H!# (X( A,j (X( ((Atj #8 (X( A,j!$ (X( !% %((!& % &Aj6( $ &AtjA6 @@ (LAFAqE\r  (T!\' (L!(AÃ  \' ( A FAqE\r  (X( A,j!) (X( !* *((!+ * +Aj6( ) +AtjA6 @@ (LAFAqE\r  (T!, (L!-A  , - A FAqE\r  (X( A,j!. (X( !/ /((!0 / 0Aj6( . 0AtjA6 @@ (LA\rFAqE\r  (T!1 (L!2A  1 2 A FAqE\r  (X( A,j!3 (X( !4 4((!5 4 5Aj6( 3 5AtjA	6 @@ (LAFAqE\r  (T!6 (L!7AÝ  6 7 A FAqE\r  (X( A,j!8 (X( !9 9((!: 9 :Aj6( 8 :AtjA\n6 @@ (LA	FAqE\r  (T!; (L!<A²¡  ; < A FAqE\r  (X( A,j!= (X( !> >((!? > ?Aj6( = ?AtjA6 @@ (LAFAqE\r  (T!@ (L!AA¼¡  @ A A FAqE\r  (X( A,j!B (X( !C C((!D C DAj6( B DAtjA6 @@ (LAKAqE\r  (T!EAâÝ  EA A FAqE\r   (TAjA ¤ ¶8D@ *D»A ·fAqE\r  *D»D      ð?eAqE\r  *D!F (X( A,j (X( ((Atj F8 (X( A,j!G (X( !H H((!I H IAj6( G IAtjA\r6 @@ (LAKAqE\r  (T!JAÉÝ  JA A FAqE\r   (TAjA ¤ ü6@  (TA/ 6<@@ (<A GAqE\r @@ (<AjA ¤ ¶C¤p}?]AqE\r  (<AjA ¤ ¶!KC¤p}?!K K!LCÍÌÌ=!L  L88 *8!MC  ? M!N C  ? NC  ?84@@ (<A GAqE\r  (<Aj!O (T!O  OA/ 60@@ (0A GAqE\r  (0AjA ¤ ¶!PCÍÌL>!P  P8,@@ (@ALAqE\r  *,!Q (X( A,j (X( ((Atj Q8 (X( A,j!R (X( !S S((!T S TAj6( R TAtjA\r6 @ (X( (( (@jA IAqE\r  A 6(@@ (( (@HAqE\r *,!U (X( A,j (X( ((Atj U8 ((² (@² *4!V (X( A,j (X( ((Atj V8 ((Aj² *4 (@² *4!W (X( A,j (X( ((Atj W8 (X( A,j!X (X( !Y Y((!Z Y ZAj6( X ZAtjA6   ((Aj6( @@ (LAKAqE\r  (T![A¹Ý  [A A FAqE\r   (TAjA ¤ ü6$  (TA/ 6 @@ ( A GAqE\r @@ ( AjA ¤ ¶C¤p}?]AqE\r  ( AjA ¤ ¶!\\C¤p}?!\\ \\!]CÍÌL>!]  ]8 *!^C  ? ^!_ C  ? _C  ?8@@ ( A GAqE\r  ( Aj!` (T!`  `A/ 6@@ (A GAqE\r  (AjA ¤ ¶!aCÍÌL>!a  a8@@ ($ALAqE\r  *!b (X( A,j (X( ((Atj b8 (X( A,j!c (X( !d d((!e d eAj6( c eAtjA\r6 @ (X( (( ($jA IAqE\r  A 6@@ ( ($HAqE\r *!f (X( A,j (X( ((Atj f8 (² ($² *!g (X( A,j (X( ((Atj g8 (Aj² * ($² *!h (X( A,j (X( ((Atj h8 (X( A,j!i (X( !j j((!k j kAj6( i kAtjA6   (Aj6 @@ (LAKAqE\r  (T!lAØÝ  lA A FAqE\r   (TAjA ¤ ü6@ (AJAqE\r   (TA/ 6@@ (A GAqE\r  (AjA ¤ ¶»!mD      à?!m  m¶8 @@ * C  ?^AqE\r  C  ?8 @ * A ²]AqE\r  A ²8  (!n (X( A,j (X( ((Atj n6 *  (²!o (X( A,j (X( ((Atj o8 (X( A,j!p (X( !q q((!r q rAj6( p rAtjA6 @ (LAFAqE\r  (T!s (L!tA¿  s t A FAqE\r  (X( A,j!u (X( !v v((!w v wAj6( u wAtjA6 @@ (X( ((A FAqE\r @@ (PA GAqE\r   (PAj6T@ (X( ((\r  (X( A6( (X( A\r6, (X( C   ?80 A6\\ (\\!x Aà j$  x# Ak! $    6  6@ (A GAq\r Aù Aª AAÒ   @ ((A GAq\r A¤³ Aª AAÒ   @ (( A GAq\r Aîµ Aª AAÒ   @@ (( ( AGAqE\r  A 6 (! ((  6¬ A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª A Aé   @ ((A GAq\r A¤³ Aª A¡Aé   @ (( A GAq\r Aîµ Aª A¢Aé   @@ (( ( AGAqE\r  A 6 (! ((  6° A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª A«A   @ ((A GAq\r A¤³ Aª A¬A   @ (( A GAq\r Aîµ Aª A­A   @@ (( ( AGAqE\r  A 6 (! ((  6´ A6 (! Aj$  î# Ak! $    6  6@ (A GAq\r Aù Aª A¶Aß   @ ((A GAq\r A¤³ Aª A·Aß   @ (( A GAq\r Aîµ Aª A¸Aß   @@ (( ( AGAqE\r  A 6 A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AÈAÙ   @ ((A GAq\r A¤³ Aª AÉAÙ   @ (( A GAq\r Aîµ Aª AÊAÙ   @@ (( ( AGAqE\r  A 6 (! ((  6¸ A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AÓA   @ ((A GAq\r A¤³ Aª AÔA   @ (( A GAq\r Aîµ Aª AÕA   @@ (( ( AGAqE\r  A 6 (! ((  6À A6 (! Aj$  # Ak! $    6  6@ (A GAq\r Aù Aª AÞAæ   @ ((A GAq\r A¤³ Aª AßAæ   @ (( A GAq\r Aîµ Aª AàAæ   @@ (( ( AGAqE\r  A 6 (! ((  6Ä A6 (! Aj$  î# Ak! $    6  6@ (A GAq\r Aù Aª AAÃ   @ ((A GAq\r A¤³ Aª AAÃ   @ (( A GAq\r Aîµ Aª AAÃ   @@ (( ( AGAqE\r  A 6 A6 (! Aj$   	# A k! $    6  6  6@ (A GAq\r Aù Aª AA¥¯   @ ((A GAq\r A¤³ Aª AA¥¯   @ (( A GAq\r Aîµ Aª AA¥¯   @@ (( ( AGAqE\r  A 6@ (A FAqE\r  A 6@ (A FAqE\r  A 6@ (( (ÜA GAqE\r  (( (Ü¸  (( A 6Ü (( A 6à@ (E\r  (!A î !  6@ A FAqE\r  A 6 (! (! (At!@ E\r    ü\n   (!	 ((  	6Ü (!\n ((  \n6à@ (( Aj ( \r  A 6 A6 (! A j$  Ã# Ak! $    6@ (A GAq\r Aù Aª AýAÎ   @ ((A GAq\r A¤³ Aª AþAÎ   @ (( A GAq\r Aîµ Aª AÿAÎ    (( ( ! Aj$  Ã# Ak! $    6@ (A GAq\r Aù Aª AÓA±    @ ((A GAq\r A¤³ Aª AÔA±    @ (( A GAq\r Aîµ Aª AÕA±     (( (! Aj$  ¼	# AÀ k! $    68  64  60 A 6( A 6$  (8( (6  (8( ($6 (8( (!A  k! Aÿÿÿÿ u6 (8( (!A  k! Ax u6@ (8A GAq\r Aù Aª AØA®   @ (8(A GAq\r A¤³ Aª AÙA®   @ (8( A GAq\r Aîµ Aª AÚA®   @@ (8( ( E\r  A 6<@@@ (Aj (8((Ä	k (0 ((kIAqE\r  (Aj (8((Ä	k! (0 ((k!  6@ (8( (E\r  (8(AðjAj (4 (( ( (æ  A 6 @@ (  (IAqE\r@ (4 ( Atj( A FAqE\r  A 6<  (8((Ä	6,  ((6$@ (, (M!	A !\n 	Aq! \n!@ E\r  ($ (0I!@ AqE\r @@ (4 ( Atj(  ($Atj(  (HAq\r  (4 ( Atj(  ($Atj(  (JAqE\r (8( A6  A 6<  (,Aj6,  ($Aj6$ (8((  ( Atj(  (8((Ä	Atj!\r (4 ( Atj(  ((Atj! (At!@ E\r  \r  ü\n    ( Aj6    ( ((j6( (! (8(!   (Ä	j6Ä	@ (8((Ä	 (KAqE\r @ (8((Ä	 (AjFAq\r A£· Aª AöA®   @ (8A Â \r  A 6< A 6 @@ (  (IAqE\r (8((  ( Atj(  (Atj( ! (8((  ( Atj(  6   ( Aj6   (8(A6Ä	 (( (0IAq\r  A6< (<! AÀ j$  # A k! $    6  6  6  6  6 A 6@@ ( (IAqE\r ( (Atj(  (($Atj! ( (Atj(  (Atj! (At!@ E\r    ü\n    (Aj6  (!	 (!\n \n 	 \n($j6$@ (($ (( MAq\r A Aª A(AÁ²    A j$ Ó# A k!   6  6 A 6 A 6@ ( (I!A ! Aq! !@ E\r  (AqA GAs!@ AqE\r   ( (Atj(  (r6  (Aj6@@ (\r  A 6 A 6@@ (AqA GAsAqE\r  (Au6  (Aj6 @ (A KAqE\r  A 6@@ ( (IAqE\r (! ( (Atj!  (  u6   (Aj6  (ê# A k!   6  6  6 B 7  A 6@ ( (I!A ! Aq! !@ E\r  ) BB RAs!@ AqE\r   ( (Atj)  ) 7   (Aj6@@ ) B QAqE\r  A6 A 6@@ ) BB RAsAqE\r  ) B7   (Aj6 @ (A KAqE\r  A 6@@ ( (IAqE\r ( (Atj)  5§! ( (Atj 6   (Aj6  (# AÐk! $    6Ì  6È  6Ä  6À  6¼  6¸  6´  6°  6¬  	6¨  \n6¤  6 @@ (Ìä AKAqE\r A (Ì !\rA (È !\r  \r6@ (¼( A KAq\r AÚÄ Aª AâAé³    A 6@@ (Ì((¬E\r  (¼( AOAqE\r  A6  (Ì (´ (¼(  (¸ (° (Atj( í 6 (! (  6 @ (¼( AKAqE\r  A 6@@ (¸AIAqE\r @@ (¸ (¼( AkAlë jA IAqE\r  (Ì((ì\n!  (´Aj (¼( Ak Aj   6( (Ì((ð\n!  (´Aj (¼( Ak Aj   6(@@ (¸A MAqE\r  (Ì((ô\n!  (´Aj (¼( Ak Aj   6(  (´A j (¼( Ak Ajò 6(@ (È(¸k\r  *»A ·aAqE\r  A6@@ (¸A MAqE\r   (´6 A6@@ ( (¼( IAqE\r@ ((  ( (Atj( GAqE\r  A 6  (Aj6   (´6 A6@@ ( (¼( IAqE\r@ ()  ( (Atj) RAqE\r  A 6  (Aj6 @@ (E\r @@ (¸A MAqE\r   (Ì (´4  (¼(  (¸ (° (A GAsAqAtj( î 6   (Ì (´)  (¼(  (¸ (° (A GAsAqAtj( î 6 @ (  (IAqE\r   (A GAsAq6  ( 6@@ (Ì((¨E\r  (Ì( (¬\r (AFAqE\r@@ (Ì( (¸E\r  A 60 A6, ((!  6,  60@ (, (¼( OAqE\r   (¼( Ak6,  (06$@@ ($ (,MAqE\r@@ ($At Ajj*  (¸³`AqE\r   (Ì (È (´ (¨ (A GAsAqAtj(  (È(J (È(J (¼(  (¸ ($ ( (Ä (À (Ì( (¼ (Ì( (È (° (A GAsAqAtj(  (¬ (A GAsAqAtj( ï 6 @ (  (IAqE\r   (A GAsAq6  ( 6  ($Aj6$ @ (Ì( (¬A KAqE\r @@ (Ì( (¬ (¼( OAqE\r   (¼( Ak6H  (Ì( (¬6H@ (HA KAqE\r  A 6Ø A6Ü A 6à@@ (Ø (Ì( ((IAqE\r  (H6  (Ì! (È! (¼( ! AÐ j! (¸! (´!@   AØj      AÀ jð \r @@ (Ì( (¸E\r  A6L (@!  6   6L  (L6D@@ (D ( MAqE\r (D!  At AÐ jjAxj+  (¼(  k 9ø@@ +ø (¸¸fAqE\r @@ (Ì( (´E\r  A6<@@ (¸AMAqE\r  (¸!@@A  k (Dë kAIAqE\r  (¸!A  k (Dë k!A!  68@@ (8 (<KAqE\r  (8! (<!  68 A68 (Ì( (°!  68  6<  (<64@@ (4 (8MAqE\r  (Ì (È (´ (¨ (A GAsAqAtj(  (È(J (È(J (ÈA Ë j (DAkAtj (¼(  (¸ (D (4 ( (Ä (À (Ì( (¼ (Ì( (È (° (A GAsAqAtj(  (¬ (A GAsAqAtj( ñ 6 @ ( A KAqE\r @ (  (IAqE\r   (A GAsAq6  ( 6  (4Aj64   (DAj6D  @ (AFAqE\r @ (E\r AýÅ Aª A®!Aé³     (Ì (´ (¼(  (¸ (° (Atj( í 6 (!  (¤  6  (!! (  !6 A!" AÐj$  "¹# A k! $    6  6  6  6  6 (( ! AK@@@@@@@  @ (Aj ( ((¨ (ú \r  (( A6  A 6@ (Aj ( ((k ( ((¨ (û \r  (( A6  A 6@ (Aj ( ((k ( ((¨ (þ \r  (( A6  A 6@ (Aj ( ( ((¨ (ÿ \r  (( A6  A 6AÊ Aª AÁ"Aû³    A6 (! A j$  h# Ak! $    6@ (A KAq\r A¿Ã AÅ AAË¾    (ì As! Aj$  `# Ak! $    6@ (A KAq\r A¿Ã AÅ AÌ Aß¾    (g! Aj$  Æ# A k!   6  6  6  6  6 (A6 @@ (A MAqE\r  (A 6 (! ( 6 (A6 (! ( 6 A (Ø A (Ü jA (à j ((¨j ( (lj6 (~# A k!   6  7  6  6  6 (A 6  )! ( 7 A (Ø A (Ü jA (à j ((¨j (j6  ( ¦~# AÐ k! $    6L  6H  6D  6@  6<  68  64  60  6,  	6(  \n6$  6   6  \r6  6  6  (4 (,k6 @@ (0 (,jA MAqE\r  (D (,Atj (  (, (@ó @@ (0A MAqE\r  (D (,Atj (  (, (@ô  (D (,Atj (  (, (@õ  (A6  (A 6 (! ( 6 (@! ( 68  (L( (H (@ (< (8 (  (, (( ($ (  (0 ( ( (Ajò 6 (,! ( 6@@ (0A MAqE\r  A 6@@ ( (,IAqE\r (D (Atj4 ! (AjAj (Atj 7   (Aj6  A 6@@ ( (,IAqE\r (D (Atj) ! (AjAj (Atj 7   (Aj6  A (Ø A (Ü jA (à j ((¨j (, (0lj6 (! (!@@ A kIAqE\r   ( (j6 A6 (! AÐ j$  Ê		|# A0k!	 	$  	  6( 	 6$ 	 6  	 6 	 6 	 6 	 6 	 6 	 6 	((( A,j 	( ( Atj!\n 	(  \n6@@@ 	( (AFAqE\r @@ 	(A MAqE\r  	( 	(((Aj 	( ( Atj(  	($(, 	(û  	( 	(((Aj 	( ( Atj(  	($(, 	(ü  	((((ø\n! 	($(, 	( 	(( Aj 	( Aj   @@ 	( (( AFAqE\r  	A 6@@ 	( 	(( IAqE\r 	( Aj! 	( Aj!\r 	(( At!@ E\r   \r ü\n   	 	(Aj6  	( !  (Aj6 	( !  ( Aj6 @ 	( 	( (nA MAqE\r  	( (( 	(  	( Aj 	( Ajó  	A 6,@@ 	( (Aq\r @@ 	(A MAqE\r  	( 	(((Aj 	( ( Atj(  	($(, 	( 	( 	( (nAv 	( (Av 	(l 	( (ný  	( 	(((Aj 	( ( Atj(  	($(, 	( 	( 	( (nAv 	( (Av 	(l 	( (nþ  	((((ø\n! 	($(, 	( 	( (n 	(( Aj 	( Aj    	A 6 @@ 	(  	(( IAqE\r 	( Aj 	( Atj+  	( Aj 	( Atj+ ¡! 	( Aj 	( Atj 9  	 	( Aj6   	( (( 	(  	( Aj 	( Ajó @ 	( +A ·aAqE\r  	A 6, 	( Aj 	( 	($A Ë j 	(  	(! 	(( ! 	(! 	(!@@ 	((( (´E\r A! 	((( (°!     j ! 	( 6  	A6, 	(,! 	A0j$  ¤\r~# Aðk! $    6è  6ä  6à  6Ü  6Ø  6Ô  6Ð  6Ì  6È  	6Ä  \n6À  6¼  6¸  \r6´  6°  6¬  6¨  6¤  (Ì (Äk6@ (ÈAMAqE\r @ (ÄA KAq\r AÄ Aª Aä#A´   @ (ÄA MAq\r AÍ Aª Aå#A´    (À! (È!@@ A  k (Äë kIAqE\r  (À! (È!A  k (Äë k!  6À  (Ð (Ä (À A j Aj 6@@ (E\r  A 6ì@@ (È A j (Ä ( A KAqE\r @@ (ÈA MAqE\r @ (à (ÄAtj ( A j (Ä ( (Ü \r  A 6ì@ (à (ÄAtj ( A j (Ä ( (Ü \r  A 6ì@@ (È A j (Ä A MAqE\r @@ (ÈAMAqE\r  (ÀAMAqE\r  (è((! (à (ÄAtj ( A j (Ä ( (Ü    (è((ü\n! (à (ÄAtj ( A j (Ä ( (Ü    (è((! (à (ÄAtj ( A j (Ä ( (Ü    (¨A6  (¨A 6 (¤! (¨ 6 (Ü! (¨ 6   (è( (ä (Ü (Ø (Ô ( (Ä (¼ (¸ (´ (È (° (¬ (¨Ajò 6 (Ä! (¨ 6 (À! (¨ 6 (! (¨ 6 (¨AjAj A jAü\n  @@ (ÈA MAqE\r  A 6@@ ( (ÄIAqE\r (à (Atj4 ! (¨AjAj (Atj 7   (Aj6  A 6@@ ( (ÄIAqE\r (à (Atj) !  (¨AjAj (Atj  7   (Aj6  A (Ø A (Ü jA (à j (¨(¨jA (Ð jA (Ô j (Ä (À (Èjlj6 (!! (!"@@ !A "kIAqE\r   ( (j6 A6  (6ì (ì!# Aðj$  #ø# Aà k! $    6\\  6X  6T  6P  6L  6H  6D  6@  6<  	68  \n64  60  6,  \r6( A 6  A 6 A 6  (H (Dj6  (8 ( (D 68@@ (< (8IAqE\r  (<! (8!  6< (\\(è\n! (T (P (H (D (< (8 (4   @ (0E\r  (T (L (H (D (< (8ô   (86 A 6@@ ( (<NAqE\r@ (0 (LA FAqGAq\r AþÜ Aª Aô$Aù±    (P (Atj!@@ (0E\r  (L (Atj!A !@   (H (D (@ (, ( (0 (XA ë j (A GAsAqAlj A$jõ \r @ ( \r A·É Aª A%Aù±    (! A t (j6@@ ( E\r  ($ ( IAqE\r  ($6   (A GAsAq6  (6  (Aj6  (! (( 6  (((6 (( ! (XA ë j (Alj( ! (!A tAt!@ E\r    ü\n  @ (0E\r  ((! (XA ë j (Alj(! (!A tAt!@ E\r    ü\n   A 6@@ (! (! A tIAqE\r@ ((  (Atj( A (È OAqE\r  ((A6   (Aj6  ( ! Aà j$  # Ak!   6  6  6  6 @@ (( AFAqE\r @@ ( ( \r  ( A6  ( A 6  (!  ( Aj6 @@ ( (  (( AtAkIAqE\r  ( !  ( Aj6  ( A 6  (!  ( Aj6 @ ((  (KAqE\r  (!  ( Aj6  (A6  ( A 6 \n# Aà k! $    6\\  6X  6T  6P  6L  6H A 6<  (T (Pj68  (H6D@ (DA NAqE\r  (D! A t6  (8 (Dv6@ ( (PKAq\r AÁ Aª Aÿ%A±    A 6  A 6,@@ (, (IAqE\r  (6$@ (,\r  (P!  ($ k6$ A 60 A 6(@@ (( ($IAqE\r (\\!	 ( !\n  \nAj6   	 \nAtj( 64@@ (4A HAqE\r   (4As (0r60  (4 (0r60  ((Aj6( @@ (0E\r  (0ë Aj!A! ! (X (,Atj 6   (,Aj6,   (6< A 6@  (DAj6D@@ (D (LNAqE\r (D!\r A \rt6 A 6@@ ( (IAqE\r  (X (@Atj( 6  (@Aj6@@@ ( (X (@Atj( KAqE\r  (! (X (@Atj( ! ! (X (<Atj 6   (@Aj6@  (<Aj6<  (Aj6   (DAj6D  Aà j$ Ø# Að k!\n \n$  \n  6h \n 6d \n 6` \n 6\\ \n 6X \n 6T \n 6P \n 6L \n 6H \n 	6D \nA 64 \nA (´ A (¸ j60 \n(P! \nA t6@ \n(XA (Ì MAq\r Aè· Aª Aí&Aé´    \n \n(H( 6, \n \n(H(6( \n \n(` \n(\\j \n(Pv6 \n(! \nA n6 \nA 6  \nA 6$@@@ \n($ \n(IAqE\r \n \n(6@@ \n($A KAqE\r  \n \n(6@ \n( \n(\\MAqE\r  \nA 6l \n(\\!\r \n \n( \rk6 \n(! \nA n6 \n \n(h \n($Atj) 7 @@@ \n) BTAq\r  \n) B} \n5~BB QAqE\r \nA 6@ \n \n) B} \n5~Bö Aj6@@ \n(@ \n(XOAqE\r  \n \n(XAk6@ \nA68 \n \n(@ \n( \n(h \n($Atj) ÷ 6<@ \n(< \n(8IAqE\r  \n \n(@64 \n \n(<68@ \n(LE\r  \nA (À A (Ä j \n(d \n($Atj(  \n(lj6<@@ \n(< \n(8MAqE\r  \n(d \n($Atj( A IAqE\r  \n(d \n($Atj( ! \n(( \n($Atj 6  \nA 64 \n \n(<68 \n(( \n($AtjA 6  \n(4! \n(, \n($Atj 6  \n(8! \n(0!@@ A kIAqE\r  \n \n(8 \n(0j60 \nA60 \n \n( \n( j6  \n \n($Aj6$  \n(0! \n(D 6  \nA6l \n(l! \nAð j$  d# Ak! $    7@ )B VAq\r A¿Ã AÅ A®A½£    )y§A?s! Aj$  ó~# Ak!   6  6  7 A (¼  (Aj (lj­!@@ (E\r  )  (Ak­! ) B!@@  | (Av­}BÿÿÿÿTAqE\r A (¼  (Aj (lj­!@@ (E\r  )  (Ak­! ) B!  | (Av­}!Bÿÿÿÿ! §Ç~# AÀ k! $    68  64  60 A (°¥  6   (4­ 6@ (4¬ \r AÜÊ Aµ­ A5A   @@ (4 (8(A (ü ° \r  A 6<@ (4 (8( A ( ° \r  A 6<  (8(6$@ (8( AFAqE\r  (0E\r @ (8(E\r  (8(A GAq\r A¿ Aµ­ AÂ A    (8(!  ($ k6$  (  ($j6$ ($!A ( !@ A tIAq\r AÃÔ Aµ­ AÆ A    ($!A ( !@ A tOAqE\r  A 6<@ (4 ($A ( ° \r  A 6< (8( !	 	AK@@@@@@@@@ 	  (8(!\nA (Ü !@ \nA tIAq\r AåÕ Aµ­ AÏ A   @ (4 (8(A (Ü ° \r  A 6<	 (8(!A (à !\r@ A \rtIAq\r AþÔ Aµ­ AÒ A   @ (4 (8(A (à ° \r  A 6<	 (8(!A (ä !@ A tIAq\r A³× Aµ­ AÕ A   @ (4 (8(A (ä ° \r  A 6<	 (8(!A (è !@ A tIAq\r AÌÖ Aµ­ AØ A   @ (4 (8(A (è ° \r  A 6<	@ (8(  \r AãÐ Aµ­ AÛ A   @ (4 (8( A (ì ° \r  A 6<	@ (8($A KAq\r AÒÃ Aµ­ AÞ A    (8($!A (ð !@ A tMAq\r AæÓ Aµ­ Aß A   @ (4 (8($AkA (ð ° \r  A 6<	@ (8((A KAq\r AöÄ Aµ­ Aâ A    (8((!A (ô !@ A tMAq\r AÙ Aµ­ Aã A   @ (4 (8((AkA (ô ° \r  A 6<	 (8)0!A 5ø !@@ B ZAqE\r  (4!A (ø !@ B  ³ \r  A 6<@ (4 (8)0A (ø ³ \r  A 6<\n@ (4 (8AjA(jA¶ \r  A 6<	@ (4 (8(At¯ \r  A 6<@ (4 (8AjA (ü Av¶ \r  A 6<@ (4 (8( (8(A (ü Avk¶ \r  A 6< A 6,@@ (, (8(IAqE\r@ (4 (8( (,Alj) A ( ³ \r  A 6<@ (4 (8( (,Alj)A ( ³ \r  A 6<@ (4 (8( (,Alj(A ( ° \r  A 6<  (,Aj6, @@ (0E\r @ (4 ( µ \r  A 6<@ (4A (°¥  ( ¶ \r  A 6<@ (4 (8(µ \r  A 6<@ (4 (8( (8(¶ \r  A 6<@ (4 (8(µ \r  A 6< A 6,@@ (, (8(IAqE\r@ (4 (8( (,Atj( µ \r  A 6<@ (4 (8( (,Atj( (8( (,Atj( ¶ \r  A 6<  (,Aj6, @A (È AqE\r A¼Æ Aµ­ AA   @ (4 (8AjA (È Av¶ \r  A 6<@ (4 (8)A (Ì ³ \r  A 6< (4! (8( !@ AA  A (Ð ° \r  A 6<@ (4A (Ô ¯ \r  A 6<@ (4 (8(¤A (Ø ° \r  A 6< A 6,@@ (, (8(¤IAqE\r  (8(¨ (,Atj6@ (4 () A (¬ ³ \r  A 6< (4! (!Aÿ@  - A (° ° \r  A 6<@A (´ AqE\r AýÆ Aµ­ A­A   @ (4 (A	jA (´ Av¶ \r  A 6<@ (4 (- AqAÿqA (¸ ° \r  A 6< (4! (- !A! @      vqAÿqA (¼ ° \r  A 6<@ (4A (À ¯ \r  A 6< (4!! (!"Aÿ@ ! "- A (Ä ° \r  A 6< A 6(@@ ((!# (!$Aÿ # $- IAqE\r  (( ((Atj6@ (4 () A (  ³ \r  A 6< (4!% (!&Aÿ@ % &- A (¤ ° \r  A 6<@ (4A (¨ ¯ \r  A 6<  ((Aj6(   (,Aj6, @ (4 (8(A (Ü ° \r  A 6<  (8( 6@ (4 (A (à ° \r  A 6<@ (4 (8( (¶ \r  A 6<  (8( 6@ (4 (A (ä ° \r  A 6<@ (4 (8( (¶ \r  A 6<@ (4 (8(A (è ° \r  A 6<@ (4 (8( A (ì ° \r  A 6<@ (4 (8($A (ð ° \r  A 6<@ (4 (8((A (ô ° \r  A 6<@ (4 (8(,A (ø ° \r  A 6<@ (4 (8(0 (8(,¶ \r  A 6<@ (4 (8( (8(¶ \r  A 6<  (4­ 6@ ( (IAqE\r  A 6< (!\'  ( \'k6@@ (Aq\r  ( ($AtA jGAqE\r A 6<@ (4¬ \r AÜÊ Aµ­ AñA    A6< (<!( AÀ j$  (ö# A k! $    6  6@ (¬ \r AÜÊ Aµ­ AúA   @@ (A ( A ( ° \r  A 6 (!A ( !@ A  ° \r  A 6 (! ((!A !@ A  A ( ° \r  A 6@@ (( A KAqE\r  (( AÿÿMAq\rAþË Aµ­ AA    A 6 (( !@@@@@@@@@@@@@@@ AÀF\r  AF\r AF\r AÀF\r AF\r A	F\r AF\r AF\r A F\r	 A$F\r AÀ F\r\n AF\r AF\r\r A6\r A6 A6 A6\n A6	 A6 A	6 A\n6 A6 A6 A\r6 A6 A6@@ (( AMAqE\r  A6 A6 A6 A6@ ( (A ( ° \r  A 6@ (( \r A¬Ð Aµ­ A¡A    A 6 ((!	@@@@@@@@@@ 	AÀ>F\r  	Aý F\r 	A¢¬F\r 	AÀ»F\r 	AúF\r 	AÄØF\r 	A÷F\r@@@ 	A±F\r  	AîF\r\n 	Aâ\nF\r 	AÜF\r A6 A6\n A6	 A6 A6 A6 A6 A6 A	6 A\n6 A6@@ ((AÈMAqE\r  ((Aèp\r  A6 A6@@ ((Aöÿ\'MAqE\r  ((A\np\r  A6 A6@@ ((AÿÿMAqE\r  A\r6 A\r6 A 6@ ( (A ( ° \r  A 6@@ ((A KAqE\r  ((!\nA (ð ! \nA tMAqE\r  ((AMAq\rAË Aµ­ A½A    ((! AK@@@@@@    ((Ak6@ ((AFAq\r AÚÀ Aµ­ AÃA    A6@ ((AFAq\r AÚÀ Aµ­ AÇA    A	6@ ((AFAq\r AÚÀ Aµ­ AËA    A\n6AÊ Aµ­ AÏA   @ ( (A (  ° \r  A 6@@ ((A KAqE\r  ((!\rA (ô ! \rA tMAq\rAØ Aµ­ AÔA    ((Axj! AK@@@@@@@@   A6 A6 A6 A6 A6 A6 A 6@ ( (A (¤ ° \r  A 6 (!A (¨ !@ A  ° \r  A 6@@ ((\r @ ( ((¹ \r  A 6@ ( ()º \r  A 6@ (E\r  (! (( Ak! (AF!@  AA Aq° \r  A 6 (Atj! AK@@@@  @ ( ((AènA° \r  A 6@ ( ((A° \r  A 6@ ( ((A\nnA° \r  A 6@ ( Aj« \r  A 6 (!Aÿ@  - A (¬ ° \r  A 6 A6 (! A j$  \n# A k! $    6  6  6  6 (!A (ä ! (!  AA  rA (Ø A (Ü jA (à j° !A !	@ E\r @@ (E\r  ( (Ak· !\nA !	 \n\rA !AAq! !	 E\r ( ()  (´ A G!	  	Aq6 (!\r A j$  \rò# A k! $    6  6  6  6  6 (!A (ì  ((Atr! (!@@  AA  rA (Ø A (Ü jA (à j° \r  A 6@ (E\r @ ( (Ak· \r  A 6 A 6@@ ( ((IAqE\r@ ( (Aj (Atj)  (´ \r  A 6  (Aj6 @ ( (ü \r  A 6@@ (( AK\r @ ( ((0 ( (( (((  ((( (( (( AFAqý \r  A 6AÊ Aµ­ A¶Aô£    A6 (!	 A j$  	É# Ak! $    6  6@@ ( (( A (´ ° \r  A 6@@ (( AK\r @ ( ((A (¸ ° \r  A 6AÊ Aµ­ AA¾µ    A6 (! Aj$  # AÐ k! $    6H  6D  6@  6<  68  64  60  6,@@ (,E\r A (À !	A (¼ !	  	6(@@ (,E\r A (Ì !\nA (È !\n  \n6$@@ (0\r @@ (4( \r @ (H (8(  ((° \r  A 6L@ (H (D (@ (8( ¸ \r  A 6L@ (8( E\r AÆ Aµ­ A©Aÿ´   @ (H ($ ((° \r  A 6L@ (H (4( A (Ä ° \r  A 6L A 6 @@ (  (@IAqE\r@ (H (D ( Atj(  (4( ² \r  A 6L  ( Aj6   A6L A 6 A 6  (@ (<j (0v6 A 6@@ (! (0! A tIAqE\r  (6@ (\r  (<!\r  ( \rk6  ( (j6@@ (4 (Atj( \r @ (H (8 (Atj(  ((° \r  A 6L@ (H (D (Atj ( (k (8 (Atj( ¸ \r  A 6L@ (H ($ ((° \r  A 6L@ (H (4 (Atj( A (Ä ° \r  A 6L  (6@@ ( (IAqE\r@ (H (D (Atj(  (4 (Atj( ² \r  A 6L  (Aj6   (6  (Aj6  A6L (L! AÐ j$  ³# A k! $    6  6  6  6  6 (!A (ð  ((AkAtr! (!@@  AA  rA (Ø A (Ü jA (à j° \r  A 6@ (E\r @ ( (Ak· \r  A 6 A 6@@ ( ((IAqE\r@ ( (Aj (Atj)  (´ \r  A 6  (Aj6 @ ( ((AkA (Ð ° \r  A 6@ ( ((A (Ô ² \r  A 6 A 6@@ ( ((IAqE\r@ ( (Aj (Atj(  ((² \r  A 6  (Aj6 @ ( (ü \r  A 6@@ (( AK\r @ ( (( ( (( (((  ((( (( (( AFAqý \r  A 6AÊ Aµ­ AäA¹¦    A6 (!	 A j$  	# A0k! $    6(  6$  6   6  6 (!A (è ! (!@@  AA  rA (Ø A (Ü jA (à j° \r  A 6,@ (E\r @ ( (Ak· \r  A 6,@@ (((\r   ((( 6@ ( A!IAq\r A¹¾ Aµ­ A÷AÁ    A 6@@ ( ($IAqE\r@ ( ( (Atj(  ( ² \r  A 6,  (Aj6   ((( 6@ ( A!FAq\r A¦¾ Aµ­ AAÁ    A 6@@ ( ($IAqE\r@ ( ( (Atj)  ( ´ \r  A 6,  (Aj6  A6, (,!	 A0j$  	£}# Ak!   6  6  (Ak6@@ (AqE\r  A 6 @@ (  (AmLAqE\r ( ²C   @ (²! ( ( Atj 8   ( Aj6  @@ (  (LAqE\r ( ²C   @ (²!C   @ ! ( ( Atj 8   ( Aj6   A 6 @@ (  (AmAkLAqE\r ( ²C   @ (²! ( ( Atj 8   ( Aj6  @@ (  (LAqE\r ( ²C   @ (²!C   @ ! ( ( Atj 8   ( Aj6  Á}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ² (²! C   ¿CÂõ¾CR¸? »D-DTû!@¢¶Ì C\\Â¾! ( ( Atj 8   ( Aj6   Aj$ ×|}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·! D-DTû!@¢! (·!  £¶Ì C   ¿C=\n×> D-DTû!)@¢ £¶Ì C\n×£=! ( ( Atj 8   ( Aj6   Aj$ ô|}# Ak! $    6  6  (Ak6 A 6 @@ (  (LAqE\r ( ·! D-DTû!@¢! (·!  £¶Ì C&ú¾C®·> D-DTû!)@¢ £¶Ì C´«> DÒ!3|Ù2@¢ £¶Ì Cy]?¼! ( ( Atj 8   ( Aj6   Aj$ Î|}# A0k!   6,  6(  ((Ak6$  ($·D       @£9 A 6@@ ( ($LAqE\r (·! +!   ¡ £9 +!  ¢! D      ð? ¡9 +!  ¢¶! (, (Atj 8   (Aj6 |}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·! D-DTû!@¢! (·!  £¶Ì C¼PÕ¾CºÀ\\> D-DTû!)@¢ £¶Ì Cpõ> DÒ!3|Ù2@¢ £¶Ì Cp+«½ D-DTû!9@¢ £¶Ì C¿¦ã;! ( ( Atj 8   ( Aj6   Aj$ |}# A0k! $    6,  6(  8$  ((Ak6   ( ·D       @£9@@@ *$A ²^AqE\r  *$C   ?_Aq\r (, ((C  >  A 6@@ ( ( LAqE\r (·! +!   ¡  *$»¢£9 +!  D      à¿¢¢Ñ ¶! (, (Atj 8   (Aj6  A0j$ ¬}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·D-DTû!@¢ (·£¶Ì Cë¾Cq=\n?! ( ( Atj 8   ( Aj6   Aj$ ¬}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·D-DTû!@¢ (·£¶Ì C   ¿C   ?! ( ( Atj 8   ( Aj6   Aj$ ô|}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·! D-DTû!@¢! (·!  £¶Ì CÛùþ¾CòÒÍ> D-DTû!)@¢ £¶Ì C9´È= DÒ!3|Ù2@¢ £¶Ì Coº! ( ( Atj 8   ( Aj6   Aj$ ô|}# Ak! $    6  6  (Ak6 A 6 @@ (  (HAqE\r ( ·! D-DTû!@¢! (·!  £¶Ì Cyuú¾Ch\'º> D-DTû!)@¢ £¶Ì C½à> DÒ!3|Ù2@¢ £¶Ì CX.¼! ( ( Atj 8   ( Aj6   Aj$ a# Ak!   6  6 A 6@@ ( (HAqE\r ( (AtjC  ?8   (Aj6 ²}# Ak!   6  6@@ (AqE\r  A6@@ ( (AjAmLAqE\r (²C   @ (²C  ?! ( (AkAtj 8   (Aj6 @@ ( (LAqE\r ( (kAjAt² (²C  ?! ( (AkAtj 8   (Aj6  A6@@ ( (AmLAqE\r (²C   @ (²C  ?! ( (AkAtj 8   (Aj6 @@ ( (LAqE\r ( (kAjAt² (²C  ?! ( (AkAtj 8   (Aj6 Ù|}}# A k! $    6  6  8@@ *»A ·eAqE\r  ( ( @@ *»D      ð?fAqE\r  ( ( @@@ *A ²^AqE\r  *C  ?]Aq\r ( (C   ?   *C   @ (²ü Ak6 ( ( @ (A JAqE\r  A 6@@ ( (LAqE\r (! ·!D-DTû!	@!  ¢ (·£¶Ì C   ¿C   ?! ( Atj 8  (! (!	   	j·¢ 	·£¶Ì C   ¿C   ?!\n ( ( (kAk (jAtj \n8   (Aj6  A j$ æ\n}}}}}# A0k! $    6,  6(  8$  8   8  *  ((²ü 6  * ((²ü 6  ( (k6@@ *$A ²_AqE\r  (,! ((! * ! *!	  CÍÌL=  	 @@ *$C  ?`AqE\r  (,!\n ((! * ! *!\r \n C33s?  \r @@@ *$A ²^AqE\r  *$C  ?]Aq\r (,! ((! * ! *!  C   ?     *$C   @ (²ü 6 A 6@ ( (H!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (, (AtjA ²8   (Aj6 A6@ ( ( (jH!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?! (, (Atj 8   (Aj6  (Aj6@ ( ( (kH!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (, (AtjC  ?8   (Aj6  (6@ ( (H!A !  Aq!!  !"@ !E\r  ( ((H!"@ "AqE\r  (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?!# (, (Atj #8   (Aj6  (Aj6@@ ( ((HAqE\r (, (AtjA ²8   (Aj6  A0j$ Ê\n}}}}}}}# A0k! $    6,  6(  8$  8   8  *  ((²ü 6  * ((²ü 6@@ *$A ²_AqE\r  (,! ((! * ! *!	  CÍÌL=  	 @@ *$C  ?`AqE\r  (,!\n ((! * ! *!\r \n C33s?  \r @@@ *$A ²^AqE\r  *$C  ?]Aq\r (,! ((! * ! *!  C   ?     *$C   @ (²ü 6  *$C   @ (( (k²ü 6 A 6 A6@ ( (H!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?! (, (Atj 8   (Aj6  (Aj6@ ( ( (kH!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (, (AtjC  ?8   (Aj6  (6@ ( (H!A ! Aq! !@ E\r  ( ((H!@ AqE\r  (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?! (, (Atj 8   (Aj6  (Aj6@ ( (H! A !!  Aq!" !!#@ "E\r  ( ((H!#@ #AqE\r  (, (AtjA ²8   (Aj6 A6@ ( ( (jH!$A !% $Aq!& %!\'@ &E\r  ( ((H!\'@ \'AqE\r  (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?!( (, (Atj (8   (Aj6  (Aj6@ ( (( (kH!)A !* )Aq!+ *!,@ +E\r  ( ((H!,@ ,AqE\r  (, (AtjC  ?8   (Aj6  (6@@ ( ((HAqE\r (·D-DTû!	@¢ (·£¶Ì C   ¿C   ?!- (, (Atj -8   (Aj6  (Aj6  A0j$ ½|}# A0k!   6,  6(  ((Ak6$  ($·D       @£9 A 6@@ ( ($LAqE\r (·! +!   ¡ £9 +!  ¢!D      ð? ¡¶! (, (Atj 8   (Aj6 ÷# Ak! $    6@@ (Aj ((¯ E\r  A 6@ (Aðj» E\r  A 6 (A6 (A6 (( !A!@ \r  ((¨A G! Aq! ( 6 (A 6  (A 6¬ (A 6¤ (A 6¬ (A 6° (A 6¤ (A 6  (A 6¨A AA0 ! ( 6è@ A FAqE\r  A 6 ((è!AÀ! A  ü  (A6¨ A6 (! Aj$  »# Ak! $    6  6  6 @@@ (E\r  ( \r  (A ¹ 6 (! ( !@ A nKAqE\r  (¸  A 6  ( ( ( l 6 (! Aj$  # Ak! $    6  6  (6  ( (¹ 6 @ (A KAqE\r  ( A FAqE\r  (¸  ( ! Aj$  Ä# Ak! $    6 (Aðj¼  (Aj° @ ((èA GAqE\r  A 6@@ ( ((¨IAqE\r ((è (A0lj($¸   (Aj6  ((è¸  (A 6è Aj$ ,# Ak!   6 (A6  (A 6¨j# Ak! $    6 (AjÄ  (AðjÃ  (A 6  (A 6¬ (A 6¤ Aj$ # Ak! $    6 (  (A 6¬ (A 6°@@ (( \r  ((¨E\r (A6 (A6 (A 6 Aj$ ­\r~~# AÐ k! $    6H  6D  6@  6<  68  64  60  (@( 6, A	6( (@A 6 @@ (@(  (,I!A !	 Aq!\n 	!@ \nE\r  (H( A GAs!@ AqE\r @ (H(¤E\r  (H(¬E\r @ (@( A KAqE\r  A 6L A6L@@ (H(¬E\r @@ (H(ÀE\r   (, (@( k6$@@ (H(Ì ($MAqE\r   (H(Ì6$ (D! (H(È!\r ($!@ E\r   \r ü\n   ($! (@!   ( j6   ($ (Dj6D (HA 6À@ (H(ÔE\r @@ (H(¨\r  (HA6  (HA6¤ (H(¬Aj! (H 6°@ (H \r  A6L@ (H(¬ (H(¤OAqE\r @ (H(¬ (H(¤FAq\r A¤ Aâ§ AïAÃ    (H)Ø! (H(è (H(¬A0lj 7@ (8A GAqE\r  (8! (4! (0!@  Aj    \r  ) (H4ø} (H4ü|! (H(è (H(¬A0lj 7 (H!  (¤Aj6¤ (HA6@ (H(´\r  (HA6 (HA 6¬ (D! (H(È! ($!@ E\r    ü\n   ($! (@!   ( j6   ($ (Dj6D ($! (H!   (Èj6È ($! (H!     (Ì k6Ì  (HAj (HAÈjÆ 6@@ (A JAqE\r  (HA6À@ (H(ÌA JAqE\r  (H(È!!Aÿ !-  !"Aÿ "A - ¦ FAqE\r   (H(È6@ (H(ÌA	HAqE\r  A6L	  (Aj6@ (A (¨ Aþ E\r  A6L	  (Aj6 (!#Aÿ #-  !$ (H $6  (Aj6 (!%Aÿ %-  !& (H &6@ (H(AGAqE\r  A6L	 (H!\' \' \'(ÈA	j6È (H!( ( ((ÌA	k6Ì@@ (\r  (HA 6¬ A6L  (HAðj (HA°jÁ 6@@ (A JAqE\r   (H (8 (4 (0 6@ (E\r   (6L@@ (\r   (H (< (, (@( k (4 (0 6@ (E\r   (6L A6L@ (H( E\r  (@( \r  (H(è (H(¬A0ljA6( A6L A 6L (L!) AÐ j$  )# Ak! $    6@@@ ((¬ ((¨OAq\r  ((° ((¨OAqE\r A 6 ((è ((¨AtA0 !  6@ A FAqE\r  A 6 (! ( 6è ((è ((¨A0lj! ((¨A0l!A !@ E\r    ü  (!  (¨At6¨ A6 (! Aj$  î	~# A0k! $    6(  6$  6   6@ (((E\r @ (((¼AJAqE\r  (((¸!Aÿ -  !Aÿ A - ¦ FAqE\r  ((A°jAjAjA (¨ Aþ E\r  ((A6 ((A°j­ ! (( 6 ((Aj (((Å  ((A 6@ (((° ((( OAqE\r  (((°Aj! (( 6  (((!	 (((è (((°A0lj 	6 @ ($A GAqE\r  ($!\n ( ! (!@  Aj  \n  \r  ) ((4ø} ((4ü| ((4´} ((4¼}!\r (((è (((°A0lj \r7@ (((E\r @ (((E\r  ((A°jª \r  ((A 6@@@ ((Aj ((A°jÂ \r  ((A6¬ ((A 6À@ (((E\r @ ((A°jª E\r  ((A6@ (((° (((¤OAqE\r   (((è (((°A0lj6@ (( Aq\r  A 6 (($ (( AjA !  6@ A FAqE\r  A6, (! ( 6$ ((A°j­ ! (($ (( Atj 6  (!  ( Aj6  A 6, (,! A0j$  # A0k! $    6(  6$  6   6  6@@ ( AÀ KAqE\r  ( !AÀ !  6  ((Aðj (¾ 6@@ (A FAqE\r  A6,  (6 ($! (! (!	 (!\n  	 Aj \n   ! AK@@@@@   ((A6  A6,AÊ Aâ§ AÉ A·   @ ((Aðj (¿ A HAqE\r AÊ Aâ§ AÎ A·    A 6, (,! A0j$  °# Ak! $    6  6  6 @@@ (E\r  ( \r  (A ¹ 6 (! ( !@ A nKAqE\r  A 6  ( ( ( l¹ 6 (! Aj$  # Ak! $    6@@ (Aj (( ¯ E\r  A 6 (A 6 (A6 (B 7 (B 7 A6 (! Aj$  9# Ak! $    6 (Aj°  Aj$ j# Ak!   6  6 (!A (¬ !@@ A tIAqE\r  (! ( 6 A6 A 6 (+# Ak!   6 (A 6  (A 6õ	~~~~# AÀk!	 	$  	  6¸ 	 6´ 	 6° 	 6¬ 	 6¨ 	 6¤ 	 6  	 6 	 6 	 	(¬A FAq6@@@ 	(¸(E\r B !\n 	 \n7 	 \n7 	 \n7x 	 \n7p 	 	(¸) 	5¬|7@@ 	(¸(E\r  	 	A0j6,@ 	(°A&GAqE\r AÊ A§ AA   A - ¦ ! 	(, :   	 	(,Aj6, 	(,A (¨ (  6   	 	(,Aj6, 	(,A -  :   	 	(,Aj6, 	(,A :   	 	(,Aj6, 	(¸(Av! 	(, :   	 	(,Aj6, 	(¸(!\r 	(, \r:   	 	(,Aj6, 	(,A ( Ð 6   	 	(,Aj6, 	(,! 	(´! 	(°!@ E\r    ü\n  @ 	(, 	(°j 	A0jkA3FAq\r AÊ A§ A­A    	 	A0j6p 	A36t 	A6x 	(¸A 6 	 	(´6p 	 	(°6t@ 	(¤E\r  	A6|@ 	(¸Aj 	Að j· E\r  	A6¼@@ 	(E\r @@ 	(¸Aj 	(¸Aðj¸ E\r 	 	(¸Aðj¬ 7 @@ 	) BQAqE\r  	A 6 	 	)  	(¸)}§6 	) ! 	(¸ 7 	( ! 	(! 	(¸(ð! 	(¸(ô! 	(¨! 	(!@   A      E\r  	A6¼ 	( !@ 	( 	(¸(ø 	(¸(ü 	( 	(¨ 	(   E\r  	A6¼ @@ 	(¸Aj 	(¸Aðjº E\r 	 	(¸Aðj¬ 7@@ 	)BQAqE\r  	A 6 	 	) 	(¸)}§6 	)! 	(¸ 7 	( ! 	(! 	(¸(ð! 	(¸(ô! 	(¨! 	(!@   A      E\r  	A6¼ 	( ! @ 	( 	(¸(ø 	(¸(ü 	( 	(¨ 	(    E\r  	A6¼ @@ 	(E\r  	(¨\r  	(¬\r  	(°AFAqE\r  	(´AÐ Aþ A FAqE\r  	(¸A6AÊ A§ AõA    	5¬!! 	(¸!" " ! ")|7 	A 6¼ 	(¼!# 	AÀj$  #?# Ak!   6 (A 6  (A 6 (A 6 (A 6y# Ak! $    6@ (( A GAqE\r  (( ¸ @ ((A GAqE\r  ((¸  (¢  Aj$ á# A0k! $    6(  7   6  6  6  6@ (( A FAq\r AµÅ Aº© Aæ AË   @ ((E\r AÛÅ Aº© Aç AË   @ ((A FAq\r A¥Å Aº© Aè AË   @ ((E\r AÇÅ Aº© Aé AË   @@ (A FAqE\r  A 6, (! (( )  (   !  6@ E\r @ (AFAqE\r  ((( A6  A 6,A¥ !	 ( 	6 @ 	A FAqE\r  ((( A6  A 6, ((!\n (( ! (! (!\r@ \n A  \r¦ \r  A 6, (( !Aÿ - Aj! ( 6@@ (( Aã· Aþ \r  (( !Aÿ - Aq\r  (( AjA Aþ \r  (( !Aÿ - \r ((( A6  A 6, ((! (( Aj! (( !Aÿ@   -  ( (¦ \r  A 6, A 6@@ (! (( !Aÿ  - AkIAqE\r ((  (Ajj!Aÿ@ -  AÿGAqE\r  ((( A6  A 6,  (Aj6  (Aÿl! ((  (Ajj!Aÿ  -  j! ( 6 ((¥ ! ( 6@ A FAqE\r  ((( A6  A 6,@ (( (( (( ( (¦ \r  A 6, Aj (( Aj(  6   (² @ Aj (( AjAþ E\r  ((( A6  A 6, A6, (,! A0j$  P# Ak! $    6@ (\r   (Aj6 (¶ ! Aj$  ÷	# A k! $    6  6  6  6  6@@@ (A KAqE\r  (6 (! (! (! (!	   Aj 	   !\n \nAK@@@@@@ \n  (!  ( k6  ( (j6@ (\r  (( A6  A 6 (!  ( k6  ( (j6 (( A6  A 6 A 6AÊ Aº© AÅ A±¶     A6 (!\r A j$  \rÔ# A0k! $    6(  7   6  6  6  6@ (( A GAq\r AÏÉ Aº© A·A³   @ ((\r AõÉ Aº© A¸A³   @ ((A GAq\r A§É Aº© A¹A³   @ ((\r AáÉ Aº© AºA³   @@ (A FAqE\r  A 6, (! (( )  (   !  6@ E\r @ (AFAqE\r  ((( A6  A 6, (²  (!	 ((!\n (( ! ((! (!\rA !@ \n     \r 	  E\r  ((( A6  A 6, (! ((! ((! ((! (!A !@         E\r  ((( A6  A 6, A6, (,! A0j$  *# Ak!   6 (( !Aÿ - -# Ak!   6 (( !Aÿ - Aq-# Ak!   6 (( !Aÿ - Aq-# Ak!   6 (( !Aÿ - Aqð~~~~~~~# Ak!   6  (( 6 (!Aÿ  - \rAÿq¬7  ) B! (!Aÿ   - Aÿq¬7  ) B! (!Aÿ   - Aÿq¬7  ) B! (!Aÿ   - \nAÿq¬7  ) B!	 (!\nAÿ  	 \n- 	Aÿq¬7  ) B! (!Aÿ   - Aÿq¬7  ) B!\r (!Aÿ  \r - Aÿq¬7  ) B! (!Aÿ   - Aÿq¬7  ) {# Ak!   6 (( !Aÿ - ! (( !Aÿ  - Atr! (( !Aÿ  - Atr! (( !Aÿ  - Atr{# Ak!   6 (( !Aÿ - ! (( !Aÿ  - Atr! (( !Aÿ  - Atr! (( !Aÿ  - AtrÀ# Ak! $    6  6@@ (A GAqE\r  (!Aè! A  ü  (A6 (A6 ((A t¶ ! ( 6  ((At¶ ! ( 6 ((At¶ ! ( 6@@ (( A GAqE\r  ((A GAqE\r  ((A GAq\r (°  A6 (! ( 6Ð A 6 A6 (!	 Aj$  	¼# Ak! $    6@ (A GAqE\r @ (( A GAqE\r  (( ¸ @ ((A GAqE\r  ((¸ @ ((A GAqE\r  ((¸  (!Aè! A  ü A ! Aj$  S# Ak!   6@@@ (A GAqE\r  (( A GAq\r A6 A 6 (# Ak! $    6@ (A GAqE\r  A 6 (( A :  (( A :  (( A :  (( A :   ( ((  ((³ 6  ( (( ((³ 6 (Aÿq! ((  :  (AvAÿq! ((  :  (AvAÿq! ((  :  (AvAÿq! ((  :  Aj$ Þ # Ak!   6  6  6@@ (ANAqE\r (!Aÿ -  At! (!Aÿ  - Atr! (!Aÿ  - Atr!	 (!\nAÿ  	 \n- r (s6 (Av!A° A8j Atj( ! (AvAÿq!\r A° A0j \rAtj( s! (AvAÿq! A° A(j Atj( s! (Aÿq! A° A j Atj( s! (!Aÿ - ! A° Aj Atj( s! (!Aÿ - ! A° Aj Atj( s! (!Aÿ - ! A° Aj Atj( s! (!Aÿ - !  A°  Atj( s6  (Aj6  (Ak6 @@ (!  Aj6 E\r (At! (AvAÿq!  (!!  !Aj6Aÿ   !-  s!"  A°  "Atj( s6  (ç\r~~# A0k! $    6(  6$  6   6  7 A 6@@ ((± E\r  A6,@ ($A GAq\r  A 6, A 6@@ ( ( HAqE\r@ ($ (Atj(AÿÿÿÿKAqE\r  A6, (! ($ (Atj(!@ Aÿÿÿÿ kJAqE\r  A6,  ($ (Atj( (j6  (Aj6   (AÿmAj6@ (((E\r  (((! ((!	 	 	( k6@ (((E\r  ((( !\n (((  (((j! (((!@ E\r  \n  ü\n   ((A 6@@ (( (µ \r  (( (¶ E\r A6, A 6@@ ( ( HAqE\r (((  (((j!\r ($ (Atj( ! ($ (Atj(!@ E\r  \r  ü\n   ($ (Atj(! ((!   (j6  (Aj6  A 6@@ ( (AkHAqE\r ((( ((( (jAtjAÿ6  (()à! ((( ((( (jAtj 7   (Aj6  (Aÿo! ((( ((( (jAtj 6  )! ((( ((( (jAtj 7  (( 7à ((( (((Atj!  ( Ar6  (! ((!   (j6 ((!  )ØB|7Ø@ (E\r  ((A6È A 6, (,! A0j$  ·# A k! $    6  6@@ (( (k ((LAqE\r  ((! (!@ Aÿÿÿÿ kJAqE\r  (°  A6  (( (j6@ (Aÿ÷ÿÿHAqE\r   (Aj6  ((  (A t¹ 6@ (A GAq\r  (°  A6 (! ( 6 (! ( 6  A 6 (! A j$  # A k! $    6  6@@ (( (k ((LAqE\r  ((! (!@ Aÿÿÿÿ kJAqE\r  (°  A6  (( (j6@ (AßÿÿÿHAqE\r   (A j6  (( (At¹ 6@ (A GAq\r  (°  A6 (! ( 6  (( (At¹ 6@ (A GAq\r  (°  A6 (! ( 6 (! ( 6 A 6 (! A j$  ~~# Ak! $    6  6  (( 6   ((6 (! ((! ()!  A  ´ ! Aj$  J# Ak! $    6  6 ( (AA ¹ ! Aj$  ³# AÀ k! $    68  64  60  6, A 6$@@ (8(AÿJAqE\r Aÿ! (8(!  6  A 6 A 6 B7@@ (8± E\r  A 6<@ ( \r  A 6<@@ (8(Ì\r  B 7 A 6$@@ ($ ( HAqE\r@ (8( ($Atj( AÿqAÿHAqE\r   ($Aj6$  ($Aj6$  A 6 A 6 A 6$@@ ($ ( HAqE\r@ ( (,JAqE\r  (ANAqE\r  A60  (8( ($Atj( Aÿq (j6@@ (8( ($Atj( AÿqAÿHAqE\r   (8( ($Atj) 7 (Aj!  6  6 A 6  ($Aj6$ @ ($AÿFAqE\r  A60@ (0\r  A 6< (8A(jA ( ã· 6   (8A : , (8A : -@ (8(( Aq\r  (8!Aÿ  - -Ar: -@ (8(Ì\r  (8!Aÿ  - -Ar: -@ (8(ÈE\r  (8( ($FAqE\r  (8!	Aÿ 	 	- -Ar: - (8A6Ì A6(@@ ((AHAqE\r )Bÿ§!\n (8A(j ((j \n:    )B7  ((Aj6(   (8(Ð6 A6(@@ ((AHAqE\r (Aÿq! (8A(j ((j :    (Au6  ((Aj6( @ (8(ÔAFAqE\r  (8A 6Ô (8! (Ô!\r  \rAj6Ô  \r6  A6(@@ ((AHAqE\r ( Aÿq! (8A(j ((j :    ( Au6   ((Aj6(  (8A : > (8A : ? (8A : @ (8A : A ($Aÿq! (8 : B A 6(@@ (( ($HAqE\r (8( ((Atj( Aÿq! (8A(j ((Ajj :    Aÿq (j6  ((Aj6(  (8A(j! (4 6  ($Aj! (8 6Ä (4 6 (8(  (8(j! (4 6 (! (4 6 ($! (8!  ( k6 (8(! (8( ($Atj! (8(At!@ E\r    ü\n   (8(! (8( ($Atj! (8(At!@ E\r    ü\n   (! (8!   (j6 (4²  A6< (<! AÀ j$  ·# Ak! $    6  6 A 6 @@ (± E\r  A 6@@@ ((ÈE\r  ((\r ((E\r ((Ì\r A6   ( ( ( A ¹ 6 (! Aj$  ]~# Ak!   6@ (A GAqE\r  (A6 (! A 6B !  7  7  7 A ~# Ak! $    6@ (A GAqE\r @ (( A GAqE\r  (( ¸  (! A 6B !  7  7  7 A ! Aj$  C# Ak!   6@@ ((A HAqE\r  A6 A 6 (ê# A k! $    6  6@@ (½ E\r  A 6@ ((E\r  ((! (!  ( k6@ ((A JAqE\r  (( ! ((  ((j! ((!@ E\r    ü\n   (A 6@ ( (( ((kJAqE\r  (! ((!	@ Aÿßÿÿ 	kJAqE\r  (¼  A 6  ( ((jA j6@@ (( A GAqE\r   ((  (¹ 6  (¶ 6@ (A GAq\r  (¼  A 6 (!\n ( \n6  (! ( 6  ((  ((j6 (! A j$  ¢# Ak! $    6  6@@ (½ E\r  A6@ (( (j ((JAqE\r  A6 (! (!   (j6 A 6 (! Aj$  # AÀ k! $    68  64  (8(  (8(j60  (8( (8(k6(@@ (8½ E\r  A 6<@@ (8(\r @ ((AHAqE\r  A 6<@ (0Aã· Aþ E\r  (0!Aÿ  - Aj6$@ (( ($HAqE\r  A 6< A 6 @@ ( ! (0!Aÿ  - HAqE\r (0 ( Ajj!Aÿ -  ! (8!   (j6  ( Aj6   ($!	 (8 	6@ (8( (8(j ((JAqE\r  A 6< Aj (0Aj(  6   (0AjA 6    (06  (8(6  (0 (8(j6  (8(6 Aj² @ Aj (0AjAþ E\r  (0Aj Aj(  6  @ (4A GAqE\r  (0!\n (4 \n6  (8(! (4 6 (0 (8(j! (4 6 (8(!\r (4 \r6 (8A 6 (8( (8(j!  6( (8!   (j6 (8A 6 (8A 6  ((6< (8A 6 (8A 6 (0Aj! ((Ak!  AÏ  ý 6,@ (,A GAq\r   (8(  (8(j6, (, (8( k! (8 6 (, (0k! A  k6< (<! AÀ j$  ¾# Ak! $    6  6@@ (½ E\r  A 6@  ( (À 6 @ ( A JAqE\r  A6@ ( \r  A 6@ ((\r  (A6 A6  (! Aj$  é\r$~# Aà k! $    6X  6T  (T( 6P  (T(6L  (T(6H A 6D  (T¨ 6@  (T© 6<  (Tª 68  (T« 64  (T¬ 7(  (T­ 6$  (T® 6  (P!Aÿ  - 6@@ (X± E\r  A6\\  (X($6  (X(6@ (E\r  (! (X!  ( k6@ (X(E\r  (X( ! (X(  (j! (X(!@ E\r    ü\n   (XA 6@ (E\r @ (X( (kE\r  (X(!	 (X( (Atj!\n (X( (kAt!@ E\r  	 \n ü\n   (X(! (X( (Atj!\r (X( (kAt!@ E\r   \r ü\n   (! (X!  ( k6 (! (X!  (  k6  (XA 6$@ ($ (X(ÐGAqE\r  A6\\@ (@A JAqE\r  A6\\@ (X (Aj¶ E\r  A6\\@ (  (X(ÔGAqE\r   (X( 6@@ ( (X(HAqE\r (X( (Atj( Aÿq! (X!  ( k6  (Aj6  (X( ! (X 6@ (X(ÔAGAqE\r  (X(! (X! (!  Aj6  AtjA6  (X!  ( Aj6 @ (<E\r @@ (X(AHAq\r  (X( (X(AkAtj( AÿqAÿHAq\r  (X( (X(AkAtj( AFAqE\r A 68@@ (D (HAqE\r (P (DAjj!Aÿ  -  6  ( (Lj6L (!  (H k6H@ (AÿHAqE\r   (DAj6D  (DAj6D @ (HE\r @ (X (Hµ E\r  A6\\ (X(  (X(j! (L! (H!@ E\r    ü\n   (H! (X!      (j6 A6@@ (D (HAqE\r (P (DAjj!!Aÿ  !-  6 (!" (X( (X(Atj "6  (X( (X(AtjB7 @ (8E\r  (X( (X(Atj!# # #( Ar6  A 68@ (AÿHAqE\r   (X(6 (X!$ $ $(Aj6  (DAj6D@ (AÿHAqE\r  (X(!% (X %6  @ (AGAqE\r  )(!& (X( (Atj &7 @ (4E\r  (XA6È@ (X(A JAqE\r  (X( (X(AkAtj!\' \' \'( Ar6  ( Aj!( (X (6Ô A 6\\ (\\!) Aà j$  )# Ak! $    6@@ (½ E\r  A6 (A 6 (A 6 (A 6 (A 6 (A 6 A 6 (! Aj$  Ë# Ak! $    6@@ (± E\r  A6 (A 6 (A 6 (A 6 (A 6  (A 6$ (A 6Ä (A 6È (A 6Ì (A6Ô (B 7Ø (B 7à A 6 (! Aj$  |# Ak! $    6  6@@ (± E\r  A6 (Ä  (! ( 6Ð A 6 (! Aj$  n# Ak! $    6  6@@ (± E\r  A 6  ( (AÇ 6 (! Aj$  ~# A0k!   6(  6$  6   ((($6@@ (((  (LAqE\r  A 6,@ ((( (Atj( AqE\r  ((!  ($Aj6$ ((!  )ØB|7Ø A6,@ ($A GAq\r  ( \r  A6,  ((( (Atj( Aÿq6  (6  ((( (Atj( Aq6  ((( (Atj( Aq6@@ (AÿFAqE\r (((! (Aj!  6   Atj( 6  (Aÿq6@ (AqE\r  A6  ( (j6 @ ($A GAqE\r  (! ($ 6 (!	 ($ 	6 (((  (((j!\n ($ \n6  (()Ø! ($ 7 ((( (Atj) ! ($ 7 (!\r ($ \r6@ ( E\r  (! ((!   (j6 (Aj! (( 6$ ((!  )ØB|7Ø A6, (,O|    ¢"     ¢"¢  DiPîàBù>¢D\'èÀV¿ ¢ DB:áSU¥?¢  D^ýÿÿß¿¢D      ð?   ¶K|      ¢"¢"  ¢¢ D§F;ÍÆ>¢DtçÊâù *¿ ¢  D²ûn?¢Dw¬ËTUUÅ¿ ¢    ¶|||# A°k"$  A}jAm"A  A J"Ahl j!@ AtA°Ç j( "	 Aj"\njA H\r  	 j!  \nk!A !@@@ A N\r D        ! At(ÀÇ ·! AÀj Atj 9  Aj! Aj" G\r  Ahj!\rA ! 	A  	A J! AH!@@@ E\r D        !  \nj!A !D        !@   Atj+  AÀj  kAtj+ ¢  ! Aj" G\r   Atj 9   F! Aj! E\r A/ k!A0 k! AtAÀÇ j! 	!@@  Atj+ !A ! !@ AH\r @ Aàj Atj D      p>¢ü·"D      pÁ¢  ü6   AtjAxj+   ! Aj! Aj" G\r   \r !  D      À?¢Ú D       À¢ " ü"·¡!@@@@@ \rAH"\r  Aàj AtjA|j" ( "  u" tk"6   u!  j! \r\r Aàj AtjA|j( Au! AH\rA! D      à?f\r A !A !A !A!@ AH\r @ Aàj Atj"\n( !@@@@ E\r Aÿÿÿ! E\rA! \n  k6 A!A !A !A! Aj" G\r @ \r Aÿÿÿ!@@ \rAj Aÿÿÿ! Aàj AtjA|j" (  q6  Aj! AG\r D      ð? ¡!A! \r  D      ð? \r ¡!@ D        b\r A ! !@  	L\r @ Aàj Aj"Atj(  r!  	J\r  E\r @ \rAhj!\r Aàj Aj"Atj( E\r A!@ "Aj! Aàj 	 kAtj( E\r   j!@ AÀj  j"Atj  Aj"Atj( ·9 A !D        !@ AH\r @   Atj+  AÀj  kAtj+ ¢  ! Aj" G\r   Atj 9   H\r  !@@ A k "D      pAfE\r  Aàj Atj D      p>¢ü"·D      pÁ¢  ü6  Aj! !\r ü! Aàj Atj 6 D      ð? \r !@ A H\r  !@  "Atj  Aàj Atj( ·¢9  Aj! D      p>¢! \r  !@@@ 	  k" 	 H"A N\r D        !  Atj! A !D        !@ At"+Ý    j+ ¢  !  G! Aj! \r  A j Atj 9  A J! Aj! \r @@@@@  D        !@ A L\r  !@ A j Atj"Axj" + " + " "9     ¡ 9  AK! Aj! \r  AF\r  !@ A j Atj"Axj" + " + " "9     ¡ 9  AK! Aj! \r D        !@  A j Atj+  ! AK! Aj! \r  + ! \r  9  +¨!  9  9D        !@ A H\r @ "Aj!  A j Atj+  ! \r     9 D        !@ A H\r  !@ "Aj!  A j Atj+  ! \r     9  +  ¡!A!@ AH\r @  A j Atj+  !  G! Aj! \r     9  9  +¨!  9  9 A°j$  Aq|# Ak"$ @@  ¼"Aÿÿÿÿq"AÚ¤îK\r    »" DÈÉm0_ä?¢D      8C D      8Ã "D   Pû!ù¿¢  Dcba´Q¾¢ "9  ü!@ D   `û!é¿cE\r    D      ð¿ "D   Pû!ù¿¢  Dcba´Q¾¢ 9  Aj! D   `û!é?dE\r   D      ð? "D   Pû!ù¿¢  Dcba´Q¾¢ 9  Aj!@ AüI\r      »9 A !   AvAê~j"Atk¾»9 Aj  AA Ê ! + !@ AJ\r   9 A  k!  9  Aj$  Ï}|# Ak"$ @@  ¼"Aÿÿÿÿq"AÚ¤úK\r C  ?! AÌI\r  »È !@ AÑ§íK\r @ AäÛI\r D-DTû!	@D-DTû!	À A H  » È !  »!@ AJ\r  D-DTû!ù? É !D-DTû!ù? ¡É !@ AÕãK\r @ AàÛ¿I\r D-DTû!@D-DTû!À A H  » È !@ AJ\r DÒ!3|ÙÀ  »¡É !  »DÒ!3|ÙÀ É !@ AüI\r     !   AjË ! +!@@@@ Aq   È ! É ! È ! É ! Aj$        Î ¢# Ak"  9 +   D       Í    D       pÍ |~|~@@@  Ò Aÿq"D      <Ò "kD      @Ò  kO\r  !@  O\r   D      ð? A ! D      @Ò I\r D        !  ½"BxQ\r@ D      ðÒ I\r   D      ð? @ BU\r A Ï A Ð   A +ÐÝ ¢A +ØÝ " " ¡"A +èÝ ¢ A +àÝ ¢    "   ¢" ¢  A +Þ ¢A +Þ  ¢   A +øÝ ¢A +ðÝ  ¢ ½"§AtAðq"+ÀÞ      !  )ÈÞ  B-|!@ \r     Ó  ¿"  ¢  ! 	   ½B4§Í|@ BB R\r  Bø@|¿"  ¢  D       ¢@ Bð?|¿"  ¢"  " D      ð?cE\r Ô D       ¢Õ D          D      ð? "    ¡   D      ð? ¡   D      ð¿ "   D        a!   D       ¢ # Ak" B7  + # Ak  9   Ø !    (  !@  -  Aq\r   Ö ÿ !  (8!@  (4"E\r   68@ E\r   64@ (   G\r   6    (`¸   ¸   r@  \r A !@A (ð¨ E\r A (ð¨ Ø !@A (È¦ E\r A (È¦ Ø  r!@ÿ ( " E\r @@  (  (F\r   Ø  r!  (8" \r   @  (  (F\r   A A   ($    (\r A@  ("  ("F\r     k¬A  ((    A 6  B 7  B 7A  A©    ò~@ E\r    :     j"Aj :   AI\r    :    :  A}j :   A~j :   AI\r    :  A|j :   A	I\r   A   kAq"j" AÿqAl"6    kA|q"j"A|j 6  A	I\r   6  6 Axj 6  Atj 6  AI\r   6  6  6  6 Apj 6  Alj 6  Ahj 6  Adj 6   AqAr"k"A I\r  ­B~!  j!@  7  7  7  7  A j! A`j"AK\r      (<  ü # A k"$    ("6  (!  6  6   k"6  j! Aj!A!@@@@@  (< AjA Aj ³ E\r  !@  ("F\r@ AJ\r  ! AA   ("K"	j" (   A  	k"j6  AA 	j" (  k6   k! !  (<   	k" Aj ³ E\r  AG\r    (,"6   6     (0j6 !A !  A 6  B 7    ( A r6  AF\r   (k! A j$  ö# A k"$   6A !    (0"A Gk6  (,!  6  6A !@@@  (< AjA Aj ³ \r  ("A J\rA A !    (  r6  !  ("M\r     (,"6     kj6@  (0E\r    Aj6  jAj -  :   ! A j$        (<ß  ³ 7# Ak"$   6    ¯ ! Aj$    @    ü\n    @ AI\r     â    j!@@   sAq\r @@  Aq\r   !@ \r   !  !@  -  :   Aj! Aj"AqE\r  I\r  A|q!@ AÀ I\r   A@j"K\r @  ( 6   (6  (6  (6  (6  (6  (6  (6  ( 6   ($6$  ((6(  (,6,  (060  (464  (868  (<6< AÀ j! AÀ j" M\r   O\r@  ( 6  Aj! Aj" I\r @ AO\r   !@ AO\r   ! A|j!  !@  -  :    - :   - :   - :  Aj! Aj" M\r @  O\r @  -  :   Aj! Aj" G\r       (H"Aj r6H@  (  (F\r   A A   ($    A 6  B 7@  ( "AqE\r    A r6 A    (,  (0j"6   6 AtAu~@  ½"B4§Aÿq"AÿF\r @ \r @@  D        b\r A !  D      ðC¢ å !  ( A@j!  6     Axj6  BÿÿÿÿÿÿÿBð?¿!   \\    (H"Aj r6H@  ( "AqE\r    A r6 A  B 7    (,"6   6     (0j6A æ@@ ("\r A ! æ \r (!@   ("kM\r      ($  @@ (PA H\r  E\r  !@@   j"Aj-  A\nF\r Aj"E\r      ($  " I\r  k! (!  !A !   ã   ( j6  j!    A  A  A  A  A  A A A  A  A  A  A \' D      ð¿D      ð?  ÷ D        £# Ak"  9 +     ¡"   £ø~|~  ú !@  ½"B@|BÿÿÿÿÿÂV\r @ Bø?R\r D          D      ð¿ "     D       A¢"  ¡" ¢A +øî "¢" "      ¢"¢"   A +Èï ¢ A +Àï ¢  A +¸ï ¢A +°ï    ¢ A +¨ï ¢  A + ï ¢A +ï    ¢ A +ï ¢  A +ï ¢A +ï    ¢   ¡ ¢    ¢    ¡    @@ A~jA~K\r @  D        b\r Aö  Bøÿ Q\r@@ AÿÿK\r  AðÿqAðÿG\r  ø   D      0C¢½Bà||! B@|"	B4¹"A +Àî ¢ 	B-§Aÿ qAt"+Øï  " +Ðï   	Bx}¿ +Ðÿ ¡ +Øÿ ¡¢"  "      ¢"¢   A +ðî ¢A +èî  ¢  A +àî ¢A +Øî   ¢ A +Ðî ¢ A +Èî ¢    ¡     !   	   ½B0§    üK# Ak"$     Aÿq Aj ³ ! )! Aj$ B  é A G!@@@  AqE\r  E\r  Aÿq!@  -   F\r Aj"A G!  Aj" AqE\r \r  E\r@  -   AÿqF\r  AI\r  AÿqAl!@A  (  s"k rAxqAxG\r  Aj!  A|j"AK\r  E\r Aÿq!@@  -   G\r     Aj!  Aj"\r A @@@ AI\r    rAq\r@  (  ( G\r Aj!  Aj!  A|j"AK\r  E\r@@  -  " -  "G\r Aj!  Aj!  Aj"E\r   kA  AÄ© è AÈ©  AÄ© é ¼# AÐk"$  B7@  l"E\r   6  6A!@ Aj Atj" Axj(  j A|j( j"6  Aj!  I\r @@  k"AN\r A !A!   j!A!A!@@@ AqAG\r        Aj  AjA  Aj!@@ Aj Aj"Atj(    kI\r       Aj A  Aj        Aj @ AG\r  AjA A ! Aj  A!  (Ar"6   j"  I\r  (A G!A  k!      Aj A  Aj @ AG\r  (AG\r  E\r@@@ AJ\r  Aj Aj "   j! AjA   (As6 AjA    j" Aj A~j"Atj( k    Aj AjA Aj  AjA   (Ar6     Aj A Aj  !   j!  (! (! AG\r  AG\r  \r  AÐj$ â# Aðk"$    6 A!@ AH\r A  k!A!  !	@@   	 j"	  A~j"\nAtj( k"    A H\r    	    AJ\r  Atj  	  	    AJ""	6  Aj! Aj \n "AJ\r      Aðj$ Q  (!@@ AK\r   ( ! ! A`j!A ! !    v6   A  kt  vr6 # Aðk"$   ( "	6è (!   6   6ìA  k!\n E!@@@@@ 	AF\r   !	A!  !	A! \r A!  !@@ 	  Atj"( k"      AN\r  	! As!\rA!@@ \r AHrAq\r  Axj( !\r 	 \nj"     AJ\r  \rk     AJ\r  Atj 6  Aèj Aèj "	  Aj! 	 j! (ì!\r !	 (èAG\r !	 \r\r 	! AqE\r            Aðj$ T@@ AK\r   Aj!  ( ! A`j!A !  ! ( !    t6    A  kv  tr62@  ( Aj "\r   ( " A rA   ! ¬# Ak"$ @ AH\r   Atj" 6   E\r @ (  (   A  AI"ã A !@  Atj"(   Aj"Atj(  ã   (  j6   G\r    k" \r  Aj$ \n    \n   hA        A          	   ¯~|@  ½"B4§Aÿq"A²K\r @ AýK\r   D        ¢@@  " D      0C D      0Ã   ¡"D      à?dE\r     D      ð¿ !     !  D      à¿eE\r   D      ð? !      B S!   ® @@ AH\r   D      à¢! @ AÿO\r  Axj!  D      à¢!  Aý AýIApj! AxJ\r   D      `¢! @ A¸pM\r  AÉj!  D      `¢!  Aðh AðhKAj!   Aÿj­B4¿¢ A  B      " A   -   AÿqFû@@@@ Aÿq"E\r @  AqE\r  Aÿq!@  -  "E\r  F\r  Aj" Aq\r A  ( "k rAxqAxG\r Al!@A  s"k rAxqAxG\r  (!  Aj"!  A krAxqAxF\r      j  !@ " -  "E\r  Aj!  AÿqG\r   Y -  !@  -  "E\r   AÿqG\r @ - !  - "E\r Aj!  Aj!   AÿqF\r   Aÿqk  !@@  AqE\r @  -  \r     k  !@ Aj"AqE\r -  \r @ "Aj!A ( "k rAxqAxF\r @ "Aj! -  \r    ku@ \r A @@  -  "\r A ! @@ Aÿq -  "G\r E\r Aj"E\r Aj!  - !  Aj!  \r A ! Aÿq!    -  kX# Ak"$ A!@  ä \r    AjA  (   AG\r  - ! Aj$  G   7p    (,  ("k¬7x  (!@ P\r    k¬Y\r   §j!   6hâ~  )x  ("  (,"k¬|!@@@  )p"P\r   Y\r   "AJ\r  (!  (,!  B7p   6h     k¬|7xA B|!  (!  (!@  )p"B Q\r   }"  k¬Y\r   §j!   6h     (," k¬|7x@  K\r  Aj :   <    7    B0§Aq BÀÿÿ B0§r­B0 Bÿÿÿÿÿÿ?7æ# AÐ k"$ @@ AH\r  A j  B Bÿÿ Ë  )(! ) !@ AÿÿO\r  Aj! Aj  B Bÿÿ Ë  Aýÿ AýÿIA~j! )! )! AJ\r  AÀ j  B B9Ë  )H! )@!@ Aô~M\r  Aÿ j! A0j  B B9Ë  Aè} Aè}KAþj! )8! )0!   B  Aÿÿ j­B0Ë    )7   ) 7  AÐ j$ K~ Bÿÿÿÿÿÿ?!@@ B0§Aÿÿq"AÿÿF\r A! \rAA   P   P! ç~~# Ak"$ @@@  B B Á E\r    E\r  B0§"Aÿÿq"AÿÿG\r Aj    Ë   )" )"  Ã  )! ) !@  Bÿÿÿÿÿÿÿÿÿ "  Bÿÿÿÿÿÿÿÿÿ "	Á A J\r @    	Á E\r  ! Að j  B B Ë  )x! )p! B0§Aÿÿq!\n@@ E\r  ! Aà j  B BÀ»À Ë  )h"B0§Aj! )`!@ \n\r  AÐ j  	B BÀ»À Ë  )X"	B0§Aj!\n )P! 	Bÿÿÿÿÿÿ?BÀ ! Bÿÿÿÿÿÿ?BÀ !@  \nL\r @@@  }  T­}"	B S\r @ 	  }"B R\r  A j  B B Ë  )(! ) ! 	B B?! B B?! B! Aj" \nJ\r  \n!@@  }  T­}"	B Y\r  !	 	  }"B R\r  A0j  B B Ë  )8! )0!@ 	Bÿÿÿÿÿÿ?V\r @ B?! Aj! B!  	B"	BÀ T\r  Aq!\n@ A J\r  AÀ j  	Bÿÿÿÿÿÿ? Aø j \nr­B0B BÀÃ?Ë  )H! )@! 	Bÿÿÿÿÿÿ?  \nr­B0!   7    7 Aj$     Bÿÿÿÿÿÿÿÿÿ 7   7 Ù	~~# A0k"$ B !@@ AK\r  At"( ! ( !@@@ (" (hF\r   Aj6 -  !  !  \r A!@@ AUj  AA A-F!@ (" (hF\r   Aj6 -  !  !A !	@@@@ A_qAÉ F\r A !\n@ 	AF\r@@ (" (hF\r   Aj6 -  !  ! 	,  ! 	Aj"\n!	  A rF\r @ \nAF\r  \nAF\r E\r \nAI\r \nAF\r@ )p"B S\r   (Aj6 E\r  \nAI\r  B S!@@ \r   (Aj6 \nAj"\nAK\r   ²C  Å  )! ) !@@@@@@ \n\r A !	@ A_qAÎ F\r A !\n@ 	AF\r@@ (" (hF\r   Aj6 -  !  ! 	, µ ! 	Aj"\n!	  A rF\r  \n @@ (" (hF\r   Aj6 -  !  !@@ A(G\r A!	B !Bàÿÿ ! )pB S\r  (Aj6@@@ (" (hF\r   Aj6 -  !  ! A¿j!\n@@ APjA\nI\r  \nAI\r  Aj!\n Aß F\r  \nAO\r 	Aj!	Bàÿÿ ! A)F\r@ )p"B S\r   (Aj6@@ E\r  	\rÙ A6 B !@@ B S\r   (Aj6 	Aj"	E\r B !@ )pB S\r   (Aj6Ù A6    @ A0G\r @@ ("	 (hF\r   	Aj6 	-  !	  !	@ 	A_qAØ G\r  Aj        )! )! )pB S\r   (Aj6 A j      ¡  )(! ) !B !B !   7    7 A0j$    A F  AwjAIrÍ\n~~~~~# A°k"$ @@ (" (hF\r   Aj6 -  !  !A !B !	A !\n@@@@@ A0F\r  A.G\r (" (hF\r  Aj6 -  !@ (" (hF\r A!\n  Aj6 -  !A!\n  !   !B !	@ A0F\r A!@@@ (" (hF\r   Aj6 -  !  ! 	B|!	 A0F\r A!A!\nBÀÿ?!A !B !\rB !B !A !B !@@ !@@ APj"A\nI\r  A r!@ A.F\r  AjAK\r A.G\r  \rA! !	 A©j  A9J!@@ BU\r   Atj!@ BV\r  A0j Æ  A j  B BÀý?Ë  Aj )0 )8 ) " )("Ë   ) ) \r ¿  )! ) !\r E\r  \r  AÐ j  B Bÿ?Ë  AÀ j )P )X \r ¿ A! )H! )@!\r B|!A!\n@ (" (hF\r   Aj6 -  !  ! @@ \n\r @@@ )pB S\r   ("Aj6 E\r  A~j6 E\r  A}j6 \r B   Aà jD         ·¦Ä  )h! )`!\r@ BU\r  !@ At! B|"BR\r @@@@ A_qAÐ G\r   ¢ "BR\r@ E\r  )pBU\rB !\r B  B !B ! )pB S\r  (Aj6B !@ \r  Að jD         ·¦Ä  )x! )p!\r@ 	  B |B`|"A  k­W\r Ù AÄ 6  A j Æ  Aj )  )¨BBÿÿÿÿÿÿ¿ÿÿ Ë  Aj ) )BBÿÿÿÿÿÿ¿ÿÿ Ë  )! )!\r@  A~j¬S\r @ AL\r @ A j \r B BÀÿ¿¿  \r B Bÿ?Â ! Aj \r  )  \r AJ" )¨  ¿  At" r! B|! )! )!\r AJ\r @@ A  k­|"	§"A  A J  	 ­S"Añ I\r  Aj Æ B !	 )! )!B ! AàjD      ð?A k Ä  AÐj Æ  Aðj )à )è )Ð" )Ø"  )ø! )ð!	 AÀj  AqE A I \r B B Á A Gqq"rÇ  A°j   )À )ÈË  Aj )° )¸ 	 ¿  A j  B  \r B   Ë  Aj )  )¨ ) )¿  Aðj ) ) 	 Ñ @ )ð"\r )ø"B B Á \r Ù AÄ 6  Aàj \r  §  )è! )à!\rÙ AÄ 6  AÐj Æ  AÀj )Ð )ØB BÀ Ë  A°j )À )ÈB BÀ Ë  )¸! )°!\r   \r7    7 A°j$ ¯	~~~~|# AÆ k"$ A !A  k"	 k!\nB !A !@@@@@ A0F\r  A.G\r (" (hF\r  Aj6 -  !@ (" (hF\r A!  Aj6 -  !A!  !   !B !@ A0G\r @@@ (" (hF\r   Aj6 -  !  ! B|! A0F\r A!A!A !\r A 6 APj!@@@@@@@ A.F"\r B ! A	M\r A !A !B !A !A !\rA !@@@ AqE\r @ \r  !A! E! B|!@ \rAüJ\r  §! Aj \rAtj!@ E\r   ( A\nljAPj!   A0F!  6 A!A  Aj" A	F"! \r j!\r A0F\r   (FAr6FAÜ!@@ (" (hF\r   Aj6 -  !  ! APj! A.F"\r  A\nI\r    !@ E\r  A_qAÅ G\r @  ¢ "BR\r  E\rB ! )pB S\r   (Aj6  |! E! A H\r )pB S\r   (Aj6 E\rÙ A6 B ! B  B !@ ("\r  D         ·¦Ä  )! ) !@ B	U\r   R\r @ AK\r   v\r A0j Æ  A j Ç  Aj )0 )8 )  )(Ë  )! )!@  	Av­W\r Ù AÄ 6  Aà j Æ  AÐ j )` )hBBÿÿÿÿÿÿ¿ÿÿ Ë  AÀ j )P )XBBÿÿÿÿÿÿ¿ÿÿ Ë  )H! )@!@  A~j¬Y\r Ù AÄ 6  Aj Æ  Aj ) )B BÀ Ë  Að j ) )B BÀ Ë  )x! )p!@ E\r @ AJ\r  Aj \rAtj"( !@ A\nl! Aj"A	G\r   6  \rAj!\r §!@ A	N\r  BU\r   J\r @ B	R\r  AÀj Æ  A°j (Ç  A j )À )È )° )¸Ë  )¨! ) !@ BU\r  Aj Æ  Aj (Ç  Aðj ) ) ) )Ë  AàjA kAt(ð Æ  AÐj )ð )ø )à )èÃ  )Ø! )Ð! (!@  A}ljAj"AJ\r   v\r Aàj Æ  AÐj Ç  AÀj )à )è )Ð )ØË  A°j AtAÈ j( Æ  A j )À )È )° )¸Ë  )¨! ) !@ \r"Aj!\r Aj Atj"A|j( E\r A !@@ A	o"\r A ! A	j  B S!@@ \r A !A !AëÜA kAtAð j( "\rm!	A !A !A !@ Aj Atj" ( " \rn" j"6  AjAÿq   F Eq"! Awj  ! 	   \rlkl! Aj" G\r  E\r   6  Aj!  kA	j!@ Aj Atj!	 A$H!@@@ \r  A$G\r 	( AÑéùO\r Aÿj!\rA !@ !@@ Aj \rAÿq"Atj"5 B ­|"BëÜZ\r A !  BëÜ"BëÜ~}! §!  >      B R  AjAÿq"G  F! Aj!\r  G\r  Acj! ! E\r @@ AjAÿq" F\r  ! Aj AþjAÿqAtj" (  Aj Atj( r6  ! A	j! Aj Atj 6 @@ AjAÿq! Aj AjAÿqAtj!	@A	A A-J!\r@@ !A !@@@  jAÿq" F\r Aj Atj( " At(à "I\r  K\r Aj"AG\r  A$G\r B !A !B !@@  jAÿq" G\r  Aj AjAÿq"AtjA|jA 6  Aj Aj Atj( Ç  Aðj  B Bå·À Ë  Aàj )ð )ø ) )¿  )è! )à! Aj"AG\r  AÐj Æ  AÀj   )Ð )ØË B ! )È! )À! Añ j" k"A  A J   J""Að M\rB !B !B ! \r j! !  F\r AëÜ \rv!A \rtAs!A ! !@ Aj Atj" ( " \rv j"6  AjAÿq   F Eq"! Awj  !  q l! AjAÿq" G\r  E\r@  F\r  Aj Atj 6  ! 	 	( Ar6  AjD      ð?Aá k Ä  A°j ) )    )¸! )°! AjD      ð?Añ  k Ä  A j   ) )  Aðj   ) " )¨"Ñ  Aàj   )ð )ø¿  )è! )à!@ AjAÿq"\r F\r @@ Aj \rAtj( "\rAÿÉµîK\r @ \r\r  AjAÿq F\r Aðj ·D      Ð?¢Ä  Aàj   )ð )ø¿  )è! )à!@ \rAÊµîF\r  AÐj ·D      è?¢Ä  AÀj   )Ð )Ø¿  )È! )À! ·!@ AjAÿq G\r  Aj D      à?¢Ä  Aj   ) )¿  )! )! A°j D      è?¢Ä  A j   )° )¸¿  )¨! ) ! Aï K\r  AÐj  B BÀÿ?  )Ð )ØB B Á \r  AÀj  B BÀÿ?¿  )È! )À! A°j    ¿  A j )° )¸  Ñ  )¨! ) !@ Aÿÿÿÿq \nA~jL\r  Aj    Aj  B Bÿ?Ë  ) )B B¸À Â ! )  AJ"! )  !  B B Á !@  j"Aî j \nJ\r    G A Hrq A GqE\rÙ AÄ 6  Aðj     )ø! )ð!   7   7  AÆ j$ Ó~@@  ("  (hF\r    Aj6 -  !   !@@@@@ AUj  @@  ("  (hF\r    Aj6 -  !   ! A-F! AFj! E\r AuK\r  )pB S\r    (Aj6 AFj!A ! ! AvI\r B !@ APjA\nO\r A !@  A\nlj!@@  ("  (hF\r    Aj6 -  !   ! APj!@ APj"A	K\r  AÌ³æ H\r ¬! A\nO\r @ ­ B\n~|!@@  ("  (hF\r    Aj6 -  !   ! BP|!@ APj"A	K\r  B®×ÇÂë£S\r A\nO\r @@@  ("  (hF\r    Aj6 -  !   ! APjA\nI\r @  )pB S\r     (Aj6B  }  !B!  )pB S\r     (Aj6B ~# A k"$   6<  6 A6 AjB    Aj A  )! ) !@ E\r    ( (<kj (j6    7   7  A j$ D|# Ak"$     A£  )  )Ò ! Aj$    A  ý "  k  æ# AÐk"$   6Ì A jA A(ü   (Ì6È@@A   AÈj AÐ j A j  § A N\r A!     ( "A_q6 @@@@  (0\r   AÐ 60  A 6  B 7  (,!   6,A !  (\rA!  æ \r    AÈj AÐ j A j  § ! A q!@ E\r   A A   ($    A 60   6,  A 6  (!  B 7 A !    ( " r6 A  A q!  AÐj$   ~# AÀ k"$   6< A)j! A\'j!	 A(j!\nA !A !@@@@@A !\r@ ! \r AÿÿÿÿsJ\r \r j! !\r@@@@@@ -  "E\r @@@@ Aÿq"\r  \r! A%G\r \r!@@ - A%F\r  ! \rAj!\r - ! Aj"! A%F\r  \r k"\r Aÿÿÿÿs"J\r\n@  E\r     \r¨  \r\r  6< Aj!\rA!@ , APj"A	K\r  - A$G\r  Aj!\rA! !  \r6<A !@@ \r,  "A`j"AM\r  \r!A ! \r!A t"AÑqE\r @  \rAj"6<  r! \r, "A`j"A O\r !\rA t"AÑq\r @@ A*G\r @@ , APj"\rA	K\r  - A$G\r @@  \r   \rAtjA\n6 A !  \rAtj( ! Aj!A! \r Aj!@  \r   6<A !A !  ( "\rAj6  \r( !A !  6< AJ\rA  k! AÀ r! A<j© "A H\r (<!A !\rA!@@ -  A.F\r A !@ - A*G\r @@ , APj"A	K\r  - A$G\r @@  \r   AtjA\n6 A !  Atj( ! Aj! \r Aj!@  \r A !  ( "Aj6  ( !  6< AJ!  Aj6<A! A<j© ! (<!@ \r!A! ",  "\rAjAFI\r Aj! A:l \rjAï j-  "\rAjAÿqAI\r   6<@@ \rAF\r  \rE\r\r@ A H\r @  \r   Atj \r6 \r   Atj) 70  E\r	 A0j \r  ª  AJ\rA !\r  E\r	  -  A q\r Aÿÿ{q"  AÀ q!A !A ! \n!@@@@@@@@@@@@@@@@@ -  "À"\rASq \r AqAF \r "\rA¨j!	\n  \n!@ \rA¿j  \rAÓ F\rA !A ! )0!A !\r@@@@@@@   (0 6  (0 6  (0 ¬7  (0 ;  (0 :   (0 6  (0 ¬7  A AK! Ar!Aø !\rA !A ! )0" \n \rA q« ! P\r AqE\r \rAvA j!A!A !A ! )0" \n¬ ! AqE\r   k"\r  \rJ!@ )0"BU\r  B  }"70A!A !@ AqE\r A!A !A A  Aq"!  \n­ !  A Hq\r Aÿÿ{q  !@ B R\r  \r  \n! \n!A !  \n k Pj"\r  \rJ!\r - 0!\r (0"\rA¥Ð  \r!   Aÿÿÿÿ AÿÿÿÿI¥ "\rj!@ AL\r  ! \r!\r ! \r! -  \r )0"PE\rA !\r	@ E\r  (0!A !\r  A  A  ®  A 6  >  Aj60 Aj!A!A !\r@@ ( "E\r Aj µ "A H\r   \rkK\r Aj!  \rj"\r I\r A=! \rA H\r\r  A   \r ® @ \r\r A !\rA ! (0!@ ( "E\r Aj µ " j" \rK\r   Aj ¨  Aj!  \rI\r   A   \r AÀ s®   \r  \rJ!\r	  A Hq\r\nA=!   +0    \r   "\rA N\r \r- ! \rAj!\r   \r\n E\rA!\r@@  \rAtj( "E\r  \rAtj   ª A! \rAj"\rA\nG\r @ \rA\nI\r A!@  \rAtj( \rA! \rAj"\rA\nF\r A!  \r: \'A! 	! \n! ! \n!   k"  J" AÿÿÿÿsJ\rA=!   j"  J"\r K\r  A  \r  ®     ¨   A0 \r  As®   A0  A ®     ¨   A  \r  AÀ s®  (<!A !A=!Ù  6 A! AÀ j$   @  -  A q\r     ç {A !@  ( ",  APj"A	M\r A @A!@ AÌ³æ K\r A  A\nl"j  AÿÿÿÿsK!   Aj"6  , ! ! ! APj"A\nI\r  ¾ @@@@@@@@@@@@@@@@@@@ Awj 	\n\r  ( "Aj6    ( 6   ( "Aj6    4 7   ( "Aj6    5 7   ( "Aj6    4 7   ( "Aj6    5 7   ( AjAxq"Aj6    ) 7   ( "Aj6    2 7   ( "Aj6    3 7   ( "Aj6    0  7   ( "Aj6    1  7   ( AjAxq"Aj6    ) 7   ( "Aj6    5 7   ( AjAxq"Aj6    ) 7   ( AjAxq"Aj6    ) 7   ( "Aj6    4 7   ( "Aj6    5 7   ( AjAxq"Aj6    + 9       5 @  P\r @ Aj"  §Aq-   r:    B" B R\r  . @  P\r @ Aj"  §AqA0r:    B" B R\r  {~@  BT\r @ Aj"  " B\n" B\n~}§A0r:   BÿÿÿÿV\r @  P\r   §!@ Aj"  A\nn"A\nlkA0r:   A	K! ! \r  # Ak"$ @  L\r  AÀq\r     k"A AI"Û @ \r @   A¨  A~j"AÿK\r     ¨  Aj$      A A ¦ Ä~~|# A°k"$ A ! A 6,@@ ² "BU\r A!	A !\n "² !@ AqE\r A!	A¢ !\nA¥ A   Aq"	!\n 	E!@@ Bøÿ Bøÿ R\r   A   	Aj" Aÿÿ{q®    \n 	¨   A´ Aª»  A q"A Aä»    bA¨   A    AÀ s®     J!\r Aj!@@@@  A,jå "  "D        a\r   (,"Aj6, A r"Aá G\r A r"Aá F\rA  A H! (,!  Acj"6,A  A H! D      °A¢! A0jA A  A Hj"!@  ü"6  Aj!  ¸¡D    eÍÍA¢"D        b\r @@ AN\r  ! ! ! ! !@ A AI!@ A|j" I\r  ­!B !@  5   |" BëÜ"BëÜ~}>  A|j" O\r  BëÜT\r  A|j" > @@ " M\r A|j"( E\r   (, k"6, ! A J\r @ AJ\r  AjA	nAj! Aæ F!@A  k"A	 A	I!\r@@  I\r A A ( !AëÜ \rv!A \rtAs!A ! !@  ( " \rv j6   q l! Aj" I\r A A ( ! E\r   6  Aj!  (, \rj"6,   j" " Atj   kAu J! A H\r A !@  O\r   kAuA	l!A\n! ( "A\nI\r @ Aj!  A\nl"O\r @ A   Aæ Fk A G Aç Fqk"  kAuA	lAwjN\r  A0jA`A¤b A Hj AÈ j"A	m"Atj!\rA\n!@  A	lk"AJ\r @ A\nl! Aj"AG\r  \rAj!@@ \r( "  n" lk"\r   F\r@@ Aq\r D      @C! AëÜG\r \r M\r \rA|j-  AqE\rD     @C!D      à?D      ð?D      ø?  FD      ø?  Av"F  I!@ \r  \n-  A-G\r  ! ! \r  k"6     a\r  \r  j"6 @ AëÜI\r @ \rA 6 @ \rA|j"\r O\r  A|j"A 6  \r \r( Aj"6  AÿëÜK\r   kAuA	l!A\n! ( "A\nI\r @ Aj!  A\nl"O\r  \rAj"   K!@@ " M"\r A|j"( E\r @@ Aç F\r  Aq! AsA A " J A{Jq"\r j!AA~ \r j! Aq"\r Aw!@ \r  A|j( "\rE\r A\n!A ! \rA\np\r @ "Aj! \r A\nl"pE\r  As!  kAuA	l!@ A_qAÆ G\r A !   jAwj"A  A J"  H!A !   j jAwj"A  A J"  H!A!\r AýÿÿÿAþÿÿÿ  r"J\r  A GjAj!@@ A_q"AÆ G\r   AÿÿÿÿsJ\r A  A J!@   Au"s k­ ­ "kAJ\r @ Aj"A0:    kAH\r  A~j" :  A!\r AjA-A+ A H:    k" AÿÿÿÿsJ\rA!\r  j" 	AÿÿÿÿsJ\r  A    	j" ®    \n 	¨   A0   As® @@@@ AÆ G\r  AjA	r!    K"!@ 5  ­ !@@  F\r   AjM\r@ Aj"A0:    AjK\r   G\r  Aj"A0:       k¨  Aj" M\r @ E\r   AÊ A¨   O\r AH\r@@ 5  ­ " AjM\r @ Aj"A0:    AjK\r     A	 A	H¨  Awj! Aj" O\r A	J! ! \r @ A H\r   Aj  K!\r AjA	r! !@@ 5  ­ " G\r  Aj"A0:  @@  F\r   AjM\r@ Aj"A0:    AjK\r    A¨  Aj!  rE\r   AÊ A¨      k"   J¨   k! Aj" \rO\r AJ\r   A0 AjAA ®      k¨  !  A0 A	jA	A ®   A    AÀ s®     J!\r \n AtAuA	qj!@ AK\r A k!D      0@!@ D      0@¢! Aj"\r @ -  A-G\r    ¡ !    ¡!@ (," Au"s k­ ­ " G\r  Aj"A0:   (,! 	Ar! A q! A~j" Aj:   AjA-A+ A H:   AH AqEq! Aj!@ " ü"A j-   r:    ·¡D      0@¢!@ Aj" AjkAG\r  D        a q\r  A.:  Aj! D        b\r A!\r Aûÿÿÿ 	  k"jkJ\r   A    j Aj  Ajk" A~j H  "j" ®     ¨   A0   As®    Aj ¨   A0  kA A ®     ¨   A    AÀ s®     J!\r A°j$  \r.  ( AjAxq"Aj6    )  )Ò 9    ½ @  \r A Ù   6 A¬A!@@  E\r  Aÿ M\r@@A (ô¨ ( \r  AqA¿F\rÙ A6 @ AÿK\r    A?qAr:    AvAÀr:  A@@ A°I\r  A@qAÀG\r   A?qAr:    AvAàr:     AvA?qAr: A@ A|jAÿÿ?K\r    A?qAr:    AvAðr:     AvA?qAr:    AvA?qAr: AÙ A6 A!    :  A @  \r A    A ´ ø&# Ak"$ @@@@@  AôK\r @A (ø¹ "A  AjAøq  AI"Av"v" AqE\r @@  AsAq j"At"A º j" (¨º "(" G\r A  A~ wq6ø¹   A (º I\r  ( G\r   6   6 Aj!   Ar6  j" (Ar6 A (º "M\r@  E\r @@   tA t" A   krqh"At"A º j" (¨º " ("G\r A  A~ wq"6ø¹  A (º I\r (  G\r  6  6   Ar6   j"  k"Ar6   j 6 @ E\r  AxqA º j!A (º !@@ A Avt"q\r A   r6ø¹  ! ("A (º I\r  6  6  6  6  Aj! A  6º A  6º A (ü¹ "	E\r 	hAt(¨¼ "(Axq k! !@@@ (" \r  (" E\r  (Axq k"   I"!    !  !  A (º "\nI\r (!@@ ("  F\r  (" \nI\r ( G\r  ( G\r   6   6@@@ ("E\r  Aj! ("E\r Aj!@ ! " Aj!  ("\r   Aj!  ("\r   \nI\r A 6 A ! @ E\r @@  ("At"(¨¼ G\r  A¨¼ j  6   \rA  	A~ wq6ü¹   \nI\r@@ ( G\r    6   6  E\r   \nI\r   6@ ("E\r   \nI\r   6   6 ("E\r   \nI\r   6   6@@ AK\r    j" Ar6   j"   (Ar6  Ar6  j" Ar6  j 6 @ E\r  AxqA º j!A (º ! @@A Avt" q\r A   r6ø¹  ! (" \nI\r   6   6   6   6A  6º A  6º  Aj! A!  A¿K\r   Aj"Axq!A (ü¹ "E\r A!@  AôÿÿK\r  A& Avg" kvAq  AtkA>j!A  k!@@@@ At(¨¼ "\r A ! A !A !  A A Avk AFt!A !@@ (Axq k" O\r  ! ! \r A ! ! !    ("   AvAqj("F   !  At! ! \r @   r\r A !A t" A   kr q" E\r  hAt(¨¼ !   E\r@  (Axq k" I!@  ("\r   (!   !    ! !  \r  E\r  A (º  kO\r  A (º "I\r (!@@ ("  F\r  (" I\r ( G\r  ( G\r   6   6@@@ ("E\r  Aj! ("E\r Aj!@ ! " Aj!  ("\r   Aj!  ("\r   I\r A 6 A ! @ E\r @@  ("At"(¨¼ G\r  A¨¼ j  6   \rA  A~ wq"6ü¹   I\r@@ ( G\r    6   6  E\r   I\r   6@ ("E\r   I\r   6   6 ("E\r   I\r   6   6@@ AK\r    j" Ar6   j"   (Ar6  Ar6  j" Ar6  j 6 @ AÿK\r  AøqA º j! @@A (ø¹ "A Avt"q\r A   r6ø¹   !  (" I\r   6  6   6  6A! @ AÿÿÿK\r  A& Avg" kvAq  AtrA>s!    6 B 7  AtA¨¼ j!@@@ A  t"q\r A   r6ü¹   6   6 A A  Avk  AFt!  ( !@ "(Axq F\r  Av!  At!   Aqj"("\r  Aj"  I\r   6   6  6  6  I\r ("  I\r   6  6 A 6  6   6 Aj! @A (º "  I\r A (º !@@   k"AI\r   j" Ar6   j 6   Ar6   Ar6   j"   (Ar6A !A !A  6º A  6º  Aj! @A (º " M\r A   k"6º A A (º "  j"6º   Ar6   Ar6  Aj! @@A (Ð½ E\r A (Ø½ !A B7Ü½ A B 7Ô½ A  AjApqAØªÕªs6Ð½ A A 6ä½ A A 6´½ A !A !   A/j"j"A  k"q" M\rA ! @A (°½ "E\r A (¨½ " j" M\r  K\r@@@A - ´½ Aq\r @@@@@A (º "E\r A¸½ ! @@   ( "I\r     (jI\r  (" \r A ¾ "AF\r !@A (Ô½ " Aj" qE\r   k  jA   kqj!  M\r@A (°½ " E\r A (¨½ " j" M\r   K\r ¾ "  G\r  k q"¾ "  (   (jF\r !   AF\r@  A0jI\r   !  kA (Ø½ "jA  kq"¾ AF\r  j!  ! AG\rA A (´½ Ar6´½  ¾ !A ¾ !  AF\r  AF\r   O\r   k" A(jM\rA A (¨½  j" 6¨½ @  A (¬½ M\r A   6¬½ @@@@A (º "E\r A¸½ ! @   ( "  ("jF\r  (" \r @@A (º " E\r    O\rA  6º A ! A  6¼½ A  6¸½ A A6º A A (Ð½ 6º A A 6Ä½ @  At" A º j"6¨º   6¬º   Aj" A G\r A  AXj" Ax kAq"k"6º A   j"6º   Ar6   jA(6A A (à½ 6º   O\r   I\r   (Aq\r     j6A  Ax kAq" j"6º A A (º  j"  k" 6º    Ar6  jA(6A A (à½ 6º @ A (º O\r A  6º   j!A¸½ ! @@@  ( " F\r  (" \r   - AqE\rA¸½ ! @@@   ( "I\r     (j"I\r  (!  A  AXj" Ax kAq"k"6º A   j"6º   Ar6   jA(6A A (à½ 6º   A\' kAqjAQj"    AjI"A6 A )À½ 7 A )¸½ 7A  Aj6À½ A  6¼½ A  6¸½ A A 6Ä½  Aj! @  A6  Aj!  Aj!   I\r   F\r   (A~q6   k"Ar6  6 @@ AÿK\r  AøqA º j! @@A (ø¹ "A Avt"q\r A   r6ø¹   !  ("A (º I\r   6  6A!A!A! @ AÿÿÿK\r  A& Avg" kvAq  AtrA>s!    6 B 7  AtA¨¼ j!@@@A (ü¹ "A  t"q\r A   r6ü¹   6   6 A A  Avk  AFt!  ( !@ "(Axq F\r  Av!  At!   Aqj"("\r  Aj" A (º I\r   6   6A!A! ! !  A (º "I\r ("  I\r   6  6   6A ! A!A!  j 6   j  6 A (º "  M\r A    k"6º A A (º "  j"6º   Ar6   Ar6  Aj! Ù A06 A !      6     ( j6   · !  Aj$   \n  Ax  kAqj" Ar6 Ax kAqj"  j"k! @@@ A (º G\r A  6º A A (º   j"6º   Ar6@ A (º G\r A  6º A A (º   j"6º   Ar6  j 6 @ ("AqAG\r  (!@@ AÿK\r @ (" AøqA º j"F\r  A (º I\r ( G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  F\r  A (º I\r ( G\r  6  6 (!@@  F\r  ("A (º I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ !	 "Aj! ("\r  Aj! ("\r  	A (º I\r 	A 6 A ! E\r @@  ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹  A (º I\r@@ ( G\r   6  6 E\r A (º "I\r  6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6 Axq"  j!   j"(!  A~q6   Ar6   j  6 @  AÿK\r   AøqA º j!@@A (ø¹ "A  Avt" q\r A    r6ø¹  !  (" A (º I\r  6   6  6   6A!@  AÿÿÿK\r   A&  Avg"kvAq AtrA>s!  6 B 7 AtA¨¼ j!@@@A (ü¹ "A t"q\r A   r6ü¹   6   6  A A Avk AFt! ( !@ "(Axq  F\r Av! At!  Aqj"("\r  Aj"A (º I\r  6   6  6  6 A (º " I\r ("  I\r  6  6 A 6  6  6 Aj  Ä\n@@  E\r   Axj"A (º "I\r  A|j( "AqAF\r  Axq" j!@ Aq\r  AqE\r  ( "k" I\r   j! @ A (º F\r  (!@ AÿK\r @ (" AøqA º j"F\r   I\r ( G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  F\r   I\r ( G\r  6  6 (!@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! E\r@@  ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹   I\r@@ ( G\r   6  6 E\r  I\r  6@ ("E\r   I\r  6  6 ("E\r  I\r  6  6 ("AqAG\r A   6º   A~q6   Ar6   6   O\r ("AqE\r@@ Aq\r @ A (º G\r A  6º A A (º   j" 6º    Ar6 A (º G\rA A 6º A A 6º @ A (º "	G\r A  6º A A (º   j" 6º    Ar6   j  6  (!@@ AÿK\r @ (" AøqA º j"F\r   I\r ( G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! \nE\r @@  ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6  Axq  j" Ar6   j  6   	G\rA   6º   A~q6   Ar6   j  6 @  AÿK\r   AøqA º j!@@A (ø¹ "A  Avt" q\r A    r6ø¹  !  ("  I\r  6   6  6   6A!@  AÿÿÿK\r   A&  Avg"kvAq AtrA>s!  6 B 7 AtA¨¼ j!@@@@A (ü¹ "A t"q\r A   r6ü¹   6 A! A!  A A Avk AFt! ( !@ "(Axq  F\r Av! At!  Aqj"("\r  Aj"  I\r   6 A! A! ! ! !  I\r (" I\r  6  6A !A! A!  j 6   6   j 6 A A (º Aj"A 6º   @  \r  ¶ @ A@I\r Ù A06 A @  AxjA AjAxq AIº "E\r  Aj@ ¶ "\r A    A|Ax  A|j( "Aq Axqj"   Iã   ¸  		@@  A (º "I\r   ("Aq"AF\r  Axq"E\r    j"("AqE\r @ \r A ! AI\r@  AjI\r   !  kA (Ø½ AtM\rA !@  I\r @  k"AI\r     AqrAr6   j" Ar6  (Ar6  »   A !@ A (º G\r A (º  j" M\r    AqrAr6   j"  k"Ar6A  6º A  6º   @ A (º G\r A !A (º  j" I\r@@  k"AI\r     AqrAr6   j" Ar6   j" 6   (A~q6   Aq rAr6   j" (Ar6A !A !A  6º A  6º   A ! Aq\r Axq j" I\r (!@@ AÿK\r @ (" AøqA º j"	F\r   I\r ( G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  	F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ !	 "Aj! ("\r  Aj! ("\r  	 I\r 	A 6 A ! \nE\r @@  ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6@  k"AK\r    Aq rAr6   j" (Ar6      AqrAr6   j" Ar6   j" (Ar6  »      ø	   j!@@@@  ("AqE\r A (º ! AqE\r    ( "k" A (º "I\r  j!@  A (º F\r   (!@ AÿK\r @  (" AøqA º j"F\r   I\r (  G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  F\r   I\r (  G\r  6  6  (!@@   F\r   (" I\r (  G\r (  G\r  6  6@@@  ("E\r   Aj!  ("E\r  Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! E\r@@    ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹   I\r@@ (  G\r   6  6 E\r  I\r  6@  ("E\r   I\r  6  6  ("E\r  I\r  6  6 ("AqAG\r A  6º   A~q6   Ar6  6   I\r@@ ("Aq\r @ A (º G\r A   6º A A (º  j"6º    Ar6  A (º G\rA A 6º A A 6º @ A (º "	G\r A   6º A A (º  j"6º    Ar6   j 6  (!@@ AÿK\r @ (" AøqA º j"F\r   I\r ( G\r@  G\r A A (ø¹ A~ Avwq6ø¹ @  F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! \nE\r @@  ("At"(¨¼ G\r  A¨¼ j 6  \rA A (ü¹ A~ wq6ü¹  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6   Axq j"Ar6   j 6    	G\rA  6º   A~q6   Ar6   j 6 @ AÿK\r  AøqA º j!@@A (ø¹ "A Avt"q\r A   r6ø¹  ! (" I\r   6   6   6   6A!@ AÿÿÿK\r  A& Avg"kvAq AtrA>s!   6  B 7 AtA¨¼ j!@@@A (ü¹ "A t"q\r A   r6ü¹    6    6 A A Avk AFt! ( !@ "(Axq F\r Av! At!  Aqj"("\r  Aj" I\r   6    6    6    6  I\r (" I\r   6   6  A 6   6   6  k~@@  \r A !  ­ ­~"§!   rAI\r A  B §A G!@ ¶ " E\r   A|j-  AqE\r   A  Û    ? Atd~@@  ­B|BøÿÿÿA (ø¨ " ­|"BÿÿÿÿV\r ½  §"O\r  \rÙ A06 AA  6ø¨   ~~~# Að k"$  Bÿÿÿÿÿÿÿÿÿ !@@@ P" Bÿÿÿÿÿÿÿÿÿ "BÀ|BÀT P\r  B R BÀ|"	BÀV 	BÀQ\r@  BÀÿÿ T BÀÿÿ Q\r  B ! !@ P BÀÿÿ T BÀÿÿ Q\r  B !@  BÀÿÿ B R\r Bàÿÿ      BP"!B   !  BÀÿÿ P\r@  B R\r   B R\r  !  !  PE\r  ! !    V  V  Q"\n!   \n"	Bÿÿÿÿÿÿ?!   \n"B0§Aÿÿq!@ 	B0§Aÿÿq"\r  Aà j     P"yBÀ B  |§"AqjÀ A k! )h! )`!   \n! Bÿÿÿÿÿÿ?!@ \r  AÐ j     P"\nyBÀ B  \n|§"\nAqjÀ A \nk! )X! )P! B B=B! B B=! B!  !@  F\r @  k"\nAÿ M\r B !B! AÀ j  A \nkÀ  A0j   \nÊ  )0 )@ )HB R­! )8! B! B!@@ BU\r B !B !    P\r  }!  }  T­}"BÿÿÿÿÿÿÿV\r A j     P"\nyBÀ B  \n§Atj"\nÀ   \nk! )(! ) !  |  |" T­|"BP\r  B B? B! Aj! B! 	B!@ AÿÿH\r  BÀÿÿ !B !A !\n@@ A L\r  !\n Aj   Aÿ jÀ    A kÊ  )  ) )B R­! )! B B=! \n­B0 BBÿÿÿÿÿÿ? ! §Aq!@@@@@È  @ AF\r    AK­|" T­|! !   B|" T­|! !   B R A Gq­|" T­|! !   P A Gq­|" T­|! ! E\rÉ    7    7 Að j$ S~@@ AÀ qE\r   A@j­!B ! E\r  AÀ  k­  ­"!  !   7    7æ~A!@  B R Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ V BÀÿÿ Q\r  B R Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ V BÀÿÿ Q\r @     PE\r A @  B S\r @   T  S  QE\r A     B R@   V  U  QE\r A     B R! Ø~A!@  B R Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ V BÀÿÿ Q\r  B R Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ V BÀÿÿ Q\r @     PE\r A @  B S\r    T  S  Q\r     B R   V  U  Q\r      B R! ~~~# AÐk"$  Bÿÿÿÿÿÿ?! Bÿÿÿÿÿÿ?!  B! B0§Aÿÿq!	@@@ B0§Aÿÿq"\nA~jA~I\r A ! 	A~jA~K\r@ P Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ T BÀÿÿ Q\r  B !@ P Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ T BÀÿÿ Q\r  B ! !@  BÀÿÿ B R\r @  BÀÿÿ PE\r B !Bàÿÿ ! BÀÿÿ !B !@  BÀÿÿ B R\r B !@  B R\r Bàÿÿ    P!B !@  B R\r  BÀÿÿ !B !A !@ Bÿÿÿÿÿÿ?V\r  AÀj     P"yBÀ B  |§"AqjÀ A k! )È! )À! Bÿÿÿÿÿÿ?V\r  A°j     P"\ryBÀ B  \r|§"\rAqjÀ  \r jApj! )¸! )°! A j B1 BÀ "B"B B°æ¼õ  }"B Ì  AjB  )¨}B  B Ì  Aj )B? )B"B  B Ì  Aðj B B  )}B Ì  Aàj )ðB? )øB"B  B Ì  AÐj B B  )è}B Ì  AÀj )ÐB? )ØB"B  B Ì  A°j B B  )È}B Ì  A j B  )°B? )¸BB|"B Ì  Aj BB  B Ì  Að j B B  )¨ ) " )|" T­| BV­|}B Ì  AjB }B  B Ì   \n 	kj"\nAÿÿ j!	@@ )p"B" )B? )"B|"B|"B " BÀ "B"B "~" B"B " )xB B? B?|  T­|  T­|B|"B "~|" T­  Bÿÿÿÿ" B?" BBÿÿÿÿ"~|" T­|  ~|  ~"  ~|" T­B  B |  B |" T­|  Bÿÿÿÿ" ~"  ~|" T­   Bþÿÿÿ"~|" T­||" T­|   ~"  ~|"  ~|"  ~|"B   T­  T­|  T­|B |" T­|    ~"  ~|"B   T­B |" T­  B |" T­||" T­| A   B "  ~| T­B"V  Q­|" T­|"Bÿÿÿÿÿÿÿ V\r   ! AÐ j  BÀ T"­""   B A?s­"  Ì  \nAþÿ j 	 Aj!	 B1 )X} )P"B R­}!B  }! Aà j B B?" B"  Ì  B0 )h} )`"B R­}!B  }! !@ 	AÿÿH\r  BÀÿÿ !B !@@ 	AH\r  B B?! 	­B0 Bÿÿÿÿÿÿ?! B!@ 	AJ\r B ! AÀ j  A 	kÊ  A0j   	Að jÀ  A j   )@" )H"Ì  )8 )(B ) "B?} )0" B"T­}!  }! Aj  BB Ì    BB Ì    B" |" V   T­|" V  Q­|" T­|"  BÀÿÿ T  )V  )"V  Qq­|" T­|"  BÀÿÿ T  ) V  )"V  Qq­|" T­| !   7    7 AÐj$ ô~# Ak"$  ½"Bÿÿÿÿÿÿÿ!@@ B4Bÿ"P\r @ BÿQ\r  B! B<! Bø |! B! B<!Bÿÿ!@ PE\r B !B !B !  B  y§"A1jÀ  )BÀ !Aø  k­! ) !   7    B0 B 7 Aj$ ê~# Ak"$  ¼"Aÿÿÿq!@@ Av"Aÿq"E\r @ AÿF\r  ­B! AÿqAÿ j!B ! ­B!B !Aÿÿ!@ \r B !A !B !  ­B  g"AÑ jÀ Aÿ  k! )BÀ ! ) !   7    ­B0 Av­B? 7 Aj$ ¡~# Ak"$ @@ \r B !B !   Au"s k"­B  g"AÑ jÀ  )BÀ A k­B0|BB  A H! ) !   7    7 Aj$ ~# Ak"$ @@ \r B !B !  ­B Að  g"AskÀ  )BÀ A k­B0|! ) !   7    7 Aj$  A  A S~@@ AÀ qE\r   A@j­!B ! E\r  AÀ  k­  ­"!  !   7    7µ~~~# Aà k"$  Bÿÿÿÿÿÿ?!  B! Bÿÿÿÿÿÿ?"B !	 B0§Aÿÿq!\n@@@ B0§Aÿÿq"A~jA~I\r A ! \nA~jA~K\r@ P Bÿÿÿÿÿÿÿÿÿ "\rBÀÿÿ T \rBÀÿÿ Q\r  B !@ P Bÿÿÿÿÿÿÿÿÿ "BÀÿÿ T BÀÿÿ Q\r  B ! !@  \rBÀÿÿ B R\r @  PE\r Bàÿÿ !B ! BÀÿÿ !B !@  BÀÿÿ B R\r   \r!B !@ PE\r Bàÿÿ ! BÀÿÿ !@  \rB R\r B !@  B R\r B !A !@ \rBÿÿÿÿÿÿ?V\r  AÐ j     P"yBÀ B  |§"AqjÀ A k! )X"B !	 )P! Bÿÿÿÿÿÿ?V\r  AÀ j     P"yBÀ B  |§"AqjÀ   kAj! )H! )@!  \nj jAj!\n@@ B"B B" B "~" B"B " 	B"	~|"\r T­ \r B1 Bÿÿÿÿ" Bÿÿÿÿ"~|" \rT­|  	~|  Bþÿ"\r ~"  ~|" T­   Bÿÿÿÿ"~|" T­||" T­|  	~"  ~|" T­B  B |  B |" T­|  \r 	~"  ~|"	  ~|"  ~|"B  	 T­  	T­|  T­|B |" T­|   \r ~"	  ~|"B   	T­B |" T­  B |" T­||" T­|   B " \r ~|" T­|" T­|" T­|"BÀ P\r  \nAj!\n B?! B B?! B B?! B!  B!@ \nAÿÿH\r  BÀÿÿ !B !@@ \nA J\r @A \nk"Aÿ K\r  A0j   \nAÿ j"\nÀ  A j   \nÀ  Aj   Ê     Ê  )  ) )0 )8B R­! )( )! )! ) !B ! \n­B0 Bÿÿÿÿÿÿ?!  !@ P BU BQ\r   B|"P­|!@  BB Q\r  !   B|" T­|!   7    7 Aà j$ u~    ~  ~| B " B "~| Bÿÿÿÿ" Bÿÿÿÿ"~"B   ~|"B | Bÿÿÿÿ  ~|"B |7   B  Bÿÿÿÿ7   A $ A AjApq$  # # k #  # T# Ak"$      B¿  ) !   )7   7  Aj$ ©~# A k"$  Bÿÿÿÿÿÿ?!@@ B0Bÿÿ"§"AÿjAýK\r   B< B! Aj­!@@  Bÿÿÿÿÿÿÿÿ" BT\r  B|!  BR\r  B |!B   BÿÿÿÿÿÿÿV"!  ­ |!@   P\r  BÿÿR\r   B< BB! Bÿ!@ AþM\r Bÿ!B ! @Aø Aø  P"" k"Að L\r B ! B !  BÀ  !A !@  F\r  Aj   A kÀ  ) )B R!     Ê  ) "B< )B! @@ Bÿÿÿÿÿÿÿÿ ­"BT\r   B|!  BR\r   B  |!   B    BÿÿÿÿÿÿÿV"!  ­! A j$  B4 B  ¿\n   $ #   kApq"$   # EA´ !@  AK\r @@  \r A !   At/ " E\r  AÄ j!      Ö © A°¥infinity new_capacity > bw->capacity bw->words <= bw->capacity metadata->data.vorbis_comment.vendor_string.length == 0 || 0 != metadata->data.vorbis_comment.vendor_string.entry FLAC__stream_encoder_set_verify FLAC__memory_alloc_aligned_real_array FLAC__memory_alloc_aligned_uint64_array FLAC__memory_alloc_aligned_int64_array FLAC__memory_alloc_aligned_uint32_array FLAC__memory_alloc_aligned_int32_array -+   0X0x -0X+0X 0X-0x+0x 0x 0 != bw bartlett FLAC__stream_encoder_set_rice_parameter_search_dist FLAC__format_seektable_sort cue sheet track must have at least one index point do_independent FLAC__format_entropy_coding_method_partitioned_rice_contents_init FLAC__bitwriter_init FLAC__bitreader_init FLAC__lpc_compute_residual_from_qlp_coefficients_limit_residual_33bit FLAC__fixed_compute_residual_wide_33bit FLAC__fixed_restore_signal_wide_33bit FLAC__lpc_restore_signal_wide_33bit FLAC__stream_decoder_reset br->read_limit_set 0 != object simple_ogg_page__set_at simple_ogg_page__get_at FLAC__lpc_compute_residual_from_qlp_coefficients FLAC__lpc_compute_lp_coefficients FLAC__lpc_quantize_coefficients br->crc16_align <= br->consumed_bits (br->capacity*64) * 2 >= bits 0 != aligned_address FLAC__stream_encoder_process FLAC__stream_encoder_set_channels FLAC__bitwriter_write_zeroes connes CD-DA cue sheet track index offset must be evenly divisible by 588 samples CD-DA cue sheet lead-out offset must be evenly divisible by 588 samples CD-DA cue sheet track offset must be evenly divisible by 588 samples CD-DA cue sheet lead-in length must be evenly divisible by 588 samples br->consumed_words <= br->words CD-DA cue sheet must have a lead-in length of at least 2 seconds FLAC__fixed_compute_best_predictor Unknown error 0 != unaligned_pointer unaligned_pointer != aligned_pointer 0 != aligned_pointer FLAC__ogg_encoder_aspect_write_callback_wrapper FLAC__ogg_decoder_aspect_read_callback_wrapper FLAC__bitwriter_get_buffer 0 != bw->buffer 0 != br->buffer 0 < *max_order 0 != max_order FLAC__lpc_compute_best_order FLAC__format_get_max_rice_partition_order_from_blocksize_limited_max_and_predictor_order default_partition_samples > predictor_order partition_order > 0? partition_samples >= predictor_order : decoder->private_->frame.header.blocksize >= predictor_order FLAC__stream_encoder_set_max_residual_partition_order FLAC__stream_encoder_set_min_residual_partition_order FLAC__stream_encoder_set_max_lpc_order 0 != encoder 0 != decoder FLAC__frame_add_header 0 != br FLAC__format_entropy_coding_method_partitioned_rice_contents_clear flattop FLAC__stream_encoder_set_do_mid_side_stereo FLAC__stream_encoder_set_loose_mid_side_stereo FLAC__stream_decoder_get_decode_position 0 != position FLAC__stream_encoder_set_apodization FLAC__lpc_compute_autocorrelation 0 != specification FLAC__stream_encoder_set_qlp_coeff_precision bartlett_hann lag <= data_len nan blackman FLAC__subframe_add_verbatim nuttall FLAC__stream_encoder_set_compression_level kaiser_bessel FLAC__lpc_compute_residual_from_qlp_coefficients_limit_residual FLAC__fixed_compute_residual FLAC__fixed_restore_signal FLAC__lpc_restore_signal FLAC__format_seektable_is_legal FLAC__bitwriter_write_rice_signed_block FLAC__bitreader_read_rice_signed_block FLAC__add_metadata_block FLAC__bitwriter_write_raw_uint32_nocheck 0 != encoder->private_->seek_callback FLAC__stream_decoder_flush FLAC__stream_encoder_finish FLAC__stream_decoder_finish FLAC__stream_encoder_set_do_exhaustive_model_search FLAC__stream_encoder_set_do_qlp_coeff_prec_search welch /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/include/private/bitmath.h image/png FLAC__bitreader_limit_remaining hamming undo_channel_coding FLAC__stream_encoder_set_do_escape_coding inf FLAC__stream_encoder_get_blocksize i < blocksize FLAC__format_entropy_coding_method_partitioned_rice_contents_ensure_size fifo->tail <= fifo->size FLAC__bitwriter_delete FLAC__bitreader_delete FLAC__stream_encoder_get_state FLAC__stream_decoder_get_state FLAC__stream_encoder_get_verify_decoder_state FLAC__stream_encoder_set_sample_rate !decoder->private_->side_subframe_in_use FLAC__stream_encoder_set_bits_per_sample FLAC__stream_encoder_get_bits_per_sample FLAC__lpc_compute_expected_bits_per_residual_sample FLAC__stream_decoder_process_single rectangle triangle 0 != seek_table FLAC__bitwriter_free FLAC__bitreader_free FLAC__lpc_compute_residual_from_qlp_coefficients_wide FLAC__fixed_compute_best_predictor_wide FLAC__fixed_compute_residual_wide FLAC__fixed_restore_signal_wide FLAC__lpc_restore_signal_wide FLAC__bitmath_ilog2_wide do_independent || do_mid_side FLAC__subframe_add_fixed aspect->current_linknumber == aspect->number_of_links_indexed FLAC__bitreader_read_unary_unsigned FLAC__memory_alloc_aligned FLAC__stream_decoder_get_input_bytes_unconsumed FLAC__bitreader_skip_bits_no_crc FLAC__bitreader_skip_byte_block_aligned_no_crc FLAC__bitreader_read_byte_block_aligned_no_crc FLAC__subframe_add_lpc /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/memory.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/ogg_encoder_aspect.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/ogg_decoder_aspect.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/format.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/bitwriter.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/ogg_helper.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/stream_encoder.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/stream_decoder.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/bitreader.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/deduplication/lpc_compute_autocorrelation_intrin.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/deduplication/bitreader_read_rice_signed_block.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/stream_encoder_framing.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/fixed.c /Users/bfb/soundetch_tmp/build/_deps/flac-src/src/libFLAC/lpc.c blackman_harris_4term_92db FLAC__stream_encoder_set_metadata read_callback_proxy_ bitwriter_grow_ read_metadata_vorbiscomment_ write_audio_frame_to_client_ read_metadata_cuesheet_ read_callback_ogg_aspect_ set_defaults_ resize_buffers_ precompute_partition_info_sums_ precompute_partition_info_escapes_ process_subframes_ process_frame_thread_inner_ write_bitbuffer_ find_best_partition_order_ read_frame_header_ read_metadata_streaminfo_ append_to_verify_fifo_ utf8len_ init_stream_internal_ verify_write_callback_ verify_read_callback_ 0 != encoder->private_ 0 != decoder->private_ read_metadata_picture_ process_subframe_ add_subframe_ read_subframe_ evaluate_lpc_subframe_ process_frame_ read_frame_ read_metadata_seektable_ free_ set_partitioned_rice_ add_residual_partitioned_rice_ read_residual_partitioned_rice_ add_entropy_coding_method_ read_subframe_fixed_ 0 != encoder->protected_ 0 != decoder->protected_ has_id_filtered_ full_read_ read_subframe_lpc_ update_ogg_metadata_ update_metadata_ find_metadata_ read_metadata_ read_more_data_ encoder->private_->current_sample_number == blocksize+OVERREAD_ OggS rice_parameter_limit <= FLAC__ENTROPY_CODING_METHOD_PARTITIONED_RICE2_ESCAPE_PARAMETER frame->header.number_type == FLAC__FRAME_NUMBER_TYPE_SAMPLE_NUMBER empty_frame.header.number_type == FLAC__FRAME_NUMBER_TYPE_SAMPLE_NUMBER decoder->private_->last_frame.header.number_type == FLAC__FRAME_NUMBER_TYPE_SAMPLE_NUMBER decoder->private_->frame.header.number_type == FLAC__FRAME_NUMBER_TYPE_SAMPLE_NUMBER metadata->type == FLAC__METADATA_TYPE_STREAMINFO NAN encoder->protected_->state == FLAC__STREAM_ENCODER_OK INF FLAC --> 0 != utf8 FLAC__bitwriter_get_write_crc8 description string must be valid UTF-8 br->consumed_bits + bits <= br->bytes*8 lag <= 8 FLAC__bitwriter_get_write_crc16 FLAC__bitreader_reset_read_crc16 FLAC__bitreader_get_read_crc16 lag <= 16 FLAC__clz_uint64 FLAC__bitwriter_write_utf8_uint64 br->consumed_bits < 64 subframe_bps == 33 subframe_bps < 33 FLAC__bitmath_ilog2 FLAC__clz_uint32 FLAC__bitreader_read_raw_uint32 FLAC__bitwriter_write_utf8_uint32 FLAC__STREAM_METADATA_VORBIS_COMMENT_NUM_COMMENTS_LEN == 32 FLAC__STREAM_METADATA_VORBIS_COMMENT_ENTRY_LENGTH_LEN == 32 bits <= 32 order <= 32 parameter < 32 lag <= 12 header->channels == 2 encoder->protected_->channels == 2 decoder->private_->frame.header.channels == 2 parameter < 31 reference libFLAC 1.5.0 20250211 cue sheet track index numbers must increase by 1 cue sheet track\'s first index number must be 0 or 1 CD-DA cue sheet track number must be 1-99 or 170 autoc[0] != 0.0 cue sheet may not have a track number 0 v > 0 elements > 0 metadata->data.stream_info.channels > 0 total_samples > 0 parameter > 0 max_order > 0 twrap > 0 precision > 0 lag > 0 new_blocksize > 0 frame_header->blocksize > 0 metadata->data.stream_info.bits_per_sample > 0 page->body == 0 page->header == 0 page->body_len == 0 page->header_len == 0 length == 0 _best_subframe == 0 rice_parameters[0] == 0 used_bits % 8 == 0 FLAC__STREAM_METADATA_CUESHEET_MEDIA_CATALOG_NUMBER_LEN % 8 == 0 FLAC__STREAM_METADATA_CUESHEET_TRACK_ISRC_LEN % 8 == 0 data_len > 0 || total_error_4 == 0 data_len > 0 || total_error_3 == 0 data_len > 0 || total_error_2 == 0 bw->bits % 32 == 0 data_len > 0 || total_error_1 == 0 data_len > 0 || total_error_0 == 0 (br->consumed_bits & 7) == 0 (bw->bits & 7) == 0 page->body != 0 best_residual_bits != 0 page->header != 0 page->body_len != 0 page->header_len != 0 . b + bytes - synthetic_first_packet_body == sizeof(synthetic_first_packet_body) FLAC__bitwriter_is_byte_aligned(bw) header->channels > 0 && header->channels <= (1u << FLAC__STREAM_METADATA_STREAMINFO_CHANNELS_LEN) && header->channels <= (8u) header->blocksize > 0 && header->blocksize <= (65535u) encoder->protected_->qlp_coeff_precision <= (15u) precision >= (5u) *bytes >= (4u) *max_order <= (32u) FLAC__bitreader_is_consumed_byte_aligned(decoder->private_->input) cue sheet must have at least one track (the lead-out) (max_rice_partition_order == 0 && blocksize >= predictor_order) || (max_rice_partition_order > 0 && blocksize >> max_rice_partition_order > predictor_order) *position >= FLAC__stream_decoder_get_input_bytes_unconsumed(decoder) FLAC__bitreader_is_consumed_byte_aligned(br) (null) FLAC__format_sample_rate_is_valid(header->sample_rate) FLAC__format_sample_rate_is_valid(metadata->data.stream_info.sample_rate) FLAC__bitwriter_is_byte_aligned(threadtask->frame) !ok || FLAC__bitwriter_is_byte_aligned(task->frame) FLAC__bitwriter_is_byte_aligned(encoder->private_->threadtask[0]->frame) FLAC__format_seektable_is_legal(encoder->private_->seek_table) MIME type string must contain only printable ASCII characters (0x20-0x7e) metadata->data.stream_info.channels <= (1u << FLAC__STREAM_METADATA_STREAMINFO_CHANNELS_LEN) metadata_length < (1u << FLAC__STREAM_METADATA_LENGTH_LEN) metadata->data.stream_info.max_blocksize < (1u << FLAC__STREAM_METADATA_STREAMINFO_MAX_BLOCK_SIZE_LEN) metadata->data.stream_info.min_blocksize < (1u << FLAC__STREAM_METADATA_STREAMINFO_MIN_BLOCK_SIZE_LEN) metadata->data.stream_info.max_framesize < (1u << FLAC__STREAM_METADATA_STREAMINFO_MAX_FRAME_SIZE_LEN) metadata->data.stream_info.min_framesize < (1u << FLAC__STREAM_METADATA_STREAMINFO_MIN_FRAME_SIZE_LEN) header->bits_per_sample > 0 && header->bits_per_sample <= (1u << FLAC__STREAM_METADATA_STREAMINFO_BITS_PER_SAMPLE_LEN) metadata->data.stream_info.bits_per_sample <= (1u << FLAC__STREAM_METADATA_STREAMINFO_BITS_PER_SAMPLE_LEN) CD-DA cue sheet must have a lead-out track number 170 (0xAA) !(FLAC__bitreader_get_input_bits_unconsumed(decoder->private_->input) & 7) new_capacity >= bw->words + ((bw->bits + bits_to_add + 64 - 1) / 64) subdivide_tukey(3) decoder->private_->side_subframe_in_use != (decoder->private_->frame.header.bits_per_sample < 32) subdivide_tukey(2) tukey(5e-1) (bits == 32) || (val>>bits == 0) do_escape_coding != (raw_bits_per_partition == ((void*)0)) punchout_tukey( partial_tukey( subdivide_tukey( gauss( Rewinding, seeking not necessary\n Rewinding, seeking necessary\n Bitreader was %llu bytes short\n Error allocating encoder\n FLAC__lpc_quantize_coefficients: negative shift=%d order=%u cmax=%f\n Error setting up encoder %d\n      	8?61$#*-pw~ylkbeHOFATSZ]àçîéüûòõØßÖÑÄÃÊÍ¨¯¦¡´³º½ÇÀÉÎÛÜÕÒÿøñöãäíê·°¹¾«¬¥¢\' ).;<52\r\nWPY^KLEBohafst}z±¶¿¸­ª£¤ùþ÷ðåâëìÁÆÏÈÝÚÓÔing`ur{|QV_XMJCD!&/(=:34NI@GRU\\[vqxjmdc>907"%,+®© §²µ¼»ÞÙÐ×ÂÅÌËæáèïúýôó  \n   36 < 9( -\'" cf l ix }wr P U_Z KN D AÃÆ Ì ÉØ Ý×Ò ð õÿú ëî ä á  ¥¯ª »¾ ´ ±    °µ¿º«®¤¡àåïêûþôñÓÖÜÙÈÍÇÂ@EOJ[^TQsv|yhmgb#&,)8=72	05?:+.$!`eoj{~tqSV\\YHMGBÀÅÏÊÛÞÔÑóöüùèíçâ£¦¬©¸½·²³¶¼¹¨­§¢ãæìéøý÷òÐÕßÚËÎÄÁCFLIX]WRpuzknda %/*;>41\r   \n  ° 6 <º (®¤ "à f lê xþô r PÖÜ ZÈ N DÂ@ Æ ÌJ Ø^T Ò ðv| úh î äb  &, ª8 ¾ ´2    0¶¼:¨.$¢`æìjø~tòÐV\\ÚHÎÄBÀFLÊXÞÔRpöüzèndâ ¦¬*¸>4²	\n\n	\n		\n\n0	¶	¼\n:	¨\n.\n$	¢\n`	æ	ì\nj	ø\n~\nt	ò	Ð\nV\n\\	Ú\nH	Î	Ä\nB\nÀ	F	L\nÊ	X\nÞ\nÔ	R	p\nö\nü	z\nè	n	d\nâ	 \n¦\n¬	*\n¸	>	4\n²\n		\n	\n\n	 \n°6<º(®¤"àflêxþôrPÖÜZÈNDÂ@ÆÌJØ^TÒðv|úhîäb &,ª8¾´2  +< SD x o£´  ð çÛÌ CTh;,à÷ËÜ³¤¨¿ÐÇûì 7sdXOÀ×ëü¸¯ctH_0\'(?PG{l ·óäØÏ@Wk|8/ãôÈß°§«¼ÓÄøï#4pg[LÃÔèÿ»¬`wK\\3$\n(\n?P\nG{l\n \n·\nóä\nØ\nÏ@Wk|8/ãôÈß°§«¼ÓÄøï#4pg[LÃÔ	è	ÿ	»¬	`	wK\\	3$		 +<SDxo£´ðçÛÌCTh;,à÷ËÜ³¤\r¨\r¿Ð\rÇûì\r \r7\rsd\rX\rOÀ×ëü¸¯ctH_0\'  ¨ <Ð D xì  ´  ðdX Ì@Ôè|8¬`ôÈ\\°$(¼PÄøl 4päØL\nÀ	T	h\nü	\n\n¸	,	à\nt\nH	Ü\n0	¤	\n(¼PÄøl 4päØLÀThü¸,àtHÜ0¤ ¨<ÐDxì ´ðdXÌ@Ôè|8¬`ôÈ\\°$?<<(?¼<P?Ä?ø<l< ?4?<?p<ä<Ø?L9À:T:h9ü:99¸:,:à9t9H:Ü90:¤:93 00¨3<0Ð3D3x0ì0 3´303ð0d0X3Ì5@6Ô6è5|65586¬6`5ô5È6\\5°6$65" !!¨"<!Ð"D"x!ì! "´"!"ð!d!X"Ì$@\'Ô\'è$|\'$$8\'¬\'`$ô$È\'\\$°\'$\'$.--(.¼-P.Ä.ø-l- .4.-.p-ä-Ø.L(À+T+h(ü+((¸+,+à(t(H+Ü(0+¤+(  {ó ãkÃ¸0K [Ó¨øp`è@;³È£ØP+xðàhÀ»3H#X\rÐ\r«ûsc		ëC8°Ë \nÛS(\nxðàhÀ»3H#XÐ«ûscëC8°Ë ÛS( {óãkÃ¸0K [Ó¨øp`è@;³È£ØP+¼x<ð<¼à=½½h=À?»¿3¿H?#¾X>Ð>«¾;û»s»;cº::ëºC¸88°8Ë¸ 9Û¹S¹(9 3{³ó³3ã²22k²Ã°¸000K° 1[±Ó±¨1´ø4p4´`5µµè5@7;·³·È7£¶Ø6P6+¶ "{¢ó¢"ã£##k£Ã¡¸!0!K¡  [ Ó ¨ ¥ø%p%¥`$¤¤è$@&;¦³¦È&£§Ø\'P\'+§­x-ð-­à,¬¬h,À.»®3®H.#¯X/Ð/«¯*ûªsª*c«++ë«C©8)°)Ë© (Û¨S¨((  øp àh	@\n¸\n0	È XÐ(xð`èÀ8°H ØP¨!"x"ð!\'`$$\'è(À+8+°(H. -Ø-P.¨3 0ø0p35à665h:@9¸90:È< ?X?Ð<(GDxDðGA`BBAèNÀM8M°NHH KØKPH¨U VøVpUSàPPSh\\@_¸_0\\ÈZ YXYÐZ(f eøepf`àcc`ho@l¸l0oÈi jXjÐi(twxwðtr`qqrè}À~8~°}H{ xØxP{¨xð`èÀ8°H ØP¨ øpàh@¸0È XÐ(ª ©ø©pª¬à¯¯¬h£@ ¸ 0£È¥ ¦X¦Ð¥(¸»x»ð¸¾`½½¾è±À²8²°±H· ´Ø´P·¨Ì ÏøÏpÌÊàÉÉÊhÅ@Æ¸Æ0ÅÈÃ ÀXÀÐÃ(ÞÝxÝðÞØ`ÛÛØè×ÀÔ8Ô°×HÑ ÒØÒPÑ¨íîxîðíë`èèëèäÀç8ç°äHâ áØáPâ¨ÿ üøüpÿùàúúùhö@õ¸õ0öÈð óXóÐð(  #0CP`s	 \n³ÀÓãð 3@Scp£°ÃÐàó¢#  3¡@&S§c¤p%*«£¨°)Ã®Ð/à,ó­ 3²#±00C·P6`5s´»: 9³¸À?Ó¾ã½ð<ÄE F3Ç@@SÁcÂpCLÍ£Î°OÃÈÐIàJóË UÔ#×0VCÑPP`SsÒÝ\\ _³ÞÀYÓØãÛðZ fç#ä0eCâPc``sáîo l³íÀjÓëãèði÷v u3ô@sSòcñppþ£ý°|ÃûÐzàyóø 3@S\rcp£°ÃÐàó #0CP`s ³ÀÓãð ª+#(0©C.P¯`¬s-"£  ³!À¦Ó\'ã$ð¥;º ¹38@¿S>c=p¼³2£1°°Ã7Ð¶àµó4 ÌM#N0ÏCHPÉ`ÊsKDÅ Æ³GÀÀÓAãBðÃ]Ü ß3^@ÙSXc[pÚÕT£W°ÖÃQÐÐàÓóRnï ì3m@êSkchpéæg£d°åÃbÐãààóa ÿ~#}0üC{Pú`ùsxwö õ³tÀóÓrãqðð   \n0@P`p06< :°(À.Ð$à"ðeci o°}À{ÐqàwðU SY _0M@KPA`GpÏÉÃ Å°×ÀÑÐÛàÝðÿ ùó õ0ç@áPë`ípª ¬¦  0²@´P¾`¸p °ÀÐàð¡±ÁÑáñ«­§!¡1³AµQ¿a¹qþøò!ô1æAàQêaìqÎÈÂ¡Ä±ÖÁÐÑÚáÜñTRX!^1LAJQ@aFqdbh¡n±|ÁzÑpávñ17=¡;±)Á/Ñ%á#ñ\r!1AQaq35?£9³+Ã-Ó\'ã!ó#	3CScsVPZ#\\3NCHSBcDsf`j£l³~ÃxÓrãtóüúð#ö3äCâSècîsÌÊÀ£Æ³ÔÃÒÓØãÞó£³ÃÓãó©¯¥#£3±C·S½c»s¨®¤"¢2°B¶R¼bºr¢²ÂÒâòÍËÁ¢Ç²ÕÂÓÒÙâßòýûñ"÷2åBãRébïrgak¢m²ÂyÒsâuòWQ["]2OBIRCbEr"2BRbr24>¢8²*Â,Ò&â òfLaCCaLf                         $       @   @          ÿÿÿÿÿÿÿÿ        @         @      `         n         @                                                    þ?                                                                              @   ID3                                                                Q.                                      Q.                                       Q.                                       Q.                                     Q.                                      Q.                                      >.                                      >.                                      É-           è        ·Án;	Ù&C\rÜvkkÅ²MPG¸í&ðÉ"ÖÖ/aËK+d5ÓÍ1\n <½½O8pÛLÇÆÐHàE©ýRA¬­_°Ô[ÂVuVRÈ6j+Øn¦\rcZg@y£]Ü}z{pÍf^tà¶#W«â¡9`<À\'ÝæRû¥åædX[+¾ïFêº6`©·}h³-/­30î©ê­¤]l m2Ô\'póÐþV°ÝIKqÙL6Çû÷Ã" ´Î=uÊ(:òûöF»¸ûñ¦yÿôö>áCëÿåÍ¼è-Ð}ìwp4ÀmG0K=®VÅ9«\'C#Å= .r Á*ÏxO¡¦»Íë¤öK}ÐÊÍÉ«x°¶V|iqÞÔuÛÝklÀRoµæbûÐf¿F^[^ZÑ}Wf`ÜSc0MÔ-ZI\rDºØ@Æ¥¬ Ûd¨ùý\'¥Nàæ¡K°¡¿ü­`»%#¶â²/+­6lA/ö\rîó]©D@hf+*{êç´àP uä&6é>;÷í;k°óvq÷UP2úâMóþ_ð¼Æèí}Â1Ë>ÏÖÿË¸Õ4yÑí½:ÜZ ûØîàiYýÍmÛ`7ÆOd2zÉ~\\­së°KwV\rOáÅK86F+GB{ \\=fÁXä@US]CQ;%)&Ü!ð ,G^(BM6õPØ2,v?kZ;&ÖËÔHí\nÿðVú M½Ð#RV/ñ¹Kîõ`m­ø×plüÒ +âe=êæ¼©ëhï¶»\'×¦æÓØ¥ÞodÚjÍ#ÄÝÐâÀö¡Í³ë`É~>½Éÿ¹¶¼´§«}°¢û:®æûªÌÀ¸§{Ýy£Æ`6q}÷¨[´Fu2­ót-°Ã0q].KY÷«T@¶ÉPEæNòûOJ+ÝGÀÍC!}{`COF rø[ÁvýhJGl0a$-ÅeéK^VZp0mØ5= ^[ìÜQ¦7æ»R3?>Ð:Ð$:ÍV ãë-TöÔ)y&©ÅÎ;hÁ+Ì  êÈ¥P­ÖMlÒËk/ß|vîÛÁË¡ãvÖ`ç¯ð#êíâî½¥ðª dôs\'ùÄæý	ý¸¾àygÆ:ÐÛûÕ¼b}»°>­ÿ±°¯\rq«ß+2¦h6ó¢mf´¼Ú{u¸]6µ´@÷±    ÜÁÒò Ó_ër©!$Euà=¦¿Öåz~Ï7RCHQX]Ýº*£øûblÏ\'£uôüo(=½QÏZHÂ£°ÀÄºbººuUf{lµ$õiå\'AØ HNFë:òèèù=ß48$\rçgÏ;¦Ö­&6£ ú÷ºò)¨QõiHReSÖ·uÅ\\Hltuëª¨´òx{ë\n§* ØÝTÏïÖ=ÒÊ=O$5­ò0élëâ:3 æòBÖu@MÏ§$ÕOÓ=gîºº»/£hhpH´±QÈÎÏÿ-ÁQl_uLlFA­_Cò´á3­3åMb9{ÖêÓ¤6v/ËÂî±ükÍpå¹·*kÏ3\\¸Ø.dQÁü_÷Q6Piåñ¨ü#öÖ3**ÆùHÁ´%Øf\r´_ÛÑuF	*­{Þë´©¤{xTbL«>wÊìjZåa¶ü³eÄÁ¹Ã{Á$ºØöÌå3$*V8­ëäØ´97_KëFF8®Mù|¦{BgbÜyÁ´q¥ ­£v_FÑª_Ðà4!æß~b¿{F+üû÷Cå)$[øÝ£Ø¾^bÁl=*Qü3ÌØDPF~"Kgð1ù¨Çí8±>gZgâ¦CµÊÄZÝÚÅ6¨Ä/zcºàM¿{ùl$í°å?CÝWÄ@Ý/2X6à"bù×þ£à-üwñ=¥Ù ÁÊÖg¸\n_~jp!±]¬à¨¿Cý£~Z/¾î/¢b/6p±pÝm±ÄÐÏçË5QùGÄàì­g(0l~úã3?òZECmMZ¿J±ÍÓ¨­u~²q´g`¢ë~*ÀTZ÷ØC%Ê¨W×±ÿ668#÷/êð¨Ä,iÝJV}Ö¯YàÝHùÔ´ÊÃuÓÛ*8cë!±}î¡T÷Tr&®Êô÷IZ6ipéU¨i;/Ö¦ó¿Þ HT¬üM~Ç/ÓîÈ±ispp¡n¿²Ï¦DaM6½QTälÓYI­Êò!ùF38+<M÷àîÎ3Ó¼ïnòiã.Cp1ýC!Ý[£M¦bTtT=¿ü¦Ô Á!i| 8»¯_ÓÉsÊ	à,Õ!þ~÷Ú¿î^á8ó=Ø!!îÊS2FÓH8¶ùdG¦îg÷Ä³Zpyoi«¼ÄÙ`{T<ÆºMîå¦É$¿N    ¬ØY±õi²bºëÓG8dÅ¿È6=t\r±¬$Ö§	£z*\n­#ÎpÈ÷dR~;ù=ãlzèëÖ0b#YåH¬OÏ FõþÁY&T-Ó²õZGÝëDà;g<Í:îÉ¤8ie|9ü"w<{¯=ò{Æ?u×>ØôÐ5_X4Ö­a6Q¹7ÄF²2Cêj3Ê1M³Û0X&ôG\'.%­ö$êý!F% ³L"#¨<Z(/)¦eë+!É3*´8/3"à.º×,={Q-À!+vGówÎxuIÔBtÜIq[?pÒÊørUf søEîxé6yö_{q°zä÷c[T~ê®=|må}°é¡k7Eyj¾°h9Èi¬[Ãl+÷m¢ro%®ªnde!¼dÔÕfx\rg?bÞcf·aÊo` ±>M§æL.èN©DWO<\\J»¯K2ZíIµö5HÕûCy#BJ@ AgDËAE\n>(GðFPy´P×ÕlQ^ SÙÝRLËÖWËgVBgTÅ>¿Uhq^ï±©_fDÀ]áè\\t¯YóËXzö¢ZýZz[CVìïíçï	¶?îñ4ë]ìê¨è]é¸\'â?Kã¶~"á1Òúà¤ñå#9)äªÌ@æ-`çðÜñw\'ðþÒmòy~µóì9¾ökf÷â`õeÌ×ôÈïÿOCÁþÆ¶¨üApýÔ]{øSñ£ùÚÊû]¨ú`ÓC×çÖnòÔé&*Õ|a!ÐûÍùÑr8ÓõHÒX·Ùß^ØVî7ÚÑBïÛDäÞÃ©<ßJ\\UÝÍðÜÉÊ·ËBxÉî È©«ÍsÌðÎ\\ÂÏ(Ä¯ÓÔÅ&&½Ç¡eÆ4ÍnÃ³a¶Â:ßÀ½8Á@b}ÇÎ¥N;ÌÉ\\ÐÛ|ÇR®Õ%vx¸ÿª`v_	ñóÑd´ÚãjíkíA³0ª÷·/>óF¹_,«´M"A$¥íüÎ2bê;[|PÐ%á9 òh¡\'^° ®«Ù¢)£¼@\n¦;ìÒ§²»¥5µc¤­¯:u®Ï¬cÄ­$Ï¨©}~«\rÑ¦ªÐ:â¼W:½ÞcS¿YÏ¾Ì»K$XºÂÑ1¸E}é¹è^\'²oòÿ³æ±a«N°ôìEµs@´úµô¶},·    ·mÜÙ(¼n²w`Lõ|²Ö ÜdïÀkþ\nêù½%Ó°ðEd*Ô¸NrYÖü9afhå£-÷·y+zKÍc¦aáûWIû7ÈÓë©µþ/Òpä²Çn¬ùrcf®uÑÎÂK|ñFéêFÜ6(nóVôô\nCqJ-"*¸köûÞLDnÏ"ö¯ltsþöoI³\'ºìÓ RkýåñÁCç¡<Ù}W\'aà½e½Ý9Xóäïiz8Û\rX6A`]¿âê%Dø$3\røUÑâ\n~\r¸	m;"d±PÜæ­çFqôü>nÍ_ù(èô ã1ºHZDTíÞalè4ö{4ö½&A\'jú/pFóñòZDk*ÙèæC:ü%íßK¿%\r÷c¿ùi£Nóu AÛoÃ¤Öú;Lç}þàÊd[¡G bx²ûÏ(x\'®NÂÔ}wf\n~Àüg¢«å¾br*ÿÅ°ÞûîÌ°aÞÓôpiI¬·°µ-vlÛllÐ\rc5ºùiéÔKcÑsU/ñI¿µÑëõf)=æ¦ª§zÄüsÆqÚ¯ë~ÁY	fvÃdº¥_ ?aÎãy{?éù#¥sÿËÁã|[C¾òQ	g8èíÐ¢1»\\-ÆjñbtÕîpM´¨utm Ú:oÈ±ÄíÔ^hì÷hßv´ì{L[áb5SðÉx,é7ú0^­ì0àPæãåµQyi?Ëÿ	QÕã¯ÉT5}:\nug©OV»øÌvg~!älÛJîÇý2ô{$¨§EÎñBòTæëþ+|"@>÷iâª.0s^H­õwÿ7«ïË&Má ú{m×É·#SwkB5õ¯rR2,hîGyêòðã.QðN)Ëëá\\\\2¨û<2àîÌüYVy 7ä@~cáyVf¥80Åª|äTþSÎÙ=|ä¹æe¹ëqqA`Ã!×Yký¼§éá==eó]Ò³södé¸j[ìØÝÁ¶?¥nÄo¤ØtxÆj­\\e¶ÃîÖtt\ný¨ÊÆ¢çªq8v^â§ÄOÉvø/~ìóï¢z3Ì:\rS{ `    g\rIÏ¨Ûô äùiLî²+ãûéA`äÈóÓ¯þaã(Kó,\nºÒißÊÁÈ¦ÅX&£ê+êB<1%1x\n	;Ân6Æ!P¡,ÏâíÂ«EÕp"Ø9¯e"fhJµÎ8©rØ,#¡åj6M±»*ø©B$a³ÉÐ>®*xb§âu+0Jbð½-o¹£·.hºÉ¹À­4§ [ C ­ëNé:CY2·$T{¥^Á(oS¿ÇDS2 I&ªá«ì§¨<D°s±#½:^ÊÓdÇODÌÐÉ«ÝÝÝ>&Pç3oÇO$´J()ýX#GÕc.BË9ÕÏ¬4Û×gVàÚ.ÁHÍõL/À¼R\rßjÌHÂÅ¥^Ñì¥\\éáìËAö7F&û~T\nñÄÙmüNÅëVÃ¢æ×äZî­ÍFv@!?ñ¯|e¢LëÍµfª¸Þr[%ÿæVlhNA·å)Lþ÷FDzbK\ríÊ\\Ö`­Qt²dùá¿-nI¨öã.¥¿ý}pkpÏçÃgj¤j]~¦óèïd@4é\'}ûÇvláÄUl£x`çõïm®bGzuï w<¼\r1aD¦É+®Ö?`-²âmd%Jz¿¨-wöº}L7fp ÎgÞ-©j9l´å%#Mþ®*·°F=oKÇªÇ\\\' QU3²®¾ì¿ç)D¨<¤#¥u¶¯Ï;h¢¬Àµ]!§¸5[ï¸ëV¦/CA}¢$L4ñ`üG	Èë¯æÕ.ãgK¼,õ OgÏÝ¨ìoäá&Löý+û´	#n.ÄÆ9¡4V×­íÚäEÍ?"ÀvÊÌiÇÁÐ^¦Ý>ìê3¥B$~\r%)7â^obSBøÊDu­IÐaª+ìá§b{I°¹ö.½ðä·JieºþÍ­Øsª gCjêæN#}NYøð)T±îclÁôÄy£Smx¨àïuáwGb:ú osèeÉekhòÃ[¤rkéæè q@{ü\'2M;Àc6AWË!Ú¬,ÓÎÏ(CàÂaÔHÕºY/ØóKÒIÆdß QÌÈÛÜ«ÅÈ&iEç+ ÒO<û_(1²A\néÌmäÂ[ÅóÖ¢þPÂ«OîâØF9U!\npG\r ÊÊj\r]ÂXÐ¥ÄôêIéù£ÞAîxS&ã1    x\r(ðP6x-à5 l8w/ðZh"ØAÀk@Ù¸fhÂ0qïH|8ô ^àµXSÈ®ÐD°¨I7ÊA¶OÇi­ÇÐ¿Ý9×ÿáÚ¯òÉÁ\'å±ì_è÷÷¡o¬)t»QY¶yB¡oçñ5Ù.ÙBh¡js)^Q:E9¼âA±ÊÉ¦²2±«)â±aï*ªéøRõzù×¢ÝÚÆ	ÍòëqÀÚðîCÞN+ÅYSèfT{óv£²v{©þlóaÛ.(CV%kÞ21¦?;*Îãk¶Ëp>³]F\nF²ÐÊ­ËB	Õæ:ýýR&%¼*+\r§¢<uÚ1]rxÅ	\nuíb?úo½$Meeê@M~bW5SZHÙÄfýÔì}uÃP\rÎ¼Keìd\náLö4<íû\'E²¿=¿¬¤µ¨ÔÍ¥ü¥$ÓÝÈUtå-\\þkÇ¸ï£ã¿¯gÔó¢OÏ{µ7â¸ù«ñaÓü¯z[ë×W#æÿLKÄ\'\r3É»Þw;ÃÓ_ \\P$]®¬JÖ8ÔGþ#¼e&bÄhyLvT4r^O;Æ×ä6îÌl!á,¾ú|f»N 6ôÓ:Ë¥«7ã¾# [-³3kÉKCÒÃ;ÿ»äQ|k\\£gãKÛJFóQód+i~{&{sS=äðý¢êÚ%lçò>Å*|ÈdôßzIÒRR$ÊÊ\\âÑÔü¬²çÄ®j¦¼£B½4´:L¹\n³Ír¾¡Öú©Ùû¤ñàê)¡ºybQÊØÉ²Õá:Â"BÏ±9*íixRàAcÚ÷9N¢úU=yÈ{Età`ÍcMµn°VÝLh¥A@-V8!U[:ý¢ ¹\rØuð\'(Îe* Õí=xø0Pãa)Nu$fn3Cé>6XîùÆq¾/	4¡B¬ÙO&·QX^)UvAw®À9zÛ±mþöÉ`ÖíVãÃ.î\'Ø¦ù_õÞôwî¶Ö¯¯ÎÛ´FÌÿ>Á×Oîgf,77v½ïv°Çm§¿@þª[¸ À­$Hº\\+0·t0X¬q j¨üGÐÔ\\xËLÄ ÆdßÑòðÜ4éþì¨àóÄ³hä¼éjM«÷ge°p}5o_íÇRÅÜE½ñçHêO\rr7%i¿]DÇu_¯4­×9_.ý(\'#Õ3    hWO"Ð®3¸ùÑó½9âÕËvÑm2§Àeèæ{9s÷n<Ä«íÕÃÀ¢Æ¥J®ò7Ô&~\\Ì÷ræÝ%©î\'ÜxÿO7?Jîß."¹@Aò*K;äÚ\\å4²DÙ1×¬ÈYãûáy2ê.}/ò$È>s\r"VJÝÜO¸ñÍ\'ï¾þoï÷A É»ØáJôëY³%ú1äj:4+\\ÖÍä/	xSãV.òmaÁÕø°Ð½¯ÿ¸ÊÐX2hd# 3Æ~o]8\'®ÁÃ6ÆöÃódç«¤+Ô]úÅ{\nµéùøßÛË)&\nÚAqED­,Câ8º3)üí|±çêæ¨-Ry<:H6ü?-ÞíWzÞï@ÏÔ%úr4f­=ÞTì¶£Ö³fKÇÛ1ôcÈÕåÃuÃÒNá¥mðÍ:Ð0È_8! wñ¦p¦éÆ¬\\×cûäÛÂõ³U5¶0e$Þg*fûÉ´ p/1Â` ;±ÈlþÓÍ	Â¥^Yñ§àuðÇ\nüÞºõ(,p$9D\'kùABè)ÌÛìÊù»RìçÉýï°ÎWIWß?:{ðR,¿=êÕn,!eîÐ-tbG>~³VV)üSL;[´â¥ëµÅé^ý¾¡EGÀ°-p(uga@"(RøÛùC¶©¢Ë¸qõÉU¡[Z¤>òKÌi½xtliÇ#Ob¸^\nÌ÷m²5&|Úbi¼ß­·PÎ©gþPJôå[t£ªhÌZ{y¤\r4¹¡hÜ¨É?qÆB\r¬gÍ½Ù·cß4G_ÚQ¯N²à}\nÿ1lb¨~ëÑL¤;(µSÒuV:d>MuW´¤Fîãë`¿pqøè?B@îS(F¡-#IEt±ý× ÚX¹ö®Çö\'¿¯¡hªÄnÂÏ]zjL=QjlaÊ{6H¼ÏTYÔÑýó¹ª¼»Smªi"@à*_Q}b0ÁsXÓ³]¶f¢5á)øåO·¦,·óDcK½²#êýU&DNØZwö!fvÄ£å|q²+>5Òï] PXàHA0·rNÖcàEETöMgNëv&¼Ó¶#Ù;§Któw¥ êo~zYØMÂ 	\\ª÷F¯®ÇÅá¾<0¯ki7ä`««¹zºÑÎ5zÔ«Ýk¼üXCIlR    ÊÜ¡[¹C·^eâìnFjU²ç1×ÝÁ¤>ÝÔô-ªdÏc`¸n8¡³Ê¾kokå5\n	ÿÖ(RË§Ø­{yö_Â:ATÉÇ?ÀpÝp\n¬|+õzTy?¦õ"aÃÎ«¶j È³Hþ­Q¤4qðÿ!Rp_ëÑµë3è7³¾<65tàn*uàYÔÙüÕS]Ð6¿<AêgáºáJ=ºXùVÞX\rêõ¨ò )	©~LëE´Juî¿GOÃá"­/+þtÔ($&ô}@gMÆÊKFbLÃßÿ!û# B¤à¾xAåÖ£	ÁRÝÊ¦ÔIsåc¯D8|ylj¶¥Í1èÀ/Ý"ã* )Ë[w®i·½rÈì8CßHº{¤×fÚÿm~yÜ±ß"Ô=ÎH·Þ´Ç}#g÷pé»V+(°ò­âlSö¼	±vÕAcöá©*1º÷OÓV=r\rüÖ6DwÐh!<¢ý4g]+5÷½nÉ_NþÙÂEZ_ûVüè ¸³¨QHLbé<èûö4ª 7?&ýã¯}£MiZìÊÄ\\PeÃ5/Èé&t	âòÃ>#©[ÁEW`3U yù¡"§ìCÎm0â¬;FfççH8¤ò^¤ÿ\r­ÇT-ö1ÏSínAæÊÇX:k_pÌ(+øòØÔ2.ylKc¦:8g¾­@?åó%Ý	9ù|RÆ/T óõ[R·J¶ìYAj³1ÍøQÝ$ðp&ØÛÑ}¾3LbÊi6LGµÐuûÓÔ ,Úüòæ]©¸c¿Er¿³´ºyhÃ\'\rù/íÑXtÙ ¨|	ÐMë<ÅJgFÎîáOºÒw­V«\rç}$_-¡sÄgè¹Æ³xb5²ÏÃnìª!&vÙqñàÇ»-AåH£p/+î¦­$Cöz&å°úDAO,lðÍHÛ/¤IÿÐB*y"DûiÎ\'ÈºV8jp1.ï{Ýä3Ú%8~ ïäß[±=·{]ì´¾NWå2÷	ÚîVRåòÔÑ9S\\±cE8P£1ÃÄÓ/ÆrtÏÍÖòw©[tE¨4n~L¤¢½úÇ_û0þ ñZ&;Ìû}e©¯u¸ÊH5QØén½ÅaªÙj_Î¶¯ÓMèZì³¥ÙÄáoeº1`Vû¼&\r:·ðk#Ð®Á<dÒ`g            ù¢ DNn ü) ÑW\' Ý4õ bÛÀ < AC cQþ »Þ« ·aÅ :n$ ÒMB Ià 	ê. Ñ ëþ )± è>§ õ5 D». é ´&p A~_ Ö9 S9 ô9 _ (ù½ ø; Þÿ  /ï \nZ mm Ï~6 	Ë\' FO· f? -ê_ º\'u åëÇ ={ñ ÷9 R ûkê ±_ ] 0V {üF ð«k  ¼Ï 6ô ã© ^a æ e  _ @h Øÿ \'sM 1 ÊV É¨s {â` kÀ ÄG ÍgÃ 	èÜ Y* vÄ ¦ D¯Ý WÑ ¥> ÿ 3~? Â2è OÞ »}2 &=Ã kï ø^ 5: òÊ ñ |! j$| Õnú 0-w ;C µÆ Ã ­ÄÂ ,MA  ] }F ãq- Æ 3b  ´Ò| ´§ 7UÕ ×>ö £ Mvü d* p×« c|ø z°W ç ÀIV ;ÖÙ §8 $#Ë Öw ZT#  ¹ ñ\n Îß 1ÿ fj Wa ¬ûG ~Ø "e· 2è æ¿` ïÄÍ l6	 ]?Ô Þ× X;Þ Þ Ò"( (è âXM ÆÊ2 ã à}Ë ÀP ó§ à[ .4 b H õ[ ­° éò HJC gÓ ªÝØ ®_B jaÎ \n(¤ Ó´ ¦ò \\w £Â a< sx ¯Z o×½ -¦c ô¿Ë ï &Ág UÊE ÊÙ6 (¨Ò Âa Éw & F ÄYÄ ÈÅD M²  ó ÔC­ )Iå ýÕ  ¾ü Ì pÎî >õ ìñ ³çÃ Çø(  Áq> .	³ Eó  « { .µ GÂ {2/ Um r§ kç 1Ë yJ Ayâ ôß è âæ 1 ík __6 »ý H´ g¤l qrB ]2 ¸ ¼å	 1% ÷t9 0 \r Kh ,îX Gª tç ½Ö$ ÷}¦ nHr ï ¦ ´ö ÑSQ Ï\nò  3 õK~ ²ch Ý>_ @]  UR) 7dÀ mØ 2H2 [Lu NqÔ ETn 	Á *õi fÕ \' ]P ´;Û êvÅ ù Ik} \'º i) ÆÌ¬ ­T âj Ù ,rP ¤¾ w ó0p  ü\' êq¨ fÂI dà= Ý £? Cý \r 1AÞ 9 Ýp ·ç ß; 7+ \\  Z  èØ l¯ ÛÿK 8 Yv b¥ aË» Ç¹ @½ Òò Iu\' ë¶ö Û"» \nª &/ dv 	;3  Q:ª £Â ¯í® \\& mÂM -z ÀV ? 	ðö +@ m1 9´   ØÃ[ õÄ Æ­K NÊ¥ §7Í æ©6 « ÝBh cÞ vï hR üÛ7 ®¡« ß1  ®¡ ûÚ dMf í· )e0 WV¿ Gÿ: jù¹ u¾ó (ß «0 fö Ë ú" Ùä =³¤ W 6Í	 NBé ¾¤ 3#µ ðª Oe¨ ÒÁ¥ ? [xÍ #ùv { r Æ¦S onâ ïë  JX ÄÚ· ªfº vÏÏ Ñ ±ñ- Á Ã­w HÚ ÷]  Æô ¬ð/ Ýì ?\\¼ ÐÞm Ç *Û¶ £%:  ¯ ­S ¶W )-´ K~ Ú§ vª {Y¡ * Ü·- úåý Ûþ ¾ý ävl ©ü >p n ýÿ (> ag3 * M½ê ³ç¯ mn g9 1¿[ ×H 0ß Ç-C %a5 ÉpÎ 0Ë¸ ¿lý ¤ ¢ lä ZÝ  !oG bÒ ¹\\ paI kVà R PU7 Õ· 3ñÄ n_ ]0ä .© ²Ã ¡26 ·¤ ê±Ô ÷! iä \'ÿw  @- OÍ   ¥ ³¢Ó /]\n ´ùB ÚË }¾Ð ÛÁ «½ Ê¢ j\\ .U \' U ð á d A ¾Þ Úý* k%¶ {4 óþ ¹¿ hjO J*¨ OÄZ -ø¼ ×Z ôÇ \rM  :¦ ¤W_ ?± 8 Ì  qÝ ÉÞ¶ ¿`õ Me k °¬ ²ÀÐ QUH û rÃ £; À@5 Ü{ àEÌ N)ú ÖÊÈ èóA |dÞ dØ Ù¾1 ¤Ã wXÔ iãÅ ðÚ º:< FF Uu_ Ò½õ nÆ ¬.] Dí >B aÄ )ýé çÖó "|Ê o5 àÅ ÿ× njâ °ýÆ Á |]t k­² Ín >r{ Æj ÷Ï© )sß µÉº · Q â²\r tº$ å}` tØ \r,  ~f ) zv ýý¾ VEï Ù~6 ìÙ º¹ Äü 1¨\' ñnÃ Å6 Ø¨V ´¨µ ÏÌ - oW4 ,V Îã Ö ¹ k^ª >* _Ì ýJ áôû ;m â, éÔ ü´© ïîÑ .5É /9a 8!D ÙÈ ü\n ûJj /Ø S´ N T"Ì *UÜ ÀÆÖ  p¸ id &Z` ?Rî  ôµ üËõ 4¼- 4¼î è]Ì Ý^` g 3ï É¸ aX áW¼ QÆ Ø> ÝqH -Ý ¯¡ !,F Yó× Ùz TÀ Oú Vü åy® "6 8­" gÜ Uèª &8 Êç Q\r¤ 3± ©× iH e²ð § L ùÑ6 !³ {J Ï! @Ü ÜGU át: gëB þß ^Ô_ {g¤ º¬z Uö¢ +# AºU Yn !* 9G ãæ åÔ Iû@ ÿVé Ê ÅY ú+ ÓÁÅ ÅÏ ÛZ® GÅ Cb !; ,y a *L{ , C¿ & x< ¨Ää åÛ{ Ä:Â &ôê ÷g \r¿ e£+ =± ½| ¤QÜ \'Ýc iáÝ  ¨) hÎ( 	í´ D  NÊ pc ~|# ¹2 §õ Vç !ñ µ* o~M ¥Q µù« ßÖ Ýa 6 Ä: ¢¡ rím 9z ¸© k2\\ F\'[  4í Ò w üôU YM àq            @û!ù?    -Dt>   Fø<   `QÌx;   ð9   @ %z8   "ã6    ói5þ+eGg@      8C  úþB.v¿:;¼÷½½ýÿÿÿÿß?<TUUUUÅ?+ÏUU¥?Ð¤g?      ÈBï9úþB.æ?$Äÿ½¿Î?µô×k¬?ÌPFÒ«²?:Nà×U?              ð?n¿O;<53û©=öï?]ÜØ`q¼aw>ìï?Ñfz^¼nèãï?ög5RÒ<tÓ°Ùï?úù#Î¼ÞöÝ)kÐï?aÈæaN÷`<ÈuEÇï?Ó3[ä£<óÆÊ>¾ï?m{]¦<ùlXµï?üïýµ<÷Gr+¬ï?Ñ/p=¾><¢ÑÓ2ì£ï?n4j¼Óþ¯fï?½/*RV¼Q[Ðï?UêNïP¼Ì1lÀ½ï?ôÕ¹#É¼à-©®ï?¯U\\éãÓ<Q¥Èzï?H¥ê¼{Q}<¸rï?=2ÞUð¼ê8ùjï?¿S?<uËoë[cï?&ëvÙ¼Ô\\à[ï?`/:>÷ì<ª¹h1Tï?8Ëç¼Ùü"PMï?Ã¦DAo<Öb;Fï?}ä°z<Ü}I?ï?¨¨ãý<8bunz8ï?}Htò^<?¦²OÎ1ï?òç+G<Ý|âeE+ï?^q?{¸¼cõáß$ï?1«	má÷<áÞõï?ú¿o!=¼ÙÚÐï?´\nr7<ä¦ï?ËÎn<V/>©¯ï?¶«°MuM<·1\nþï?Lt¬âB<1ØLüpï?JøÓ]9Ý<ÿd²üî?[;£¼ñ_Åöî?hPKÌíJ¼Ë©:7§ñî?-Qø¼fØm®ìî?Ò6>èÑq¼÷å4Ûçî?Î³¼å¨Ã-ãî?mL*§H<"4L¦Þî?i(z`¼¬EÚî?[H§X¼*.÷!\nÖî?Ig,|¼¨PÙõÑî?¬Â`ícC<-a`Îî?ïd;	f<W íAÊî?y¡ÚáÌn<Ð<Áµ¢Æî?0?ÿ<ÞÓ×ð*Ãî?°¯z»Îv<\'*6ÕÚ¿î?wàTë½<\rÝý²¼î?£q 4¼§,v²¹î?I£ÜÌÞ¼BfÏ¢Ú¶î?_8½ÆÞx¼OV+´î?ö\\{ìF¼]Ê¤±î?×ý5<Ú\'µ6G¯î?/·{<ýÇÔ­î?	Tâác<)THÝ«î?êÆPÇ4<·FY&©î?5Àd+æ2<H!­o§î?vaJä¼	Üv¹á¥î?¨Mï;Å3¼U:°~¤î?®é+xS¼ ÃÌ4F£î?XXVxÝÎ¼%"U8¢î?d~ªW<s©LÔU¡î?("^¿ï³¼Í;f î?¹4­j¼¿Úu î?î©m¸ïgc¼/e<²î?QàT=Ü¼Qù}î?Ï>Z~dx¼t_ìèuî?°}ÀJî¼t¥Hî?æU2¼ÉgBVëî?ÓÔ	^Ë<?]ÞOi î?¥M¹Ü2{¼ës¡î?kÀgTýì<2Á0í¡î?UlÖ«áëe<bNÏ6ó¢î?BÏ³/Å¡¼>T\'¤î?47;ñ¶i¼ÎL¥î?ÿ:^¼­Ç#F§î?nWrØPÔ¼íDÙ¨î? [g­<fÙÇªî?´êðÁ/·<Û *Bå¬î?ÿçÅ`¶e¼Dµ2¯î?D_óYö{<6w®±î?=§	¼Æÿ[´î?)l¸©]¼åÅÍ°7·î?Y¹|ù#l¼RÈËDºî?ªùô"CC¼PNÞ½î?Kf×lÊ¼ºÊpñÀî?\'Î+ü¯q<ð£Äî?»s\ná5Òm<##ãcÈî?c"b"Å¼eå]{fÌî?Õ1âã<3-JìÐî?»¼ÓÑ»¼]%>²Õî?Ò1î1Ì<X³0Ùî?³Zsni<¿ýyUkÞî?´Íß¼zóÓ¿kãî?3Ëw<­ÓZèî?úÙÑJ{¼f¶)îî?º®ÜVÙÃU¼ûO¸¢óî?@ö¦=¤¼:Yårùî?4­8ôÖh¼G^ûòvÿî?5Xkâî¼J¡0°ï?ÍÝ_\n×ÿt<ÒÁKï?¬úû½¼	×[Âï?³¯0®ns<RÝï?ý\\2ã<zÐÿ_« ï?¬Y	Ñà<KÑW.ñ\'ï?gN8¯Íc<µçm/ï?hl,kg<iïÜ 7ï?ÒµÌ¼úÃ]U?ï?oúÿ?]­¼|J-Gï?I©u8®\r¼ò\rOï?§=¦£t<¤ûÜXï?"@ ¼Éã`ï?¬ÁÕPZ<2Ûæiï?Kk¬Y:<`´ó!sï?>´!Õ¼_{3|ï?É\rG;¹*¼)¡õFï?Ó:`¶t<ö?ç.ï?qrQìÅ<LÇûQï?ðÓ÷¼Ú¤¢¯¤ï?}t#â®¼ñg-H¯ï? ªA¼Ã<\'Zaîºï?2ë©Ã+<ºk7+Åï?îÑ1©d<@En[vÐï?íã;äº7¼¾­ýÛï?ÍM;w<ØÁçï?Ì`AÁS<ñq+Âóï? 8úþB.æ?0gÇWó.=     à¿[0QUUUÕ?EëÿÿÿÏ¿ñ$³É?ÈåuUÅ¿      à¿wUUUUUÕ?ËýÿÿÿÿÏ¿ÝÉ?§EgUUUÅ¿0ÞD£$IÂ?e=B¤ÿÿ¿¿ÊÖ*(q¼?ÿh°Cë¹¿Ð¯÷·?ÍEÑuRµ¿ÞàÃð4÷? æyÌ×¿é,jx÷?  \rÂîo×¿ µú`òö? àQã×¿}¦Ñö? x(8[¸Ö¿Ñ´ÅI±ö? xU]Ö¿º/3Gö?  vÐÖ¿#B"qö? Ê¨Õ¿Ù¥ORö? PVCOÕ¿Ä$ªV3ö? @kÃ7öÔ¿Ük³ö? P¨ý§Ô¿L\\ÆRdöõ? ¨9EÔ¿O,µgØõ? ¸°9ôíÓ¿Þ[Ë¼ºõ? pDÎÓ¿xÙòaõ?  ½@Ó¿VFVõ? FïâéÒ¿ÓkçÎcõ? à08Ò¿§â%Gõ? ÚÅ>Ò¿EBÿ*õ? \')áéÑ¿ß½²Û"õ? øH+mÑ¿×Þ4Góô? ø¹gAÑ¿@(ÞÏCØô? ïÐíÐ¿È£xÀ>½ô? Û¥Ð¿%àÃ¢ô? ¸cRæGÐ¿4Ô$ô? ðE"ëÏ¿-Îmô? °uJGÏ¿T9ÓÙSô? 0=D¤Î¿Z´D\':ô? °éD\rÎ¿ûøAµ ô? ðw)¢`Í¿±ô>Úô? ÀÌ¿þW]îó? V) Ì¿éL ÙÕó? Ë¿+ÁÀ`½ó? ÐÓÌÉâÊ¿¸Úu+$¥ó? .@EÊ¿ÐÍ"ó? ðhw¨É¿zÅ[uó? 0HimÉ¿â6­IÎ]ó? ÀE¦ qÈ¿@ÔMyFó? 0´ÖÇ¿$ËÿÎ\\/ó? pb<¸<Ç¿I\r¡uwó? `7£Æ¿9>7Èó?  ·T1Æ¿Aø»Nëò? 0$v}sÅ¿Ñ©\nÕò? 0Â{ÜÄ¿*ý·¨ù¾ò?  ÒQ,FÄ¿«z©ò?  ¼°Ã¿0µ`rò?  IkÃ¿õ¡WWú}ò? @¤TÂ¿¿;³hò?  yø¹óÁ¿½õSò?  ,%È`Á¿;Éª·>ò?  ÷WÎÀ¿¶@©+*ò?  þIÜ<À¿2AÌyò? K¼½W¿¿üÒ ò? @@7¾¿HMIôìñ? @ù>½¿ieRõØñ?  ØNgù»¿|~W#Åñ? `/ yÜº¿é&Ët|±ñ? (çÃÀ¹¿¶,ñ? Àr³F¦¸¿½p¶{°ñ?  ¬³·¿¶¼ï%wñ?  8Eñt¶¿Ú1L5dñ? m^µ¿Ý_\'¹Qñ? à¡Þ\\H´¿LÒ2¤?ñ?  jMÙ3³¿Úùr,ñ? `Åøy ²¿1µì(0ñ?  bF±¿¯4Úûñ?  Òjlú¯¿³kNîõð? @wJÚ­¿Î*]äð?  äì¼«¿!¥,cDÒð? À@¡©¿â|§Àð? À3X§¿Ñ6Æ/¯ð? Ög^q¥¿9 Ûð? eI\\£¿ßçR¯«ð? @dãI¡¿û(N/{ð? ëÀr¿5µjð? RRñU¿,ùì¥îYð? Ïb=¿,ÑÍIIð?  ªû(¿©­ðÆÆ8ð?  ù {1¿©2ye(ð?  ª]5¿Hsê\'$ð?  ìÂx¿±ð?  $y	`¿ú&÷àï?  óïo?têaÂ¡ï?  =5AÜ?.°cï? ÂÄ£Î?Í­î<ö%ï?  Á?çÈéî?  ÎØ°¡?«±Ëx®î? ÀÐ[¥?¢tî? Ø@\\©?µ\n:î? Wïj\'­?V`	àî? Àåu°?»wåÊí?  \rãõS²?|òí?  8Ý.´?Î\\ûf¬\\í? ÀWY¶?Þ^ª,\'í?  j5vÚ·?Í,k>nòì? `NC«¹?y§¢m¾ì? `\r»Çx»?m7m&ì?  ç2C½?X]½Xì? `Þq1\n¿?»3µ&ì? @+gÀ??çìîõë? °GÁ?ÁÛuýÄë? 0ÊÍn&Â?(Jë? PÅ¦×Ã?,>ïÅâeë? 3<ÃßÃ?ÉgH7ë? zk6ºÄ?J0!K	ë? ðÑ(9Å?~ïòèÛê? ð$ÍjÆ?¢=`1¯ê? fìø@Ç?§XÓ?æê? ðõÀÈ?s	ï@Wê? öT)éÈ?\'K«*,ê? @ø6»É?Ñò ê?  ,íÊ?<Û$×é? Ð\\Q[Ë?±Ç%®é? À¼Ìg)Ì?/Îò.é? `HÕ5öÌ?uK¤îº\\é? ÀF4½ÁÍ?8HçÆ4é? àÏ¸Î?æRg/O\ré? À	UÏ?×ÿRæè? ¸lÐ?| ÌÎ¿è? Ð¸qÐ?Ã¾ÚÀè? pkÔÐ?û#ª\'tè? ÐK36Ñ?³¬ Oè? H#g\rÑ?U>eèI*è? ÌàÿøÑ?`ôè? hc×_YÒ?)£àc%âç? ¨	0¹Ò?­µÜw³¾ç? `CrÓ?Â%gªç? ìm&wÓ?Wòyç? 0¯ûOÕÓ?ÖÛÊVç? à/ãî2Ô?k¶O æ?<[Bl~<´M 0æ?A] Hê¿<xÔ\r Pæ?·¥Ö§<­oN pæ?L%Tkêüa<®ßþÿæ?ýYL\'~|¼¼Åc °æ?ÚÜHhÁ¼öÁ\\ Ðæ?I?<>öëÿïæ?S-â~¼ ç?Ry	qfÿ{<égüÿ/ç?$½&â <jßÿOç?Òñnn¼g pç?tTÍqüg¼5È~úÿç?õÁ¾<æÂ þÿ¯ç?edÌ)~p¼ É?íÿÏç?{r¼v&éÿïç?®ùm(À<è£ è?3LåQÒ<, 0è?ó0¶éþ¼s3 Pè?¼5ek¿¿<ÆB  pè?u{óe¿¼yõëÿè?WË=¢n ¼ß¼" °è?\nKà8ß }¼åÿÏè?ÿFq ¼Cüÿïè?8pzÐ{<Ç_ú é?´ßv><¹{F 0é?vKN<oîæÿOé?.bÿÙð~¼Ñ<Þÿoé?º8&ªp¼\rEôÿé?ï¨d¼>.Ýÿ¯é?7Zà@¼fûIíÿÏé? àÁÎ?<Qñ  ðé?\n[\'ª?¼°E ê?VÚXHÿt<úö» 0ê?m+«¾<y Pê?0yxÝÊþ<H.õ pê?Û«Ø=vA¼R3Y ê?vÂ¿¼K>O* °ê?_?ÿ<ýi¼Ñ®×ÿÏê?´pç>¼xQîÿïê?£Þà>j<[\reÛÿë?¹\n8ÈZ<WÊªþÿ/ë?<#ty¼ÜºÙÿOë?*hÿy¼e$ pë?>OÐEÿ<@ùÿë?ùÃÂwþ|<OËÒÿ¯ë?Ä+òî\'ÿc¼E\\AÒÿÏë?!ê;î·ÿl¼ß	cøÿïë?\\.A¼Svµáÿì?j·dÁ<ãWúñÿ/ì?íÆ0ïþd¼$ä¿ÜÿOì?uGì¼h?¼÷¹Tíÿoì?ìàSð£~<Õëÿì?ñùs<!%! °ì?dýh¼FÝÿÏì?rêÇ¾~<vÄýêÿïì?þ­9¾<+ø í?qZ¹¨}u<÷\r 0í?ÚÇpiÁ<ÄyêÿOí?þXÅ7X¼åÜ. pí?DÁMÖ¼ªÜ! í?\\\\ý|t¼kØÿ¯í?~a!Å<9Gl) Ðí?S±ÿ²<õDåÿïí?ÌRÆÒ n<ö«Íÿî?Òi- @¼ÝÈRÛÿ/î?dÊÁ {<ïBòÿOî?Q«°¨ÿr<^èÿoî?Y¾ï±söW¼\rÿ î?È^¼D¥ßÿ¯î?µ CÕ x<¡ Ðî?\\V`øP¼Ä¼º ðî?æ5]D@¼zõÿï?ï91ûO¼Çå 0ï?Usò¬<4õÿOï?CÇ×ÔA?<kL©üÿoï?uxôb¼AÄùáÿï?KçwôÑ}w<~ãàÒÿ¯ï?1£|o¼äw Ðï?±¬ÎKîq<1Ãà÷ÿïï?Zp7n¼n`eôÿð?Ú\nI­~¼Xzóÿ/ð?à²üÃi¼\rüýÿOð?[Ë4þ¿<MÍ pð?ËVäÀ <èËòùÿð?u7¾ßÿm¼eÚ °ð?ë&æ®?¼8Ó¤ Ðð?÷Hyú}<ýýÚúÿïð?ÀkÖpw¼ýº ñ?bmÔ<]ôåúÿ/ñ?ï6ýdú¿<ÙÕ\r Pñ?®Ppw <U! pñ?îÞãâùý<&T\'üÿñ?sr;Ü0 <Y<= °ñ?y<·)øÿÏñ?g«2ùe¼ Ôôÿïñ?ë[§¿<¤ ò?"[ýk<C 0ò?3¿ëÂÿ<ö¼ÿÿOò?r..~çv<Ù!)õÿoò?av»ü<<: ò?+A<Êr¼cU °ò?ò3¼;RþëÿÏò?òÜO8~ÿ¼­¸ ðò?ÅA0PQÿ¼¯âzûÿó?(^q ¼_¬þÿ/ó?··?]ÿ¼Vg¦ Pó?½"<!÷û pó?ÌÕ\rÄº <¹/Yùÿó?Q§²-?¼BÒÝ °ó?á8vpk<WÉ²õÿÏó?1¿:z<´°êÿïó?°R±fm<ô¯2 ô?$_7øg<)G 0ô?CQÜræ<c´çÿOô?Z²¸iÿ<àuèÿoô?TòÂ±À¼çÁoïÿô?r*:ò	@<§¾åÿ¯ô?E}\r¿·ÿ¼Þ\' Ðô?=jÜqdÀ¼â>ð ðô?S<ÑKÜ õ?6¤fqe`<z\' 0õ?	2#ÎÎ¿¼LpÛìÿOõ?×¡r¼©T_ïÿoõ?dÉæ¿<æ õ?ï¯Å~<>É °õ?À¿\nA¼¼I Ðõ?)G%û*¼z¸çÿïõ?ií·~¼¸ P à     Ñt W½*pRÿÿ>\'\n   d   è  \'    @B   áõ   5   q   kÿÿÿÎûÿÿ¿ÿÿ                    	             \n\n\n  	  	                               \r \r   	   	                                               	                                                  	                                                   	                                              	                                                      	                                                   	         0123456789ABCDEF   N ë§~ uú ¹,ý·z¼ Ì¢ =I×  *_·úXÙýÊ½áÍÜ@x }gaì å\nÔ Ì>Ov¯  D ® ®` úw!ë+ `A ©£nN                                                        *                    \'9H                                  8R`S  Ê        »Ûë+;PSuccess Illegal byte sequence Domain error Result not representable Not a tty Permission denied Operation not permitted No such file or directory No such process File exists Value too large for defined data type No space left on device Out of memory Resource busy Interrupted system call Resource temporarily unavailable Invalid seek Cross-device link Read-only file system Directory not empty Connection reset by peer Operation timed out Connection refused Host is down Host is unreachable Address in use Broken pipe I/O error No such device or address Block device required No such device Not a directory Is a directory Text file busy Exec format error Invalid argument Argument list too long Symbolic link loop Filename too long Too many open files in system No file descriptors available Bad file descriptor No child process Bad address File too large Too many links No locks available Resource deadlock would occur State not recoverable Owner died Operation canceled Function not implemented No message of desired type Identifier removed Device not a stream No data available Device timeout Out of streams resources Link has been severed Protocol error Bad message File descriptor in bad state Not a socket Destination address required Message too large Protocol wrong type for socket Protocol not available Protocol not supported Socket type not supported Not supported Protocol family not supported Address family not supported by protocol Address not available Network is down Network unreachable Connection reset by network Connection aborted No buffer space available Socket is connected Socket not connected Cannot send after socket shutdown Operation already in progress Operation in progress Stale file handle Remote I/O error Quota exceeded No medium found Wrong medium type Multihop attempted Required key not available Key has expired Key has been revoked Key was rejected by service  A°¥ÌÐ                                              Ô                            ÿÿÿÿÿÿÿÿ                                                            ¸     	                                        è                            ÿÿÿÿ                                                                                                        ø                           ÿÿÿÿ\n                                                               à ¬ ð  target_features+bulk-memory+bulk-memory-opt+call-indirect-overlong+\nmultivalue+mutable-globals+nontrapping-fptoint+reference-types+sign-ext');
}

function getBinarySync(file) {
  return file;
}

async function getWasmBinary(binaryFile) {

  // Otherwise, getBinarySync should be able to get it synchronously
  return getBinarySync(binaryFile);
}

async function instantiateArrayBuffer(binaryFile, imports) {
  try {
    var binary = await getWasmBinary(binaryFile);
    var instance = await WebAssembly.instantiate(binary, imports);
    return instance;
  } catch (reason) {
    err(`failed to asynchronously prepare wasm: ${reason}`);

    // Warn on some common problems.
    if (isFileURI(binaryFile)) {
      err(`warning: Loading from a file URI (${binaryFile}) is not supported in most browsers. See https://emscripten.org/docs/getting_started/FAQ.html#how-do-i-run-a-local-webserver-for-testing-why-does-my-program-stall-in-downloading-or-preparing`);
    }
    abort(reason);
  }
}

async function instantiateAsync(binary, binaryFile, imports) {
  return instantiateArrayBuffer(binaryFile, imports);
}

function getWasmImports() {
  // prepare imports
  var imports = {
    'env': wasmImports,
    'wasi_snapshot_preview1': wasmImports,
  };
  return imports;
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
async function createWasm() {
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    wasmExports = instance.exports;

    assignWasmExports(wasmExports);

    updateMemoryViews();

    return wasmExports;
  }

  // Prefer streaming instantiation if available.
  // Async compilation can be confusing when an error on the page overwrites Module
  // (for example, if the order of elements is wrong, and the one defining Module is
  // later), so we save Module and check it later.
  var trueModule = Module;
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    assert(Module === trueModule, 'the Module object should not be replaced during async compilation - perhaps the order of HTML elements is wrong?');
    trueModule = null;
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    return receiveInstance(result['instance']);
  }

  var info = getWasmImports();

  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  if (Module['instantiateWasm']) {
    return new Promise((resolve, reject) => {
      try {
        Module['instantiateWasm'](info, (inst, mod) => {
          resolve(receiveInstance(inst, mod));
        });
      } catch(e) {
        err(`Module.instantiateWasm callback failed with error: ${e}`);
        reject(e);
      }
    });
  }

  wasmBinaryFile ??= findWasmBinary();
  var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
  var exports = receiveInstantiationResult(result);
  return exports;
}

// end include: preamble.js

// Begin JS library code


  class ExitStatus {
      name = 'ExitStatus';
      constructor(status) {
        this.message = `Program terminated with exit(${status})`;
        this.status = status;
      }
    }

  /** @type {!Int16Array} */
  var HEAP16;

  /** @type {!Int32Array} */
  var HEAP32;

  /** not-@type {!BigInt64Array} */
  var HEAP64;

  /** @type {!Int8Array} */
  var HEAP8;

  /** @type {!Float32Array} */
  var HEAPF32;

  /** @type {!Float64Array} */
  var HEAPF64;

  /** @type {!Uint16Array} */
  var HEAPU16;

  /** @type {!Uint32Array} */
  var HEAPU32;

  /** not-@type {!BigUint64Array} */
  var HEAPU64;

  /** @type {!Uint8Array} */
  var HEAPU8;

  var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        // Pass the module as the first argument.
        callbacks.shift()(Module);
      }
    };
  var onPostRuns = [];
  var addOnPostRun = (cb) => onPostRuns.push(cb);

  var onPreRuns = [];
  var addOnPreRun = (cb) => onPreRuns.push(cb);


  
    /**
   * @param {number} ptr
   * @param {string} type
   */
  function getValue(ptr, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': return HEAP8[ptr];
      case 'i8': return HEAP8[ptr];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP64[((ptr)>>3)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      case '*': return HEAPU32[((ptr)>>2)];
      default: abort(`invalid type for getValue: ${type}`);
    }
  }

  var noExitRuntime = true;

  function ptrToString(ptr) {
      assert(typeof ptr === 'number', `ptrToString expects a number, got ${typeof ptr}`);
      // Convert to 32-bit unsigned value
      ptr >>>= 0;
      return '0x' + ptr.toString(16).padStart(8, '0');
    }

  
    /**
   * @param {number} ptr
   * @param {number} value
   * @param {string} type
   */
  function setValue(ptr, value, type = 'i8') {
    if (type.endsWith('*')) type = '*';
    switch (type) {
      case 'i1': HEAP8[ptr] = value; break;
      case 'i8': HEAP8[ptr] = value; break;
      case 'i16': HEAP16[((ptr)>>1)] = value; break;
      case 'i32': HEAP32[((ptr)>>2)] = value; break;
      case 'i64': HEAP64[((ptr)>>3)] = BigInt(value); break;
      case 'float': HEAPF32[((ptr)>>2)] = value; break;
      case 'double': HEAPF64[((ptr)>>3)] = value; break;
      case '*': HEAPU32[((ptr)>>2)] = value; break;
      default: abort(`invalid type for setValue: ${type}`);
    }
  }

  var stackRestore = (val) => __emscripten_stack_restore(val);

  var stackSave = () => _emscripten_stack_get_current();

  var warnOnce = (text) => {
      warnOnce.shown ||= {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        if (ENVIRONMENT_IS_NODE) text = 'warning: ' + text;
        err(text);
      }
    };

  

  var UTF8Decoder = globalThis.TextDecoder && new TextDecoder();
  
  var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
      var maxIdx = idx + maxBytesToRead;
      if (ignoreNul) return maxIdx;
      // TextDecoder needs to know the byte length in advance, it doesn't stop on
      // null terminator by itself.
      // As a tiny code save trick, compare idx against maxIdx using a negation,
      // so that maxBytesToRead=undefined/NaN means Infinity.
      while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
      return idx;
    };
  
  
    /**
   * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
   * array that contains uint8 values, returns a copy of that string as a
   * Javascript String object.
   * heapOrArray is either a regular array, or a JavaScript typed array view.
   * @param {number=} idx
   * @param {number=} maxBytesToRead
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
  
      var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
  
      // When using conditional TextDecoder, skip it for short strings as the overhead of the native call is not worth it.
      if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
        return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
      }
      var str = '';
      while (idx < endPtr) {
        // For UTF8 byte structure, see:
        // http://en.wikipedia.org/wiki/UTF-8#Description
        // https://www.ietf.org/rfc/rfc2279.txt
        // https://tools.ietf.org/html/rfc3629
        var u0 = heapOrArray[idx++];
        if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
        var u1 = heapOrArray[idx++] & 63;
        if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
        var u2 = heapOrArray[idx++] & 63;
        if ((u0 & 0xF0) == 0xE0) {
          u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {
          if ((u0 & 0xF8) != 0xF0) warnOnce(`Invalid UTF-8 leading byte ${ptrToString(u0)} encountered when deserializing a UTF-8 string in wasm memory to a JS string!`);
          u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (heapOrArray[idx++] & 63);
        }
  
        if (u0 < 0x10000) {
          str += String.fromCharCode(u0);
        } else {
          var ch = u0 - 0x10000;
          str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        }
      }
      return str;
    };
  
    /**
   * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
   * emscripten HEAP, returns a copy of that string as a Javascript String object.
   *
   * @param {number} ptr
   * @param {number=} maxBytesToRead - An optional length that specifies the
   *   maximum number of bytes to read. You can omit this parameter to scan the
   *   string until the first 0 byte. If maxBytesToRead is passed, and the string
   *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
   *   string will cut short at that byte index.
   * @param {boolean=} ignoreNul - If true, the function will not stop on a NUL character.
   * @return {string}
   */
  var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => {
      assert(typeof ptr == 'number', `UTF8ToString expects a number (got ${typeof ptr})`);
      return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead, ignoreNul) : '';
    };
  var ___assert_fail = (condition, filename, line, func) =>
      abort(`Assertion failed: ${UTF8ToString(condition)}, at: ` + [filename ? UTF8ToString(filename) : 'unknown filename', line, func ? UTF8ToString(func) : 'unknown function']);

  var __abort_js = () =>
      abort('native code called abort()');

  var abortOnCannotGrowMemory = (requestedSize) => {
      abort(`Cannot enlarge memory arrays to size ${requestedSize} bytes (OOM). Either (1) compile with -sINITIAL_MEMORY=X with X higher than the current value ${HEAP8.length}, (2) compile with -sALLOW_MEMORY_GROWTH which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with -sABORTING_MALLOC=0`);
    };
  var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
      requestedSize >>>= 0;
      abortOnCannotGrowMemory(requestedSize);
    };

  var PATH = {
  isAbs:(path) => path.charAt(0) === '/',
  splitPath:(filename) => {
        var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
        return splitPathRe.exec(filename).slice(1);
      },
  normalizeArray:(parts, allowAboveRoot) => {
        // if the path tries to go above the root, `up` ends up > 0
        var up = 0;
        for (var i = parts.length - 1; i >= 0; i--) {
          var last = parts[i];
          if (last === '.') {
            parts.splice(i, 1);
          } else if (last === '..') {
            parts.splice(i, 1);
            up++;
          } else if (up) {
            parts.splice(i, 1);
            up--;
          }
        }
        // if the path is allowed to go above the root, restore leading ..s
        if (allowAboveRoot) {
          for (; up; up--) {
            parts.unshift('..');
          }
        }
        return parts;
      },
  normalize:(path) => {
        var isAbsolute = PATH.isAbs(path),
            trailingSlash = path.slice(-1) === '/';
        // Normalize the path
        path = PATH.normalizeArray(path.split('/').filter((p) => !!p), !isAbsolute).join('/');
        if (!path && !isAbsolute) {
          path = '.';
        }
        if (path && trailingSlash) {
          path += '/';
        }
        return (isAbsolute ? '/' : '') + path;
      },
  dirname:(path) => {
        var result = PATH.splitPath(path),
            root = result[0],
            dir = result[1];
        if (!root && !dir) {
          // No dirname whatsoever
          return '.';
        }
        if (dir) {
          // It has a dirname, strip trailing slash
          dir = dir.slice(0, -1);
        }
        return root + dir;
      },
  basename:(path) => path && path.match(/([^\/]+|\/)\/*$/)[1],
join:(...paths) => PATH.normalize(paths.join('/')),
join2:(l, r) => PATH.normalize(l + '/' + r),
};

var initRandomFill = () => {
    // This block is not needed on v19+ since crypto.getRandomValues is builtin
    if (ENVIRONMENT_IS_NODE) {
      var nodeCrypto = require('node:crypto');
      return (view) => nodeCrypto.randomFillSync(view);
    }

    return (view) => (crypto.getRandomValues(view), 0);
  };
var randomFill = (view) => (randomFill = initRandomFill())(view);



var PATH_FS = {
resolve:(...args) => {
      var resolvedPath = '',
        resolvedAbsolute = false;
      for (var i = args.length - 1; i >= -1 && !resolvedAbsolute; i--) {
        var path = (i >= 0) ? args[i] : FS.cwd();
        // Skip empty and invalid entries
        if (typeof path != 'string') {
          throw new TypeError('Arguments to path.resolve must be strings');
        } else if (!path) {
          return ''; // an invalid portion invalidates the whole thing
        }
        resolvedPath = path + '/' + resolvedPath;
        resolvedAbsolute = PATH.isAbs(path);
      }
      // At this point the path should be resolved to a full absolute path, but
      // handle relative paths to be safe (might happen when process.cwd() fails)
      resolvedPath = PATH.normalizeArray(resolvedPath.split('/').filter((p) => !!p), !resolvedAbsolute).join('/');
      return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
    },
relative:(from, to) => {
      from = PATH_FS.resolve(from).slice(1);
      to = PATH_FS.resolve(to).slice(1);
      function trim(arr) {
        var start = 0;
        for (; start < arr.length; start++) {
          if (arr[start] !== '') break;
        }
        var end = arr.length - 1;
        for (; end >= 0; end--) {
          if (arr[end] !== '') break;
        }
        if (start > end) return [];
        return arr.slice(start, end - start + 1);
      }
      var fromParts = trim(from.split('/'));
      var toParts = trim(to.split('/'));
      var length = Math.min(fromParts.length, toParts.length);
      var samePartsLength = length;
      for (var i = 0; i < length; i++) {
        if (fromParts[i] !== toParts[i]) {
          samePartsLength = i;
          break;
        }
      }
      var outputParts = [];
      for (var i = samePartsLength; i < fromParts.length; i++) {
        outputParts.push('..');
      }
      outputParts = outputParts.concat(toParts.slice(samePartsLength));
      return outputParts.join('/');
    },
};



var FS_stdin_getChar_buffer = [];

var lengthBytesUTF8 = (str) => {
    var len = 0;
    for (var i = 0; i < str.length; ++i) {
      // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
      // unit, not a Unicode code point of the character! So decode
      // UTF16->UTF32->UTF8.
      // See http://unicode.org/faq/utf_bom.html#utf16-3
      var c = str.charCodeAt(i); // possibly a lead surrogate
      if (c <= 0x7F) {
        len++;
      } else if (c <= 0x7FF) {
        len += 2;
      } else if (c >= 0xD800 && c <= 0xDFFF) {
        len += 4; ++i;
      } else {
        len += 3;
      }
    }
    return len;
  };

var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
    assert(typeof str === 'string', `stringToUTF8Array expects a string (got ${typeof str})`);
    // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
    // undefined and false each don't write out any bytes.
    if (!(maxBytesToWrite > 0))
      return 0;

    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
    for (var i = 0; i < str.length; ++i) {
      // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
      // and https://www.ietf.org/rfc/rfc2279.txt
      // and https://tools.ietf.org/html/rfc3629
      var u = str.codePointAt(i);
      if (u <= 0x7F) {
        if (outIdx >= endIdx) break;
        heap[outIdx++] = u;
      } else if (u <= 0x7FF) {
        if (outIdx + 1 >= endIdx) break;
        heap[outIdx++] = 0xC0 | (u >> 6);
        heap[outIdx++] = 0x80 | (u & 63);
      } else if (u <= 0xFFFF) {
        if (outIdx + 2 >= endIdx) break;
        heap[outIdx++] = 0xE0 | (u >> 12);
        heap[outIdx++] = 0x80 | ((u >> 6) & 63);
        heap[outIdx++] = 0x80 | (u & 63);
      } else {
        if (outIdx + 3 >= endIdx) break;
        if (u > 0x10FFFF) warnOnce(`Invalid Unicode code point ${ptrToString(u)} encountered when serializing a JS string to a UTF-8 string in wasm memory! (Valid unicode code points should be in range 0-0x10FFFF).`);
        heap[outIdx++] = 0xF0 | (u >> 18);
        heap[outIdx++] = 0x80 | ((u >> 12) & 63);
        heap[outIdx++] = 0x80 | ((u >> 6) & 63);
        heap[outIdx++] = 0x80 | (u & 63);
        // Gotcha: if codePoint is over 0xFFFF, it is represented as a surrogate pair in UTF-16.
        // We need to manually skip over the second code unit for correct iteration.
        i++;
      }
    }
    // Null-terminate the pointer to the buffer.
    heap[outIdx] = 0;
    return outIdx - startIdx;
  };
/** @type {function(string, boolean=, number=)} */
  var intArrayFromString = (stringy, dontAddNull, length) => {
      var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
      var u8array = new Array(len);
      var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
      if (dontAddNull) u8array.length = numBytesWritten;
      return u8array;
    };
  var FS_stdin_getChar = () => {
      if (!FS_stdin_getChar_buffer.length) {
        var result = null;
        if (ENVIRONMENT_IS_NODE) {
          // we will read data by chunks of BUFSIZE
          var BUFSIZE = 256;
          var buf = Buffer.alloc(BUFSIZE);
          var bytesRead = 0;
  
          // For some reason we must suppress a closure warning here, even though
          // fd definitely exists on process.stdin, and is even the proper way to
          // get the fd of stdin,
          // https://github.com/nodejs/help/issues/2136#issuecomment-523649904
          // This started to happen after moving this logic out of library_tty.js,
          // so it is related to the surrounding code in some unclear manner.
          /** @suppress {missingProperties} */
          var fd = process.stdin.fd;
  
          try {
            bytesRead = fs.readSync(fd, buf, 0, BUFSIZE);
          } catch(e) {
            // Cross-platform differences: on Windows, reading EOF throws an
            // exception, but on other OSes, reading EOF returns 0. Uniformize
            // behavior by treating the EOF exception to return 0.
            if (e.toString().includes('EOF')) bytesRead = 0;
            else throw e;
          }
  
          if (bytesRead > 0) {
            result = buf.slice(0, bytesRead).toString('utf-8');
          }
        } else
        {}
        if (!result) {
          return null;
        }
        FS_stdin_getChar_buffer = intArrayFromString(result, true);
      }
      return FS_stdin_getChar_buffer.shift();
    };
  var TTY = {
  ttys:[],
  init() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
        //   // device, it always assumes it's a TTY device. because of this, we're forcing
        //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
        //   // with text files until FS.init can be refactored.
        //   process.stdin.setEncoding('utf8');
        // }
      },
  shutdown() {
        // https://github.com/emscripten-core/emscripten/pull/1555
        // if (ENVIRONMENT_IS_NODE) {
        //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
        //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
        //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
        //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
        //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
        //   process.stdin.pause();
        // }
      },
  register(dev, ops) {
        TTY.ttys[dev] = { input: [], output: [], ops: ops };
        FS.registerDevice(dev, TTY.stream_ops);
      },
  stream_ops:{
  open(stream) {
          var tty = TTY.ttys[stream.node.rdev];
          if (!tty) {
            throw new FS.ErrnoError(43);
          }
          stream.tty = tty;
          stream.seekable = false;
        },
  close(stream) {
          // flush any pending line data
          stream.tty.ops.fsync(stream.tty);
        },
  fsync(stream) {
          stream.tty.ops.fsync(stream.tty);
        },
  read(stream, buffer, offset, length, pos /* ignored */) {
          if (!stream.tty || !stream.tty.ops.get_char) {
            throw new FS.ErrnoError(60);
          }
          var bytesRead = 0;
          for (var i = 0; i < length; i++) {
            var result;
            try {
              result = stream.tty.ops.get_char(stream.tty);
            } catch (e) {
              throw new FS.ErrnoError(29);
            }
            if (result === undefined && bytesRead === 0) {
              throw new FS.ErrnoError(6);
            }
            if (result === null || result === undefined) break;
            bytesRead++;
            buffer[offset+i] = result;
          }
          if (bytesRead) {
            stream.node.atime = Date.now();
          }
          return bytesRead;
        },
  write(stream, buffer, offset, length, pos) {
          if (!stream.tty || !stream.tty.ops.put_char) {
            throw new FS.ErrnoError(60);
          }
          try {
            for (var i = 0; i < length; i++) {
              stream.tty.ops.put_char(stream.tty, buffer[offset+i]);
            }
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (length) {
            stream.node.mtime = stream.node.ctime = Date.now();
          }
          return i;
        },
  },
  default_tty_ops:{
  get_char(tty) {
          return FS_stdin_getChar();
        },
  put_char(tty, val) {
          if (val === null || val === 10) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val); // val == 0 would cut text output off in the middle.
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            out(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  ioctl_tcgets(tty) {
          // typical setting
          return {
            c_iflag: 25856,
            c_oflag: 5,
            c_cflag: 191,
            c_lflag: 35387,
            c_cc: [
              0x03, 0x1c, 0x7f, 0x15, 0x04, 0x00, 0x01, 0x00, 0x11, 0x13, 0x1a, 0x00,
              0x12, 0x0f, 0x17, 0x16, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ]
          };
        },
  ioctl_tcsets(tty, optional_actions, data) {
          // currently just ignore
          return 0;
        },
  ioctl_tiocgwinsz(tty) {
          return [24, 80];
        },
  },
  default_tty1_ops:{
  put_char(tty, val) {
          if (val === null || val === 10) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          } else {
            if (val != 0) tty.output.push(val);
          }
        },
  fsync(tty) {
          if (tty.output?.length > 0) {
            err(UTF8ArrayToString(tty.output));
            tty.output = [];
          }
        },
  },
  };
  
  
  var mmapAlloc = (size) => {
      abort('internal error: mmapAlloc called but `emscripten_builtin_memalign` native symbol not exported');
    };
  var MEMFS = {
  ops_table:null,
  mount(mount) {
        return MEMFS.createNode(null, '/', 16895, 0);
      },
  createNode(parent, name, mode, dev) {
        if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
          // not supported
          throw new FS.ErrnoError(63);
        }
        MEMFS.ops_table ||= {
          dir: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              lookup: MEMFS.node_ops.lookup,
              mknod: MEMFS.node_ops.mknod,
              rename: MEMFS.node_ops.rename,
              unlink: MEMFS.node_ops.unlink,
              rmdir: MEMFS.node_ops.rmdir,
              readdir: MEMFS.node_ops.readdir,
              symlink: MEMFS.node_ops.symlink
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek
            }
          },
          file: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: {
              llseek: MEMFS.stream_ops.llseek,
              read: MEMFS.stream_ops.read,
              write: MEMFS.stream_ops.write,
              mmap: MEMFS.stream_ops.mmap,
              msync: MEMFS.stream_ops.msync
            }
          },
          link: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr,
              readlink: MEMFS.node_ops.readlink
            },
            stream: {}
          },
          chrdev: {
            node: {
              getattr: MEMFS.node_ops.getattr,
              setattr: MEMFS.node_ops.setattr
            },
            stream: FS.chrdev_stream_ops
          }
        };
        var node = FS.createNode(parent, name, mode, dev);
        if (FS.isDir(node.mode)) {
          node.node_ops = MEMFS.ops_table.dir.node;
          node.stream_ops = MEMFS.ops_table.dir.stream;
          node.contents = {};
        } else if (FS.isFile(node.mode)) {
          node.node_ops = MEMFS.ops_table.file.node;
          node.stream_ops = MEMFS.ops_table.file.stream;
          // The actual number of bytes used in the typed array, as opposed to
          // contents.length which gives the whole capacity.
          node.usedBytes = 0;
          // The byte data of the file is stored in a typed array.
          // Note: typed arrays are not resizable like normal JS arrays are, so
          // there is a small penalty involved for appending file writes that
          // continuously grow a file similar to std::vector capacity vs used.
          node.contents = MEMFS.emptyFileContents ??= new Uint8Array(0);
        } else if (FS.isLink(node.mode)) {
          node.node_ops = MEMFS.ops_table.link.node;
          node.stream_ops = MEMFS.ops_table.link.stream;
        } else if (FS.isChrdev(node.mode)) {
          node.node_ops = MEMFS.ops_table.chrdev.node;
          node.stream_ops = MEMFS.ops_table.chrdev.stream;
        }
        node.atime = node.mtime = node.ctime = Date.now();
        // add the new node to the parent
        if (parent) {
          parent.contents[name] = node;
          parent.atime = parent.mtime = parent.ctime = node.atime;
        }
        return node;
      },
  getFileDataAsTypedArray(node) {
        assert(FS.isFile(node.mode), 'getFileDataAsTypedArray called on non-file');
        return node.contents.subarray(0, node.usedBytes); // Make sure to not return excess unused bytes.
      },
  expandFileStorage(node, newCapacity) {
        var prevCapacity = node.contents.length;
        if (prevCapacity >= newCapacity) return; // No need to expand, the storage was already large enough.
        // Don't expand strictly to the given requested limit if it's only a very
        // small increase, but instead geometrically grow capacity.
        // For small filesizes (<1MB), perform size*2 geometric increase, but for
        // large sizes, do a much more conservative size*1.125 increase to avoid
        // overshooting the allocation cap by a very large margin.
        var CAPACITY_DOUBLING_MAX = 1024 * 1024;
        newCapacity = Math.max(newCapacity, (prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2.0 : 1.125)) >>> 0);
        if (prevCapacity) newCapacity = Math.max(newCapacity, 256); // At minimum allocate 256b for each file when expanding.
        var oldContents = MEMFS.getFileDataAsTypedArray(node);
        node.contents = new Uint8Array(newCapacity); // Allocate new storage.
        node.contents.set(oldContents);
      },
  resizeFileStorage(node, newSize) {
        if (node.usedBytes == newSize) return;
        var oldContents = node.contents;
        node.contents = new Uint8Array(newSize); // Allocate new storage.
        node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes))); // Copy old data over to the new storage.
        node.usedBytes = newSize;
      },
  node_ops:{
  getattr(node) {
          var attr = {};
          // device numbers reuse inode numbers.
          attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
          attr.ino = node.id;
          attr.mode = node.mode;
          attr.nlink = 1;
          attr.uid = 0;
          attr.gid = 0;
          attr.rdev = node.rdev;
          if (FS.isDir(node.mode)) {
            attr.size = 4096;
          } else if (FS.isFile(node.mode)) {
            attr.size = node.usedBytes;
          } else if (FS.isLink(node.mode)) {
            attr.size = node.link.length;
          } else {
            attr.size = 0;
          }
          attr.atime = new Date(node.atime);
          attr.mtime = new Date(node.mtime);
          attr.ctime = new Date(node.ctime);
          // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
          //       but this is not required by the standard.
          attr.blksize = 4096;
          attr.blocks = Math.ceil(attr.size / attr.blksize);
          return attr;
        },
  setattr(node, attr) {
          for (const key of ["mode", "atime", "mtime", "ctime"]) {
            if (attr[key] != null) {
              node[key] = attr[key];
            }
          }
          if (attr.size !== undefined) {
            MEMFS.resizeFileStorage(node, attr.size);
          }
        },
  lookup(parent, name) {
          throw new FS.ErrnoError(44);
        },
  mknod(parent, name, mode, dev) {
          return MEMFS.createNode(parent, name, mode, dev);
        },
  rename(old_node, new_dir, new_name) {
          var new_node;
          try {
            new_node = FS.lookupNode(new_dir, new_name);
          } catch (e) {}
          if (new_node) {
            if (FS.isDir(old_node.mode)) {
              // if we're overwriting a directory at new_name, make sure it's empty.
              for (var i in new_node.contents) {
                throw new FS.ErrnoError(55);
              }
            }
            FS.hashRemoveNode(new_node);
          }
          // do the internal rewiring
          delete old_node.parent.contents[old_node.name];
          new_dir.contents[new_name] = old_node;
          old_node.name = new_name;
          new_dir.ctime = new_dir.mtime = old_node.parent.ctime = old_node.parent.mtime = Date.now();
        },
  unlink(parent, name) {
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  rmdir(parent, name) {
          var node = FS.lookupNode(parent, name);
          for (var i in node.contents) {
            throw new FS.ErrnoError(55);
          }
          delete parent.contents[name];
          parent.ctime = parent.mtime = Date.now();
        },
  readdir(node) {
          return ['.', '..', ...Object.keys(node.contents)];
        },
  symlink(parent, newname, oldpath) {
          var node = MEMFS.createNode(parent, newname, 0o777 | 40960, 0);
          node.link = oldpath;
          return node;
        },
  readlink(node) {
          if (!FS.isLink(node.mode)) {
            throw new FS.ErrnoError(28);
          }
          return node.link;
        },
  },
  stream_ops:{
  read(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= stream.node.usedBytes) return 0;
          var size = Math.min(stream.node.usedBytes - position, length);
          assert(size >= 0);
          buffer.set(contents.subarray(position, position + size), offset);
          return size;
        },
  write(stream, buffer, offset, length, position, canOwn) {
          assert(buffer.subarray, 'FS.write expects a TypedArray');
  
          if (!length) return 0;
          var node = stream.node;
          node.mtime = node.ctime = Date.now();
  
          if (canOwn) {
            assert(position === 0, 'canOwn must imply no weird position inside the file');
            node.contents = buffer.subarray(offset, offset + length);
            node.usedBytes = length;
          } else if (node.usedBytes === 0 && position === 0) { // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
            node.contents = buffer.slice(offset, offset + length);
            node.usedBytes = length;
          } else {
            MEMFS.expandFileStorage(node, position+length);
            // Use typed array write which is available.
            node.contents.set(buffer.subarray(offset, offset + length), position);
            node.usedBytes = Math.max(node.usedBytes, position + length);
          }
          return length;
        },
  llseek(stream, offset, whence) {
          var position = offset;
          if (whence === 1) {
            position += stream.position;
          } else if (whence === 2) {
            if (FS.isFile(stream.node.mode)) {
              position += stream.node.usedBytes;
            }
          }
          if (position < 0) {
            throw new FS.ErrnoError(28);
          }
          return position;
        },
  mmap(stream, length, position, prot, flags) {
          if (!FS.isFile(stream.node.mode)) {
            throw new FS.ErrnoError(43);
          }
          var ptr;
          var allocated;
          var contents = stream.node.contents;
          // Only make a new copy when MAP_PRIVATE is specified.
          if (!(flags & 2) && contents.buffer === HEAP8.buffer) {
            // We can't emulate MAP_SHARED when the file is not backed by the
            // buffer we're mapping to (e.g. the HEAP buffer).
            allocated = false;
            ptr = contents.byteOffset;
          } else {
            allocated = true;
            ptr = mmapAlloc(length);
            if (!ptr) {
              throw new FS.ErrnoError(48);
            }
            if (contents) {
              // Try to avoid unnecessary slices.
              if (position > 0 || position + length < contents.length) {
                if (contents.subarray) {
                  contents = contents.subarray(position, position + length);
                } else {
                  contents = Array.prototype.slice.call(contents, position, position + length);
                }
              }
              HEAP8.set(contents, ptr);
            }
          }
          return { ptr, allocated };
        },
  msync(stream, buffer, offset, length, mmapFlags) {
          MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
          // should we check if bytesWritten and length are the same?
          return 0;
        },
  },
  };
  
  var FS_modeStringToFlags = (str) => {
      if (typeof str != 'string') return str;
      var flagModes = {
        'r': 0,
        'r+': 2,
        'w': 512 | 64 | 1,
        'w+': 512 | 64 | 2,
        'a': 1024 | 64 | 1,
        'a+': 1024 | 64 | 2,
      };
      var flags = flagModes[str];
      if (typeof flags == 'undefined') {
        throw new Error(`Unknown file open mode: ${str}`);
      }
      return flags;
    };
  
  var FS_fileDataToTypedArray = (data) => {
      if (typeof data == 'string') {
        data = intArrayFromString(data, true);
      }
      if (!data.subarray) {
        data = new Uint8Array(data);
      }
      return data;
    };
  
  var FS_getMode = (canRead, canWrite) => {
      var mode = 0;
      if (canRead) mode |= 292 | 73;
      if (canWrite) mode |= 146;
      return mode;
    };
  
  
  
  
  var strError = (errno) => UTF8ToString(_strerror(errno));
  
  var ERRNO_CODES = {
      'EPERM': 63,
      'ENOENT': 44,
      'ESRCH': 71,
      'EINTR': 27,
      'EIO': 29,
      'ENXIO': 60,
      'E2BIG': 1,
      'ENOEXEC': 45,
      'EBADF': 8,
      'ECHILD': 12,
      'EAGAIN': 6,
      'EWOULDBLOCK': 6,
      'ENOMEM': 48,
      'EACCES': 2,
      'EFAULT': 21,
      'ENOTBLK': 105,
      'EBUSY': 10,
      'EEXIST': 20,
      'EXDEV': 75,
      'ENODEV': 43,
      'ENOTDIR': 54,
      'EISDIR': 31,
      'EINVAL': 28,
      'ENFILE': 41,
      'EMFILE': 33,
      'ENOTTY': 59,
      'ETXTBSY': 74,
      'EFBIG': 22,
      'ENOSPC': 51,
      'ESPIPE': 70,
      'EROFS': 69,
      'EMLINK': 34,
      'EPIPE': 64,
      'EDOM': 18,
      'ERANGE': 68,
      'ENOMSG': 49,
      'EIDRM': 24,
      'ECHRNG': 106,
      'EL2NSYNC': 156,
      'EL3HLT': 107,
      'EL3RST': 108,
      'ELNRNG': 109,
      'EUNATCH': 110,
      'ENOCSI': 111,
      'EL2HLT': 112,
      'EDEADLK': 16,
      'ENOLCK': 46,
      'EBADE': 113,
      'EBADR': 114,
      'EXFULL': 115,
      'ENOANO': 104,
      'EBADRQC': 103,
      'EBADSLT': 102,
      'EDEADLOCK': 16,
      'EBFONT': 101,
      'ENOSTR': 100,
      'ENODATA': 116,
      'ETIME': 117,
      'ENOSR': 118,
      'ENONET': 119,
      'ENOPKG': 120,
      'EREMOTE': 121,
      'ENOLINK': 47,
      'EADV': 122,
      'ESRMNT': 123,
      'ECOMM': 124,
      'EPROTO': 65,
      'EMULTIHOP': 36,
      'EDOTDOT': 125,
      'EBADMSG': 9,
      'ENOTUNIQ': 126,
      'EBADFD': 127,
      'EREMCHG': 128,
      'ELIBACC': 129,
      'ELIBBAD': 130,
      'ELIBSCN': 131,
      'ELIBMAX': 132,
      'ELIBEXEC': 133,
      'ENOSYS': 52,
      'ENOTEMPTY': 55,
      'ENAMETOOLONG': 37,
      'ELOOP': 32,
      'EOPNOTSUPP': 138,
      'EPFNOSUPPORT': 139,
      'ECONNRESET': 15,
      'ENOBUFS': 42,
      'EAFNOSUPPORT': 5,
      'EPROTOTYPE': 67,
      'ENOTSOCK': 57,
      'ENOPROTOOPT': 50,
      'ESHUTDOWN': 140,
      'ECONNREFUSED': 14,
      'EADDRINUSE': 3,
      'ECONNABORTED': 13,
      'ENETUNREACH': 40,
      'ENETDOWN': 38,
      'ETIMEDOUT': 73,
      'EHOSTDOWN': 142,
      'EHOSTUNREACH': 23,
      'EINPROGRESS': 26,
      'EALREADY': 7,
      'EDESTADDRREQ': 17,
      'EMSGSIZE': 35,
      'EPROTONOSUPPORT': 66,
      'ESOCKTNOSUPPORT': 137,
      'EADDRNOTAVAIL': 4,
      'ENETRESET': 39,
      'EISCONN': 30,
      'ENOTCONN': 53,
      'ETOOMANYREFS': 141,
      'EUSERS': 136,
      'EDQUOT': 19,
      'ESTALE': 72,
      'ENOTSUP': 138,
      'ENOMEDIUM': 148,
      'EILSEQ': 25,
      'EOVERFLOW': 61,
      'ECANCELED': 11,
      'ENOTRECOVERABLE': 56,
      'EOWNERDEAD': 62,
      'ESTRPIPE': 135,
    };
  
  var asyncLoad = async (url) => {
      var arrayBuffer = await readAsync(url);
      assert(arrayBuffer, `Loading data file "${url}" failed (no arrayBuffer).`);
      return new Uint8Array(arrayBuffer);
    };
  
  
  var FS_createDataFile = (...args) => FS.createDataFile(...args);
  
  var getUniqueRunDependency = (id) => {
      var orig = id;
      while (1) {
        if (!runDependencyTracking[id]) return id;
        id = orig + Math.random();
      }
    };
  
  var runDependencies = 0;
  
  
  var dependenciesFulfilled = null;
  
  var runDependencyTracking = {
  };
  
  var runDependencyWatcher = null;
  var removeRunDependency = (id) => {
      runDependencies--;
  
      Module['monitorRunDependencies']?.(runDependencies);
  
      assert(id, 'removeRunDependency requires an ID');
      assert(runDependencyTracking[id]);
      delete runDependencyTracking[id];
      if (runDependencies == 0) {
        if (runDependencyWatcher !== null) {
          clearInterval(runDependencyWatcher);
          runDependencyWatcher = null;
        }
        if (dependenciesFulfilled) {
          var callback = dependenciesFulfilled;
          dependenciesFulfilled = null;
          callback(); // can add another dependenciesFulfilled
        }
      }
    };
  
  
  var addRunDependency = (id) => {
      runDependencies++;
  
      Module['monitorRunDependencies']?.(runDependencies);
  
      assert(id, 'addRunDependency requires an ID')
      assert(!runDependencyTracking[id]);
      runDependencyTracking[id] = 1;
      if (runDependencyWatcher === null && globalThis.setInterval) {
        // Check for missing dependencies every few seconds
        runDependencyWatcher = setInterval(() => {
          if (ABORT) {
            clearInterval(runDependencyWatcher);
            runDependencyWatcher = null;
            return;
          }
          var shown = false;
          for (var dep in runDependencyTracking) {
            if (!shown) {
              shown = true;
              err('still waiting on run dependencies:');
            }
            err(`dependency: ${dep}`);
          }
          if (shown) {
            err('(end of list)');
          }
        }, 10000);
        // Prevent this timer from keeping the runtime alive if nothing
        // else is.
        runDependencyWatcher.unref?.()
      }
    };
  
  
  var preloadPlugins = [];
  var FS_handledByPreloadPlugin = async (byteArray, fullname) => {
      // Ensure plugins are ready.
      if (typeof Browser != 'undefined') Browser.init();
  
      for (var plugin of preloadPlugins) {
        if (plugin['canHandle'](fullname)) {
          assert(plugin['handle'].constructor.name === 'AsyncFunction', 'Filesystem plugin handlers must be async functions (See #24914)')
          return plugin['handle'](byteArray, fullname);
        }
      }
      // If no plugin handled this file then return the original/unmodified
      // byteArray.
      return byteArray;
    };
  var FS_preloadFile = async (parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish) => {
      // TODO we should allow people to just pass in a complete filename instead
      // of parent and name being that we just join them anyways
      var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
      var dep = getUniqueRunDependency(`cp ${fullname}`); // might have several active requests for the same fullname
      addRunDependency(dep);
  
      try {
        var byteArray = url;
        if (typeof url == 'string') {
          byteArray = await asyncLoad(url);
        }
  
        byteArray = await FS_handledByPreloadPlugin(byteArray, fullname);
        preFinish?.();
        if (!dontCreateFile) {
          FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
        }
      } finally {
        removeRunDependency(dep);
      }
    };
  var FS_createPreloadedFile = (parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) => {
      FS_preloadFile(parent, name, url, canRead, canWrite, dontCreateFile, canOwn, preFinish).then(onload).catch(onerror);
    };
  var FS = {
  root:null,
  mounts:[],
  devices:{
  },
  streams:[],
  nextInode:1,
  nameTable:null,
  currentPath:"/",
  initialized:false,
  ignorePermissions:true,
  filesystems:null,
  syncFSRequests:0,
  ErrnoError:class extends Error {
        name = 'ErrnoError';
        // We set the `name` property to be able to identify `FS.ErrnoError`
        // - the `name` is a standard ECMA-262 property of error objects. Kind of good to have it anyway.
        // - when using PROXYFS, an error can come from an underlying FS
        // as different FS objects have their own FS.ErrnoError each,
        // the test `err instanceof FS.ErrnoError` won't detect an error coming from another filesystem, causing bugs.
        // we'll use the reliable test `err.name == "ErrnoError"` instead
        constructor(errno) {
          super(runtimeInitialized ? strError(errno) : '');
          this.errno = errno;
          for (var key in ERRNO_CODES) {
            if (ERRNO_CODES[key] === errno) {
              this.code = key;
              break;
            }
          }
        }
      },
  FSStream:class {
        shared = {};
        get object() {
          return this.node;
        }
        set object(val) {
          this.node = val;
        }
        get isRead() {
          return (this.flags & 2097155) !== 1;
        }
        get isWrite() {
          return (this.flags & 2097155) !== 0;
        }
        get isAppend() {
          return (this.flags & 1024);
        }
        get flags() {
          return this.shared.flags;
        }
        set flags(val) {
          this.shared.flags = val;
        }
        get position() {
          return this.shared.position;
        }
        set position(val) {
          this.shared.position = val;
        }
      },
  FSNode:class {
        node_ops = {};
        stream_ops = {};
        readMode = 292 | 73;
        writeMode = 146;
        mounted = null;
        constructor(parent, name, mode, rdev) {
          if (!parent) {
            parent = this;  // root node sets parent to itself
          }
          this.parent = parent;
          this.mount = parent.mount;
          this.id = FS.nextInode++;
          this.name = name;
          this.mode = mode;
          this.rdev = rdev;
          this.atime = this.mtime = this.ctime = Date.now();
        }
        get read() {
          return (this.mode & this.readMode) === this.readMode;
        }
        set read(val) {
          val ? this.mode |= this.readMode : this.mode &= ~this.readMode;
        }
        get write() {
          return (this.mode & this.writeMode) === this.writeMode;
        }
        set write(val) {
          val ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
        }
        get isFolder() {
          return FS.isDir(this.mode);
        }
        get isDevice() {
          return FS.isChrdev(this.mode);
        }
      },
  lookupPath(path, opts = {}) {
        if (!path) {
          throw new FS.ErrnoError(44);
        }
        opts.follow_mount ??= true
  
        if (!PATH.isAbs(path)) {
          path = FS.cwd() + '/' + path;
        }
  
        // limit max consecutive symlinks to SYMLOOP_MAX.
        linkloop: for (var nlinks = 0; nlinks < 40; nlinks++) {
          // split the absolute path
          var parts = path.split('/').filter((p) => !!p);
  
          // start at the root
          var current = FS.root;
          var current_path = '/';
  
          for (var i = 0; i < parts.length; i++) {
            var islast = (i === parts.length-1);
            if (islast && opts.parent) {
              // stop resolving
              break;
            }
  
            if (parts[i] === '.') {
              continue;
            }
  
            if (parts[i] === '..') {
              current_path = PATH.dirname(current_path);
              if (FS.isRoot(current)) {
                path = current_path + '/' + parts.slice(i + 1).join('/');
                // We're making progress here, don't let many consecutive ..'s
                // lead to ELOOP
                nlinks--;
                continue linkloop;
              } else {
                current = current.parent;
              }
              continue;
            }
  
            current_path = PATH.join2(current_path, parts[i]);
            try {
              current = FS.lookupNode(current, parts[i]);
            } catch (e) {
              // if noent_okay is true, suppress a ENOENT in the last component
              // and return an object with an undefined node. This is needed for
              // resolving symlinks in the path when creating a file.
              if ((e?.errno === 44) && islast && opts.noent_okay) {
                return { path: current_path };
              }
              throw e;
            }
  
            // jump to the mount's root node if this is a mountpoint
            if (FS.isMountpoint(current) && (!islast || opts.follow_mount)) {
              current = current.mounted.root;
            }
  
            // by default, lookupPath will not follow a symlink if it is the final path component.
            // setting opts.follow = true will override this behavior.
            if (FS.isLink(current.mode) && (!islast || opts.follow)) {
              if (!current.node_ops.readlink) {
                throw new FS.ErrnoError(52);
              }
              var link = current.node_ops.readlink(current);
              if (!PATH.isAbs(link)) {
                link = PATH.dirname(current_path) + '/' + link;
              }
              path = link + '/' + parts.slice(i + 1).join('/');
              continue linkloop;
            }
          }
          return { path: current_path, node: current };
        }
        throw new FS.ErrnoError(32);
      },
  getPath(node) {
        var path;
        while (true) {
          if (FS.isRoot(node)) {
            var mount = node.mount.mountpoint;
            if (!path) return mount;
            return mount[mount.length-1] !== '/' ? `${mount}/${path}` : mount + path;
          }
          path = path ? `${node.name}/${path}` : node.name;
          node = node.parent;
        }
      },
  hashName(parentid, name) {
        var hash = 0;
  
        for (var i = 0; i < name.length; i++) {
          hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
        }
        return ((parentid + hash) >>> 0) % FS.nameTable.length;
      },
  hashAddNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        node.name_next = FS.nameTable[hash];
        FS.nameTable[hash] = node;
      },
  hashRemoveNode(node) {
        var hash = FS.hashName(node.parent.id, node.name);
        if (FS.nameTable[hash] === node) {
          FS.nameTable[hash] = node.name_next;
        } else {
          var current = FS.nameTable[hash];
          while (current) {
            if (current.name_next === node) {
              current.name_next = node.name_next;
              break;
            }
            current = current.name_next;
          }
        }
      },
  lookupNode(parent, name) {
        var errCode = FS.mayLookup(parent);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        var hash = FS.hashName(parent.id, name);
        for (var node = FS.nameTable[hash]; node; node = node.name_next) {
          var nodeName = node.name;
          if (node.parent.id === parent.id && nodeName === name) {
            return node;
          }
        }
        // if we failed to find it in the cache, call into the VFS
        return FS.lookup(parent, name);
      },
  createNode(parent, name, mode, rdev) {
        assert(typeof parent == 'object')
        var node = new FS.FSNode(parent, name, mode, rdev);
  
        FS.hashAddNode(node);
  
        return node;
      },
  destroyNode(node) {
        FS.hashRemoveNode(node);
      },
  isRoot(node) {
        return node === node.parent;
      },
  isMountpoint(node) {
        return !!node.mounted;
      },
  isFile(mode) {
        return (mode & 61440) === 32768;
      },
  isDir(mode) {
        return (mode & 61440) === 16384;
      },
  isLink(mode) {
        return (mode & 61440) === 40960;
      },
  isChrdev(mode) {
        return (mode & 61440) === 8192;
      },
  isBlkdev(mode) {
        return (mode & 61440) === 24576;
      },
  isFIFO(mode) {
        return (mode & 61440) === 4096;
      },
  isSocket(mode) {
        return (mode & 49152) === 49152;
      },
  flagsToPermissionString(flag) {
        var perms = ['r', 'w', 'rw'][flag & 3];
        if ((flag & 512)) {
          perms += 'w';
        }
        return perms;
      },
  nodePermissions(node, perms) {
        if (FS.ignorePermissions) {
          return 0;
        }
        // return 0 if any user, group or owner bits are set.
        if (perms.includes('r') && !(node.mode & 292)) {
          return 2;
        }
        if (perms.includes('w') && !(node.mode & 146)) {
          return 2;
        }
        if (perms.includes('x') && !(node.mode & 73)) {
          return 2;
        }
        return 0;
      },
  mayLookup(dir) {
        if (!FS.isDir(dir.mode)) return 54;
        var errCode = FS.nodePermissions(dir, 'x');
        if (errCode) return errCode;
        if (!dir.node_ops.lookup) return 2;
        return 0;
      },
  mayCreate(dir, name) {
        if (!FS.isDir(dir.mode)) {
          return 54;
        }
        try {
          var node = FS.lookupNode(dir, name);
          return 20;
        } catch (e) {
        }
        return FS.nodePermissions(dir, 'wx');
      },
  mayDelete(dir, name, isdir) {
        var node;
        try {
          node = FS.lookupNode(dir, name);
        } catch (e) {
          return e.errno;
        }
        var errCode = FS.nodePermissions(dir, 'wx');
        if (errCode) {
          return errCode;
        }
        if (isdir) {
          if (!FS.isDir(node.mode)) {
            return 54;
          }
          if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
            return 10;
          }
        } else if (FS.isDir(node.mode)) {
          return 31;
        }
        return 0;
      },
  mayOpen(node, flags) {
        if (!node) {
          return 44;
        }
        if (FS.isLink(node.mode)) {
          return 32;
        }
        var mode = FS.flagsToPermissionString(flags);
        if (FS.isDir(node.mode)) {
          // opening for write
          // TODO: check for O_SEARCH? (== search for dir only)
          if (mode !== 'r' || (flags & (512 | 64))) {
            return 31;
          }
        }
        return FS.nodePermissions(node, mode);
      },
  checkOpExists(op, err) {
        if (!op) {
          throw new FS.ErrnoError(err);
        }
        return op;
      },
  MAX_OPEN_FDS:4096,
  nextfd() {
        for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
          if (!FS.streams[fd]) {
            return fd;
          }
        }
        throw new FS.ErrnoError(33);
      },
  getStreamChecked(fd) {
        var stream = FS.getStream(fd);
        if (!stream) {
          throw new FS.ErrnoError(8);
        }
        return stream;
      },
  getStream:(fd) => FS.streams[fd],
  createStream(stream, fd = -1) {
        assert(fd >= -1);
  
        // clone it, so we can return an instance of FSStream
        stream = Object.assign(new FS.FSStream(), stream);
        if (fd == -1) {
          fd = FS.nextfd();
        }
        stream.fd = fd;
        FS.streams[fd] = stream;
        return stream;
      },
  closeStream(fd) {
        FS.streams[fd] = null;
      },
  dupStream(origStream, fd = -1) {
        var stream = FS.createStream(origStream, fd);
        stream.stream_ops?.dup?.(stream);
        return stream;
      },
  doSetAttr(stream, node, attr) {
        var setattr = stream?.stream_ops.setattr;
        var arg = setattr ? stream : node;
        setattr ??= node.node_ops.setattr;
        FS.checkOpExists(setattr, 63)
        try {
          setattr(arg, attr);
        } catch (e) {
          if (e instanceof RangeError) {
            throw new FS.ErrnoError(22);
          }
          throw e;
        }
      },
  chrdev_stream_ops:{
  open(stream) {
          var device = FS.getDevice(stream.node.rdev);
          // override node's stream ops with the device's
          stream.stream_ops = device.stream_ops;
          // forward the open call
          stream.stream_ops.open?.(stream);
        },
  llseek() {
          throw new FS.ErrnoError(70);
        },
  },
  major:(dev) => ((dev) >> 8),
  minor:(dev) => ((dev) & 0xff),
  makedev:(ma, mi) => ((ma) << 8 | (mi)),
  registerDevice(dev, ops) {
        FS.devices[dev] = { stream_ops: ops };
      },
  getDevice:(dev) => FS.devices[dev],
  getMounts(mount) {
        var mounts = [];
        var check = [mount];
  
        while (check.length) {
          var m = check.pop();
  
          mounts.push(m);
  
          check.push(...m.mounts);
        }
  
        return mounts;
      },
  syncfs(populate, callback) {
        if (typeof populate == 'function') {
          callback = populate;
          populate = false;
        }
  
        FS.syncFSRequests++;
  
        if (FS.syncFSRequests > 1) {
          err(`warning: ${FS.syncFSRequests} FS.syncfs operations in flight at once, probably just doing extra work`);
        }
  
        var mounts = FS.getMounts(FS.root.mount);
        var completed = 0;
  
        function doCallback(errCode) {
          assert(FS.syncFSRequests > 0);
          FS.syncFSRequests--;
          return callback(errCode);
        }
  
        function done(errCode) {
          if (errCode) {
            if (!done.errored) {
              done.errored = true;
              return doCallback(errCode);
            }
            return;
          }
          if (++completed >= mounts.length) {
            doCallback(null);
          }
        };
  
        // sync all mounts
        for (var mount of mounts) {
          if (mount.type.syncfs) {
            mount.type.syncfs(mount, populate, done);
          } else {
            done(null);
          }
        }
      },
  mount(type, opts, mountpoint) {
        if (typeof type == 'string') {
          // The filesystem was not included, and instead we have an error
          // message stored in the variable.
          throw type;
        }
        var root = mountpoint === '/';
        var pseudo = !mountpoint;
        var node;
  
        if (root && FS.root) {
          throw new FS.ErrnoError(10);
        } else if (!root && !pseudo) {
          var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
          mountpoint = lookup.path;  // use the absolute path
          node = lookup.node;
  
          if (FS.isMountpoint(node)) {
            throw new FS.ErrnoError(10);
          }
  
          if (!FS.isDir(node.mode)) {
            throw new FS.ErrnoError(54);
          }
        }
  
        var mount = {
          type,
          opts,
          mountpoint,
          mounts: []
        };
  
        // create a root node for the fs
        var mountRoot = type.mount(mount);
        mountRoot.mount = mount;
        mount.root = mountRoot;
  
        if (root) {
          FS.root = mountRoot;
        } else if (node) {
          // set as a mountpoint
          node.mounted = mount;
  
          // add the new mount to the current mount's children
          if (node.mount) {
            node.mount.mounts.push(mount);
          }
        }
  
        return mountRoot;
      },
  unmount(mountpoint) {
        var lookup = FS.lookupPath(mountpoint, { follow_mount: false });
  
        if (!FS.isMountpoint(lookup.node)) {
          throw new FS.ErrnoError(28);
        }
  
        // destroy the nodes for this mount, and all its child mounts
        var node = lookup.node;
        var mount = node.mounted;
        var mounts = FS.getMounts(mount);
  
        for (var [hash, current] of Object.entries(FS.nameTable)) {
          while (current) {
            var next = current.name_next;
  
            if (mounts.includes(current.mount)) {
              FS.destroyNode(current);
            }
  
            current = next;
          }
        }
  
        // no longer a mountpoint
        node.mounted = null;
  
        // remove this mount from the child mounts
        var idx = node.mount.mounts.indexOf(mount);
        assert(idx !== -1);
        node.mount.mounts.splice(idx, 1);
      },
  lookup(parent, name) {
        return parent.node_ops.lookup(parent, name);
      },
  mknod(path, mode, dev) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        if (!name) {
          throw new FS.ErrnoError(28);
        }
        if (name === '.' || name === '..') {
          throw new FS.ErrnoError(20);
        }
        var errCode = FS.mayCreate(parent, name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.mknod) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.mknod(parent, name, mode, dev);
      },
  statfs(path) {
        return FS.statfsNode(FS.lookupPath(path, {follow: true}).node);
      },
  statfsStream(stream) {
        // We keep a separate statfsStream function because noderawfs overrides
        // it. In noderawfs, stream.node is sometimes null. Instead, we need to
        // look at stream.path.
        return FS.statfsNode(stream.node);
      },
  statfsNode(node) {
        // NOTE: None of the defaults here are true. We're just returning safe and
        //       sane values. Currently nodefs and rawfs replace these defaults,
        //       other file systems leave them alone.
        var rtn = {
          bsize: 4096,
          frsize: 4096,
          blocks: 1e6,
          bfree: 5e5,
          bavail: 5e5,
          files: FS.nextInode,
          ffree: FS.nextInode - 1,
          fsid: 42,
          flags: 2,
          namelen: 255,
        };
  
        if (node.node_ops.statfs) {
          Object.assign(rtn, node.node_ops.statfs(node.mount.opts.root));
        }
        return rtn;
      },
  create(path, mode = 0o666) {
        mode &= 4095;
        mode |= 32768;
        return FS.mknod(path, mode, 0);
      },
  mkdir(path, mode = 0o777) {
        mode &= 511 | 512;
        mode |= 16384;
        return FS.mknod(path, mode, 0);
      },
  mkdirTree(path, mode) {
        var dirs = path.split('/');
        var d = '';
        for (var dir of dirs) {
          if (!dir) continue;
          if (d || PATH.isAbs(path)) d += '/';
          d += dir;
          try {
            FS.mkdir(d, mode);
          } catch(e) {
            if (e.errno != 20) throw e;
          }
        }
      },
  mkdev(path, mode, dev) {
        if (typeof dev == 'undefined') {
          dev = mode;
          mode = 0o666;
        }
        mode |= 8192;
        return FS.mknod(path, mode, dev);
      },
  symlink(oldpath, newpath) {
        if (!PATH_FS.resolve(oldpath)) {
          throw new FS.ErrnoError(44);
        }
        var lookup = FS.lookupPath(newpath, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var newname = PATH.basename(newpath);
        var errCode = FS.mayCreate(parent, newname);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.symlink) {
          throw new FS.ErrnoError(63);
        }
        return parent.node_ops.symlink(parent, newname, oldpath);
      },
  rename(old_path, new_path) {
        var old_dirname = PATH.dirname(old_path);
        var new_dirname = PATH.dirname(new_path);
        var old_name = PATH.basename(old_path);
        var new_name = PATH.basename(new_path);
        // parents must exist
        var lookup, old_dir, new_dir;
  
        // let the errors from non existent directories percolate up
        lookup = FS.lookupPath(old_path, { parent: true });
        old_dir = lookup.node;
        lookup = FS.lookupPath(new_path, { parent: true });
        new_dir = lookup.node;
  
        if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
        // need to be part of the same mount
        if (old_dir.mount !== new_dir.mount) {
          throw new FS.ErrnoError(75);
        }
        // source must exist
        var old_node = FS.lookupNode(old_dir, old_name);
        // old path should not be an ancestor of the new path
        var relative = PATH_FS.relative(old_path, new_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(28);
        }
        // new path should not be an ancestor of the old path
        relative = PATH_FS.relative(new_path, old_dirname);
        if (relative.charAt(0) !== '.') {
          throw new FS.ErrnoError(55);
        }
        // see if the new path already exists
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {
          // not fatal
        }
        // early out if nothing needs to change
        if (old_node === new_node) {
          return;
        }
        // we'll need to delete the old entry
        var isdir = FS.isDir(old_node.mode);
        var errCode = FS.mayDelete(old_dir, old_name, isdir);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        // need delete permissions if we'll be overwriting.
        // need create permissions if new doesn't already exist.
        errCode = new_node ?
          FS.mayDelete(new_dir, new_name, isdir) :
          FS.mayCreate(new_dir, new_name);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!old_dir.node_ops.rename) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(old_node) || (new_node && FS.isMountpoint(new_node))) {
          throw new FS.ErrnoError(10);
        }
        // if we are going to change the parent, check write permissions
        if (new_dir !== old_dir) {
          errCode = FS.nodePermissions(old_dir, 'w');
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // remove the node from the lookup hash
        FS.hashRemoveNode(old_node);
        // do the underlying fs rename
        try {
          old_dir.node_ops.rename(old_node, new_dir, new_name);
          // update old node (we do this here to avoid each backend
          // needing to)
          old_node.parent = new_dir;
        } catch (e) {
          throw e;
        } finally {
          // add the node back to the hash (in case node_ops.rename
          // changed its name)
          FS.hashAddNode(old_node);
        }
      },
  rmdir(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, true);
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.rmdir) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.rmdir(parent, name);
        FS.destroyNode(node);
      },
  readdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        var readdir = FS.checkOpExists(node.node_ops.readdir, 54);
        return readdir(node);
      },
  unlink(path) {
        var lookup = FS.lookupPath(path, { parent: true });
        var parent = lookup.node;
        if (!parent) {
          throw new FS.ErrnoError(44);
        }
        var name = PATH.basename(path);
        var node = FS.lookupNode(parent, name);
        var errCode = FS.mayDelete(parent, name, false);
        if (errCode) {
          // According to POSIX, we should map EISDIR to EPERM, but
          // we instead do what Linux does (and we must, as we use
          // the musl linux libc).
          throw new FS.ErrnoError(errCode);
        }
        if (!parent.node_ops.unlink) {
          throw new FS.ErrnoError(63);
        }
        if (FS.isMountpoint(node)) {
          throw new FS.ErrnoError(10);
        }
        parent.node_ops.unlink(parent, name);
        FS.destroyNode(node);
      },
  readlink(path) {
        var lookup = FS.lookupPath(path);
        var link = lookup.node;
        if (!link) {
          throw new FS.ErrnoError(44);
        }
        if (!link.node_ops.readlink) {
          throw new FS.ErrnoError(28);
        }
        return link.node_ops.readlink(link);
      },
  stat(path, dontFollow) {
        var lookup = FS.lookupPath(path, { follow: !dontFollow });
        var node = lookup.node;
        var getattr = FS.checkOpExists(node.node_ops.getattr, 63);
        return getattr(node);
      },
  fstat(fd) {
        var stream = FS.getStreamChecked(fd);
        var node = stream.node;
        var getattr = stream.stream_ops.getattr;
        var arg = getattr ? stream : node;
        getattr ??= node.node_ops.getattr;
        FS.checkOpExists(getattr, 63)
        return getattr(arg);
      },
  lstat(path) {
        return FS.stat(path, true);
      },
  doChmod(stream, node, mode, dontFollow) {
        FS.doSetAttr(stream, node, {
          mode: (mode & 4095) | (node.mode & ~4095),
          ctime: Date.now(),
          dontFollow
        });
      },
  chmod(path, mode, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChmod(null, node, mode, dontFollow);
      },
  lchmod(path, mode) {
        FS.chmod(path, mode, true);
      },
  fchmod(fd, mode) {
        var stream = FS.getStreamChecked(fd);
        FS.doChmod(stream, stream.node, mode, false);
      },
  doChown(stream, node, dontFollow) {
        FS.doSetAttr(stream, node, {
          timestamp: Date.now(),
          dontFollow
          // we ignore the uid / gid for now
        });
      },
  chown(path, uid, gid, dontFollow) {
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: !dontFollow });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doChown(null, node, dontFollow);
      },
  lchown(path, uid, gid) {
        FS.chown(path, uid, gid, true);
      },
  fchown(fd, uid, gid) {
        var stream = FS.getStreamChecked(fd);
        FS.doChown(stream, stream.node, false);
      },
  doTruncate(stream, node, len) {
        if (FS.isDir(node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!FS.isFile(node.mode)) {
          throw new FS.ErrnoError(28);
        }
        var errCode = FS.nodePermissions(node, 'w');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.doSetAttr(stream, node, {
          size: len,
          timestamp: Date.now()
        });
      },
  truncate(path, len) {
        if (len < 0) {
          throw new FS.ErrnoError(28);
        }
        var node;
        if (typeof path == 'string') {
          var lookup = FS.lookupPath(path, { follow: true });
          node = lookup.node;
        } else {
          node = path;
        }
        FS.doTruncate(null, node, len);
      },
  ftruncate(fd, len) {
        var stream = FS.getStreamChecked(fd);
        if (len < 0 || (stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(28);
        }
        FS.doTruncate(stream, stream.node, len);
      },
  utime(path, atime, mtime) {
        var lookup = FS.lookupPath(path, { follow: true });
        var node = lookup.node;
        var setattr = FS.checkOpExists(node.node_ops.setattr, 63);
        setattr(node, {
          atime: atime,
          mtime: mtime
        });
      },
  open(path, flags, mode = 0o666) {
        if (path === "") {
          throw new FS.ErrnoError(44);
        }
        flags = FS_modeStringToFlags(flags);
        if ((flags & 64)) {
          mode = (mode & 4095) | 32768;
        } else {
          mode = 0;
        }
        var node;
        var isDirPath;
        if (typeof path == 'object') {
          node = path;
        } else {
          isDirPath = path.endsWith("/");
          // noent_okay makes it so that if the final component of the path
          // doesn't exist, lookupPath returns `node: undefined`. `path` will be
          // updated to point to the target of all symlinks.
          var lookup = FS.lookupPath(path, {
            follow: !(flags & 131072),
            noent_okay: true
          });
          node = lookup.node;
          path = lookup.path;
        }
        // perhaps we need to create the node
        var created = false;
        if ((flags & 64)) {
          if (node) {
            // if O_CREAT and O_EXCL are set, error out if the node already exists
            if ((flags & 128)) {
              throw new FS.ErrnoError(20);
            }
          } else if (isDirPath) {
            throw new FS.ErrnoError(31);
          } else {
            // node doesn't exist, try to create it
            // Ignore the permission bits here to ensure we can `open` this new
            // file below. We use chmod below to apply the permissions once the
            // file is open.
            node = FS.mknod(path, mode | 0o777, 0);
            created = true;
          }
        }
        if (!node) {
          throw new FS.ErrnoError(44);
        }
        // can't truncate a device
        if (FS.isChrdev(node.mode)) {
          flags &= ~512;
        }
        // if asked only for a directory, then this must be one
        if ((flags & 65536) && !FS.isDir(node.mode)) {
          throw new FS.ErrnoError(54);
        }
        // check permissions, if this is not a file we just created now (it is ok to
        // create and write to a file with read-only permissions; it is read-only
        // for later use)
        if (!created) {
          var errCode = FS.mayOpen(node, flags);
          if (errCode) {
            throw new FS.ErrnoError(errCode);
          }
        }
        // do truncation if necessary
        if ((flags & 512) && !created) {
          FS.truncate(node, 0);
        }
        // we've already handled these, don't pass down to the underlying vfs
        flags &= ~(128 | 512 | 131072);
  
        // register the stream with the filesystem
        var stream = FS.createStream({
          node,
          path: FS.getPath(node),  // we want the absolute path to the node
          flags,
          seekable: true,
          position: 0,
          stream_ops: node.stream_ops,
          // used by the file family libc calls (fopen, fwrite, ferror, etc.)
          ungotten: [],
          error: false
        });
        // call the new stream's open function
        if (stream.stream_ops.open) {
          stream.stream_ops.open(stream);
        }
        if (created) {
          FS.chmod(node, mode & 0o777);
        }
        return stream;
      },
  close(stream) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (stream.getdents) stream.getdents = null; // free readdir state
        try {
          if (stream.stream_ops.close) {
            stream.stream_ops.close(stream);
          }
        } catch (e) {
          throw e;
        } finally {
          FS.closeStream(stream.fd);
        }
        stream.fd = null;
      },
  isClosed(stream) {
        return stream.fd === null;
      },
  llseek(stream, offset, whence) {
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if (!stream.seekable || !stream.stream_ops.llseek) {
          throw new FS.ErrnoError(70);
        }
        if (whence != 0 && whence != 1 && whence != 2) {
          throw new FS.ErrnoError(28);
        }
        stream.position = stream.stream_ops.llseek(stream, offset, whence);
        stream.ungotten = [];
        return stream.position;
      },
  read(stream, buffer, offset, length, position) {
        assert(offset >= 0);
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.read) {
          throw new FS.ErrnoError(28);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
        if (!seeking) stream.position += bytesRead;
        return bytesRead;
      },
  write(stream, buffer, offset, length, position, canOwn) {
        assert(offset >= 0);
        assert(buffer.subarray, 'FS.write expects a TypedArray');
        if (length < 0 || position < 0) {
          throw new FS.ErrnoError(28);
        }
        if (FS.isClosed(stream)) {
          throw new FS.ErrnoError(8);
        }
        if ((stream.flags & 2097155) === 0) {
          throw new FS.ErrnoError(8);
        }
        if (FS.isDir(stream.node.mode)) {
          throw new FS.ErrnoError(31);
        }
        if (!stream.stream_ops.write) {
          throw new FS.ErrnoError(28);
        }
        if (stream.seekable && stream.flags & 1024) {
          // seek to the end before writing in append mode
          FS.llseek(stream, 0, 2);
        }
        var seeking = typeof position != 'undefined';
        if (!seeking) {
          position = stream.position;
        } else if (!stream.seekable) {
          throw new FS.ErrnoError(70);
        }
        var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
        if (!seeking) stream.position += bytesWritten;
        return bytesWritten;
      },
  mmap(stream, length, position, prot, flags) {
        // User requests writing to file (prot & PROT_WRITE != 0).
        // Checking if we have permissions to write to the file unless
        // MAP_PRIVATE flag is set. According to POSIX spec it is possible
        // to write to file opened in read-only mode with MAP_PRIVATE flag,
        // as all modifications will be visible only in the memory of
        // the current process.
        if ((prot & 2) !== 0
            && (flags & 2) === 0
            && (stream.flags & 2097155) !== 2) {
          throw new FS.ErrnoError(2);
        }
        if ((stream.flags & 2097155) === 1) {
          throw new FS.ErrnoError(2);
        }
        if (!stream.stream_ops.mmap) {
          throw new FS.ErrnoError(43);
        }
        if (!length) {
          throw new FS.ErrnoError(28);
        }
        return stream.stream_ops.mmap(stream, length, position, prot, flags);
      },
  msync(stream, buffer, offset, length, mmapFlags) {
        assert(offset >= 0);
        if (!stream.stream_ops.msync) {
          return 0;
        }
        return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
      },
  ioctl(stream, cmd, arg) {
        if (!stream.stream_ops.ioctl) {
          throw new FS.ErrnoError(59);
        }
        return stream.stream_ops.ioctl(stream, cmd, arg);
      },
  readFile(path, opts = {}) {
        opts.flags = opts.flags || 0;
        opts.encoding = opts.encoding || 'binary';
        if (opts.encoding !== 'utf8' && opts.encoding !== 'binary') {
          abort(`Invalid encoding type "${opts.encoding}"`);
        }
        var stream = FS.open(path, opts.flags);
        var stat = FS.stat(path);
        var length = stat.size;
        var buf = new Uint8Array(length);
        FS.read(stream, buf, 0, length, 0);
        if (opts.encoding === 'utf8') {
          buf = UTF8ArrayToString(buf);
        }
        FS.close(stream);
        return buf;
      },
  writeFile(path, data, opts = {}) {
        opts.flags = opts.flags || 577;
        var stream = FS.open(path, opts.flags, opts.mode);
        data = FS_fileDataToTypedArray(data);
        FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
        FS.close(stream);
      },
  cwd:() => FS.currentPath,
  chdir(path) {
        var lookup = FS.lookupPath(path, { follow: true });
        if (lookup.node === null) {
          throw new FS.ErrnoError(44);
        }
        if (!FS.isDir(lookup.node.mode)) {
          throw new FS.ErrnoError(54);
        }
        var errCode = FS.nodePermissions(lookup.node, 'x');
        if (errCode) {
          throw new FS.ErrnoError(errCode);
        }
        FS.currentPath = lookup.path;
      },
  createDefaultDirectories() {
        FS.mkdir('/tmp');
        FS.mkdir('/home');
        FS.mkdir('/home/web_user');
      },
  createDefaultDevices() {
        // create /dev
        FS.mkdir('/dev');
        // setup /dev/null
        FS.registerDevice(FS.makedev(1, 3), {
          read: () => 0,
          write: (stream, buffer, offset, length, pos) => length,
          llseek: () => 0,
        });
        FS.mkdev('/dev/null', FS.makedev(1, 3));
        // setup /dev/tty and /dev/tty1
        // stderr needs to print output using err() rather than out()
        // so we register a second tty just for it.
        TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
        TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
        FS.mkdev('/dev/tty', FS.makedev(5, 0));
        FS.mkdev('/dev/tty1', FS.makedev(6, 0));
        // setup /dev/[u]random
        // use a buffer to avoid overhead of individual crypto calls per byte
        var randomBuffer = new Uint8Array(1024), randomLeft = 0;
        var randomByte = () => {
          if (randomLeft === 0) {
            randomFill(randomBuffer);
            randomLeft = randomBuffer.byteLength;
          }
          return randomBuffer[--randomLeft];
        };
        FS.createDevice('/dev', 'random', randomByte);
        FS.createDevice('/dev', 'urandom', randomByte);
        // we're not going to emulate the actual shm device,
        // just create the tmp dirs that reside in it commonly
        FS.mkdir('/dev/shm');
        FS.mkdir('/dev/shm/tmp');
      },
  createSpecialDirectories() {
        // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the
        // name of the stream for fd 6 (see test_unistd_ttyname)
        FS.mkdir('/proc');
        var proc_self = FS.mkdir('/proc/self');
        FS.mkdir('/proc/self/fd');
        FS.mount({
          mount() {
            var node = FS.createNode(proc_self, 'fd', 16895, 73);
            node.stream_ops = {
              llseek: MEMFS.stream_ops.llseek,
            };
            node.node_ops = {
              lookup(parent, name) {
                var fd = +name;
                var stream = FS.getStreamChecked(fd);
                var ret = {
                  parent: null,
                  mount: { mountpoint: 'fake' },
                  node_ops: { readlink: () => stream.path },
                  id: fd + 1,
                };
                ret.parent = ret; // make it look like a simple root node
                return ret;
              },
              readdir() {
                return Array.from(FS.streams.entries())
                  .filter(([k, v]) => v)
                  .map(([k, v]) => k.toString());
              }
            };
            return node;
          }
        }, {}, '/proc/self/fd');
      },
  createStandardStreams(input, output, error) {
        // TODO deprecate the old functionality of a single
        // input / output callback and that utilizes FS.createDevice
        // and instead require a unique set of stream ops
  
        // by default, we symlink the standard streams to the
        // default tty devices. however, if the standard streams
        // have been overwritten we create a unique device for
        // them instead.
        if (input) {
          FS.createDevice('/dev', 'stdin', input);
        } else {
          FS.symlink('/dev/tty', '/dev/stdin');
        }
        if (output) {
          FS.createDevice('/dev', 'stdout', null, output);
        } else {
          FS.symlink('/dev/tty', '/dev/stdout');
        }
        if (error) {
          FS.createDevice('/dev', 'stderr', null, error);
        } else {
          FS.symlink('/dev/tty1', '/dev/stderr');
        }
  
        // open default streams for the stdin, stdout and stderr devices
        var stdin = FS.open('/dev/stdin', 0);
        var stdout = FS.open('/dev/stdout', 1);
        var stderr = FS.open('/dev/stderr', 1);
        assert(stdin.fd === 0, `invalid handle for stdin (${stdin.fd})`);
        assert(stdout.fd === 1, `invalid handle for stdout (${stdout.fd})`);
        assert(stderr.fd === 2, `invalid handle for stderr (${stderr.fd})`);
      },
  staticInit() {
        FS.nameTable = new Array(4096);
  
        FS.mount(MEMFS, {}, '/');
  
        FS.createDefaultDirectories();
        FS.createDefaultDevices();
        FS.createSpecialDirectories();
  
        FS.filesystems = {
          'MEMFS': MEMFS,
        };
      },
  init(input, output, error) {
        assert(!FS.initialized, 'FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)');
        FS.initialized = true;
  
        // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
        input ??= Module['stdin'];
        output ??= Module['stdout'];
        error ??= Module['stderr'];
  
        FS.createStandardStreams(input, output, error);
      },
  quit() {
        FS.initialized = false;
        // force-flush all streams, so we get musl std streams printed out
        _fflush(0);
        // close all of our streams
        for (var stream of FS.streams) {
          if (stream) {
            FS.close(stream);
          }
        }
      },
  findObject(path, dontResolveLastLink) {
        var ret = FS.analyzePath(path, dontResolveLastLink);
        if (!ret.exists) {
          return null;
        }
        return ret.object;
      },
  analyzePath(path, dontResolveLastLink) {
        // operate from within the context of the symlink's target
        try {
          var lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          path = lookup.path;
        } catch (e) {
        }
        var ret = {
          isRoot: false, exists: false, error: 0, name: null, path: null, object: null,
          parentExists: false, parentPath: null, parentObject: null
        };
        try {
          var lookup = FS.lookupPath(path, { parent: true });
          ret.parentExists = true;
          ret.parentPath = lookup.path;
          ret.parentObject = lookup.node;
          ret.name = PATH.basename(path);
          lookup = FS.lookupPath(path, { follow: !dontResolveLastLink });
          ret.exists = true;
          ret.path = lookup.path;
          ret.object = lookup.node;
          ret.name = lookup.node.name;
          ret.isRoot = lookup.path === '/';
        } catch (e) {
          ret.error = e.errno;
        };
        return ret;
      },
  createPath(parent, path, canRead, canWrite) {
        parent = typeof parent == 'string' ? parent : FS.getPath(parent);
        var parts = path.split('/').reverse();
        while (parts.length) {
          var part = parts.pop();
          if (!part) continue;
          var current = PATH.join2(parent, part);
          try {
            FS.mkdir(current);
          } catch (e) {
            if (e.errno != 20) throw e;
          }
          parent = current;
        }
        return current;
      },
  createFile(parent, name, properties, canRead, canWrite) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(canRead, canWrite);
        return FS.create(path, mode);
      },
  createDataFile(parent, name, data, canRead, canWrite, canOwn) {
        var path = name;
        if (parent) {
          parent = typeof parent == 'string' ? parent : FS.getPath(parent);
          path = name ? PATH.join2(parent, name) : parent;
        }
        var mode = FS_getMode(canRead, canWrite);
        var node = FS.create(path, mode);
        if (data) {
          data = FS_fileDataToTypedArray(data);
          // make sure we can write to the file
          FS.chmod(node, mode | 146);
          var stream = FS.open(node, 577);
          FS.write(stream, data, 0, data.length, 0, canOwn);
          FS.close(stream);
          FS.chmod(node, mode);
        }
      },
  createDevice(parent, name, input, output) {
        var path = PATH.join2(typeof parent == 'string' ? parent : FS.getPath(parent), name);
        var mode = FS_getMode(!!input, !!output);
        FS.createDevice.major ??= 64;
        var dev = FS.makedev(FS.createDevice.major++, 0);
        // Create a fake device that a set of stream ops to emulate
        // the old behavior.
        FS.registerDevice(dev, {
          open(stream) {
            stream.seekable = false;
          },
          close(stream) {
            // flush any pending line data
            if (output?.buffer?.length) {
              output(10);
            }
          },
          read(stream, buffer, offset, length, pos /* ignored */) {
            var bytesRead = 0;
            for (var i = 0; i < length; i++) {
              var result;
              try {
                result = input();
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
              if (result === undefined && bytesRead === 0) {
                throw new FS.ErrnoError(6);
              }
              if (result === null || result === undefined) break;
              bytesRead++;
              buffer[offset+i] = result;
            }
            if (bytesRead) {
              stream.node.atime = Date.now();
            }
            return bytesRead;
          },
          write(stream, buffer, offset, length, pos) {
            for (var i = 0; i < length; i++) {
              try {
                output(buffer[offset+i]);
              } catch (e) {
                throw new FS.ErrnoError(29);
              }
            }
            if (length) {
              stream.node.mtime = stream.node.ctime = Date.now();
            }
            return i;
          }
        });
        return FS.mkdev(path, mode, dev);
      },
  forceLoadFile(obj) {
        if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
        if (globalThis.XMLHttpRequest) {
          abort("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
        } else { // Command-line.
          try {
            obj.contents = readBinary(obj.url);
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
        }
      },
  createLazyFile(parent, name, url, canRead, canWrite) {
        // Lazy chunked Uint8Array (implements get and length from Uint8Array).
        // Actual getting is abstracted away for eventual reuse.
        class LazyUint8Array {
          lengthKnown = false;
          chunks = []; // Loaded chunks. Index is the chunk number
          get(idx) {
            if (idx > this.length-1 || idx < 0) {
              return undefined;
            }
            var chunkOffset = idx % this.chunkSize;
            var chunkNum = (idx / this.chunkSize)|0;
            return this.getter(chunkNum)[chunkOffset];
          }
          setDataGetter(getter) {
            this.getter = getter;
          }
          cacheLength() {
            // Find length
            var xhr = new XMLHttpRequest();
            xhr.open('HEAD', url, false);
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort("Couldn't load " + url + ". Status: " + xhr.status);
            var datalength = Number(xhr.getResponseHeader("Content-length"));
            var header;
            var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
            var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
  
            var chunkSize = 1024*1024; // Chunk size in bytes
  
            if (!hasByteServing) chunkSize = datalength;
  
            // Function to get a range from the remote URL.
            var doXHR = (from, to) => {
              if (from > to) abort("invalid range (" + from + ", " + to + ") or no bytes requested!");
              if (to > datalength-1) abort("only " + datalength + " bytes available! programmer error!");
  
              // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, false);
              if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
  
              // Some hints to the browser that we want binary data.
              xhr.responseType = 'arraybuffer';
              if (xhr.overrideMimeType) {
                xhr.overrideMimeType('text/plain; charset=x-user-defined');
              }
  
              xhr.send(null);
              if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) abort("Couldn't load " + url + ". Status: " + xhr.status);
              if (xhr.response !== undefined) {
                return new Uint8Array(/** @type{Array<number>} */(xhr.response || []));
              }
              return intArrayFromString(xhr.responseText || '', true);
            };
            var lazyArray = this;
            lazyArray.setDataGetter((chunkNum) => {
              var start = chunkNum * chunkSize;
              var end = (chunkNum+1) * chunkSize - 1; // including this byte
              end = Math.min(end, datalength-1); // if datalength-1 is selected, this is the last block
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') {
                lazyArray.chunks[chunkNum] = doXHR(start, end);
              }
              if (typeof lazyArray.chunks[chunkNum] == 'undefined') abort('doXHR failed!');
              return lazyArray.chunks[chunkNum];
            });
  
            if (usesGzip || !datalength) {
              // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
              chunkSize = datalength = 1; // this will force getter(0)/doXHR do download the whole file
              datalength = this.getter(0).length;
              chunkSize = datalength;
              out("LazyFiles on gzip forces download of the whole file when length is accessed");
            }
  
            this._length = datalength;
            this._chunkSize = chunkSize;
            this.lengthKnown = true;
          }
          get length() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._length;
          }
          get chunkSize() {
            if (!this.lengthKnown) {
              this.cacheLength();
            }
            return this._chunkSize;
          }
        }
  
        if (globalThis.XMLHttpRequest) {
          if (!ENVIRONMENT_IS_WORKER) abort('Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc');
          var lazyArray = new LazyUint8Array();
          var properties = { isDevice: false, contents: lazyArray };
        } else {
          var properties = { isDevice: false, url: url };
        }
  
        var node = FS.createFile(parent, name, properties, canRead, canWrite);
        // This is a total hack, but I want to get this lazy file code out of the
        // core of MEMFS. If we want to keep this lazy file concept I feel it should
        // be its own thin LAZYFS proxying calls to MEMFS.
        if (properties.contents) {
          node.contents = properties.contents;
        } else if (properties.url) {
          node.contents = null;
          node.url = properties.url;
        }
        // Add a function that defers querying the file size until it is asked the first time.
        Object.defineProperties(node, {
          usedBytes: {
            get: function() { return this.contents.length; }
          }
        });
        // override each stream op with one that tries to force load the lazy file first
        var stream_ops = {};
        for (const [key, fn] of Object.entries(node.stream_ops)) {
          stream_ops[key] = (...args) => {
            FS.forceLoadFile(node);
            return fn(...args);
          };
        }
        function writeChunks(stream, buffer, offset, length, position) {
          var contents = stream.node.contents;
          if (position >= contents.length)
            return 0;
          var size = Math.min(contents.length - position, length);
          assert(size >= 0);
          if (contents.slice) { // normal array
            for (var i = 0; i < size; i++) {
              buffer[offset + i] = contents[position + i];
            }
          } else {
            for (var i = 0; i < size; i++) { // LazyUint8Array from sync binary XHR
              buffer[offset + i] = contents.get(position + i);
            }
          }
          return size;
        }
        // use a custom read function
        stream_ops.read = (stream, buffer, offset, length, position) => {
          FS.forceLoadFile(node);
          return writeChunks(stream, buffer, offset, length, position)
        };
        // use a custom mmap function
        stream_ops.mmap = (stream, length, position, prot, flags) => {
          FS.forceLoadFile(node);
          var ptr = mmapAlloc(length);
          if (!ptr) {
            throw new FS.ErrnoError(48);
          }
          writeChunks(stream, HEAP8, ptr, length, position);
          return { ptr, allocated: true };
        };
        node.stream_ops = stream_ops;
        return node;
      },
  };
  
  var SYSCALLS = {
  currentUmask:18,
  calculateAt(dirfd, path, allowEmpty) {
        if (PATH.isAbs(path)) {
          return path;
        }
        // relative path
        var dir;
        if (dirfd === -100) {
          dir = FS.cwd();
        } else {
          var dirstream = SYSCALLS.getStreamFromFD(dirfd);
          dir = dirstream.path;
        }
        if (path.length == 0) {
          if (!allowEmpty) {
            throw new FS.ErrnoError(44);;
          }
          return dir;
        }
        return dir + '/' + path;
      },
  writeStat(buf, stat) {
        HEAPU32[((buf)>>2)] = stat.dev;
        HEAPU32[(((buf)+(4))>>2)] = stat.mode;
        HEAPU32[(((buf)+(8))>>2)] = stat.nlink;
        HEAPU32[(((buf)+(12))>>2)] = stat.uid;
        HEAPU32[(((buf)+(16))>>2)] = stat.gid;
        HEAPU32[(((buf)+(20))>>2)] = stat.rdev;
        HEAP64[(((buf)+(24))>>3)] = BigInt(stat.size);
        HEAP32[(((buf)+(32))>>2)] = 4096;
        HEAP32[(((buf)+(36))>>2)] = stat.blocks;
        var atime = stat.atime.getTime();
        var mtime = stat.mtime.getTime();
        var ctime = stat.ctime.getTime();
        HEAP64[(((buf)+(40))>>3)] = BigInt(Math.floor(atime / 1000));
        HEAPU32[(((buf)+(48))>>2)] = (atime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(56))>>3)] = BigInt(Math.floor(mtime / 1000));
        HEAPU32[(((buf)+(64))>>2)] = (mtime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(72))>>3)] = BigInt(Math.floor(ctime / 1000));
        HEAPU32[(((buf)+(80))>>2)] = (ctime % 1000) * 1000 * 1000;
        HEAP64[(((buf)+(88))>>3)] = BigInt(stat.ino);
        return 0;
      },
  writeStatFs(buf, stats) {
        HEAPU32[(((buf)+(4))>>2)] = stats.bsize;
        HEAPU32[(((buf)+(60))>>2)] = stats.bsize;
        HEAP64[(((buf)+(8))>>3)] = BigInt(stats.blocks);
        HEAP64[(((buf)+(16))>>3)] = BigInt(stats.bfree);
        HEAP64[(((buf)+(24))>>3)] = BigInt(stats.bavail);
        HEAP64[(((buf)+(32))>>3)] = BigInt(stats.files);
        HEAP64[(((buf)+(40))>>3)] = BigInt(stats.ffree);
        HEAPU32[(((buf)+(48))>>2)] = stats.fsid;
        HEAPU32[(((buf)+(64))>>2)] = stats.flags;  // ST_NOSUID
        HEAPU32[(((buf)+(56))>>2)] = stats.namelen;
      },
  doMsync(addr, stream, len, flags, offset) {
        if (!FS.isFile(stream.node.mode)) {
          throw new FS.ErrnoError(43);
        }
        if (flags & 2) {
          // MAP_PRIVATE calls need not to be synced back to underlying fs
          return 0;
        }
        var buffer = HEAPU8.slice(addr, addr + len);
        FS.msync(stream, buffer, offset, len, flags);
      },
  getStreamFromFD(fd) {
        var stream = FS.getStreamChecked(fd);
        return stream;
      },
  varargs:undefined,
  getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
  };
  function _fd_close(fd) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.close(stream);
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  /** @param {number=} offset */
  var doReadv = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.read(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) break; // nothing more to read
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_read(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doReadv(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  
  var INT53_MAX = 9007199254740992;
  
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);
  function _fd_seek(fd, offset, whence, newOffset) {
    offset = bigintToI53Checked(offset);
  
  
  try {
  
      if (isNaN(offset)) return 22;
      var stream = SYSCALLS.getStreamFromFD(fd);
      FS.llseek(stream, offset, whence);
      HEAP64[((newOffset)>>3)] = BigInt(stream.position);
      if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null; // reset readdir state
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  ;
  }

  /** @param {number=} offset */
  var doWritev = (stream, iov, iovcnt, offset) => {
      var ret = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        var curr = FS.write(stream, HEAP8, ptr, len, offset);
        if (curr < 0) return -1;
        ret += curr;
        if (curr < len) {
          // No more space to write.
          break;
        }
        if (typeof offset != 'undefined') {
          offset += curr;
        }
      }
      return ret;
    };
  
  function _fd_write(fd, iov, iovcnt, pnum) {
  try {
  
      var stream = SYSCALLS.getStreamFromFD(fd);
      var num = doWritev(stream, iov, iovcnt);
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    } catch (e) {
    if (typeof FS == 'undefined' || !(e.name === 'ErrnoError')) throw e;
    return e.errno;
  }
  }
  

  function _seek(encoder, newPosition, clientData) {
      if (flacEncoderSeekCallback) {
        return flacEncoderSeekCallback(newPosition)
      }
      console.warn('flacEncoderSeekCallback not defined')
      return -1
    }

  function _tell(encoder, valuePointer, clientData) {
      if (flacEncoderTellCallback) {
        return flacEncoderTellCallback(valuePointer)
      }
      console.warn('flacEncoderTellCallback not defined')
      return -1
    }

  function _writeEncodedChunk(encoder, bufferPointer, length, samples, currentFrame, clientData) {
      if (flacEncoderWriteCallback) {
        return flacEncoderWriteCallback(bufferPointer, length, samples)
      }
      console.warn('flacEncoderWriteCallback not defined')
      return -1
    }





  FS.createPreloadedFile = FS_createPreloadedFile;
  FS.preloadFile = FS_preloadFile;
  FS.staticInit();;
// End JS library code

// include: postlibrary.js
// This file is included after the automatically-generated JS library code
// but before the wasm module is created.

{

  // Begin ATMODULES hooks
  if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];
if (Module['preloadPlugins']) preloadPlugins = Module['preloadPlugins'];
if (Module['print']) out = Module['print'];
if (Module['printErr']) err = Module['printErr'];
if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];
  // End ATMODULES hooks

  checkIncomingModuleAPI();

  if (Module['arguments']) arguments_ = Module['arguments'];
  if (Module['thisProgram']) thisProgram = Module['thisProgram'];

  // Assertions on removed incoming Module JS APIs.
  assert(typeof Module['memoryInitializerPrefixURL'] == 'undefined', 'Module.memoryInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['pthreadMainPrefixURL'] == 'undefined', 'Module.pthreadMainPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['cdInitializerPrefixURL'] == 'undefined', 'Module.cdInitializerPrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['filePackagePrefixURL'] == 'undefined', 'Module.filePackagePrefixURL option was removed, use Module.locateFile instead');
  assert(typeof Module['read'] == 'undefined', 'Module.read option was removed');
  assert(typeof Module['readAsync'] == 'undefined', 'Module.readAsync option was removed (modify readAsync in JS)');
  assert(typeof Module['readBinary'] == 'undefined', 'Module.readBinary option was removed (modify readBinary in JS)');
  assert(typeof Module['setWindowTitle'] == 'undefined', 'Module.setWindowTitle option was removed (modify emscripten_set_window_title in JS)');
  assert(typeof Module['TOTAL_MEMORY'] == 'undefined', 'Module.TOTAL_MEMORY has been renamed Module.INITIAL_MEMORY');
  assert(typeof Module['ENVIRONMENT'] == 'undefined', 'Module.ENVIRONMENT has been deprecated. To force the environment, use the ENVIRONMENT compile-time option (for example, -sENVIRONMENT=web or -sENVIRONMENT=node)');
  assert(typeof Module['STACK_SIZE'] == 'undefined', 'STACK_SIZE can no longer be set at runtime.  Use -sSTACK_SIZE at link time')
  // If memory is defined in wasm, the user can't provide it, or set INITIAL_MEMORY
  assert(typeof Module['wasmMemory'] == 'undefined', 'Use of `wasmMemory` detected.  Use -sIMPORTED_MEMORY to define wasmMemory externally');
  assert(typeof Module['INITIAL_MEMORY'] == 'undefined', 'Detected runtime INITIAL_MEMORY setting.  Use -sIMPORTED_MEMORY to define wasmMemory dynamically');

  if (Module['preInit']) {
    if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
    while (Module['preInit'].length > 0) {
      Module['preInit'].shift()();
    }
  }
  consumedModuleProp('preInit');
}

// Begin runtime exports
  var missingLibrarySymbols = [
  'writeI53ToI64',
  'writeI53ToI64Clamped',
  'writeI53ToI64Signaling',
  'writeI53ToU64Clamped',
  'writeI53ToU64Signaling',
  'readI53FromI64',
  'readI53FromU64',
  'convertI32PairToI53',
  'convertI32PairToI53Checked',
  'convertU32PairToI53',
  'stackAlloc',
  'getTempRet0',
  'setTempRet0',
  'createNamedFunction',
  'zeroMemory',
  'exitJS',
  'getHeapMax',
  'growMemory',
  'withStackSave',
  'inetPton4',
  'inetNtop4',
  'inetPton6',
  'inetNtop6',
  'readSockaddr',
  'writeSockaddr',
  'readEmAsmArgs',
  'jstoi_q',
  'getExecutableName',
  'autoResumeAudioContext',
  'getDynCaller',
  'dynCall',
  'handleException',
  'keepRuntimeAlive',
  'runtimeKeepalivePush',
  'runtimeKeepalivePop',
  'callUserCallback',
  'maybeExit',
  'asmjsMangle',
  'alignMemory',
  'HandleAllocator',
  'addOnInit',
  'addOnPostCtor',
  'addOnPreMain',
  'addOnExit',
  'STACK_SIZE',
  'STACK_ALIGN',
  'POINTER_SIZE',
  'ASSERTIONS',
  'ccall',
  'cwrap',
  'convertJsFunctionToWasm',
  'getEmptyTableSlot',
  'updateTableMap',
  'getFunctionAddress',
  'addFunction',
  'removeFunction',
  'stringToUTF8',
  'intArrayToString',
  'AsciiToString',
  'stringToAscii',
  'UTF16ToString',
  'stringToUTF16',
  'lengthBytesUTF16',
  'UTF32ToString',
  'stringToUTF32',
  'lengthBytesUTF32',
  'stringToNewUTF8',
  'stringToUTF8OnStack',
  'writeArrayToMemory',
  'registerKeyEventCallback',
  'maybeCStringToJsString',
  'findEventTarget',
  'getBoundingClientRect',
  'fillMouseEventData',
  'registerMouseEventCallback',
  'registerWheelEventCallback',
  'registerUiEventCallback',
  'registerFocusEventCallback',
  'fillDeviceOrientationEventData',
  'registerDeviceOrientationEventCallback',
  'fillDeviceMotionEventData',
  'registerDeviceMotionEventCallback',
  'screenOrientation',
  'fillOrientationChangeEventData',
  'registerOrientationChangeEventCallback',
  'fillFullscreenChangeEventData',
  'registerFullscreenChangeEventCallback',
  'JSEvents_requestFullscreen',
  'JSEvents_resizeCanvasForFullscreen',
  'registerRestoreOldStyle',
  'hideEverythingExceptGivenElement',
  'restoreHiddenElements',
  'setLetterbox',
  'softFullscreenResizeWebGLRenderTarget',
  'doRequestFullscreen',
  'fillPointerlockChangeEventData',
  'registerPointerlockChangeEventCallback',
  'registerPointerlockErrorEventCallback',
  'requestPointerLock',
  'fillVisibilityChangeEventData',
  'registerVisibilityChangeEventCallback',
  'registerTouchEventCallback',
  'fillGamepadEventData',
  'registerGamepadEventCallback',
  'registerBeforeUnloadEventCallback',
  'fillBatteryEventData',
  'registerBatteryEventCallback',
  'setCanvasElementSize',
  'getCanvasElementSize',
  'jsStackTrace',
  'getCallstack',
  'convertPCtoSourceLocation',
  'getEnvStrings',
  'checkWasiClock',
  'wasiRightsToMuslOFlags',
  'wasiOFlagsToMuslOFlags',
  'safeSetTimeout',
  'setImmediateWrapped',
  'safeRequestAnimationFrame',
  'clearImmediateWrapped',
  'registerPostMainLoop',
  'registerPreMainLoop',
  'getPromise',
  'makePromise',
  'idsToPromises',
  'makePromiseCallback',
  'ExceptionInfo',
  'findMatchingCatch',
  'incrementUncaughtExceptionCount',
  'decrementUncaughtExceptionCount',
  'Browser_asyncPrepareDataCounter',
  'isLeapYear',
  'ydayFromDate',
  'arraySum',
  'addDays',
  'getSocketFromFD',
  'getSocketAddress',
  'FS_mkdirTree',
  '_setNetworkCallback',
  'heapObjectForWebGLType',
  'toTypedArrayIndex',
  'webgl_enable_ANGLE_instanced_arrays',
  'webgl_enable_OES_vertex_array_object',
  'webgl_enable_WEBGL_draw_buffers',
  'webgl_enable_WEBGL_multi_draw',
  'webgl_enable_EXT_polygon_offset_clamp',
  'webgl_enable_EXT_clip_control',
  'webgl_enable_WEBGL_polygon_mode',
  'emscriptenWebGLGet',
  'computeUnpackAlignedImageSize',
  'colorChannelsInGlTextureFormat',
  'emscriptenWebGLGetTexPixelData',
  'emscriptenWebGLGetUniform',
  'webglGetUniformLocation',
  'webglPrepareUniformLocationsBeforeFirstUse',
  'webglGetLeftBracePos',
  'emscriptenWebGLGetVertexAttrib',
  '__glGetActiveAttribOrUniform',
  'writeGLArray',
  'registerWebGlEventCallback',
  'runAndAbortIfError',
  'ALLOC_NORMAL',
  'ALLOC_STACK',
  'allocate',
  'writeStringToMemory',
  'writeAsciiToMemory',
  'allocateUTF8',
  'allocateUTF8OnStack',
  'demangle',
  'stackTrace',
  'getNativeTypeSize',
];
missingLibrarySymbols.forEach(missingLibrarySymbol)

  var unexportedSymbols = [
  'run',
  'out',
  'err',
  'callMain',
  'abort',
  'wasmExports',
  'writeStackCookie',
  'checkStackCookie',
  'INT53_MAX',
  'INT53_MIN',
  'bigintToI53Checked',
  'HEAP8',
  'HEAP16',
  'HEAPU16',
  'HEAPF64',
  'HEAP64',
  'HEAPU64',
  'stackSave',
  'stackRestore',
  'ptrToString',
  'abortOnCannotGrowMemory',
  'ENV',
  'ERRNO_CODES',
  'strError',
  'DNS',
  'Protocols',
  'Sockets',
  'timers',
  'warnOnce',
  'readEmAsmArgsArray',
  'asyncLoad',
  'mmapAlloc',
  'wasmTable',
  'wasmMemory',
  'getUniqueRunDependency',
  'noExitRuntime',
  'addRunDependency',
  'removeRunDependency',
  'addOnPreRun',
  'addOnPostRun',
  'freeTableIndexes',
  'functionsInTableMap',
  'setValue',
  'getValue',
  'PATH',
  'PATH_FS',
  'UTF8Decoder',
  'UTF8ArrayToString',
  'UTF8ToString',
  'stringToUTF8Array',
  'lengthBytesUTF8',
  'intArrayFromString',
  'UTF16Decoder',
  'JSEvents',
  'specialHTMLTargets',
  'findCanvasEventTarget',
  'currentFullscreenStrategy',
  'restoreOldWindowedStyle',
  'UNWIND_CACHE',
  'ExitStatus',
  'doReadv',
  'doWritev',
  'initRandomFill',
  'randomFill',
  'emSetImmediate',
  'emClearImmediate_deps',
  'emClearImmediate',
  'promiseMap',
  'uncaughtExceptionCount',
  'exceptionCaught',
  'Browser',
  'requestFullscreen',
  'requestFullScreen',
  'setCanvasSize',
  'getUserMedia',
  'createContext',
  'getPreloadedImageData__data',
  'wget',
  'MONTH_DAYS_REGULAR',
  'MONTH_DAYS_LEAP',
  'MONTH_DAYS_REGULAR_CUMULATIVE',
  'MONTH_DAYS_LEAP_CUMULATIVE',
  'SYSCALLS',
  'preloadPlugins',
  'FS_createPreloadedFile',
  'FS_preloadFile',
  'FS_modeStringToFlags',
  'FS_getMode',
  'FS_fileDataToTypedArray',
  'FS_stdin_getChar_buffer',
  'FS_stdin_getChar',
  'FS_unlink',
  'FS_createPath',
  'FS_createDevice',
  'FS_readFile',
  'FS',
  'FS_root',
  'FS_mounts',
  'FS_devices',
  'FS_streams',
  'FS_nextInode',
  'FS_nameTable',
  'FS_currentPath',
  'FS_initialized',
  'FS_ignorePermissions',
  'FS_filesystems',
  'FS_syncFSRequests',
  'FS_lookupPath',
  'FS_getPath',
  'FS_hashName',
  'FS_hashAddNode',
  'FS_hashRemoveNode',
  'FS_lookupNode',
  'FS_createNode',
  'FS_destroyNode',
  'FS_isRoot',
  'FS_isMountpoint',
  'FS_isFile',
  'FS_isDir',
  'FS_isLink',
  'FS_isChrdev',
  'FS_isBlkdev',
  'FS_isFIFO',
  'FS_isSocket',
  'FS_flagsToPermissionString',
  'FS_nodePermissions',
  'FS_mayLookup',
  'FS_mayCreate',
  'FS_mayDelete',
  'FS_mayOpen',
  'FS_checkOpExists',
  'FS_nextfd',
  'FS_getStreamChecked',
  'FS_getStream',
  'FS_createStream',
  'FS_closeStream',
  'FS_dupStream',
  'FS_doSetAttr',
  'FS_chrdev_stream_ops',
  'FS_major',
  'FS_minor',
  'FS_makedev',
  'FS_registerDevice',
  'FS_getDevice',
  'FS_getMounts',
  'FS_syncfs',
  'FS_mount',
  'FS_unmount',
  'FS_lookup',
  'FS_mknod',
  'FS_statfs',
  'FS_statfsStream',
  'FS_statfsNode',
  'FS_create',
  'FS_mkdir',
  'FS_mkdev',
  'FS_symlink',
  'FS_rename',
  'FS_rmdir',
  'FS_readdir',
  'FS_readlink',
  'FS_stat',
  'FS_fstat',
  'FS_lstat',
  'FS_doChmod',
  'FS_chmod',
  'FS_lchmod',
  'FS_fchmod',
  'FS_doChown',
  'FS_chown',
  'FS_lchown',
  'FS_fchown',
  'FS_doTruncate',
  'FS_truncate',
  'FS_ftruncate',
  'FS_utime',
  'FS_open',
  'FS_close',
  'FS_isClosed',
  'FS_llseek',
  'FS_read',
  'FS_write',
  'FS_mmap',
  'FS_msync',
  'FS_ioctl',
  'FS_writeFile',
  'FS_cwd',
  'FS_chdir',
  'FS_createDefaultDirectories',
  'FS_createDefaultDevices',
  'FS_createSpecialDirectories',
  'FS_createStandardStreams',
  'FS_staticInit',
  'FS_init',
  'FS_quit',
  'FS_findObject',
  'FS_analyzePath',
  'FS_createFile',
  'FS_createDataFile',
  'FS_forceLoadFile',
  'FS_createLazyFile',
  'MEMFS',
  'TTY',
  'PIPEFS',
  'SOCKFS',
  'tempFixedLengthArray',
  'miniTempWebGLFloatBuffers',
  'miniTempWebGLIntBuffers',
  'GL',
  'AL',
  'GLUT',
  'EGL',
  'GLEW',
  'IDBStore',
  'SDL',
  'SDL_gfx',
  'print',
  'printErr',
  'jstoi_s',
];
unexportedSymbols.forEach(unexportedRuntimeSymbol);

  // End runtime exports
  // Begin JS library exports
  // End JS library exports

// end include: postlibrary.js

function checkIncomingModuleAPI() {
  ignoredModuleProp('fetchSettings');
  ignoredModuleProp('logReadFiles');
  ignoredModuleProp('loadSplitModule');
  ignoredModuleProp('onMalloc');
  ignoredModuleProp('onRealloc');
  ignoredModuleProp('onFree');
  ignoredModuleProp('onSbrkGrow');
}

// Imports from the Wasm binary.
var _create_encoder = Module['_create_encoder'] = makeInvalidEarlyAccess('_create_encoder');
var _encode_chunk = Module['_encode_chunk'] = makeInvalidEarlyAccess('_encode_chunk');
var _get_encoder_state = Module['_get_encoder_state'] = makeInvalidEarlyAccess('_get_encoder_state');
var _get_input_buffer_pointer = Module['_get_input_buffer_pointer'] = makeInvalidEarlyAccess('_get_input_buffer_pointer');
var _finish_encoding = Module['_finish_encoding'] = makeInvalidEarlyAccess('_finish_encoding');
var _fflush = makeInvalidEarlyAccess('_fflush');
var _emscripten_stack_get_end = makeInvalidEarlyAccess('_emscripten_stack_get_end');
var _emscripten_stack_get_base = makeInvalidEarlyAccess('_emscripten_stack_get_base');
var _strerror = makeInvalidEarlyAccess('_strerror');
var _emscripten_stack_init = makeInvalidEarlyAccess('_emscripten_stack_init');
var _emscripten_stack_get_free = makeInvalidEarlyAccess('_emscripten_stack_get_free');
var __emscripten_stack_restore = makeInvalidEarlyAccess('__emscripten_stack_restore');
var __emscripten_stack_alloc = makeInvalidEarlyAccess('__emscripten_stack_alloc');
var _emscripten_stack_get_current = makeInvalidEarlyAccess('_emscripten_stack_get_current');
var memory = makeInvalidEarlyAccess('memory');
var __indirect_function_table = makeInvalidEarlyAccess('__indirect_function_table');
var wasmMemory = makeInvalidEarlyAccess('wasmMemory');

function assignWasmExports(wasmExports) {
  assert(typeof wasmExports['create_encoder'] != 'undefined', 'missing Wasm export: create_encoder');
  assert(typeof wasmExports['encode_chunk'] != 'undefined', 'missing Wasm export: encode_chunk');
  assert(typeof wasmExports['get_encoder_state'] != 'undefined', 'missing Wasm export: get_encoder_state');
  assert(typeof wasmExports['get_input_buffer_pointer'] != 'undefined', 'missing Wasm export: get_input_buffer_pointer');
  assert(typeof wasmExports['finish_encoding'] != 'undefined', 'missing Wasm export: finish_encoding');
  assert(typeof wasmExports['fflush'] != 'undefined', 'missing Wasm export: fflush');
  assert(typeof wasmExports['emscripten_stack_get_end'] != 'undefined', 'missing Wasm export: emscripten_stack_get_end');
  assert(typeof wasmExports['emscripten_stack_get_base'] != 'undefined', 'missing Wasm export: emscripten_stack_get_base');
  assert(typeof wasmExports['strerror'] != 'undefined', 'missing Wasm export: strerror');
  assert(typeof wasmExports['emscripten_stack_init'] != 'undefined', 'missing Wasm export: emscripten_stack_init');
  assert(typeof wasmExports['emscripten_stack_get_free'] != 'undefined', 'missing Wasm export: emscripten_stack_get_free');
  assert(typeof wasmExports['_emscripten_stack_restore'] != 'undefined', 'missing Wasm export: _emscripten_stack_restore');
  assert(typeof wasmExports['_emscripten_stack_alloc'] != 'undefined', 'missing Wasm export: _emscripten_stack_alloc');
  assert(typeof wasmExports['emscripten_stack_get_current'] != 'undefined', 'missing Wasm export: emscripten_stack_get_current');
  assert(typeof wasmExports['memory'] != 'undefined', 'missing Wasm export: memory');
  assert(typeof wasmExports['__indirect_function_table'] != 'undefined', 'missing Wasm export: __indirect_function_table');
  _create_encoder = Module['_create_encoder'] = createExportWrapper('create_encoder', 5);
  _encode_chunk = Module['_encode_chunk'] = createExportWrapper('encode_chunk', 1);
  _get_encoder_state = Module['_get_encoder_state'] = createExportWrapper('get_encoder_state', 0);
  _get_input_buffer_pointer = Module['_get_input_buffer_pointer'] = createExportWrapper('get_input_buffer_pointer', 2);
  _finish_encoding = Module['_finish_encoding'] = createExportWrapper('finish_encoding', 0);
  _fflush = createExportWrapper('fflush', 1);
  _emscripten_stack_get_end = wasmExports['emscripten_stack_get_end'];
  _emscripten_stack_get_base = wasmExports['emscripten_stack_get_base'];
  _strerror = createExportWrapper('strerror', 1);
  _emscripten_stack_init = wasmExports['emscripten_stack_init'];
  _emscripten_stack_get_free = wasmExports['emscripten_stack_get_free'];
  __emscripten_stack_restore = wasmExports['_emscripten_stack_restore'];
  __emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'];
  _emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'];
  memory = wasmMemory = wasmExports['memory'];
  __indirect_function_table = wasmExports['__indirect_function_table'];
}

var wasmImports = {
  /** @export */
  __assert_fail: ___assert_fail,
  /** @export */
  _abort_js: __abort_js,
  /** @export */
  emscripten_resize_heap: _emscripten_resize_heap,
  /** @export */
  fd_close: _fd_close,
  /** @export */
  fd_read: _fd_read,
  /** @export */
  fd_seek: _fd_seek,
  /** @export */
  fd_write: _fd_write,
  /** @export */
  seek: _seek,
  /** @export */
  tell: _tell,
  /** @export */
  writeEncodedChunk: _writeEncodedChunk
};


// include: postamble.js
// === Auto-generated postamble setup entry stuff ===

var calledRun;

function stackCheckInit() {
  // This is normally called automatically during __wasm_call_ctors but need to
  // get these values before even running any of the ctors so we call it redundantly
  // here.
  _emscripten_stack_init();
  // TODO(sbc): Move writeStackCookie to native to to avoid this.
  writeStackCookie();
}

function run() {

  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }

  stackCheckInit();

  preRun();

  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    dependenciesFulfilled = run;
    return;
  }

  function doRun() {
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    assert(!calledRun);
    calledRun = true;
    Module['calledRun'] = true;

    if (ABORT) return;

    initRuntime();

    readyPromiseResolve?.(Module);
    Module['onRuntimeInitialized']?.();
    consumedModuleProp('onRuntimeInitialized');

    assert(!Module['_main'], 'compiled without a main, but one is present. if you added it from JS, use Module["onRuntimeInitialized"]');

    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(() => {
      setTimeout(() => Module['setStatus'](''), 1);
      doRun();
    }, 1);
  } else
  {
    doRun();
  }
  checkStackCookie();
}

function checkUnflushedContent() {
  // Compiler settings do not allow exiting the runtime, so flushing
  // the streams is not possible. but in ASSERTIONS mode we check
  // if there was something to flush, and if so tell the user they
  // should request that the runtime be exitable.
  // Normally we would not even include flush() at all, but in ASSERTIONS
  // builds we do so just for this check, and here we see if there is any
  // content to flush, that is, we check if there would have been
  // something a non-ASSERTIONS build would have not seen.
  // How we flush the streams depends on whether we are in SYSCALLS_REQUIRE_FILESYSTEM=0
  // mode (which has its own special function for this; otherwise, all
  // the code is inside libc)
  var oldOut = out;
  var oldErr = err;
  var has = false;
  out = err = (x) => {
    has = true;
  }
  try { // it doesn't matter if it fails
    _fflush(0);
    // also flush in the JS FS layer
    for (var name of ['stdout', 'stderr']) {
      var info = FS.analyzePath('/dev/' + name);
      if (!info) return;
      var stream = info.object;
      var rdev = stream.rdev;
      var tty = TTY.ttys[rdev];
      if (tty?.output?.length) {
        has = true;
      }
    }
  } catch(e) {}
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.');
  }
}

var wasmExports;

// In modularize mode the generated code is within a factory function so we
// can use await here (since it's not top-level-await).
wasmExports = await (createWasm());

run();

// end include: postamble.js

// include: postamble_modularize.js
// In MODULARIZE mode we wrap the generated code in a factory function
// and return either the Module itself, or a promise of the module.
//
// We assign to the `moduleRtn` global here and configure closure to see
// this as an extern so it won't get minified.

if (runtimeInitialized)  {
  moduleRtn = Module;
} else {
  // Set up the promise that indicates the Module is initialized
  moduleRtn = new Promise((resolve, reject) => {
    readyPromiseResolve = resolve;
    readyPromiseReject = reject;
  });
}

// Assertion for attempting to access module properties on the incoming
// moduleArg.  In the past we used this object as the prototype of the module
// and assigned properties to it, but now we return a distinct object.  This
// keeps the instance private until it is ready (i.e the promise has been
// resolved).
for (const prop of Object.keys(Module)) {
  if (!(prop in moduleArg)) {
    Object.defineProperty(moduleArg, prop, {
      configurable: true,
      get() {
        abort(`Access to module property ('${prop}') is no longer possible via the module constructor argument; Instead, use the result of the module constructor.`)
      }
    });
  }
}
// end include: postamble_modularize.js



  return moduleRtn;
}

// Export using a UMD style export, or ES6 exports if selected
export default createModule;

