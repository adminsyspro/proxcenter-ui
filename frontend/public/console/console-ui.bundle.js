var ConsoleUI = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/lib/console/viewport.ts
  var viewport_exports = {};
  __export(viewport_exports, {
    DEFAULT_SCALING_MODE: () => DEFAULT_SCALING_MODE,
    GUEST_SIZE_ALIGNMENT: () => GUEST_SIZE_ALIGNMENT,
    KEYSYM: () => KEYSYM,
    KEY_COMBOS: () => KEY_COMBOS,
    MAX_GUEST_DIMENSION: () => MAX_GUEST_DIMENSION,
    MIN_GUEST_HEIGHT: () => MIN_GUEST_HEIGHT,
    MIN_GUEST_WIDTH: () => MIN_GUEST_WIDTH,
    SCALING_MODES: () => SCALING_MODES,
    computeFitScale: () => computeFitScale,
    computeGuestResolution: () => computeGuestResolution,
    debounce: () => debounce,
    findKeyCombo: () => findKeyCombo,
    fullscreenElement: () => fullscreenElement,
    fullscreenSupported: () => fullscreenSupported,
    isFullscreen: () => isFullscreen,
    keyComboSequence: () => keyComboSequence,
    loadScalingMode: () => loadScalingMode,
    parseScalingMode: () => parseScalingMode,
    rfbFlagsForScalingMode: () => rfbFlagsForScalingMode,
    saveScalingMode: () => saveScalingMode,
    scalingStorageKey: () => scalingStorageKey,
    toggleFullscreen: () => toggleFullscreen
  });
  var SCALING_MODES = ["off", "scale", "remote"];
  var DEFAULT_SCALING_MODE = "scale";
  function scalingStorageKey(kind) {
    return `proxcenter.console.scaling.${kind}`;
  }
  function parseScalingMode(raw, fallback = DEFAULT_SCALING_MODE) {
    return SCALING_MODES.includes(raw) ? raw : fallback;
  }
  function loadScalingMode(storage, kind) {
    try {
      return parseScalingMode(storage?.getItem(scalingStorageKey(kind)));
    } catch {
      return DEFAULT_SCALING_MODE;
    }
  }
  function saveScalingMode(storage, kind, mode) {
    try {
      storage?.setItem(scalingStorageKey(kind), parseScalingMode(mode));
      return Boolean(storage);
    } catch {
      return false;
    }
  }
  function rfbFlagsForScalingMode(mode) {
    const parsed = parseScalingMode(mode);
    return {
      scaleViewport: parsed === "scale",
      resizeSession: parsed === "remote",
      clipViewport: parsed !== "scale"
    };
  }
  var GUEST_SIZE_ALIGNMENT = 8;
  var MIN_GUEST_WIDTH = 320;
  var MIN_GUEST_HEIGHT = 200;
  var MAX_GUEST_DIMENSION = 8192;
  function computeGuestResolution(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    const align = (value) => Math.floor(value / GUEST_SIZE_ALIGNMENT) * GUEST_SIZE_ALIGNMENT;
    const w = Math.min(align(width), MAX_GUEST_DIMENSION);
    const h = Math.min(align(height), MAX_GUEST_DIMENSION);
    if (w < MIN_GUEST_WIDTH || h < MIN_GUEST_HEIGHT) return null;
    return { width: w, height: h };
  }
  function computeFitScale(source, container, opts = {}) {
    const { width: sw, height: sh } = source;
    const { width: cw, height: ch } = container;
    if (![sw, sh, cw, ch].every((v) => Number.isFinite(v) && v > 0)) return 1;
    const scale = Math.min(cw / sw, ch / sh);
    if (!opts.allowUpscale && scale > 1) return 1;
    return scale;
  }
  function fullscreenElement(doc) {
    if (!doc) return null;
    return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
  }
  function isFullscreen(doc) {
    return Boolean(fullscreenElement(doc));
  }
  function fullscreenSupported(el) {
    return Boolean(el && (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen));
  }
  function toggleFullscreen(doc, el) {
    if (isFullscreen(doc)) {
      const exit = doc?.exitFullscreen ?? doc?.webkitExitFullscreen ?? doc?.msExitFullscreen;
      exit?.call(doc);
      return false;
    }
    const request = el?.requestFullscreen ?? el?.webkitRequestFullscreen ?? el?.msRequestFullscreen;
    if (!request) return false;
    const result = request.call(el);
    if (result && typeof result.catch === "function") {
      ;
      result.catch(() => {
      });
    }
    return true;
  }
  var KEYSYM = {
    ControlLeft: 65507,
    AltLeft: 65513,
    Escape: 65307,
    Tab: 65289,
    Backspace: 65288,
    Delete: 65535,
    F1: 65470
  };
  function combo(id, label, ...strokes) {
    return { id, label, strokes };
  }
  var CTRL = { keysym: KEYSYM.ControlLeft, code: "ControlLeft" };
  var ALT = { keysym: KEYSYM.AltLeft, code: "AltLeft" };
  function functionKeyCombos() {
    return Array.from({ length: 12 }, (_, i) => {
      const n = i + 1;
      return combo(`ctrl-alt-f${n}`, `Ctrl+Alt+F${n}`, CTRL, ALT, { keysym: KEYSYM.F1 + i, code: `F${n}` });
    });
  }
  var KEY_COMBOS = [
    combo("ctrl-alt-del", "Ctrl+Alt+Del", CTRL, ALT, { keysym: KEYSYM.Delete, code: "Delete" }),
    combo("ctrl-alt-backspace", "Ctrl+Alt+Backspace", CTRL, ALT, { keysym: KEYSYM.Backspace, code: "Backspace" }),
    combo("ctrl-esc", "Ctrl+Esc", CTRL, { keysym: KEYSYM.Escape, code: "Escape" }),
    combo("alt-tab", "Alt+Tab", ALT, { keysym: KEYSYM.Tab, code: "Tab" }),
    ...functionKeyCombos()
  ];
  function findKeyCombo(id) {
    return KEY_COMBOS.find((c) => c.id === id) ?? null;
  }
  function keyComboSequence(id) {
    const found = findKeyCombo(id);
    if (!found) return [];
    const down = found.strokes.map((s) => ({ ...s, down: true }));
    const up = [...found.strokes].reverse().map((s) => ({ ...s, down: false }));
    return [...down, ...up];
  }
  function debounce(fn, delayMs) {
    let timer = null;
    const wrapped = (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, delayMs);
    };
    wrapped.cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    return wrapped;
  }
  return __toCommonJS(viewport_exports);
})();
