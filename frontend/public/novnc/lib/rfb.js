"use strict";

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _int = require("./util/int.js");
var Log = _interopRequireWildcard(require("./util/logging.js"));
var _strings = require("./util/strings.js");
var _browser = require("./util/browser.js");
var _element = require("./util/element.js");
var _events = require("./util/events.js");
var _eventtarget = _interopRequireDefault(require("./util/eventtarget.js"));
var _display = _interopRequireDefault(require("./display.js"));
var _inflator = _interopRequireDefault(require("./inflator.js"));
var _deflator = _interopRequireDefault(require("./deflator.js"));
var _keyboard = _interopRequireDefault(require("./input/keyboard.js"));
var _gesturehandler = _interopRequireDefault(require("./input/gesturehandler.js"));
var _cursor = _interopRequireDefault(require("./util/cursor.js"));
var _websock = _interopRequireDefault(require("./websock.js"));
var _keysym = _interopRequireDefault(require("./input/keysym.js"));
var _xtscancodes = _interopRequireDefault(require("./input/xtscancodes.js"));
var _encodings = require("./encodings.js");
var _ra = _interopRequireDefault(require("./ra2.js"));
var _crypto = _interopRequireDefault(require("./crypto/crypto.js"));
var _raw = _interopRequireDefault(require("./decoders/raw.js"));
var _copyrect = _interopRequireDefault(require("./decoders/copyrect.js"));
var _rre = _interopRequireDefault(require("./decoders/rre.js"));
var _hextile = _interopRequireDefault(require("./decoders/hextile.js"));
var _zlib = _interopRequireDefault(require("./decoders/zlib.js"));
var _tight = _interopRequireDefault(require("./decoders/tight.js"));
var _tightpng = _interopRequireDefault(require("./decoders/tightpng.js"));
var _zrle = _interopRequireDefault(require("./decoders/zrle.js"));
var _jpeg = _interopRequireDefault(require("./decoders/jpeg.js"));
var _h = _interopRequireDefault(require("./decoders/h264.js"));

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap();

 

return (_getRequireWildcardCache = function _getRequireWildcardCache(e) { return e ? t : r; })(e); }

function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e }; var t = _getRequireWildcardCache(r);

 if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

 for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

 i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } 

return n["default"] = e, t && t.set(e, n), n; }

function _regeneratorRuntime() { "use strict"; /*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE */ _regeneratorRuntime = function _regeneratorRuntime() { return e; }; var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function (t, e, r) { t[e] = r.value; }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

 function define(t, e, r) { return Object.defineProperty(t, e, { value: r, enumerable: !0, configurable: !0, writable: !0 }), t[e]; }

 try { define({}, ""); } catch (t) { define = function define(t, e, r) { return t[e] = r; }; }

 function wrap(t, e, r, n) { var i = e && e.prototype instanceof Generator ? e : Generator, a = Object.create(i.prototype), c = new Context(n || []);

 

return o(a, "_invoke", { value: makeInvokeMethod(t, r, c) }), a; }

 function tryCatch(t, e, r) { try { return { type: "normal", arg: t.call(e, r) }; } catch (t) { return { type: "throw", arg: t }; } }

 e.wrap = wrap; var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

 function Generator() {}

 function GeneratorFunction() {}

 function GeneratorFunctionPrototype() {}

 var p = {};

 define(p, a, function () { return this; }); var d = Object.getPrototypeOf, v = d && d(d(values([])));

 v && v !== r && n.call(v, a) && (p = v); var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

 function defineIteratorMethods(t) { ["next", "throw", "return"].forEach(function (e) { define(t, e, function (t) { return this._invoke(e, t); }); }); }

 function AsyncIterator(t, e) { function invoke(r, o, i, a) { var c = tryCatch(t[r], t, o);

 if ("throw" !== c.type) { var u = c.arg, h = u.value;

 

return h && "object" == _typeof(h) && n.call(h, "__await") ? e.resolve(h.__await).then(function (t) { invoke("next", t, i, a); }, function (t) { invoke("throw", t, i, a); }) : e.resolve(h).then(function (t) { u.value = t, i(u); }, function (t) { return invoke("throw", t, i, a); }); }

 a(c.arg); }

 var r;

 o(this, "_invoke", { value: function value(t, n) { function callInvokeWithMethodAndArg() { return new e(function (e, r) { invoke(t, n, e, r); }); }

 

return r = r ? r.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg(); } }); }

 function makeInvokeMethod(e, r, n) { var o = h;

 

return function (i, a) { if (o === f) throw Error("Generator is already running");

 if (o === s) { if ("throw" === i) throw a; 

return { value: t, done: !0 }; }

 for (n.method = i, n.arg = a;;) { var c = n.delegate;

 if (c) { var u = maybeInvokeDelegate(c, n);

 if (u) { if (u === y) continue; 

return u; } }

 if ("next" === n.method) n.sent = n._sent = n.arg;else if ("throw" === n.method) { if (o === h) throw o = s, n.arg; n.dispatchException(n.arg); } else "return" === n.method && n.abrupt("return", n.arg); o = f; var p = tryCatch(e, r, n);

 if ("normal" === p.type) { if (o = n.done ? s : l, p.arg === y) continue; 

return { value: p.arg, done: n.done }; }

 "throw" === p.type && (o = s, n.method = "throw", n.arg = p.arg); } }; }

 function maybeInvokeDelegate(e, r) { var n = r.method, o = e.iterator[n];

 if (o === t) return r.delegate = null, "throw" === n && e.iterator["return"] && (r.method = "return", r.arg = t, maybeInvokeDelegate(e, r), "throw" === r.method) || "return" !== n && (r.method = "throw", r.arg = new TypeError("The iterator does not provide a '" + n + "' method")), y; var i = tryCatch(o, e.iterator, r.arg);

 if ("throw" === i.type) return r.method = "throw", r.arg = i.arg, r.delegate = null, y; var a = i.arg;

 

return a ? a.done ? (r[e.resultName] = a.value, r.next = e.nextLoc, "return" !== r.method && (r.method = "next", r.arg = t), r.delegate = null, y) : a : (r.method = "throw", r.arg = new TypeError("iterator result is not an object"), r.delegate = null, y); }

 function pushTryEntry(t) { var e = { tryLoc: t[0] };

 1 in t && (e.catchLoc = t[1]), 2 in t && (e.finallyLoc = t[2], e.afterLoc = t[3]), this.tryEntries.push(e); }

 function resetTryEntry(t) { var e = t.completion || {};

 e.type = "normal", delete e.arg, t.completion = e; }

 function Context(t) { this.tryEntries = [{ tryLoc: "root" }], t.forEach(pushTryEntry, this), this.reset(!0); }

 function values(e) { if (e || "" === e) { var r = e[a];

 if (r) return r.call(e); if ("function" == typeof e.next) return e;

 if (!isNaN(e.length)) { var o = -1, i = function next() { for (; ++o < e.length;) if (n.call(e, o)) return next.value = e[o], next.done = !1, next; 

return next.value = t, next.done = !0, next; };

 

return i.next = i; } }

 throw new TypeError(_typeof(e) + " is not iterable"); }

 

return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: !0 }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: !0 }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function (t) { var e = "function" == typeof t && t.constructor;

 

return !!e && (e === GeneratorFunction || "GeneratorFunction" === (e.displayName || e.name)); }, e.mark = function (t) { return Object.setPrototypeOf ? Object.setPrototypeOf(t, GeneratorFunctionPrototype) : (t.__proto__ = GeneratorFunctionPrototype, define(t, u, "GeneratorFunction")), t.prototype = Object.create(g), t; }, e.awrap = function (t) { return { __await: t }; }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function () { return this; }), e.AsyncIterator = AsyncIterator, e.async = function (t, r, n, o, i) { void 0 === i && (i = Promise); var a = new AsyncIterator(wrap(t, r, n, o), i);

 

return e.isGeneratorFunction(r) ? a : a.next().then(function (t) { return t.done ? t.value : a.next(); }); }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function () { return this; }), define(g, "toString", function () { return "[object Generator]"; }), e.keys = function (t) { var e = Object(t), r = [];

 for (var n in e) r.push(n); 

return r.reverse(), function next() { for (; r.length;) { var t = r.pop();

 if (t in e) return next.value = t, next.done = !1, next; } 

return next.done = !0, next; }; }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e) { if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = !1, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e) for (var r in this) "t" === r.charAt(0) && n.call(this, r) && !isNaN(+r.slice(1)) && (this[r] = t); }, stop: function stop() { this.done = !0; var t = this.tryEntries[0].completion;

 if ("throw" === t.type) throw t.arg; 

return this.rval; }, dispatchException: function dispatchException(e) { if (this.done) throw e; var r = this;

 function handle(n, o) { return a.type = "throw", a.arg = e, r.next = n, o && (r.method = "next", r.arg = t), !!o; }

 for (var o = this.tryEntries.length - 1; o >= 0; --o) { var i = this.tryEntries[o], a = i.completion;

 if ("root" === i.tryLoc) return handle("end");

 if (i.tryLoc <= this.prev) { var c = n.call(i, "catchLoc"), u = n.call(i, "finallyLoc");

 if (c && u) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } else if (c) { if (this.prev < i.catchLoc) return handle(i.catchLoc, !0); } else { if (!u) throw Error("try statement without catch or finally"); if (this.prev < i.finallyLoc) return handle(i.finallyLoc); } } } }, abrupt: function abrupt(t, e) { for (var r = this.tryEntries.length - 1; r >= 0; --r) { var o = this.tryEntries[r];

 if (o.tryLoc <= this.prev && n.call(o, "finallyLoc") && this.prev < o.finallyLoc) { var i = o;

 break; } }

 i && ("break" === t || "continue" === t) && i.tryLoc <= e && e <= i.finallyLoc && (i = null); var a = i ? i.completion : {};

 

return a.type = t, a.arg = e, i ? (this.method = "next", this.next = i.finallyLoc, y) : this.complete(a); }, complete: function complete(t, e) { if ("throw" === t.type) throw t.arg; 

return "break" === t.type || "continue" === t.type ? this.next = t.arg : "return" === t.type ? (this.rval = this.arg = t.arg, this.method = "return", this.next = "end") : "normal" === t.type && e && (this.next = e), y; }, finish: function finish(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e];

 if (r.finallyLoc === t) return this.complete(r.completion, r.afterLoc), resetTryEntry(r), y; } }, "catch": function _catch(t) { for (var e = this.tryEntries.length - 1; e >= 0; --e) { var r = this.tryEntries[e];

 if (r.tryLoc === t) { var n = r.completion;

 if ("throw" === n.type) { var o = n.arg;

 resetTryEntry(r); } 

return o; } }

 throw Error("illegal catch attempt"); }, delegateYield: function delegateYield(e, r, n) { return this.delegate = { iterator: values(e), resultName: r, nextLoc: n }, "next" === this.method && (this.arg = t), y; } }, e; }

function asyncGeneratorStep(n, t, e, r, o, a, c) { try { var i = n[a](c), u = i.value; } catch (n) { return void e(n); } i.done ? t(u) : Promise.resolve(u).then(r, o); }

function _asyncToGenerator(n) { return function () { var t = this, e = arguments;

 

return new Promise(function (r, o) { var a = n.apply(t, e);

 function _next(n) { asyncGeneratorStep(a, r, o, _next, _throw, "next", n); }

 function _throw(n) { asyncGeneratorStep(a, r, o, _next, _throw, "throw", n); }

 _next(void 0); }); }; }

function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

 if (null != t) { var e, n, i, u, a = [], f = !0, o = !1;

 try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } 

return a; } }

function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }

function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

 if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {};

 

return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; }

 throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

 var o, a = !0, u = !1;

 

return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next();

 

return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }

function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1);

 

return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }

function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; 

return n; }

function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }

function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t];

 o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }

function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }

function _toPropertyKey(t) { var i = _toPrimitive(t, "string");

 

return "symbol" == _typeof(i) ? i : i + ""; }

function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive];

 if (void 0 !== e) { var i = e.call(t, r || "default");

 if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } 

return ("string" === r ? String : Number)(t); }

function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }

function _possibleConstructorReturn(t, e) { if (e && ("object" == _typeof(e) || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); 

return _assertThisInitialized(t); }

function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); 

return e; }

function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} 

return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }

function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }

function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }

function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); } /*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

// How many seconds to wait for a disconnect to finish
var DISCONNECT_TIMEOUT = 3;
var DEFAULT_BACKGROUND = 'rgb(40, 40, 40)';

// Minimum wait (ms) between two mouse moves
var MOUSE_MOVE_DELAY = 17;

// Wheel thresholds
var WHEEL_STEP = 50; // Pixels needed for one step
var WHEEL_LINE_HEIGHT = 19; // Assumed pixels for one line step

// Gesture thresholds
var GESTURE_ZOOMSENS = 75;
var GESTURE_SCRLSENS = 50;
var DOUBLE_TAP_TIMEOUT = 1000;
var DOUBLE_TAP_THRESHOLD = 50;

// Security types
var securityTypeNone = 1;
var securityTypeVNCAuth = 2;
var securityTypeRA2ne = 6;
var securityTypeTight = 16;
var securityTypeVeNCrypt = 19;
var securityTypeXVP = 22;
var securityTypeARD = 30;
var securityTypeMSLogonII = 113;

// Special Tight security types
var securityTypeUnixLogon = 129;

// VeNCrypt security types
var securityTypePlain = 256;

// Extended clipboard pseudo-encoding formats
var extendedClipboardFormatText = 1;
/*eslint-disable no-unused-vars */
var extendedClipboardFormatRtf = 1 << 1;
var extendedClipboardFormatHtml = 1 << 2;
var extendedClipboardFormatDib = 1 << 3;
var extendedClipboardFormatFiles = 1 << 4;
/*eslint-enable */

