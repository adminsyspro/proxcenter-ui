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

  // src/lib/console/consoleUi.ts
  var consoleUi_exports = {};
  __export(consoleUi_exports, {
    DEFAULT_SCALING_MODE: () => DEFAULT_SCALING_MODE,
    EMPTY_MEDIA: () => EMPTY_MEDIA,
    GUEST_SIZE_ALIGNMENT: () => GUEST_SIZE_ALIGNMENT,
    KEYSYM: () => KEYSYM,
    KEY_COMBOS: () => KEY_COMBOS,
    MAX_GUEST_DIMENSION: () => MAX_GUEST_DIMENSION,
    MIN_GUEST_HEIGHT: () => MIN_GUEST_HEIGHT,
    MIN_GUEST_WIDTH: () => MIN_GUEST_WIDTH,
    SCALING_MODES: () => SCALING_MODES,
    VM_ACTIONS: () => VM_ACTIONS,
    computeFitScale: () => computeFitScale,
    computeGuestResolution: () => computeGuestResolution,
    debounce: () => debounce,
    findKeyCombo: () => findKeyCombo,
    fullscreenElement: () => fullscreenElement,
    fullscreenSupported: () => fullscreenSupported,
    isFullscreen: () => isFullscreen,
    keyComboSequence: () => keyComboSequence,
    listOpticalDrives: () => listOpticalDrives,
    loadScalingMode: () => loadScalingMode,
    mountMediaMenu: () => mountMediaMenu,
    parseScalingMode: () => parseScalingMode,
    parseVmStatus: () => parseVmStatus,
    rfbFlagsForScalingMode: () => rfbFlagsForScalingMode,
    saveScalingMode: () => saveScalingMode,
    scalingStorageKey: () => scalingStorageKey,
    slotLabel: () => slotLabel,
    toggleFullscreen: () => toggleFullscreen,
    vmActionsEnabled: () => vmActionsEnabled
  });

  // src/lib/console/viewport.ts
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
  var VM_ACTIONS = ["start", "shutdown", "stop", "suspend"];
  var VM_STATUSES = ["running", "stopped", "paused", "unknown"];
  function parseVmStatus(raw) {
    return VM_STATUSES.includes(raw) ? raw : "unknown";
  }
  function vmActionsEnabled(status) {
    const parsed = parseVmStatus(status);
    const running = parsed === "running";
    return {
      start: !running,
      shutdown: running,
      stop: parsed !== "stopped",
      suspend: running
    };
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

  // src/lib/proxmox/cdrom.ts
  var OPTICAL_MEDIA_RE = /^[A-Za-z][A-Za-z0-9._-]*:iso\/[^,=;\\]+$/;
  var CLOUD_INIT_RE = /(?:^|[:/])vm-\d+-cloudinit(?:\.\w+)?$/;
  function opticalDrive(raw) {
    if (typeof raw !== "string" || !raw) return null;
    if (raw === "cdrom") return { head: "cdrom", opts: [] };
    const [head, ...rest] = raw.split(",");
    if (!head || head.includes("=") || head.split("/").includes("..")) return null;
    const opts = [];
    const seen = /* @__PURE__ */ new Set();
    for (const part of rest) {
      const eq = part.indexOf("=");
      const key = eq < 0 ? part : part.slice(0, eq);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      opts.push([key, eq < 0 ? "" : part.slice(eq + 1)]);
    }
    if (!opts.some(([key, value]) => key === "media" && value === "cdrom")) return null;
    if (CLOUD_INIT_RE.test(head)) return null;
    return { head, opts };
  }
  function isOpticalDrive(raw) {
    return opticalDrive(raw) !== null;
  }
  function isIsoOrEmpty(head) {
    return head === "none" || OPTICAL_MEDIA_RE.test(head) && !head.split("/").includes("..");
  }
  function replaceCdromMedia(raw, volume) {
    const before = opticalDrive(raw);
    if (!before) throw new Error("An existing CD/DVD drive is required");
    if (!isIsoOrEmpty(volume)) throw new Error("Invalid CD/DVD medium");
    const options = before.opts.filter(([key]) => key !== "media" && key !== "size");
    return [volume, "media=cdrom", ...options.map(([key, value]) => `${key}=${value}`)].join(",");
  }

  // src/lib/console/media.ts
  var EMPTY_MEDIA = "none";
  var MediaChangeError = class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
      this.name = "MediaChangeError";
    }
  };
  var SLOT_RE = /^(ide|sata|scsi)(\d+)$/;
  var BUS_ORDER = ["ide", "sata", "scsi"];
  function slotRank(slot) {
    const m = SLOT_RE.exec(slot);
    return m ? [BUS_ORDER.indexOf(m[1]), Number(m[2])] : [BUS_ORDER.length, 0];
  }
  function slotLabel(slot) {
    const m = SLOT_RE.exec(slot);
    return m ? `${m[1].toUpperCase()} ${m[2]}` : slot;
  }
  function isoFileName(volid) {
    const idx = volid.indexOf(":iso/");
    return idx < 0 ? volid : volid.slice(idx + 5);
  }
  function listOpticalDrives(config) {
    if (!config) return [];
    const drives = [];
    for (const [slot, value] of Object.entries(config)) {
      if (!SLOT_RE.test(slot) || !isOpticalDrive(value)) continue;
      const raw = value;
      const head = raw.split(",")[0];
      if (head === "cdrom") drives.push({ slot, raw, kind: "physical", volid: null });
      else if (head === EMPTY_MEDIA) drives.push({ slot, raw, kind: "empty", volid: null });
      else drives.push({ slot, raw, kind: "iso", volid: head });
    }
    return drives.sort((a, b) => {
      const [ba, na] = slotRank(a.slot);
      const [bb, nb] = slotRank(b.slot);
      return ba - bb || na - nb;
    });
  }
  function mediaChangeBody(drive, volume, digest) {
    const body = { [drive.slot]: replaceCdromMedia(drive.raw, volume) };
    if (digest) body.digest = digest;
    return body;
  }
  function guestApiBase(ref, node = ref.node) {
    const e = encodeURIComponent;
    return `/api/v1/connections/${e(ref.connId)}/guests/${e(ref.type)}/${e(node)}/${e(ref.vmid)}`;
  }
  async function readError(res) {
    try {
      const json = await res.json();
      if (json && typeof json.error === "string" && json.error) return json.error;
    } catch {
    }
    return `HTTP ${res.status}`;
  }
  async function listIsoImages(fetchFn, ref, node, storage) {
    const e = encodeURIComponent;
    const res = await fetchFn(`/api/v1/connections/${e(ref.connId)}/nodes/${e(node)}/storage/${e(storage)}/content?content=iso`);
    if (!res.ok) return [];
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    return rows.map((row) => row?.volid).filter((volid) => typeof volid === "string" && volid.includes(":iso/")).map((volid) => ({ volid, name: isoFileName(volid) })).sort((a, b) => a.name.localeCompare(b.name));
  }
  async function loadConsoleMedia(fetchFn, ref) {
    const configRes = await fetchFn(`${guestApiBase(ref)}/config`);
    if (!configRes.ok) throw new Error(await readError(configRes));
    const configJson = await configRes.json();
    const config = configJson?.data ?? {};
    const node = typeof configJson?.movedTo === "string" && configJson.movedTo ? configJson.movedTo : ref.node;
    const drives = listOpticalDrives(config);
    const digest = typeof config.digest === "string" ? config.digest : void 0;
    if (drives.length === 0) return { node, digest, drives, storages: [] };
    const e = encodeURIComponent;
    const storagesRes = await fetchFn(`/api/v1/connections/${e(ref.connId)}/nodes/${e(node)}/storages?content=iso`);
    const storagesJson = storagesRes.ok ? await storagesRes.json() : null;
    const names = (Array.isArray(storagesJson?.data) ? storagesJson.data : []).filter((s) => typeof s?.storage === "string" && String(s.content ?? "").split(",").includes("iso")).map((s) => s.storage);
    const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
    const storages = await Promise.all(unique.map(async (storage) => ({
      storage,
      images: await listIsoImages(fetchFn, ref, node, storage).catch(() => [])
    })));
    return { node, digest, drives, storages };
  }
  async function applyConsoleMedia(fetchFn, ref, state, drive, volume) {
    const res = await fetchFn(`${guestApiBase(ref, state.node)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mediaChangeBody(drive, volume, state.digest))
    });
    if (!res.ok) throw new MediaChangeError(await readError(res), res.status);
  }
  function mediaOptionGroups(drive, storages) {
    const groups = storages.map((s) => ({ storage: s.storage, images: [...s.images] }));
    const volid = drive.volid;
    if (!volid || groups.some((g) => g.images.some((i) => i.volid === volid))) return groups;
    const storage = volid.slice(0, volid.indexOf(":"));
    const image = { volid, name: isoFileName(volid) };
    const group = groups.find((g) => g.storage === storage);
    if (group) group.images.unshift(image);
    else groups.unshift({ storage, images: [image] });
    return groups;
  }

  // src/lib/console/mediaMenu.ts
  var PHYSICAL_MEDIA = "cdrom";
  var STYLE_ID = "pxc-media-style";
  var CSS = `
.pxc-media-host { position: relative; }
.pxc-media-btn { display: inline-flex; align-items: center; gap: 5px; }
.pxc-media-btn svg { flex-shrink: 0; }
.pxc-media-panel {
  position: absolute; top: 100%; z-index: 30; margin-top: 4px;
  width: 480px; max-width: calc(100vw - 16px); padding: 10px 12px;
  background: #18181b; border: 1px solid #3f3f46; border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); color: #e4e4e7; font-size: 12px;
}
.pxc-media-panel[hidden] { display: none; }
.pxc-media-title { font-weight: 600; margin-bottom: 8px; color: #fff; }
.pxc-media-row { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.pxc-media-slot { width: 52px; flex-shrink: 0; color: #a1a1aa; white-space: nowrap; }
.pxc-media-row select { flex: 1; min-width: 0; max-width: none; }
.pxc-media-row button { flex-shrink: 0; }
.pxc-media-status { margin-top: 8px; color: #a1a1aa; min-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pxc-media-status.error { color: #fca5a5; }
.pxc-media-status.ok { color: #86efac; }
`;
  var SVG_NS = "http://www.w3.org/2000/svg";
  function discIcon(doc) {
    const svg = doc.createElementNS(SVG_NS, "svg");
    for (const [k, v] of [["width", "14"], ["height", "14"], ["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["aria-hidden", "true"]]) {
      svg.setAttribute(k, v);
    }
    for (const r of ["9", "2.5"]) {
      const circle = doc.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", r);
      svg.appendChild(circle);
    }
    return svg;
  }
  function ensureStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }
  function currentValue(drive) {
    if (drive.kind === "physical") return PHYSICAL_MEDIA;
    if (drive.kind === "empty") return EMPTY_MEDIA;
    return drive.volid;
  }
  function mountMediaMenu(opts) {
    const { doc, container, host, ref, fetchFn, onClose } = opts;
    if (ref.type !== "qemu") return null;
    ensureStyle(doc);
    host.classList.add("pxc-media-host");
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pxc-media-btn";
    button.title = "CD/DVD drive: mount or eject an ISO image";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    const caption = doc.createElement("span");
    caption.textContent = "ISO";
    button.append(discIcon(doc), caption);
    container.insertBefore(button, container.firstChild);
    const panel = doc.createElement("div");
    panel.className = "pxc-media-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "CD/DVD drives");
    panel.hidden = true;
    host.appendChild(panel);
    const title = doc.createElement("div");
    title.className = "pxc-media-title";
    title.textContent = "CD/DVD drives";
    const rows = doc.createElement("div");
    const status = doc.createElement("div");
    status.className = "pxc-media-status";
    status.setAttribute("role", "status");
    panel.append(title, rows, status);
    let state = null;
    let loadToken = 0;
    let busy = false;
    function setStatus(text, tone = "") {
      status.textContent = text;
      status.className = tone ? `pxc-media-status ${tone}` : "pxc-media-status";
    }
    function position() {
      const b = button.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      panel.style.left = `${Math.max(0, b.left - h.left)}px`;
      panel.style.right = "";
      const p = panel.getBoundingClientRect();
      const view = doc.defaultView?.innerWidth ?? 0;
      if (view && p.right > view - 8) {
        panel.style.left = "";
        panel.style.right = "8px";
      }
    }
    function buildSelect(drive, current) {
      const select = doc.createElement("select");
      select.setAttribute("aria-label", `${slotLabel(drive.slot)} medium`);
      select.style.maxWidth = "none";
      select.dataset.slot = drive.slot;
      const empty = doc.createElement("option");
      empty.value = EMPTY_MEDIA;
      empty.textContent = "(no media)";
      select.appendChild(empty);
      if (drive.kind === "physical") {
        const phys = doc.createElement("option");
        phys.value = PHYSICAL_MEDIA;
        phys.textContent = "Host CD/DVD drive";
        select.appendChild(phys);
      }
      for (const group of mediaOptionGroups(drive, current.storages)) {
        if (group.images.length === 0) continue;
        const og = doc.createElement("optgroup");
        og.label = group.storage;
        for (const image of group.images) {
          const opt = doc.createElement("option");
          opt.value = image.volid;
          opt.textContent = image.name;
          og.appendChild(opt);
        }
        select.appendChild(og);
      }
      select.value = currentValue(drive);
      return select;
    }
    function render(current) {
      rows.replaceChildren();
      if (current.drives.length === 0) {
        const none = doc.createElement("div");
        none.textContent = "This VM has no CD/DVD drive. Add one from its Hardware tab.";
        rows.appendChild(none);
        return;
      }
      if (!current.storages.some((s) => s.images.length > 0)) {
        setStatus("No ISO image available on this node.");
      }
      for (const drive of current.drives) {
        const row = doc.createElement("div");
        row.className = "pxc-media-row";
        const label = doc.createElement("span");
        label.className = "pxc-media-slot";
        label.textContent = slotLabel(drive.slot);
        const select = buildSelect(drive, current);
        const eject = doc.createElement("button");
        eject.type = "button";
        eject.textContent = "Eject";
        if (drive.kind === "empty") eject.dataset.empty = "1";
        eject.disabled = drive.kind === "empty";
        select.addEventListener("change", () => {
          void change(drive, select.value);
        });
        eject.addEventListener("click", () => {
          void change(drive, EMPTY_MEDIA);
        });
        row.append(label, select, eject);
        rows.appendChild(row);
      }
    }
    function setControlsDisabled(disabled) {
      rows.querySelectorAll("select, button").forEach((el) => {
        el.disabled = disabled || el.dataset.empty === "1";
      });
    }
    async function load() {
      const token = ++loadToken;
      try {
        const next = await loadConsoleMedia(fetchFn, ref);
        if (token !== loadToken) return;
        state = next;
        render(next);
      } catch (err) {
        if (token !== loadToken) return;
        rows.replaceChildren();
        setStatus(`Cannot read the drives: ${err.message}`, "error");
      }
    }
    async function change(drive, volume) {
      if (busy || !state || volume === currentValue(drive) || volume === PHYSICAL_MEDIA) return;
      busy = true;
      setControlsDisabled(true);
      const what = slotLabel(drive.slot);
      setStatus(volume === EMPTY_MEDIA ? `Ejecting ${what}...` : `Mounting ${isoFileName(volume)}...`);
      try {
        await applyConsoleMedia(fetchFn, ref, state, drive, volume);
        await load();
        setStatus(volume === EMPTY_MEDIA ? `${what} ejected` : `${isoFileName(volume)} mounted in ${what}`, "ok");
      } catch (err) {
        await load();
        setStatus(
          err instanceof MediaChangeError && err.status === 409 ? "The VM changed meanwhile: drives re-read, choose again." : err.message,
          "error"
        );
      } finally {
        busy = false;
        setControlsDisabled(false);
      }
    }
    function isOpen() {
      return !panel.hidden;
    }
    async function open() {
      panel.hidden = false;
      button.classList.add("active");
      button.setAttribute("aria-expanded", "true");
      rows.replaceChildren();
      setStatus("Loading...");
      position();
      await load();
      if (status.textContent === "Loading...") setStatus("");
      position();
    }
    function close() {
      if (panel.hidden) return;
      loadToken++;
      panel.hidden = true;
      button.classList.remove("active");
      button.setAttribute("aria-expanded", "false");
      onClose?.();
    }
    function onButton() {
      if (isOpen()) close();
      else void open();
    }
    function onPointerDown(e) {
      const target = e.target;
      if (!isOpen() || !target) return;
      if (panel.contains(target) || button.contains(target)) return;
      close();
    }
    function onKey(e) {
      if (e.key === "Escape" && isOpen()) close();
    }
    button.addEventListener("click", onButton);
    doc.addEventListener("mousedown", onPointerDown, true);
    doc.addEventListener("keydown", onKey);
    return {
      button,
      panel,
      open,
      close,
      isOpen,
      destroy() {
        doc.removeEventListener("mousedown", onPointerDown, true);
        doc.removeEventListener("keydown", onKey);
        button.remove();
        panel.remove();
      }
    };
  }
  return __toCommonJS(consoleUi_exports);
})();
