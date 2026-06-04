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
  if (currentNodeVersion < TARGET_NOT_SUPPORTED) {
    throw new Error('not compiled for this environment (did you build to HTML and try to run it not on the web, or set ENVIRONMENT to something - like node - and run it someplace else - like on the web?)');
  }
  if (currentNodeVersion < 2147483647) {
    throw new Error(`This emscripten-generated code requires node v${ packedVersionToHumanReadable(2147483647) } (detected v${packedVersionToHumanReadable(currentNodeVersion)})`);
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
  if (currentFirefoxVersion < 114) {
    throw new Error(`This emscripten-generated code requires Firefox v114 (detected v${currentFirefoxVersion})`);
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

// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() running directly in a worker. (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)

// The way we signal to a worker that it is hosting a pthread is to construct
// it with a specific name.
var ENVIRONMENT_IS_PTHREAD = ENVIRONMENT_IS_WORKER && globalThis.name?.startsWith('em-pthread')

if (ENVIRONMENT_IS_PTHREAD) {
  assert(!globalThis.moduleLoaded, 'module should only be loaded once on each pthread worker');
  globalThis.moduleLoaded = true;
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

if (ENVIRONMENT_IS_SHELL) {

  readBinary = (f) => {
    if (globalThis.readbuffer) {
      return new Uint8Array(readbuffer(f));
    }
    let data = read(f, 'binary');
    assert(typeof data == 'object');
    return data;
  };

  readAsync = async (f) => readBinary(f);

  globalThis.clearTimeout ??= (id) => {};

  // v8 uses `arguments_` whereas spidermonkey uses `scriptArgs`
  arguments_ = globalThis.arguments || globalThis.scriptArgs;

  if (globalThis.quit) {
    quit_ = (status, toThrow) => {
      // Unlike node which has process.exitCode, d8 has no such mechanism. So we
      // have no way to set the exit code and then let the program exit with
      // that code when it naturally stops running (say, when all setTimeouts
      // have completed). For that reason, we must call `quit` - the only way to
      // set the exit code - but quit also halts immediately.  To increase
      // consistency with node (and the web) we schedule the actual quit call
      // using a setTimeout to give the current stack and any exception handlers
      // a chance to run.  This enables features such as addOnPostRun (which
      // expected to be able to run code after main returns).
      setTimeout(() => {
        if (!(toThrow instanceof ExitStatus)) {
          let toLog = toThrow;
          if (toThrow && typeof toThrow == 'object' && toThrow.stack) {
            toLog = [toThrow, toThrow.stack];
          }
          err(`exiting due to exception: ${toLog}`);
        }
        quit(status);
      });
      throw toThrow;
    };
  }

  if (globalThis.print) {
    // Use `print` to implement console.log/error/warn as needed.
    globalThis.console ??= /** @type{!Console} */({});
    console.log ??= /** @type{!function(this:Console, ...*): undefined} */ (print);
    console.warn ??= console.error ??= /** @type{!function(this:Console, ...*): undefined} */ (globalThis.printErr ?? print);
  }

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
assert(
  ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER || ENVIRONMENT_IS_NODE, 'pthreads do not work in this environment yet (need Web Workers, or an alternative to them)');

assert(!ENVIRONMENT_IS_WEB, 'web environment detected but not enabled at build time (add `web` to `-sENVIRONMENT` to enable)');

assert(!ENVIRONMENT_IS_NODE, 'node environment detected but not enabled at build time (add `node` to `-sENVIRONMENT` to enable)');

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

// For sending to workers.
var wasmModule;

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
  if (ENVIRONMENT_IS_PTHREAD) {
    return;
  }
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

/**
 * Override `err`/`out`/`dbg` to report thread / worker information
 */
function initWorkerLogging() {
  function getLogPrefix() {
    var t = 0;
    if (runtimeInitialized && typeof _pthread_self != 'undefined'
    ) {
      t = _pthread_self();
    }
    return `w:${workerID},t:${ptrToString(t)}:`;
  }

  // Prefix all dbg() messages with the calling thread info.
  var origDbg = dbg;
  dbg = (...args) => origDbg(getLogPrefix(), ...args);
}

initWorkerLogging();

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

// include: runtime_pthread.js
// Pthread Web Worker handling code.
// This code runs only on pthread web workers and handles pthread setup
// and communication with the main thread via postMessage.

// Unique ID of the current pthread worker (zero on non-pthread-workers
// including the main thread).
var workerID = 0;

var startWorker;

if (ENVIRONMENT_IS_PTHREAD) {
  // Thread-local guard variable for one-time init of the JS state
  var initializedJS = false;

  // Turn unhandled rejected promises into errors so that the main thread will be
  // notified about them.
  self.onunhandledrejection = (e) => { throw e.reason || e; };

  function handleMessage(e) {
    try {
      var msgData = e['data'];
      //dbg('msgData: ' + Object.keys(msgData));
      var cmd = msgData.cmd;
      if (cmd === 'load') { // Preload command that is called once per worker to parse and load the Emscripten code.
        workerID = msgData.workerID;

        // Until we initialize the runtime, queue up any further incoming messages.
        let messageQueue = [];
        self.onmessage = (e) => messageQueue.push(e);

        // And add a callback for when the runtime is initialized.
        startWorker = () => {
          // Notify the main thread that this thread has loaded.
          postMessage({ cmd: 'loaded' });
          // Process any messages that were queued before the thread was ready.
          for (let msg of messageQueue) {
            handleMessage(msg);
          }
          // Restore the real message handler.
          self.onmessage = handleMessage;
        };

        // Use `const` here to ensure that the variable is scoped only to
        // that iteration, allowing safe reference from a closure.
        for (const handler of msgData.handlers) {
          // If the main module has a handler for a certain event, but no
          // handler exists on the pthread worker, then proxy that handler
          // back to the main thread.
          if (!Module[handler] || Module[handler].proxy) {
            Module[handler] = (...args) => {
              postMessage({ cmd: 'callHandler', handler, args: args });
            }
            // Rebind the out / err handlers if needed
            if (handler == 'print') out = Module[handler];
            if (handler == 'printErr') err = Module[handler];
          }
        }

        wasmMemory = msgData.wasmMemory;
        updateMemoryViews();

        wasmModule = msgData.wasmModule;
        createWasm();
        run();
      } else if (cmd === 'run') {
        assert(msgData.pthread_ptr);
        // Call inside JS module to set up the stack frame for this pthread in JS module scope.
        // This needs to be the first thing that we do, as we cannot call to any C/C++ functions
        // until the thread stack is initialized.
        establishStackSpace(msgData.pthread_ptr);

        // Pass the thread address to wasm to store it for fast access.
        __emscripten_thread_init(msgData.pthread_ptr, /*is_main=*/0, /*is_runtime=*/0, /*can_block=*/1, 0, 0);

        PThread.threadInitTLS();

        // Await mailbox notifications with `Atomics.waitAsync` so we can start
        // using the fast `Atomics.notify` notification path.
        __emscripten_thread_mailbox_await(msgData.pthread_ptr);

        if (!initializedJS) {
          initializedJS = true;
        }

        try {
          invokeEntryPoint(msgData.start_routine, msgData.arg);
        } catch(ex) {
          if (ex != 'unwind') {
            // The pthread "crashed".  Do not call `_emscripten_thread_exit` (which
            // would make this thread joinable).  Instead, re-throw the exception
            // and let the top level handler propagate it back to the main thread.
            throw ex;
          }
        }
      } else if (msgData.target === 'setimmediate') {
        // no-op
      } else if (cmd === 'checkMailbox') {
        if (initializedJS) {
          checkMailbox();
        }
      } else if (cmd) {
        // The received message looks like something that should be handled by this message
        // handler, (since there is a cmd field present), but is not one of the
        // recognized commands:
        err(`worker: received unknown command ${cmd}`);
        err(msgData);
      }
    } catch(ex) {
      err(`worker: onmessage() captured an uncaught exception: ${ex}`);
      if (ex?.stack) err(ex.stack);
      __emscripten_thread_crashed();
      throw ex;
    }
  };

  self.onmessage = handleMessage;

} // ENVIRONMENT_IS_PTHREAD
// end include: runtime_pthread.js
// Memory management

var runtimeInitialized = false;



function updateMemoryViews() {
  var b = wasmMemory.buffer;
  HEAP8 = new Int8Array(b);
  HEAP16 = new Int16Array(b);
  HEAPU8 = new Uint8Array(b);
  HEAPU16 = new Uint16Array(b);
  HEAP32 = new Int32Array(b);
  HEAPU32 = new Uint32Array(b);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(b);
  HEAPF64 = new Float64Array(b);
  HEAP64 = new BigInt64Array(b);
  HEAPU64 = new BigUint64Array(b);
}

// In non-standalone/normal mode, we create the memory here.
// include: runtime_init_memory.js
// Create the wasm memory. (Note: this only applies if IMPORTED_MEMORY is defined)

// check for full engine support (use string 'subarray' to avoid closure compiler confusion)

function initMemory() {

  if ((ENVIRONMENT_IS_PTHREAD)) { return }

  if (Module['wasmMemory']) {
    wasmMemory = Module['wasmMemory'];
  } else
  {
    var INITIAL_MEMORY = Module['INITIAL_MEMORY'] || 16777216;

    assert(INITIAL_MEMORY >= 65536, `INITIAL_MEMORY should be larger than STACK_SIZE, was ${INITIAL_MEMORY}! (STACK_SIZE=65536)`);
    /** @suppress {checkTypes} */
    wasmMemory = new WebAssembly.Memory({
      'initial': INITIAL_MEMORY / 65536,
      'maximum': INITIAL_MEMORY / 65536,
      'shared': true,
    });
  }

  updateMemoryViews();
}

// end include: runtime_init_memory.js

// include: memoryprofiler.js
// end include: memoryprofiler.js
// end include: runtime_common.js
assert(globalThis.Int32Array && globalThis.Float64Array && Int32Array.prototype.subarray && Int32Array.prototype.set,
       'JS engine does not provide full typed array support');

function preRun() {
  assert(!ENVIRONMENT_IS_PTHREAD); // PThreads reuse the runtime from the main thread.
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

  if (ENVIRONMENT_IS_PTHREAD) return startWorker();

  checkStackCookie();

  // No ATINITS hooks

  wasmExports['__wasm_call_ctors']();

  // No ATPOSTCTORS hooks
}

function postRun() {
  checkStackCookie();
  if ((ENVIRONMENT_IS_PTHREAD)) { return; } // PThreads reuse the runtime from the main thread.

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

// show errors on likely calls to FS when it was not included
function fsMissing() {
  abort('Filesystem support (FS) was not included. The problem is that you are using files from JS, but files were not used from C/C++, so filesystem support was not auto-included. You can force-include filesystem support with -sFORCE_FILESYSTEM');
}
var FS = {
  init: fsMissing,
  createDataFile: fsMissing,
  createPreloadedFile: fsMissing,
  createLazyFile: fsMissing,
  open: fsMissing,
  mkdev: fsMissing,
  registerDevice:  fsMissing,
  analyzePath: fsMissing,
  ErrnoError: fsMissing,
};


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
  return binaryDecode(' asm   ö%` `  ` ``|`~~`` |` `~`|``~` `}}`|||`|~``|||`||`||``|` `| `|`|`|`|``~`~` `~ `~~ `~~|` Âenvmemorywasi_snapshot_preview1fd_write envemscripten_get_now env\r__assert_fail wasi_snapshot_preview1clock_time_get 	env&_emscripten_notify_mailbox_postmessage env!emscripten_check_blocking_allowed env%_emscripten_receive_on_main_thread_js \nenv_emscripten_init_main_thread_js  env _emscripten_thread_mailbox_await  env _emscripten_thread_set_strongref  env!emscripten_exit_with_live_runtime env	_abort_js wasi_snapshot_preview1fd_close wasi_snapshot_preview1fd_seek envemscripten_resize_heap env_emscripten_thread_cleanup  envexit   \r\r\r\r\r\r\r\r\r\r\r\r\r   \r\r                               \r            \r\r\r       \r ! \r\r\r\r""#      $ \rp?AA  A AA A A A A A A A__wasm_call_ctors getInstantaneousPeaks getHeldPeaks \rgetInputArray init lanczosInterpolatedPeak _emscripten_tls_init pthread_self (_emscripten_thread_init __set_thread_state #_emscripten_thread_crashed Ãfflush &_emscripten_run_js_on_main_thread_done ¸!_emscripten_run_js_on_main_thread ¹_emscripten_thread_free_data _emscripten_thread_exit __indirect_function_table strerror  _emscripten_check_mailbox aemscripten_stack_get_end emscripten_stack_get_base emscripten_stack_init emscripten_stack_set_limits emscripten_stack_get_free _emscripten_stack_restore _emscripten_stack_alloc emscripten_stack_get_current 	+ A102op¢¬­±²³µ¼·º»ëìôö\nä Â   $  A Aü      ~ @@@AÔÔA AþH  AA$A Aü  AA A :ü A°ºA Aìü A ½A A´ü AÔÔAþ AÔÔAþ  AÔÔABþ ü	ü		 #Aj$ ||}# Ak! $    8@@ *»A ·aAqE\r  C  ?8 *»D-DTû!	@¢!  ¯  £¶8 *! Aj$  ¯}# A k!   $   AA 6  A6  A6@@  (AHAqE\r    (·D      Ð?¢¶8  (!  A  6  A 6@@  (  (HAqE\r    (AkAj²  *8  *   *C  @@ !  (  (Atj 8     (Aj6   (!  (  (AkAtj 6     (Aj6   (!  A j$   A (¬½  A (°½  A (´½ ³}}# A k! $    6  6  6  6 (!A  6¸½  (!A  6¼½  (!A  6À½  (!A  6Ä½ A (¸½ A !	A  	6È½ A (¸½ A !\nA  \n6¬½ A (¸½ A !A  6°½ A (¸½ A (Ä½ lA !A  6´½  !\rA  \r6Ì½ AA !A  6Ð½  A 6@@ (AHAqE\r A 6@@ (AHAqE\rA (Ì½  (Atj(  (Atj* !A (Ð½  (Atj!   * 8   (Aj6  A 6@@ (AHAqE\rA (Ð½  (Atj* !A (Ì½  (Atj(  (Atj!  *  8   (Aj6   (Aj6 A (¸½ A !A  6Ô½  A 6 @@ ( A (¸½ HAqE\rAA !A (Ô½  ( Atj 6   ( Aj6   A j$ «		}}}}# A0k!   $ @A (¤½ A (¼½ NAqE\r   A 6,@@  (,A (¸½ HAqE\r@A (È½   (,Atj* C  ?^AqE\r   A (È½   (,Atj* »9 Aí   ¢ A (È½   (,Atj* !A (¬½   (,Atj 8 @A (°½   (,Atj* A (¬½   (,Atj* ]AqE\r A (¬½   (,Atj* !A (°½   (,Atj 8 A !A  6¨½ A (È½   (,AtjA ²8 A !A  6¤½     (,Aj6, @A (¨½ A (À½ NAqE\r   A 6(@@  ((A (¸½ HAqE\rA (¬½   ((Atj* !A (°½   ((Atj 8 A !A  6¨½     ((Aj6(   A 6$@@  ($A (Ä½ HAqE\r  A 6 @@  ( A (¸½ HAqE\rA ! (´½ !  ($ (¸½ l  ( j!	A!\n    	 \ntj* 8  *! (Ô½   (  \ntj(  \n ( ½ jAo \ntj 8  (È½ !  (  \nt!\r  \rj* » \r (Ô½ j(  ( ½  \ntj* »  ¶!A (È½   ( Atj 8   A 6@@  (AHAqE\r  A ²8  A 6@@  (AHAqE\rA (Ô½   ( Atj(   (A ( ½ jAjAjAoAtj* !A (Ì½   (Atj(   (Atj* !    *  8    (Aj6 A (È½   ( Atj* »  *»  ¶!A (È½   ( Atj 8     (Aj6     ( Aj6  A ( ½ AjAo!A  6 ½     ($Aj6$ A (Ä½ A (¤½ j!A  6¤½ A (Ä½ A (¨½ j!A  6¨½   A0j$ z# ! ¨ "(l!# !@ E\r  A 6l "  # !@@ \r   \r E\rA$ #   !      S @  ¡ Bÿÿÿÿÿÿÿÿÿ Bøÿ V\r      ¥ ¡ Bÿÿÿÿÿÿÿÿÿ Bøÿ V!    ½;# Ak"$   6A°º    ê ! Aj$  "   $  $  $  $  #  #  #  #  ¤ |    ¢"  ¢¢ D|ÕÏZ:Ùå=¢Dë+æåZ¾ ¢  D}þ±WãÇ>¢DÕaÁ *¿ ¢D¦ø?  !   ¢!@ \r    ¢DIUUUUUÅ¿ ¢       D      à?¢  ¢¡¢ ¡ DIUUUUUÅ?¢ ¡® @@ AH\r   D      à¢! @ AÿO\r  Axj!  D      à¢!  Aý AýIApj! AxJ\r   D      `¢! @ A¸pM\r  AÉj!  D      `¢!  Aðh AðhKAj!   Aÿj­B4¿¢   |||# A°k"$  A}jAm"A  A J"Ahl j!@ AtA j( "	 Aj"\njA H\r  	 j!  \nk!A !@@@ A N\r D        ! At( ·! AÀj Atj 9  Aj! Aj" G\r  Ahj!\rA ! 	A  	A J! AH!@@@ E\r D        !  \nj!A !D        !@   Atj+  AÀj  kAtj+ ¢  ! Aj" G\r   Atj 9   F! Aj! E\r A/ k!A0 k! AtA j! 	!@@  Atj+ !A ! !@ AH\r @ Aàj Atj D      p>¢ü·"D      pÁ¢  ü6   AtjAxj+   ! Aj! Aj" G\r   \rª !  D      À?¢« D       À¢ " ü"·¡!@@@@@ \rAH"\r  Aàj AtjA|j" ( "  u" tk"6   u!  j! \r\r Aàj AtjA|j( Au! AH\rA! D      à?f\r A !A !A !A!@ AH\r @ Aàj Atj"\n( !@@@@ E\r Aÿÿÿ! E\rA! \n  k6 A!A !A !A! Aj" G\r @ \r Aÿÿÿ!@@ \rAj Aÿÿÿ! Aàj AtjA|j" (  q6  Aj! AG\r D      ð? ¡!A! \r  D      ð? \rª ¡!@ D        b\r A ! !@  	L\r @ Aàj Aj"Atj(  r!  	J\r  E\r @ \rAhj!\r Aàj Aj"Atj( E\r A!@ "Aj! Aàj 	 kAtj( E\r   j!@ AÀj  j"Atj  Aj"Atj( ·9 A !D        !@ AH\r @   Atj+  AÀj  kAtj+ ¢  ! Aj" G\r   Atj 9   H\r  !@@ A kª "D      pAfE\r  Aàj Atj D      p>¢ü"·D      pÁ¢  ü6  Aj! !\r ü! Aàj Atj 6 D      ð? \rª !@ A H\r  !@  "Atj  Aàj Atj( ·¢9  Aj! D      p>¢! \r  !@@@ 	  k" 	 H"A N\r D        !  Atj! A !D        !@ At"+à¤    j+ ¢  !  G! Aj! \r  A j Atj 9  A J! Aj! \r @@@@@  D        !@ A L\r  !@ A j Atj"Axj" + " + " "9     ¡ 9  AK! Aj! \r  AF\r  !@ A j Atj"Axj" + " + " "9     ¡ 9  AK! Aj! \r D        !@  A j Atj+  ! AK! Aj! \r  + ! \r  9  +¨!  9  9D        !@ A H\r @ "Aj!  A j Atj+  ! \r     9 D        !@ A H\r  !@ "Aj!  A j Atj+  ! \r     9  +  ¡!A!@ AH\r @  A j Atj+  !  G! Aj! \r     9  9  +¨!  9  9 A°j$  Aqº\n~|# A0k"$ @@@@  ½"B §"Aÿÿÿÿq"AúÔ½K\r  Aÿÿ?qAûÃ$F\r@ Aü²K\r @ B S\r    D  @Tû!ù¿ " D1cba´Ð½ "9     ¡D1cba´Ð½ 9A!   D  @Tû!ù? " D1cba´Ð= "9     ¡D1cba´Ð= 9A!@ B S\r    D  @Tû!	À " D1cba´à½ "9     ¡D1cba´à½ 9A!   D  @Tû!	@ " D1cba´à= "9     ¡D1cba´à= 9A~!@ A»ñK\r @ A¼û×K\r  Aü²ËF\r@ B S\r    D  0|ÙÀ " DÊ§é½ "9     ¡DÊ§é½ 9A!   D  0|Ù@ " DÊ§é= "9     ¡DÊ§é= 9A}! AûÃäF\r@ B S\r    D  @Tû!À " D1cba´ð½ "9     ¡D1cba´ð½ 9A!   D  @Tû!@ " D1cba´ð= "9     ¡D1cba´ð= 9A|! AúÃäK\r  DÈÉm0_ä?¢D      8C D      8Ã "ü!@@   D  @Tû!ù¿¢ " D1cba´Ð=¢"¡"	D-DTû!é¿cE\r  Aj! D      ð¿ "D1cba´Ð=¢!   D  @Tû!ù¿¢ ! 	D-DTû!é?dE\r  Aj! D      ð? "D1cba´Ð=¢!   D  @Tû!ù¿¢ !   ¡" 9 @ Av"\n  ½B4§AÿqkAH\r    D  `a´Ð=¢" ¡"	 Dsp.£;¢  	¡  ¡¡"¡" 9 @ \n  ½B4§AÿqkA2N\r  	!  	 D   .£;¢" ¡" DÁI %{9¢ 	 ¡  ¡¡"¡" 9     ¡ ¡9@ AÀÿI\r      ¡" 9    9A ! AjAr! BÿÿÿÿÿÿÿB°Á ¿!  Aj!A!\n@   ü·"9    ¡D      pA¢!  \nAq!A !\n ! \r    9 A!@ "\nAj! Aj \nAtj+ D        a\r  Aj  AvAêwj \nAjA¬ ! + ! @ BU\r    9   +9A  k!   9   +9 A0j$  |D      ð?    ¢"D      à?¢"¡"D      ð? ¡ ¡    DË ú>¢DwQÁlÁV¿ ¢DLUUUUU¥? ¢  ¢" ¢  DÔ8¾éú¨½¢DÄ±´½î!> ¢D­RO~¾ ¢ ¢   ¢¡  ê|# Ak"$ @@  ½B §Aÿÿÿÿq"AûÃ¤ÿK\r  AÀòI\r  D        A © ! @ AÀÿI\r     ¡!    ­ ! +!  + !@@@@ Aq     A© !    ® !    A© !    ® !  Aj$   # A k"$    ("6  (!  6  6   k"6  j! Aj!A!@@@@@  (< AjA Aj î E\r  !@  ("F\r@ AJ\r  ! AA   ("K"	j" (   A  	k"j6  AA 	j" (  k6   k! !  (<   	k" Aj î E\r  AG\r    (,"6   6     (0j6 !A !  A 6  B 7    ( A r6  AF\r   (k! A j$   A  B *@@A E\r  " \r¤ (!   ò~@ E\r    :     j"Aj :   AI\r    :    :  A}j :   A~j :   AI\r    :  A|j :   A	I\r   A   kAq"j" AÿqAl"6    kA|q"j"A|j 6  A	I\r   6  6 Axj 6  Atj 6  AI\r   6  6  6  6 Apj 6  Alj 6  Ahj 6  Adj 6   AqAr"k"A I\r  ­B~!  j!@  7  7  7  7  A j! A`j"AK\r   @@@@   sAq\r  A G!@ AqE\r  E\r @   -  ":   E\r  Aj!  Aj"A G! Aj"AqE\r \r  E\r -  E\r AI\r @A ( "k rAxqAxG\r   6   Aj!  Aj! A|j"AK\r  E\r@   -  ":   E\r  Aj!  Aj! Aj"\r A !  A  ´        µ   k|@  E\r @A - èÅ E\r   Aè ú þh  þhA Aè ´  !  þh 9Aå Aß AAÓ       ¹ |@A - èÅ E\r ¨ "E\r  þhþ " F\r @  AF\r    G\r ! þh+! þh AtjAj"   ¡  +  9  þh þ  þh 9 A  ¹ +A A: èÅ ¨ " ·   AØ ¼ & @A - èÅ E\r   þhAÈ j A¶ S @  ¾ Bÿÿÿÿÿÿÿÿÿ Bøÿ V\r      ¤ ¾ Bÿÿÿÿÿÿÿÿÿ Bøÿ V!    ½ À  ÇAd!@@@  E\r  A H\r   Aq\r @ \r A A !@@  Â   F\r  !¦ \rAÿÿÿÿ! AÿÿÿÿF\r A! AF\r Aj!   þ  " AL\r   j! AÓ Aý A&AØ   Aç Aý A2AØ     A   A þHìÅ "   FH@  Aþ3|"E\r  Aq\r   þ| Ar"G\r @ AÿÿÿÿÁ   þ| F\r ;@A (ðÅ " E\r @AðÅ AôÅ   AË A (ðÅ " \r  Æ  A AþðÅ " @È AG\r A (ôÅ E\r É  A AþðÅ  AðÅ AÿÿÿÿÁ  @  ( AH\r Ä A   ( !@@@@@¤ "("  ("Aÿÿÿÿq"G\r @ AqE\r   (AJ\r   A 6 Aq! AqAG\r @  ("AþÿÿÿM\r A   Aj6A8! AÿÿÿÿF\r@ \r @ E\r  AqE\r  Aj!@ AqE\r @ (L\r  At6L  (!   Aj6P Axr  !    AqrÌ  F\r A 6P AqAG\r   (\rA\n Aq\rA    (H"6   AÈ j"6  Aj!@  F\r  A|j 6   6HA ! A 6P E\r   A 6A>!      þH \n   Ë  # A j# A k"$ @@  AI\r Î A6 A!A!  B Aj î \r  Aj )ï   )7  )7 A ! A j$  9A!@  AK\r ¤ !@ E\r   - $6    : $A ! |~# Ak"$ @@@ \r D      ð!A! (AÿëÜK\r  Ï \r  )  ) }"7   ( (k"6@ AJ\r   AëÜj"6  B|"7 @ B Y\r AÉ ! ·D    .A£ Bè~º !A A     Æ "k" AoqAeG  A·G"AG\r AA A (øÅ ! Aj$  d# Ak"$ A AjÐ AA¸       Ñ !AA¸  (A Ð  Aj$  Æ  ( !@@  Í "A\nG\r  AsAq!  Aj!  Aj!Aã !@@ ! ( E\r ( \r Aj! \r   Í "A\nG\r  AqE! AqAG!@@@ ( "Aÿÿÿÿq"\r  A G qE\r@ \r  ¤ (G\r A@ \r  ¤ (F\r Ô    Axr"Õ   A   Ò ! Ö  AF\r  \r  Í "A\nF\r  A× A Aß Aö      Aþ \r     þH    Aþ%    A Ó   ( !  (!@@@ Aq\r   Aj"A Ù ! ¤ !A?!  ("Aÿÿÿÿq (G\r@ AqAG\r   ("E\r    Aj6A  At AtqAu!@ Aq"E\r    Aj6PÅ   Aj! Aÿÿÿÿq!  ("  (" 6 @   AÈ jF\r   A|j 6   Ù !  E\r  A 6PÇ A !@ \r   AJ\r Ú  \n    þA \r   AÁ   @    ü\n    @ AI\r     Û    j!@@   sAq\r @@  Aq\r   !@ \r   !  !@  -  :   Aj! Aj"AqE\r  I\r  A|q!@ AÀ I\r   A@j"K\r @  ( 6   (6  (6  (6  (6  (6  (6  (6  ( 6   ($6$  ((6(  (,6,  (060  (464  (868  (<6< AÀ j! AÀ j" M\r   O\r@  ( 6  Aj! Aj" I\r @ AO\r   !@ AO\r   ! A|j!  !@  -  :    - :   - :   - :  Aj! Aj" M\r @  O\r @  -  :   Aj! Aj" G\r   7  þt!@@ \r A     AjþHt" G! ! \r AO@  Aþ%t"A L\r @ AG\r   Aô jAÿÿÿÿÁ AØ Aì A&A   §@@  ¨ G\r   þtA L\r@  Aô j"Aþ% Aj"E\r @  D      ðÆ  þ "\r   (pê   (på A¦ Aì A0AÎ   A» Aì A3AÎ        ã 6p  Aþt  A þxS@¨ " \r AÄ Aì AÑ A     (p" Aþ   ç   AA þH ¿ è# Ak"$ @@  þtA L\r   (pAj×   (p!  (6  ) 7   ë E\r  (pAjØ @  (pAþA AF\r @  þxE\r   Aþ    ¨   Aj$ A» Aì AÞ Aî   A Aì Aâ Aî   ©# AÀ k"$ ä A !@A<ú "E\r @Aú "\r  þ  A 6< B 7  B 7( B 70   6 A 6  6 A6 A 6 A 6 A 6 A 6   (<6   )07  )(7  ) 7  (6  (6   (6$  (6(  (6,  (60  (64  ( 68 ! AÀ j$  }@AÈ» Í \r @A (ü» " AÄ» F\r @  (8!@  þ \r   (4"  (8"68  64  æ  !  AÄ» G\r AÈ» Ø  @  (8\r   (4\r @  þ \r   æ AÈ» ×   AÄ» 68  A (ø» 64A   6ø»   (4  68AÈ» Ø A­ A Aø A   !   AjÊ   ($þ   þ # Ak"$   A6   Aj"× @  è \r @ Aj  é  Ø  ( (   ×   è E\r  Ø   A 6  Aj$ \r   (,  (0F8   ($ (,"Alj"(6   ) 7   Aj ((o6,# Ak"$   Aj"× @  è \r @ Aj  é @ ("E\r  (     è E\r  Ø   A þ  Aj$ _@@  ì E\r A !  í E\r  ($  (0Alj" (6  ) 7 A!    (0Aj  ((o60    (,  (0Aj  ((oFÆ@  (("Alú "E\r  At!@@  (0"  (,"H\r    ($ Alj  k"AlÜ    ($ Alj  (( k"Al"Ü   j  ($ AlÜ   j!  ($þ    60  A 6,   6(   6$ A Gë# A0k"$ @@  (Ý \r A !  Aj"×   (6   ) 7   Ajë ! Ø @@ E\r   AþA !  (!@ AG\r A! A 6( A 6$   6,   6  )$7  Ajâ   (! Þ  A0j$  \n   ê    Aþ   ç   AA þH # A k"$  A 6 B 7 B 7  (!@¦ E\r  @@ -  AqE\r  (Aÿÿÿÿq¤ (F\r A?!@ E\r  (AÿëÜM\r A!¿ @@  ( "E\r   (!  Ajò   Aj!  A j"ó  A6 A 6   ("6   Aj6@@  (\r    Aj6  Aj6  Aj! ô A! Ø A AjÐ @ (AG\r AA Ð      E"	Ñ !@ (  G\r @@ AF\r  \r     	Ñ ! (  F\r A   AF!@@@@ E\r @ AG\r AA   ( F!  Aj"õ AxG\r@ AjA Aö \r   A j"ó @@  ( AjG\r    (6 ("E\r   (6@@  ( AjG\r    (6 ("E\r   (6  ô  ("E\r õ AG\r (! Ajó  × !@ (\r  -  Aq\r  Ajò    !@@ ("E\r @ ("AH\r  Aj  Axrö  Aj÷  -  Aq\r  Ajø A   AF! (! ù  × ! (A Ð    "AG\r¿ A!A! A Ð  A j$     Aþ @ @  A Aö E\r   AAö @  A AAË   A Aö \r  @  ú AG\r   ù \n   Aþ      þH    û   AÿÿÿÿÁ    Aþ% \r   AÁ \n   A þA \n   A þ §# Ak"$ A ! A 6  A j"ó   ("A G!@ E\r  E\r @@@ AjA Aö E\r   (Aj6  Aj6   ! Aj! ( "A G! E\r \r @@ E\r @ ("E\r  A 6  A 6  A 6   6 ô @ ("E\r @ AjA  AË  ("\r @ E\r  Ajô  Aj$ A 9 @  ( \r   Aü @  (E\r   Aj" þ   ÿ A    Aþ \r   AÁ 8@¤ "(D  Atj" (  F\r    6   - &Ar: &A  ¤ (D  Atj(     A ñ     6   6    \'    @ E\r   (  (   ¦# Ak"$ @@@@  A A   AjA        AjA    A AG\r     Aj$ A   AA   A AAË       þH  @  A  AG\r    \n    þA    AÿÿÿÿÁ \' @@  ( AG\r      A  # AkA 6m@  ( E\r   (E\r   Aj"   Aj"     (" AÿÿÿÿqE\r @ A   A Ë  ( " Aÿÿÿÿq\r A    Axþ3    Aþ    AÿÿÿÿÁ K@@@A!@  ( "AÿÿÿÿqAxj     Aj  G\r A A\n!      þH Ä@   "A\nG\r   Aj!Aã !@@ !  ( E\r ( \r Aj! \r    "A\nG\r @@  ( "AÿÿÿÿqAÿÿÿÿG\r      A   AA    (AsÒ !   E\r  AG\r   "A\nF\r     Aþ \r     þH    Aþ%    A  @  (¤ (G\r   A 6@  ( !  (!    A A  Aj Aÿÿÿÿq"AF AÿÿÿÿF" G\r @ \r @ \r  AJ\r    A      þH \r    Á )A\n!@   \r   ¤ (6A !    A AÿÿÿÿþH éA!@  (¤ (F\r    "A\nG\r   Aj!Aã !@@ !  ( E\r ( \r Aj! \r @   "A\nG\r @@  ( "E\r       Axr"    A    (AsÒ !   E\r  AG\r   "A\nF\r   ¤ (6     Aþ \r     þH    Aþ%    A  ¨@¤ "(D\r  AÆ 6DAÊ    A  !A ( Ê "!@@@ At"(°Ê \r    6 A !A  6 Ê  A°Ê j 6  AjAÿ q" G\r A!AÊ    ß@¤ " - &AqE\r A !@AÊ      - &Aþq: &A !@ At"(°Ê !  (D j"( ! A 6 @ E\r  E\r  A F\r AÊ      AÊ   Aj"AG\r AÊ    - &AqE\r AI! Aj! \r  A°Î Ñ@@  E\r ¨ "E\r@@  A°Î G\r # A j"-  \r A:    ×    ¦ !  Ø @ E\r  ( \r  ç   A°Î G\r # A jA :  A Aâ Að A¹   AÄ Aâ Añ A¹   L@  ("AH\r   (!A ! @@   Atj( "( F\r  Aj"  F\r  A Y# A k"$  A 6  6  6  6  )7    Aj¨ ! A j$  ú# Ak"$ @  E\r   × @@  A°Î F\r    © !# A j"A:  A°Î  © ! A :    Ø @@ \r A !  (6  ) 7   î !  A°Î G\r  E\r A! À G\r  Ã  Aj$  A Aâ AA   @@   ¦ "\r @  ("  ( G\r   ( AtA "Atÿ "E\r   6    6 ã "E\r    ("Aj6  ( Atj 6  A ¾# A k"$ @@  (\r   Aj"×   A6  «   A(jý  Ø   «   (!  (! A 6 A 6   6   6  )7   Aj¨ \r   ¬  A j$ ê@@@  E\r   (X"E\r  (\\E\r@   G\r   B 7XA (ÔÎ A  @  A (ÔÎ  "G\r A (ÔÎ  (X   (\\"  (X"6X  6\\  B 7XAæ Aâ AûAã   A Aâ AüAã   Aò Aâ AýAã      ®   þ    (  (    ¬ $ @  (\r   AjÊ   A(j ÿ# Ak"$ @ ¨ F\r  A j  °  A 6 A 6  )7  A j6  A j6A !@    Aj¨ E\r  A0j"× @ (,\r  AÈ j!@    (,E\r  Ø  (,AF! A j®  Aj$  Aù Aâ AA¯   # Aà k"$ AØÎ A   A AÐ ü   6\\  6X A 6T A 6P   (\\6    (X6   (T6   (P6  Aj AÐ ü\n   Aà j$ ¹# A k"$ @@  (\r   Aj"×   A6  A(jý  Ø @  (E\r   (!  (! A 6 A 6   6   6  )7   Aj¨ \r  ¬  A j$ !   ´     (  (   6 @AÔÎ A ¡ E\r Að Aâ AæA   @  E\r @A (ÔÎ  "\r     6X    6\\A (ÔÎ       6X   (\\6\\   6\\  (\\  6XAæ Aâ AëAõ      (  (    ¬ N# Ak"$   6 A 6  6   A  Aj¯ ! Aj$    ( (     ª    9  ª æ|# A0k"$   6   6 A 6 ) A : ( B 7  A 6  6  6 ¨ 6 A 6 ,À !@@@@@@   A°Î  A  Aj¶ \rA°Î  A  Aj¯ E\r + !A(ú "  AjA(ü\n    A:     ú "6   Ü D        !A°Î  A   § \r AÐ Aâ AÅA¶    A0j$  A Aâ AµA¶   J     (   (  (  (  (A A  9@  -  AG\r   (þ   þ O  (  ( ( ( (    @ -  AG\r A Aâ AAÎ   7A (ÔÎ A    !@ (X! ±  !   G\r  A* ½  ¤ ¥  AÜÎ / @¥ \r Aø Aº Aò A   ¿ ¶A A6øÎ A AÜÎ 6ÜÎ A A¤Ï 6¤Ï ¾ ! A AÆ 6 Ï A AÜÎ 6èÎ A AÜÎ 6äÎ A   6ôÎ AÜÎ  A  6Ï A   k6Ï AÜÎ à AÜÎ   A ¨ þÜÏ À Ã  A MA !@@¥ E\r A þÜÏ \r  Ä !Á  A þÜÏ    & AA¸     Ç !AA¸  àAd!@@@  Aq\r ¤ !@@A \r A ! - $AG!@§ \r      È @¥ E\r  D        É   ½ !A !@@ A   þH|"\r     D    .A¢üB D      ðbþ ! AqE\r A þA|! @ ( A G qAG\r  Ae!D        Å !  Aq\r  \r  AO\r At( ¥ ! A A¢ A¹Aô   A  A¢ AÞAô   Í|@@@¦ E\r  !A   Ê \r   !@@ E\r ¤ ( E\r   !  A Ê "  F Er!@  dE\r @ E\r A·Aù A¢ AÉ A    E\r@ \r A @ Å E\r Ae@  þ  F\r AzA   Ê E\r A A¢ AA   AÔ A¢ A&A   A A¢ A9A   Aù A¢ AÒ A    D      ð   A    þHìÅ "   FAã !@@@@ !@ E\r  ( \r  (  G\r Aj! \r  \r A! Ì A !@  (  G\r @   D      ðÆ !  (  G\r E\r  \r  Í    Aþ    Aþ% ©A !@  (LAÿÿÿÿ{q³ "F\r A!  AÌ j"A  Ï E\r  A  Ar"Ï " E\r @@@@  AqE\r   !     Ar"Ï   G\r  Ð  A  Ï " \r       þH    A  AË % @  AÌ j" Ò AqE\r   Ó \n   A þA \r   AÁ Õ@A , ãÏ "E\r   A AxÕ !@ AJ\r A A : ãÏ  E\r A !@ Aÿÿÿÿj  A H!     AxjÕ "F\r Aj"A\nG\r   AÖ Aj!@@@ AL\r  !   ×  Aÿÿÿÿj!    AxrÕ " G\r      þH \n    þ    A  AË . @  ( AJ\r   AÿÿÿÿÖ AxF\r   Ù \r   AÁ  AÐ Ô AÐ  AÐ Ø \\    (H"Aj r6H@  ( "AqE\r    A r6 A  B 7    (,"6   6     (0j6A é A G!@@@  AqE\r  E\r  Aÿq!@  -   F\r Aj"A G!  Aj" AqE\r \r  E\r@  -   AÿqF\r  AI\r  AÿqAl!@A  (  s"k rAxqAxG\r  Aj!  A|j"AK\r  E\r Aÿq!@@  -   G\r     Aj!  Aj"\r A   A  Ý "  k  ~@  ½"B4§Aÿq"AÿF\r @ \r @@  D        b\r A !  D      ðC¢ ß !  ( A@j!  6     Axj6  BÿÿÿÿÿÿÿBð?¿!   æ@@ ("\r A ! Ü \r (!@   ("kM\r      ($  @@ (PA H\r  E\r  !@@   j"Aj-  A\nF\r Aj"E\r      ($  " I\r  k! (!  !A !   Ü   ( j6  j! # AÐk"$   6Ì A jA A(ü   (Ì6È@@A   AÈj AÐ j A j  â A N\r A!@@  (LA N\r A!  Î E!    ( "A_q6 @@@@  (0\r   AÐ 60  A 6  B 7  (,!   6,A !  (\rA!  Ü \r    AÈj AÐ j A j  â ! A q!@ E\r   A A   ($    A 60   6,  A 6  (!  B 7 A !    ( " r6 A  A q! \r   Ñ  AÐj$  ~# AÀ k"$   6< A)j! A\'j!	 A(j!\nA !A !@@@@@A !\r@ ! \r AÿÿÿÿsJ\r \r j! !\r@@@@@@ -  "E\r @@@@ Aÿq"\r  \r! A%G\r \r!@@ - A%F\r  ! \rAj!\r - ! Aj"! A%F\r  \r k"\r Aÿÿÿÿs"J\r\n@  E\r     \rã  \r\r  6< Aj!\rA!@ , APj"A	K\r  - A$G\r  Aj!\rA! !  \r6<A !@@ \r,  "A`j"AM\r  \r!A ! \r!A t"AÑqE\r @  \rAj"6<  r! \r, "A`j"A O\r !\rA t"AÑq\r @@ A*G\r @@ , APj"\rA	K\r  - A$G\r @@  \r   \rAtjA\n6 A !  \rAtj( ! Aj!A! \r Aj!@  \r   6<A !A !  ( "\rAj6  \r( !A !  6< AJ\rA  k! AÀ r! A<jä "A H\r (<!A !\rA!@@ -  A.F\r A !@ - A*G\r @@ , APj"A	K\r  - A$G\r @@  \r   AtjA\n6 A !  Atj( ! Aj! \r Aj!@  \r A !  ( "Aj6  ( !  6< AJ!  Aj6<A! A<jä ! (<!@ \r!A! ",  "\rAjAFI\r Aj! A:l \rjAï¤ j-  "\rAjAÿqAI\r   6<@@ \rAF\r  \rE\r\r@ A H\r @  \r   Atj \r6 \r   Atj) 70  E\r	 A0j \r  å  AJ\rA !\r  E\r	  -  A q\r Aÿÿ{q"  AÀ q!A !A ! \n!@@@@@@@@@@@@@@@@@ -  "À"\rASq \r AqAF \r "\rA¨j!	\n  \n!@ \rA¿j  \rAÓ F\rA !A ! )0!A !\r@@@@@@@   (0 6  (0 6  (0 ¬7  (0 ;  (0 :   (0 6  (0 ¬7  A AK! Ar!Aø !\rA !A ! )0" \n \rA qæ ! P\r AqE\r \rAvA j!A!A !A ! )0" \nç ! AqE\r   k"\r  \rJ!@ )0"BU\r  B  }"70A!A !@ AqE\r A!A !A  A  Aq"!  \nè !  A Hq\r Aÿÿ{q  !@ B R\r  \r  \n! \n!A !  \n k Pj"\r  \rJ!\r - 0!\r (0"\rA  \r!   Aÿÿÿÿ AÿÿÿÿIÞ "\rj!@ AL\r  ! \r!\r ! \r! -  \r )0"PE\rA !\r	@ E\r  (0!A !\r  A  A  é  A 6  >  Aj60 Aj!A!A !\r@@ ( "E\r Aj ñ "A H\r   \rkK\r Aj!  \rj"\r I\r A=! \rA H\r\r  A   \r é @ \r\r A !\rA ! (0!@ ( "E\r Aj ñ " j" \rK\r   Aj ã  Aj!  \rI\r   A   \r AÀ sé   \r  \rJ!\r	  A Hq\r\nA=!   +0    \r   "\rA N\r \r- ! \rAj!\r   \r\n E\rA!\r@@  \rAtj( "E\r  \rAtj   å A! \rAj"\rA\nG\r @ \rA\nI\r A!@  \rAtj( \rA! \rAj"\rA\nF\r A!  \r: \'A! 	! \n! ! \n!   k"  J" AÿÿÿÿsJ\rA=!   j"  J"\r K\r  A  \r  é     ã   A0 \r  Asé   A0  A é     ã   A  \r  AÀ sé  (<!A !A=!Î  6 A! AÀ j$   @  -  A q\r     à {A !@  ( ",  APj"A	M\r A @A!@ AÌ³æ K\r A  A\nl"j  AÿÿÿÿsK!   Aj"6  , ! ! ! APj"A\nI\r  ¾ @@@@@@@@@@@@@@@@@@@ Awj 	\n\r  ( "Aj6    ( 6   ( "Aj6    4 7   ( "Aj6    5 7   ( "Aj6    4 7   ( "Aj6    5 7   ( AjAxq"Aj6    ) 7   ( "Aj6    2 7   ( "Aj6    3 7   ( "Aj6    0  7   ( "Aj6    1  7   ( AjAxq"Aj6    ) 7   ( "Aj6    5 7   ( AjAxq"Aj6    ) 7   ( AjAxq"Aj6    ) 7   ( "Aj6    4 7   ( "Aj6    5 7   ( AjAxq"Aj6    + 9       5 @  P\r @ Aj"  §Aq- ©  r:    B" B R\r  . @  P\r @ Aj"  §AqA0r:    B" B R\r  {~@  BT\r @ Aj"  " B\n" B\n~}§A0r:   BÿÿÿÿV\r @  P\r   §!@ Aj"  A\nn"A\nlkA0r:   A	K! ! \r  # Ak"$ @  L\r  AÀq\r     k"A AI"´ @ \r @   Aã  A~j"AÿK\r     ã  Aj$      A A á Ä~~|# A°k"$ A ! A 6,@@ í "BU\r A!	A¨ !\n "í !@ AqE\r A!	A« !\nA® A©  Aq"	!\n 	E!@@ Bøÿ Bøÿ R\r   A   	Aj" Aÿÿ{qé    \n 	ã   Aò A©  A q"A A·    bAã   A    AÀ sé     J!\r Aj!@@@@  A,jß "  "D        a\r   (,"Aj6, A r"Aá G\r A r"Aá F\rA  A H! (,!  Acj"6,A  A H! D      °A¢! A0jA A  A Hj"!@  ü"6  Aj!  ¸¡D    eÍÍA¢"D        b\r @@ AN\r  ! ! ! ! !@ A AI!@ A|j" I\r  ­!B !@  5   |" BëÜ"BëÜ~}>  A|j" O\r  BëÜT\r  A|j" > @@ " M\r A|j"( E\r   (, k"6, ! A J\r @ AJ\r  AjA	nAj! Aæ F!@A  k"A	 A	I!\r@@  I\r A A ( !AëÜ \rv!A \rtAs!A ! !@  ( " \rv j6   q l! Aj" I\r A A ( ! E\r   6  Aj!  (, \rj"6,   j" " Atj   kAu J! A H\r A !@  O\r   kAuA	l!A\n! ( "A\nI\r @ Aj!  A\nl"O\r @ A   Aæ Fk A G Aç Fqk"  kAuA	lAwjN\r  A0jA`A¤b A Hj AÈ j"A	m"Atj!\rA\n!@  A	lk"AJ\r @ A\nl! Aj"AG\r  \rAj!@@ \r( "  n" lk"\r   F\r@@ Aq\r D      @C! AëÜG\r \r M\r \rA|j-  AqE\rD     @C!D      à?D      ð?D      ø?  FD      ø?  Av"F  I!@ \r  \n-  A-G\r  ! ! \r  k"6     a\r  \r  j"6 @ AëÜI\r @ \rA 6 @ \rA|j"\r O\r  A|j"A 6  \r \r( Aj"6  AÿëÜK\r   kAuA	l!A\n! ( "A\nI\r @ Aj!  A\nl"O\r  \rAj"   K!@@ " M"\r A|j"( E\r @@ Aç F\r  Aq! AsA A " J A{Jq"\r j!AA~ \r j! Aq"\r Aw!@ \r  A|j( "\rE\r A\n!A ! \rA\np\r @ "Aj! \r A\nl"pE\r  As!  kAuA	l!@ A_qAÆ G\r A !   jAwj"A  A J"  H!A !   j jAwj"A  A J"  H!A!\r AýÿÿÿAþÿÿÿ  r"J\r  A GjAj!@@ A_q"AÆ G\r   AÿÿÿÿsJ\r A  A J!@   Au"s k­ è "kAJ\r @ Aj"A0:    kAH\r  A~j" :  A!\r AjA-A+ A H:    k" AÿÿÿÿsJ\rA!\r  j" 	AÿÿÿÿsJ\r  A    	j" é    \n 	ã   A0   Asé @@@@ AÆ G\r  AjA	r!    K"!@ 5  è !@@  F\r   AjM\r@ Aj"A0:    AjK\r   G\r  Aj"A0:       kã  Aj" M\r @ E\r   A Aã   O\r AH\r@@ 5  è " AjM\r @ Aj"A0:    AjK\r     A	 A	Hã  Awj! Aj" O\r A	J! ! \r @ A H\r   Aj  K!\r AjA	r! !@@ 5  è " G\r  Aj"A0:  @@  F\r   AjM\r@ Aj"A0:    AjK\r    Aã  Aj!  rE\r   A Aã      k"   Jã   k! Aj" \rO\r AJ\r   A0 AjAA é      kã  !  A0 A	jA	A é   A    AÀ sé     J!\r \n AtAuA	qj!@ AK\r A k!D      0@!@ D      0@¢! Aj"\r @ -  A-G\r    ¡ !    ¡!@ (," Au"s k­ è " G\r  Aj"A0:   (,! 	Ar! A q! A~j" Aj:   AjA-A+ A H:   AH AqEq! Aj!@ " ü"A© j-   r:    ·¡D      0@¢!@ Aj" AjkAG\r  D        a q\r  A.:  Aj! D        b\r A!\r Aûÿÿÿ 	  k"jkJ\r   A    j Aj  Ajk" A~j H  "j" é     ã   A0   Asé    Aj ã   A0  kA A é     ã   A    AÀ sé     J!\r A°j$  \r.  ( AjAxq"Aj6    )  ) 9    ½ @  \r A Î   6 A,~  A 6   BëÜ"7     BëÜ~}>¬A!@@  E\r  Aÿ M\r@@# ( ( \r  AqA¿F\rÎ A6 @ AÿK\r    A?qAr:    AvAÀr:  A@@ A°I\r  A@qAÀG\r   A?qAr:    AvAàr:     AvA?qAr: A@ A|jAÿÿ?K\r    A?qAr:    AvAðr:     AvA?qAr:    AvA?qAr: AÎ A6 A!    :  A @  \r A    A ð 	         (<ó  î K# Ak"$     Aÿq Aj î ! )! Aj$ B     (<  õ    A 6 A T# A k"B 7 B 7 B 7   )7   )7   )7 @ E\r    ( 6 A  A ü!	@A (¨Ð \r û @@A - üÓ AqE\r A !AÔ × \r@@@@@  AôK\r @A (ÀÐ "A  AjAøq  AI"Av"v" AqE\r @@  AsAq j"At"AèÐ j" (ðÐ " ("G\r A  A~ wq6ÀÐ  A (ÐÐ I\r (  G\r  6  6  Aj!   Ar6   j"   (Ar6 A (ÈÐ "M\r@  E\r @@   tA t" A   krqh"At"AèÐ j" (ðÐ " ("G\r A  A~ wq"6ÀÐ  A (ÐÐ I\r (  G\r  6  6   Ar6   j"  k"Ar6   j 6 @ E\r  AxqAèÐ j!A (ÔÐ !@@ A Avt"q\r A   r6ÀÐ  ! ("A (ÐÐ I\r  6  6  6  6  Aj!A  6ÔÐ A  6ÈÐ A (ÄÐ E\r ü !A!  A¿K\r   Aj"Axq!A (ÄÐ "E\r A!	@  AôÿÿK\r  A& Avg" kvAq  AtkA>j!	A  k!@@@@ 	At(ðÒ "\r A ! A !A !  A A 	Avk 	AFt!A !@@ (Axq k" O\r  ! ! \r A ! ! !    ("   AvAqj("F   !  At! ! \r @   r\r A !A 	t" A   kr q" E\r  hAt(ðÒ !   E\r@  (Axq k" I!@  ("\r   (!   !    ! !  \r  E\r  A (ÈÐ  kO\r  A (ÐÐ "I\r (!	@@ ("  F\r  (" I\r ( G\r  ( G\r   6   6@@@ ("E\r  Aj! ("E\r Aj!@ ! " Aj!  ("\r   Aj!  ("\r   I\r A 6 A ! @ 	E\r @@  ("At"(ðÒ G\r  AðÒ j  6   \rA  A~ wq"6ÄÐ  	 I\r@@ 	( G\r  	  6 	  6  E\r   I\r   	6@ ("E\r   I\r   6   6 ("E\r   I\r   6   6@@ AK\r    j" Ar6   j"   (Ar6  Ar6  j" Ar6  j 6 @ AÿK\r  AøqAèÐ j! @@A (ÀÐ "A Avt"q\r A   r6ÀÐ   !  (" I\r   6  6   6  6A! @ AÿÿÿK\r  A& Avg" kvAq  AtrA>s!    6 B 7  AtAðÒ j!@@@ A  t"q\r A   r6ÄÐ   6   6 A A  Avk  AFt!  ( !@ "(Axq F\r  Av!  At!   Aqj"("\r  Aj"  I\r   6   6  6  6  I\r ("  I\r   6  6 A 6  6   6 Aj!@A (ÈÐ "  I\r A (ÔÐ !@@   k"AI\r   j" Ar6   j 6   Ar6   Ar6   j"   (Ar6A !A !A  6ÈÐ A  6ÔÐ  Aj!@A (ÌÐ "  M\r A    k"6ÌÐ A A (ØÐ "  j"6ØÐ   Ar6   Ar6  Aj!A !@A (¨Ð \r û A (°Ð "  A/j"jA   kq" M\rA !@A (øÓ " E\r A (ðÓ " j" M\r   K\r@@@@A - üÓ Aq\r @@@@@A (ØÐ "E\r AÔ ! @@   ( "I\r     (jI\r  (" \r A°Ô × A  "AF\r !@A (¬Ð " Aj" qE\r   k  jA   kqj!  M\r@A (øÓ " E\r A (ðÓ " j" M\r   K\r  "  G\rA°Ô ×  A (ÌÐ kA (°Ð "jA  kq" "  (   (jF\r !   AF\r@  A0jO\r   kA (°Ð "jA  kq" AF\r  j!  ! AG\rA A (üÓ Ar6üÓ A°Ô Ø A°Ô ×   !A  ! A°Ô Ø  AF\r  AF\r   O\r   k" A(jM\rA°Ô Ø A A (ðÓ  j" 6ðÓ @  A (ôÓ M\r A   6ôÓ @@@@A (ØÐ "E\r AÔ ! @   ( "  ("jF\r  (" \r @@A (ÐÐ " E\r    O\rA  6ÐÐ A ! A  6Ô A  6Ô A A6àÐ A A (¨Ð 6äÐ A A 6¤Ô @  At" AèÐ j"6ðÐ   6ôÐ   Aj" A G\r A  AXj" Ax kAq"k"6ÌÐ A   j"6ØÐ   Ar6   jA(6A A (¸Ð 6ÜÐ   O\r   I\r   (Aq\r     j6A  Ax kAq" j"6ØÐ A A (ÌÐ  j"  k" 6ÌÐ    Ar6  jA(6A A (¸Ð 6ÜÐ @ A (ÐÐ O\r A  6ÐÐ   j!AÔ ! @@@  ( " F\r  (" \r   - AqE\rAÔ ! @@@   ( "I\r     (j"I\r  (!  A  AXj" Ax kAq"k"6ÌÐ A   j"6ØÐ   Ar6   jA(6A A (¸Ð 6ÜÐ   A\' kAqjAQj"    AjI"A6 A ) Ô 7 A )Ô 7A  Aj6 Ô A  6Ô A  6Ô A A 6¤Ô  Aj! @  A6  Aj!  Aj!   I\r   F\r   (A~q6   k"Ar6  6 @@ AÿK\r  AøqAèÐ j! @@A (ÀÐ "A Avt"q\r A   r6ÀÐ   !  ("A (ÐÐ I\r   6  6A!A!A! @ AÿÿÿK\r  A& Avg" kvAq  AtrA>s!    6 B 7  AtAðÒ j!@@@A (ÄÐ "A  t"q\r A   r6ÄÐ   6   6 A A  Avk  AFt!  ( !@ "(Axq F\r  Av!  At!   Aqj"("\r  Aj" A (ÐÐ I\r   6   6A!A! ! !  A (ÐÐ "I\r ("  I\r   6  6   6A ! A!A!  j 6   j  6 A (ÌÐ "  M\r A    k"6ÌÐ A A (ØÐ "  j"6ØÐ   Ar6   Ar6  Aj!Î A06 A !ò     6     ( j6   ý !A - üÓ AqE\r AÔ Ø  Á# Ak" $ A°Ô × @A (¨Ð \r A A6¼Ð A B7´Ð A B 7¬Ð A A6üÓ @  Aj÷ \r AÔ   Ajø \r   Ajù A   AjApqAØªÕªs6¨Ð A°Ô Ø   Aj$ õ	A (ÄÐ "hAt(ðÒ "(Axq  k! !@@@ ("\r  ("E\r (Axq  k"   I"!   ! ! @ A (ÐÐ "I\r  (!@@ (" F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ !	 "Aj! ("\r  Aj! ("\r  	 I\r 	A 6 A !@ E\r @@  ("At"(ðÒ G\r  AðÒ j 6  \rA  A~ wq6ÄÐ   I\r@@ ( G\r   6  6 E\r  I\r  6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6@@ AK\r     j"Ar6  j" (Ar6   Ar6   j" Ar6  j 6 @A (ÈÐ "E\r  AxqAèÐ j! A (ÔÐ !@@A (ÀÐ "	A Avt"q\r A  	 r6ÀÐ   !  (" I\r   6  6   6  6A  6ÔÐ A  6ÈÐ  Ajò  \n  Ax  kAqj" Ar6 Ax kAqj"  j"k! @@@ A (ØÐ G\r A  6ØÐ A A (ÌÐ   j"6ÌÐ   Ar6@ A (ÔÐ G\r A  6ÔÐ A A (ÈÐ   j"6ÈÐ   Ar6  j 6 @ ("AqAG\r  (!@@ AÿK\r @ (" AøqAèÐ j"F\r  A (ÐÐ I\r ( G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  F\r  A (ÐÐ I\r ( G\r  6  6 (!@@  F\r  ("A (ÐÐ I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ !	 "Aj! ("\r  Aj! ("\r  	A (ÐÐ I\r 	A 6 A ! E\r @@  ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ  A (ÐÐ I\r@@ ( G\r   6  6 E\r A (ÐÐ "I\r  6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6 Axq"  j!   j"(!  A~q6   Ar6   j  6 @  AÿK\r   AøqAèÐ j!@@A (ÀÐ "A  Avt" q\r A    r6ÀÐ  !  (" A (ÐÐ I\r  6   6  6   6A!@  AÿÿÿK\r   A&  Avg"kvAq AtrA>s!  6 B 7 AtAðÒ j!@@@A (ÄÐ "A t"q\r A   r6ÄÐ   6   6  A A Avk AFt! ( !@ "(Axq  F\r Av! At!  Aqj"("\r  Aj"A (ÐÐ I\r  6   6  6  6 A (ÐÐ " I\r ("  I\r  6  6 A 6  6  6 Ajò  \n@@  E\r @A - üÓ AqE\r AÔ × \r  Axj"A (ÐÐ "I\r  A|j( "AqAF\r  Axq" j!@@ Aq\r  AqE\r  ( "k" I\r   j! @ A (ÔÐ F\r  (!@ AÿK\r @ (" AøqAèÐ j"F\r   I\r ( G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  F\r   I\r ( G\r  6  6 (!@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! E\r@@  ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ   I\r@@ ( G\r   6  6 E\r  I\r  6@ ("E\r   I\r  6  6 ("E\r  I\r  6  6 ("AqAG\r A   6ÈÐ   A~q6   Ar6   6   O\r ("AqE\r@@ Aq\r @ A (ØÐ G\r A  6ØÐ A A (ÌÐ   j" 6ÌÐ    Ar6 A (ÔÐ G\rA A 6ÈÐ A A 6ÔÐ @ A (ÔÐ "	G\r A  6ÔÐ A A (ÈÐ   j" 6ÈÐ    Ar6   j  6  (!@@ AÿK\r @ (" AøqAèÐ j"F\r   I\r ( G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! \nE\r @@  ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6  Axq  j" Ar6   j  6   	G\rA   6ÈÐ   A~q6   Ar6   j  6 @  AÿK\r   AøqAèÐ j!@@A (ÀÐ "A  Avt" q\r A    r6ÀÐ  !  ("  I\r  6   6  6   6A!@  AÿÿÿK\r   A&  Avg"kvAq AtrA>s!  6 B 7 AtAðÒ j!@@@@A (ÄÐ "A t"q\r A   r6ÄÐ   6 A! A!  A A Avk AFt! ( !@ "(Axq  F\r Av! At!  Aqj"("\r  Aj"  I\r   6 A! A! ! ! !  I\r (" I\r  6  6A !A! A!  j 6   6   j 6 A A (àÐ Aj"A 6àÐ A - üÓ AqE\r AÔ Ø ò  æ@  \r  ú @ A@I\r Î A06 A A !@@A - üÓ AqE\r AÔ × \r  AxjA AjAxq AI !@A - üÓ AqE\r AÔ Ø @ E\r  Aj@ ú "\r A    A|Ax  A|j( "Aq Axqj"   IÜ   þ  		@@  A (ÐÐ "I\r   ("Aq"AF\r  Axq"E\r    j"("AqE\r @ \r A ! AI\r@  AjI\r   !  kA (°Ð AtM\rA !@  I\r @  k"AI\r     AqrAr6   j" Ar6  (Ar6     A !@ A (ØÐ G\r A (ÌÐ  j" M\r    AqrAr6   j"  k"Ar6A  6ÌÐ A  6ØÐ   @ A (ÔÐ G\r A !A (ÈÐ  j" I\r@@  k"AI\r     AqrAr6   j" Ar6   j" 6   (A~q6   Aq rAr6   j" (Ar6A !A !A  6ÔÐ A  6ÈÐ   A ! Aq\r Axq j" I\r (!@@ AÿK\r @ (" AøqAèÐ j"	F\r   I\r ( G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  	F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ !	 "Aj! ("\r  Aj! ("\r  	 I\r 	A 6 A ! \nE\r @@  ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6@  k"AK\r    Aq rAr6   j" (Ar6      AqrAr6   j" Ar6   j" (Ar6     ò    @  AK\r  ú     øA!@@  A  AK" Ajq\r  ! @ " At!   I\r @ A@  kI\r Î A06 A @A AjAxq AI"  jAjú "\r A A !@@A - üÓ AqE\r AÔ × \r Axj!@@  Aj q\r  !  A|j"( "Axq   jAjA   kqAxj"A     kAKj"  k"k!@ Aq\r  ( !   6    j6      (AqrAr6   j" (Ar6   ( AqrAr6   j" (Ar6   @  ("AqE\r  Axq" AjM\r     AqrAr6   j"  k"Ar6   j" (Ar6     Aj!A - üÓ AqE\r AÔ Ø  ø	   j!@@@@  ("AqE\r A (ÐÐ ! AqE\r    ( "k" A (ÐÐ "I\r  j!@  A (ÔÐ F\r   (!@ AÿK\r @  (" AøqAèÐ j"F\r   I\r (  G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  F\r   I\r (  G\r  6  6  (!@@   F\r   (" I\r (  G\r (  G\r  6  6@@@  ("E\r   Aj!  ("E\r  Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! E\r@@    ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ   I\r@@ (  G\r   6  6 E\r  I\r  6@  ("E\r   I\r  6  6  ("E\r  I\r  6  6 ("AqAG\r A  6ÈÐ   A~q6   Ar6  6   I\r@@ ("Aq\r @ A (ØÐ G\r A   6ØÐ A A (ÌÐ  j"6ÌÐ    Ar6  A (ÔÐ G\rA A 6ÈÐ A A 6ÔÐ @ A (ÔÐ "	G\r A   6ÔÐ A A (ÈÐ  j"6ÈÐ    Ar6   j 6  (!@@ AÿK\r @ (" AøqAèÐ j"F\r   I\r ( G\r@  G\r A A (ÀÐ A~ Avwq6ÀÐ @  F\r   I\r ( G\r  6  6 (!\n@@  F\r  (" I\r ( G\r ( G\r  6  6@@@ ("E\r  Aj! ("E\r Aj!@ ! "Aj! ("\r  Aj! ("\r   I\r A 6 A ! \nE\r @@  ("At"(ðÒ G\r  AðÒ j 6  \rA A (ÄÐ A~ wq6ÄÐ  \n I\r@@ \n( G\r  \n 6 \n 6 E\r  I\r  \n6@ ("E\r   I\r  6  6 ("E\r   I\r  6  6   Axq j"Ar6   j 6    	G\rA  6ÈÐ   A~q6   Ar6   j 6 @ AÿK\r  AøqAèÐ j!@@A (ÀÐ "A Avt"q\r A   r6ÀÐ  ! (" I\r   6   6   6   6A!@ AÿÿÿK\r  A& Avg"kvAq AtrA>s!   6  B 7 AtAðÒ j!@@@A (ÄÐ "A t"q\r A   r6ÄÐ    6    6 A A Avk AFt! ( !@ "(Axq F\r Av! At!  Aqj"("\r  Aj" I\r   6    6    6    6  I\r (" I\r   6   6  A 6   6   6ò  k~@@  \r A !  ­ ­~"§!   rAI\r A  B §A G!@ ú " E\r   A|j-  AqE\r   A  ´    ? Att~  ­B|Bøÿÿÿ!@@@ A þ½ " ­|"BÿÿÿÿV\r   §"O\r  \rÎ A06 AA    þH½   G\r     A $ A AjApq$    $  $  # # k #  # S~@@ AÀ qE\r   A@j­!B ! E\r  AÀ  k­  ­"!  !   7    7S~@@ AÀ qE\r   A@j­!B ! E\r  AÀ  k­  ­"!  !   7    7©~# A k"$  Bÿÿÿÿÿÿ?!@@ B0Bÿÿ"§"AÿjAýK\r   B< B! Aj­!@@  Bÿÿÿÿÿÿÿÿ" BT\r  B|!  BR\r  B |!B   BÿÿÿÿÿÿÿV"!  ­ |!@   P\r  BÿÿR\r   B< BB! Bÿ!@ AþM\r Bÿ!B ! @Aø Aø  P"" k"Að L\r B ! B !  BÀ  !A !@  F\r  Aj   A k  ) )B R!       ) "B< )B! @@ Bÿÿÿÿÿÿÿÿ ­"BT\r   B|!  BR\r   B  |!   B    BÿÿÿÿÿÿÿV"!  ­! A j$  B4 B  ¿  ¤ "(@6   6@   (! ¤   6@y@¤ (" A (ÈÔ F\r @AÈÔ A    "E\r @AÈÔ AÐÔ  A Ë AÈÔ A    "\r A A (ÌÔ Aj6ÌÔ      þH K@A (ÌÔ " E\r A   Aj6ÌÔ AÈÔ  @A (ÐÔ E\r AÈÔ  \n   A þ \r   AÁ ` @  ¨ F\r @  þhE\r   þhþ   ((" A A´   þ A¿ AÇ AAñ   @@¤ "E\r  A: $   6< A : % ß  £  Å @ (H" E\r    AÈ j"F\r @  Axj( !   6P   ( 6H  Atj" !  A 6P@@  A H\r  E\r   ( " E\r   G\r Ç A A (äÏ Aj" 6äÏ @  \r A A : ãÏ  ("  ("6   6  6  6 ¥ \rA A A A£ @ Aj" AA AG\r         A AÇ A¨A»   A   E¤ ! @@  (@"E\r (! ( !   (6@        AþA >      £ @ E\r  E\r A  6½ @ E\r » Aº \n   $ #   kApq"$   # û@  \r A !@A (À» E\r A (À»  !@A (½ E\r A (½   r!@Ú ( " E\r @@@  (LA N\r A!  Î E!@  (  (F\r     r!@ \r   Ñ   (8" \r Û  @@  (LA N\r A!  Î E!@@@  (  (F\r   A A   ($    (\r A! E\r@  ("  ("F\r     k¬A  ((  A !  A 6  B 7  B 7 \r  Ñ  EAÀ !@  AK\r @@  \r A !   At/© " E\r  AÄ« j!       ¡=         (  :do_proxy em_task_queue_destroy emscripten_proxy_sync_with_ctx run_js_func_with_ctx remove_active_ctx add_active_ctx _emscripten_check_mailbox -+   0X0x -0X+0X 0X-0x+0x 0x _emscripten_thread_exit _emscripten_thread_profiler_init _do_futex_wait init_active_ctxs emscripten_main_thread_process_queued_calls Unknown error _emscripten_thread_mailbox_shutdown nan __pthread_mutex_timedlock inf self emscripten_thread_mailbox_unref emscripten_proxy_execute_queue emscripten_futex_wake emscripten_thread_mailbox_send !f->owned futex_wait_main_browser_thread _emscripten_run_js_on_main_thread Browser main thread /emsdk/emscripten/system/lib/pthread/thread_mailbox.c /emsdk/emscripten/system/lib/pthread/emscripten_futex_wait.c /emsdk/emscripten/system/lib/pthread/thread_profiler.c /emsdk/emscripten/system/lib/libc/musl/src/thread/pthread_mutex_timedlock.c /emsdk/emscripten/system/lib/pthread/proxying.c /emsdk/emscripten/system/lib/pthread/em_task_queue.c /emsdk/emscripten/system/lib/pthread/pthread_create.c /emsdk/emscripten/system/lib/pthread/emscripten_futex_wake.c /emsdk/emscripten/system/lib/pthread/library_pthread.c _emscripten_thread_free_data expected_null & NOTIFY_BIT NAN queue->zombie_next == NULL && queue->zombie_prev == NULL ctx != NULL ctx->prev != NULL ctx->next != NULL q != NULL ret == ATOMICS_WAIT_OK INF thread->mailbox_refcount > 0 new_count >= 0 ret >= 0 ret == 0 last_addr == addr || last_addr == 0 . (null) thread == pthread_self() t != pthread_self() !emscripten_is_main_browser_thread() emscripten_is_main_runtime_thread() 0 && "No way to correctly recover from allocation failure" at || own != __pthread_self()->tid && "pthread mutex deadlock detected" false && "emscripten_proxy_sync_with_ctx failed" false && "emscripten_proxy_async failed" !pthread_equal(target_thread, pthread_self()) && "Cannot synchronously wait for work proxied to the current thread" wow!! %f\n                      ù¢ DNn ü) ÑW\' Ý4õ bÛÀ < AC cQþ »Þ« ·aÅ :n$ ÒMB Ià 	ê. Ñ ëþ )± è>§ õ5 D». é ´&p A~_ Ö9 S9 ô9 _ (ù½ ø; Þÿ  /ï \nZ mm Ï~6 	Ë\' FO· f? -ê_ º\'u åëÇ ={ñ ÷9 R ûkê ±_ ] 0V {üF ð«k  ¼Ï 6ô ã© ^a æ e  _ @h Øÿ \'sM 1 ÊV É¨s {â` kÀ ÄG ÍgÃ 	èÜ Y* vÄ ¦ D¯Ý WÑ ¥> ÿ 3~? Â2è OÞ »}2 &=Ã kï ø^ 5: òÊ ñ |! j$| Õnú 0-w ;C µÆ Ã ­ÄÂ ,MA  ] }F ãq- Æ 3b  ´Ò| ´§ 7UÕ ×>ö £ Mvü d* p×« c|ø z°W ç ÀIV ;ÖÙ §8 $#Ë Öw ZT#  ¹ ñ\n Îß 1ÿ fj Wa ¬ûG ~Ø "e· 2è æ¿` ïÄÍ l6	 ]?Ô Þ× X;Þ Þ Ò"( (è âXM ÆÊ2 ã à}Ë ÀP ó§ à[ .4 b H õ[ ­° éò HJC gÓ ªÝØ ®_B jaÎ \n(¤ Ó´ ¦ò \\w £Â a< sx ¯Z o×½ -¦c ô¿Ë ï &Ág UÊE ÊÙ6 (¨Ò Âa Éw & F ÄYÄ ÈÅD M²  ó ÔC­ )Iå ýÕ  ¾ü Ì pÎî >õ ìñ ³çÃ Çø(  Áq> .	³ Eó  « { .µ GÂ {2/ Um r§ kç 1Ë yJ Ayâ ôß è âæ 1 ík __6 »ý H´ g¤l qrB ]2 ¸ ¼å	 1% ÷t9 0 \r Kh ,îX Gª tç ½Ö$ ÷}¦ nHr ï ¦ ´ö ÑSQ Ï\nò  3 õK~ ²ch Ý>_ @]  UR) 7dÀ mØ 2H2 [Lu NqÔ ETn 	Á *õi fÕ \' ]P ´;Û êvÅ ù Ik} \'º i) ÆÌ¬ ­T âj Ù ,rP ¤¾ w ó0p  ü\' êq¨ fÂI dà= Ý £? Cý \r 1AÞ 9 Ýp ·ç ß; 7+ \\  Z  èØ l¯ ÛÿK 8 Yv b¥ aË» Ç¹ @½ Òò Iu\' ë¶ö Û"» \nª &/ dv 	;3  Q:ª £Â ¯í® \\& mÂM -z ÀV ? 	ðö +@ m1 9´   ØÃ[ õÄ Æ­K NÊ¥ §7Í æ©6 « ÝBh cÞ vï hR üÛ7 ®¡« ß1  ®¡ ûÚ dMf í· )e0 WV¿ Gÿ: jù¹ u¾ó (ß «0 fö Ë ú" Ùä =³¤ W 6Í	 NBé ¾¤ 3#µ ðª Oe¨ ÒÁ¥ ? [xÍ #ùv { r Æ¦S onâ ïë  JX ÄÚ· ªfº vÏÏ Ñ ±ñ- Á Ã­w HÚ ÷]  Æô ¬ð/ Ýì ?\\¼ ÐÞm Ç *Û¶ £%:  ¯ ­S ¶W )-´ K~ Ú§ vª {Y¡ * Ü·- úåý Ûþ ¾ý ävl ©ü >p n ýÿ (> ag3 * M½ê ³ç¯ mn g9 1¿[ ×H 0ß Ç-C %a5 ÉpÎ 0Ë¸ ¿lý ¤ ¢ lä ZÝ  !oG bÒ ¹\\ paI kVà R PU7 Õ· 3ñÄ n_ ]0ä .© ²Ã ¡26 ·¤ ê±Ô ÷! iä \'ÿw  @- OÍ   ¥ ³¢Ó /]\n ´ùB ÚË }¾Ð ÛÁ «½ Ê¢ j\\ .U \' U ð á d A ¾Þ Úý* k%¶ {4 óþ ¹¿ hjO J*¨ OÄZ -ø¼ ×Z ôÇ \rM  :¦ ¤W_ ?± 8 Ì  qÝ ÉÞ¶ ¿`õ Me k °¬ ²ÀÐ QUH û rÃ £; À@5 Ü{ àEÌ N)ú ÖÊÈ èóA |dÞ dØ Ù¾1 ¤Ã wXÔ iãÅ ðÚ º:< FF Uu_ Ò½õ nÆ ¬.] Dí >B aÄ )ýé çÖó "|Ê o5 àÅ ÿ× njâ °ýÆ Á |]t k­² Ín >r{ Æj ÷Ï© )sß µÉº · Q â²\r tº$ å}` tØ \r,  ~f ) zv ýý¾ VEï Ù~6 ìÙ º¹ Äü 1¨\' ñnÃ Å6 Ø¨V ´¨µ ÏÌ - oW4 ,V Îã Ö ¹ k^ª >* _Ì ýJ áôû ;m â, éÔ ü´© ïîÑ .5É /9a 8!D ÙÈ ü\n ûJj /Ø S´ N T"Ì *UÜ ÀÆÖ  p¸ id &Z` ?Rî  ôµ üËõ 4¼- 4¼î è]Ì Ý^` g 3ï É¸ aX áW¼ QÆ Ø> ÝqH -Ý ¯¡ !,F Yó× Ùz TÀ Oú Vü åy® "6 8­" gÜ Uèª &8 Êç Q\r¤ 3± ©× iH e²ð § L ùÑ6 !³ {J Ï! @Ü ÜGU át: gëB þß ^Ô_ {g¤ º¬z Uö¢ +# AºU Yn !* 9G ãæ åÔ Iû@ ÿVé Ê ÅY ú+ ÓÁÅ ÅÏ ÛZ® GÅ Cb !; ,y a *L{ , C¿ & x< ¨Ää åÛ{ Ä:Â &ôê ÷g \r¿ e£+ =± ½| ¤QÜ \'Ýc iáÝ  ¨) hÎ( 	í´ D  NÊ pc ~|# ¹2 §õ Vç !ñ µ* o~M ¥Q µù« ßÖ Ýa 6 Ä: ¢¡ rím 9z ¸© k2\\ F\'[  4í Ò w üôU YM àq            @û!ù?    -Dt>   Fø<   `QÌx;   ð9   @ %z8   "ã6    ói5    úÿÿÿ·ÿÿÿ                	             \n\n\n  	  	                               \r \r   	   	                                               	                                                  	                                                   	                                              	                                                      	                                                   	         0123456789ABCDEF   N ë§~ uú ¹,ý·z¼ Ì¢ =I×  *_·úXÙýÊ½áÍÜ@x }gaì å\nÔ Ì>Ov¯  D ® ®` úw!ë+ `A ©£nN                                                        *                    \'9H                                  8R`S  Ê        »Ûë+;PSuccess Illegal byte sequence Domain error Result not representable Not a tty Permission denied Operation not permitted No such file or directory No such process File exists Value too large for defined data type No space left on device Out of memory Resource busy Interrupted system call Resource temporarily unavailable Invalid seek Cross-device link Read-only file system Directory not empty Connection reset by peer Operation timed out Connection refused Host is down Host is unreachable Address in use Broken pipe I/O error No such device or address Block device required No such device Not a directory Is a directory Text file busy Exec format error Invalid argument Argument list too long Symbolic link loop Filename too long Too many open files in system No file descriptors available Bad file descriptor No child process Bad address File too large Too many links No locks available Resource deadlock would occur State not recoverable Owner died Operation canceled Function not implemented No message of desired type Identifier removed Device not a stream No data available Device timeout Out of streams resources Link has been severed Protocol error Bad message File descriptor in bad state Not a socket Destination address required Message too large Protocol wrong type for socket Protocol not available Protocol not supported Socket type not supported Not supported Protocol family not supported Address family not supported by protocol Address not available Network is down Network unreachable Connection reset by network Connection aborted No buffer space available Socket is connected Socket not connected Cannot send after socket shutdown Operation already in progress Operation in progress Stale file handle Remote I/O error Quota exceeded No medium found Wrong medium type Multihop attempted Required key not available Key has expired Key has been revoked Key was rejected by service ì                                        è                           ÿÿÿÿ\n                                                               0                                                     Ä Ä                                         ((                            ÿÿÿÿÿÿÿÿ                                                              `*     target_features	+atomics+bulk-memory+bulk-memory-opt+call-indirect-overlong+\nmultivalue+mutable-globals+nontrapping-fptoint+reference-types+sign-ext');
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
  assignWasmImports();
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

    registerTLSInit(wasmExports['_emscripten_tls_init']);

    assignWasmExports(wasmExports);

    // We now have the Wasm module loaded up, keep a reference to the compiled module so we can post it to the workers.
    wasmModule = module;
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
    return receiveInstance(result['instance'], result['module']);
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

  if ((ENVIRONMENT_IS_PTHREAD)) {
    // Instantiate from the module that was received via postMessage from
    // the main thread. We can just use sync instantiation in the worker.
    assert(wasmModule, "wasmModule should have been received via postMessage");
    var instance = new WebAssembly.Instance(wasmModule, getWasmImports());
    return receiveInstance(instance, wasmModule);
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

  
  var terminateWorker = (worker) => {
      worker.terminate();
      // terminate() can be asynchronous, so in theory the worker can continue
      // to run for some amount of time after termination.  However from our POV
      // the worker is now dead and we don't want to hear from it again, so we stub
      // out its message handler here.  This avoids having to check in each of
      // the onmessage handlers if the message was coming from a valid worker.
      worker.onmessage = (e) => {
        var cmd = e['data'].cmd;
        err(`received "${cmd}" command from terminated worker: ${worker.workerID}`);
      };
    };
  
  var cleanupThread = (pthread_ptr) => {
      assert(!ENVIRONMENT_IS_PTHREAD, 'cleanupThread() should only be called from the main thread');
      assert(pthread_ptr, 'null pthread_ptr passed to cleanupThread');
      var worker = PThread.pthreads[pthread_ptr];
      assert(worker);
      PThread.returnWorkerToPool(worker);
    };
  
  var callRuntimeCallbacks = (callbacks) => {
      while (callbacks.length > 0) {
        // Pass the module as the first argument.
        callbacks.shift()(Module);
      }
    };
  var onPreRuns = [];
  var addOnPreRun = (cb) => onPreRuns.push(cb);
  
  var spawnThread = (threadParams) => {
      assert(!ENVIRONMENT_IS_PTHREAD, 'spawnThread() should only be called from the main thread');
      assert(threadParams.pthread_ptr, 'spawnThread called with null pthread ptr');
  
      var worker = PThread.getNewWorker();
      if (!worker) {
        // No available workers in the PThread pool.
        return 6;
      }
      assert(!worker.pthread_ptr);
  
      PThread.runningWorkers.push(worker);
  
      // Add to pthreads map
      PThread.pthreads[threadParams.pthread_ptr] = worker;
  
      worker.pthread_ptr = threadParams.pthread_ptr;
      var msg = {
          cmd: 'run',
          start_routine: threadParams.startRoutine,
          arg: threadParams.arg,
          pthread_ptr: threadParams.pthread_ptr,
      };
      // Ask the worker to start executing its pthread entry point function.
      worker.postMessage(msg, threadParams.transferList);
      return 0;
    };
  
  
  
  var runtimeKeepaliveCounter = 0;
  var keepRuntimeAlive = () => noExitRuntime || runtimeKeepaliveCounter > 0;
  
  var stackSave = () => _emscripten_stack_get_current();
  
  var stackRestore = (val) => __emscripten_stack_restore(val);
  
  var stackAlloc = (sz) => __emscripten_stack_alloc(sz);
  
  
  /** @type{function(number, (number|boolean), ...number)} */
  var proxyToMainThread = (funcIndex, emAsmAddr, proxyMode, ...callArgs) => {
      // EM_ASM proxying is done by passing a pointer to the address of the EM_ASM
      // content as `emAsmAddr`.  JS library proxying is done by passing an index
      // into `proxiedJSCallArgs` as `funcIndex`. If `emAsmAddr` is non-zero then
      // `funcIndex` will be ignored.
      // Additional arguments are passed after the first three are the actual
      // function arguments.
      // The serialization buffer contains the number of call params, and then
      // all the args here.
      //
      // We also pass 'proxyMode' to C separately, since C needs to look at it.
      //
      // Allocate a buffer (on the stack), which will be copied if necessary by
      // the C code.
      //
      // First passed parameter specifies the number of arguments to the function.
      // When BigInt support is enabled, we must handle types in a more complex
      // way, detecting at runtime if a value is a BigInt or not (as we have no
      // type info here). To do that, add a "prefix" before each value that
      // indicates if it is a BigInt, which effectively doubles the number of
      // values we serialize for proxying. TODO: pack this?
      var bufSize = 8 * callArgs.length * 2;
      var sp = stackSave();
      var args = stackAlloc(bufSize);
      var b = ((args)>>3);
      for (var arg of callArgs) {
        if (typeof arg == 'bigint') {
          // The prefix is non-zero to indicate a bigint.
          HEAP64[b++] = 1n;
          HEAP64[b++] = arg;
        } else {
          // The prefix is zero to indicate a JS Number.
          HEAP64[b++] = 0n;
          HEAPF64[b++] = arg;
        }
      }
      var rtn = __emscripten_run_js_on_main_thread(funcIndex, emAsmAddr, bufSize, args, proxyMode);
      stackRestore(sp);
      return rtn;
    };
  
  function _proc_exit(code) {
  if (ENVIRONMENT_IS_PTHREAD)
    return proxyToMainThread(0, 0, 1, code);
  
      EXITSTATUS = code;
      if (!keepRuntimeAlive()) {
        PThread.terminateAllThreads();
        Module['onExit']?.(code);
        ABORT = true;
      }
      quit_(code, new ExitStatus(code));
    
  }
  
  
  
  
  
  
  function exitOnMainThread(returnCode) {
  if (ENVIRONMENT_IS_PTHREAD)
    return proxyToMainThread(1, 0, 0, returnCode);
  
      _exit(returnCode);
    
  }
  
  
  /** @param {boolean|number=} implicit */
  var exitJS = (status, implicit) => {
      EXITSTATUS = status;
  
      checkUnflushedContent();
  
      if (ENVIRONMENT_IS_PTHREAD) {
        // implicit exit can never happen on a pthread
        assert(!implicit);
        // When running in a pthread we propagate the exit back to the main thread
        // where it can decide if the whole process should be shut down or not.
        // The pthread may have decided not to exit its own runtime, for example
        // because it runs a main loop, but that doesn't affect the main thread.
        exitOnMainThread(status);
        throw 'unwind';
      }
  
      // if exit() was called explicitly, warn the user if the runtime isn't actually being shut down
      if (keepRuntimeAlive() && !implicit) {
        var msg = `program exited (with status: ${status}), but keepRuntimeAlive() is set (counter=${runtimeKeepaliveCounter}) due to an async operation, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)`;
        readyPromiseReject?.(msg);
        err(msg);
      }
  
      _proc_exit(status);
    };
  var _exit = exitJS;
  
  
  
  var waitAsyncPolyfilled = (!Atomics.waitAsync || (globalThis.navigator?.userAgent && Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)||[])[2]) < 91));;
  
  function ptrToString(ptr) {
      assert(typeof ptr === 'number', `ptrToString expects a number, got ${typeof ptr}`);
      // Convert to 32-bit unsigned value
      ptr >>>= 0;
      return '0x' + ptr.toString(16).padStart(8, '0');
    }
  
  var PThread = {
  unusedWorkers:[],
  runningWorkers:[],
  tlsInitFunctions:[],
  pthreads:{
  },
  nextWorkerID:1,
  init() {
        if ((!(ENVIRONMENT_IS_PTHREAD))) {
          PThread.initMainThread();
        }
      },
  initMainThread() {
      },
  terminateAllThreads:() => {
        assert(!ENVIRONMENT_IS_PTHREAD, 'terminateAllThreads() should only be called from the main thread');
        // Attempt to kill all workers.  Sadly (at least on the web) there is no
        // way to terminate a worker synchronously, or to be notified when a
        // worker is actually terminated.  This means there is some risk that
        // pthreads will continue to be executing after `worker.terminate` has
        // returned.  For this reason, we don't call `returnWorkerToPool` here or
        // free the underlying pthread data structures.
        for (var worker of PThread.runningWorkers) {
          terminateWorker(worker);
        }
        for (var worker of PThread.unusedWorkers) {
          terminateWorker(worker);
        }
        PThread.unusedWorkers = [];
        PThread.runningWorkers = [];
        PThread.pthreads = {};
      },
  terminateRuntime:() => {
        assert(!ENVIRONMENT_IS_PTHREAD, 'terminateRuntime() should only be called from the main thread');
        PThread.terminateAllThreads();
        var pthread_ptr = _pthread_self();
        ___set_thread_state(0, 0, 0, 1);
        if (!waitAsyncPolyfilled) {
          // Break the waitAsync loop.  Note that checkMailbox will not
          // re-register since the `___set_thread_state` above causes _pthread_self
          // to return 0.
          Atomics.notify(HEAP32, ((pthread_ptr)>>2));
        }
      },
  returnWorkerToPool:(worker) => {
        // We don't want to run main thread queued calls here, since we are doing
        // some operations that leave the worker queue in an invalid state until
        // we are completely done (it would be bad if free() ends up calling a
        // queued pthread_create which looks at the global data structures we are
        // modifying). To achieve that, defer the free() until the very end, when
        // we are all done.
        var pthread_ptr = worker.pthread_ptr;
        delete PThread.pthreads[pthread_ptr];
        // Note: worker is intentionally not terminated so the pool can
        // dynamically grow.
        PThread.unusedWorkers.push(worker);
        PThread.runningWorkers.splice(PThread.runningWorkers.indexOf(worker), 1);
        // Not a running Worker anymore
        // Detach the worker from the pthread object, and return it to the
        // worker pool as an unused worker.
        worker.pthread_ptr = 0;
  
        // Finally, free the underlying (and now-unused) pthread structure in
        // linear memory.
        __emscripten_thread_free_data(pthread_ptr);
      },
  threadInitTLS() {
        // Call thread init functions (these are the _emscripten_tls_init for each
        // module loaded.
        PThread.tlsInitFunctions.forEach((f) => f());
      },
  loadWasmModuleToWorker:(worker) => new Promise((onFinishedLoading) => {
        worker.onmessage = (e) => {
          var d = e['data'];
          var cmd = d.cmd;
  
          // If this message is intended to a recipient that is not the main
          // thread, forward it to the target thread.
          if (d.targetThread && d.targetThread != _pthread_self()) {
            var targetWorker = PThread.pthreads[d.targetThread];
            if (targetWorker) {
              targetWorker.postMessage(d, d.transferList);
            } else {
              err(`worker sent message (${cmd}) to pthread (${d.targetThread}) that no longer exists`);
            }
            return;
          }
  
          if (cmd === 'checkMailbox') {
            checkMailbox();
          } else if (cmd === 'spawnThread') {
            spawnThread(d);
          } else if (cmd === 'cleanupThread') {
            // cleanupThread needs to be run via callUserCallback since it calls
            // back into user code to free thread data. Without this it's possible
            // the unwind or ExitStatus exception could escape here.
            callUserCallback(() => cleanupThread(d.thread));
          } else if (cmd === 'loaded') {
            worker.loaded = true;
            onFinishedLoading(worker);
          } else if (d.target === 'setimmediate') {
            // Worker wants to postMessage() to itself to implement setImmediate()
            // emulation.
            worker.postMessage(d);
          } else if (cmd === 'callHandler') {
            Module[d.handler](...d.args);
          } else if (cmd) {
            // The received message looks like something that should be handled by this message
            // handler, (since there is a e.data.cmd field present), but is not one of the
            // recognized commands:
            err(`worker sent an unknown command ${cmd}`);
          }
        };
  
        worker.onerror = (e) => {
          var message = 'worker sent an error!';
          if (worker.pthread_ptr) {
            message = `Pthread ${ptrToString(worker.pthread_ptr)} sent an error!`;
          }
          err(`${message} ${e.filename}:${e.lineno}: ${e.message}`);
          throw e;
        };
  
        assert(wasmMemory instanceof WebAssembly.Memory, 'wasmMemory should have been loaded by now');
        assert(wasmModule instanceof WebAssembly.Module, 'wasmModule should have been loaded by now');
  
        // When running on a pthread, none of the incoming parameters on the module
        // object are present. Proxy known handlers back to the main thread if specified.
        var handlers = [];
        var knownHandlers = [
          'onExit',
          'onAbort',
          'print',
          'printErr',
        ];
        for (var handler of knownHandlers) {
          if (Module.propertyIsEnumerable(handler)) {
            handlers.push(handler);
          }
        }
  
        // Ask the new worker to load up the Emscripten-compiled page. This is a heavy operation.
        worker.postMessage({
          cmd: 'load',
          handlers: handlers,
          wasmMemory,
          wasmModule,
          'workerID': worker.workerID,
        });
      }),
  allocateUnusedWorker() {
        var worker;
        // If we're using module output, use bundler-friendly pattern.
          if (Module['mainScriptUrlOrBlob']) {
            var pthreadMainJs = Module['mainScriptUrlOrBlob'];
            if (typeof pthreadMainJs != 'string') {
              pthreadMainJs = URL.createObjectURL(pthreadMainJs);
            }
            worker = new Worker(pthreadMainJs, {
          'type': 'module',
          // This is the way that we signal to the Web Worker that it is hosting
          // a pthread.
          'name': 'em-pthread-' + PThread.nextWorkerID,
  });
          } else
        // We need to generate the URL with import.meta.url as the base URL of the JS file
        // instead of just using new URL(import.meta.url) because bundlers only recognize
        // the first case in their bundling step. The latter ends up producing an invalid
        // URL to import from the server (e.g., for webpack the file:// path).
        // See https://github.com/webpack/webpack/issues/12638
        worker = new Worker(new URL('upsampled_peak.mjs', import.meta.url), {
          'type': 'module',
          // This is the way that we signal to the Web Worker that it is hosting
          // a pthread.
          'name': 'em-pthread-' + PThread.nextWorkerID,
  });
        worker.workerID = PThread.nextWorkerID++;
        PThread.unusedWorkers.push(worker);
      },
  getNewWorker() {
        if (PThread.unusedWorkers.length == 0) {
  // PTHREAD_POOL_SIZE_STRICT should show a warning and, if set to level `2`, return from the function.
  // However, if we're in Node.js, then we can create new workers on the fly and PTHREAD_POOL_SIZE_STRICT
  // should be ignored altogether.
              err('Tried to spawn a new thread, but the thread pool is exhausted.\n' +
              'This might result in a deadlock unless some threads eventually exit or the code explicitly breaks out to the event loop.\n' +
              'If you want to increase the pool size, use setting `-sPTHREAD_POOL_SIZE=...`.'
                + '\nIf you want to throw an explicit error instead of the risk of deadlocking in those cases, use setting `-sPTHREAD_POOL_SIZE_STRICT=2`.'
              );
          PThread.allocateUnusedWorker();
          PThread.loadWasmModuleToWorker(PThread.unusedWorkers[0]);
        }
        return PThread.unusedWorkers.pop();
      },
  };

  var onPostRuns = [];
  var addOnPostRun = (cb) => onPostRuns.push(cb);



  
  
  function establishStackSpace(pthread_ptr) {
      var stackHigh = HEAPU32[(((pthread_ptr)+(48))>>2)];
      var stackSize = HEAPU32[(((pthread_ptr)+(52))>>2)];
      var stackLow = stackHigh - stackSize;
      assert(stackHigh != 0);
      assert(stackLow != 0);
      assert(stackHigh > stackLow, 'stackHigh must be higher then stackLow');
      // Set stack limits used by `emscripten/stack.h` function.  These limits are
      // cached in wasm-side globals to make checks as fast as possible.
      _emscripten_stack_set_limits(stackHigh, stackLow);
  
      // Call inside wasm module to set up the stack frame for this pthread in wasm module scope
      stackRestore(stackHigh);
  
      // Write the stack cookie last, after we have set up the proper bounds and
      // current position of the stack.
      writeStackCookie();
    }

  
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

  
  
  
  
  var wasmTableMirror = [];
  
  
  var getWasmTableEntry = (funcPtr) => {
      var func = wasmTableMirror[funcPtr];
      if (!func) {
        /** @suppress {checkTypes} */
        wasmTableMirror[funcPtr] = func = wasmTable.get(funcPtr);
      }
      /** @suppress {checkTypes} */
      assert(wasmTable.get(funcPtr) == func, 'table mirror is out of date');
      return func;
    };
  var invokeEntryPoint = (ptr, arg) => {
      // An old thread on this worker may have been canceled without returning the
      // `runtimeKeepaliveCounter` to zero. Reset it now so the new thread won't
      // be affected.
      runtimeKeepaliveCounter = 0;
  
      // Same for noExitRuntime.  The default for pthreads should always be false
      // otherwise pthreads would never complete and attempts to pthread_join to
      // them would block forever.
      // pthreads can still choose to set `noExitRuntime` explicitly, or
      // call emscripten_unwind_to_js_event_loop to extend their lifetime beyond
      // their main function.  See comment in src/runtime_pthread.js for more.
      noExitRuntime = 0;
  
      // pthread entry points are always of signature 'void *ThreadMain(void *arg)'
      // Native codebases sometimes spawn threads with other thread entry point
      // signatures, such as void ThreadMain(void *arg), void *ThreadMain(), or
      // void ThreadMain().  That is not acceptable per C/C++ specification, but
      // x86 compiler ABI extensions enable that to work. If you find the
      // following line to crash, either change the signature to "proper" void
      // *ThreadMain(void *arg) form, or try linking with the Emscripten linker
      // flag -sEMULATE_FUNCTION_POINTER_CASTS to add in emulation for this x86
      // ABI extension.
  
      var result = getWasmTableEntry(ptr)(arg);
  
      checkStackCookie();
      function finish(result) {
        // In MINIMAL_RUNTIME the noExitRuntime concept does not apply to
        // pthreads. To exit a pthread with live runtime, use the function
        // emscripten_unwind_to_js_event_loop() in the pthread body.
        if (keepRuntimeAlive()) {
          EXITSTATUS = result;
          return;
        }
        __emscripten_thread_exit(result);
      }
      finish(result);
    };

  var noExitRuntime = true;


  var registerTLSInit = (tlsInitFunc) => PThread.tlsInitFunctions.push(tlsInitFunc);

  
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



  var warnOnce = (text) => {
      warnOnce.shown ||= {};
      if (!warnOnce.shown[text]) {
        warnOnce.shown[text] = 1;
        err(text);
      }
    };

  var wasmMemory;

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
        return UTF8Decoder.decode(heapOrArray.buffer instanceof ArrayBuffer ? heapOrArray.subarray(idx, endPtr) : heapOrArray.slice(idx, endPtr));
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

  var __emscripten_init_main_thread_js = (tb) => {
      // Pass the thread address to the native code where they are stored in wasm
      // globals which act as a form of TLS. Global constructors trying
      // to access this value will read the wrong value, but that is UB anyway.
      __emscripten_thread_init(
        tb,
        /*is_main=*/!ENVIRONMENT_IS_WORKER,
        /*is_runtime=*/1,
        /*can_block=*/!ENVIRONMENT_IS_WEB,
        /*default_stacksize=*/65536,
        /*start_profiling=*/false,
      );
      PThread.threadInitTLS();
    };

  var handleException = (e) => {
      // Certain exception types we do not treat as errors since they are used for
      // internal control flow.
      // 1. ExitStatus, which is thrown by exit()
      // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
      //    that wish to return to JS event loop.
      if (e instanceof ExitStatus || e == 'unwind') {
        return EXITSTATUS;
      }
      checkStackCookie();
      if (e instanceof WebAssembly.RuntimeError) {
        if (_emscripten_stack_get_current() <= 0) {
          err('Stack overflow detected.  You can try increasing -sSTACK_SIZE (currently set to 65536)');
        }
      }
      quit_(1, e);
    };
  
  
  
  
  var maybeExit = () => {
      if (!keepRuntimeAlive()) {
        try {
          if (ENVIRONMENT_IS_PTHREAD) {
            // exit the current thread, but only if there is one active.
            // TODO(https://github.com/emscripten-core/emscripten/issues/25076):
            // Unify this check with the runtimeExited check above
            if (_pthread_self()) __emscripten_thread_exit(EXITSTATUS);
            return;
          }
          _exit(EXITSTATUS);
        } catch (e) {
          handleException(e);
        }
      }
    };
  var callUserCallback = (func) => {
      if (ABORT) {
        err('user callback triggered after runtime exited or application aborted.  Ignoring.');
        return;
      }
      try {
        return func();
      } catch (e) {
        handleException(e);
      } finally {
        maybeExit();
      }
    };
  
  
  
  
  
  var __emscripten_thread_mailbox_await = (pthread_ptr) => {
      if (!waitAsyncPolyfilled) {
        // Wait on the pthread's initial self-pointer field because it is easy and
        // safe to access from sending threads that need to notify the waiting
        // thread.
        // Note: Under wasm64 only the low 32-bit of the pthread_ptr are
        // read/compared here, but we don't actually care about the exact values
        // here as long as they match.
        var wait = Atomics.waitAsync(HEAP32, ((pthread_ptr)>>2), pthread_ptr);
        assert(wait.async);
        wait.value.then(checkMailbox);
        var waitingAsync = pthread_ptr + 120;
        Atomics.store(HEAP32, ((waitingAsync)>>2), 1);
      }
      // If `Atomics.waitAsync` is not implemented, then we will always fall back
      // to postMessage and there is no need to do anything here.
    };
  
  var checkMailbox = () => {
      // checkMailbox can be called after the pthread has shut down. See
      // Pthread.terminateRuntime().
      // In this case we return silently without re-registering using waitAsync.
      // Perhaps there is a more universal way we can detect runtime has exited.
      // TODO(https://github.com/emscripten-core/emscripten/issues/25076)
      var pthread_ptr = _pthread_self();
      if (!pthread_ptr) return;
      callUserCallback(() => {
        // If we are using Atomics.waitAsync as our notification mechanism, wait
        // for a notification before processing the mailbox to avoid missing any
        // work that could otherwise arrive after we've finished processing the
        // mailbox and before we're ready for the next notification.
        __emscripten_thread_mailbox_await(pthread_ptr);
        __emscripten_check_mailbox();
      });
    };
  
  var __emscripten_notify_mailbox_postmessage = (targetThread, currThreadId) => {
      if (targetThread == currThreadId) {
        setTimeout(checkMailbox);
      } else if (ENVIRONMENT_IS_PTHREAD) {
        postMessage({targetThread, cmd: 'checkMailbox'});
      } else {
        var worker = PThread.pthreads[targetThread];
        if (!worker) {
          err(`Cannot send message to thread with ID ${targetThread}, unknown thread ID!`);
          return;
        }
        worker.postMessage({cmd: 'checkMailbox'});
      }
    };

  
  
  var proxiedJSCallArgs = [];
  
  var __emscripten_receive_on_main_thread_js = (funcIndex, emAsmAddr, callingThread, bufSize, args, ctx, ctxArgs) => {
      // Sometimes we need to backproxy events to the calling thread (e.g.
      // HTML5 DOM events handlers such as
      // emscripten_set_mousemove_callback()), so keep track in a globally
      // accessible variable about the thread that initiated the proxying.
      proxiedJSCallArgs.length = 0;
      var b = ((args)>>3);
      var end = ((args + bufSize)>>3);
      while (b < end) {
        var arg;
        if (HEAP64[b++]) {
          // It's a BigInt.
          arg = HEAP64[b++];
        } else {
          // It's a Number.
          arg = HEAPF64[b++];
        }
        proxiedJSCallArgs.push(arg);
      }
      // Proxied JS library funcs use funcIndex and EM_ASM functions use emAsmAddr
      assert(!emAsmAddr);
      var func = proxiedFunctionTable[funcIndex];
      assert(!(funcIndex && emAsmAddr));
      assert(func.length == proxiedJSCallArgs.length, 'Call args mismatch in _emscripten_receive_on_main_thread_js');
      PThread.currentProxiedOperationCallerThread = callingThread;
      var rtn = func(...proxiedJSCallArgs);
      PThread.currentProxiedOperationCallerThread = 0;
      if (ctx) {
        rtn.then((rtn) => __emscripten_run_js_on_main_thread_done(ctx, ctxArgs, rtn));
        return;
      }
  
      // Proxied functions can return any type except bigint.  All other types
      // coerce to f64/double (the return type of this function in C) but not
      // bigint.
      assert(typeof rtn != "bigint");
      return rtn;
    };

  var __emscripten_thread_cleanup = (thread) => {
      // Called when a thread needs to be cleaned up so it can be reused.
      // A thread is considered reusable when it either returns from its
      // entry point, calls pthread_exit, or acts upon a cancellation.
      // Detached threads are responsible for calling this themselves,
      // otherwise pthread_join is responsible for calling this.
      if (!ENVIRONMENT_IS_PTHREAD) cleanupThread(thread);
      else postMessage({ cmd: 'cleanupThread', thread });
    };


  var __emscripten_thread_set_strongref = (thread) => {
      // Called when a thread needs to be strongly referenced.
      // Currently only used for:
      // - keeping the "main" thread alive in PROXY_TO_PTHREAD mode;
      // - crashed threads that need to propagate the uncaught exception
      //   back to the main thread.
    };

  var _emscripten_get_now = () => performance.timeOrigin + performance.now();
  
  var _emscripten_date_now = () => Date.now();
  
  var nowIsMonotonic = 1;
  
  var checkWasiClock = (clock_id) => clock_id >= 0 && clock_id <= 3;
  
  var INT53_MAX = 9007199254740992;
  
  var INT53_MIN = -9007199254740992;
  var bigintToI53Checked = (num) => (num < INT53_MIN || num > INT53_MAX) ? NaN : Number(num);
  function _clock_time_get(clk_id, ignored_precision, ptime) {
    ignored_precision = bigintToI53Checked(ignored_precision);
  
  
      if (!checkWasiClock(clk_id)) {
        return 28;
      }
      var now;
      // all wasi clocks but realtime are monotonic
      if (clk_id === 0) {
        now = _emscripten_date_now();
      } else if (nowIsMonotonic) {
        now = _emscripten_get_now();
      } else {
        return 52;
      }
      // "now" is in ms, and wasi times are in ns.
      var nsec = Math.round(now * 1000 * 1000);
      HEAP64[((ptime)>>3)] = BigInt(nsec);
      return 0;
    ;
  }

  
  var _emscripten_check_blocking_allowed = () => {
  
      if (ENVIRONMENT_IS_WORKER) return; // Blocking in a worker/pthread is fine.
  
      warnOnce('Blocking on the main thread is very dangerous, see https://emscripten.org/docs/porting/pthreads.html#blocking-on-the-main-browser-thread');
  
    };

  var runtimeKeepalivePush = () => {
      runtimeKeepaliveCounter += 1;
    };
  var _emscripten_exit_with_live_runtime = () => {
      runtimeKeepalivePush();
      throw 'unwind';
    };


  var abortOnCannotGrowMemory = (requestedSize) => {
      abort(`Cannot enlarge memory arrays to size ${requestedSize} bytes (OOM). Either (1) compile with -sINITIAL_MEMORY=X with X higher than the current value ${HEAP8.length}, (2) compile with -sALLOW_MEMORY_GROWTH which allows increasing the size at runtime, or (3) if you want malloc to return NULL (0) instead of this abort, compile with -sABORTING_MALLOC=0`);
    };
  var _emscripten_resize_heap = (requestedSize) => {
      var oldSize = HEAPU8.length;
      // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
      requestedSize >>>= 0;
      abortOnCannotGrowMemory(requestedSize);
    };


  var SYSCALLS = {
  varargs:undefined,
  getStr(ptr) {
        var ret = UTF8ToString(ptr);
        return ret;
      },
  };
  
  
  function _fd_close(fd) {
  if (ENVIRONMENT_IS_PTHREAD)
    return proxyToMainThread(2, 0, 1, fd);
  
      abort('fd_close called without SYSCALLS_REQUIRE_FILESYSTEM');
    
  }
  

  
  
  function _fd_seek(fd, offset, whence, newOffset) {
  if (ENVIRONMENT_IS_PTHREAD)
    return proxyToMainThread(3, 0, 1, fd, offset, whence, newOffset);
  
    offset = bigintToI53Checked(offset);
  
  
      return 70;
    ;
  
  }
  

  var printCharBuffers = [null,[],[]];
  
  var printChar = (stream, curr) => {
      var buffer = printCharBuffers[stream];
      assert(buffer);
      if (curr === 0 || curr === 10) {
        (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
        buffer.length = 0;
      } else {
        buffer.push(curr);
      }
    };
  
  var flush_NO_FILESYSTEM = () => {
      // flush anything remaining in the buffers during shutdown
      _fflush(0);
      if (printCharBuffers[1].length) printChar(1, 10);
      if (printCharBuffers[2].length) printChar(2, 10);
    };
  
  
  
  
  function _fd_write(fd, iov, iovcnt, pnum) {
  if (ENVIRONMENT_IS_PTHREAD)
    return proxyToMainThread(4, 0, 1, fd, iov, iovcnt, pnum);
  
      // hack to support printf in SYSCALLS_REQUIRE_FILESYSTEM=0
      var num = 0;
      for (var i = 0; i < iovcnt; i++) {
        var ptr = HEAPU32[((iov)>>2)];
        var len = HEAPU32[(((iov)+(4))>>2)];
        iov += 8;
        for (var j = 0; j < len; j++) {
          printChar(fd, HEAPU8[ptr+j]);
        }
        num += len;
      }
      HEAPU32[((pnum)>>2)] = num;
      return 0;
    
  }
  

PThread.init();;
// End JS library code

// include: postlibrary.js
// This file is included after the automatically-generated JS library code
// but before the wasm module is created.

{
  // With WASM_ESM_INTEGRATION this has to happen at the top level and not
  // delayed until processModuleArgs.
  initMemory();

  // Begin ATMODULES hooks
  if (Module['noExitRuntime']) noExitRuntime = Module['noExitRuntime'];
if (Module['print']) out = Module['print'];
if (Module['printErr']) err = Module['printErr'];
if (Module['wasmBinary']) wasmBinary = Module['wasmBinary'];

Module['FS_createDataFile'] = FS.createDataFile;
Module['FS_createPreloadedFile'] = FS.createPreloadedFile;

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
  'getTempRet0',
  'setTempRet0',
  'createNamedFunction',
  'zeroMemory',
  'getHeapMax',
  'growMemory',
  'withStackSave',
  'strError',
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
  'runtimeKeepalivePop',
  'asyncLoad',
  'asmjsMangle',
  'alignMemory',
  'mmapAlloc',
  'HandleAllocator',
  'getUniqueRunDependency',
  'addRunDependency',
  'removeRunDependency',
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
  'stringToUTF8Array',
  'stringToUTF8',
  'lengthBytesUTF8',
  'intArrayFromString',
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
  'setCanvasElementSizeCallingThread',
  'setCanvasElementSizeMainThread',
  'setCanvasElementSize',
  'getCanvasSizeCallingThread',
  'getCanvasSizeMainThread',
  'getCanvasElementSize',
  'jsStackTrace',
  'getCallstack',
  'convertPCtoSourceLocation',
  'getEnvStrings',
  'wasiRightsToMuslOFlags',
  'wasiOFlagsToMuslOFlags',
  'initRandomFill',
  'randomFill',
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
  'base64Decode',
  'getSocketFromFD',
  'getSocketAddress',
  'FS_createPreloadedFile',
  'FS_preloadFile',
  'FS_modeStringToFlags',
  'FS_getMode',
  'FS_fileDataToTypedArray',
  'FS_stdin_getChar',
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
  'emscripten_webgl_destroy_context_before_on_calling_thread',
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
  'HEAPU8',
  'HEAP16',
  'HEAPU16',
  'HEAP32',
  'HEAPU32',
  'HEAPF64',
  'HEAP64',
  'HEAPU64',
  'stackSave',
  'stackRestore',
  'stackAlloc',
  'ptrToString',
  'exitJS',
  'abortOnCannotGrowMemory',
  'ENV',
  'ERRNO_CODES',
  'DNS',
  'Protocols',
  'Sockets',
  'timers',
  'warnOnce',
  'readEmAsmArgsArray',
  'handleException',
  'keepRuntimeAlive',
  'runtimeKeepalivePush',
  'callUserCallback',
  'maybeExit',
  'wasmTable',
  'wasmMemory',
  'noExitRuntime',
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
  'UTF16Decoder',
  'JSEvents',
  'specialHTMLTargets',
  'findCanvasEventTarget',
  'currentFullscreenStrategy',
  'restoreOldWindowedStyle',
  'UNWIND_CACHE',
  'ExitStatus',
  'checkWasiClock',
  'flush_NO_FILESYSTEM',
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
  'FS_stdin_getChar_buffer',
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
  'waitAsyncPolyfilled',
  'print',
  'printErr',
  'jstoi_s',
  'PThread',
  'terminateWorker',
  'cleanupThread',
  'registerTLSInit',
  'spawnThread',
  'exitOnMainThread',
  'proxyToMainThread',
  'proxiedJSCallArgs',
  'invokeEntryPoint',
  'checkMailbox',
];
unexportedSymbols.forEach(unexportedRuntimeSymbol);

  // End runtime exports
  // Begin JS library exports
  // End JS library exports

// end include: postlibrary.js


// proxiedFunctionTable specifies the list of functions that can be called
// either synchronously or asynchronously from other threads in postMessage()d
// or internally queued events. This way a pthread in a Worker can synchronously
// access e.g. the DOM on the main thread.
var proxiedFunctionTable = [
  _proc_exit,
  exitOnMainThread,
  _fd_close,
  _fd_seek,
  _fd_write
];

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
var _getInstantaneousPeaks = Module['_getInstantaneousPeaks'] = makeInvalidEarlyAccess('_getInstantaneousPeaks');
var _getHeldPeaks = Module['_getHeldPeaks'] = makeInvalidEarlyAccess('_getHeldPeaks');
var _getInputArray = Module['_getInputArray'] = makeInvalidEarlyAccess('_getInputArray');
var _init = Module['_init'] = makeInvalidEarlyAccess('_init');
var _lanczosInterpolatedPeak = Module['_lanczosInterpolatedPeak'] = makeInvalidEarlyAccess('_lanczosInterpolatedPeak');
var __emscripten_tls_init = makeInvalidEarlyAccess('__emscripten_tls_init');
var _pthread_self = makeInvalidEarlyAccess('_pthread_self');
var __emscripten_thread_init = makeInvalidEarlyAccess('__emscripten_thread_init');
var ___set_thread_state = makeInvalidEarlyAccess('___set_thread_state');
var __emscripten_thread_crashed = makeInvalidEarlyAccess('__emscripten_thread_crashed');
var _fflush = makeInvalidEarlyAccess('_fflush');
var __emscripten_run_js_on_main_thread_done = makeInvalidEarlyAccess('__emscripten_run_js_on_main_thread_done');
var __emscripten_run_js_on_main_thread = makeInvalidEarlyAccess('__emscripten_run_js_on_main_thread');
var __emscripten_thread_free_data = makeInvalidEarlyAccess('__emscripten_thread_free_data');
var __emscripten_thread_exit = makeInvalidEarlyAccess('__emscripten_thread_exit');
var _strerror = makeInvalidEarlyAccess('_strerror');
var __emscripten_check_mailbox = makeInvalidEarlyAccess('__emscripten_check_mailbox');
var _emscripten_stack_get_end = makeInvalidEarlyAccess('_emscripten_stack_get_end');
var _emscripten_stack_get_base = makeInvalidEarlyAccess('_emscripten_stack_get_base');
var _emscripten_stack_init = makeInvalidEarlyAccess('_emscripten_stack_init');
var _emscripten_stack_set_limits = makeInvalidEarlyAccess('_emscripten_stack_set_limits');
var _emscripten_stack_get_free = makeInvalidEarlyAccess('_emscripten_stack_get_free');
var __emscripten_stack_restore = makeInvalidEarlyAccess('__emscripten_stack_restore');
var __emscripten_stack_alloc = makeInvalidEarlyAccess('__emscripten_stack_alloc');
var _emscripten_stack_get_current = makeInvalidEarlyAccess('_emscripten_stack_get_current');
var __indirect_function_table = makeInvalidEarlyAccess('__indirect_function_table');
var wasmTable = makeInvalidEarlyAccess('wasmTable');

function assignWasmExports(wasmExports) {
  assert(typeof wasmExports['getInstantaneousPeaks'] != 'undefined', 'missing Wasm export: getInstantaneousPeaks');
  assert(typeof wasmExports['getHeldPeaks'] != 'undefined', 'missing Wasm export: getHeldPeaks');
  assert(typeof wasmExports['getInputArray'] != 'undefined', 'missing Wasm export: getInputArray');
  assert(typeof wasmExports['init'] != 'undefined', 'missing Wasm export: init');
  assert(typeof wasmExports['lanczosInterpolatedPeak'] != 'undefined', 'missing Wasm export: lanczosInterpolatedPeak');
  assert(typeof wasmExports['_emscripten_tls_init'] != 'undefined', 'missing Wasm export: _emscripten_tls_init');
  assert(typeof wasmExports['pthread_self'] != 'undefined', 'missing Wasm export: pthread_self');
  assert(typeof wasmExports['_emscripten_thread_init'] != 'undefined', 'missing Wasm export: _emscripten_thread_init');
  assert(typeof wasmExports['__set_thread_state'] != 'undefined', 'missing Wasm export: __set_thread_state');
  assert(typeof wasmExports['_emscripten_thread_crashed'] != 'undefined', 'missing Wasm export: _emscripten_thread_crashed');
  assert(typeof wasmExports['fflush'] != 'undefined', 'missing Wasm export: fflush');
  assert(typeof wasmExports['_emscripten_run_js_on_main_thread_done'] != 'undefined', 'missing Wasm export: _emscripten_run_js_on_main_thread_done');
  assert(typeof wasmExports['_emscripten_run_js_on_main_thread'] != 'undefined', 'missing Wasm export: _emscripten_run_js_on_main_thread');
  assert(typeof wasmExports['_emscripten_thread_free_data'] != 'undefined', 'missing Wasm export: _emscripten_thread_free_data');
  assert(typeof wasmExports['_emscripten_thread_exit'] != 'undefined', 'missing Wasm export: _emscripten_thread_exit');
  assert(typeof wasmExports['strerror'] != 'undefined', 'missing Wasm export: strerror');
  assert(typeof wasmExports['_emscripten_check_mailbox'] != 'undefined', 'missing Wasm export: _emscripten_check_mailbox');
  assert(typeof wasmExports['emscripten_stack_get_end'] != 'undefined', 'missing Wasm export: emscripten_stack_get_end');
  assert(typeof wasmExports['emscripten_stack_get_base'] != 'undefined', 'missing Wasm export: emscripten_stack_get_base');
  assert(typeof wasmExports['emscripten_stack_init'] != 'undefined', 'missing Wasm export: emscripten_stack_init');
  assert(typeof wasmExports['emscripten_stack_set_limits'] != 'undefined', 'missing Wasm export: emscripten_stack_set_limits');
  assert(typeof wasmExports['emscripten_stack_get_free'] != 'undefined', 'missing Wasm export: emscripten_stack_get_free');
  assert(typeof wasmExports['_emscripten_stack_restore'] != 'undefined', 'missing Wasm export: _emscripten_stack_restore');
  assert(typeof wasmExports['_emscripten_stack_alloc'] != 'undefined', 'missing Wasm export: _emscripten_stack_alloc');
  assert(typeof wasmExports['emscripten_stack_get_current'] != 'undefined', 'missing Wasm export: emscripten_stack_get_current');
  assert(typeof wasmExports['__indirect_function_table'] != 'undefined', 'missing Wasm export: __indirect_function_table');
  _getInstantaneousPeaks = Module['_getInstantaneousPeaks'] = createExportWrapper('getInstantaneousPeaks', 0);
  _getHeldPeaks = Module['_getHeldPeaks'] = createExportWrapper('getHeldPeaks', 0);
  _getInputArray = Module['_getInputArray'] = createExportWrapper('getInputArray', 0);
  _init = Module['_init'] = createExportWrapper('init', 4);
  _lanczosInterpolatedPeak = Module['_lanczosInterpolatedPeak'] = createExportWrapper('lanczosInterpolatedPeak', 0);
  __emscripten_tls_init = createExportWrapper('_emscripten_tls_init', 0);
  _pthread_self = wasmExports['pthread_self'];
  __emscripten_thread_init = createExportWrapper('_emscripten_thread_init', 6);
  ___set_thread_state = createExportWrapper('__set_thread_state', 4);
  __emscripten_thread_crashed = createExportWrapper('_emscripten_thread_crashed', 0);
  _fflush = createExportWrapper('fflush', 1);
  __emscripten_run_js_on_main_thread_done = createExportWrapper('_emscripten_run_js_on_main_thread_done', 3);
  __emscripten_run_js_on_main_thread = createExportWrapper('_emscripten_run_js_on_main_thread', 5);
  __emscripten_thread_free_data = createExportWrapper('_emscripten_thread_free_data', 1);
  __emscripten_thread_exit = createExportWrapper('_emscripten_thread_exit', 1);
  _strerror = createExportWrapper('strerror', 1);
  __emscripten_check_mailbox = createExportWrapper('_emscripten_check_mailbox', 0);
  _emscripten_stack_get_end = wasmExports['emscripten_stack_get_end'];
  _emscripten_stack_get_base = wasmExports['emscripten_stack_get_base'];
  _emscripten_stack_init = wasmExports['emscripten_stack_init'];
  _emscripten_stack_set_limits = wasmExports['emscripten_stack_set_limits'];
  _emscripten_stack_get_free = wasmExports['emscripten_stack_get_free'];
  __emscripten_stack_restore = wasmExports['_emscripten_stack_restore'];
  __emscripten_stack_alloc = wasmExports['_emscripten_stack_alloc'];
  _emscripten_stack_get_current = wasmExports['emscripten_stack_get_current'];
  __indirect_function_table = wasmTable = wasmExports['__indirect_function_table'];
}

  var wasmImports;
  function assignWasmImports() {
    wasmImports = {
    /** @export */
    __assert_fail: ___assert_fail,
    /** @export */
    _abort_js: __abort_js,
    /** @export */
    _emscripten_init_main_thread_js: __emscripten_init_main_thread_js,
    /** @export */
    _emscripten_notify_mailbox_postmessage: __emscripten_notify_mailbox_postmessage,
    /** @export */
    _emscripten_receive_on_main_thread_js: __emscripten_receive_on_main_thread_js,
    /** @export */
    _emscripten_thread_cleanup: __emscripten_thread_cleanup,
    /** @export */
    _emscripten_thread_mailbox_await: __emscripten_thread_mailbox_await,
    /** @export */
    _emscripten_thread_set_strongref: __emscripten_thread_set_strongref,
    /** @export */
    clock_time_get: _clock_time_get,
    /** @export */
    emscripten_check_blocking_allowed: _emscripten_check_blocking_allowed,
    /** @export */
    emscripten_exit_with_live_runtime: _emscripten_exit_with_live_runtime,
    /** @export */
    emscripten_get_now: _emscripten_get_now,
    /** @export */
    emscripten_resize_heap: _emscripten_resize_heap,
    /** @export */
    exit: _exit,
    /** @export */
    fd_close: _fd_close,
    /** @export */
    fd_seek: _fd_seek,
    /** @export */
    fd_write: _fd_write,
    /** @export */
    memory: wasmMemory
  };
  }


// include: postamble.js
// === Auto-generated postamble setup entry stuff ===

var calledRun;

function stackCheckInit() {
  // This is normally called automatically during __wasm_call_ctors but need to
  // get these values before even running any of the ctors so we call it redundantly
  // here.
  // See $establishStackSpace for the equivalent code that runs on a thread
  assert(!ENVIRONMENT_IS_PTHREAD);
  _emscripten_stack_init();
  // TODO(sbc): Move writeStackCookie to native to to avoid this.
  writeStackCookie();
}

function run() {

  if ((ENVIRONMENT_IS_PTHREAD)) {
    readyPromiseResolve?.(Module);
    initRuntime();
    return;
  }

  stackCheckInit();

  preRun();

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
    flush_NO_FILESYSTEM();
  } catch(e) {}
  out = oldOut;
  err = oldErr;
  if (has) {
    warnOnce('stdio streams had content in them that was not flushed. you should set EXIT_RUNTIME to 1 (see the Emscripten FAQ), or make sure to emit a newline when you printf etc.');
    warnOnce('(this may also be due to not including full filesystem support - try building with -sFORCE_FILESYSTEM)');
  }
}

var wasmExports;

if ((!(ENVIRONMENT_IS_PTHREAD))) {
// Call createWasm on startup if we are the main thread.
// Worker threads call this once they receive the module via postMessage

// In modularize mode the generated code is within a factory function so we
// can use await here (since it's not top-level-await).
wasmExports = await (createWasm());

run();

}

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

// Create code for detecting if we are running in a pthread.
// Normally this detection is done when the module is itself run but
// when running in MODULARIZE mode we need use this to know if we should
// run the module constructor on startup (true only for pthreads).
var isPthread = globalThis.name?.startsWith('em-pthread');

isPthread && createModule();

// to be merged with the emscripted-generated module via extern-post-js
// * That means you need to build the wasm again if you modify this. *
export class PeakFindingProcessor extends AudioWorkletProcessor {
  static RENDER_QUANTUM_SIZE = 128

  constructor(options) {
    super(options)
    createModule().then((Module) => {
      const channelCount = options.channelCount ?? 1
      Module._init(
        channelCount,
        options.processorOptions?.updateSampleCount ?? Math.round((100 * sampleRate) / 1000), //100ms
        options.processorOptions?.holdSampleCount ?? Math.round(1.5 * sampleRate), //1.5s,
        PeakFindingProcessor.RENDER_QUANTUM_SIZE,
      )
      const instantaneousPeaksPointer = Module._getInstantaneousPeaks()
      this.instantaneousPeaks = Module.HEAPF32.subarray(
        instantaneousPeaksPointer / Float32Array.BYTES_PER_ELEMENT,
        instantaneousPeaksPointer / Float32Array.BYTES_PER_ELEMENT + channelCount,
      )
      const heldPeaksPointer = Module._getHeldPeaks()
      this.heldPeaks = Module.HEAPF32.subarray(
        heldPeaksPointer / Float32Array.BYTES_PER_ELEMENT,
        heldPeaksPointer / Float32Array.BYTES_PER_ELEMENT + channelCount,
      )
      const wasmInputPointer = Module._getInputArray()
      this.wasmInput = Module.HEAPF32.subarray(
        wasmInputPointer / Float32Array.BYTES_PER_ELEMENT,
        wasmInputPointer / Float32Array.BYTES_PER_ELEMENT + PeakFindingProcessor.RENDER_QUANTUM_SIZE * channelCount,
      )
      this.Module = Module
      this.port.postMessage({
        instantaneousPeaks: this.instantaneousPeaks,
        heldPeaks: this.heldPeaks,
      })
    })
  }

  process([inputs], [outputs]) {
    if (!!this.wasmInput && !!inputs[0]) {
      for (let i = 0; i < PeakFindingProcessor.RENDER_QUANTUM_SIZE; ++i) {
        for (let channel = 0; channel < inputs.length; ++channel) {
          this.wasmInput[i * inputs.length + channel] = inputs[channel][i]
          outputs[channel][i] = inputs[channel][i]
        }
      }
      this.Module._lanczosInterpolatedPeak()
    }
    return true
  }
}

registerProcessor('PeakFindingProcessor', PeakFindingProcessor)