// Extended clipboard pseudo-encoding actions
var extendedClipboardActionCaps = 1 << 24;
var extendedClipboardActionRequest = 1 << 25;
var extendedClipboardActionPeek = 1 << 26;
var extendedClipboardActionNotify = 1 << 27;
var extendedClipboardActionProvide = 1 << 28;
var RFB = exports["default"] = /*#__PURE__*/function (_EventTargetMixin) {
  function RFB(target, urlOrChannel, options) {
    var _this;

    _classCallCheck(this, RFB);

    if (!target) {
      throw new Error("Must specify target");
    }

    if (!urlOrChannel) {
      throw new Error("Must specify URL, WebSocket or RTCDataChannel");
    }

    // We rely on modern APIs which might not be available in an
    // insecure context
    if (!window.isSecureContext) {
      Log.Error("noVNC requires a secure context (TLS). Expect crashes!");
    }

    _this = _callSuper(this, RFB);
    _this._target = target;

    if (typeof urlOrChannel === "string") {
      _this._url = urlOrChannel;
    } else {
      _this._url = null;
      _this._rawChannel = urlOrChannel;
    }

    // Connection details
    options = options || {};
    _this._rfbCredentials = options.credentials || {};
    _this._shared = 'shared' in options ? !!options.shared : true;
    _this._repeaterID = options.repeaterID || '';
    _this._wsProtocols = options.wsProtocols || [];

    // Internal state
    _this._rfbConnectionState = '';
    _this._rfbInitState = '';
    _this._rfbAuthScheme = -1;
    _this._rfbCleanDisconnect = true;
    _this._rfbRSAAESAuthenticationState = null;

    // Server capabilities
    _this._rfbVersion = 0;
    _this._rfbMaxVersion = 3.8;
    _this._rfbTightVNC = false;
    _this._rfbVeNCryptState = 0;
    _this._rfbXvpVer = 0;
    _this._fbWidth = 0;
    _this._fbHeight = 0;
    _this._fbName = "";
    _this._capabilities = {
      power: false
    };
    _this._supportsFence = false;
    _this._supportsContinuousUpdates = false;
    _this._enabledContinuousUpdates = false;
    _this._supportsSetDesktopSize = false;
    _this._screenID = 0;
    _this._screenFlags = 0;
    _this._pendingRemoteResize = false;
    _this._lastResize = 0;
    _this._qemuExtKeyEventSupported = false;
    _this._extendedPointerEventSupported = false;
    _this._clipboardText = null;
    _this._clipboardServerCapabilitiesActions = {};
    _this._clipboardServerCapabilitiesFormats = {};

    // Internal objects
    _this._sock = null; // Websock object
    _this._display = null; // Display object
    _this._flushing = false; // Display flushing state
    _this._keyboard = null; // Keyboard input handler object
    _this._gestures = null; // Gesture input handler object
    _this._resizeObserver = null; // Resize observer object

    // Timers
    _this._disconnTimer = null; // disconnection timer
    _this._resizeTimeout = null; // resize rate limiting
    _this._mouseMoveTimer = null;

    // Decoder states
    _this._decoders = {};
    _this._FBU = {
      rects: 0,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      encoding: null
    };

    // Mouse state
    _this._mousePos = {};
    _this._mouseButtonMask = 0;
    _this._mouseLastMoveTime = 0;
    _this._viewportDragging = false;
    _this._viewportDragPos = {};
    _this._viewportHasMoved = false;
    _this._accumulatedWheelDeltaX = 0;
    _this._accumulatedWheelDeltaY = 0;

    // Gesture state
    _this._gestureLastTapTime = null;
    _this._gestureFirstDoubleTapEv = null;
    _this._gestureLastMagnitudeX = 0;
    _this._gestureLastMagnitudeY = 0;

    // Bound event handlers
    _this._eventHandlers = {
      focusCanvas: _this._focusCanvas.bind(_this),
      handleResize: _this._handleResize.bind(_this),
      handleMouse: _this._handleMouse.bind(_this),
      handleWheel: _this._handleWheel.bind(_this),
      handleGesture: _this._handleGesture.bind(_this),
      handleRSAAESCredentialsRequired: _this._handleRSAAESCredentialsRequired.bind(_this),
      handleRSAAESServerVerification: _this._handleRSAAESServerVerification.bind(_this)
    };

    // main setup
    Log.Debug(">> RFB.constructor");

    // Create DOM elements
    _this._screen = document.createElement('div');
    _this._screen.style.display = 'flex';
    _this._screen.style.width = '100%';
    _this._screen.style.height = '100%';
    _this._screen.style.overflow = 'auto';
    _this._screen.style.background = DEFAULT_BACKGROUND;
    _this._canvas = document.createElement('canvas');
    _this._canvas.style.margin = 'auto';

    // Some browsers add an outline on focus
    _this._canvas.style.outline = 'none';
    _this._canvas.width = 0;
    _this._canvas.height = 0;
    _this._canvas.tabIndex = -1;
    _this._screen.appendChild(_this._canvas);

    // Cursor
    _this._cursor = new _cursor["default"]();

    // XXX: TightVNC 2.8.11 sends no cursor at all until Windows changes
    // it. Result: no cursor at all until a window border or an edit field
    // is hit blindly. But there are also VNC servers that draw the cursor
    // in the framebuffer and don't send the empty local cursor. There is
    // no way to satisfy both sides.
    //
    // The spec is unclear on this "initial cursor" issue. Many other
    // viewers (TigerVNC, RealVNC, Remmina) display an arrow as the
    // initial cursor instead.
    _this._cursorImage = RFB.cursors.none;

    // populate decoder array with objects
    _this._decoders[_encodings.encodings.encodingRaw] = new _raw["default"]();
    _this._decoders[_encodings.encodings.encodingCopyRect] = new _copyrect["default"]();
    _this._decoders[_encodings.encodings.encodingRRE] = new _rre["default"]();
    _this._decoders[_encodings.encodings.encodingHextile] = new _hextile["default"]();
    _this._decoders[_encodings.encodings.encodingZlib] = new _zlib["default"]();
    _this._decoders[_encodings.encodings.encodingTight] = new _tight["default"]();
    _this._decoders[_encodings.encodings.encodingTightPNG] = new _tightpng["default"]();
    _this._decoders[_encodings.encodings.encodingZRLE] = new _zrle["default"]();
    _this._decoders[_encodings.encodings.encodingJPEG] = new _jpeg["default"]();
    _this._decoders[_encodings.encodings.encodingH264] = new _h["default"]();

    // NB: nothing that needs explicit teardown should be done
    // before this point, since this can throw an exception
    try {
      _this._display = new _display["default"](_this._canvas);
    } catch (exc) {
      Log.Error("Display exception: " + exc);
      throw exc;
    }

    _this._keyboard = new _keyboard["default"](_this._canvas);
    _this._keyboard.onkeyevent = _this._handleKeyEvent.bind(_this);
    _this._remoteCapsLock = null; // Null indicates unknown or irrelevant
    _this._remoteNumLock = null;
    _this._gestures = new _gesturehandler["default"]();
    _this._sock = new _websock["default"]();
    _this._sock.on('open', _this._socketOpen.bind(_this));
    _this._sock.on('close', _this._socketClose.bind(_this));
    _this._sock.on('message', _this._handleMessage.bind(_this));
    _this._sock.on('error', _this._socketError.bind(_this));
    _this._expectedClientWidth = null;
    _this._expectedClientHeight = null;
    _this._resizeObserver = new ResizeObserver(_this._eventHandlers.handleResize);

    // All prepared, kick off the connection
    _this._updateConnectionState('connecting');
    Log.Debug("<< RFB.constructor");

    // ===== PROPERTIES =====

    _this.dragViewport = false;
    _this.focusOnClick = true;
    _this._viewOnly = false;
    _this._clipViewport = false;
    _this._clippingViewport = false;
    _this._scaleViewport = false;
    _this._resizeSession = false;
    _this._showDotCursor = false;

    if (options.showDotCursor !== undefined) {
      Log.Warn("Specifying showDotCursor as a RFB constructor argument is deprecated");
      _this._showDotCursor = options.showDotCursor;
    }

    _this._qualityLevel = 6;
    _this._compressionLevel = 2;
    
return _this;
  }

  // ===== PROPERTIES =====
  _inherits(RFB, _EventTargetMixin);
  
return _createClass(RFB, [{
    key: "viewOnly",
    get: function get() {
      return this._viewOnly;
    },
    set: function set(viewOnly) {
      this._viewOnly = viewOnly;

      if (this._rfbConnectionState === "connecting" || this._rfbConnectionState === "connected") {
        if (viewOnly) {
          this._keyboard.ungrab();
        } else {
          this._keyboard.grab();
        }
      }
    }
  }, {
    key: "capabilities",
    get: function get() {
      return this._capabilities;
    }
  }, {
    key: "clippingViewport",
    get: function get() {
      return this._clippingViewport;
    }
  }, {
    key: "_setClippingViewport",
    value: function _setClippingViewport(on) {
      if (on === this._clippingViewport) {
        return;
      }

      this._clippingViewport = on;
      this.dispatchEvent(new CustomEvent("clippingviewport", {
        detail: this._clippingViewport
      }));
    }
  }, {
    key: "touchButton",
    get: function get() {
      return 0;
    },
    set: function set(button) {
      Log.Warn("Using old API!");
    }
  }, {
    key: "clipViewport",
    get: function get() {
      return this._clipViewport;
    },
    set: function set(viewport) {
      this._clipViewport = viewport;
      this._updateClip();
    }
  }, {
    key: "scaleViewport",
    get: function get() {
      return this._scaleViewport;
    },
    set: function set(scale) {
      this._scaleViewport = scale;


      // Scaling trumps clipping, so we may need to adjust
      // clipping when enabling or disabling scaling
      if (scale && this._clipViewport) {
        this._updateClip();
      }

      this._updateScale();

      if (!scale && this._clipViewport) {
        this._updateClip();
      }
    }
  }, {
    key: "resizeSession",
    get: function get() {
      return this._resizeSession;
    },
    set: function set(resize) {
      this._resizeSession = resize;

      if (resize) {
        this._requestRemoteResize();
      }
    }
  }, {
    key: "showDotCursor",
    get: function get() {
      return this._showDotCursor;
    },
    set: function set(show) {
      this._showDotCursor = show;
      this._refreshCursor();
    }
  }, {
    key: "background",
    get: function get() {
      return this._screen.style.background;
    },
    set: function set(cssValue) {
      this._screen.style.background = cssValue;
    }
  }, {
    key: "qualityLevel",
    get: function get() {
      return this._qualityLevel;
    },
    set: function set(qualityLevel) {
      if (!Number.isInteger(qualityLevel) || qualityLevel < 0 || qualityLevel > 9) {
        Log.Error("qualityLevel must be an integer between 0 and 9");
        
return;
      }

      if (this._qualityLevel === qualityLevel) {
        return;
      }

      this._qualityLevel = qualityLevel;

      if (this._rfbConnectionState === 'connected') {
        this._sendEncodings();
      }
    }
  }, {
    key: "compressionLevel",
    get: function get() {
      return this._compressionLevel;
    },
    set: function set(compressionLevel) {
      if (!Number.isInteger(compressionLevel) || compressionLevel < 0 || compressionLevel > 9) {
        Log.Error("compressionLevel must be an integer between 0 and 9");
        
return;
      }

      if (this._compressionLevel === compressionLevel) {
        return;
      }

      this._compressionLevel = compressionLevel;

      if (this._rfbConnectionState === 'connected') {
        this._sendEncodings();
      }
    }

    // ===== PUBLIC METHODS =====
  }, {
    key: "disconnect",
    value: function disconnect() {
      this._updateConnectionState('disconnecting');
      this._sock.off('error');
      this._sock.off('message');
      this._sock.off('open');

      if (this._rfbRSAAESAuthenticationState !== null) {
        this._rfbRSAAESAuthenticationState.disconnect();
      }
    }
  }, {
    key: "approveServer",
    value: function approveServer() {
      if (this._rfbRSAAESAuthenticationState !== null) {
        this._rfbRSAAESAuthenticationState.approveServer();
      }
    }
  }, {
    key: "sendCredentials",
    value: function sendCredentials(creds) {
      this._rfbCredentials = creds;
      this._resumeAuthentication();
    }
  }, {
    key: "sendCtrlAltDel",
    value: function sendCtrlAltDel() {
      if (this._rfbConnectionState !== 'connected' || this._viewOnly) {
        return;
      }

      Log.Info("Sending Ctrl-Alt-Del");
      this.sendKey(_keysym["default"].XK_Control_L, "ControlLeft", true);
      this.sendKey(_keysym["default"].XK_Alt_L, "AltLeft", true);
      this.sendKey(_keysym["default"].XK_Delete, "Delete", true);
      this.sendKey(_keysym["default"].XK_Delete, "Delete", false);
      this.sendKey(_keysym["default"].XK_Alt_L, "AltLeft", false);
      this.sendKey(_keysym["default"].XK_Control_L, "ControlLeft", false);
    }
  }, {
    key: "machineShutdown",
    value: function machineShutdown() {
      this._xvpOp(1, 2);
    }
  }, {
    key: "machineReboot",
    value: function machineReboot() {
      this._xvpOp(1, 3);
    }
  }, {
    key: "machineReset",
    value: function machineReset() {
      this._xvpOp(1, 4);
    }

    // Send a key press. If 'down' is not specified then send a down key
    // followed by an up key.
  }, {
    key: "sendKey",
    value: function sendKey(keysym, code, down) {
      if (this._rfbConnectionState !== 'connected' || this._viewOnly) {
        return;
      }

      if (down === undefined) {
        this.sendKey(keysym, code, true);
        this.sendKey(keysym, code, false);
        
return;
      }

      var scancode = _xtscancodes["default"][code];

      if (this._qemuExtKeyEventSupported && scancode) {
        // 0 is NoSymbol
        keysym = keysym || 0;
        Log.Info("Sending key (" + (down ? "down" : "up") + "): keysym " + keysym + ", scancode " + scancode);
        RFB.messages.QEMUExtendedKeyEvent(this._sock, keysym, down, scancode);
      } else {
        if (!keysym) {
          return;
        }

        Log.Info("Sending keysym (" + (down ? "down" : "up") + "): " + keysym);
        RFB.messages.keyEvent(this._sock, keysym, down ? 1 : 0);
      }
    }
  }, {
    key: "focus",
    value: function focus(options) {
      this._canvas.focus(options);
    }
  }, {
    key: "blur",
    value: function blur() {
      this._canvas.blur();
    }
  }, {
    key: "clipboardPasteFrom",
    value: function clipboardPasteFrom(text) {
      if (this._rfbConnectionState !== 'connected' || this._viewOnly) {
        return;
      }

      if (this._clipboardServerCapabilitiesFormats[extendedClipboardFormatText] && this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {
        this._clipboardText = text;
        RFB.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
      } else {
        var length, i;
        var data;

        length = 0;
        // eslint-disable-next-line no-unused-vars
        var _iterator = _createForOfIteratorHelper(text),
          _step;

        try {
          for (_iterator.s(); !(_step = _iterator.n()).done;) {
            var codePoint = _step.value;

            length++;
          }
        } catch (err) {
          _iterator.e(err);
        } finally {
          _iterator.f();
        }

        data = new Uint8Array(length);
        i = 0;
        var _iterator2 = _createForOfIteratorHelper(text),
          _step2;

        try {
          for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
            var _codePoint = _step2.value;
            var code = _codePoint.codePointAt(0);

            /* Only ISO 8859-1 is supported */
            if (code > 0xff) {
              code = 0x3f; // '?'
            }

            data[i++] = code;
          }
        } catch (err) {
          _iterator2.e(err);
        } finally {
          _iterator2.f();
        }

        RFB.messages.clientCutText(this._sock, data);
      }
    }
  }, {
    key: "getImageData",
    value: function getImageData() {
      return this._display.getImageData();
    }
  }, {
    key: "toDataURL",
    value: function toDataURL(type, encoderOptions) {
      return this._display.toDataURL(type, encoderOptions);
    }
  }, {
    key: "toBlob",
    value: function toBlob(callback, type, quality) {
      return this._display.toBlob(callback, type, quality);
    }

    // ===== PRIVATE METHODS =====
  }, {
    key: "_connect",
    value: function _connect() {
      Log.Debug(">> RFB.connect");

      if (this._url) {
        Log.Info("connecting to ".concat(this._url));
        this._sock.open(this._url, this._wsProtocols);
      } else {
        Log.Info("attaching ".concat(this._rawChannel, " to Websock"));
        this._sock.attach(this._rawChannel);

        if (this._sock.readyState === 'closed') {
          throw Error("Cannot use already closed WebSocket/RTCDataChannel");
        }

        if (this._sock.readyState === 'open') {
          // FIXME: _socketOpen() can in theory call _fail(), which
          //        isn't allowed this early, but I'm not sure that can
          //        happen without a bug messing up our state variables
          this._socketOpen();
        }
      }

      // Make our elements part of the page
      this._target.appendChild(this._screen);
      this._gestures.attach(this._canvas);
      this._cursor.attach(this._canvas);
      this._refreshCursor();

      // Monitor size changes of the screen element
      this._resizeObserver.observe(this._screen);

      // Always grab focus on some kind of click event
      this._canvas.addEventListener("mousedown", this._eventHandlers.focusCanvas);
      this._canvas.addEventListener("touchstart", this._eventHandlers.focusCanvas);

      // Mouse events
      this._canvas.addEventListener('mousedown', this._eventHandlers.handleMouse);
      this._canvas.addEventListener('mouseup', this._eventHandlers.handleMouse);
      this._canvas.addEventListener('mousemove', this._eventHandlers.handleMouse);

      // Prevent middle-click pasting (see handler for why we bind to document)
      this._canvas.addEventListener('click', this._eventHandlers.handleMouse);

      // preventDefault() on mousedown doesn't stop this event for some
      // reason so we have to explicitly block it
      this._canvas.addEventListener('contextmenu', this._eventHandlers.handleMouse);

      // Wheel events
      this._canvas.addEventListener("wheel", this._eventHandlers.handleWheel);

      // Gesture events
      this._canvas.addEventListener("gesturestart", this._eventHandlers.handleGesture);
      this._canvas.addEventListener("gesturemove", this._eventHandlers.handleGesture);
      this._canvas.addEventListener("gestureend", this._eventHandlers.handleGesture);
      Log.Debug("<< RFB.connect");
    }
  }, {
    key: "_disconnect",
    value: function _disconnect() {
      Log.Debug(">> RFB.disconnect");
      this._cursor.detach();
      this._canvas.removeEventListener("gesturestart", this._eventHandlers.handleGesture);
      this._canvas.removeEventListener("gesturemove", this._eventHandlers.handleGesture);
      this._canvas.removeEventListener("gestureend", this._eventHandlers.handleGesture);
      this._canvas.removeEventListener("wheel", this._eventHandlers.handleWheel);
      this._canvas.removeEventListener('mousedown', this._eventHandlers.handleMouse);
      this._canvas.removeEventListener('mouseup', this._eventHandlers.handleMouse);
      this._canvas.removeEventListener('mousemove', this._eventHandlers.handleMouse);
      this._canvas.removeEventListener('click', this._eventHandlers.handleMouse);
      this._canvas.removeEventListener('contextmenu', this._eventHandlers.handleMouse);
      this._canvas.removeEventListener("mousedown", this._eventHandlers.focusCanvas);
      this._canvas.removeEventListener("touchstart", this._eventHandlers.focusCanvas);
      this._resizeObserver.disconnect();
      this._keyboard.ungrab();
      this._gestures.detach();
      this._sock.close();

      try {
        this._target.removeChild(this._screen);
      } catch (e) {
        if (e.name === 'NotFoundError') {
          // Some cases where the initial connection fails
          // can disconnect before the _screen is created
        } else {
          throw e;
        }
      }

      clearTimeout(this._resizeTimeout);
      clearTimeout(this._mouseMoveTimer);
      Log.Debug("<< RFB.disconnect");
    }
  }, {
    key: "_socketOpen",
    value: function _socketOpen() {
      if (this._rfbConnectionState === 'connecting' && this._rfbInitState === '') {
        this._rfbInitState = 'ProtocolVersion';
        Log.Debug("Starting VNC handshake");
      } else {
        this._fail("Unexpected server connection while " + this._rfbConnectionState);
      }
    }
  }, {
    key: "_socketClose",
    value: function _socketClose(e) {
      Log.Debug("WebSocket on-close event");
      var msg = "";

      if (e.code) {
        msg = "(code: " + e.code;

        if (e.reason) {
          msg += ", reason: " + e.reason;
        }

        msg += ")";
      }

      switch (this._rfbConnectionState) {
        case 'connecting':
          this._fail("Connection closed " + msg);
          break;
        case 'connected':
          // Handle disconnects that were initiated server-side
          this._updateConnectionState('disconnecting');
          this._updateConnectionState('disconnected');
          break;
        case 'disconnecting':
          // Normal disconnection path
          this._updateConnectionState('disconnected');
          break;
        case 'disconnected':
          this._fail("Unexpected server disconnect " + "when already disconnected " + msg);
          break;
        default:
          this._fail("Unexpected server disconnect before connecting " + msg);
          break;
      }

      this._sock.off('close');

      // Delete reference to raw channel to allow cleanup.
      this._rawChannel = null;
    }
  }, {
    key: "_socketError",
    value: function _socketError(e) {
      Log.Warn("WebSocket on-error event");
    }
  }, {
    key: "_focusCanvas",
    value: function _focusCanvas(event) {
      if (!this.focusOnClick) {
        return;
      }

      this.focus({
        preventScroll: true
      });
    }
  }, {
    key: "_setDesktopName",
    value: function _setDesktopName(name) {
      this._fbName = name;
      this.dispatchEvent(new CustomEvent("desktopname", {
        detail: {
          name: this._fbName
        }
      }));
    }
  }, {
    key: "_saveExpectedClientSize",
    value: function _saveExpectedClientSize() {
      this._expectedClientWidth = this._screen.clientWidth;
      this._expectedClientHeight = this._screen.clientHeight;
    }
  }, {
    key: "_currentClientSize",
    value: function _currentClientSize() {
      return [this._screen.clientWidth, this._screen.clientHeight];
    }
  }, {
    key: "_clientHasExpectedSize",
    value: function _clientHasExpectedSize() {
      var _this$_currentClientS = this._currentClientSize(),
        _this$_currentClientS2 = _slicedToArray(_this$_currentClientS, 2),
        currentWidth = _this$_currentClientS2[0],
        currentHeight = _this$_currentClientS2[1];

      
return currentWidth == this._expectedClientWidth && currentHeight == this._expectedClientHeight;
    }

    // Handle browser window resizes
  }, {
    key: "_handleResize",
    value: function _handleResize() {
      var _this2 = this;


      // Don't change anything if the client size is already as expected
      if (this._clientHasExpectedSize()) {
        return;
      }


      // If the window resized then our screen element might have
      // as well. Update the viewport dimensions.
      window.requestAnimationFrame(function () {
        _this2._updateClip();
        _this2._updateScale();
        _this2._saveExpectedClientSize();
      });

      // Request changing the resolution of the remote display to
      // the size of the local browser viewport.
      this._requestRemoteResize();
    }

    // Update state of clipping in Display object, and make sure the
    // configured viewport matches the current screen size
  }, {
    key: "_updateClip",
    value: function _updateClip() {
      var curClip = this._display.clipViewport;
      var newClip = this._clipViewport;

      if (this._scaleViewport) {
        // Disable viewport clipping if we are scaling
        newClip = false;
      }

      if (curClip !== newClip) {
        this._display.clipViewport = newClip;
      }

      if (newClip) {
        // When clipping is enabled, the screen is limited to
        // the size of the container.
        var size = this._screenSize();

        this._display.viewportChangeSize(size.w, size.h);
        this._fixScrollbars();
        this._setClippingViewport(size.w < this._display.width || size.h < this._display.height);
      } else {
        this._setClippingViewport(false);
      }

      // When changing clipping we might show or hide scrollbars.
      // This causes the expected client dimensions to change.
      if (curClip !== newClip) {
        this._saveExpectedClientSize();
      }
    }
  }, {
    key: "_updateScale",
    value: function _updateScale() {
      if (!this._scaleViewport) {
        this._display.scale = 1.0;
      } else {
        var size = this._screenSize();

        this._display.autoscale(size.w, size.h);
      }

      this._fixScrollbars();
    }

    // Requests a change of remote desktop size. This message is an extension
    // and may only be sent if we have received an ExtendedDesktopSize message
  }, {
    key: "_requestRemoteResize",
    value: function _requestRemoteResize() {
      if (!this._resizeSession) {
        return;
      }

      if (this._viewOnly) {
        return;
      }

      if (!this._supportsSetDesktopSize) {
        return;
      }

      // Rate limit to one pending resize at a time
      if (this._pendingRemoteResize) {
        return;
      }

      // And no more than once every 100ms
      if (Date.now() - this._lastResize < 100) {
        clearTimeout(this._resizeTimeout);
        this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 100 - (Date.now() - this._lastResize));
        
return;
      }

      this._resizeTimeout = null;
      var size = this._screenSize();

      // Do we actually change anything?
      if (size.w === this._fbWidth && size.h === this._fbHeight) {
        return;
      }

      this._pendingRemoteResize = true;
      this._lastResize = Date.now();
      RFB.messages.setDesktopSize(this._sock, Math.floor(size.w), Math.floor(size.h), this._screenID, this._screenFlags);
      Log.Debug('Requested new desktop size: ' + size.w + 'x' + size.h);
    }

    // Gets the the size of the available screen
  }, {
    key: "_screenSize",
    value: function _screenSize() {
      var r = this._screen.getBoundingClientRect();

      
return {
        w: r.width,
        h: r.height
      };
    }
  }, {
    key: "_fixScrollbars",
    value: function _fixScrollbars() {
      // This is a hack because Safari on macOS screws up the calculation
      // for when scrollbars are needed. We get scrollbars when making the
      // browser smaller, despite remote resize being enabled. So to fix it
      // we temporarily toggle them off and on.
      var orig = this._screen.style.overflow;

      this._screen.style.overflow = 'hidden';

      // Force Safari to recalculate the layout by asking for
      // an element's dimensions
      this._screen.getBoundingClientRect();
      this._screen.style.overflow = orig;
    }

    /*
     * Connection states:
     *   connecting
     *   connected
     *   disconnecting
     *   disconnected - permanent state
     */
  }, {
    key: "_updateConnectionState",
    value: function _updateConnectionState(state) {
      var _this3 = this;
      var oldstate = this._rfbConnectionState;

      if (state === oldstate) {
        Log.Debug("Already in state '" + state + "', ignoring");
        
return;
      }

      // The 'disconnected' state is permanent for each RFB object
      if (oldstate === 'disconnected') {
        Log.Error("Tried changing state of a disconnected RFB object");
        
return;
      }

      // Ensure proper transitions before doing anything
      switch (state) {
        case 'connected':
          if (oldstate !== 'connecting') {
            Log.Error("Bad transition to connected state, " + "previous connection state: " + oldstate);
            
return;
          }

          break;
        case 'disconnected':
          if (oldstate !== 'disconnecting') {
            Log.Error("Bad transition to disconnected state, " + "previous connection state: " + oldstate);
            
return;
          }

          break;
        case 'connecting':
          if (oldstate !== '') {
            Log.Error("Bad transition to connecting state, " + "previous connection state: " + oldstate);
            
return;
          }

          break;
        case 'disconnecting':
          if (oldstate !== 'connected' && oldstate !== 'connecting') {
            Log.Error("Bad transition to disconnecting state, " + "previous connection state: " + oldstate);
            
return;
          }

          break;
        default:
          Log.Error("Unknown connection state: " + state);
          
return;
      }

      // State change actions

      this._rfbConnectionState = state;
      Log.Debug("New state '" + state + "', was '" + oldstate + "'.");

      if (this._disconnTimer && state !== 'disconnecting') {
        Log.Debug("Clearing disconnect timer");
        clearTimeout(this._disconnTimer);
        this._disconnTimer = null;

        // make sure we don't get a double event
        this._sock.off('close');
      }

      switch (state) {
        case 'connecting':
          this._connect();
          break;
        case 'connected':
          this.dispatchEvent(new CustomEvent("connect", {
            detail: {}
          }));
          break;
        case 'disconnecting':
          this._disconnect();
          this._disconnTimer = setTimeout(function () {
            Log.Error("Disconnection timed out.");
            _this3._updateConnectionState('disconnected');
          }, DISCONNECT_TIMEOUT * 1000);
          break;
        case 'disconnected':
          this.dispatchEvent(new CustomEvent("disconnect", {
            detail: {
              clean: this._rfbCleanDisconnect
            }
          }));
          break;
      }
    }

    /* Print errors and disconnect
     *
     * The parameter 'details' is used for information that
     * should be logged but not sent to the user interface.
     */
  }, {
    key: "_fail",
    value: function _fail(details) {
      switch (this._rfbConnectionState) {
        case 'disconnecting':
          Log.Error("Failed when disconnecting: " + details);
          break;
        case 'connected':
          Log.Error("Failed while connected: " + details);
          break;
        case 'connecting':
          Log.Error("Failed when connecting: " + details);
          break;
        default:
          Log.Error("RFB failure: " + details);
          break;
      }

      this._rfbCleanDisconnect = false; //This is sent to the UI

      // Transition to disconnected without waiting for socket to close
      this._updateConnectionState('disconnecting');
      this._updateConnectionState('disconnected');
      
return false;
    }
  }, {
    key: "_setCapability",
    value: function _setCapability(cap, val) {
      this._capabilities[cap] = val;
      this.dispatchEvent(new CustomEvent("capabilities", {
        detail: {
          capabilities: this._capabilities
        }
      }));
    }
  }, {
    key: "_handleMessage",
    value: function _handleMessage() {
      if (this._sock.rQwait("message", 1)) {
        Log.Warn("handleMessage called on an empty receive queue");
        
return;
      }

      switch (this._rfbConnectionState) {
        case 'disconnected':
          Log.Error("Got data while disconnected");
          break;
        case 'connected':
          while (true) {
            if (this._flushing) {
              break;
            }

            if (!this._normalMsg()) {
              break;
            }

            if (this._sock.rQwait("message", 1)) {
              break;
            }
          }

          break;
        case 'connecting':
          while (this._rfbConnectionState === 'connecting') {
            if (!this._initMsg()) {
              break;
            }
          }

          break;
        default:
          Log.Error("Got data while in an invalid state");
          break;
      }
    }
  }, {
    key: "_handleKeyEvent",
    value: function _handleKeyEvent(keysym, code, down, numlock, capslock) {
      // If remote state of capslock is known, and it doesn't match the local led state of
      // the keyboard, we send a capslock keypress first to bring it into sync.
      // If we just pressed CapsLock, or we toggled it remotely due to it being out of sync
      // we clear the remote state so that we don't send duplicate or spurious fixes,
      // since it may take some time to receive the new remote CapsLock state.
      if (code == 'CapsLock' && down) {
        this._remoteCapsLock = null;
      }

      if (this._remoteCapsLock !== null && capslock !== null && this._remoteCapsLock !== capslock && down) {
        Log.Debug("Fixing remote caps lock");
        this.sendKey(_keysym["default"].XK_Caps_Lock, 'CapsLock', true);
        this.sendKey(_keysym["default"].XK_Caps_Lock, 'CapsLock', false);

        // We clear the remote capsLock state when we do this to prevent issues with doing this twice
        // before we receive an update of the the remote state.
        this._remoteCapsLock = null;
      }

      // Logic for numlock is exactly the same.
      if (code == 'NumLock' && down) {
        this._remoteNumLock = null;
      }

      if (this._remoteNumLock !== null && numlock !== null && this._remoteNumLock !== numlock && down) {
        Log.Debug("Fixing remote num lock");
        this.sendKey(_keysym["default"].XK_Num_Lock, 'NumLock', true);
        this.sendKey(_keysym["default"].XK_Num_Lock, 'NumLock', false);
        this._remoteNumLock = null;
      }

      this.sendKey(keysym, code, down);
    }
  }, {
    key: "_handleMouse",
    value: function _handleMouse(ev) {
      /*
       * We don't check connection status or viewOnly here as the
       * mouse events might be used to control the viewport
       */

      if (ev.type === 'click') {
        /*
         * Note: This is only needed for the 'click' event as it fails
         *       to fire properly for the target element so we have
         *       to listen on the document element instead.
         */
        if (ev.target !== this._canvas) {
          return;
        }
      }

      // FIXME: if we're in view-only and not dragging,
      //        should we stop events?
      ev.stopPropagation();
      ev.preventDefault();

      if (ev.type === 'click' || ev.type === 'contextmenu') {
        return;
      }

      var pos = (0, _element.clientToElement)(ev.clientX, ev.clientY, this._canvas);
      var bmask = RFB._convertButtonMask(ev.buttons);
      var down = ev.type == 'mousedown';

      switch (ev.type) {
        case 'mousedown':
        case 'mouseup':
          if (this.dragViewport) {
            if (down && !this._viewportDragging) {
              this._viewportDragging = true;
              this._viewportDragPos = {
                'x': pos.x,
                'y': pos.y
              };
              this._viewportHasMoved = false;
              this._flushMouseMoveTimer(pos.x, pos.y);

              // Skip sending mouse events, instead save the current
              // mouse mask so we can send it later.
              this._mouseButtonMask = bmask;
              break;
            } else {
              this._viewportDragging = false;

              // If we actually performed a drag then we are done
              // here and should not send any mouse events
              if (this._viewportHasMoved) {
                this._mouseButtonMask = bmask;
                break;
              }


              // Otherwise we treat this as a mouse click event.
              // Send the previously saved button mask, followed
              // by the current button mask at the end of this
              // function.
              this._sendMouse(pos.x, pos.y, this._mouseButtonMask);
            }
          }

          if (down) {
            (0, _events.setCapture)(this._canvas);
          }

          this._handleMouseButton(pos.x, pos.y, bmask);
          break;
        case 'mousemove':
          if (this._viewportDragging) {
            var deltaX = this._viewportDragPos.x - pos.x;
            var deltaY = this._viewportDragPos.y - pos.y;

            if (this._viewportHasMoved || Math.abs(deltaX) > _browser.dragThreshold || Math.abs(deltaY) > _browser.dragThreshold) {
              this._viewportHasMoved = true;
              this._viewportDragPos = {
                'x': pos.x,
                'y': pos.y
              };
              this._display.viewportChangePos(deltaX, deltaY);
            }

            // Skip sending mouse events
            break;
          }

          this._handleMouseMove(pos.x, pos.y);
          break;
      }
    }
  }, {
    key: "_handleMouseButton",
    value: function _handleMouseButton(x, y, bmask) {
      // Flush waiting move event first
      this._flushMouseMoveTimer(x, y);
      this._mouseButtonMask = bmask;
      this._sendMouse(x, y, this._mouseButtonMask);
    }
  }, {
    key: "_handleMouseMove",
    value: function _handleMouseMove(x, y) {
      var _this4 = this;

      this._mousePos = {
        'x': x,
        'y': y
      };

      // Limit many mouse move events to one every MOUSE_MOVE_DELAY ms
      if (this._mouseMoveTimer == null) {
        var timeSinceLastMove = Date.now() - this._mouseLastMoveTime;

        if (timeSinceLastMove > MOUSE_MOVE_DELAY) {
          this._sendMouse(x, y, this._mouseButtonMask);
          this._mouseLastMoveTime = Date.now();
        } else {
          // Too soon since the latest move, wait the remaining time
          this._mouseMoveTimer = setTimeout(function () {
            _this4._handleDelayedMouseMove();
          }, MOUSE_MOVE_DELAY - timeSinceLastMove);
        }
      }
    }
  }, {
    key: "_handleDelayedMouseMove",
    value: function _handleDelayedMouseMove() {
      this._mouseMoveTimer = null;
      this._sendMouse(this._mousePos.x, this._mousePos.y, this._mouseButtonMask);
      this._mouseLastMoveTime = Date.now();
    }
  }, {
    key: "_sendMouse",
    value: function _sendMouse(x, y, mask) {
      if (this._rfbConnectionState !== 'connected') {
        return;
      }

      if (this._viewOnly) {
        return;
      } // View only, skip mouse events

      // Highest bit in mask is never sent to the server
      if (mask & 0x8000) {
        throw new Error("Illegal mouse button mask (mask: " + mask + ")");
      }

      var extendedMouseButtons = mask & 0x7f80;

      if (this._extendedPointerEventSupported && extendedMouseButtons) {
        RFB.messages.extendedPointerEvent(this._sock, this._display.absX(x), this._display.absY(y), mask);
      } else {
        RFB.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), mask);
      }
    }
  }, {
    key: "_handleWheel",
    value: function _handleWheel(ev) {
      if (this._rfbConnectionState !== 'connected') {
        return;
      }

      if (this._viewOnly) {
        return;
      } // View only, skip mouse events

      ev.stopPropagation();
      ev.preventDefault();
      var pos = (0, _element.clientToElement)(ev.clientX, ev.clientY, this._canvas);
      var bmask = RFB._convertButtonMask(ev.buttons);
      var dX = ev.deltaX;
      var dY = ev.deltaY;

      // Pixel units unless it's non-zero.
      // Note that if deltamode is line or page won't matter since we aren't
      // sending the mouse wheel delta to the server anyway.
      // The difference between pixel and line can be important however since
      // we have a threshold that can be smaller than the line height.
      if (ev.deltaMode !== 0) {
        dX *= WHEEL_LINE_HEIGHT;
        dY *= WHEEL_LINE_HEIGHT;
      }

      // Mouse wheel events are sent in steps over VNC. This means that the VNC
      // protocol can't handle a wheel event with specific distance or speed.
      // Therefor, if we get a lot of small mouse wheel events we combine them.
      this._accumulatedWheelDeltaX += dX;
      this._accumulatedWheelDeltaY += dY;

      // Generate a mouse wheel step event when the accumulated delta
      // for one of the axes is large enough.
      if (Math.abs(this._accumulatedWheelDeltaX) >= WHEEL_STEP) {
        if (this._accumulatedWheelDeltaX < 0) {
          this._handleMouseButton(pos.x, pos.y, bmask | 1 << 5);
          this._handleMouseButton(pos.x, pos.y, bmask);
        } else if (this._accumulatedWheelDeltaX > 0) {
          this._handleMouseButton(pos.x, pos.y, bmask | 1 << 6);
          this._handleMouseButton(pos.x, pos.y, bmask);
        }

        this._accumulatedWheelDeltaX = 0;
      }

      if (Math.abs(this._accumulatedWheelDeltaY) >= WHEEL_STEP) {
        if (this._accumulatedWheelDeltaY < 0) {
          this._handleMouseButton(pos.x, pos.y, bmask | 1 << 3);
          this._handleMouseButton(pos.x, pos.y, bmask);
        } else if (this._accumulatedWheelDeltaY > 0) {
          this._handleMouseButton(pos.x, pos.y, bmask | 1 << 4);
          this._handleMouseButton(pos.x, pos.y, bmask);
        }

        this._accumulatedWheelDeltaY = 0;
      }
    }
  }, {
    key: "_fakeMouseMove",
    value: function _fakeMouseMove(ev, elementX, elementY) {
      this._handleMouseMove(elementX, elementY);
      this._cursor.move(ev.detail.clientX, ev.detail.clientY);
    }
  }, {
    key: "_handleTapEvent",
    value: function _handleTapEvent(ev, bmask) {
      var pos = (0, _element.clientToElement)(ev.detail.clientX, ev.detail.clientY, this._canvas);

      // If the user quickly taps multiple times we assume they meant to
      // hit the same spot, so slightly adjust coordinates

      if (this._gestureLastTapTime !== null && Date.now() - this._gestureLastTapTime < DOUBLE_TAP_TIMEOUT && this._gestureFirstDoubleTapEv.detail.type === ev.detail.type) {
        var dx = this._gestureFirstDoubleTapEv.detail.clientX - ev.detail.clientX;
        var dy = this._gestureFirstDoubleTapEv.detail.clientY - ev.detail.clientY;
        var distance = Math.hypot(dx, dy);

        if (distance < DOUBLE_TAP_THRESHOLD) {
          pos = (0, _element.clientToElement)(this._gestureFirstDoubleTapEv.detail.clientX, this._gestureFirstDoubleTapEv.detail.clientY, this._canvas);
        } else {
          this._gestureFirstDoubleTapEv = ev;
        }
      } else {
        this._gestureFirstDoubleTapEv = ev;
      }

      this._gestureLastTapTime = Date.now();
      this._fakeMouseMove(this._gestureFirstDoubleTapEv, pos.x, pos.y);
      this._handleMouseButton(pos.x, pos.y, bmask);
      this._handleMouseButton(pos.x, pos.y, 0x0);
    }
  }, {
    key: "_handleGesture",
    value: function _handleGesture(ev) {
      var magnitude;
      var pos = (0, _element.clientToElement)(ev.detail.clientX, ev.detail.clientY, this._canvas);

      switch (ev.type) {
        case 'gesturestart':
          switch (ev.detail.type) {
            case 'onetap':
              this._handleTapEvent(ev, 0x1);
              break;
            case 'twotap':
              this._handleTapEvent(ev, 0x4);
              break;
            case 'threetap':
              this._handleTapEvent(ev, 0x2);
              break;
            case 'drag':
              if (this.dragViewport) {
                this._viewportHasMoved = false;
                this._viewportDragging = true;
                this._viewportDragPos = {
                  'x': pos.x,
                  'y': pos.y
                };
              } else {
                this._fakeMouseMove(ev, pos.x, pos.y);
                this._handleMouseButton(pos.x, pos.y, 0x1);
              }

              break;
            case 'longpress':
              if (this.dragViewport) {
                // If dragViewport is true, we need to wait to see
                // if we have dragged outside the threshold before
                // sending any events to the server.
                this._viewportHasMoved = false;
                this._viewportDragPos = {
                  'x': pos.x,
                  'y': pos.y
                };
              } else {
                this._fakeMouseMove(ev, pos.x, pos.y);
                this._handleMouseButton(pos.x, pos.y, 0x4);
              }

              break;
            case 'twodrag':
              this._gestureLastMagnitudeX = ev.detail.magnitudeX;
              this._gestureLastMagnitudeY = ev.detail.magnitudeY;
              this._fakeMouseMove(ev, pos.x, pos.y);
              break;
            case 'pinch':
              this._gestureLastMagnitudeX = Math.hypot(ev.detail.magnitudeX, ev.detail.magnitudeY);
              this._fakeMouseMove(ev, pos.x, pos.y);
              break;
          }

          break;
        case 'gesturemove':
          switch (ev.detail.type) {
            case 'onetap':
            case 'twotap':
            case 'threetap':
              break;
            case 'drag':
            case 'longpress':
              if (this.dragViewport) {
                this._viewportDragging = true;
                var deltaX = this._viewportDragPos.x - pos.x;
                var deltaY = this._viewportDragPos.y - pos.y;

                if (this._viewportHasMoved || Math.abs(deltaX) > _browser.dragThreshold || Math.abs(deltaY) > _browser.dragThreshold) {
                  this._viewportHasMoved = true;
                  this._viewportDragPos = {
                    'x': pos.x,
                    'y': pos.y
                  };
                  this._display.viewportChangePos(deltaX, deltaY);
                }
              } else {
                this._fakeMouseMove(ev, pos.x, pos.y);
              }

              break;
            case 'twodrag':
              // Always scroll in the same position.
              // We don't know if the mouse was moved so we need to move it
              // every update.
              this._fakeMouseMove(ev, pos.x, pos.y);

              while (ev.detail.magnitudeY - this._gestureLastMagnitudeY > GESTURE_SCRLSENS) {
                this._handleMouseButton(pos.x, pos.y, 0x8);
                this._handleMouseButton(pos.x, pos.y, 0x0);
                this._gestureLastMagnitudeY += GESTURE_SCRLSENS;
              }

              while (ev.detail.magnitudeY - this._gestureLastMagnitudeY < -GESTURE_SCRLSENS) {
                this._handleMouseButton(pos.x, pos.y, 0x10);
                this._handleMouseButton(pos.x, pos.y, 0x0);
                this._gestureLastMagnitudeY -= GESTURE_SCRLSENS;
              }

              while (ev.detail.magnitudeX - this._gestureLastMagnitudeX > GESTURE_SCRLSENS) {
                this._handleMouseButton(pos.x, pos.y, 0x20);
                this._handleMouseButton(pos.x, pos.y, 0x0);
                this._gestureLastMagnitudeX += GESTURE_SCRLSENS;
              }

              while (ev.detail.magnitudeX - this._gestureLastMagnitudeX < -GESTURE_SCRLSENS) {
                this._handleMouseButton(pos.x, pos.y, 0x40);
                this._handleMouseButton(pos.x, pos.y, 0x0);
                this._gestureLastMagnitudeX -= GESTURE_SCRLSENS;
              }

              break;
            case 'pinch':
              // Always scroll in the same position.
              // We don't know if the mouse was moved so we need to move it
              // every update.
              this._fakeMouseMove(ev, pos.x, pos.y);
              magnitude = Math.hypot(ev.detail.magnitudeX, ev.detail.magnitudeY);

              if (Math.abs(magnitude - this._gestureLastMagnitudeX) > GESTURE_ZOOMSENS) {
                this._handleKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true);

                while (magnitude - this._gestureLastMagnitudeX > GESTURE_ZOOMSENS) {
                  this._handleMouseButton(pos.x, pos.y, 0x8);
                  this._handleMouseButton(pos.x, pos.y, 0x0);
                  this._gestureLastMagnitudeX += GESTURE_ZOOMSENS;
                }

                while (magnitude - this._gestureLastMagnitudeX < -GESTURE_ZOOMSENS) {
                  this._handleMouseButton(pos.x, pos.y, 0x10);
                  this._handleMouseButton(pos.x, pos.y, 0x0);
                  this._gestureLastMagnitudeX -= GESTURE_ZOOMSENS;
                }
              }

              this._handleKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", false);
              break;
          }

          break;
        case 'gestureend':
          switch (ev.detail.type) {
            case 'onetap':
            case 'twotap':
            case 'threetap':
            case 'pinch':
            case 'twodrag':
              break;
            case 'drag':
              if (this.dragViewport) {
                this._viewportDragging = false;
              } else {
                this._fakeMouseMove(ev, pos.x, pos.y);
                this._handleMouseButton(pos.x, pos.y, 0x0);
              }

              break;
            case 'longpress':
              if (this._viewportHasMoved) {
                // We don't want to send any events if we have moved
                // our viewport
                break;
              }

              if (this.dragViewport && !this._viewportHasMoved) {
                this._fakeMouseMove(ev, pos.x, pos.y);

                // If dragViewport is true, we need to wait to see
                // if we have dragged outside the threshold before
                // sending any events to the server.
                this._handleMouseButton(pos.x, pos.y, 0x4);
                this._handleMouseButton(pos.x, pos.y, 0x0);
                this._viewportDragging = false;
              } else {
                this._fakeMouseMove(ev, pos.x, pos.y);
                this._handleMouseButton(pos.x, pos.y, 0x0);
              }

              break;
          }

          break;
      }
    }
  }, {
    key: "_flushMouseMoveTimer",
    value: function _flushMouseMoveTimer(x, y) {
      if (this._mouseMoveTimer !== null) {
        clearTimeout(this._mouseMoveTimer);
        this._mouseMoveTimer = null;
        this._sendMouse(x, y, this._mouseButtonMask);
      }
    }

    // Message handlers
  }, {
    key: "_negotiateProtocolVersion",
    value: function _negotiateProtocolVersion() {
      if (this._sock.rQwait("version", 12)) {
        return false;
      }

      var sversion = this._sock.rQshiftStr(12).substr(4, 7);

      Log.Info("Server ProtocolVersion: " + sversion);
      var isRepeater = 0;

      switch (sversion) {
        case "000.000":
          // UltraVNC repeater
          isRepeater = 1;
          break;
        case "003.003":
        case "003.006":
          // UltraVNC
          this._rfbVersion = 3.3;
          break;
        case "003.007":
          this._rfbVersion = 3.7;
          break;
        case "003.008":
        case "003.889": // Apple Remote Desktop
        case "004.000": // Intel AMT KVM
        case "004.001": // RealVNC 4.6
        case "005.000":
          // RealVNC 5.3
          this._rfbVersion = 3.8;
          break;
        default:
          return this._fail("Invalid server version " + sversion);
      }

      if (isRepeater) {
        var repeaterID = "ID:" + this._repeaterID;

        while (repeaterID.length < 250) {
          repeaterID += "\0";
        }

        this._sock.sQpushString(repeaterID);
        this._sock.flush();
        
return true;
      }

      if (this._rfbVersion > this._rfbMaxVersion) {
        this._rfbVersion = this._rfbMaxVersion;
      }

      var cversion = "00" + parseInt(this._rfbVersion, 10) + ".00" + this._rfbVersion * 10 % 10;

      this._sock.sQpushString("RFB " + cversion + "\n");
      this._sock.flush();
      Log.Debug('Sent ProtocolVersion: ' + cversion);
      this._rfbInitState = 'Security';
    }
  }, {
    key: "_isSupportedSecurityType",
    value: function _isSupportedSecurityType(type) {
      var clientTypes = [securityTypeNone, securityTypeVNCAuth, securityTypeRA2ne, securityTypeTight, securityTypeVeNCrypt, securityTypeXVP, securityTypeARD, securityTypeMSLogonII, securityTypePlain];

      
return clientTypes.includes(type);
    }
  }, {
    key: "_negotiateSecurity",
    value: function _negotiateSecurity() {
      if (this._rfbVersion >= 3.7) {
        // Server sends supported list, client decides
        var numTypes = this._sock.rQshift8();

        if (this._sock.rQwait("security type", numTypes, 1)) {
          return false;
        }

        if (numTypes === 0) {
          this._rfbInitState = "SecurityReason";
          this._securityContext = "no security types";
          this._securityStatus = 1;
          
return true;
        }

        var types = this._sock.rQshiftBytes(numTypes);

        Log.Debug("Server security types: " + types);

        // Look for a matching security type in the order that the
        // server prefers
        this._rfbAuthScheme = -1;
        var _iterator3 = _createForOfIteratorHelper(types),
          _step3;

        try {
          for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
            var type = _step3.value;

            if (this._isSupportedSecurityType(type)) {
              this._rfbAuthScheme = type;
              break;
            }
          }
        } catch (err) {
          _iterator3.e(err);
        } finally {
          _iterator3.f();
        }

        if (this._rfbAuthScheme === -1) {
          return this._fail("Unsupported security types (types: " + types + ")");
        }

        this._sock.sQpush8(this._rfbAuthScheme);
        this._sock.flush();
      } else {
        // Server decides
        if (this._sock.rQwait("security scheme", 4)) {
          return false;
        }

        this._rfbAuthScheme = this._sock.rQshift32();

        if (this._rfbAuthScheme == 0) {
          this._rfbInitState = "SecurityReason";
          this._securityContext = "authentication scheme";
          this._securityStatus = 1;
          
return true;
        }
      }

      this._rfbInitState = 'Authentication';
      Log.Debug('Authenticating using scheme: ' + this._rfbAuthScheme);
      
return true;
    }
  }, {
    key: "_handleSecurityReason",
    value: function _handleSecurityReason() {
      if (this._sock.rQwait("reason length", 4)) {
        return false;
      }

      var strlen = this._sock.rQshift32();
      var reason = "";

      if (strlen > 0) {
        if (this._sock.rQwait("reason", strlen, 4)) {
          return false;
        }

        reason = this._sock.rQshiftStr(strlen);
      }

      if (reason !== "") {
        this.dispatchEvent(new CustomEvent("securityfailure", {
          detail: {
            status: this._securityStatus,
            reason: reason
          }
        }));
        
return this._fail("Security negotiation failed on " + this._securityContext + " (reason: " + reason + ")");
      } else {
        this.dispatchEvent(new CustomEvent("securityfailure", {
          detail: {
            status: this._securityStatus
          }
        }));
        
return this._fail("Security negotiation failed on " + this._securityContext);
      }
    }

    // authentication
  }, {
    key: "_negotiateXvpAuth",
    value: function _negotiateXvpAuth() {
      if (this._rfbCredentials.username === undefined || this._rfbCredentials.password === undefined || this._rfbCredentials.target === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["username", "password", "target"]
          }
        }));
        
