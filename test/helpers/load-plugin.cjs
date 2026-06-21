// Loads the real objcubed.js Blockbench plugin under Node so its pure functions
// can be unit-tested without Blockbench/Electron.
//
// The plugin is one big IIFE `(function(){ 'use strict'; ... })();`. At load
// time the ONLY Blockbench API it invokes is `BBPlugin.register(...)`; every
// other global (Action, MenuBar, Dialog, Blockbench, Cube, Mesh, Property,
// Undo, OutlinerElement, Vue, THREE, fs/require) is referenced inside onload()
// or showDialog(), which the harness never runs. So a no-op BBPlugin is enough
// to load the file, after which `module.exports.__test` (the test hook added at
// the bottom of objcubed.js) hands back the pure functions.
const fs = require('node:fs');
const vm = require('node:vm');

// Internal: load the plugin into a fresh vm context and return BOTH the pure
// functions (__test) and the context (sandbox). The plugin reads `Blockbench`,
// `Project`, `require`, etc. as free globals resolved against this context, so
// a test can mutate context.Blockbench / context.require AFTER load to stub I/O
// (e.g. drive saveSingleOutput with an in-memory fs and assert the writes).
//
// opts.globals  — extra/override globals merged into the sandbox.
// opts.requireImpl — replaces the `require` the plugin sees (intercept 'fs').
function _load(srcPath, opts = {}) {
  const code = fs.readFileSync(srcPath, 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    console,
    require: opts.requireImpl || require,
    module: mod,
    exports: mod.exports,
    // Defensive no-ops. Only BBPlugin.register actually fires while the IIFE
    // executes; the rest guard against future load-time references.
    BBPlugin: { register() {} },
    Plugin: { register() {} },
    settings: { language: { value: 'en' } },
    ...(opts.globals || {}),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: srcPath });
  if (!mod.exports || !mod.exports.__test) {
    throw new Error(
      'objcubed.js did not expose module.exports.__test — is the test hook present at the end of the IIFE?'
    );
  }
  return { api: mod.exports.__test, context: sandbox };
}

// Back-compat: returns just the pure functions.
function loadPlugin(srcPath, opts) {
  return _load(srcPath, opts).api;
}

// Convenience: resolve the plugin relative to the repo root regardless of CWD.
const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');
function loadObjcubed() {
  return loadPlugin(path.join(REPO_ROOT, 'objcubed.js'));
}

// Returns { api, context } so tests can inject stubs (Blockbench, Project, a
// custom require for fs) before invoking I/O functions like saveSingleOutput.
function loadObjcubedWithContext(opts) {
  return _load(path.join(REPO_ROOT, 'objcubed.js'), opts);
}

module.exports = { loadPlugin, loadObjcubed, loadObjcubedWithContext, REPO_ROOT };
