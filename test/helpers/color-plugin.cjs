// Run the real color encoder and dialog methods without Blockbench or a browser.
// Only the test export hook is extended in memory: production source is unchanged.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadColorPlugin({ language = 'en', persisted = {}, animations = true } = {}) {
  const src = path.resolve(__dirname, '../../objcubed.js');
  const code = fs.readFileSync(src, 'utf8');
  const marker = 'module.exports.__test = {';
  if (code.split(marker).length !== 2) throw new Error('Plugin test hook changed');
  const instrumented = code.replace(marker,
    `${marker} showDialog, setExportSink: fn => { runExport = fn; },`);
  const rgba = new Uint8Array(16 * 16 * 4).fill(255);
  let dialogOptions;
  class Image {
    set src(_) { queueMicrotask(() => this.onload()); }
    get naturalWidth() { return 16; }
    get naturalHeight() { return 16; }
    get width() { return 16; }
    get height() { return 16; }
  }
  class Dialog {
    constructor(options) { dialogOptions = options; }
    show() {}
  }
  const project = { name: 'color-test', uuid: 'color-test', objcubed_data: { version: 1, settings: persisted } };
  const mod = { exports: {} };
  const context = {
    console: { ...console, log() {} }, require, module: mod, exports: mod.exports, Buffer, process, Image, Dialog,
    BBPlugin: { register() {} }, Plugin: { register() {} },
    settings: { language: { value: language } }, Project: project,
    Texture: { all: [{ uuid: 'u', name: 'white', source: 'data:fake', img: { src: 'data:fake' } }] },
    Animation: { all: animations ? [{ name: 'walk', snapping: 20, length: 2 }] : [] },
    Outliner: { root: [] },
    document: { createElement() { return { getContext() { return {
      drawImage() {}, getImageData() { return { data: rgba, width: 16, height: 16 }; },
    }; } }; } },
  };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: src });
  const api = mod.exports.__test;
  function openDialog() {
    api.showDialog();
    const component = dialogOptions.component;
    const state = component.data();
    const watchers = new Map();
    // Model the dialog's field watchers for persistence. This deliberately does
    // not mount Vue/DOM or claim visual interaction coverage.
    for (const key of Object.keys(state)) {
      let value = state[key];
      Object.defineProperty(state, key, { enumerable: true, configurable: true,
        get: () => value,
        set(next) {
          value = next;
          if (component.watch?.[key]) component.watch[key].call(state, next);
          for (const fn of watchers.get(key) || []) fn.call(state, next);
        },
      });
    }
    for (const [name, fn] of Object.entries(component.methods)) state[name] = fn.bind(state);
    for (const [name, fn] of Object.entries(component.computed))
      Object.defineProperty(state, name, { get: () => fn.call(state) });
    state.$watch = (key, fn) => watchers.set(key, [...(watchers.get(key) || []), fn]);
    component.created.call(state);
    return state;
  }
  return { api, context, project, openDialog, get dialogOptions() { return dialogOptions; } };
}

module.exports = { loadColorPlugin };