return false;
      }

      this._sock.sQpush8(this._rfbCredentials.username.length);
      this._sock.sQpush8(this._rfbCredentials.target.length);
      this._sock.sQpushString(this._rfbCredentials.username);
      this._sock.sQpushString(this._rfbCredentials.target);
      this._sock.flush();
      this._rfbAuthScheme = securityTypeVNCAuth;
      
return this._negotiateAuthentication();
    }

    // VeNCrypt authentication, currently only supports version 0.2 and only Plain subtype
  }, {
    key: "_negotiateVeNCryptAuth",
    value: function _negotiateVeNCryptAuth() {
      // waiting for VeNCrypt version
      if (this._rfbVeNCryptState == 0) {
        if (this._sock.rQwait("vencrypt version", 2)) {
          return false;
        }

        var major = this._sock.rQshift8();
        var minor = this._sock.rQshift8();

        if (!(major == 0 && minor == 2)) {
          return this._fail("Unsupported VeNCrypt version " + major + "." + minor);
        }

        this._sock.sQpush8(0);
        this._sock.sQpush8(2);
        this._sock.flush();
        this._rfbVeNCryptState = 1;
      }

      // waiting for ACK
      if (this._rfbVeNCryptState == 1) {
        if (this._sock.rQwait("vencrypt ack", 1)) {
          return false;
        }

        var res = this._sock.rQshift8();

        if (res != 0) {
          return this._fail("VeNCrypt failure " + res);
        }

        this._rfbVeNCryptState = 2;
      }

      // must fall through here (i.e. no "else if"), beacause we may have already received
      // the subtypes length and won't be called again

      if (this._rfbVeNCryptState == 2) {
        // waiting for subtypes length
        if (this._sock.rQwait("vencrypt subtypes length", 1)) {
          return false;
        }

        var subtypesLength = this._sock.rQshift8();

        if (subtypesLength < 1) {
          return this._fail("VeNCrypt subtypes empty");
        }

        this._rfbVeNCryptSubtypesLength = subtypesLength;
        this._rfbVeNCryptState = 3;
      }

      // waiting for subtypes list
      if (this._rfbVeNCryptState == 3) {
        if (this._sock.rQwait("vencrypt subtypes", 4 * this._rfbVeNCryptSubtypesLength)) {
          return false;
        }

        var subtypes = [];

        for (var i = 0; i < this._rfbVeNCryptSubtypesLength; i++) {
          subtypes.push(this._sock.rQshift32());
        }

        // Look for a matching security type in the order that the
        // server prefers
        this._rfbAuthScheme = -1;

        for (var _i = 0, _subtypes = subtypes; _i < _subtypes.length; _i++) {
          var type = _subtypes[_i];


          // Avoid getting in to a loop
          if (type === securityTypeVeNCrypt) {
            continue;
          }

          if (this._isSupportedSecurityType(type)) {
            this._rfbAuthScheme = type;
            break;
          }
        }

        if (this._rfbAuthScheme === -1) {
          return this._fail("Unsupported security types (types: " + subtypes + ")");
        }

        this._sock.sQpush32(this._rfbAuthScheme);
        this._sock.flush();
        this._rfbVeNCryptState = 4;
        
return true;
      }
    }
  }, {
    key: "_negotiatePlainAuth",
    value: function _negotiatePlainAuth() {
      if (this._rfbCredentials.username === undefined || this._rfbCredentials.password === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["username", "password"]
          }
        }));
        
return false;
      }

      var user = (0, _strings.encodeUTF8)(this._rfbCredentials.username);
      var pass = (0, _strings.encodeUTF8)(this._rfbCredentials.password);

      this._sock.sQpush32(user.length);
      this._sock.sQpush32(pass.length);
      this._sock.sQpushString(user);
      this._sock.sQpushString(pass);
      this._sock.flush();
      this._rfbInitState = "SecurityResult";
      
return true;
    }
  }, {
    key: "_negotiateStdVNCAuth",
    value: function _negotiateStdVNCAuth() {
      if (this._sock.rQwait("auth challenge", 16)) {
        return false;
      }

      if (this._rfbCredentials.password === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["password"]
          }
        }));
        
return false;
      }

      // TODO(directxman12): make genDES not require an Array
      var challenge = Array.prototype.slice.call(this._sock.rQshiftBytes(16));
      var response = RFB.genDES(this._rfbCredentials.password, challenge);

      this._sock.sQpushBytes(response);
      this._sock.flush();
      this._rfbInitState = "SecurityResult";
      
return true;
    }
  }, {
    key: "_negotiateARDAuth",
    value: function _negotiateARDAuth() {
      if (this._rfbCredentials.username === undefined || this._rfbCredentials.password === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["username", "password"]
          }
        }));
        
return false;
      }

      if (this._rfbCredentials.ardPublicKey != undefined && this._rfbCredentials.ardCredentials != undefined) {
        // if the async web crypto is done return the results
        this._sock.sQpushBytes(this._rfbCredentials.ardCredentials);
        this._sock.sQpushBytes(this._rfbCredentials.ardPublicKey);
        this._sock.flush();
        this._rfbCredentials.ardCredentials = null;
        this._rfbCredentials.ardPublicKey = null;
        this._rfbInitState = "SecurityResult";
        
return true;
      }

      if (this._sock.rQwait("read ard", 4)) {
        return false;
      }

      var generator = this._sock.rQshiftBytes(2); // DH base generator value

      var keyLength = this._sock.rQshift16();

      if (this._sock.rQwait("read ard keylength", keyLength * 2, 4)) {
        return false;
      }

      // read the server values
      var prime = this._sock.rQshiftBytes(keyLength); // predetermined prime modulus
      var serverPublicKey = this._sock.rQshiftBytes(keyLength); // other party's public key

      var clientKey = _crypto["default"].generateKey({
        name: "DH",
        g: generator,
        p: prime
      }, false, ["deriveBits"]);

      this._negotiateARDAuthAsync(keyLength, serverPublicKey, clientKey);
      
return false;
    }
  }, {
    key: "_negotiateARDAuthAsync",
    value: function () {
      var _negotiateARDAuthAsync2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(keyLength, serverPublicKey, clientKey) {
        var clientPublicKey, sharedKey, username, password, credentials, i, _i2, key, cipher, encrypted;

        
return _regeneratorRuntime().wrap(function _callee$(_context) {
          while (1) switch (_context.prev = _context.next) {
            case 0:
              clientPublicKey = _crypto["default"].exportKey("raw", clientKey.publicKey);
              sharedKey = _crypto["default"].deriveBits({
                name: "DH",
                "public": serverPublicKey
              }, clientKey.privateKey, keyLength * 8);
              username = (0, _strings.encodeUTF8)(this._rfbCredentials.username).substring(0, 63);
              password = (0, _strings.encodeUTF8)(this._rfbCredentials.password).substring(0, 63);
              credentials = window.crypto.getRandomValues(new Uint8Array(128));

              for (i = 0; i < username.length; i++) {
                credentials[i] = username.charCodeAt(i);
              }

              credentials[username.length] = 0;

              for (_i2 = 0; _i2 < password.length; _i2++) {
                credentials[64 + _i2] = password.charCodeAt(_i2);
              }

              credentials[64 + password.length] = 0;
              _context.next = 11;
              
return _crypto["default"].digest("MD5", sharedKey);
            case 11:
              key = _context.sent;
              _context.next = 14;
              
return _crypto["default"].importKey("raw", key, {
                name: "AES-ECB"
              }, false, ["encrypt"]);
            case 14:
              cipher = _context.sent;
              _context.next = 17;
              
return _crypto["default"].encrypt({
                name: "AES-ECB"
              }, cipher, credentials);
            case 17:
              encrypted = _context.sent;
              this._rfbCredentials.ardCredentials = encrypted;
              this._rfbCredentials.ardPublicKey = clientPublicKey;
              this._resumeAuthentication();
            case 21:
            case "end":
              return _context.stop();
          }
        }, _callee, this);
      }));

      function _negotiateARDAuthAsync(_x, _x2, _x3) {
        return _negotiateARDAuthAsync2.apply(this, arguments);
      }

      
return _negotiateARDAuthAsync;
    }()
  }, {
    key: "_negotiateTightUnixAuth",
    value: function _negotiateTightUnixAuth() {
      if (this._rfbCredentials.username === undefined || this._rfbCredentials.password === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["username", "password"]
          }
        }));
        
return false;
      }

      this._sock.sQpush32(this._rfbCredentials.username.length);
      this._sock.sQpush32(this._rfbCredentials.password.length);
      this._sock.sQpushString(this._rfbCredentials.username);
      this._sock.sQpushString(this._rfbCredentials.password);
      this._sock.flush();
      this._rfbInitState = "SecurityResult";
      
return true;
    }
  }, {
    key: "_negotiateTightTunnels",
    value: function _negotiateTightTunnels(numTunnels) {
      var clientSupportedTunnelTypes = {
        0: {
          vendor: 'TGHT',
          signature: 'NOTUNNEL'
        }
      };
      var serverSupportedTunnelTypes = {};


      // receive tunnel capabilities
      for (var i = 0; i < numTunnels; i++) {
        var capCode = this._sock.rQshift32();
        var capVendor = this._sock.rQshiftStr(4);
        var capSignature = this._sock.rQshiftStr(8);

        serverSupportedTunnelTypes[capCode] = {
          vendor: capVendor,
          signature: capSignature
        };
      }

      Log.Debug("Server Tight tunnel types: " + serverSupportedTunnelTypes);

      // Siemens touch panels have a VNC server that supports NOTUNNEL,
      // but forgets to advertise it. Try to detect such servers by
      // looking for their custom tunnel type.
      if (serverSupportedTunnelTypes[1] && serverSupportedTunnelTypes[1].vendor === "SICR" && serverSupportedTunnelTypes[1].signature === "SCHANNEL") {
        Log.Debug("Detected Siemens server. Assuming NOTUNNEL support.");
        serverSupportedTunnelTypes[0] = {
          vendor: 'TGHT',
          signature: 'NOTUNNEL'
        };
      }

      // choose the notunnel type
      if (serverSupportedTunnelTypes[0]) {
        if (serverSupportedTunnelTypes[0].vendor != clientSupportedTunnelTypes[0].vendor || serverSupportedTunnelTypes[0].signature != clientSupportedTunnelTypes[0].signature) {
          return this._fail("Client's tunnel type had the incorrect " + "vendor or signature");
        }

        Log.Debug("Selected tunnel type: " + clientSupportedTunnelTypes[0]);
        this._sock.sQpush32(0); // use NOTUNNEL
        this._sock.flush();
        
return false; // wait until we receive the sub auth count to continue
      } else {
        return this._fail("Server wanted tunnels, but doesn't support " + "the notunnel type");
      }
    }
  }, {
    key: "_negotiateTightAuth",
    value: function _negotiateTightAuth() {
      if (!this._rfbTightVNC) {
        // first pass, do the tunnel negotiation
        if (this._sock.rQwait("num tunnels", 4)) {
          return false;
        }

        var numTunnels = this._sock.rQshift32();

        if (numTunnels > 0 && this._sock.rQwait("tunnel capabilities", 16 * numTunnels, 4)) {
          return false;
        }

        this._rfbTightVNC = true;

        if (numTunnels > 0) {
          this._negotiateTightTunnels(numTunnels);
          
return false; // wait until we receive the sub auth to continue
        }
      }

      // second pass, do the sub-auth negotiation
      if (this._sock.rQwait("sub auth count", 4)) {
        return false;
      }

      var subAuthCount = this._sock.rQshift32();

      if (subAuthCount === 0) {
        // empty sub-auth list received means 'no auth' subtype selected
        this._rfbInitState = 'SecurityResult';
        
return true;
      }

      if (this._sock.rQwait("sub auth capabilities", 16 * subAuthCount, 4)) {
        return false;
      }

      var clientSupportedTypes = {
        'STDVNOAUTH__': 1,
        'STDVVNCAUTH_': 2,
        'TGHTULGNAUTH': 129
      };
      var serverSupportedTypes = [];

      for (var i = 0; i < subAuthCount; i++) {
        this._sock.rQshift32(); // capNum
        var capabilities = this._sock.rQshiftStr(12);

        serverSupportedTypes.push(capabilities);
      }

      Log.Debug("Server Tight authentication types: " + serverSupportedTypes);

      for (var authType in clientSupportedTypes) {
        if (serverSupportedTypes.indexOf(authType) != -1) {
          this._sock.sQpush32(clientSupportedTypes[authType]);
          this._sock.flush();
          Log.Debug("Selected authentication type: " + authType);

          switch (authType) {
            case 'STDVNOAUTH__':
              // no auth
              this._rfbInitState = 'SecurityResult';
              
return true;
            case 'STDVVNCAUTH_':
              this._rfbAuthScheme = securityTypeVNCAuth;
              
return true;
            case 'TGHTULGNAUTH':
              this._rfbAuthScheme = securityTypeUnixLogon;
              
return true;
            default:
              return this._fail("Unsupported tiny auth scheme " + "(scheme: " + authType + ")");
          }
        }
      }

      
return this._fail("No supported sub-auth types!");
    }
  }, {
    key: "_handleRSAAESCredentialsRequired",
    value: function _handleRSAAESCredentialsRequired(event) {
      this.dispatchEvent(event);
    }
  }, {
    key: "_handleRSAAESServerVerification",
    value: function _handleRSAAESServerVerification(event) {
      this.dispatchEvent(event);
    }
  }, {
    key: "_negotiateRA2neAuth",
    value: function _negotiateRA2neAuth() {
      var _this5 = this;

      if (this._rfbRSAAESAuthenticationState === null) {
        this._rfbRSAAESAuthenticationState = new _ra["default"](this._sock, function () {
          return _this5._rfbCredentials;
        });
        this._rfbRSAAESAuthenticationState.addEventListener("serververification", this._eventHandlers.handleRSAAESServerVerification);
        this._rfbRSAAESAuthenticationState.addEventListener("credentialsrequired", this._eventHandlers.handleRSAAESCredentialsRequired);
      }

      this._rfbRSAAESAuthenticationState.checkInternalEvents();

      if (!this._rfbRSAAESAuthenticationState.hasStarted) {
        this._rfbRSAAESAuthenticationState.negotiateRA2neAuthAsync()["catch"](function (e) {
          if (e.message !== "disconnect normally") {
            _this5._fail(e.message);
          }
        }).then(function () {
          _this5._rfbInitState = "SecurityResult";
          
return true;
        })["finally"](function () {
          _this5._rfbRSAAESAuthenticationState.removeEventListener("serververification", _this5._eventHandlers.handleRSAAESServerVerification);
          _this5._rfbRSAAESAuthenticationState.removeEventListener("credentialsrequired", _this5._eventHandlers.handleRSAAESCredentialsRequired);
          _this5._rfbRSAAESAuthenticationState = null;
        });
      }

      
return false;
    }
  }, {
    key: "_negotiateMSLogonIIAuth",
    value: function _negotiateMSLogonIIAuth() {
      if (this._sock.rQwait("mslogonii dh param", 24)) {
        return false;
      }

      if (this._rfbCredentials.username === undefined || this._rfbCredentials.password === undefined) {
        this.dispatchEvent(new CustomEvent("credentialsrequired", {
          detail: {
            types: ["username", "password"]
          }
        }));
        
return false;
      }

      var g = this._sock.rQshiftBytes(8);
      var p = this._sock.rQshiftBytes(8);
      var A = this._sock.rQshiftBytes(8);
      var dhKey = _crypto["default"].generateKey({
        name: "DH",
        g: g,
        p: p
      }, true, ["deriveBits"]);
      var B = _crypto["default"].exportKey("raw", dhKey.publicKey);
      var secret = _crypto["default"].deriveBits({
        name: "DH",
        "public": A
      }, dhKey.privateKey, 64);
      var key = _crypto["default"].importKey("raw", secret, {
        name: "DES-CBC"
      }, false, ["encrypt"]);
      var username = (0, _strings.encodeUTF8)(this._rfbCredentials.username).substring(0, 255);
      var password = (0, _strings.encodeUTF8)(this._rfbCredentials.password).substring(0, 63);
      var usernameBytes = new Uint8Array(256);
      var passwordBytes = new Uint8Array(64);

      window.crypto.getRandomValues(usernameBytes);
      window.crypto.getRandomValues(passwordBytes);

      for (var i = 0; i < username.length; i++) {
        usernameBytes[i] = username.charCodeAt(i);
      }

      usernameBytes[username.length] = 0;

      for (var _i3 = 0; _i3 < password.length; _i3++) {
        passwordBytes[_i3] = password.charCodeAt(_i3);
      }

      passwordBytes[password.length] = 0;
      usernameBytes = _crypto["default"].encrypt({
        name: "DES-CBC",
        iv: secret
      }, key, usernameBytes);
      passwordBytes = _crypto["default"].encrypt({
        name: "DES-CBC",
        iv: secret
      }, key, passwordBytes);
      this._sock.sQpushBytes(B);
      this._sock.sQpushBytes(usernameBytes);
      this._sock.sQpushBytes(passwordBytes);
      this._sock.flush();
      this._rfbInitState = "SecurityResult";
      
return true;
    }
  }, {
    key: "_negotiateAuthentication",
    value: function _negotiateAuthentication() {
      switch (this._rfbAuthScheme) {
        case securityTypeNone:
          if (this._rfbVersion >= 3.8) {
            this._rfbInitState = 'SecurityResult';
          } else {
            this._rfbInitState = 'ClientInitialisation';
          }

          
return true;
        case securityTypeXVP:
          return this._negotiateXvpAuth();
        case securityTypeARD:
          return this._negotiateARDAuth();
        case securityTypeVNCAuth:
          return this._negotiateStdVNCAuth();
        case securityTypeTight:
          return this._negotiateTightAuth();
        case securityTypeVeNCrypt:
          return this._negotiateVeNCryptAuth();
        case securityTypePlain:
          return this._negotiatePlainAuth();
        case securityTypeUnixLogon:
          return this._negotiateTightUnixAuth();
        case securityTypeRA2ne:
          return this._negotiateRA2neAuth();
        case securityTypeMSLogonII:
          return this._negotiateMSLogonIIAuth();
        default:
          return this._fail("Unsupported auth scheme (scheme: " + this._rfbAuthScheme + ")");
      }
    }
  }, {
    key: "_handleSecurityResult",
    value: function _handleSecurityResult() {
      if (this._sock.rQwait('VNC auth response ', 4)) {
        return false;
      }

      var status = this._sock.rQshift32();

      if (status === 0) {
        // OK
        this._rfbInitState = 'ClientInitialisation';
        Log.Debug('Authentication OK');
        
return true;
      } else {
        if (this._rfbVersion >= 3.8) {
          this._rfbInitState = "SecurityReason";
          this._securityContext = "security result";
          this._securityStatus = status;
          
return true;
        } else {
          this.dispatchEvent(new CustomEvent("securityfailure", {
            detail: {
              status: status
            }
          }));
          
return this._fail("Security handshake failed");
        }
      }
    }
  }, {
    key: "_negotiateServerInit",
    value: function _negotiateServerInit() {
      if (this._sock.rQwait("server initialization", 24)) {
        return false;
      }

      /* Screen size */
      var width = this._sock.rQshift16();
      var height = this._sock.rQshift16();

      /* PIXEL_FORMAT */
      var bpp = this._sock.rQshift8();
      var depth = this._sock.rQshift8();
      var bigEndian = this._sock.rQshift8();
      var trueColor = this._sock.rQshift8();
      var redMax = this._sock.rQshift16();
      var greenMax = this._sock.rQshift16();
      var blueMax = this._sock.rQshift16();
      var redShift = this._sock.rQshift8();
      var greenShift = this._sock.rQshift8();
      var blueShift = this._sock.rQshift8();

      this._sock.rQskipBytes(3); // padding

      // NB(directxman12): we don't want to call any callbacks or print messages until
      //                   *after* we're past the point where we could backtrack

      /* Connection name/title */
      var nameLength = this._sock.rQshift32();

      if (this._sock.rQwait('server init name', nameLength, 24)) {
        return false;
      }

      var name = this._sock.rQshiftStr(nameLength);

      name = (0, _strings.decodeUTF8)(name, true);

      if (this._rfbTightVNC) {
        if (this._sock.rQwait('TightVNC extended server init header', 8, 24 + nameLength)) {
          return false;
        }


        // In TightVNC mode, ServerInit message is extended
        var numServerMessages = this._sock.rQshift16();
        var numClientMessages = this._sock.rQshift16();
        var numEncodings = this._sock.rQshift16();

        this._sock.rQskipBytes(2); // padding

        var totalMessagesLength = (numServerMessages + numClientMessages + numEncodings) * 16;

        if (this._sock.rQwait('TightVNC extended server init header', totalMessagesLength, 32 + nameLength)) {
          return false;
        }

        // we don't actually do anything with the capability information that TIGHT sends,
        // so we just skip the all of this.

        // TIGHT server message capabilities
        this._sock.rQskipBytes(16 * numServerMessages);

        // TIGHT client message capabilities
        this._sock.rQskipBytes(16 * numClientMessages);

        // TIGHT encoding capabilities
        this._sock.rQskipBytes(16 * numEncodings);
      }

      // NB(directxman12): these are down here so that we don't run them multiple times
      //                   if we backtrack
      Log.Info("Screen: " + width + "x" + height + ", bpp: " + bpp + ", depth: " + depth + ", bigEndian: " + bigEndian + ", trueColor: " + trueColor + ", redMax: " + redMax + ", greenMax: " + greenMax + ", blueMax: " + blueMax + ", redShift: " + redShift + ", greenShift: " + greenShift + ", blueShift: " + blueShift);

      // we're past the point where we could backtrack, so it's safe to call this
      this._setDesktopName(name);
      this._resize(width, height);

      if (!this._viewOnly) {
        this._keyboard.grab();
      }

      this._fbDepth = 24;

      if (this._fbName === "Intel(r) AMT KVM") {
        Log.Warn("Intel AMT KVM only supports 8/16 bit depths. Using low color mode.");
        this._fbDepth = 8;
      }

      RFB.messages.pixelFormat(this._sock, this._fbDepth, true);
      this._sendEncodings();
      RFB.messages.fbUpdateRequest(this._sock, false, 0, 0, this._fbWidth, this._fbHeight);
      this._updateConnectionState('connected');
      
return true;
    }
  }, {
    key: "_sendEncodings",
    value: function _sendEncodings() {
      var encs = [];

      // In preference order
      encs.push(_encodings.encodings.encodingCopyRect);


      // Only supported with full depth support
      if (this._fbDepth == 24) {
        if (_browser.supportsWebCodecsH264Decode) {
          encs.push(_encodings.encodings.encodingH264);
        }

        encs.push(_encodings.encodings.encodingTight);
        encs.push(_encodings.encodings.encodingTightPNG);
        encs.push(_encodings.encodings.encodingZRLE);
        encs.push(_encodings.encodings.encodingJPEG);
        encs.push(_encodings.encodings.encodingHextile);
        encs.push(_encodings.encodings.encodingRRE);
        encs.push(_encodings.encodings.encodingZlib);
      }

      encs.push(_encodings.encodings.encodingRaw);

      // Psuedo-encoding settings
      encs.push(_encodings.encodings.pseudoEncodingQualityLevel0 + this._qualityLevel);
      encs.push(_encodings.encodings.pseudoEncodingCompressLevel0 + this._compressionLevel);
      encs.push(_encodings.encodings.pseudoEncodingDesktopSize);
      encs.push(_encodings.encodings.pseudoEncodingLastRect);
      encs.push(_encodings.encodings.pseudoEncodingQEMUExtendedKeyEvent);
      encs.push(_encodings.encodings.pseudoEncodingQEMULedEvent);
      encs.push(_encodings.encodings.pseudoEncodingExtendedDesktopSize);
      encs.push(_encodings.encodings.pseudoEncodingXvp);
      encs.push(_encodings.encodings.pseudoEncodingFence);
      encs.push(_encodings.encodings.pseudoEncodingContinuousUpdates);
      encs.push(_encodings.encodings.pseudoEncodingDesktopName);
      encs.push(_encodings.encodings.pseudoEncodingExtendedClipboard);
      encs.push(_encodings.encodings.pseudoEncodingExtendedMouseButtons);

      if (this._fbDepth == 24) {
        encs.push(_encodings.encodings.pseudoEncodingVMwareCursor);
        encs.push(_encodings.encodings.pseudoEncodingCursor);
      }

      RFB.messages.clientEncodings(this._sock, encs);
    }

    /* RFB protocol initialization states:
     *   ProtocolVersion
     *   Security
     *   Authentication
     *   SecurityResult
     *   ClientInitialization - not triggered by server message
     *   ServerInitialization
     */
  }, {
    key: "_initMsg",
    value: function _initMsg() {
      switch (this._rfbInitState) {
        case 'ProtocolVersion':
          return this._negotiateProtocolVersion();
        case 'Security':
          return this._negotiateSecurity();
        case 'Authentication':
          return this._negotiateAuthentication();
        case 'SecurityResult':
          return this._handleSecurityResult();
        case 'SecurityReason':
          return this._handleSecurityReason();
        case 'ClientInitialisation':
          this._sock.sQpush8(this._shared ? 1 : 0); // ClientInitialisation
          this._sock.flush();
          this._rfbInitState = 'ServerInitialisation';
          
return true;
        case 'ServerInitialisation':
          return this._negotiateServerInit();
        default:
          return this._fail("Unknown init state (state: " + this._rfbInitState + ")");
      }
    }

    // Resume authentication handshake after it was paused for some
    // reason, e.g. waiting for a password from the user
  }, {
    key: "_resumeAuthentication",
    value: function _resumeAuthentication() {
      // We use setTimeout() so it's run in its own context, just like
      // it originally did via the WebSocket's event handler
      setTimeout(this._initMsg.bind(this), 0);
    }
  }, {
    key: "_handleSetColourMapMsg",
    value: function _handleSetColourMapMsg() {
      Log.Debug("SetColorMapEntries");
      
return this._fail("Unexpected SetColorMapEntries message");
    }
  }, {
    key: "_handleServerCutText",
    value: function _handleServerCutText() {
      Log.Debug("ServerCutText");

      if (this._sock.rQwait("ServerCutText header", 7, 1)) {
        return false;
      }

      this._sock.rQskipBytes(3); // Padding

      var length = this._sock.rQshift32();

      length = (0, _int.toSigned32bit)(length);

      if (this._sock.rQwait("ServerCutText content", Math.abs(length), 8)) {
        return false;
      }

      if (length >= 0) {
        //Standard msg
        var text = this._sock.rQshiftStr(length);

        if (this._viewOnly) {
          return true;
        }

        this.dispatchEvent(new CustomEvent("clipboard", {
          detail: {
            text: text
          }
        }));
      } else {
        //Extended msg.
        length = Math.abs(length);
        var flags = this._sock.rQshift32();
        var formats = flags & 0x0000FFFF;
        var actions = flags & 0xFF000000;
        var isCaps = !!(actions & extendedClipboardActionCaps);

        if (isCaps) {
          this._clipboardServerCapabilitiesFormats = {};
          this._clipboardServerCapabilitiesActions = {};

          // Update our server capabilities for Formats
          for (var i = 0; i <= 15; i++) {
            var index = 1 << i;

            // Check if format flag is set.
            if (formats & index) {
              this._clipboardServerCapabilitiesFormats[index] = true;

              // We don't send unsolicited clipboard, so we
              // ignore the size
              this._sock.rQshift32();
            }
          }

          // Update our server capabilities for Actions
          for (var _i4 = 24; _i4 <= 31; _i4++) {
            var _index = 1 << _i4;

            this._clipboardServerCapabilitiesActions[_index] = !!(actions & _index);
          }

          /*  Caps handling done, send caps with the clients
              capabilities set as a response */
          var clientActions = [extendedClipboardActionCaps, extendedClipboardActionRequest, extendedClipboardActionPeek, extendedClipboardActionNotify, extendedClipboardActionProvide];

          RFB.messages.extendedClipboardCaps(this._sock, clientActions, {
            extendedClipboardFormatText: 0
          });
        } else if (actions === extendedClipboardActionRequest) {
          if (this._viewOnly) {
            return true;
          }

          // Check if server has told us it can handle Provide and there is clipboard data to send.
          if (this._clipboardText != null && this._clipboardServerCapabilitiesActions[extendedClipboardActionProvide]) {
            if (formats & extendedClipboardFormatText) {
              RFB.messages.extendedClipboardProvide(this._sock, [extendedClipboardFormatText], [this._clipboardText]);
            }
          }
        } else if (actions === extendedClipboardActionPeek) {
          if (this._viewOnly) {
            return true;
          }

          if (this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {
            if (this._clipboardText != null) {
              RFB.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
            } else {
              RFB.messages.extendedClipboardNotify(this._sock, []);
            }
          }
        } else if (actions === extendedClipboardActionNotify) {
          if (this._viewOnly) {
            return true;
          }

          if (this._clipboardServerCapabilitiesActions[extendedClipboardActionRequest]) {
            if (formats & extendedClipboardFormatText) {
              RFB.messages.extendedClipboardRequest(this._sock, [extendedClipboardFormatText]);
            }
          }
        } else if (actions === extendedClipboardActionProvide) {
          if (this._viewOnly) {
            return true;
          }

          if (!(formats & extendedClipboardFormatText)) {
            return true;
          }


          // Ignore what we had in our clipboard client side.
          this._clipboardText = null;

          // FIXME: Should probably verify that this data was actually requested
          var zlibStream = this._sock.rQshiftBytes(length - 4);
          var streamInflator = new _inflator["default"]();
          var textData = null;

          streamInflator.setInput(zlibStream);

          for (var _i5 = 0; _i5 <= 15; _i5++) {
            var format = 1 << _i5;

            if (formats & format) {
              var size = 0x00;
              var sizeArray = streamInflator.inflate(4);

              size |= sizeArray[0] << 24;
              size |= sizeArray[1] << 16;
              size |= sizeArray[2] << 8;
              size |= sizeArray[3];
              var chunk = streamInflator.inflate(size);

              if (format === extendedClipboardFormatText) {
                textData = chunk;
              }
            }
          }

          streamInflator.setInput(null);

          if (textData !== null) {
            var tmpText = "";

            for (var _i6 = 0; _i6 < textData.length; _i6++) {
              tmpText += String.fromCharCode(textData[_i6]);
            }

            textData = tmpText;
            textData = (0, _strings.decodeUTF8)(textData);

            if (textData.length > 0 && "\0" === textData.charAt(textData.length - 1)) {
              textData = textData.slice(0, -1);
            }

            textData = textData.replaceAll("\r\n", "\n");
            this.dispatchEvent(new CustomEvent("clipboard", {
              detail: {
                text: textData
              }
            }));
          }
        } else {
          return this._fail("Unexpected action in extended clipboard message: " + actions);
        }
      }

      
return true;
    }
  }, {
    key: "_handleServerFenceMsg",
    value: function _handleServerFenceMsg() {
      if (this._sock.rQwait("ServerFence header", 8, 1)) {
        return false;
      }

      this._sock.rQskipBytes(3); // Padding
      var flags = this._sock.rQshift32();
      var length = this._sock.rQshift8();

      if (this._sock.rQwait("ServerFence payload", length, 9)) {
        return false;
      }

      if (length > 64) {
        Log.Warn("Bad payload length (" + length + ") in fence response");
        length = 64;
      }

      var payload = this._sock.rQshiftStr(length);

      this._supportsFence = true;

      /*
       * Fence flags
       *
       *  (1<<0)  - BlockBefore
       *  (1<<1)  - BlockAfter
       *  (1<<2)  - SyncNext
       *  (1<<31) - Request
       */

      if (!(flags & 1 << 31)) {
        return this._fail("Unexpected fence response");
      }

      // Filter out unsupported flags
      // FIXME: support syncNext
      flags &= 1 << 0 | 1 << 1;

      // BlockBefore and BlockAfter are automatically handled by
      // the fact that we process each incoming message
      // synchronuosly.
      RFB.messages.clientFence(this._sock, flags, payload);
      
return true;
    }
  }, {
    key: "_handleXvpMsg",
    value: function _handleXvpMsg() {
      if (this._sock.rQwait("XVP version and message", 3, 1)) {
        return false;
      }

      this._sock.rQskipBytes(1); // Padding
      var xvpVer = this._sock.rQshift8();
      var xvpMsg = this._sock.rQshift8();

      switch (xvpMsg) {
        case 0:
          // XVP_FAIL
          Log.Error("XVP operation failed");
          break;
        case 1:
          // XVP_INIT
          this._rfbXvpVer = xvpVer;
          Log.Info("XVP extensions enabled (version " + this._rfbXvpVer + ")");
          this._setCapability("power", true);
          break;
        default:
          this._fail("Illegal server XVP message (msg: " + xvpMsg + ")");
          break;
      }

      
return true;
    }
  }, {
    key: "_normalMsg",
    value: function _normalMsg() {
      var msgType;

      if (this._FBU.rects > 0) {
        msgType = 0;
      } else {
        msgType = this._sock.rQshift8();
      }

      var first, ret;

      switch (msgType) {
        case 0:
          // FramebufferUpdate
          ret = this._framebufferUpdate();

          if (ret && !this._enabledContinuousUpdates) {
            RFB.messages.fbUpdateRequest(this._sock, true, 0, 0, this._fbWidth, this._fbHeight);
          }

          
return ret;
        case 1:
          // SetColorMapEntries
          return this._handleSetColourMapMsg();
        case 2:
          // Bell
          Log.Debug("Bell");
          this.dispatchEvent(new CustomEvent("bell", {
            detail: {}
          }));
          
return true;
        case 3:
          // ServerCutText
          return this._handleServerCutText();
        case 150:
          // EndOfContinuousUpdates
          first = !this._supportsContinuousUpdates;
          this._supportsContinuousUpdates = true;
          this._enabledContinuousUpdates = false;

          if (first) {
            this._enabledContinuousUpdates = true;
            this._updateContinuousUpdates();
            Log.Info("Enabling continuous updates.");
          } else {
            // FIXME: We need to send a framebufferupdaterequest here
            // if we add support for turning off continuous updates
          }

          
return true;
        case 248:
          // ServerFence
          return this._handleServerFenceMsg();
        case 250:
          // XVP
          return this._handleXvpMsg();
        default:
          this._fail("Unexpected server message (type " + msgType + ")");
          Log.Debug("sock.rQpeekBytes(30): " + this._sock.rQpeekBytes(30));
          
return true;
      }
    }
  }, {
    key: "_framebufferUpdate",
    value: function _framebufferUpdate() {
      var _this6 = this;

      if (this._FBU.rects === 0) {
        if (this._sock.rQwait("FBU header", 3, 1)) {
          return false;
        }

        this._sock.rQskipBytes(1); // Padding
        this._FBU.rects = this._sock.rQshift16();

        // Make sure the previous frame is fully rendered first
        // to avoid building up an excessive queue
        if (this._display.pending()) {
          this._flushing = true;
          this._display.flush().then(function () {
            _this6._flushing = false;


            // Resume processing
            if (!_this6._sock.rQwait("message", 1)) {
              _this6._handleMessage();
            }
          });
          
return false;
        }
      }

      while (this._FBU.rects > 0) {
        if (this._FBU.encoding === null) {
          if (this._sock.rQwait("rect header", 12)) {
            return false;
          }

          /* New FramebufferUpdate */

          this._FBU.x = this._sock.rQshift16();
          this._FBU.y = this._sock.rQshift16();
          this._FBU.width = this._sock.rQshift16();
          this._FBU.height = this._sock.rQshift16();
          this._FBU.encoding = this._sock.rQshift32();

          /* Encodings are signed */
          this._FBU.encoding >>= 0;
        }

        if (!this._handleRect()) {
          return false;
        }

        this._FBU.rects--;
        this._FBU.encoding = null;
      }

      this._display.flip();
      
return true; // We finished this FBU
    }
  }, {
    key: "_handleRect",
    value: function _handleRect() {
      switch (this._FBU.encoding) {
        case _encodings.encodings.pseudoEncodingLastRect:
          this._FBU.rects = 1; // Will be decreased when we return
          
return true;
        case _encodings.encodings.pseudoEncodingVMwareCursor:
          return this._handleVMwareCursor();
        case _encodings.encodings.pseudoEncodingCursor:
          return this._handleCursor();
        case _encodings.encodings.pseudoEncodingQEMUExtendedKeyEvent:
          this._qemuExtKeyEventSupported = true;
          
return true;
        case _encodings.encodings.pseudoEncodingDesktopName:
          return this._handleDesktopName();
        case _encodings.encodings.pseudoEncodingDesktopSize:
          this._resize(this._FBU.width, this._FBU.height);
          
return true;
        case _encodings.encodings.pseudoEncodingExtendedDesktopSize:
          return this._handleExtendedDesktopSize();
        case _encodings.encodings.pseudoEncodingExtendedMouseButtons:
          this._extendedPointerEventSupported = true;
          
return true;
        case _encodings.encodings.pseudoEncodingQEMULedEvent:
          return this._handleLedEvent();
        default:
          return this._handleDataRect();
      }
    }
  }, {
    key: "_handleVMwareCursor",
    value: function _handleVMwareCursor() {
      var hotx = this._FBU.x; // hotspot-x
      var hoty = this._FBU.y; // hotspot-y
      var w = this._FBU.width;
      var h = this._FBU.height;

      if (this._sock.rQwait("VMware cursor encoding", 1)) {
        return false;
      }

      var cursorType = this._sock.rQshift8();

      this._sock.rQshift8(); //Padding

      var rgba;
      var bytesPerPixel = 4;

      //Classic cursor
      if (cursorType == 0) {
        //Used to filter away unimportant bits.
        //OR is used for correct conversion in js.
        var PIXEL_MASK = 0xffffff00 | 0;

        rgba = new Array(w * h * bytesPerPixel);

        if (this._sock.rQwait("VMware cursor classic encoding", w * h * bytesPerPixel * 2, 2)) {
          return false;
        }

        var andMask = new Array(w * h);

        for (var pixel = 0; pixel < w * h; pixel++) {
          andMask[pixel] = this._sock.rQshift32();
        }

        var xorMask = new Array(w * h);

        for (var _pixel = 0; _pixel < w * h; _pixel++) {
          xorMask[_pixel] = this._sock.rQshift32();
        }

        for (var _pixel2 = 0; _pixel2 < w * h; _pixel2++) {
          if (andMask[_pixel2] == 0) {
            //Fully opaque pixel
            var bgr = xorMask[_pixel2];
            var r = bgr >> 8 & 0xff;
            var g = bgr >> 16 & 0xff;
            var b = bgr >> 24 & 0xff;

            rgba[_pixel2 * bytesPerPixel] = r; //r
            rgba[_pixel2 * bytesPerPixel + 1] = g; //g
            rgba[_pixel2 * bytesPerPixel + 2] = b; //b
            rgba[_pixel2 * bytesPerPixel + 3] = 0xff; //a
          } else if ((andMask[_pixel2] & PIXEL_MASK) == PIXEL_MASK) {
            //Only screen value matters, no mouse colouring
            if (xorMask[_pixel2] == 0) {
              //Transparent pixel
              rgba[_pixel2 * bytesPerPixel] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 1] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 2] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 3] = 0x00;
            } else if ((xorMask[_pixel2] & PIXEL_MASK) == PIXEL_MASK) {
              //Inverted pixel, not supported in browsers.
              //Fully opaque instead.
              rgba[_pixel2 * bytesPerPixel] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 1] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 2] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 3] = 0xff;
            } else {
              //Unhandled xorMask
              rgba[_pixel2 * bytesPerPixel] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 1] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 2] = 0x00;
              rgba[_pixel2 * bytesPerPixel + 3] = 0xff;
            }
          } else {
            //Unhandled andMask
            rgba[_pixel2 * bytesPerPixel] = 0x00;
            rgba[_pixel2 * bytesPerPixel + 1] = 0x00;
            rgba[_pixel2 * bytesPerPixel + 2] = 0x00;
            rgba[_pixel2 * bytesPerPixel + 3] = 0xff;
          }
        }

        //Alpha cursor.
      } else if (cursorType == 1) {
        if (this._sock.rQwait("VMware cursor alpha encoding", w * h * 4, 2)) {
          return false;
        }

        rgba = new Array(w * h * bytesPerPixel);

        for (var _pixel3 = 0; _pixel3 < w * h; _pixel3++) {
          var data = this._sock.rQshift32();

          rgba[_pixel3 * 4] = data >> 24 & 0xff; //r
          rgba[_pixel3 * 4 + 1] = data >> 16 & 0xff; //g
          rgba[_pixel3 * 4 + 2] = data >> 8 & 0xff; //b
          rgba[_pixel3 * 4 + 3] = data & 0xff; //a
        }
      } else {
        Log.Warn("The given cursor type is not supported: " + cursorType + " given.");
        
return false;
      }

      this._updateCursor(rgba, hotx, hoty, w, h);
      
return true;
    }
  }, {
    key: "_handleCursor",
    value: function _handleCursor() {
      var hotx = this._FBU.x; // hotspot-x
      var hoty = this._FBU.y; // hotspot-y
      var w = this._FBU.width;
      var h = this._FBU.height;
      var pixelslength = w * h * 4;
      var masklength = Math.ceil(w / 8) * h;
      var bytes = pixelslength + masklength;

      if (this._sock.rQwait("cursor encoding", bytes)) {
        return false;
      }

      // Decode from BGRX pixels + bit mask to RGBA
      var pixels = this._sock.rQshiftBytes(pixelslength);
      var mask = this._sock.rQshiftBytes(masklength);
      var rgba = new Uint8Array(w * h * 4);
      var pixIdx = 0;

      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var maskIdx = y * Math.ceil(w / 8) + Math.floor(x / 8);
          var alpha = mask[maskIdx] << x % 8 & 0x80 ? 255 : 0;

          rgba[pixIdx] = pixels[pixIdx + 2];
          rgba[pixIdx + 1] = pixels[pixIdx + 1];
          rgba[pixIdx + 2] = pixels[pixIdx];
          rgba[pixIdx + 3] = alpha;
          pixIdx += 4;
        }
      }

      this._updateCursor(rgba, hotx, hoty, w, h);
      
return true;
    }
  }, {
    key: "_handleDesktopName",
    value: function _handleDesktopName() {
      if (this._sock.rQwait("DesktopName", 4)) {
        return false;
      }

      var length = this._sock.rQshift32();

      if (this._sock.rQwait("DesktopName", length, 4)) {
        return false;
      }

      var name = this._sock.rQshiftStr(length);

      name = (0, _strings.decodeUTF8)(name, true);
      this._setDesktopName(name);
      
return true;
    }
  }, {
    key: "_handleLedEvent",
    value: function _handleLedEvent() {
      if (this._sock.rQwait("LED status", 1)) {
        return false;
      }

      var data = this._sock.rQshift8();

      // ScrollLock state can be retrieved with data & 1. This is currently not needed.
      var numLock = data & 2 ? true : false;
      var capsLock = data & 4 ? true : false;

      this._remoteCapsLock = capsLock;
      this._remoteNumLock = numLock;
      
return true;
    }
  }, {
    key: "_handleExtendedDesktopSize",
    value: function _handleExtendedDesktopSize() {
      if (this._sock.rQwait("ExtendedDesktopSize", 4)) {
        return false;
      }

      var numberOfScreens = this._sock.rQpeek8();
      var bytes = 4 + numberOfScreens * 16;

      if (this._sock.rQwait("ExtendedDesktopSize", bytes)) {
        return false;
      }

      var firstUpdate = !this._supportsSetDesktopSize;

      this._supportsSetDesktopSize = true;
      this._sock.rQskipBytes(1); // number-of-screens
      this._sock.rQskipBytes(3); // padding

      for (var i = 0; i < numberOfScreens; i += 1) {
        // Save the id and flags of the first screen
        if (i === 0) {
          this._screenID = this._sock.rQshift32(); // id
          this._sock.rQskipBytes(2); // x-position
          this._sock.rQskipBytes(2); // y-position
          this._sock.rQskipBytes(2); // width
          this._sock.rQskipBytes(2); // height
          this._screenFlags = this._sock.rQshift32(); // flags
        } else {
          this._sock.rQskipBytes(16);
        }
      }

      /*
       * The x-position indicates the reason for the change:
       *
       *  0 - server resized on its own
       *  1 - this client requested the resize
       *  2 - another client requested the resize
       */

      if (this._FBU.x === 1) {
        this._pendingRemoteResize = false;
      }

      // We need to handle errors when we requested the resize.
      if (this._FBU.x === 1 && this._FBU.y !== 0) {
        var msg = "";


        // The y-position indicates the status code from the server
        switch (this._FBU.y) {
          case 1:
            msg = "Resize is administratively prohibited";
            break;
          case 2:
            msg = "Out of resources";
            break;
          case 3:
            msg = "Invalid screen layout";
            break;
          default:
            msg = "Unknown reason";
            break;
        }

        Log.Warn("Server did not accept the resize request: " + msg);
      } else {
        this._resize(this._FBU.width, this._FBU.height);
      }

      // Normally we only apply the current resize mode after a
      // window resize event. However there is no such trigger on the
      // initial connect. And we don't know if the server supports
      // resizing until we've gotten here.
      if (firstUpdate) {
        this._requestRemoteResize();
      }

      if (this._FBU.x === 1 && this._FBU.y === 0) {
        // We might have resized again whilst waiting for the
        // previous request, so check if we are in sync
        this._requestRemoteResize();
      }

      
return true;
    }
  }, {
    key: "_handleDataRect",
    value: function _handleDataRect() {
      var decoder = this._decoders[this._FBU.encoding];

      if (!decoder) {
        this._fail("Unsupported encoding (encoding: " + this._FBU.encoding + ")");
        
return false;
      }

      try {
        return decoder.decodeRect(this._FBU.x, this._FBU.y, this._FBU.width, this._FBU.height, this._sock, this._display, this._fbDepth);
      } catch (err) {
        this._fail("Error decoding rect: " + err);
        
return false;
      }
    }
  }, {
    key: "_updateContinuousUpdates",
    value: function _updateContinuousUpdates() {
      if (!this._enabledContinuousUpdates) {
        return;
      }

      RFB.messages.enableContinuousUpdates(this._sock, true, 0, 0, this._fbWidth, this._fbHeight);
    }

    // Handle resize-messages from the server
  }, {
    key: "_resize",
    value: function _resize(width, height) {
      this._fbWidth = width;
      this._fbHeight = height;
      this._display.resize(this._fbWidth, this._fbHeight);

      // Adjust the visible viewport based on the new dimensions
      this._updateClip();
      this._updateScale();
      this._updateContinuousUpdates();

      // Keep this size until browser client size changes
      this._saveExpectedClientSize();
    }
  }, {
    key: "_xvpOp",
    value: function _xvpOp(ver, op) {
      if (this._rfbXvpVer < ver) {
        return;
      }

      Log.Info("Sending XVP operation " + op + " (version " + ver + ")");
      RFB.messages.xvpOp(this._sock, ver, op);
    }
  }, {
    key: "_updateCursor",
    value: function _updateCursor(rgba, hotx, hoty, w, h) {
      this._cursorImage = {
        rgbaPixels: rgba,
        hotx: hotx,
        hoty: hoty,
        w: w,
        h: h
      };
      this._refreshCursor();
    }
  }, {
    key: "_shouldShowDotCursor",
    value: function _shouldShowDotCursor() {
      // Called when this._cursorImage is updated
      if (!this._showDotCursor) {
        // User does not want to see the dot, so...
        return false;
      }

      // The dot should not be shown if the cursor is already visible,
      // i.e. contains at least one not-fully-transparent pixel.
      // So iterate through all alpha bytes in rgba and stop at the
      // first non-zero.
      for (var i = 3; i < this._cursorImage.rgbaPixels.length; i += 4) {
        if (this._cursorImage.rgbaPixels[i]) {
          return false;
        }
      }

      // At this point, we know that the cursor is fully transparent, and
      // the user wants to see the dot instead of this.
      return true;
    }
  }, {
    key: "_refreshCursor",
    value: function _refreshCursor() {
      if (this._rfbConnectionState !== "connecting" && this._rfbConnectionState !== "connected") {
        return;
      }

      var image = this._shouldShowDotCursor() ? RFB.cursors.dot : this._cursorImage;

      this._cursor.change(image.rgbaPixels, image.hotx, image.hoty, image.w, image.h);
    }
  }], [{
    key: "_convertButtonMask",
    value: function _convertButtonMask(buttons) {
      /* The bits in MouseEvent.buttons property correspond
       * to the following mouse buttons:
       *     0: Left
       *     1: Right
       *     2: Middle
       *     3: Back
       *     4: Forward
       *
       * These bits needs to be converted to what they are defined as
       * in the RFB protocol.
       */

      var buttonMaskMap = {
        0: 1 << 0,

        // Left
        1: 1 << 2,

        // Right
        2: 1 << 1,

        // Middle
        3: 1 << 7,

        // Back
        4: 1 << 8 // Forward
      };
      var bmask = 0;

      for (var i = 0; i < 5; i++) {
        if (buttons & 1 << i) {
          bmask |= buttonMaskMap[i];
        }
      }

      
return bmask;
    }
  }, {
    key: "genDES",
    value: function genDES(password, challenge) {
      var passwordChars = password.split('').map(function (c) {
        return c.charCodeAt(0);
      });
      var key = _crypto["default"].importKey("raw", passwordChars, {
        name: "DES-ECB"
      }, false, ["encrypt"]);

      
return _crypto["default"].encrypt({
        name: "DES-ECB"
      }, key, challenge);
    }
  }]);
}(_eventtarget["default"]); // Class Methods

RFB.messages = {
  keyEvent: function keyEvent(sock, keysym, down) {
    sock.sQpush8(4); // msg-type
    sock.sQpush8(down);
    sock.sQpush16(0);
    sock.sQpush32(keysym);
    sock.flush();
  },
  QEMUExtendedKeyEvent: function QEMUExtendedKeyEvent(sock, keysym, down, keycode) {
    function getRFBkeycode(xtScanCode) {
      var upperByte = keycode >> 8;
      var lowerByte = keycode & 0x00ff;

      if (upperByte === 0xe0 && lowerByte < 0x7f) {
        return lowerByte | 0x80;
      }

      
return xtScanCode;
    }

    sock.sQpush8(255); // msg-type
    sock.sQpush8(0); // sub msg-type

    sock.sQpush16(down);
    sock.sQpush32(keysym);
    var RFBkeycode = getRFBkeycode(keycode);

    sock.sQpush32(RFBkeycode);
    sock.flush();
  },
  pointerEvent: function pointerEvent(sock, x, y, mask) {
    sock.sQpush8(5); // msg-type

    // Marker bit must be set to 0, otherwise the server might
    // confuse the marker bit with the highest bit in a normal
    // PointerEvent message.
    mask = mask & 0x7f;
    sock.sQpush8(mask);
    sock.sQpush16(x);
    sock.sQpush16(y);
    sock.flush();
  },
  extendedPointerEvent: function extendedPointerEvent(sock, x, y, mask) {
    sock.sQpush8(5); // msg-type

    var higherBits = mask >> 7 & 0xff;

    // Bits 2-7 are reserved
    if (higherBits & 0xfc) {
      throw new Error("Invalid mouse button mask: " + mask);
    }

    var lowerBits = mask & 0x7f;

    lowerBits |= 0x80; // Set marker bit to 1

    sock.sQpush8(lowerBits);
    sock.sQpush16(x);
    sock.sQpush16(y);
    sock.sQpush8(higherBits);
    sock.flush();
  },

  // Used to build Notify and Request data.
  _buildExtendedClipboardFlags: function _buildExtendedClipboardFlags(actions, formats) {
    var data = new Uint8Array(4);
    var formatFlag = 0x00000000;
    var actionFlag = 0x00000000;

    for (var i = 0; i < actions.length; i++) {
      actionFlag |= actions[i];
    }

    for (var _i7 = 0; _i7 < formats.length; _i7++) {
      formatFlag |= formats[_i7];
    }

    data[0] = actionFlag >> 24; // Actions
    data[1] = 0x00; // Reserved
    data[2] = 0x00; // Reserved
    data[3] = formatFlag; // Formats

    return data;
  },
  extendedClipboardProvide: function extendedClipboardProvide(sock, formats, inData) {
    // Deflate incomming data and their sizes
    var deflator = new _deflator["default"]();
    var dataToDeflate = [];

    for (var i = 0; i < formats.length; i++) {
      // We only support the format Text at this time
      if (formats[i] != extendedClipboardFormatText) {
        throw new Error("Unsupported extended clipboard format for Provide message.");
      }

      // Change lone \r or \n into \r\n as defined in rfbproto
      inData[i] = inData[i].replace(/\r\n|\r|\n/gm, "\r\n");

      // Check if it already has \0
      var text = (0, _strings.encodeUTF8)(inData[i] + "\0");

      dataToDeflate.push(text.length >> 24 & 0xFF, text.length >> 16 & 0xFF, text.length >> 8 & 0xFF, text.length & 0xFF);

      for (var j = 0; j < text.length; j++) {
        dataToDeflate.push(text.charCodeAt(j));
      }
    }

    var deflatedData = deflator.deflate(new Uint8Array(dataToDeflate));

    // Build data  to send
    var data = new Uint8Array(4 + deflatedData.length);

    data.set(RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionProvide], formats));
    data.set(deflatedData, 4);
    RFB.messages.clientCutText(sock, data, true);
  },
  extendedClipboardNotify: function extendedClipboardNotify(sock, formats) {
    var flags = RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionNotify], formats);

    RFB.messages.clientCutText(sock, flags, true);
  },
  extendedClipboardRequest: function extendedClipboardRequest(sock, formats) {
    var flags = RFB.messages._buildExtendedClipboardFlags([extendedClipboardActionRequest], formats);

    RFB.messages.clientCutText(sock, flags, true);
  },
  extendedClipboardCaps: function extendedClipboardCaps(sock, actions, formats) {
    var formatKeys = Object.keys(formats);
    var data = new Uint8Array(4 + 4 * formatKeys.length);

    formatKeys.map(function (x) {
      return parseInt(x);
    });
    formatKeys.sort(function (a, b) {
      return a - b;
    });
    data.set(RFB.messages._buildExtendedClipboardFlags(actions, []));
    var loopOffset = 4;

    for (var i = 0; i < formatKeys.length; i++) {
      data[loopOffset] = formats[formatKeys[i]] >> 24;
      data[loopOffset + 1] = formats[formatKeys[i]] >> 16;
      data[loopOffset + 2] = formats[formatKeys[i]] >> 8;
      data[loopOffset + 3] = formats[formatKeys[i]] >> 0;
      loopOffset += 4;
      data[3] |= 1 << formatKeys[i]; // Update our format flags
    }

    RFB.messages.clientCutText(sock, data, true);
  },
  clientCutText: function clientCutText(sock, data) {
    var extended = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    sock.sQpush8(6); // msg-type

    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding

    var length;

    if (extended) {
      length = (0, _int.toUnsigned32bit)(-data.length);
    } else {
      length = data.length;
    }

    sock.sQpush32(length);
    sock.sQpushBytes(data);
    sock.flush();
  },
  setDesktopSize: function setDesktopSize(sock, width, height, id, flags) {
    sock.sQpush8(251); // msg-type

    sock.sQpush8(0); // padding

    sock.sQpush16(width);
    sock.sQpush16(height);
    sock.sQpush8(1); // number-of-screens

    sock.sQpush8(0); // padding

    // screen array
    sock.sQpush32(id);
    sock.sQpush16(0); // x-position
    sock.sQpush16(0); // y-position
    sock.sQpush16(width);
    sock.sQpush16(height);
    sock.sQpush32(flags);
    sock.flush();
  },
  clientFence: function clientFence(sock, flags, payload) {
    sock.sQpush8(248); // msg-type

    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding

    sock.sQpush32(flags);
    sock.sQpush8(payload.length);
    sock.sQpushString(payload);
    sock.flush();
  },
  enableContinuousUpdates: function enableContinuousUpdates(sock, enable, x, y, width, height) {
    sock.sQpush8(150); // msg-type

    sock.sQpush8(enable);
    sock.sQpush16(x);
    sock.sQpush16(y);
    sock.sQpush16(width);
    sock.sQpush16(height);
    sock.flush();
  },
  pixelFormat: function pixelFormat(sock, depth, trueColor) {
    var bpp;

    if (depth > 16) {
      bpp = 32;
    } else if (depth > 8) {
      bpp = 16;
    } else {
      bpp = 8;
    }

    var bits = Math.floor(depth / 3);

    sock.sQpush8(0); // msg-type

    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding

    sock.sQpush8(bpp);
    sock.sQpush8(depth);
    sock.sQpush8(0); // little-endian
    sock.sQpush8(trueColor ? 1 : 0);
    sock.sQpush16((1 << bits) - 1); // red-max
    sock.sQpush16((1 << bits) - 1); // green-max
    sock.sQpush16((1 << bits) - 1); // blue-max

    sock.sQpush8(bits * 0); // red-shift
    sock.sQpush8(bits * 1); // green-shift
    sock.sQpush8(bits * 2); // blue-shift

    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding
    sock.sQpush8(0); // padding

    sock.flush();
  },
  clientEncodings: function clientEncodings(sock, encodings) {
    sock.sQpush8(2); // msg-type

    sock.sQpush8(0); // padding

    sock.sQpush16(encodings.length);

    for (var i = 0; i < encodings.length; i++) {
      sock.sQpush32(encodings[i]);
    }

    sock.flush();
  },
  fbUpdateRequest: function fbUpdateRequest(sock, incremental, x, y, w, h) {
    if (typeof x === "undefined") {
      x = 0;
    }

    if (typeof y === "undefined") {
      y = 0;
    }

    sock.sQpush8(3); // msg-type

    sock.sQpush8(incremental ? 1 : 0);
    sock.sQpush16(x);
    sock.sQpush16(y);
    sock.sQpush16(w);
    sock.sQpush16(h);
    sock.flush();
  },
  xvpOp: function xvpOp(sock, ver, op) {
    sock.sQpush8(250); // msg-type

    sock.sQpush8(0); // padding

    sock.sQpush8(ver);
    sock.sQpush8(op);
    sock.flush();
  }
};
RFB.cursors = {
  none: {
    rgbaPixels: new Uint8Array(),
    w: 0,
    h: 0,
    hotx: 0,
    hoty: 0
  },
  dot: {
    /* eslint-disable indent */
    rgbaPixels: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
    /* eslint-enable indent */
    w: 3,
    h: 3,
    hotx: 1,
    hoty: 1
  }
};