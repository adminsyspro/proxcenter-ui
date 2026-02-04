"use strict";
var noVNC = (() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;

  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // node_modules/@novnc/novnc/lib/util/int.js
  var require_int = __commonJS({
    "node_modules/@novnc/novnc/lib/util/int.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.toSigned32bit = toSigned32bit;
      exports.toUnsigned32bit = toUnsigned32bit;

      function toUnsigned32bit(toConvert) {
        return toConvert >>> 0;
      }

      function toSigned32bit(toConvert) {
        return toConvert | 0;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/util/logging.js
  var require_logging = __commonJS({
    "node_modules/@novnc/novnc/lib/util/logging.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.Warn = exports.Info = exports.Error = exports.Debug = void 0;
      exports.getLogging = getLogging;
      exports.initLogging = initLogging;
      var _logLevel = "warn";

      var Debug = exports.Debug = function Debug2() {
      };

      var Info = exports.Info = function Info2() {
      };

      var Warn = exports.Warn = function Warn2() {
      };

      var Error2 = exports.Error = function Error3() {
      };

      function initLogging(level) {
        if (typeof level === "undefined") {
          level = _logLevel;
        } else {
          _logLevel = level;
        }

        exports.Debug = Debug = exports.Info = Info = exports.Warn = Warn = exports.Error = Error2 = function Error3() {
        };

        if (typeof window.console !== "undefined") {
          switch (level) {
            case "debug":
              exports.Debug = Debug = console.debug.bind(window.console);
            case "info":
              exports.Info = Info = console.info.bind(window.console);
            case "warn":
              exports.Warn = Warn = console.warn.bind(window.console);
            case "error":
              exports.Error = Error2 = console.error.bind(window.console);
            case "none":
              break;
            default:
              throw new window.Error("invalid logging type '" + level + "'");
          }
        }
      }

      function getLogging() {
        return _logLevel;
      }

      initLogging();
    }
  });

  // node_modules/@novnc/novnc/lib/util/strings.js
  var require_strings = __commonJS({
    "node_modules/@novnc/novnc/lib/util/strings.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.decodeUTF8 = decodeUTF8;
      exports.encodeUTF8 = encodeUTF8;

      function decodeUTF8(utf8string) {
        var allowLatin1 = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;

        try {
          return decodeURIComponent(escape(utf8string));
        } catch (e) {
          if (e instanceof URIError) {
            if (allowLatin1) {
              return utf8string;
            }
          }

          throw e;
        }
      }

      function encodeUTF8(DOMString) {
        return unescape(encodeURIComponent(DOMString));
      }
    }
  });

  // node_modules/@novnc/novnc/lib/util/browser.js
  var require_browser = __commonJS({
    "node_modules/@novnc/novnc/lib/util/browser.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.hasScrollbarGutter = exports.dragThreshold = void 0;
      exports.isAndroid = isAndroid;
      exports.isBlink = isBlink;
      exports.isChrome = isChrome;
      exports.isChromeOS = isChromeOS;
      exports.isChromium = isChromium;
      exports.isEdge = isEdge;
      exports.isFirefox = isFirefox;
      exports.isGecko = isGecko;
      exports.isIOS = isIOS;
      exports.isMac = isMac;
      exports.isOpera = isOpera;
      exports.isSafari = isSafari;
      exports.isTouchDevice = void 0;
      exports.isWebKit = isWebKit;
      exports.isWindows = isWindows;
      exports.supportsCursorURIs = void 0;
      var Log = _interopRequireWildcard(require_logging());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var isTouchDevice = exports.isTouchDevice = "ontouchstart" in document.documentElement || // requried for Chrome debugger
      document.ontouchstart !== void 0 || // required for MS Surface
      navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;

      window.addEventListener("touchstart", function onFirstTouch() {
        exports.isTouchDevice = isTouchDevice = true;
        window.removeEventListener("touchstart", onFirstTouch, false);
      }, false);
      var dragThreshold = exports.dragThreshold = 10 * (window.devicePixelRatio || 1);
      var _supportsCursorURIs = false;

      try {
        target = document.createElement("canvas");
        target.style.cursor = 'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default';

        if (target.style.cursor.indexOf("url") === 0) {
          Log.Info("Data URI scheme cursor supported");
          _supportsCursorURIs = true;
        } else {
          Log.Warn("Data URI scheme cursor not supported");
        }
      } catch (exc) {
        Log.Error("Data URI scheme cursor test exception: " + exc);
      }

      var target;
      var supportsCursorURIs = exports.supportsCursorURIs = _supportsCursorURIs;
      var _hasScrollbarGutter = true;

      try {
        container = document.createElement("div");
        container.style.visibility = "hidden";
        container.style.overflow = "scroll";
        document.body.appendChild(container);
        child = document.createElement("div");
        container.appendChild(child);
        scrollbarWidth = container.offsetWidth - child.offsetWidth;
        container.parentNode.removeChild(container);
        _hasScrollbarGutter = scrollbarWidth != 0;
      } catch (exc) {
        Log.Error("Scrollbar test exception: " + exc);
      }

      var container;
      var child;
      var scrollbarWidth;
      var hasScrollbarGutter = exports.hasScrollbarGutter = _hasScrollbarGutter;

      function isMac() {
        return !!/mac/i.exec(navigator.platform);
      }

      function isWindows() {
        return !!/win/i.exec(navigator.platform);
      }

      function isIOS() {
        return !!/ipad/i.exec(navigator.platform) || !!/iphone/i.exec(navigator.platform) || !!/ipod/i.exec(navigator.platform);
      }

      function isAndroid() {
        return !!navigator.userAgent.match("Android ");
      }

      function isChromeOS() {
        return !!navigator.userAgent.match(" CrOS ");
      }

      function isSafari() {
        return !!navigator.userAgent.match("Safari/...") && !navigator.userAgent.match("Chrome/...") && !navigator.userAgent.match("Chromium/...") && !navigator.userAgent.match("Epiphany/...");
      }

      function isFirefox() {
        return !!navigator.userAgent.match("Firefox/...") && !navigator.userAgent.match("Seamonkey/...");
      }

      function isChrome() {
        return !!navigator.userAgent.match("Chrome/...") && !navigator.userAgent.match("Chromium/...") && !navigator.userAgent.match("Edg/...") && !navigator.userAgent.match("OPR/...");
      }

      function isChromium() {
        return !!navigator.userAgent.match("Chromium/...");
      }

      function isOpera() {
        return !!navigator.userAgent.match("OPR/...");
      }

      function isEdge() {
        return !!navigator.userAgent.match("Edg/...");
      }

      function isGecko() {
        return !!navigator.userAgent.match("Gecko/...");
      }

      function isWebKit() {
        return !!navigator.userAgent.match("AppleWebKit/...") && !navigator.userAgent.match("Chrome/...");
      }

      function isBlink() {
        return !!navigator.userAgent.match("Chrome/...");
      }
    }
  });

  // node_modules/@novnc/novnc/lib/util/element.js
  var require_element = __commonJS({
    "node_modules/@novnc/novnc/lib/util/element.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.clientToElement = clientToElement;

      function clientToElement(x, y, elem) {
        var bounds = elem.getBoundingClientRect();
        var pos = {
          x: 0,
          y: 0
        };

        if (x < bounds.left) {
          pos.x = 0;
        } else if (x >= bounds.right) {
          pos.x = bounds.width - 1;
        } else {
          pos.x = x - bounds.left;
        }

        if (y < bounds.top) {
          pos.y = 0;
        } else if (y >= bounds.bottom) {
          pos.y = bounds.height - 1;
        } else {
          pos.y = y - bounds.top;
        }

        
return pos;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/util/events.js
  var require_events = __commonJS({
    "node_modules/@novnc/novnc/lib/util/events.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.getPointerEvent = getPointerEvent;
      exports.releaseCapture = releaseCapture;
      exports.setCapture = setCapture;
      exports.stopEvent = stopEvent;

      function getPointerEvent(e) {
        return e.changedTouches ? e.changedTouches[0] : e.touches ? e.touches[0] : e;
      }

      function stopEvent(e) {
        e.stopPropagation();
        e.preventDefault();
      }

      var _captureRecursion = false;
      var _elementForUnflushedEvents = null;

      document.captureElement = null;

      function _captureProxy(e) {
        if (_captureRecursion) return;
        var newEv = new e.constructor(e.type, e);

        _captureRecursion = true;

        if (document.captureElement) {
          document.captureElement.dispatchEvent(newEv);
        } else {
          _elementForUnflushedEvents.dispatchEvent(newEv);
        }

        _captureRecursion = false;
        e.stopPropagation();

        if (newEv.defaultPrevented) {
          e.preventDefault();
        }

        if (e.type === "mouseup") {
          releaseCapture();
        }
      }

      function _capturedElemChanged() {
        var proxyElem = document.getElementById("noVNC_mouse_capture_elem");

        proxyElem.style.cursor = window.getComputedStyle(document.captureElement).cursor;
      }

      var _captureObserver = new MutationObserver(_capturedElemChanged);

      function setCapture(target) {
        if (target.setCapture) {
          target.setCapture();
          document.captureElement = target;
        } else {
          releaseCapture();
          var proxyElem = document.getElementById("noVNC_mouse_capture_elem");

          if (proxyElem === null) {
            proxyElem = document.createElement("div");
            proxyElem.id = "noVNC_mouse_capture_elem";
            proxyElem.style.position = "fixed";
            proxyElem.style.top = "0px";
            proxyElem.style.left = "0px";
            proxyElem.style.width = "100%";
            proxyElem.style.height = "100%";
            proxyElem.style.zIndex = 1e4;
            proxyElem.style.display = "none";
            document.body.appendChild(proxyElem);
            proxyElem.addEventListener("contextmenu", _captureProxy);
            proxyElem.addEventListener("mousemove", _captureProxy);
            proxyElem.addEventListener("mouseup", _captureProxy);
          }

          document.captureElement = target;
          _captureObserver.observe(target, {
            attributes: true
          });
          _capturedElemChanged();
          proxyElem.style.display = "";
          window.addEventListener("mousemove", _captureProxy);
          window.addEventListener("mouseup", _captureProxy);
        }
      }

      function releaseCapture() {
        if (document.releaseCapture) {
          document.releaseCapture();
          document.captureElement = null;
        } else {
          if (!document.captureElement) {
            return;
          }

          _elementForUnflushedEvents = document.captureElement;
          document.captureElement = null;
          _captureObserver.disconnect();
          var proxyElem = document.getElementById("noVNC_mouse_capture_elem");

          proxyElem.style.display = "none";
          window.removeEventListener("mousemove", _captureProxy);
          window.removeEventListener("mouseup", _captureProxy);
        }
      }
    }
  });

  // node_modules/@novnc/novnc/lib/util/eventtarget.js
  var require_eventtarget = __commonJS({
    "node_modules/@novnc/novnc/lib/util/eventtarget.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var EventTargetMixin = exports["default"] = /* @__PURE__ */ (function() {
        function EventTargetMixin2() {
          _classCallCheck(this, EventTargetMixin2);
          this._listeners = /* @__PURE__ */ new Map();
        }

        
return _createClass(EventTargetMixin2, [{
          key: "addEventListener",
          value: function addEventListener(type, callback) {
            if (!this._listeners.has(type)) {
              this._listeners.set(type, /* @__PURE__ */ new Set());
            }

            this._listeners.get(type).add(callback);
          }
        }, {
          key: "removeEventListener",
          value: function removeEventListener(type, callback) {
            if (this._listeners.has(type)) {
              this._listeners.get(type)["delete"](callback);
            }
          }
        }, {
          key: "dispatchEvent",
          value: function dispatchEvent(event) {
            var _this = this;

            if (!this._listeners.has(event.type)) {
              return true;
            }

            this._listeners.get(event.type).forEach(function(callback) {
              return callback.call(_this, event);
            });
            
return !event.defaultPrevented;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/base64.js
  var require_base64 = __commonJS({
    "node_modules/@novnc/novnc/lib/base64.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var _default = exports["default"] = {
        /* Convert data (an array of integers) to a Base64 string. */
        toBase64Table: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=".split(""),
        base64Pad: "=",
        encode: function encode(data) {
          "use strict";
          var result = "";
          var length = data.length;
          var lengthpad = length % 3;

          for (var i = 0; i < length - 2; i += 3) {
            result += this.toBase64Table[data[i] >> 2];
            result += this.toBase64Table[((data[i] & 3) << 4) + (data[i + 1] >> 4)];
            result += this.toBase64Table[((data[i + 1] & 15) << 2) + (data[i + 2] >> 6)];
            result += this.toBase64Table[data[i + 2] & 63];
          }

          var j = length - lengthpad;

          if (lengthpad === 2) {
            result += this.toBase64Table[data[j] >> 2];
            result += this.toBase64Table[((data[j] & 3) << 4) + (data[j + 1] >> 4)];
            result += this.toBase64Table[(data[j + 1] & 15) << 2];
            result += this.toBase64Table[64];
          } else if (lengthpad === 1) {
            result += this.toBase64Table[data[j] >> 2];
            result += this.toBase64Table[(data[j] & 3) << 4];
            result += this.toBase64Table[64];
            result += this.toBase64Table[64];
          }

          
return result;
        },

        /* Convert Base64 data to a string */
        /* eslint-disable comma-spacing */
        toBinaryTable: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, 0, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1],
        /* eslint-enable comma-spacing */
        decode: function decode(data) {
          var offset = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
          var dataLength = data.indexOf("=") - offset;

          if (dataLength < 0) {
            dataLength = data.length - offset;
          }

          var resultLength = (dataLength >> 2) * 3 + Math.floor(dataLength % 4 / 1.5);
          var result = new Array(resultLength);
          var leftbits = 0;
          var leftdata = 0;

          for (var idx = 0, i = offset; i < data.length; i++) {
            var c = this.toBinaryTable[data.charCodeAt(i) & 127];
            var padding = data.charAt(i) === this.base64Pad;

            if (c === -1) {
              Log.Error("Illegal character code " + data.charCodeAt(i) + " at position " + i);
              continue;
            }

            leftdata = leftdata << 6 | c;
            leftbits += 6;

            if (leftbits >= 8) {
              leftbits -= 8;

              if (!padding) {
                result[idx++] = leftdata >> leftbits & 255;
              }

              leftdata &= (1 << leftbits) - 1;
            }
          }

          if (leftbits) {
            var err = new Error("Corrupted base64 string");

            err.name = "Base64-Error";
            throw err;
          }

          
return result;
        }
      };
    }
  });

  // node_modules/@novnc/novnc/lib/display.js
  var require_display = __commonJS({
    "node_modules/@novnc/novnc/lib/display.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());
      var _base = _interopRequireDefault(require_base64());
      var _int = require_int();

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var Display = exports["default"] = /* @__PURE__ */ (function() {
        function Display2(target) {
          _classCallCheck(this, Display2);
          this._drawCtx = null;
          this._renderQ = [];
          this._flushPromise = null;
          this._fbWidth = 0;
          this._fbHeight = 0;
          this._prevDrawStyle = "";
          Log.Debug(">> Display.constructor");
          this._target = target;

          if (!this._target) {
            throw new Error("Target must be set");
          }

          if (typeof this._target === "string") {
            throw new Error("target must be a DOM element");
          }

          if (!this._target.getContext) {
            throw new Error("no getContext method");
          }

          this._targetCtx = this._target.getContext("2d");
          this._viewportLoc = {
            "x": 0,
            "y": 0,
            "w": this._target.width,
            "h": this._target.height
          };
          this._backbuffer = document.createElement("canvas");
          this._drawCtx = this._backbuffer.getContext("2d");
          this._damageBounds = {
            left: 0,
            top: 0,
            right: this._backbuffer.width,
            bottom: this._backbuffer.height
          };
          Log.Debug("User Agent: " + navigator.userAgent);
          Log.Debug("<< Display.constructor");
          this._scale = 1;
          this._clipViewport = false;
        }

        
return _createClass(Display2, [{
          key: "scale",
          get: function get() {
            return this._scale;
          },
          set: function set(scale) {
            this._rescale(scale);
          }
        }, {
          key: "clipViewport",
          get: function get() {
            return this._clipViewport;
          },
          set: function set(viewport) {
            this._clipViewport = viewport;
            var vp = this._viewportLoc;

            this.viewportChangeSize(vp.w, vp.h);
            this.viewportChangePos(0, 0);
          }
        }, {
          key: "width",
          get: function get() {
            return this._fbWidth;
          }
        }, {
          key: "height",
          get: function get() {
            return this._fbHeight;
          }

          // ===== PUBLIC METHODS =====
        }, {
          key: "viewportChangePos",
          value: function viewportChangePos(deltaX, deltaY) {
            var vp = this._viewportLoc;

            deltaX = Math.floor(deltaX);
            deltaY = Math.floor(deltaY);

            if (!this._clipViewport) {
              deltaX = -vp.w;
              deltaY = -vp.h;
            }

            var vx2 = vp.x + vp.w - 1;
            var vy2 = vp.y + vp.h - 1;

            if (deltaX < 0 && vp.x + deltaX < 0) {
              deltaX = -vp.x;
            }

            if (vx2 + deltaX >= this._fbWidth) {
              deltaX -= vx2 + deltaX - this._fbWidth + 1;
            }

            if (vp.y + deltaY < 0) {
              deltaY = -vp.y;
            }

            if (vy2 + deltaY >= this._fbHeight) {
              deltaY -= vy2 + deltaY - this._fbHeight + 1;
            }

            if (deltaX === 0 && deltaY === 0) {
              return;
            }

            Log.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);
            vp.x += deltaX;
            vp.y += deltaY;
            this._damage(vp.x, vp.y, vp.w, vp.h);
            this.flip();
          }
        }, {
          key: "viewportChangeSize",
          value: function viewportChangeSize(width, height) {
            if (!this._clipViewport || typeof width === "undefined" || typeof height === "undefined") {
              Log.Debug("Setting viewport to full display region");
              width = this._fbWidth;
              height = this._fbHeight;
            }

            width = Math.floor(width);
            height = Math.floor(height);

            if (width > this._fbWidth) {
              width = this._fbWidth;
            }

            if (height > this._fbHeight) {
              height = this._fbHeight;
            }

            var vp = this._viewportLoc;

            if (vp.w !== width || vp.h !== height) {
              vp.w = width;
              vp.h = height;
              var canvas = this._target;

              canvas.width = width;
              canvas.height = height;
              this.viewportChangePos(0, 0);
              this._damage(vp.x, vp.y, vp.w, vp.h);
              this.flip();
              this._rescale(this._scale);
            }
          }
        }, {
          key: "absX",
          value: function absX(x) {
            if (this._scale === 0) {
              return 0;
            }

            
return (0, _int.toSigned32bit)(x / this._scale + this._viewportLoc.x);
          }
        }, {
          key: "absY",
          value: function absY(y) {
            if (this._scale === 0) {
              return 0;
            }

            
return (0, _int.toSigned32bit)(y / this._scale + this._viewportLoc.y);
          }
        }, {
          key: "resize",
          value: function resize(width, height) {
            this._prevDrawStyle = "";
            this._fbWidth = width;
            this._fbHeight = height;
            var canvas = this._backbuffer;

            if (canvas.width !== width || canvas.height !== height) {
              var saveImg = null;

              if (canvas.width > 0 && canvas.height > 0) {
                saveImg = this._drawCtx.getImageData(0, 0, canvas.width, canvas.height);
              }

              if (canvas.width !== width) {
                canvas.width = width;
              }

              if (canvas.height !== height) {
                canvas.height = height;
              }

              if (saveImg) {
                this._drawCtx.putImageData(saveImg, 0, 0);
              }
            }

            var vp = this._viewportLoc;

            this.viewportChangeSize(vp.w, vp.h);
            this.viewportChangePos(0, 0);
          }
        }, {
          key: "getImageData",
          value: function getImageData() {
            return this._drawCtx.getImageData(0, 0, this.width, this.height);
          }
        }, {
          key: "toDataURL",
          value: function toDataURL(type, encoderOptions) {
            return this._backbuffer.toDataURL(type, encoderOptions);
          }
        }, {
          key: "toBlob",
          value: function toBlob(callback, type, quality) {
            return this._backbuffer.toBlob(callback, type, quality);
          }

          // Track what parts of the visible canvas that need updating
        }, {
          key: "_damage",
          value: function _damage(x, y, w, h) {
            if (x < this._damageBounds.left) {
              this._damageBounds.left = x;
            }

            if (y < this._damageBounds.top) {
              this._damageBounds.top = y;
            }

            if (x + w > this._damageBounds.right) {
              this._damageBounds.right = x + w;
            }

            if (y + h > this._damageBounds.bottom) {
              this._damageBounds.bottom = y + h;
            }
          }

          // Update the visible canvas with the contents of the
          // rendering canvas
        }, {
          key: "flip",
          value: function flip(fromQueue) {
            if (this._renderQ.length !== 0 && !fromQueue) {
              this._renderQPush({
                "type": "flip"
              });
            } else {
              var x = this._damageBounds.left;
              var y = this._damageBounds.top;
              var w = this._damageBounds.right - x;
              var h = this._damageBounds.bottom - y;
              var vx = x - this._viewportLoc.x;
              var vy = y - this._viewportLoc.y;

              if (vx < 0) {
                w += vx;
                x -= vx;
                vx = 0;
              }

              if (vy < 0) {
                h += vy;
                y -= vy;
                vy = 0;
              }

              if (vx + w > this._viewportLoc.w) {
                w = this._viewportLoc.w - vx;
              }

              if (vy + h > this._viewportLoc.h) {
                h = this._viewportLoc.h - vy;
              }

              if (w > 0 && h > 0) {
                this._targetCtx.drawImage(this._backbuffer, x, y, w, h, vx, vy, w, h);
              }

              this._damageBounds.left = this._damageBounds.top = 65535;
              this._damageBounds.right = this._damageBounds.bottom = 0;
            }
          }
        }, {
          key: "pending",
          value: function pending() {
            return this._renderQ.length > 0;
          }
        }, {
          key: "flush",
          value: function flush() {
            var _this = this;

            if (this._renderQ.length === 0) {
              return Promise.resolve();
            } else {
              if (this._flushPromise === null) {
                this._flushPromise = new Promise(function(resolve) {
                  _this._flushResolve = resolve;
                });
              }

              
return this._flushPromise;
            }
          }
        }, {
          key: "fillRect",
          value: function fillRect(x, y, width, height, color, fromQueue) {
            if (this._renderQ.length !== 0 && !fromQueue) {
              this._renderQPush({
                "type": "fill",
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "color": color
              });
            } else {
              this._setFillColor(color);
              this._drawCtx.fillRect(x, y, width, height);
              this._damage(x, y, width, height);
            }
          }
        }, {
          key: "copyImage",
          value: function copyImage(oldX, oldY, newX, newY, w, h, fromQueue) {
            if (this._renderQ.length !== 0 && !fromQueue) {
              this._renderQPush({
                "type": "copy",
                "oldX": oldX,
                "oldY": oldY,
                "x": newX,
                "y": newY,
                "width": w,
                "height": h
              });
            } else {
              this._drawCtx.mozImageSmoothingEnabled = false;
              this._drawCtx.webkitImageSmoothingEnabled = false;
              this._drawCtx.msImageSmoothingEnabled = false;
              this._drawCtx.imageSmoothingEnabled = false;
              this._drawCtx.drawImage(this._backbuffer, oldX, oldY, w, h, newX, newY, w, h);
              this._damage(newX, newY, w, h);
            }
          }
        }, {
          key: "imageRect",
          value: function imageRect(x, y, width, height, mime, arr) {
            if (width === 0 || height === 0) {
              return;
            }

            var img = new Image();

            img.src = "data: " + mime + ";base64," + _base["default"].encode(arr);
            this._renderQPush({
              "type": "img",
              "img": img,
              "x": x,
              "y": y,
              "width": width,
              "height": height
            });
          }
        }, {
          key: "blitImage",
          value: function blitImage(x, y, width, height, arr, offset, fromQueue) {
            if (this._renderQ.length !== 0 && !fromQueue) {
              var newArr = new Uint8Array(width * height * 4);

              newArr.set(new Uint8Array(arr.buffer, 0, newArr.length));
              this._renderQPush({
                "type": "blit",
                "data": newArr,
                "x": x,
                "y": y,
                "width": width,
                "height": height
              });
            } else {
              var data = new Uint8ClampedArray(arr.buffer, arr.byteOffset + offset, width * height * 4);
              var img = new ImageData(data, width, height);

              this._drawCtx.putImageData(img, x, y);
              this._damage(x, y, width, height);
            }
          }
        }, {
          key: "drawImage",
          value: function drawImage(img, x, y) {
            this._drawCtx.drawImage(img, x, y);
            this._damage(x, y, img.width, img.height);
          }
        }, {
          key: "autoscale",
          value: function autoscale(containerWidth, containerHeight) {
            var scaleRatio;

            if (containerWidth === 0 || containerHeight === 0) {
              scaleRatio = 0;
            } else {
              var vp = this._viewportLoc;
              var targetAspectRatio = containerWidth / containerHeight;
              var fbAspectRatio = vp.w / vp.h;

              if (fbAspectRatio >= targetAspectRatio) {
                scaleRatio = containerWidth / vp.w;
              } else {
                scaleRatio = containerHeight / vp.h;
              }
            }

            this._rescale(scaleRatio);
          }

          // ===== PRIVATE METHODS =====
        }, {
          key: "_rescale",
          value: function _rescale(factor) {
            this._scale = factor;
            var vp = this._viewportLoc;
            var width = factor * vp.w + "px";
            var height = factor * vp.h + "px";

            if (this._target.style.width !== width || this._target.style.height !== height) {
              this._target.style.width = width;
              this._target.style.height = height;
            }
          }
        }, {
          key: "_setFillColor",
          value: function _setFillColor(color) {
            var newStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";

            if (newStyle !== this._prevDrawStyle) {
              this._drawCtx.fillStyle = newStyle;
              this._prevDrawStyle = newStyle;
            }
          }
        }, {
          key: "_renderQPush",
          value: function _renderQPush(action) {
            this._renderQ.push(action);

            if (this._renderQ.length === 1) {
              this._scanRenderQ();
            }
          }
        }, {
          key: "_resumeRenderQ",
          value: function _resumeRenderQ() {
            this.removeEventListener("load", this._noVNCDisplay._resumeRenderQ);
            this._noVNCDisplay._scanRenderQ();
          }
        }, {
          key: "_scanRenderQ",
          value: function _scanRenderQ() {
            var ready = true;

            while (ready && this._renderQ.length > 0) {
              var a = this._renderQ[0];

              switch (a.type) {
                case "flip":
                  this.flip(true);
                  break;
                case "copy":
                  this.copyImage(a.oldX, a.oldY, a.x, a.y, a.width, a.height, true);
                  break;
                case "fill":
                  this.fillRect(a.x, a.y, a.width, a.height, a.color, true);
                  break;
                case "blit":
                  this.blitImage(a.x, a.y, a.width, a.height, a.data, 0, true);
                  break;
                case "img":
                  if (a.img.complete) {
                    if (a.img.width !== a.width || a.img.height !== a.height) {
                      Log.Error("Decoded image has incorrect dimensions. Got " + a.img.width + "x" + a.img.height + ". Expected " + a.width + "x" + a.height + ".");
                      
return;
                    }

                    this.drawImage(a.img, a.x, a.y);
                  } else {
                    a.img._noVNCDisplay = this;
                    a.img.addEventListener("load", this._resumeRenderQ);
                    ready = false;
                  }

                  break;
              }

              if (ready) {
                this._renderQ.shift();
              }
            }

            if (this._renderQ.length === 0 && this._flushPromise !== null) {
              this._flushResolve();
              this._flushPromise = null;
              this._flushResolve = null;
            }
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/utils/common.js
  var require_common = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/utils/common.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.Buf8 = exports.Buf32 = exports.Buf16 = void 0;
      exports.arraySet = arraySet;
      exports.flattenChunks = flattenChunks;
      exports.shrinkBuf = shrinkBuf;

      function shrinkBuf(buf, size) {
        if (buf.length === size) {
          return buf;
        }

        if (buf.subarray) {
          return buf.subarray(0, size);
        }

        buf.length = size;
        
return buf;
      }

      function arraySet(dest, src, src_offs, len, dest_offs) {
        if (src.subarray && dest.subarray) {
          dest.set(src.subarray(src_offs, src_offs + len), dest_offs);
          
return;
        }

        for (var i = 0; i < len; i++) {
          dest[dest_offs + i] = src[src_offs + i];
        }
      }

      function flattenChunks(chunks) {
        var i, l, len, pos, chunk, result;

        len = 0;

        for (i = 0, l = chunks.length; i < l; i++) {
          len += chunks[i].length;
        }

        result = new Uint8Array(len);
        pos = 0;

        for (i = 0, l = chunks.length; i < l; i++) {
          chunk = chunks[i];
          result.set(chunk, pos);
          pos += chunk.length;
        }

        
return result;
      }

      var Buf8 = exports.Buf8 = Uint8Array;
      var Buf16 = exports.Buf16 = Uint16Array;
      var Buf32 = exports.Buf32 = Int32Array;
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/adler32.js
  var require_adler32 = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/adler32.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = adler32;

      function adler32(adler, buf, len, pos) {
        var s1 = adler & 65535 | 0, s2 = adler >>> 16 & 65535 | 0, n = 0;

        while (len !== 0) {
          n = len > 2e3 ? 2e3 : len;
          len -= n;

          do {
            s1 = s1 + buf[pos++] | 0;
            s2 = s2 + s1 | 0;
          } while (--n);

          s1 %= 65521;
          s2 %= 65521;
        }

        
return s1 | s2 << 16 | 0;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/crc32.js
  var require_crc32 = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/crc32.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = makeTable;

      function makeTable() {
        var c, table = [];

        for (var n = 0; n < 256; n++) {
          c = n;

          for (var k = 0; k < 8; k++) {
            c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
          }

          table[n] = c;
        }

        
return table;
      }

      var crcTable = makeTable();
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inffast.js
  var require_inffast = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inffast.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = inflate_fast;
      var BAD = 30;
      var TYPE = 12;

      function inflate_fast(strm, start) {
        var state;
        var _in;
        var last;
        var _out;
        var beg;
        var end;
        var dmax;
        var wsize;
        var whave;
        var wnext;
        var s_window;
        var hold;
        var bits;
        var lcode;
        var dcode;
        var lmask;
        var dmask;
        var here;
        var op;
        var len;
        var dist;
        var from;
        var from_source;
        var input, output;

        state = strm.state;
        _in = strm.next_in;
        input = strm.input;
        last = _in + (strm.avail_in - 5);
        _out = strm.next_out;
        output = strm.output;
        beg = _out - (start - strm.avail_out);
        end = _out + (strm.avail_out - 257);
        dmax = state.dmax;
        wsize = state.wsize;
        whave = state.whave;
        wnext = state.wnext;
        s_window = state.window;
        hold = state.hold;
        bits = state.bits;
        lcode = state.lencode;
        dcode = state.distcode;
        lmask = (1 << state.lenbits) - 1;
        dmask = (1 << state.distbits) - 1;

        top: do {
          if (bits < 15) {
            hold += input[_in++] << bits;
            bits += 8;
            hold += input[_in++] << bits;
            bits += 8;
          }

          here = lcode[hold & lmask];

          dolen: for (; ; ) {
            op = here >>> 24;
            hold >>>= op;
            bits -= op;
            op = here >>> 16 & 255;

            if (op === 0) {
              output[_out++] = here & 65535;
            } else if (op & 16) {
              len = here & 65535;
              op &= 15;

              if (op) {
                if (bits < op) {
                  hold += input[_in++] << bits;
                  bits += 8;
                }

                len += hold & (1 << op) - 1;
                hold >>>= op;
                bits -= op;
              }

              if (bits < 15) {
                hold += input[_in++] << bits;
                bits += 8;
                hold += input[_in++] << bits;
                bits += 8;
              }

              here = dcode[hold & dmask];

              dodist: for (; ; ) {
                op = here >>> 24;
                hold >>>= op;
                bits -= op;
                op = here >>> 16 & 255;

                if (op & 16) {
                  dist = here & 65535;
                  op &= 15;

                  if (bits < op) {
                    hold += input[_in++] << bits;
                    bits += 8;

                    if (bits < op) {
                      hold += input[_in++] << bits;
                      bits += 8;
                    }
                  }

                  dist += hold & (1 << op) - 1;

                  if (dist > dmax) {
                    strm.msg = "invalid distance too far back";
                    state.mode = BAD;
                    break top;
                  }

                  hold >>>= op;
                  bits -= op;
                  op = _out - beg;

                  if (dist > op) {
                    op = dist - op;

                    if (op > whave) {
                      if (state.sane) {
                        strm.msg = "invalid distance too far back";
                        state.mode = BAD;
                        break top;
                      }
                    }

                    from = 0;
                    from_source = s_window;

                    if (wnext === 0) {
                      from += wsize - op;

                      if (op < len) {
                        len -= op;

                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);

                        from = _out - dist;
                        from_source = output;
                      }
                    } else if (wnext < op) {
                      from += wsize + wnext - op;
                      op -= wnext;

                      if (op < len) {
                        len -= op;

                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);

                        from = 0;

                        if (wnext < len) {
                          op = wnext;
                          len -= op;

                          do {
                            output[_out++] = s_window[from++];
                          } while (--op);

                          from = _out - dist;
                          from_source = output;
                        }
                      }
                    } else {
                      from += wnext - op;

                      if (op < len) {
                        len -= op;

                        do {
                          output[_out++] = s_window[from++];
                        } while (--op);

                        from = _out - dist;
                        from_source = output;
                      }
                    }

                    while (len > 2) {
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      output[_out++] = from_source[from++];
                      len -= 3;
                    }

                    if (len) {
                      output[_out++] = from_source[from++];

                      if (len > 1) {
                        output[_out++] = from_source[from++];
                      }
                    }
                  } else {
                    from = _out - dist;

                    do {
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      output[_out++] = output[from++];
                      len -= 3;
                    } while (len > 2);

                    if (len) {
                      output[_out++] = output[from++];

                      if (len > 1) {
                        output[_out++] = output[from++];
                      }
                    }
                  }
                } else if ((op & 64) === 0) {
                  here = dcode[(here & 65535) + (hold & (1 << op) - 1)];
                  continue dodist;
                } else {
                  strm.msg = "invalid distance code";
                  state.mode = BAD;
                  break top;
                }

                break;
              }
            } else if ((op & 64) === 0) {
              here = lcode[(here & 65535) + (hold & (1 << op) - 1)];
              continue dolen;
            } else if (op & 32) {
              state.mode = TYPE;
              break top;
            } else {
              strm.msg = "invalid literal/length code";
              state.mode = BAD;
              break top;
            }

            break;
          }
        } while (_in < last && _out < end);

        len = bits >> 3;
        _in -= len;
        bits -= len << 3;
        hold &= (1 << bits) - 1;
        strm.next_in = _in;
        strm.next_out = _out;
        strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
        strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
        state.hold = hold;
        state.bits = bits;
        
return;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inftrees.js
  var require_inftrees = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inftrees.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = inflate_table;
      var utils = _interopRequireWildcard(require_common());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var MAXBITS = 15;
      var ENOUGH_LENS = 852;
      var ENOUGH_DISTS = 592;
      var CODES = 0;
      var LENS = 1;
      var DISTS = 2;
      var lbase = [
        /* Length codes 257..285 base */
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        13,
        15,
        17,
        19,
        23,
        27,
        31,
        35,
        43,
        51,
        59,
        67,
        83,
        99,
        115,
        131,
        163,
        195,
        227,
        258,
        0,
        0
      ];
      var lext = [
        /* Length codes 257..285 extra */
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        16,
        17,
        17,
        17,
        17,
        18,
        18,
        18,
        18,
        19,
        19,
        19,
        19,
        20,
        20,
        20,
        20,
        21,
        21,
        21,
        21,
        16,
        72,
        78
      ];
      var dbase = [
        /* Distance codes 0..29 base */
        1,
        2,
        3,
        4,
        5,
        7,
        9,
        13,
        17,
        25,
        33,
        49,
        65,
        97,
        129,
        193,
        257,
        385,
        513,
        769,
        1025,
        1537,
        2049,
        3073,
        4097,
        6145,
        8193,
        12289,
        16385,
        24577,
        0,
        0
      ];
      var dext = [
        /* Distance codes 0..29 extra */
        16,
        16,
        16,
        16,
        17,
        17,
        18,
        18,
        19,
        19,
        20,
        20,
        21,
        21,
        22,
        22,
        23,
        23,
        24,
        24,
        25,
        25,
        26,
        26,
        27,
        27,
        28,
        28,
        29,
        29,
        64,
        64
      ];

      function inflate_table(type, lens, lens_index, codes, table, table_index, work, opts) {
        var bits = opts.bits;
        var len = 0;
        var sym = 0;
        var min = 0, max = 0;
        var root = 0;
        var curr = 0;
        var drop = 0;
        var left = 0;
        var used = 0;
        var huff = 0;
        var incr;
        var fill;
        var low;
        var mask;
        var next;
        var base = null;
        var base_index = 0;
        var end;
        var count = new utils.Buf16(MAXBITS + 1);
        var offs = new utils.Buf16(MAXBITS + 1);
        var extra = null;
        var extra_index = 0;
        var here_bits, here_op, here_val;

        for (len = 0; len <= MAXBITS; len++) {
          count[len] = 0;
        }

        for (sym = 0; sym < codes; sym++) {
          count[lens[lens_index + sym]]++;
        }

        root = bits;

        for (max = MAXBITS; max >= 1; max--) {
          if (count[max] !== 0) {
            break;
          }
        }

        if (root > max) {
          root = max;
        }

        if (max === 0) {
          table[table_index++] = 1 << 24 | 64 << 16 | 0;
          table[table_index++] = 1 << 24 | 64 << 16 | 0;
          opts.bits = 1;
          
return 0;
        }

        for (min = 1; min < max; min++) {
          if (count[min] !== 0) {
            break;
          }
        }

        if (root < min) {
          root = min;
        }

        left = 1;

        for (len = 1; len <= MAXBITS; len++) {
          left <<= 1;
          left -= count[len];

          if (left < 0) {
            return -1;
          }
        }

        if (left > 0 && (type === CODES || max !== 1)) {
          return -1;
        }

        offs[1] = 0;

        for (len = 1; len < MAXBITS; len++) {
          offs[len + 1] = offs[len] + count[len];
        }

        for (sym = 0; sym < codes; sym++) {
          if (lens[lens_index + sym] !== 0) {
            work[offs[lens[lens_index + sym]]++] = sym;
          }
        }

        if (type === CODES) {
          base = extra = work;
          end = 19;
        } else if (type === LENS) {
          base = lbase;
          base_index -= 257;
          extra = lext;
          extra_index -= 257;
          end = 256;
        } else {
          base = dbase;
          extra = dext;
          end = -1;
        }

        huff = 0;
        sym = 0;
        len = min;
        next = table_index;
        curr = root;
        drop = 0;
        low = -1;
        used = 1 << root;
        mask = used - 1;

        if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
          return 1;
        }

        for (; ; ) {
          here_bits = len - drop;

          if (work[sym] < end) {
            here_op = 0;
            here_val = work[sym];
          } else if (work[sym] > end) {
            here_op = extra[extra_index + work[sym]];
            here_val = base[base_index + work[sym]];
          } else {
            here_op = 32 + 64;
            here_val = 0;
          }

          incr = 1 << len - drop;
          fill = 1 << curr;
          min = fill;

          do {
            fill -= incr;
            table[next + (huff >> drop) + fill] = here_bits << 24 | here_op << 16 | here_val | 0;
          } while (fill !== 0);

          incr = 1 << len - 1;

          while (huff & incr) {
            incr >>= 1;
          }

          if (incr !== 0) {
            huff &= incr - 1;
            huff += incr;
          } else {
            huff = 0;
          }

          sym++;

          if (--count[len] === 0) {
            if (len === max) {
              break;
            }

            len = lens[lens_index + work[sym]];
          }

          if (len > root && (huff & mask) !== low) {
            if (drop === 0) {
              drop = root;
            }

            next += min;
            curr = len - drop;
            left = 1 << curr;

            while (curr + drop < max) {
              left -= count[curr + drop];

              if (left <= 0) {
                break;
              }

              curr++;
              left <<= 1;
            }

            used += 1 << curr;

            if (type === LENS && used > ENOUGH_LENS || type === DISTS && used > ENOUGH_DISTS) {
              return 1;
            }

            low = huff & mask;
            table[low] = root << 24 | curr << 16 | next - table_index | 0;
          }
        }

        if (huff !== 0) {
          table[next + huff] = len - drop << 24 | 64 << 16 | 0;
        }

        opts.bits = root;
        
return 0;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inflate.js
  var require_inflate = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/inflate.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.Z_TREES = exports.Z_STREAM_ERROR = exports.Z_STREAM_END = exports.Z_OK = exports.Z_NEED_DICT = exports.Z_MEM_ERROR = exports.Z_FINISH = exports.Z_DEFLATED = exports.Z_DATA_ERROR = exports.Z_BUF_ERROR = exports.Z_BLOCK = void 0;
      exports.inflate = inflate;
      exports.inflateEnd = inflateEnd;
      exports.inflateGetHeader = inflateGetHeader;
      exports.inflateInfo = void 0;
      exports.inflateInit = inflateInit;
      exports.inflateInit2 = inflateInit2;
      exports.inflateReset = inflateReset;
      exports.inflateReset2 = inflateReset2;
      exports.inflateResetKeep = inflateResetKeep;
      exports.inflateSetDictionary = inflateSetDictionary;
      var utils = _interopRequireWildcard(require_common());
      var _adler = _interopRequireDefault(require_adler32());
      var _crc = _interopRequireDefault(require_crc32());
      var _inffast = _interopRequireDefault(require_inffast());
      var _inftrees = _interopRequireDefault(require_inftrees());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var CODES = 0;
      var LENS = 1;
      var DISTS = 2;
      var Z_FINISH = exports.Z_FINISH = 4;
      var Z_BLOCK = exports.Z_BLOCK = 5;
      var Z_TREES = exports.Z_TREES = 6;
      var Z_OK = exports.Z_OK = 0;
      var Z_STREAM_END = exports.Z_STREAM_END = 1;
      var Z_NEED_DICT = exports.Z_NEED_DICT = 2;
      var Z_STREAM_ERROR = exports.Z_STREAM_ERROR = -2;
      var Z_DATA_ERROR = exports.Z_DATA_ERROR = -3;
      var Z_MEM_ERROR = exports.Z_MEM_ERROR = -4;
      var Z_BUF_ERROR = exports.Z_BUF_ERROR = -5;
      var Z_DEFLATED = exports.Z_DEFLATED = 8;
      var HEAD = 1;
      var FLAGS = 2;
      var TIME = 3;
      var OS = 4;
      var EXLEN = 5;
      var EXTRA = 6;
      var NAME = 7;
      var COMMENT = 8;
      var HCRC = 9;
      var DICTID = 10;
      var DICT = 11;
      var TYPE = 12;
      var TYPEDO = 13;
      var STORED = 14;
      var COPY_ = 15;
      var COPY = 16;
      var TABLE = 17;
      var LENLENS = 18;
      var CODELENS = 19;
      var LEN_ = 20;
      var LEN = 21;
      var LENEXT = 22;
      var DIST = 23;
      var DISTEXT = 24;
      var MATCH = 25;
      var LIT = 26;
      var CHECK = 27;
      var LENGTH = 28;
      var DONE = 29;
      var BAD = 30;
      var MEM = 31;
      var SYNC = 32;
      var ENOUGH_LENS = 852;
      var ENOUGH_DISTS = 592;
      var MAX_WBITS = 15;
      var DEF_WBITS = MAX_WBITS;

      function zswap32(q) {
        return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((q & 65280) << 8) + ((q & 255) << 24);
      }

      function InflateState() {
        this.mode = 0;
        this.last = false;
        this.wrap = 0;
        this.havedict = false;
        this.flags = 0;
        this.dmax = 0;
        this.check = 0;
        this.total = 0;
        this.head = null;
        this.wbits = 0;
        this.wsize = 0;
        this.whave = 0;
        this.wnext = 0;
        this.window = null;
        this.hold = 0;
        this.bits = 0;
        this.length = 0;
        this.offset = 0;
        this.extra = 0;
        this.lencode = null;
        this.distcode = null;
        this.lenbits = 0;
        this.distbits = 0;
        this.ncode = 0;
        this.nlen = 0;
        this.ndist = 0;
        this.have = 0;
        this.next = null;
        this.lens = new utils.Buf16(320);
        this.work = new utils.Buf16(288);
        this.lendyn = null;
        this.distdyn = null;
        this.sane = 0;
        this.back = 0;
        this.was = 0;
      }

      function inflateResetKeep(strm) {
        var state;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;
        strm.total_in = strm.total_out = state.total = 0;
        strm.msg = "";

        if (state.wrap) {
          strm.adler = state.wrap & 1;
        }

        state.mode = HEAD;
        state.last = 0;
        state.havedict = 0;
        state.dmax = 32768;
        state.head = null;
        state.hold = 0;
        state.bits = 0;
        state.lencode = state.lendyn = new utils.Buf32(ENOUGH_LENS);
        state.distcode = state.distdyn = new utils.Buf32(ENOUGH_DISTS);
        state.sane = 1;
        state.back = -1;
        
return Z_OK;
      }

      function inflateReset(strm) {
        var state;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;
        state.wsize = 0;
        state.whave = 0;
        state.wnext = 0;
        
return inflateResetKeep(strm);
      }

      function inflateReset2(strm, windowBits) {
        var wrap;
        var state;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;

        if (windowBits < 0) {
          wrap = 0;
          windowBits = -windowBits;
        } else {
          wrap = (windowBits >> 4) + 1;

          if (windowBits < 48) {
            windowBits &= 15;
          }
        }

        if (windowBits && (windowBits < 8 || windowBits > 15)) {
          return Z_STREAM_ERROR;
        }

        if (state.window !== null && state.wbits !== windowBits) {
          state.window = null;
        }

        state.wrap = wrap;
        state.wbits = windowBits;
        
return inflateReset(strm);
      }

      function inflateInit2(strm, windowBits) {
        var ret;
        var state;

        if (!strm) {
          return Z_STREAM_ERROR;
        }

        state = new InflateState();
        strm.state = state;
        state.window = null;
        ret = inflateReset2(strm, windowBits);

        if (ret !== Z_OK) {
          strm.state = null;
        }

        
return ret;
      }

      function inflateInit(strm) {
        return inflateInit2(strm, DEF_WBITS);
      }

      var virgin = true;
      var lenfix;
      var distfix;

      function fixedtables(state) {
        if (virgin) {
          var sym;

          lenfix = new utils.Buf32(512);
          distfix = new utils.Buf32(32);
          sym = 0;

          while (sym < 144) {
            state.lens[sym++] = 8;
          }

          while (sym < 256) {
            state.lens[sym++] = 9;
          }

          while (sym < 280) {
            state.lens[sym++] = 7;
          }

          while (sym < 288) {
            state.lens[sym++] = 8;
          }

          (0, _inftrees["default"])(LENS, state.lens, 0, 288, lenfix, 0, state.work, {
            bits: 9
          });
          sym = 0;

          while (sym < 32) {
            state.lens[sym++] = 5;
          }

          (0, _inftrees["default"])(DISTS, state.lens, 0, 32, distfix, 0, state.work, {
            bits: 5
          });
          virgin = false;
        }

        state.lencode = lenfix;
        state.lenbits = 9;
        state.distcode = distfix;
        state.distbits = 5;
      }

      function updatewindow(strm, src, end, copy) {
        var dist;
        var state = strm.state;

        if (state.window === null) {
          state.wsize = 1 << state.wbits;
          state.wnext = 0;
          state.whave = 0;
          state.window = new utils.Buf8(state.wsize);
        }

        if (copy >= state.wsize) {
          utils.arraySet(state.window, src, end - state.wsize, state.wsize, 0);
          state.wnext = 0;
          state.whave = state.wsize;
        } else {
          dist = state.wsize - state.wnext;

          if (dist > copy) {
            dist = copy;
          }

          utils.arraySet(state.window, src, end - copy, dist, state.wnext);
          copy -= dist;

          if (copy) {
            utils.arraySet(state.window, src, end - copy, copy, 0);
            state.wnext = copy;
            state.whave = state.wsize;
          } else {
            state.wnext += dist;

            if (state.wnext === state.wsize) {
              state.wnext = 0;
            }

            if (state.whave < state.wsize) {
              state.whave += dist;
            }
          }
        }

        
return 0;
      }

      function inflate(strm, flush) {
        var state;
        var input, output;
        var next;
        var put;
        var have, left;
        var hold;
        var bits;
        var _in, _out;
        var copy;
        var from;
        var from_source;
        var here = 0;
        var here_bits, here_op, here_val;
        var last_bits, last_op, last_val;
        var len;
        var ret;
        var hbuf = new utils.Buf8(4);
        var opts;
        var n;
        var order = (

          /* permutation of code lengths */
          [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]
        );

        if (!strm || !strm.state || !strm.output || !strm.input && strm.avail_in !== 0) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;

        if (state.mode === TYPE) {
          state.mode = TYPEDO;
        }

        put = strm.next_out;
        output = strm.output;
        left = strm.avail_out;
        next = strm.next_in;
        input = strm.input;
        have = strm.avail_in;
        hold = state.hold;
        bits = state.bits;
        _in = have;
        _out = left;
        ret = Z_OK;

        inf_leave:
          for (; ; ) {
            switch (state.mode) {
              case HEAD:
                if (state.wrap === 0) {
                  state.mode = TYPEDO;
                  break;
                }

                while (bits < 16) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if (state.wrap & 2 && hold === 35615) {
                  state.check = 0;
                  hbuf[0] = hold & 255;
                  hbuf[1] = hold >>> 8 & 255;
                  state.check = (0, _crc["default"])(state.check, hbuf, 2, 0);
                  hold = 0;
                  bits = 0;
                  state.mode = FLAGS;
                  break;
                }

                state.flags = 0;

                if (state.head) {
                  state.head.done = false;
                }

                if (!(state.wrap & 1) || /* check if zlib header allowed */
                (((hold & 255) << 8) + (hold >> 8)) % 31) {
                  strm.msg = "incorrect header check";
                  state.mode = BAD;
                  break;
                }

                if ((hold & 15) !== Z_DEFLATED) {
                  strm.msg = "unknown compression method";
                  state.mode = BAD;
                  break;
                }

                hold >>>= 4;
                bits -= 4;
                len = (hold & 15) + 8;

                if (state.wbits === 0) {
                  state.wbits = len;
                } else if (len > state.wbits) {
                  strm.msg = "invalid window size";
                  state.mode = BAD;
                  break;
                }

                state.dmax = 1 << len;
                strm.adler = state.check = 1;
                state.mode = hold & 512 ? DICTID : TYPE;
                hold = 0;
                bits = 0;
                break;
              case FLAGS:
                while (bits < 16) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                state.flags = hold;

                if ((state.flags & 255) !== Z_DEFLATED) {
                  strm.msg = "unknown compression method";
                  state.mode = BAD;
                  break;
                }

                if (state.flags & 57344) {
                  strm.msg = "unknown header flags set";
                  state.mode = BAD;
                  break;
                }

                if (state.head) {
                  state.head.text = hold >> 8 & 1;
                }

                if (state.flags & 512) {
                  hbuf[0] = hold & 255;
                  hbuf[1] = hold >>> 8 & 255;
                  state.check = (0, _crc["default"])(state.check, hbuf, 2, 0);
                }

                hold = 0;
                bits = 0;
                state.mode = TIME;

              /* falls through */
              case TIME:
                while (bits < 32) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if (state.head) {
                  state.head.time = hold;
                }

                if (state.flags & 512) {
                  hbuf[0] = hold & 255;
                  hbuf[1] = hold >>> 8 & 255;
                  hbuf[2] = hold >>> 16 & 255;
                  hbuf[3] = hold >>> 24 & 255;
                  state.check = (0, _crc["default"])(state.check, hbuf, 4, 0);
                }

                hold = 0;
                bits = 0;
                state.mode = OS;

              /* falls through */
              case OS:
                while (bits < 16) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if (state.head) {
                  state.head.xflags = hold & 255;
                  state.head.os = hold >> 8;
                }

                if (state.flags & 512) {
                  hbuf[0] = hold & 255;
                  hbuf[1] = hold >>> 8 & 255;
                  state.check = (0, _crc["default"])(state.check, hbuf, 2, 0);
                }

                hold = 0;
                bits = 0;
                state.mode = EXLEN;

              /* falls through */
              case EXLEN:
                if (state.flags & 1024) {
                  while (bits < 16) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  state.length = hold;

                  if (state.head) {
                    state.head.extra_len = hold;
                  }

                  if (state.flags & 512) {
                    hbuf[0] = hold & 255;
                    hbuf[1] = hold >>> 8 & 255;
                    state.check = (0, _crc["default"])(state.check, hbuf, 2, 0);
                  }

                  hold = 0;
                  bits = 0;
                } else if (state.head) {
                  state.head.extra = null;
                }

                state.mode = EXTRA;

              /* falls through */
              case EXTRA:
                if (state.flags & 1024) {
                  copy = state.length;

                  if (copy > have) {
                    copy = have;
                  }

                  if (copy) {
                    if (state.head) {
                      len = state.head.extra_len - state.length;

                      if (!state.head.extra) {
                        state.head.extra = new Array(state.head.extra_len);
                      }

                      utils.arraySet(
                        state.head.extra,
                        input,
                        next,

                        // extra field is limited to 65536 bytes
                        // - no need for additional size check
                        copy,

                        /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
                        len
                      );
                    }

                    if (state.flags & 512) {
                      state.check = (0, _crc["default"])(state.check, input, copy, next);
                    }

                    have -= copy;
                    next += copy;
                    state.length -= copy;
                  }

                  if (state.length) {
                    break inf_leave;
                  }
                }

                state.length = 0;
                state.mode = NAME;

              /* falls through */
              case NAME:
                if (state.flags & 2048) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  copy = 0;

                  do {
                    len = input[next + copy++];

                    if (state.head && len && state.length < 65536) {
                      state.head.name += String.fromCharCode(len);
                    }
                  } while (len && copy < have);

                  if (state.flags & 512) {
                    state.check = (0, _crc["default"])(state.check, input, copy, next);
                  }

                  have -= copy;
                  next += copy;

                  if (len) {
                    break inf_leave;
                  }
                } else if (state.head) {
                  state.head.name = null;
                }

                state.length = 0;
                state.mode = COMMENT;

              /* falls through */
              case COMMENT:
                if (state.flags & 4096) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  copy = 0;

                  do {
                    len = input[next + copy++];

                    if (state.head && len && state.length < 65536) {
                      state.head.comment += String.fromCharCode(len);
                    }
                  } while (len && copy < have);

                  if (state.flags & 512) {
                    state.check = (0, _crc["default"])(state.check, input, copy, next);
                  }

                  have -= copy;
                  next += copy;

                  if (len) {
                    break inf_leave;
                  }
                } else if (state.head) {
                  state.head.comment = null;
                }

                state.mode = HCRC;

              /* falls through */
              case HCRC:
                if (state.flags & 512) {
                  while (bits < 16) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  if (hold !== (state.check & 65535)) {
                    strm.msg = "header crc mismatch";
                    state.mode = BAD;
                    break;
                  }

                  hold = 0;
                  bits = 0;
                }

                if (state.head) {
                  state.head.hcrc = state.flags >> 9 & 1;
                  state.head.done = true;
                }

                strm.adler = state.check = 0;
                state.mode = TYPE;
                break;
              case DICTID:
                while (bits < 32) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                strm.adler = state.check = zswap32(hold);
                hold = 0;
                bits = 0;
                state.mode = DICT;

              /* falls through */
              case DICT:
                if (state.havedict === 0) {
                  strm.next_out = put;
                  strm.avail_out = left;
                  strm.next_in = next;
                  strm.avail_in = have;
                  state.hold = hold;
                  state.bits = bits;
                  
return Z_NEED_DICT;
                }

                strm.adler = state.check = 1;
                state.mode = TYPE;


              /* falls through */
              case TYPE:
                if (flush === Z_BLOCK || flush === Z_TREES) {
                  break inf_leave;
                }


              /* falls through */
              case TYPEDO:
                if (state.last) {
                  hold >>>= bits & 7;
                  bits -= bits & 7;
                  state.mode = CHECK;
                  break;
                }

                while (bits < 3) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                state.last = hold & 1;
                hold >>>= 1;
                bits -= 1;

                switch (hold & 3) {
                  case 0:
                    state.mode = STORED;
                    break;
                  case 1:
                    fixedtables(state);
                    state.mode = LEN_;

                    if (flush === Z_TREES) {
                      hold >>>= 2;
                      bits -= 2;
                      break inf_leave;
                    }

                    break;
                  case 2:
                    state.mode = TABLE;
                    break;
                  case 3:
                    strm.msg = "invalid block type";
                    state.mode = BAD;
                }

                hold >>>= 2;
                bits -= 2;
                break;

              case STORED:
                hold >>>= bits & 7;
                bits -= bits & 7;

                while (bits < 32) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if ((hold & 65535) !== (hold >>> 16 ^ 65535)) {
                  strm.msg = "invalid stored block lengths";
                  state.mode = BAD;
                  break;
                }

                state.length = hold & 65535;
                hold = 0;
                bits = 0;
                state.mode = COPY_;

                if (flush === Z_TREES) {
                  break inf_leave;
                }


              /* falls through */
              case COPY_:
                state.mode = COPY;

              /* falls through */
              case COPY:
                copy = state.length;

                if (copy) {
                  if (copy > have) {
                    copy = have;
                  }

                  if (copy > left) {
                    copy = left;
                  }

                  if (copy === 0) {
                    break inf_leave;
                  }

                  utils.arraySet(output, input, next, copy, put);
                  have -= copy;
                  next += copy;
                  left -= copy;
                  put += copy;
                  state.length -= copy;
                  break;
                }

                state.mode = TYPE;
                break;
              case TABLE:
                while (bits < 14) {
                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                state.nlen = (hold & 31) + 257;
                hold >>>= 5;
                bits -= 5;
                state.ndist = (hold & 31) + 1;
                hold >>>= 5;
                bits -= 5;
                state.ncode = (hold & 15) + 4;
                hold >>>= 4;
                bits -= 4;

                if (state.nlen > 286 || state.ndist > 30) {
                  strm.msg = "too many length or distance symbols";
                  state.mode = BAD;
                  break;
                }

                state.have = 0;
                state.mode = LENLENS;

              /* falls through */
              case LENLENS:
                while (state.have < state.ncode) {
                  while (bits < 3) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  state.lens[order[state.have++]] = hold & 7;
                  hold >>>= 3;
                  bits -= 3;
                }

                while (state.have < 19) {
                  state.lens[order[state.have++]] = 0;
                }

                state.lencode = state.lendyn;
                state.lenbits = 7;
                opts = {
                  bits: state.lenbits
                };
                ret = (0, _inftrees["default"])(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts);
                state.lenbits = opts.bits;

                if (ret) {
                  strm.msg = "invalid code lengths set";
                  state.mode = BAD;
                  break;
                }

                state.have = 0;
                state.mode = CODELENS;


              /* falls through */
              case CODELENS:
                while (state.have < state.nlen + state.ndist) {
                  for (; ; ) {
                    here = state.lencode[hold & (1 << state.lenbits) - 1];
                    here_bits = here >>> 24;
                    here_op = here >>> 16 & 255;
                    here_val = here & 65535;

                    if (here_bits <= bits) {
                      break;
                    }

                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  if (here_val < 16) {
                    hold >>>= here_bits;
                    bits -= here_bits;
                    state.lens[state.have++] = here_val;
                  } else {
                    if (here_val === 16) {
                      n = here_bits + 2;

                      while (bits < n) {
                        if (have === 0) {
                          break inf_leave;
                        }

                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }

                      hold >>>= here_bits;
                      bits -= here_bits;

                      if (state.have === 0) {
                        strm.msg = "invalid bit length repeat";
                        state.mode = BAD;
                        break;
                      }

                      len = state.lens[state.have - 1];
                      copy = 3 + (hold & 3);
                      hold >>>= 2;
                      bits -= 2;
                    } else if (here_val === 17) {
                      n = here_bits + 3;

                      while (bits < n) {
                        if (have === 0) {
                          break inf_leave;
                        }

                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }

                      hold >>>= here_bits;
                      bits -= here_bits;
                      len = 0;
                      copy = 3 + (hold & 7);
                      hold >>>= 3;
                      bits -= 3;
                    } else {
                      n = here_bits + 7;

                      while (bits < n) {
                        if (have === 0) {
                          break inf_leave;
                        }

                        have--;
                        hold += input[next++] << bits;
                        bits += 8;
                      }

                      hold >>>= here_bits;
                      bits -= here_bits;
                      len = 0;
                      copy = 11 + (hold & 127);
                      hold >>>= 7;
                      bits -= 7;
                    }

                    if (state.have + copy > state.nlen + state.ndist) {
                      strm.msg = "invalid bit length repeat";
                      state.mode = BAD;
                      break;
                    }

                    while (copy--) {
                      state.lens[state.have++] = len;
                    }
                  }
                }

                if (state.mode === BAD) {
                  break;
                }

                if (state.lens[256] === 0) {
                  strm.msg = "invalid code -- missing end-of-block";
                  state.mode = BAD;
                  break;
                }

                state.lenbits = 9;
                opts = {
                  bits: state.lenbits
                };
                ret = (0, _inftrees["default"])(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts);
                state.lenbits = opts.bits;

                if (ret) {
                  strm.msg = "invalid literal/lengths set";
                  state.mode = BAD;
                  break;
                }

                state.distbits = 6;
                state.distcode = state.distdyn;
                opts = {
                  bits: state.distbits
                };
                ret = (0, _inftrees["default"])(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts);
                state.distbits = opts.bits;

                if (ret) {
                  strm.msg = "invalid distances set";
                  state.mode = BAD;
                  break;
                }

                state.mode = LEN_;

                if (flush === Z_TREES) {
                  break inf_leave;
                }


              /* falls through */
              case LEN_:
                state.mode = LEN;

              /* falls through */
              case LEN:
                if (have >= 6 && left >= 258) {
                  strm.next_out = put;
                  strm.avail_out = left;
                  strm.next_in = next;
                  strm.avail_in = have;
                  state.hold = hold;
                  state.bits = bits;
                  (0, _inffast["default"])(strm, _out);
                  put = strm.next_out;
                  output = strm.output;
                  left = strm.avail_out;
                  next = strm.next_in;
                  input = strm.input;
                  have = strm.avail_in;
                  hold = state.hold;
                  bits = state.bits;

                  if (state.mode === TYPE) {
                    state.back = -1;
                  }

                  break;
                }

                state.back = 0;

                for (; ; ) {
                  here = state.lencode[hold & (1 << state.lenbits) - 1];
                  here_bits = here >>> 24;
                  here_op = here >>> 16 & 255;
                  here_val = here & 65535;

                  if (here_bits <= bits) {
                    break;
                  }

                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if (here_op && (here_op & 240) === 0) {
                  last_bits = here_bits;
                  last_op = here_op;
                  last_val = here_val;

                  for (; ; ) {
                    here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                    here_bits = here >>> 24;
                    here_op = here >>> 16 & 255;
                    here_val = here & 65535;

                    if (last_bits + here_bits <= bits) {
                      break;
                    }

                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  hold >>>= last_bits;
                  bits -= last_bits;
                  state.back += last_bits;
                }

                hold >>>= here_bits;
                bits -= here_bits;
                state.back += here_bits;
                state.length = here_val;

                if (here_op === 0) {
                  state.mode = LIT;
                  break;
                }

                if (here_op & 32) {
                  state.back = -1;
                  state.mode = TYPE;
                  break;
                }

                if (here_op & 64) {
                  strm.msg = "invalid literal/length code";
                  state.mode = BAD;
                  break;
                }

                state.extra = here_op & 15;
                state.mode = LENEXT;

              /* falls through */
              case LENEXT:
                if (state.extra) {
                  n = state.extra;

                  while (bits < n) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  state.length += hold & (1 << state.extra) - 1;
                  hold >>>= state.extra;
                  bits -= state.extra;
                  state.back += state.extra;
                }

                state.was = state.length;
                state.mode = DIST;

              /* falls through */
              case DIST:
                for (; ; ) {
                  here = state.distcode[hold & (1 << state.distbits) - 1];
                  here_bits = here >>> 24;
                  here_op = here >>> 16 & 255;
                  here_val = here & 65535;

                  if (here_bits <= bits) {
                    break;
                  }

                  if (have === 0) {
                    break inf_leave;
                  }

                  have--;
                  hold += input[next++] << bits;
                  bits += 8;
                }

                if ((here_op & 240) === 0) {
                  last_bits = here_bits;
                  last_op = here_op;
                  last_val = here_val;

                  for (; ; ) {
                    here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)];
                    here_bits = here >>> 24;
                    here_op = here >>> 16 & 255;
                    here_val = here & 65535;

                    if (last_bits + here_bits <= bits) {
                      break;
                    }

                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  hold >>>= last_bits;
                  bits -= last_bits;
                  state.back += last_bits;
                }

                hold >>>= here_bits;
                bits -= here_bits;
                state.back += here_bits;

                if (here_op & 64) {
                  strm.msg = "invalid distance code";
                  state.mode = BAD;
                  break;
                }

                state.offset = here_val;
                state.extra = here_op & 15;
                state.mode = DISTEXT;

              /* falls through */
              case DISTEXT:
                if (state.extra) {
                  n = state.extra;

                  while (bits < n) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  state.offset += hold & (1 << state.extra) - 1;
                  hold >>>= state.extra;
                  bits -= state.extra;
                  state.back += state.extra;
                }

                if (state.offset > state.dmax) {
                  strm.msg = "invalid distance too far back";
                  state.mode = BAD;
                  break;
                }

                state.mode = MATCH;

              /* falls through */
              case MATCH:
                if (left === 0) {
                  break inf_leave;
                }

                copy = _out - left;

                if (state.offset > copy) {
                  copy = state.offset - copy;

                  if (copy > state.whave) {
                    if (state.sane) {
                      strm.msg = "invalid distance too far back";
                      state.mode = BAD;
                      break;
                    }
                  }

                  if (copy > state.wnext) {
                    copy -= state.wnext;
                    from = state.wsize - copy;
                  } else {
                    from = state.wnext - copy;
                  }

                  if (copy > state.length) {
                    copy = state.length;
                  }

                  from_source = state.window;
                } else {
                  from_source = output;
                  from = put - state.offset;
                  copy = state.length;
                }

                if (copy > left) {
                  copy = left;
                }

                left -= copy;
                state.length -= copy;

                do {
                  output[put++] = from_source[from++];
                } while (--copy);

                if (state.length === 0) {
                  state.mode = LEN;
                }

                break;
              case LIT:
                if (left === 0) {
                  break inf_leave;
                }

                output[put++] = state.length;
                left--;
                state.mode = LEN;
                break;
              case CHECK:
                if (state.wrap) {
                  while (bits < 32) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold |= input[next++] << bits;
                    bits += 8;
                  }

                  _out -= left;
                  strm.total_out += _out;
                  state.total += _out;

                  if (_out) {
                    strm.adler = state.check = /*UPDATE(state.check, put - _out, _out);*/
                    state.flags ? (0, _crc["default"])(state.check, output, _out, put - _out) : (0, _adler["default"])(state.check, output, _out, put - _out);
                  }

                  _out = left;

                  if ((state.flags ? hold : zswap32(hold)) !== state.check) {
                    strm.msg = "incorrect data check";
                    state.mode = BAD;
                    break;
                  }

                  hold = 0;
                  bits = 0;
                }

                state.mode = LENGTH;

              /* falls through */
              case LENGTH:
                if (state.wrap && state.flags) {
                  while (bits < 32) {
                    if (have === 0) {
                      break inf_leave;
                    }

                    have--;
                    hold += input[next++] << bits;
                    bits += 8;
                  }

                  if (hold !== (state.total & 4294967295)) {
                    strm.msg = "incorrect length check";
                    state.mode = BAD;
                    break;
                  }

                  hold = 0;
                  bits = 0;
                }

                state.mode = DONE;

              /* falls through */
              case DONE:
                ret = Z_STREAM_END;
                break inf_leave;
              case BAD:
                ret = Z_DATA_ERROR;
                break inf_leave;
              case MEM:
                return Z_MEM_ERROR;
              case SYNC:

              /* falls through */
              default:
                return Z_STREAM_ERROR;
            }
          }

        strm.next_out = put;
        strm.avail_out = left;
        strm.next_in = next;
        strm.avail_in = have;
        state.hold = hold;
        state.bits = bits;

        if (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== Z_FINISH)) {
          if (updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out)) {
            state.mode = MEM;
            
return Z_MEM_ERROR;
          }
        }

        _in -= strm.avail_in;
        _out -= strm.avail_out;
        strm.total_in += _in;
        strm.total_out += _out;
        state.total += _out;

        if (state.wrap && _out) {
          strm.adler = state.check = /*UPDATE(state.check, strm.next_out - _out, _out);*/
          state.flags ? (0, _crc["default"])(state.check, output, _out, strm.next_out - _out) : (0, _adler["default"])(state.check, output, _out, strm.next_out - _out);
        }

        strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0);

        if ((_in === 0 && _out === 0 || flush === Z_FINISH) && ret === Z_OK) {
          ret = Z_BUF_ERROR;
        }

        
return ret;
      }

      function inflateEnd(strm) {
        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        var state = strm.state;

        if (state.window) {
          state.window = null;
        }

        strm.state = null;
        
return Z_OK;
      }

      function inflateGetHeader(strm, head) {
        var state;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;

        if ((state.wrap & 2) === 0) {
          return Z_STREAM_ERROR;
        }

        state.head = head;
        head.done = false;
        
return Z_OK;
      }

      function inflateSetDictionary(strm, dictionary) {
        var dictLength = dictionary.length;
        var state;
        var dictid;
        var ret;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        state = strm.state;

        if (state.wrap !== 0 && state.mode !== DICT) {
          return Z_STREAM_ERROR;
        }

        if (state.mode === DICT) {
          dictid = 1;
          dictid = (0, _adler["default"])(dictid, dictionary, dictLength, 0);

          if (dictid !== state.check) {
            return Z_DATA_ERROR;
          }
        }

        ret = updatewindow(strm, dictionary, dictLength, dictLength);

        if (ret) {
          state.mode = MEM;
          
return Z_MEM_ERROR;
        }

        state.havedict = 1;
        
return Z_OK;
      }

      var inflateInfo = exports.inflateInfo = "pako inflate (from Nodeca project)";
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/zstream.js
  var require_zstream = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/zstream.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = ZStream;

      function ZStream() {
        this.input = null;
        this.next_in = 0;
        this.avail_in = 0;
        this.total_in = 0;
        this.output = null;
        this.next_out = 0;
        this.avail_out = 0;
        this.total_out = 0;
        this.msg = "";
        this.state = null;
        this.data_type = 2;
        this.adler = 0;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/inflator.js
  var require_inflator = __commonJS({
    "node_modules/@novnc/novnc/lib/inflator.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _inflate2 = require_inflate();
      var _zstream = _interopRequireDefault(require_zstream());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var Inflate = exports["default"] = /* @__PURE__ */ (function() {
        function Inflate2() {
          _classCallCheck(this, Inflate2);
          this.strm = new _zstream["default"]();
          this.chunkSize = 1024 * 10 * 10;
          this.strm.output = new Uint8Array(this.chunkSize);
          (0, _inflate2.inflateInit)(this.strm);
        }

        
return _createClass(Inflate2, [{
          key: "setInput",
          value: function setInput(data) {
            if (!data) {
              this.strm.input = null;
              this.strm.avail_in = 0;
              this.strm.next_in = 0;
            } else {
              this.strm.input = data;
              this.strm.avail_in = this.strm.input.length;
              this.strm.next_in = 0;
            }
          }
        }, {
          key: "inflate",
          value: function inflate(expected) {
            if (expected > this.chunkSize) {
              this.chunkSize = expected;
              this.strm.output = new Uint8Array(this.chunkSize);
            }

            this.strm.next_out = 0;
            this.strm.avail_out = expected;
            var ret = (0, _inflate2.inflate)(this.strm, 0);

            if (ret < 0) {
              throw new Error("zlib inflate failed");
            }

            if (this.strm.next_out != expected) {
              throw new Error("Incomplete zlib block");
            }

            
return new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);
          }
        }, {
          key: "reset",
          value: function reset() {
            (0, _inflate2.inflateReset)(this.strm);
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/trees.js
  var require_trees = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/trees.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports._tr_align = _tr_align;
      exports._tr_flush_block = _tr_flush_block;
      exports._tr_init = _tr_init;
      exports._tr_stored_block = _tr_stored_block;
      exports._tr_tally = _tr_tally;
      var utils = _interopRequireWildcard(require_common());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var Z_FIXED = 4;
      var Z_BINARY = 0;
      var Z_TEXT = 1;
      var Z_UNKNOWN = 2;

      function zero(buf) {
        var len = buf.length;

        while (--len >= 0) {
          buf[len] = 0;
        }
      }

      var STORED_BLOCK = 0;
      var STATIC_TREES = 1;
      var DYN_TREES = 2;
      var MIN_MATCH = 3;
      var MAX_MATCH = 258;
      var LENGTH_CODES = 29;
      var LITERALS = 256;
      var L_CODES = LITERALS + 1 + LENGTH_CODES;
      var D_CODES = 30;
      var BL_CODES = 19;
      var HEAP_SIZE = 2 * L_CODES + 1;
      var MAX_BITS = 15;
      var Buf_size = 16;
      var MAX_BL_BITS = 7;
      var END_BLOCK = 256;
      var REP_3_6 = 16;
      var REPZ_3_10 = 17;
      var REPZ_11_138 = 18;
      var extra_lbits = (

        /* extra bits for each length code */
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
      );
      var extra_dbits = (

        /* extra bits for each distance code */
        [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
      );
      var extra_blbits = (

        /* extra bits for each bit length code */
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7]
      );
      var bl_order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      var DIST_CODE_LEN = 512;
      var static_ltree = new Array((L_CODES + 2) * 2);

      zero(static_ltree);
      var static_dtree = new Array(D_CODES * 2);

      zero(static_dtree);
      var _dist_code = new Array(DIST_CODE_LEN);

      zero(_dist_code);
      var _length_code = new Array(MAX_MATCH - MIN_MATCH + 1);

      zero(_length_code);
      var base_length = new Array(LENGTH_CODES);

      zero(base_length);
      var base_dist = new Array(D_CODES);

      zero(base_dist);

      function StaticTreeDesc(static_tree, extra_bits, extra_base, elems, max_length) {
        this.static_tree = static_tree;
        this.extra_bits = extra_bits;
        this.extra_base = extra_base;
        this.elems = elems;
        this.max_length = max_length;
        this.has_stree = static_tree && static_tree.length;
      }

      var static_l_desc;
      var static_d_desc;
      var static_bl_desc;

      function TreeDesc(dyn_tree, stat_desc) {
        this.dyn_tree = dyn_tree;
        this.max_code = 0;
        this.stat_desc = stat_desc;
      }

      function d_code(dist) {
        return dist < 256 ? _dist_code[dist] : _dist_code[256 + (dist >>> 7)];
      }

      function put_short(s, w) {
        s.pending_buf[s.pending++] = w & 255;
        s.pending_buf[s.pending++] = w >>> 8 & 255;
      }

      function send_bits(s, value, length) {
        if (s.bi_valid > Buf_size - length) {
          s.bi_buf |= value << s.bi_valid & 65535;
          put_short(s, s.bi_buf);
          s.bi_buf = value >> Buf_size - s.bi_valid;
          s.bi_valid += length - Buf_size;
        } else {
          s.bi_buf |= value << s.bi_valid & 65535;
          s.bi_valid += length;
        }
      }

      function send_code(s, c, tree) {
        send_bits(
          s,
          tree[c * 2],
          tree[c * 2 + 1]

          /*.Len*/
        );
      }

      function bi_reverse(code, len) {
        var res = 0;

        do {
          res |= code & 1;
          code >>>= 1;
          res <<= 1;
        } while (--len > 0);

        
return res >>> 1;
      }

      function bi_flush(s) {
        if (s.bi_valid === 16) {
          put_short(s, s.bi_buf);
          s.bi_buf = 0;
          s.bi_valid = 0;
        } else if (s.bi_valid >= 8) {
          s.pending_buf[s.pending++] = s.bi_buf & 255;
          s.bi_buf >>= 8;
          s.bi_valid -= 8;
        }
      }

      function gen_bitlen(s, desc) {
        var tree = desc.dyn_tree;
        var max_code = desc.max_code;
        var stree = desc.stat_desc.static_tree;
        var has_stree = desc.stat_desc.has_stree;
        var extra = desc.stat_desc.extra_bits;
        var base = desc.stat_desc.extra_base;
        var max_length = desc.stat_desc.max_length;
        var h;
        var n, m;
        var bits;
        var xbits;
        var f;
        var overflow = 0;

        for (bits = 0; bits <= MAX_BITS; bits++) {
          s.bl_count[bits] = 0;
        }

        tree[s.heap[s.heap_max] * 2 + 1] = 0;

        for (h = s.heap_max + 1; h < HEAP_SIZE; h++) {
          n = s.heap[h];
          bits = tree[tree[n * 2 + 1] * 2 + 1] + 1;

          if (bits > max_length) {
            bits = max_length;
            overflow++;
          }

          tree[n * 2 + 1] = bits;

          if (n > max_code) {
            continue;
          }

          s.bl_count[bits]++;
          xbits = 0;

          if (n >= base) {
            xbits = extra[n - base];
          }

          f = tree[n * 2];
          s.opt_len += f * (bits + xbits);

          if (has_stree) {
            s.static_len += f * (stree[n * 2 + 1] + xbits);
          }
        }

        if (overflow === 0) {
          return;
        }

        do {
          bits = max_length - 1;

          while (s.bl_count[bits] === 0) {
            bits--;
          }

          s.bl_count[bits]--;
          s.bl_count[bits + 1] += 2;
          s.bl_count[max_length]--;
          overflow -= 2;
        } while (overflow > 0);

        for (bits = max_length; bits !== 0; bits--) {
          n = s.bl_count[bits];

          while (n !== 0) {
            m = s.heap[--h];

            if (m > max_code) {
              continue;
            }

            if (tree[m * 2 + 1] !== bits) {
              s.opt_len += (bits - tree[m * 2 + 1]) * tree[m * 2];
              tree[m * 2 + 1] = bits;
            }

            n--;
          }
        }
      }

      function gen_codes(tree, max_code, bl_count) {
        var next_code = new Array(MAX_BITS + 1);
        var code = 0;
        var bits;
        var n;

        for (bits = 1; bits <= MAX_BITS; bits++) {
          next_code[bits] = code = code + bl_count[bits - 1] << 1;
        }

        for (n = 0; n <= max_code; n++) {
          var len = tree[n * 2 + 1];

          if (len === 0) {
            continue;
          }

          tree[n * 2] = bi_reverse(next_code[len]++, len);
        }
      }

      function tr_static_init() {
        var n;
        var bits;
        var length;
        var code;
        var dist;
        var bl_count = new Array(MAX_BITS + 1);

        length = 0;

        for (code = 0; code < LENGTH_CODES - 1; code++) {
          base_length[code] = length;

          for (n = 0; n < 1 << extra_lbits[code]; n++) {
            _length_code[length++] = code;
          }
        }

        _length_code[length - 1] = code;
        dist = 0;

        for (code = 0; code < 16; code++) {
          base_dist[code] = dist;

          for (n = 0; n < 1 << extra_dbits[code]; n++) {
            _dist_code[dist++] = code;
          }
        }

        dist >>= 7;

        for (; code < D_CODES; code++) {
          base_dist[code] = dist << 7;

          for (n = 0; n < 1 << extra_dbits[code] - 7; n++) {
            _dist_code[256 + dist++] = code;
          }
        }

        for (bits = 0; bits <= MAX_BITS; bits++) {
          bl_count[bits] = 0;
        }

        n = 0;

        while (n <= 143) {
          static_ltree[n * 2 + 1] = 8;
          n++;
          bl_count[8]++;
        }

        while (n <= 255) {
          static_ltree[n * 2 + 1] = 9;
          n++;
          bl_count[9]++;
        }

        while (n <= 279) {
          static_ltree[n * 2 + 1] = 7;
          n++;
          bl_count[7]++;
        }

        while (n <= 287) {
          static_ltree[n * 2 + 1] = 8;
          n++;
          bl_count[8]++;
        }

        gen_codes(static_ltree, L_CODES + 1, bl_count);

        for (n = 0; n < D_CODES; n++) {
          static_dtree[n * 2 + 1] = 5;
          static_dtree[n * 2] = bi_reverse(n, 5);
        }

        static_l_desc = new StaticTreeDesc(static_ltree, extra_lbits, LITERALS + 1, L_CODES, MAX_BITS);
        static_d_desc = new StaticTreeDesc(static_dtree, extra_dbits, 0, D_CODES, MAX_BITS);
        static_bl_desc = new StaticTreeDesc(new Array(0), extra_blbits, 0, BL_CODES, MAX_BL_BITS);
      }

      function init_block(s) {
        var n;

        for (n = 0; n < L_CODES; n++) {
          s.dyn_ltree[n * 2] = 0;
        }

        for (n = 0; n < D_CODES; n++) {
          s.dyn_dtree[n * 2] = 0;
        }

        for (n = 0; n < BL_CODES; n++) {
          s.bl_tree[n * 2] = 0;
        }

        s.dyn_ltree[END_BLOCK * 2] = 1;
        s.opt_len = s.static_len = 0;
        s.last_lit = s.matches = 0;
      }

      function bi_windup(s) {
        if (s.bi_valid > 8) {
          put_short(s, s.bi_buf);
        } else if (s.bi_valid > 0) {
          s.pending_buf[s.pending++] = s.bi_buf;
        }

        s.bi_buf = 0;
        s.bi_valid = 0;
      }

      function copy_block(s, buf, len, header) {
        bi_windup(s);

        if (header) {
          put_short(s, len);
          put_short(s, ~len);
        }

        utils.arraySet(s.pending_buf, s.window, buf, len, s.pending);
        s.pending += len;
      }

      function smaller(tree, n, m, depth) {
        var _n2 = n * 2;
        var _m2 = m * 2;

        
return tree[_n2] < tree[_m2] || tree[_n2] === tree[_m2] && depth[n] <= depth[m];
      }

      function pqdownheap(s, tree, k) {
        var v = s.heap[k];
        var j = k << 1;

        while (j <= s.heap_len) {
          if (j < s.heap_len && smaller(tree, s.heap[j + 1], s.heap[j], s.depth)) {
            j++;
          }

          if (smaller(tree, v, s.heap[j], s.depth)) {
            break;
          }

          s.heap[k] = s.heap[j];
          k = j;
          j <<= 1;
        }

        s.heap[k] = v;
      }

      function compress_block(s, ltree, dtree) {
        var dist;
        var lc;
        var lx = 0;
        var code;
        var extra;

        if (s.last_lit !== 0) {
          do {
            dist = s.pending_buf[s.d_buf + lx * 2] << 8 | s.pending_buf[s.d_buf + lx * 2 + 1];
            lc = s.pending_buf[s.l_buf + lx];
            lx++;

            if (dist === 0) {
              send_code(s, lc, ltree);
            } else {
              code = _length_code[lc];
              send_code(s, code + LITERALS + 1, ltree);
              extra = extra_lbits[code];

              if (extra !== 0) {
                lc -= base_length[code];
                send_bits(s, lc, extra);
              }

              dist--;
              code = d_code(dist);
              send_code(s, code, dtree);
              extra = extra_dbits[code];

              if (extra !== 0) {
                dist -= base_dist[code];
                send_bits(s, dist, extra);
              }
            }
          } while (lx < s.last_lit);
        }

        send_code(s, END_BLOCK, ltree);
      }

      function build_tree(s, desc) {
        var tree = desc.dyn_tree;
        var stree = desc.stat_desc.static_tree;
        var has_stree = desc.stat_desc.has_stree;
        var elems = desc.stat_desc.elems;
        var n, m;
        var max_code = -1;
        var node;

        s.heap_len = 0;
        s.heap_max = HEAP_SIZE;

        for (n = 0; n < elems; n++) {
          if (tree[n * 2] !== 0) {
            s.heap[++s.heap_len] = max_code = n;
            s.depth[n] = 0;
          } else {
            tree[n * 2 + 1] = 0;
          }
        }

        while (s.heap_len < 2) {
          node = s.heap[++s.heap_len] = max_code < 2 ? ++max_code : 0;
          tree[node * 2] = 1;
          s.depth[node] = 0;
          s.opt_len--;

          if (has_stree) {
            s.static_len -= stree[node * 2 + 1];
          }
        }

        desc.max_code = max_code;

        for (n = s.heap_len >> 1; n >= 1; n--) {
          pqdownheap(s, tree, n);
        }

        node = elems;

        do {
          n = s.heap[
            1

            /*SMALLEST*/
          ];
          s.heap[
            1

            /*SMALLEST*/
          ] = s.heap[s.heap_len--];
          pqdownheap(
            s,
            tree,
            1

            /*SMALLEST*/
          );
          m = s.heap[
            1

            /*SMALLEST*/
          ];
          s.heap[--s.heap_max] = n;
          s.heap[--s.heap_max] = m;
          tree[node * 2] = tree[n * 2] + tree[m * 2];
          s.depth[node] = (s.depth[n] >= s.depth[m] ? s.depth[n] : s.depth[m]) + 1;
          tree[n * 2 + 1] = tree[m * 2 + 1] = node;
          s.heap[
            1

            /*SMALLEST*/
          ] = node++;
          pqdownheap(
            s,
            tree,
            1

            /*SMALLEST*/
          );
        } while (s.heap_len >= 2);

        s.heap[--s.heap_max] = s.heap[
          1

          /*SMALLEST*/
        ];
        gen_bitlen(s, desc);
        gen_codes(tree, max_code, s.bl_count);
      }

      function scan_tree(s, tree, max_code) {
        var n;
        var prevlen = -1;
        var curlen;
        var nextlen = tree[0 * 2 + 1];
        var count = 0;
        var max_count = 7;
        var min_count = 4;

        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }

        tree[(max_code + 1) * 2 + 1] = 65535;

        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];

          if (++count < max_count && curlen === nextlen) {
            continue;
          } else if (count < min_count) {
            s.bl_tree[curlen * 2] += count;
          } else if (curlen !== 0) {
            if (curlen !== prevlen) {
              s.bl_tree[curlen * 2]++;
            }

            s.bl_tree[REP_3_6 * 2]++;
          } else if (count <= 10) {
            s.bl_tree[REPZ_3_10 * 2]++;
          } else {
            s.bl_tree[REPZ_11_138 * 2]++;
          }

          count = 0;
          prevlen = curlen;

          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      }

      function send_tree(s, tree, max_code) {
        var n;
        var prevlen = -1;
        var curlen;
        var nextlen = tree[0 * 2 + 1];
        var count = 0;
        var max_count = 7;
        var min_count = 4;

        if (nextlen === 0) {
          max_count = 138;
          min_count = 3;
        }

        for (n = 0; n <= max_code; n++) {
          curlen = nextlen;
          nextlen = tree[(n + 1) * 2 + 1];

          if (++count < max_count && curlen === nextlen) {
            continue;
          } else if (count < min_count) {
            do {
              send_code(s, curlen, s.bl_tree);
            } while (--count !== 0);
          } else if (curlen !== 0) {
            if (curlen !== prevlen) {
              send_code(s, curlen, s.bl_tree);
              count--;
            }

            send_code(s, REP_3_6, s.bl_tree);
            send_bits(s, count - 3, 2);
          } else if (count <= 10) {
            send_code(s, REPZ_3_10, s.bl_tree);
            send_bits(s, count - 3, 3);
          } else {
            send_code(s, REPZ_11_138, s.bl_tree);
            send_bits(s, count - 11, 7);
          }

          count = 0;
          prevlen = curlen;

          if (nextlen === 0) {
            max_count = 138;
            min_count = 3;
          } else if (curlen === nextlen) {
            max_count = 6;
            min_count = 3;
          } else {
            max_count = 7;
            min_count = 4;
          }
        }
      }

      function build_bl_tree(s) {
        var max_blindex;

        scan_tree(s, s.dyn_ltree, s.l_desc.max_code);
        scan_tree(s, s.dyn_dtree, s.d_desc.max_code);
        build_tree(s, s.bl_desc);

        for (max_blindex = BL_CODES - 1; max_blindex >= 3; max_blindex--) {
          if (s.bl_tree[bl_order[max_blindex] * 2 + 1] !== 0) {
            break;
          }
        }

        s.opt_len += 3 * (max_blindex + 1) + 5 + 5 + 4;
        
return max_blindex;
      }

      function send_all_trees(s, lcodes, dcodes, blcodes) {
        var rank;

        send_bits(s, lcodes - 257, 5);
        send_bits(s, dcodes - 1, 5);
        send_bits(s, blcodes - 4, 4);

        for (rank = 0; rank < blcodes; rank++) {
          send_bits(s, s.bl_tree[bl_order[rank] * 2 + 1], 3);
        }

        send_tree(s, s.dyn_ltree, lcodes - 1);
        send_tree(s, s.dyn_dtree, dcodes - 1);
      }

      function detect_data_type(s) {
        var black_mask = 4093624447;
        var n;

        for (n = 0; n <= 31; n++, black_mask >>>= 1) {
          if (black_mask & 1 && s.dyn_ltree[n * 2] !== 0) {
            return Z_BINARY;
          }
        }

        if (s.dyn_ltree[9 * 2] !== 0 || s.dyn_ltree[10 * 2] !== 0 || s.dyn_ltree[13 * 2] !== 0) {
          return Z_TEXT;
        }

        for (n = 32; n < LITERALS; n++) {
          if (s.dyn_ltree[n * 2] !== 0) {
            return Z_TEXT;
          }
        }

        
return Z_BINARY;
      }

      var static_init_done = false;

      function _tr_init(s) {
        if (!static_init_done) {
          tr_static_init();
          static_init_done = true;
        }

        s.l_desc = new TreeDesc(s.dyn_ltree, static_l_desc);
        s.d_desc = new TreeDesc(s.dyn_dtree, static_d_desc);
        s.bl_desc = new TreeDesc(s.bl_tree, static_bl_desc);
        s.bi_buf = 0;
        s.bi_valid = 0;
        init_block(s);
      }

      function _tr_stored_block(s, buf, stored_len, last) {
        send_bits(s, (STORED_BLOCK << 1) + (last ? 1 : 0), 3);
        copy_block(s, buf, stored_len, true);
      }

      function _tr_align(s) {
        send_bits(s, STATIC_TREES << 1, 3);
        send_code(s, END_BLOCK, static_ltree);
        bi_flush(s);
      }

      function _tr_flush_block(s, buf, stored_len, last) {
        var opt_lenb, static_lenb;
        var max_blindex = 0;

        if (s.level > 0) {
          if (s.strm.data_type === Z_UNKNOWN) {
            s.strm.data_type = detect_data_type(s);
          }

          build_tree(s, s.l_desc);
          build_tree(s, s.d_desc);
          max_blindex = build_bl_tree(s);
          opt_lenb = s.opt_len + 3 + 7 >>> 3;
          static_lenb = s.static_len + 3 + 7 >>> 3;

          if (static_lenb <= opt_lenb) {
            opt_lenb = static_lenb;
          }
        } else {
          opt_lenb = static_lenb = stored_len + 5;
        }

        if (stored_len + 4 <= opt_lenb && buf !== -1) {
          _tr_stored_block(s, buf, stored_len, last);
        } else if (s.strategy === Z_FIXED || static_lenb === opt_lenb) {
          send_bits(s, (STATIC_TREES << 1) + (last ? 1 : 0), 3);
          compress_block(s, static_ltree, static_dtree);
        } else {
          send_bits(s, (DYN_TREES << 1) + (last ? 1 : 0), 3);
          send_all_trees(s, s.l_desc.max_code + 1, s.d_desc.max_code + 1, max_blindex + 1);
          compress_block(s, s.dyn_ltree, s.dyn_dtree);
        }

        init_block(s);

        if (last) {
          bi_windup(s);
        }
      }

      function _tr_tally(s, dist, lc) {
        s.pending_buf[s.d_buf + s.last_lit * 2] = dist >>> 8 & 255;
        s.pending_buf[s.d_buf + s.last_lit * 2 + 1] = dist & 255;
        s.pending_buf[s.l_buf + s.last_lit] = lc & 255;
        s.last_lit++;

        if (dist === 0) {
          s.dyn_ltree[lc * 2]++;
        } else {
          s.matches++;
          dist--;
          s.dyn_ltree[(_length_code[lc] + LITERALS + 1) * 2]++;
          s.dyn_dtree[d_code(dist) * 2]++;
        }

        
return s.last_lit === s.lit_bufsize - 1;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/messages.js
  var require_messages = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/messages.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _default = exports["default"] = {
        2: "need dictionary",

        /* Z_NEED_DICT       2  */
        1: "stream end",

        /* Z_STREAM_END      1  */
        0: "",

        /* Z_OK              0  */
        "-1": "file error",

        /* Z_ERRNO         (-1) */
        "-2": "stream error",

        /* Z_STREAM_ERROR  (-2) */
        "-3": "data error",

        /* Z_DATA_ERROR    (-3) */
        "-4": "insufficient memory",

        /* Z_MEM_ERROR     (-4) */
        "-5": "buffer error",

        /* Z_BUF_ERROR     (-5) */
        "-6": "incompatible version"

        /* Z_VERSION_ERROR (-6) */
      };
    }
  });

  // node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/deflate.js
  var require_deflate = __commonJS({
    "node_modules/@novnc/novnc/lib/vendor/pako/lib/zlib/deflate.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.Z_UNKNOWN = exports.Z_STREAM_ERROR = exports.Z_STREAM_END = exports.Z_RLE = exports.Z_PARTIAL_FLUSH = exports.Z_OK = exports.Z_NO_FLUSH = exports.Z_HUFFMAN_ONLY = exports.Z_FULL_FLUSH = exports.Z_FIXED = exports.Z_FINISH = exports.Z_FILTERED = exports.Z_DEFLATED = exports.Z_DEFAULT_STRATEGY = exports.Z_DEFAULT_COMPRESSION = exports.Z_DATA_ERROR = exports.Z_BUF_ERROR = exports.Z_BLOCK = void 0;
      exports.deflate = deflate;
      exports.deflateEnd = deflateEnd;
      exports.deflateInfo = void 0;
      exports.deflateInit = deflateInit;
      exports.deflateInit2 = deflateInit2;
      exports.deflateReset = deflateReset;
      exports.deflateResetKeep = deflateResetKeep;
      exports.deflateSetDictionary = deflateSetDictionary;
      exports.deflateSetHeader = deflateSetHeader;
      var utils = _interopRequireWildcard(require_common());
      var trees = _interopRequireWildcard(require_trees());
      var _adler = _interopRequireDefault(require_adler32());
      var _crc = _interopRequireDefault(require_crc32());
      var _messages = _interopRequireDefault(require_messages());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      var Z_NO_FLUSH = exports.Z_NO_FLUSH = 0;
      var Z_PARTIAL_FLUSH = exports.Z_PARTIAL_FLUSH = 1;
      var Z_FULL_FLUSH = exports.Z_FULL_FLUSH = 3;
      var Z_FINISH = exports.Z_FINISH = 4;
      var Z_BLOCK = exports.Z_BLOCK = 5;
      var Z_OK = exports.Z_OK = 0;
      var Z_STREAM_END = exports.Z_STREAM_END = 1;
      var Z_STREAM_ERROR = exports.Z_STREAM_ERROR = -2;
      var Z_DATA_ERROR = exports.Z_DATA_ERROR = -3;
      var Z_BUF_ERROR = exports.Z_BUF_ERROR = -5;
      var Z_DEFAULT_COMPRESSION = exports.Z_DEFAULT_COMPRESSION = -1;
      var Z_FILTERED = exports.Z_FILTERED = 1;
      var Z_HUFFMAN_ONLY = exports.Z_HUFFMAN_ONLY = 2;
      var Z_RLE = exports.Z_RLE = 3;
      var Z_FIXED = exports.Z_FIXED = 4;
      var Z_DEFAULT_STRATEGY = exports.Z_DEFAULT_STRATEGY = 0;
      var Z_UNKNOWN = exports.Z_UNKNOWN = 2;
      var Z_DEFLATED = exports.Z_DEFLATED = 8;
      var MAX_MEM_LEVEL = 9;
      var MAX_WBITS = 15;
      var DEF_MEM_LEVEL = 8;
      var LENGTH_CODES = 29;
      var LITERALS = 256;
      var L_CODES = LITERALS + 1 + LENGTH_CODES;
      var D_CODES = 30;
      var BL_CODES = 19;
      var HEAP_SIZE = 2 * L_CODES + 1;
      var MAX_BITS = 15;
      var MIN_MATCH = 3;
      var MAX_MATCH = 258;
      var MIN_LOOKAHEAD = MAX_MATCH + MIN_MATCH + 1;
      var PRESET_DICT = 32;
      var INIT_STATE = 42;
      var EXTRA_STATE = 69;
      var NAME_STATE = 73;
      var COMMENT_STATE = 91;
      var HCRC_STATE = 103;
      var BUSY_STATE = 113;
      var FINISH_STATE = 666;
      var BS_NEED_MORE = 1;
      var BS_BLOCK_DONE = 2;
      var BS_FINISH_STARTED = 3;
      var BS_FINISH_DONE = 4;
      var OS_CODE = 3;

      function err(strm, errorCode) {
        strm.msg = _messages["default"][errorCode];
        
return errorCode;
      }

      function rank(f) {
        return (f << 1) - (f > 4 ? 9 : 0);
      }

      function zero(buf) {
        var len = buf.length;

        while (--len >= 0) {
          buf[len] = 0;
        }
      }

      function flush_pending(strm) {
        var s = strm.state;
        var len = s.pending;

        if (len > strm.avail_out) {
          len = strm.avail_out;
        }

        if (len === 0) {
          return;
        }

        utils.arraySet(strm.output, s.pending_buf, s.pending_out, len, strm.next_out);
        strm.next_out += len;
        s.pending_out += len;
        strm.total_out += len;
        strm.avail_out -= len;
        s.pending -= len;

        if (s.pending === 0) {
          s.pending_out = 0;
        }
      }

      function flush_block_only(s, last) {
        trees._tr_flush_block(s, s.block_start >= 0 ? s.block_start : -1, s.strstart - s.block_start, last);
        s.block_start = s.strstart;
        flush_pending(s.strm);
      }

      function put_byte(s, b) {
        s.pending_buf[s.pending++] = b;
      }

      function putShortMSB(s, b) {
        s.pending_buf[s.pending++] = b >>> 8 & 255;
        s.pending_buf[s.pending++] = b & 255;
      }

      function read_buf(strm, buf, start, size) {
        var len = strm.avail_in;

        if (len > size) {
          len = size;
        }

        if (len === 0) {
          return 0;
        }

        strm.avail_in -= len;
        utils.arraySet(buf, strm.input, strm.next_in, len, start);

        if (strm.state.wrap === 1) {
          strm.adler = (0, _adler["default"])(strm.adler, buf, len, start);
        } else if (strm.state.wrap === 2) {
          strm.adler = (0, _crc["default"])(strm.adler, buf, len, start);
        }

        strm.next_in += len;
        strm.total_in += len;
        
return len;
      }

      function longest_match(s, cur_match) {
        var chain_length = s.max_chain_length;
        var scan = s.strstart;
        var match;
        var len;
        var best_len = s.prev_length;
        var nice_match = s.nice_match;
        var limit = s.strstart > s.w_size - MIN_LOOKAHEAD ? s.strstart - (s.w_size - MIN_LOOKAHEAD) : 0;
        var _win = s.window;
        var wmask = s.w_mask;
        var prev = s.prev;
        var strend = s.strstart + MAX_MATCH;
        var scan_end1 = _win[scan + best_len - 1];
        var scan_end = _win[scan + best_len];

        if (s.prev_length >= s.good_match) {
          chain_length >>= 2;
        }

        if (nice_match > s.lookahead) {
          nice_match = s.lookahead;
        }

        do {
          match = cur_match;

          if (_win[match + best_len] !== scan_end || _win[match + best_len - 1] !== scan_end1 || _win[match] !== _win[scan] || _win[++match] !== _win[scan + 1]) {
            continue;
          }

          scan += 2;
          match++;

          do {
          } while (_win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && _win[++scan] === _win[++match] && scan < strend);

          len = MAX_MATCH - (strend - scan);
          scan = strend - MAX_MATCH;

          if (len > best_len) {
            s.match_start = cur_match;
            best_len = len;

            if (len >= nice_match) {
              break;
            }

            scan_end1 = _win[scan + best_len - 1];
            scan_end = _win[scan + best_len];
          }
        } while ((cur_match = prev[cur_match & wmask]) > limit && --chain_length !== 0);

        if (best_len <= s.lookahead) {
          return best_len;
        }

        
return s.lookahead;
      }

      function fill_window(s) {
        var _w_size = s.w_size;
        var p, n, m, more, str;

        do {
          more = s.window_size - s.lookahead - s.strstart;

          if (s.strstart >= _w_size + (_w_size - MIN_LOOKAHEAD)) {
            utils.arraySet(s.window, s.window, _w_size, _w_size, 0);
            s.match_start -= _w_size;
            s.strstart -= _w_size;
            s.block_start -= _w_size;
            n = s.hash_size;
            p = n;

            do {
              m = s.head[--p];
              s.head[p] = m >= _w_size ? m - _w_size : 0;
            } while (--n);

            n = _w_size;
            p = n;

            do {
              m = s.prev[--p];
              s.prev[p] = m >= _w_size ? m - _w_size : 0;
            } while (--n);

            more += _w_size;
          }

          if (s.strm.avail_in === 0) {
            break;
          }

          n = read_buf(s.strm, s.window, s.strstart + s.lookahead, more);
          s.lookahead += n;

          if (s.lookahead + s.insert >= MIN_MATCH) {
            str = s.strstart - s.insert;
            s.ins_h = s.window[str];
            s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + 1]) & s.hash_mask;

            while (s.insert) {
              s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + MIN_MATCH - 1]) & s.hash_mask;
              s.prev[str & s.w_mask] = s.head[s.ins_h];
              s.head[s.ins_h] = str;
              str++;
              s.insert--;

              if (s.lookahead + s.insert < MIN_MATCH) {
                break;
              }
            }
          }
        } while (s.lookahead < MIN_LOOKAHEAD && s.strm.avail_in !== 0);
      }

      function deflate_stored(s, flush) {
        var max_block_size = 65535;

        if (max_block_size > s.pending_buf_size - 5) {
          max_block_size = s.pending_buf_size - 5;
        }

        for (; ; ) {
          if (s.lookahead <= 1) {
            fill_window(s);

            if (s.lookahead === 0 && flush === Z_NO_FLUSH) {
              return BS_NEED_MORE;
            }

            if (s.lookahead === 0) {
              break;
            }
          }

          s.strstart += s.lookahead;
          s.lookahead = 0;
          var max_start = s.block_start + max_block_size;

          if (s.strstart === 0 || s.strstart >= max_start) {
            s.lookahead = s.strstart - max_start;
            s.strstart = max_start;
            flush_block_only(s, false);

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }

          if (s.strstart - s.block_start >= s.w_size - MIN_LOOKAHEAD) {
            flush_block_only(s, false);

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }
        }

        s.insert = 0;

        if (flush === Z_FINISH) {
          flush_block_only(s, true);

          if (s.strm.avail_out === 0) {
            return BS_FINISH_STARTED;
          }

          
return BS_FINISH_DONE;
        }

        if (s.strstart > s.block_start) {
          flush_block_only(s, false);

          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }

        
return BS_NEED_MORE;
      }

      function deflate_fast(s, flush) {
        var hash_head;
        var bflush;

        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD) {
            fill_window(s);

            if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
              return BS_NEED_MORE;
            }

            if (s.lookahead === 0) {
              break;
            }
          }

          hash_head = 0;

          if (s.lookahead >= MIN_MATCH) {
            s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
            hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = s.strstart;
          }

          if (hash_head !== 0 && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
            s.match_length = longest_match(s, hash_head);
          }

          if (s.match_length >= MIN_MATCH) {
            bflush = trees._tr_tally(s, s.strstart - s.match_start, s.match_length - MIN_MATCH);
            s.lookahead -= s.match_length;

            if (s.match_length <= s.max_lazy_match && s.lookahead >= MIN_MATCH) {
              s.match_length--;

              do {
                s.strstart++;
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                s.head[s.ins_h] = s.strstart;
              } while (--s.match_length !== 0);

              s.strstart++;
            } else {
              s.strstart += s.match_length;
              s.match_length = 0;
              s.ins_h = s.window[s.strstart];
              s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + 1]) & s.hash_mask;
            }
          } else {
            bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
            s.lookahead--;
            s.strstart++;
          }

          if (bflush) {
            flush_block_only(s, false);

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }
        }

        s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;

        if (flush === Z_FINISH) {
          flush_block_only(s, true);

          if (s.strm.avail_out === 0) {
            return BS_FINISH_STARTED;
          }

          
return BS_FINISH_DONE;
        }

        if (s.last_lit) {
          flush_block_only(s, false);

          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }

        
return BS_BLOCK_DONE;
      }

      function deflate_slow(s, flush) {
        var hash_head;
        var bflush;
        var max_insert;

        for (; ; ) {
          if (s.lookahead < MIN_LOOKAHEAD) {
            fill_window(s);

            if (s.lookahead < MIN_LOOKAHEAD && flush === Z_NO_FLUSH) {
              return BS_NEED_MORE;
            }

            if (s.lookahead === 0) {
              break;
            }
          }

          hash_head = 0;

          if (s.lookahead >= MIN_MATCH) {
            s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
            hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = s.strstart;
          }

          s.prev_length = s.match_length;
          s.prev_match = s.match_start;
          s.match_length = MIN_MATCH - 1;

          if (hash_head !== 0 && s.prev_length < s.max_lazy_match && s.strstart - hash_head <= s.w_size - MIN_LOOKAHEAD) {
            s.match_length = longest_match(s, hash_head);

            if (s.match_length <= 5 && (s.strategy === Z_FILTERED || s.match_length === MIN_MATCH && s.strstart - s.match_start > 4096)) {
              s.match_length = MIN_MATCH - 1;
            }
          }

          if (s.prev_length >= MIN_MATCH && s.match_length <= s.prev_length) {
            max_insert = s.strstart + s.lookahead - MIN_MATCH;
            bflush = trees._tr_tally(s, s.strstart - 1 - s.prev_match, s.prev_length - MIN_MATCH);
            s.lookahead -= s.prev_length - 1;
            s.prev_length -= 2;

            do {
              if (++s.strstart <= max_insert) {
                s.ins_h = (s.ins_h << s.hash_shift ^ s.window[s.strstart + MIN_MATCH - 1]) & s.hash_mask;
                hash_head = s.prev[s.strstart & s.w_mask] = s.head[s.ins_h];
                s.head[s.ins_h] = s.strstart;
              }
            } while (--s.prev_length !== 0);

            s.match_available = 0;
            s.match_length = MIN_MATCH - 1;
            s.strstart++;

            if (bflush) {
              flush_block_only(s, false);

              if (s.strm.avail_out === 0) {
                return BS_NEED_MORE;
              }
            }
          } else if (s.match_available) {
            bflush = trees._tr_tally(s, 0, s.window[s.strstart - 1]);

            if (bflush) {
              flush_block_only(s, false);
            }

            s.strstart++;
            s.lookahead--;

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          } else {
            s.match_available = 1;
            s.strstart++;
            s.lookahead--;
          }
        }

        if (s.match_available) {
          bflush = trees._tr_tally(s, 0, s.window[s.strstart - 1]);
          s.match_available = 0;
        }

        s.insert = s.strstart < MIN_MATCH - 1 ? s.strstart : MIN_MATCH - 1;

        if (flush === Z_FINISH) {
          flush_block_only(s, true);

          if (s.strm.avail_out === 0) {
            return BS_FINISH_STARTED;
          }

          
return BS_FINISH_DONE;
        }

        if (s.last_lit) {
          flush_block_only(s, false);

          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }

        
return BS_BLOCK_DONE;
      }

      function deflate_rle(s, flush) {
        var bflush;
        var prev;
        var scan, strend;
        var _win = s.window;

        for (; ; ) {
          if (s.lookahead <= MAX_MATCH) {
            fill_window(s);

            if (s.lookahead <= MAX_MATCH && flush === Z_NO_FLUSH) {
              return BS_NEED_MORE;
            }

            if (s.lookahead === 0) {
              break;
            }
          }

          s.match_length = 0;

          if (s.lookahead >= MIN_MATCH && s.strstart > 0) {
            scan = s.strstart - 1;
            prev = _win[scan];

            if (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan]) {
              strend = s.strstart + MAX_MATCH;

              do {
              } while (prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && prev === _win[++scan] && scan < strend);

              s.match_length = MAX_MATCH - (strend - scan);

              if (s.match_length > s.lookahead) {
                s.match_length = s.lookahead;
              }
            }
          }

          if (s.match_length >= MIN_MATCH) {
            bflush = trees._tr_tally(s, 1, s.match_length - MIN_MATCH);
            s.lookahead -= s.match_length;
            s.strstart += s.match_length;
            s.match_length = 0;
          } else {
            bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
            s.lookahead--;
            s.strstart++;
          }

          if (bflush) {
            flush_block_only(s, false);

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }
        }

        s.insert = 0;

        if (flush === Z_FINISH) {
          flush_block_only(s, true);

          if (s.strm.avail_out === 0) {
            return BS_FINISH_STARTED;
          }

          
return BS_FINISH_DONE;
        }

        if (s.last_lit) {
          flush_block_only(s, false);

          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }

        
return BS_BLOCK_DONE;
      }

      function deflate_huff(s, flush) {
        var bflush;

        for (; ; ) {
          if (s.lookahead === 0) {
            fill_window(s);

            if (s.lookahead === 0) {
              if (flush === Z_NO_FLUSH) {
                return BS_NEED_MORE;
              }

              break;
            }
          }

          s.match_length = 0;
          bflush = trees._tr_tally(s, 0, s.window[s.strstart]);
          s.lookahead--;
          s.strstart++;

          if (bflush) {
            flush_block_only(s, false);

            if (s.strm.avail_out === 0) {
              return BS_NEED_MORE;
            }
          }
        }

        s.insert = 0;

        if (flush === Z_FINISH) {
          flush_block_only(s, true);

          if (s.strm.avail_out === 0) {
            return BS_FINISH_STARTED;
          }

          
return BS_FINISH_DONE;
        }

        if (s.last_lit) {
          flush_block_only(s, false);

          if (s.strm.avail_out === 0) {
            return BS_NEED_MORE;
          }
        }

        
return BS_BLOCK_DONE;
      }

      function Config(good_length, max_lazy, nice_length, max_chain, func) {
        this.good_length = good_length;
        this.max_lazy = max_lazy;
        this.nice_length = nice_length;
        this.max_chain = max_chain;
        this.func = func;
      }

      var configuration_table;

      configuration_table = [
        /*      good lazy nice chain */
        new Config(0, 0, 0, 0, deflate_stored),

        /* 0 store only */
        new Config(4, 4, 8, 4, deflate_fast),

        /* 1 max speed, no lazy matches */
        new Config(4, 5, 16, 8, deflate_fast),

        /* 2 */
        new Config(4, 6, 32, 32, deflate_fast),

        /* 3 */
        new Config(4, 4, 16, 16, deflate_slow),

        /* 4 lazy matches */
        new Config(8, 16, 32, 32, deflate_slow),

        /* 5 */
        new Config(8, 16, 128, 128, deflate_slow),

        /* 6 */
        new Config(8, 32, 128, 256, deflate_slow),

        /* 7 */
        new Config(32, 128, 258, 1024, deflate_slow),

        /* 8 */
        new Config(32, 258, 258, 4096, deflate_slow)

        /* 9 max compression */
      ];

      function lm_init(s) {
        s.window_size = 2 * s.w_size;
        zero(s.head);
        s.max_lazy_match = configuration_table[s.level].max_lazy;
        s.good_match = configuration_table[s.level].good_length;
        s.nice_match = configuration_table[s.level].nice_length;
        s.max_chain_length = configuration_table[s.level].max_chain;
        s.strstart = 0;
        s.block_start = 0;
        s.lookahead = 0;
        s.insert = 0;
        s.match_length = s.prev_length = MIN_MATCH - 1;
        s.match_available = 0;
        s.ins_h = 0;
      }

      function DeflateState() {
        this.strm = null;
        this.status = 0;
        this.pending_buf = null;
        this.pending_buf_size = 0;
        this.pending_out = 0;
        this.pending = 0;
        this.wrap = 0;
        this.gzhead = null;
        this.gzindex = 0;
        this.method = Z_DEFLATED;
        this.last_flush = -1;
        this.w_size = 0;
        this.w_bits = 0;
        this.w_mask = 0;
        this.window = null;
        this.window_size = 0;
        this.prev = null;
        this.head = null;
        this.ins_h = 0;
        this.hash_size = 0;
        this.hash_bits = 0;
        this.hash_mask = 0;
        this.hash_shift = 0;
        this.block_start = 0;
        this.match_length = 0;
        this.prev_match = 0;
        this.match_available = 0;
        this.strstart = 0;
        this.match_start = 0;
        this.lookahead = 0;
        this.prev_length = 0;
        this.max_chain_length = 0;
        this.max_lazy_match = 0;
        this.level = 0;
        this.strategy = 0;
        this.good_match = 0;
        this.nice_match = 0;
        this.dyn_ltree = new utils.Buf16(HEAP_SIZE * 2);
        this.dyn_dtree = new utils.Buf16((2 * D_CODES + 1) * 2);
        this.bl_tree = new utils.Buf16((2 * BL_CODES + 1) * 2);
        zero(this.dyn_ltree);
        zero(this.dyn_dtree);
        zero(this.bl_tree);
        this.l_desc = null;
        this.d_desc = null;
        this.bl_desc = null;
        this.bl_count = new utils.Buf16(MAX_BITS + 1);
        this.heap = new utils.Buf16(2 * L_CODES + 1);
        zero(this.heap);
        this.heap_len = 0;
        this.heap_max = 0;
        this.depth = new utils.Buf16(2 * L_CODES + 1);
        zero(this.depth);
        this.l_buf = 0;
        this.lit_bufsize = 0;
        this.last_lit = 0;
        this.d_buf = 0;
        this.opt_len = 0;
        this.static_len = 0;
        this.matches = 0;
        this.insert = 0;
        this.bi_buf = 0;
        this.bi_valid = 0;
      }

      function deflateResetKeep(strm) {
        var s;

        if (!strm || !strm.state) {
          return err(strm, Z_STREAM_ERROR);
        }

        strm.total_in = strm.total_out = 0;
        strm.data_type = Z_UNKNOWN;
        s = strm.state;
        s.pending = 0;
        s.pending_out = 0;

        if (s.wrap < 0) {
          s.wrap = -s.wrap;
        }

        s.status = s.wrap ? INIT_STATE : BUSY_STATE;
        strm.adler = s.wrap === 2 ? 0 : 1;
        s.last_flush = Z_NO_FLUSH;
        trees._tr_init(s);
        
return Z_OK;
      }

      function deflateReset(strm) {
        var ret = deflateResetKeep(strm);

        if (ret === Z_OK) {
          lm_init(strm.state);
        }

        
return ret;
      }

      function deflateSetHeader(strm, head) {
        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        if (strm.state.wrap !== 2) {
          return Z_STREAM_ERROR;
        }

        strm.state.gzhead = head;
        
return Z_OK;
      }

      function deflateInit2(strm, level, method, windowBits, memLevel, strategy) {
        if (!strm) {
          return Z_STREAM_ERROR;
        }

        var wrap = 1;

        if (level === Z_DEFAULT_COMPRESSION) {
          level = 6;
        }

        if (windowBits < 0) {
          wrap = 0;
          windowBits = -windowBits;
        } else if (windowBits > 15) {
          wrap = 2;
          windowBits -= 16;
        }

        if (memLevel < 1 || memLevel > MAX_MEM_LEVEL || method !== Z_DEFLATED || windowBits < 8 || windowBits > 15 || level < 0 || level > 9 || strategy < 0 || strategy > Z_FIXED) {
          return err(strm, Z_STREAM_ERROR);
        }

        if (windowBits === 8) {
          windowBits = 9;
        }

        var s = new DeflateState();

        strm.state = s;
        s.strm = strm;
        s.wrap = wrap;
        s.gzhead = null;
        s.w_bits = windowBits;
        s.w_size = 1 << s.w_bits;
        s.w_mask = s.w_size - 1;
        s.hash_bits = memLevel + 7;
        s.hash_size = 1 << s.hash_bits;
        s.hash_mask = s.hash_size - 1;
        s.hash_shift = ~~((s.hash_bits + MIN_MATCH - 1) / MIN_MATCH);
        s.window = new utils.Buf8(s.w_size * 2);
        s.head = new utils.Buf16(s.hash_size);
        s.prev = new utils.Buf16(s.w_size);
        s.lit_bufsize = 1 << memLevel + 6;
        s.pending_buf_size = s.lit_bufsize * 4;
        s.pending_buf = new utils.Buf8(s.pending_buf_size);
        s.d_buf = 1 * s.lit_bufsize;
        s.l_buf = (1 + 2) * s.lit_bufsize;
        s.level = level;
        s.strategy = strategy;
        s.method = method;
        
return deflateReset(strm);
      }

      function deflateInit(strm, level) {
        return deflateInit2(strm, level, Z_DEFLATED, MAX_WBITS, DEF_MEM_LEVEL, Z_DEFAULT_STRATEGY);
      }

      function deflate(strm, flush) {
        var old_flush, s;
        var beg, val;

        if (!strm || !strm.state || flush > Z_BLOCK || flush < 0) {
          return strm ? err(strm, Z_STREAM_ERROR) : Z_STREAM_ERROR;
        }

        s = strm.state;

        if (!strm.output || !strm.input && strm.avail_in !== 0 || s.status === FINISH_STATE && flush !== Z_FINISH) {
          return err(strm, strm.avail_out === 0 ? Z_BUF_ERROR : Z_STREAM_ERROR);
        }

        s.strm = strm;
        old_flush = s.last_flush;
        s.last_flush = flush;

        if (s.status === INIT_STATE) {
          if (s.wrap === 2) {
            strm.adler = 0;
            put_byte(s, 31);
            put_byte(s, 139);
            put_byte(s, 8);

            if (!s.gzhead) {
              put_byte(s, 0);
              put_byte(s, 0);
              put_byte(s, 0);
              put_byte(s, 0);
              put_byte(s, 0);
              put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
              put_byte(s, OS_CODE);
              s.status = BUSY_STATE;
            } else {
              put_byte(s, (s.gzhead.text ? 1 : 0) + (s.gzhead.hcrc ? 2 : 0) + (!s.gzhead.extra ? 0 : 4) + (!s.gzhead.name ? 0 : 8) + (!s.gzhead.comment ? 0 : 16));
              put_byte(s, s.gzhead.time & 255);
              put_byte(s, s.gzhead.time >> 8 & 255);
              put_byte(s, s.gzhead.time >> 16 & 255);
              put_byte(s, s.gzhead.time >> 24 & 255);
              put_byte(s, s.level === 9 ? 2 : s.strategy >= Z_HUFFMAN_ONLY || s.level < 2 ? 4 : 0);
              put_byte(s, s.gzhead.os & 255);

              if (s.gzhead.extra && s.gzhead.extra.length) {
                put_byte(s, s.gzhead.extra.length & 255);
                put_byte(s, s.gzhead.extra.length >> 8 & 255);
              }

              if (s.gzhead.hcrc) {
                strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending, 0);
              }

              s.gzindex = 0;
              s.status = EXTRA_STATE;
            }
          } else {
            var header = Z_DEFLATED + (s.w_bits - 8 << 4) << 8;
            var level_flags = -1;

            if (s.strategy >= Z_HUFFMAN_ONLY || s.level < 2) {
              level_flags = 0;
            } else if (s.level < 6) {
              level_flags = 1;
            } else if (s.level === 6) {
              level_flags = 2;
            } else {
              level_flags = 3;
            }

            header |= level_flags << 6;

            if (s.strstart !== 0) {
              header |= PRESET_DICT;
            }

            header += 31 - header % 31;
            s.status = BUSY_STATE;
            putShortMSB(s, header);

            if (s.strstart !== 0) {
              putShortMSB(s, strm.adler >>> 16);
              putShortMSB(s, strm.adler & 65535);
            }

            strm.adler = 1;
          }
        }

        if (s.status === EXTRA_STATE) {
          if (s.gzhead.extra) {
            beg = s.pending;

            while (s.gzindex < (s.gzhead.extra.length & 65535)) {
              if (s.pending === s.pending_buf_size) {
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
                }

                flush_pending(strm);
                beg = s.pending;

                if (s.pending === s.pending_buf_size) {
                  break;
                }
              }

              put_byte(s, s.gzhead.extra[s.gzindex] & 255);
              s.gzindex++;
            }

            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
            }

            if (s.gzindex === s.gzhead.extra.length) {
              s.gzindex = 0;
              s.status = NAME_STATE;
            }
          } else {
            s.status = NAME_STATE;
          }
        }

        if (s.status === NAME_STATE) {
          if (s.gzhead.name) {
            beg = s.pending;

            do {
              if (s.pending === s.pending_buf_size) {
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
                }

                flush_pending(strm);
                beg = s.pending;

                if (s.pending === s.pending_buf_size) {
                  val = 1;
                  break;
                }
              }

              if (s.gzindex < s.gzhead.name.length) {
                val = s.gzhead.name.charCodeAt(s.gzindex++) & 255;
              } else {
                val = 0;
              }

              put_byte(s, val);
            } while (val !== 0);

            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
            }

            if (val === 0) {
              s.gzindex = 0;
              s.status = COMMENT_STATE;
            }
          } else {
            s.status = COMMENT_STATE;
          }
        }

        if (s.status === COMMENT_STATE) {
          if (s.gzhead.comment) {
            beg = s.pending;

            do {
              if (s.pending === s.pending_buf_size) {
                if (s.gzhead.hcrc && s.pending > beg) {
                  strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
                }

                flush_pending(strm);
                beg = s.pending;

                if (s.pending === s.pending_buf_size) {
                  val = 1;
                  break;
                }
              }

              if (s.gzindex < s.gzhead.comment.length) {
                val = s.gzhead.comment.charCodeAt(s.gzindex++) & 255;
              } else {
                val = 0;
              }

              put_byte(s, val);
            } while (val !== 0);

            if (s.gzhead.hcrc && s.pending > beg) {
              strm.adler = (0, _crc["default"])(strm.adler, s.pending_buf, s.pending - beg, beg);
            }

            if (val === 0) {
              s.status = HCRC_STATE;
            }
          } else {
            s.status = HCRC_STATE;
          }
        }

        if (s.status === HCRC_STATE) {
          if (s.gzhead.hcrc) {
            if (s.pending + 2 > s.pending_buf_size) {
              flush_pending(strm);
            }

            if (s.pending + 2 <= s.pending_buf_size) {
              put_byte(s, strm.adler & 255);
              put_byte(s, strm.adler >> 8 & 255);
              strm.adler = 0;
              s.status = BUSY_STATE;
            }
          } else {
            s.status = BUSY_STATE;
          }
        }

        if (s.pending !== 0) {
          flush_pending(strm);

          if (strm.avail_out === 0) {
            s.last_flush = -1;
            
return Z_OK;
          }
        } else if (strm.avail_in === 0 && rank(flush) <= rank(old_flush) && flush !== Z_FINISH) {
          return err(strm, Z_BUF_ERROR);
        }

        if (s.status === FINISH_STATE && strm.avail_in !== 0) {
          return err(strm, Z_BUF_ERROR);
        }

        if (strm.avail_in !== 0 || s.lookahead !== 0 || flush !== Z_NO_FLUSH && s.status !== FINISH_STATE) {
          var bstate = s.strategy === Z_HUFFMAN_ONLY ? deflate_huff(s, flush) : s.strategy === Z_RLE ? deflate_rle(s, flush) : configuration_table[s.level].func(s, flush);

          if (bstate === BS_FINISH_STARTED || bstate === BS_FINISH_DONE) {
            s.status = FINISH_STATE;
          }

          if (bstate === BS_NEED_MORE || bstate === BS_FINISH_STARTED) {
            if (strm.avail_out === 0) {
              s.last_flush = -1;
            }

            
return Z_OK;
          }

          if (bstate === BS_BLOCK_DONE) {
            if (flush === Z_PARTIAL_FLUSH) {
              trees._tr_align(s);
            } else if (flush !== Z_BLOCK) {
              trees._tr_stored_block(s, 0, 0, false);

              if (flush === Z_FULL_FLUSH) {
                zero(s.head);

                if (s.lookahead === 0) {
                  s.strstart = 0;
                  s.block_start = 0;
                  s.insert = 0;
                }
              }
            }

            flush_pending(strm);

            if (strm.avail_out === 0) {
              s.last_flush = -1;
              
return Z_OK;
            }
          }
        }

        if (flush !== Z_FINISH) {
          return Z_OK;
        }

        if (s.wrap <= 0) {
          return Z_STREAM_END;
        }

        if (s.wrap === 2) {
          put_byte(s, strm.adler & 255);
          put_byte(s, strm.adler >> 8 & 255);
          put_byte(s, strm.adler >> 16 & 255);
          put_byte(s, strm.adler >> 24 & 255);
          put_byte(s, strm.total_in & 255);
          put_byte(s, strm.total_in >> 8 & 255);
          put_byte(s, strm.total_in >> 16 & 255);
          put_byte(s, strm.total_in >> 24 & 255);
        } else {
          putShortMSB(s, strm.adler >>> 16);
          putShortMSB(s, strm.adler & 65535);
        }

        flush_pending(strm);

        if (s.wrap > 0) {
          s.wrap = -s.wrap;
        }

        
return s.pending !== 0 ? Z_OK : Z_STREAM_END;
      }

      function deflateEnd(strm) {
        var status;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        status = strm.state.status;

        if (status !== INIT_STATE && status !== EXTRA_STATE && status !== NAME_STATE && status !== COMMENT_STATE && status !== HCRC_STATE && status !== BUSY_STATE && status !== FINISH_STATE) {
          return err(strm, Z_STREAM_ERROR);
        }

        strm.state = null;
        
return status === BUSY_STATE ? err(strm, Z_DATA_ERROR) : Z_OK;
      }

      function deflateSetDictionary(strm, dictionary) {
        var dictLength = dictionary.length;
        var s;
        var str, n;
        var wrap;
        var avail;
        var next;
        var input;
        var tmpDict;

        if (!strm || !strm.state) {
          return Z_STREAM_ERROR;
        }

        s = strm.state;
        wrap = s.wrap;

        if (wrap === 2 || wrap === 1 && s.status !== INIT_STATE || s.lookahead) {
          return Z_STREAM_ERROR;
        }

        if (wrap === 1) {
          strm.adler = (0, _adler["default"])(strm.adler, dictionary, dictLength, 0);
        }

        s.wrap = 0;

        if (dictLength >= s.w_size) {
          if (wrap === 0) {
            zero(s.head);
            s.strstart = 0;
            s.block_start = 0;
            s.insert = 0;
          }

          tmpDict = new utils.Buf8(s.w_size);
          utils.arraySet(tmpDict, dictionary, dictLength - s.w_size, s.w_size, 0);
          dictionary = tmpDict;
          dictLength = s.w_size;
        }

        avail = strm.avail_in;
        next = strm.next_in;
        input = strm.input;
        strm.avail_in = dictLength;
        strm.next_in = 0;
        strm.input = dictionary;
        fill_window(s);

        while (s.lookahead >= MIN_MATCH) {
          str = s.strstart;
          n = s.lookahead - (MIN_MATCH - 1);

          do {
            s.ins_h = (s.ins_h << s.hash_shift ^ s.window[str + MIN_MATCH - 1]) & s.hash_mask;
            s.prev[str & s.w_mask] = s.head[s.ins_h];
            s.head[s.ins_h] = str;
            str++;
          } while (--n);

          s.strstart = str;
          s.lookahead = MIN_MATCH - 1;
          fill_window(s);
        }

        s.strstart += s.lookahead;
        s.block_start = s.strstart;
        s.insert = s.lookahead;
        s.lookahead = 0;
        s.match_length = s.prev_length = MIN_MATCH - 1;
        s.match_available = 0;
        strm.next_in = next;
        strm.input = input;
        strm.avail_in = avail;
        s.wrap = wrap;
        
return Z_OK;
      }

      var deflateInfo = exports.deflateInfo = "pako deflate (from Nodeca project)";
    }
  });

  // node_modules/@novnc/novnc/lib/deflator.js
  var require_deflator = __commonJS({
    "node_modules/@novnc/novnc/lib/deflator.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _deflate2 = require_deflate();
      var _zstream = _interopRequireDefault(require_zstream());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var Deflator = exports["default"] = /* @__PURE__ */ (function() {
        function Deflator2() {
          _classCallCheck(this, Deflator2);
          this.strm = new _zstream["default"]();
          this.chunkSize = 1024 * 10 * 10;
          this.outputBuffer = new Uint8Array(this.chunkSize);
          (0, _deflate2.deflateInit)(this.strm, _deflate2.Z_DEFAULT_COMPRESSION);
        }

        
return _createClass(Deflator2, [{
          key: "deflate",
          value: function deflate(inData) {
            this.strm.input = inData;
            this.strm.avail_in = this.strm.input.length;
            this.strm.next_in = 0;
            this.strm.output = this.outputBuffer;
            this.strm.avail_out = this.chunkSize;
            this.strm.next_out = 0;
            var lastRet = (0, _deflate2.deflate)(this.strm, _deflate2.Z_FULL_FLUSH);
            var outData = new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);

            if (lastRet < 0) {
              throw new Error("zlib deflate failed");
            }

            if (this.strm.avail_in > 0) {
              var chunks = [outData];
              var totalLen = outData.length;

              do {
                this.strm.output = new Uint8Array(this.chunkSize);
                this.strm.next_out = 0;
                this.strm.avail_out = this.chunkSize;
                lastRet = (0, _deflate2.deflate)(this.strm, _deflate2.Z_FULL_FLUSH);

                if (lastRet < 0) {
                  throw new Error("zlib deflate failed");
                }

                var chunk = new Uint8Array(this.strm.output.buffer, 0, this.strm.next_out);

                totalLen += chunk.length;
                chunks.push(chunk);
              } while (this.strm.avail_in > 0);

              var newData = new Uint8Array(totalLen);
              var offset = 0;

              for (var i = 0; i < chunks.length; i++) {
                newData.set(chunks[i], offset);
                offset += chunks[i].length;
              }

              outData = newData;
            }

            this.strm.input = null;
            this.strm.avail_in = 0;
            this.strm.next_in = 0;
            
return outData;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/input/keysym.js
  var require_keysym = __commonJS({
    "node_modules/@novnc/novnc/lib/input/keysym.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _default = exports["default"] = {
        XK_VoidSymbol: 16777215,

        /* Void symbol */
        XK_BackSpace: 65288,

        /* Back space, back char */
        XK_Tab: 65289,
        XK_Linefeed: 65290,

        /* Linefeed, LF */
        XK_Clear: 65291,
        XK_Return: 65293,

        /* Return, enter */
        XK_Pause: 65299,

        /* Pause, hold */
        XK_Scroll_Lock: 65300,
        XK_Sys_Req: 65301,
        XK_Escape: 65307,
        XK_Delete: 65535,

        /* Delete, rubout */
        /* International & multi-key character composition */
        XK_Multi_key: 65312,

        /* Multi-key character compose */
        XK_Codeinput: 65335,
        XK_SingleCandidate: 65340,
        XK_MultipleCandidate: 65341,
        XK_PreviousCandidate: 65342,

        /* Japanese keyboard support */
        XK_Kanji: 65313,

        /* Kanji, Kanji convert */
        XK_Muhenkan: 65314,

        /* Cancel Conversion */
        XK_Henkan_Mode: 65315,

        /* Start/Stop Conversion */
        XK_Henkan: 65315,

        /* Alias for Henkan_Mode */
        XK_Romaji: 65316,

        /* to Romaji */
        XK_Hiragana: 65317,

        /* to Hiragana */
        XK_Katakana: 65318,

        /* to Katakana */
        XK_Hiragana_Katakana: 65319,

        /* Hiragana/Katakana toggle */
        XK_Zenkaku: 65320,

        /* to Zenkaku */
        XK_Hankaku: 65321,

        /* to Hankaku */
        XK_Zenkaku_Hankaku: 65322,

        /* Zenkaku/Hankaku toggle */
        XK_Touroku: 65323,

        /* Add to Dictionary */
        XK_Massyo: 65324,

        /* Delete from Dictionary */
        XK_Kana_Lock: 65325,

        /* Kana Lock */
        XK_Kana_Shift: 65326,

        /* Kana Shift */
        XK_Eisu_Shift: 65327,

        /* Alphanumeric Shift */
        XK_Eisu_toggle: 65328,

        /* Alphanumeric toggle */
        XK_Kanji_Bangou: 65335,

        /* Codeinput */
        XK_Zen_Koho: 65341,

        /* Multiple/All Candidate(s) */
        XK_Mae_Koho: 65342,

        /* Previous Candidate */
        /* Cursor control & motion */
        XK_Home: 65360,
        XK_Left: 65361,

        /* Move left, left arrow */
        XK_Up: 65362,

        /* Move up, up arrow */
        XK_Right: 65363,

        /* Move right, right arrow */
        XK_Down: 65364,

        /* Move down, down arrow */
        XK_Prior: 65365,

        /* Prior, previous */
        XK_Page_Up: 65365,
        XK_Next: 65366,

        /* Next */
        XK_Page_Down: 65366,
        XK_End: 65367,

        /* EOL */
        XK_Begin: 65368,

        /* BOL */
        /* Misc functions */
        XK_Select: 65376,

        /* Select, mark */
        XK_Print: 65377,
        XK_Execute: 65378,

        /* Execute, run, do */
        XK_Insert: 65379,

        /* Insert, insert here */
        XK_Undo: 65381,
        XK_Redo: 65382,

        /* Redo, again */
        XK_Menu: 65383,
        XK_Find: 65384,

        /* Find, search */
        XK_Cancel: 65385,

        /* Cancel, stop, abort, exit */
        XK_Help: 65386,

        /* Help */
        XK_Break: 65387,
        XK_Mode_switch: 65406,

        /* Character set switch */
        XK_script_switch: 65406,

        /* Alias for mode_switch */
        XK_Num_Lock: 65407,

        /* Keypad functions, keypad numbers cleverly chosen to map to ASCII */
        XK_KP_Space: 65408,

        /* Space */
        XK_KP_Tab: 65417,
        XK_KP_Enter: 65421,

        /* Enter */
        XK_KP_F1: 65425,

        /* PF1, KP_A, ... */
        XK_KP_F2: 65426,
        XK_KP_F3: 65427,
        XK_KP_F4: 65428,
        XK_KP_Home: 65429,
        XK_KP_Left: 65430,
        XK_KP_Up: 65431,
        XK_KP_Right: 65432,
        XK_KP_Down: 65433,
        XK_KP_Prior: 65434,
        XK_KP_Page_Up: 65434,
        XK_KP_Next: 65435,
        XK_KP_Page_Down: 65435,
        XK_KP_End: 65436,
        XK_KP_Begin: 65437,
        XK_KP_Insert: 65438,
        XK_KP_Delete: 65439,
        XK_KP_Equal: 65469,

        /* Equals */
        XK_KP_Multiply: 65450,
        XK_KP_Add: 65451,
        XK_KP_Separator: 65452,

        /* Separator, often comma */
        XK_KP_Subtract: 65453,
        XK_KP_Decimal: 65454,
        XK_KP_Divide: 65455,
        XK_KP_0: 65456,
        XK_KP_1: 65457,
        XK_KP_2: 65458,
        XK_KP_3: 65459,
        XK_KP_4: 65460,
        XK_KP_5: 65461,
        XK_KP_6: 65462,
        XK_KP_7: 65463,
        XK_KP_8: 65464,
        XK_KP_9: 65465,

        /*
         * Auxiliary functions; note the duplicate definitions for left and right
         * function keys;  Sun keyboards and a few other manufacturers have such
         * function key groups on the left and/or right sides of the keyboard.
         * We've not found a keyboard with more than 35 function keys total.
         */
        XK_F1: 65470,
        XK_F2: 65471,
        XK_F3: 65472,
        XK_F4: 65473,
        XK_F5: 65474,
        XK_F6: 65475,
        XK_F7: 65476,
        XK_F8: 65477,
        XK_F9: 65478,
        XK_F10: 65479,
        XK_F11: 65480,
        XK_L1: 65480,
        XK_F12: 65481,
        XK_L2: 65481,
        XK_F13: 65482,
        XK_L3: 65482,
        XK_F14: 65483,
        XK_L4: 65483,
        XK_F15: 65484,
        XK_L5: 65484,
        XK_F16: 65485,
        XK_L6: 65485,
        XK_F17: 65486,
        XK_L7: 65486,
        XK_F18: 65487,
        XK_L8: 65487,
        XK_F19: 65488,
        XK_L9: 65488,
        XK_F20: 65489,
        XK_L10: 65489,
        XK_F21: 65490,
        XK_R1: 65490,
        XK_F22: 65491,
        XK_R2: 65491,
        XK_F23: 65492,
        XK_R3: 65492,
        XK_F24: 65493,
        XK_R4: 65493,
        XK_F25: 65494,
        XK_R5: 65494,
        XK_F26: 65495,
        XK_R6: 65495,
        XK_F27: 65496,
        XK_R7: 65496,
        XK_F28: 65497,
        XK_R8: 65497,
        XK_F29: 65498,
        XK_R9: 65498,
        XK_F30: 65499,
        XK_R10: 65499,
        XK_F31: 65500,
        XK_R11: 65500,
        XK_F32: 65501,
        XK_R12: 65501,
        XK_F33: 65502,
        XK_R13: 65502,
        XK_F34: 65503,
        XK_R14: 65503,
        XK_F35: 65504,
        XK_R15: 65504,

        /* Modifiers */
        XK_Shift_L: 65505,

        /* Left shift */
        XK_Shift_R: 65506,

        /* Right shift */
        XK_Control_L: 65507,

        /* Left control */
        XK_Control_R: 65508,

        /* Right control */
        XK_Caps_Lock: 65509,

        /* Caps lock */
        XK_Shift_Lock: 65510,

        /* Shift lock */
        XK_Meta_L: 65511,

        /* Left meta */
        XK_Meta_R: 65512,

        /* Right meta */
        XK_Alt_L: 65513,

        /* Left alt */
        XK_Alt_R: 65514,

        /* Right alt */
        XK_Super_L: 65515,

        /* Left super */
        XK_Super_R: 65516,

        /* Right super */
        XK_Hyper_L: 65517,

        /* Left hyper */
        XK_Hyper_R: 65518,

        /* Right hyper */
        /*
         * Keyboard (XKB) Extension function and modifier keys
         * (from Appendix C of "The X Keyboard Extension: Protocol Specification")
         * Byte 3 = 0xfe
         */
        XK_ISO_Level3_Shift: 65027,

        /* AltGr */
        XK_ISO_Next_Group: 65032,
        XK_ISO_Prev_Group: 65034,
        XK_ISO_First_Group: 65036,
        XK_ISO_Last_Group: 65038,

        /*
         * Latin 1
         * (ISO/IEC 8859-1: Unicode U+0020..U+00FF)
         * Byte 3: 0
         */
        XK_space: 32,

        /* U+0020 SPACE */
        XK_exclam: 33,

        /* U+0021 EXCLAMATION MARK */
        XK_quotedbl: 34,

        /* U+0022 QUOTATION MARK */
        XK_numbersign: 35,

        /* U+0023 NUMBER SIGN */
        XK_dollar: 36,

        /* U+0024 DOLLAR SIGN */
        XK_percent: 37,

        /* U+0025 PERCENT SIGN */
        XK_ampersand: 38,

        /* U+0026 AMPERSAND */
        XK_apostrophe: 39,

        /* U+0027 APOSTROPHE */
        XK_quoteright: 39,

        /* deprecated */
        XK_parenleft: 40,

        /* U+0028 LEFT PARENTHESIS */
        XK_parenright: 41,

        /* U+0029 RIGHT PARENTHESIS */
        XK_asterisk: 42,

        /* U+002A ASTERISK */
        XK_plus: 43,

        /* U+002B PLUS SIGN */
        XK_comma: 44,

        /* U+002C COMMA */
        XK_minus: 45,

        /* U+002D HYPHEN-MINUS */
        XK_period: 46,

        /* U+002E FULL STOP */
        XK_slash: 47,

        /* U+002F SOLIDUS */
        XK_0: 48,

        /* U+0030 DIGIT ZERO */
        XK_1: 49,

        /* U+0031 DIGIT ONE */
        XK_2: 50,

        /* U+0032 DIGIT TWO */
        XK_3: 51,

        /* U+0033 DIGIT THREE */
        XK_4: 52,

        /* U+0034 DIGIT FOUR */
        XK_5: 53,

        /* U+0035 DIGIT FIVE */
        XK_6: 54,

        /* U+0036 DIGIT SIX */
        XK_7: 55,

        /* U+0037 DIGIT SEVEN */
        XK_8: 56,

        /* U+0038 DIGIT EIGHT */
        XK_9: 57,

        /* U+0039 DIGIT NINE */
        XK_colon: 58,

        /* U+003A COLON */
        XK_semicolon: 59,

        /* U+003B SEMICOLON */
        XK_less: 60,

        /* U+003C LESS-THAN SIGN */
        XK_equal: 61,

        /* U+003D EQUALS SIGN */
        XK_greater: 62,

        /* U+003E GREATER-THAN SIGN */
        XK_question: 63,

        /* U+003F QUESTION MARK */
        XK_at: 64,

        /* U+0040 COMMERCIAL AT */
        XK_A: 65,

        /* U+0041 LATIN CAPITAL LETTER A */
        XK_B: 66,

        /* U+0042 LATIN CAPITAL LETTER B */
        XK_C: 67,

        /* U+0043 LATIN CAPITAL LETTER C */
        XK_D: 68,

        /* U+0044 LATIN CAPITAL LETTER D */
        XK_E: 69,

        /* U+0045 LATIN CAPITAL LETTER E */
        XK_F: 70,

        /* U+0046 LATIN CAPITAL LETTER F */
        XK_G: 71,

        /* U+0047 LATIN CAPITAL LETTER G */
        XK_H: 72,

        /* U+0048 LATIN CAPITAL LETTER H */
        XK_I: 73,

        /* U+0049 LATIN CAPITAL LETTER I */
        XK_J: 74,

        /* U+004A LATIN CAPITAL LETTER J */
        XK_K: 75,

        /* U+004B LATIN CAPITAL LETTER K */
        XK_L: 76,

        /* U+004C LATIN CAPITAL LETTER L */
        XK_M: 77,

        /* U+004D LATIN CAPITAL LETTER M */
        XK_N: 78,

        /* U+004E LATIN CAPITAL LETTER N */
        XK_O: 79,

        /* U+004F LATIN CAPITAL LETTER O */
        XK_P: 80,

        /* U+0050 LATIN CAPITAL LETTER P */
        XK_Q: 81,

        /* U+0051 LATIN CAPITAL LETTER Q */
        XK_R: 82,

        /* U+0052 LATIN CAPITAL LETTER R */
        XK_S: 83,

        /* U+0053 LATIN CAPITAL LETTER S */
        XK_T: 84,

        /* U+0054 LATIN CAPITAL LETTER T */
        XK_U: 85,

        /* U+0055 LATIN CAPITAL LETTER U */
        XK_V: 86,

        /* U+0056 LATIN CAPITAL LETTER V */
        XK_W: 87,

        /* U+0057 LATIN CAPITAL LETTER W */
        XK_X: 88,

        /* U+0058 LATIN CAPITAL LETTER X */
        XK_Y: 89,

        /* U+0059 LATIN CAPITAL LETTER Y */
        XK_Z: 90,

        /* U+005A LATIN CAPITAL LETTER Z */
        XK_bracketleft: 91,

        /* U+005B LEFT SQUARE BRACKET */
        XK_backslash: 92,

        /* U+005C REVERSE SOLIDUS */
        XK_bracketright: 93,

        /* U+005D RIGHT SQUARE BRACKET */
        XK_asciicircum: 94,

        /* U+005E CIRCUMFLEX ACCENT */
        XK_underscore: 95,

        /* U+005F LOW LINE */
        XK_grave: 96,

        /* U+0060 GRAVE ACCENT */
        XK_quoteleft: 96,

        /* deprecated */
        XK_a: 97,

        /* U+0061 LATIN SMALL LETTER A */
        XK_b: 98,

        /* U+0062 LATIN SMALL LETTER B */
        XK_c: 99,

        /* U+0063 LATIN SMALL LETTER C */
        XK_d: 100,

        /* U+0064 LATIN SMALL LETTER D */
        XK_e: 101,

        /* U+0065 LATIN SMALL LETTER E */
        XK_f: 102,

        /* U+0066 LATIN SMALL LETTER F */
        XK_g: 103,

        /* U+0067 LATIN SMALL LETTER G */
        XK_h: 104,

        /* U+0068 LATIN SMALL LETTER H */
        XK_i: 105,

        /* U+0069 LATIN SMALL LETTER I */
        XK_j: 106,

        /* U+006A LATIN SMALL LETTER J */
        XK_k: 107,

        /* U+006B LATIN SMALL LETTER K */
        XK_l: 108,

        /* U+006C LATIN SMALL LETTER L */
        XK_m: 109,

        /* U+006D LATIN SMALL LETTER M */
        XK_n: 110,

        /* U+006E LATIN SMALL LETTER N */
        XK_o: 111,

        /* U+006F LATIN SMALL LETTER O */
        XK_p: 112,

        /* U+0070 LATIN SMALL LETTER P */
        XK_q: 113,

        /* U+0071 LATIN SMALL LETTER Q */
        XK_r: 114,

        /* U+0072 LATIN SMALL LETTER R */
        XK_s: 115,

        /* U+0073 LATIN SMALL LETTER S */
        XK_t: 116,

        /* U+0074 LATIN SMALL LETTER T */
        XK_u: 117,

        /* U+0075 LATIN SMALL LETTER U */
        XK_v: 118,

        /* U+0076 LATIN SMALL LETTER V */
        XK_w: 119,

        /* U+0077 LATIN SMALL LETTER W */
        XK_x: 120,

        /* U+0078 LATIN SMALL LETTER X */
        XK_y: 121,

        /* U+0079 LATIN SMALL LETTER Y */
        XK_z: 122,

        /* U+007A LATIN SMALL LETTER Z */
        XK_braceleft: 123,

        /* U+007B LEFT CURLY BRACKET */
        XK_bar: 124,

        /* U+007C VERTICAL LINE */
        XK_braceright: 125,

        /* U+007D RIGHT CURLY BRACKET */
        XK_asciitilde: 126,

        /* U+007E TILDE */
        XK_nobreakspace: 160,

        /* U+00A0 NO-BREAK SPACE */
        XK_exclamdown: 161,

        /* U+00A1 INVERTED EXCLAMATION MARK */
        XK_cent: 162,

        /* U+00A2 CENT SIGN */
        XK_sterling: 163,

        /* U+00A3 POUND SIGN */
        XK_currency: 164,

        /* U+00A4 CURRENCY SIGN */
        XK_yen: 165,

        /* U+00A5 YEN SIGN */
        XK_brokenbar: 166,

        /* U+00A6 BROKEN BAR */
        XK_section: 167,

        /* U+00A7 SECTION SIGN */
        XK_diaeresis: 168,

        /* U+00A8 DIAERESIS */
        XK_copyright: 169,

        /* U+00A9 COPYRIGHT SIGN */
        XK_ordfeminine: 170,

        /* U+00AA FEMININE ORDINAL INDICATOR */
        XK_guillemotleft: 171,

        /* U+00AB LEFT-POINTING DOUBLE ANGLE QUOTATION MARK */
        XK_notsign: 172,

        /* U+00AC NOT SIGN */
        XK_hyphen: 173,

        /* U+00AD SOFT HYPHEN */
        XK_registered: 174,

        /* U+00AE REGISTERED SIGN */
        XK_macron: 175,

        /* U+00AF MACRON */
        XK_degree: 176,

        /* U+00B0 DEGREE SIGN */
        XK_plusminus: 177,

        /* U+00B1 PLUS-MINUS SIGN */
        XK_twosuperior: 178,

        /* U+00B2 SUPERSCRIPT TWO */
        XK_threesuperior: 179,

        /* U+00B3 SUPERSCRIPT THREE */
        XK_acute: 180,

        /* U+00B4 ACUTE ACCENT */
        XK_mu: 181,

        /* U+00B5 MICRO SIGN */
        XK_paragraph: 182,

        /* U+00B6 PILCROW SIGN */
        XK_periodcentered: 183,

        /* U+00B7 MIDDLE DOT */
        XK_cedilla: 184,

        /* U+00B8 CEDILLA */
        XK_onesuperior: 185,

        /* U+00B9 SUPERSCRIPT ONE */
        XK_masculine: 186,

        /* U+00BA MASCULINE ORDINAL INDICATOR */
        XK_guillemotright: 187,

        /* U+00BB RIGHT-POINTING DOUBLE ANGLE QUOTATION MARK */
        XK_onequarter: 188,

        /* U+00BC VULGAR FRACTION ONE QUARTER */
        XK_onehalf: 189,

        /* U+00BD VULGAR FRACTION ONE HALF */
        XK_threequarters: 190,

        /* U+00BE VULGAR FRACTION THREE QUARTERS */
        XK_questiondown: 191,

        /* U+00BF INVERTED QUESTION MARK */
        XK_Agrave: 192,

        /* U+00C0 LATIN CAPITAL LETTER A WITH GRAVE */
        XK_Aacute: 193,

        /* U+00C1 LATIN CAPITAL LETTER A WITH ACUTE */
        XK_Acircumflex: 194,

        /* U+00C2 LATIN CAPITAL LETTER A WITH CIRCUMFLEX */
        XK_Atilde: 195,

        /* U+00C3 LATIN CAPITAL LETTER A WITH TILDE */
        XK_Adiaeresis: 196,

        /* U+00C4 LATIN CAPITAL LETTER A WITH DIAERESIS */
        XK_Aring: 197,

        /* U+00C5 LATIN CAPITAL LETTER A WITH RING ABOVE */
        XK_AE: 198,

        /* U+00C6 LATIN CAPITAL LETTER AE */
        XK_Ccedilla: 199,

        /* U+00C7 LATIN CAPITAL LETTER C WITH CEDILLA */
        XK_Egrave: 200,

        /* U+00C8 LATIN CAPITAL LETTER E WITH GRAVE */
        XK_Eacute: 201,

        /* U+00C9 LATIN CAPITAL LETTER E WITH ACUTE */
        XK_Ecircumflex: 202,

        /* U+00CA LATIN CAPITAL LETTER E WITH CIRCUMFLEX */
        XK_Ediaeresis: 203,

        /* U+00CB LATIN CAPITAL LETTER E WITH DIAERESIS */
        XK_Igrave: 204,

        /* U+00CC LATIN CAPITAL LETTER I WITH GRAVE */
        XK_Iacute: 205,

        /* U+00CD LATIN CAPITAL LETTER I WITH ACUTE */
        XK_Icircumflex: 206,

        /* U+00CE LATIN CAPITAL LETTER I WITH CIRCUMFLEX */
        XK_Idiaeresis: 207,

        /* U+00CF LATIN CAPITAL LETTER I WITH DIAERESIS */
        XK_ETH: 208,

        /* U+00D0 LATIN CAPITAL LETTER ETH */
        XK_Eth: 208,

        /* deprecated */
        XK_Ntilde: 209,

        /* U+00D1 LATIN CAPITAL LETTER N WITH TILDE */
        XK_Ograve: 210,

        /* U+00D2 LATIN CAPITAL LETTER O WITH GRAVE */
        XK_Oacute: 211,

        /* U+00D3 LATIN CAPITAL LETTER O WITH ACUTE */
        XK_Ocircumflex: 212,

        /* U+00D4 LATIN CAPITAL LETTER O WITH CIRCUMFLEX */
        XK_Otilde: 213,

        /* U+00D5 LATIN CAPITAL LETTER O WITH TILDE */
        XK_Odiaeresis: 214,

        /* U+00D6 LATIN CAPITAL LETTER O WITH DIAERESIS */
        XK_multiply: 215,

        /* U+00D7 MULTIPLICATION SIGN */
        XK_Oslash: 216,

        /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
        XK_Ooblique: 216,

        /* U+00D8 LATIN CAPITAL LETTER O WITH STROKE */
        XK_Ugrave: 217,

        /* U+00D9 LATIN CAPITAL LETTER U WITH GRAVE */
        XK_Uacute: 218,

        /* U+00DA LATIN CAPITAL LETTER U WITH ACUTE */
        XK_Ucircumflex: 219,

        /* U+00DB LATIN CAPITAL LETTER U WITH CIRCUMFLEX */
        XK_Udiaeresis: 220,

        /* U+00DC LATIN CAPITAL LETTER U WITH DIAERESIS */
        XK_Yacute: 221,

        /* U+00DD LATIN CAPITAL LETTER Y WITH ACUTE */
        XK_THORN: 222,

        /* U+00DE LATIN CAPITAL LETTER THORN */
        XK_Thorn: 222,

        /* deprecated */
        XK_ssharp: 223,

        /* U+00DF LATIN SMALL LETTER SHARP S */
        XK_agrave: 224,

        /* U+00E0 LATIN SMALL LETTER A WITH GRAVE */
        XK_aacute: 225,

        /* U+00E1 LATIN SMALL LETTER A WITH ACUTE */
        XK_acircumflex: 226,

        /* U+00E2 LATIN SMALL LETTER A WITH CIRCUMFLEX */
        XK_atilde: 227,

        /* U+00E3 LATIN SMALL LETTER A WITH TILDE */
        XK_adiaeresis: 228,

        /* U+00E4 LATIN SMALL LETTER A WITH DIAERESIS */
        XK_aring: 229,

        /* U+00E5 LATIN SMALL LETTER A WITH RING ABOVE */
        XK_ae: 230,

        /* U+00E6 LATIN SMALL LETTER AE */
        XK_ccedilla: 231,

        /* U+00E7 LATIN SMALL LETTER C WITH CEDILLA */
        XK_egrave: 232,

        /* U+00E8 LATIN SMALL LETTER E WITH GRAVE */
        XK_eacute: 233,

        /* U+00E9 LATIN SMALL LETTER E WITH ACUTE */
        XK_ecircumflex: 234,

        /* U+00EA LATIN SMALL LETTER E WITH CIRCUMFLEX */
        XK_ediaeresis: 235,

        /* U+00EB LATIN SMALL LETTER E WITH DIAERESIS */
        XK_igrave: 236,

        /* U+00EC LATIN SMALL LETTER I WITH GRAVE */
        XK_iacute: 237,

        /* U+00ED LATIN SMALL LETTER I WITH ACUTE */
        XK_icircumflex: 238,

        /* U+00EE LATIN SMALL LETTER I WITH CIRCUMFLEX */
        XK_idiaeresis: 239,

        /* U+00EF LATIN SMALL LETTER I WITH DIAERESIS */
        XK_eth: 240,

        /* U+00F0 LATIN SMALL LETTER ETH */
        XK_ntilde: 241,

        /* U+00F1 LATIN SMALL LETTER N WITH TILDE */
        XK_ograve: 242,

        /* U+00F2 LATIN SMALL LETTER O WITH GRAVE */
        XK_oacute: 243,

        /* U+00F3 LATIN SMALL LETTER O WITH ACUTE */
        XK_ocircumflex: 244,

        /* U+00F4 LATIN SMALL LETTER O WITH CIRCUMFLEX */
        XK_otilde: 245,

        /* U+00F5 LATIN SMALL LETTER O WITH TILDE */
        XK_odiaeresis: 246,

        /* U+00F6 LATIN SMALL LETTER O WITH DIAERESIS */
        XK_division: 247,

        /* U+00F7 DIVISION SIGN */
        XK_oslash: 248,

        /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
        XK_ooblique: 248,

        /* U+00F8 LATIN SMALL LETTER O WITH STROKE */
        XK_ugrave: 249,

        /* U+00F9 LATIN SMALL LETTER U WITH GRAVE */
        XK_uacute: 250,

        /* U+00FA LATIN SMALL LETTER U WITH ACUTE */
        XK_ucircumflex: 251,

        /* U+00FB LATIN SMALL LETTER U WITH CIRCUMFLEX */
        XK_udiaeresis: 252,

        /* U+00FC LATIN SMALL LETTER U WITH DIAERESIS */
        XK_yacute: 253,

        /* U+00FD LATIN SMALL LETTER Y WITH ACUTE */
        XK_thorn: 254,

        /* U+00FE LATIN SMALL LETTER THORN */
        XK_ydiaeresis: 255,

        /* U+00FF LATIN SMALL LETTER Y WITH DIAERESIS */
        /*
         * Korean
         * Byte 3 = 0x0e
         */
        XK_Hangul: 65329,

        /* Hangul start/stop(toggle) */
        XK_Hangul_Hanja: 65332,

        /* Start Hangul->Hanja Conversion */
        XK_Hangul_Jeonja: 65336,

        /* Jeonja mode */
        /*
         * XFree86 vendor specific keysyms.
         *
         * The XFree86 keysym range is 0x10080001 - 0x1008FFFF.
         */
        XF86XK_ModeLock: 269025025,
        XF86XK_MonBrightnessUp: 269025026,
        XF86XK_MonBrightnessDown: 269025027,
        XF86XK_KbdLightOnOff: 269025028,
        XF86XK_KbdBrightnessUp: 269025029,
        XF86XK_KbdBrightnessDown: 269025030,
        XF86XK_Standby: 269025040,
        XF86XK_AudioLowerVolume: 269025041,
        XF86XK_AudioMute: 269025042,
        XF86XK_AudioRaiseVolume: 269025043,
        XF86XK_AudioPlay: 269025044,
        XF86XK_AudioStop: 269025045,
        XF86XK_AudioPrev: 269025046,
        XF86XK_AudioNext: 269025047,
        XF86XK_HomePage: 269025048,
        XF86XK_Mail: 269025049,
        XF86XK_Start: 269025050,
        XF86XK_Search: 269025051,
        XF86XK_AudioRecord: 269025052,
        XF86XK_Calculator: 269025053,
        XF86XK_Memo: 269025054,
        XF86XK_ToDoList: 269025055,
        XF86XK_Calendar: 269025056,
        XF86XK_PowerDown: 269025057,
        XF86XK_ContrastAdjust: 269025058,
        XF86XK_RockerUp: 269025059,
        XF86XK_RockerDown: 269025060,
        XF86XK_RockerEnter: 269025061,
        XF86XK_Back: 269025062,
        XF86XK_Forward: 269025063,
        XF86XK_Stop: 269025064,
        XF86XK_Refresh: 269025065,
        XF86XK_PowerOff: 269025066,
        XF86XK_WakeUp: 269025067,
        XF86XK_Eject: 269025068,
        XF86XK_ScreenSaver: 269025069,
        XF86XK_WWW: 269025070,
        XF86XK_Sleep: 269025071,
        XF86XK_Favorites: 269025072,
        XF86XK_AudioPause: 269025073,
        XF86XK_AudioMedia: 269025074,
        XF86XK_MyComputer: 269025075,
        XF86XK_VendorHome: 269025076,
        XF86XK_LightBulb: 269025077,
        XF86XK_Shop: 269025078,
        XF86XK_History: 269025079,
        XF86XK_OpenURL: 269025080,
        XF86XK_AddFavorite: 269025081,
        XF86XK_HotLinks: 269025082,
        XF86XK_BrightnessAdjust: 269025083,
        XF86XK_Finance: 269025084,
        XF86XK_Community: 269025085,
        XF86XK_AudioRewind: 269025086,
        XF86XK_BackForward: 269025087,
        XF86XK_Launch0: 269025088,
        XF86XK_Launch1: 269025089,
        XF86XK_Launch2: 269025090,
        XF86XK_Launch3: 269025091,
        XF86XK_Launch4: 269025092,
        XF86XK_Launch5: 269025093,
        XF86XK_Launch6: 269025094,
        XF86XK_Launch7: 269025095,
        XF86XK_Launch8: 269025096,
        XF86XK_Launch9: 269025097,
        XF86XK_LaunchA: 269025098,
        XF86XK_LaunchB: 269025099,
        XF86XK_LaunchC: 269025100,
        XF86XK_LaunchD: 269025101,
        XF86XK_LaunchE: 269025102,
        XF86XK_LaunchF: 269025103,
        XF86XK_ApplicationLeft: 269025104,
        XF86XK_ApplicationRight: 269025105,
        XF86XK_Book: 269025106,
        XF86XK_CD: 269025107,
        XF86XK_Calculater: 269025108,
        XF86XK_Clear: 269025109,
        XF86XK_Close: 269025110,
        XF86XK_Copy: 269025111,
        XF86XK_Cut: 269025112,
        XF86XK_Display: 269025113,
        XF86XK_DOS: 269025114,
        XF86XK_Documents: 269025115,
        XF86XK_Excel: 269025116,
        XF86XK_Explorer: 269025117,
        XF86XK_Game: 269025118,
        XF86XK_Go: 269025119,
        XF86XK_iTouch: 269025120,
        XF86XK_LogOff: 269025121,
        XF86XK_Market: 269025122,
        XF86XK_Meeting: 269025123,
        XF86XK_MenuKB: 269025125,
        XF86XK_MenuPB: 269025126,
        XF86XK_MySites: 269025127,
        XF86XK_New: 269025128,
        XF86XK_News: 269025129,
        XF86XK_OfficeHome: 269025130,
        XF86XK_Open: 269025131,
        XF86XK_Option: 269025132,
        XF86XK_Paste: 269025133,
        XF86XK_Phone: 269025134,
        XF86XK_Q: 269025136,
        XF86XK_Reply: 269025138,
        XF86XK_Reload: 269025139,
        XF86XK_RotateWindows: 269025140,
        XF86XK_RotationPB: 269025141,
        XF86XK_RotationKB: 269025142,
        XF86XK_Save: 269025143,
        XF86XK_ScrollUp: 269025144,
        XF86XK_ScrollDown: 269025145,
        XF86XK_ScrollClick: 269025146,
        XF86XK_Send: 269025147,
        XF86XK_Spell: 269025148,
        XF86XK_SplitScreen: 269025149,
        XF86XK_Support: 269025150,
        XF86XK_TaskPane: 269025151,
        XF86XK_Terminal: 269025152,
        XF86XK_Tools: 269025153,
        XF86XK_Travel: 269025154,
        XF86XK_UserPB: 269025156,
        XF86XK_User1KB: 269025157,
        XF86XK_User2KB: 269025158,
        XF86XK_Video: 269025159,
        XF86XK_WheelButton: 269025160,
        XF86XK_Word: 269025161,
        XF86XK_Xfer: 269025162,
        XF86XK_ZoomIn: 269025163,
        XF86XK_ZoomOut: 269025164,
        XF86XK_Away: 269025165,
        XF86XK_Messenger: 269025166,
        XF86XK_WebCam: 269025167,
        XF86XK_MailForward: 269025168,
        XF86XK_Pictures: 269025169,
        XF86XK_Music: 269025170,
        XF86XK_Battery: 269025171,
        XF86XK_Bluetooth: 269025172,
        XF86XK_WLAN: 269025173,
        XF86XK_UWB: 269025174,
        XF86XK_AudioForward: 269025175,
        XF86XK_AudioRepeat: 269025176,
        XF86XK_AudioRandomPlay: 269025177,
        XF86XK_Subtitle: 269025178,
        XF86XK_AudioCycleTrack: 269025179,
        XF86XK_CycleAngle: 269025180,
        XF86XK_FrameBack: 269025181,
        XF86XK_FrameForward: 269025182,
        XF86XK_Time: 269025183,
        XF86XK_Select: 269025184,
        XF86XK_View: 269025185,
        XF86XK_TopMenu: 269025186,
        XF86XK_Red: 269025187,
        XF86XK_Green: 269025188,
        XF86XK_Yellow: 269025189,
        XF86XK_Blue: 269025190,
        XF86XK_Suspend: 269025191,
        XF86XK_Hibernate: 269025192,
        XF86XK_TouchpadToggle: 269025193,
        XF86XK_TouchpadOn: 269025200,
        XF86XK_TouchpadOff: 269025201,
        XF86XK_AudioMicMute: 269025202,
        XF86XK_Switch_VT_1: 269024769,
        XF86XK_Switch_VT_2: 269024770,
        XF86XK_Switch_VT_3: 269024771,
        XF86XK_Switch_VT_4: 269024772,
        XF86XK_Switch_VT_5: 269024773,
        XF86XK_Switch_VT_6: 269024774,
        XF86XK_Switch_VT_7: 269024775,
        XF86XK_Switch_VT_8: 269024776,
        XF86XK_Switch_VT_9: 269024777,
        XF86XK_Switch_VT_10: 269024778,
        XF86XK_Switch_VT_11: 269024779,
        XF86XK_Switch_VT_12: 269024780,
        XF86XK_Ungrab: 269024800,
        XF86XK_ClearGrab: 269024801,
        XF86XK_Next_VMode: 269024802,
        XF86XK_Prev_VMode: 269024803,
        XF86XK_LogWindowTree: 269024804,
        XF86XK_LogGrabInfo: 269024805
      };
    }
  });

  // node_modules/@novnc/novnc/lib/input/keysymdef.js
  var require_keysymdef = __commonJS({
    "node_modules/@novnc/novnc/lib/input/keysymdef.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var codepoints = {
        256: 960,

        // XK_Amacron
        257: 992,

        // XK_amacron
        258: 451,

        // XK_Abreve
        259: 483,

        // XK_abreve
        260: 417,

        // XK_Aogonek
        261: 433,

        // XK_aogonek
        262: 454,

        // XK_Cacute
        263: 486,

        // XK_cacute
        264: 710,

        // XK_Ccircumflex
        265: 742,

        // XK_ccircumflex
        266: 709,

        // XK_Cabovedot
        267: 741,

        // XK_cabovedot
        268: 456,

        // XK_Ccaron
        269: 488,

        // XK_ccaron
        270: 463,

        // XK_Dcaron
        271: 495,

        // XK_dcaron
        272: 464,

        // XK_Dstroke
        273: 496,

        // XK_dstroke
        274: 938,

        // XK_Emacron
        275: 954,

        // XK_emacron
        278: 972,

        // XK_Eabovedot
        279: 1004,

        // XK_eabovedot
        280: 458,

        // XK_Eogonek
        281: 490,

        // XK_eogonek
        282: 460,

        // XK_Ecaron
        283: 492,

        // XK_ecaron
        284: 728,

        // XK_Gcircumflex
        285: 760,

        // XK_gcircumflex
        286: 683,

        // XK_Gbreve
        287: 699,

        // XK_gbreve
        288: 725,

        // XK_Gabovedot
        289: 757,

        // XK_gabovedot
        290: 939,

        // XK_Gcedilla
        291: 955,

        // XK_gcedilla
        292: 678,

        // XK_Hcircumflex
        293: 694,

        // XK_hcircumflex
        294: 673,

        // XK_Hstroke
        295: 689,

        // XK_hstroke
        296: 933,

        // XK_Itilde
        297: 949,

        // XK_itilde
        298: 975,

        // XK_Imacron
        299: 1007,

        // XK_imacron
        302: 967,

        // XK_Iogonek
        303: 999,

        // XK_iogonek
        304: 681,

        // XK_Iabovedot
        305: 697,

        // XK_idotless
        308: 684,

        // XK_Jcircumflex
        309: 700,

        // XK_jcircumflex
        310: 979,

        // XK_Kcedilla
        311: 1011,

        // XK_kcedilla
        312: 930,

        // XK_kra
        313: 453,

        // XK_Lacute
        314: 485,

        // XK_lacute
        315: 934,

        // XK_Lcedilla
        316: 950,

        // XK_lcedilla
        317: 421,

        // XK_Lcaron
        318: 437,

        // XK_lcaron
        321: 419,

        // XK_Lstroke
        322: 435,

        // XK_lstroke
        323: 465,

        // XK_Nacute
        324: 497,

        // XK_nacute
        325: 977,

        // XK_Ncedilla
        326: 1009,

        // XK_ncedilla
        327: 466,

        // XK_Ncaron
        328: 498,

        // XK_ncaron
        330: 957,

        // XK_ENG
        331: 959,

        // XK_eng
        332: 978,

        // XK_Omacron
        333: 1010,

        // XK_omacron
        336: 469,

        // XK_Odoubleacute
        337: 501,

        // XK_odoubleacute
        338: 5052,

        // XK_OE
        339: 5053,

        // XK_oe
        340: 448,

        // XK_Racute
        341: 480,

        // XK_racute
        342: 931,

        // XK_Rcedilla
        343: 947,

        // XK_rcedilla
        344: 472,

        // XK_Rcaron
        345: 504,

        // XK_rcaron
        346: 422,

        // XK_Sacute
        347: 438,

        // XK_sacute
        348: 734,

        // XK_Scircumflex
        349: 766,

        // XK_scircumflex
        350: 426,

        // XK_Scedilla
        351: 442,

        // XK_scedilla
        352: 425,

        // XK_Scaron
        353: 441,

        // XK_scaron
        354: 478,

        // XK_Tcedilla
        355: 510,

        // XK_tcedilla
        356: 427,

        // XK_Tcaron
        357: 443,

        // XK_tcaron
        358: 940,

        // XK_Tslash
        359: 956,

        // XK_tslash
        360: 989,

        // XK_Utilde
        361: 1021,

        // XK_utilde
        362: 990,

        // XK_Umacron
        363: 1022,

        // XK_umacron
        364: 733,

        // XK_Ubreve
        365: 765,

        // XK_ubreve
        366: 473,

        // XK_Uring
        367: 505,

        // XK_uring
        368: 475,

        // XK_Udoubleacute
        369: 507,

        // XK_udoubleacute
        370: 985,

        // XK_Uogonek
        371: 1017,

        // XK_uogonek
        376: 5054,

        // XK_Ydiaeresis
        377: 428,

        // XK_Zacute
        378: 444,

        // XK_zacute
        379: 431,

        // XK_Zabovedot
        380: 447,

        // XK_zabovedot
        381: 430,

        // XK_Zcaron
        382: 446,

        // XK_zcaron
        402: 2294,

        // XK_function
        466: 16777681,

        // XK_Ocaron
        711: 439,

        // XK_caron
        728: 418,

        // XK_breve
        729: 511,

        // XK_abovedot
        731: 434,

        // XK_ogonek
        733: 445,

        // XK_doubleacute
        901: 1966,

        // XK_Greek_accentdieresis
        902: 1953,

        // XK_Greek_ALPHAaccent
        904: 1954,

        // XK_Greek_EPSILONaccent
        905: 1955,

        // XK_Greek_ETAaccent
        906: 1956,

        // XK_Greek_IOTAaccent
        908: 1959,

        // XK_Greek_OMICRONaccent
        910: 1960,

        // XK_Greek_UPSILONaccent
        911: 1963,

        // XK_Greek_OMEGAaccent
        912: 1974,

        // XK_Greek_iotaaccentdieresis
        913: 1985,

        // XK_Greek_ALPHA
        914: 1986,

        // XK_Greek_BETA
        915: 1987,

        // XK_Greek_GAMMA
        916: 1988,

        // XK_Greek_DELTA
        917: 1989,

        // XK_Greek_EPSILON
        918: 1990,

        // XK_Greek_ZETA
        919: 1991,

        // XK_Greek_ETA
        920: 1992,

        // XK_Greek_THETA
        921: 1993,

        // XK_Greek_IOTA
        922: 1994,

        // XK_Greek_KAPPA
        923: 1995,

        // XK_Greek_LAMDA
        924: 1996,

        // XK_Greek_MU
        925: 1997,

        // XK_Greek_NU
        926: 1998,

        // XK_Greek_XI
        927: 1999,

        // XK_Greek_OMICRON
        928: 2e3,

        // XK_Greek_PI
        929: 2001,

        // XK_Greek_RHO
        931: 2002,

        // XK_Greek_SIGMA
        932: 2004,

        // XK_Greek_TAU
        933: 2005,

        // XK_Greek_UPSILON
        934: 2006,

        // XK_Greek_PHI
        935: 2007,

        // XK_Greek_CHI
        936: 2008,

        // XK_Greek_PSI
        937: 2009,

        // XK_Greek_OMEGA
        938: 1957,

        // XK_Greek_IOTAdieresis
        939: 1961,

        // XK_Greek_UPSILONdieresis
        940: 1969,

        // XK_Greek_alphaaccent
        941: 1970,

        // XK_Greek_epsilonaccent
        942: 1971,

        // XK_Greek_etaaccent
        943: 1972,

        // XK_Greek_iotaaccent
        944: 1978,

        // XK_Greek_upsilonaccentdieresis
        945: 2017,

        // XK_Greek_alpha
        946: 2018,

        // XK_Greek_beta
        947: 2019,

        // XK_Greek_gamma
        948: 2020,

        // XK_Greek_delta
        949: 2021,

        // XK_Greek_epsilon
        950: 2022,

        // XK_Greek_zeta
        951: 2023,

        // XK_Greek_eta
        952: 2024,

        // XK_Greek_theta
        953: 2025,

        // XK_Greek_iota
        954: 2026,

        // XK_Greek_kappa
        955: 2027,

        // XK_Greek_lamda
        956: 2028,

        // XK_Greek_mu
        957: 2029,

        // XK_Greek_nu
        958: 2030,

        // XK_Greek_xi
        959: 2031,

        // XK_Greek_omicron
        960: 2032,

        // XK_Greek_pi
        961: 2033,

        // XK_Greek_rho
        962: 2035,

        // XK_Greek_finalsmallsigma
        963: 2034,

        // XK_Greek_sigma
        964: 2036,

        // XK_Greek_tau
        965: 2037,

        // XK_Greek_upsilon
        966: 2038,

        // XK_Greek_phi
        967: 2039,

        // XK_Greek_chi
        968: 2040,

        // XK_Greek_psi
        969: 2041,

        // XK_Greek_omega
        970: 1973,

        // XK_Greek_iotadieresis
        971: 1977,

        // XK_Greek_upsilondieresis
        972: 1975,

        // XK_Greek_omicronaccent
        973: 1976,

        // XK_Greek_upsilonaccent
        974: 1979,

        // XK_Greek_omegaaccent
        1025: 1715,

        // XK_Cyrillic_IO
        1026: 1713,

        // XK_Serbian_DJE
        1027: 1714,

        // XK_Macedonia_GJE
        1028: 1716,

        // XK_Ukrainian_IE
        1029: 1717,

        // XK_Macedonia_DSE
        1030: 1718,

        // XK_Ukrainian_I
        1031: 1719,

        // XK_Ukrainian_YI
        1032: 1720,

        // XK_Cyrillic_JE
        1033: 1721,

        // XK_Cyrillic_LJE
        1034: 1722,

        // XK_Cyrillic_NJE
        1035: 1723,

        // XK_Serbian_TSHE
        1036: 1724,

        // XK_Macedonia_KJE
        1038: 1726,

        // XK_Byelorussian_SHORTU
        1039: 1727,

        // XK_Cyrillic_DZHE
        1040: 1761,

        // XK_Cyrillic_A
        1041: 1762,

        // XK_Cyrillic_BE
        1042: 1783,

        // XK_Cyrillic_VE
        1043: 1767,

        // XK_Cyrillic_GHE
        1044: 1764,

        // XK_Cyrillic_DE
        1045: 1765,

        // XK_Cyrillic_IE
        1046: 1782,

        // XK_Cyrillic_ZHE
        1047: 1786,

        // XK_Cyrillic_ZE
        1048: 1769,

        // XK_Cyrillic_I
        1049: 1770,

        // XK_Cyrillic_SHORTI
        1050: 1771,

        // XK_Cyrillic_KA
        1051: 1772,

        // XK_Cyrillic_EL
        1052: 1773,

        // XK_Cyrillic_EM
        1053: 1774,

        // XK_Cyrillic_EN
        1054: 1775,

        // XK_Cyrillic_O
        1055: 1776,

        // XK_Cyrillic_PE
        1056: 1778,

        // XK_Cyrillic_ER
        1057: 1779,

        // XK_Cyrillic_ES
        1058: 1780,

        // XK_Cyrillic_TE
        1059: 1781,

        // XK_Cyrillic_U
        1060: 1766,

        // XK_Cyrillic_EF
        1061: 1768,

        // XK_Cyrillic_HA
        1062: 1763,

        // XK_Cyrillic_TSE
        1063: 1790,

        // XK_Cyrillic_CHE
        1064: 1787,

        // XK_Cyrillic_SHA
        1065: 1789,

        // XK_Cyrillic_SHCHA
        1066: 1791,

        // XK_Cyrillic_HARDSIGN
        1067: 1785,

        // XK_Cyrillic_YERU
        1068: 1784,

        // XK_Cyrillic_SOFTSIGN
        1069: 1788,

        // XK_Cyrillic_E
        1070: 1760,

        // XK_Cyrillic_YU
        1071: 1777,

        // XK_Cyrillic_YA
        1072: 1729,

        // XK_Cyrillic_a
        1073: 1730,

        // XK_Cyrillic_be
        1074: 1751,

        // XK_Cyrillic_ve
        1075: 1735,

        // XK_Cyrillic_ghe
        1076: 1732,

        // XK_Cyrillic_de
        1077: 1733,

        // XK_Cyrillic_ie
        1078: 1750,

        // XK_Cyrillic_zhe
        1079: 1754,

        // XK_Cyrillic_ze
        1080: 1737,

        // XK_Cyrillic_i
        1081: 1738,

        // XK_Cyrillic_shorti
        1082: 1739,

        // XK_Cyrillic_ka
        1083: 1740,

        // XK_Cyrillic_el
        1084: 1741,

        // XK_Cyrillic_em
        1085: 1742,

        // XK_Cyrillic_en
        1086: 1743,

        // XK_Cyrillic_o
        1087: 1744,

        // XK_Cyrillic_pe
        1088: 1746,

        // XK_Cyrillic_er
        1089: 1747,

        // XK_Cyrillic_es
        1090: 1748,

        // XK_Cyrillic_te
        1091: 1749,

        // XK_Cyrillic_u
        1092: 1734,

        // XK_Cyrillic_ef
        1093: 1736,

        // XK_Cyrillic_ha
        1094: 1731,

        // XK_Cyrillic_tse
        1095: 1758,

        // XK_Cyrillic_che
        1096: 1755,

        // XK_Cyrillic_sha
        1097: 1757,

        // XK_Cyrillic_shcha
        1098: 1759,

        // XK_Cyrillic_hardsign
        1099: 1753,

        // XK_Cyrillic_yeru
        1100: 1752,

        // XK_Cyrillic_softsign
        1101: 1756,

        // XK_Cyrillic_e
        1102: 1728,

        // XK_Cyrillic_yu
        1103: 1745,

        // XK_Cyrillic_ya
        1105: 1699,

        // XK_Cyrillic_io
        1106: 1697,

        // XK_Serbian_dje
        1107: 1698,

        // XK_Macedonia_gje
        1108: 1700,

        // XK_Ukrainian_ie
        1109: 1701,

        // XK_Macedonia_dse
        1110: 1702,

        // XK_Ukrainian_i
        1111: 1703,

        // XK_Ukrainian_yi
        1112: 1704,

        // XK_Cyrillic_je
        1113: 1705,

        // XK_Cyrillic_lje
        1114: 1706,

        // XK_Cyrillic_nje
        1115: 1707,

        // XK_Serbian_tshe
        1116: 1708,

        // XK_Macedonia_kje
        1118: 1710,

        // XK_Byelorussian_shortu
        1119: 1711,

        // XK_Cyrillic_dzhe
        1168: 1725,

        // XK_Ukrainian_GHE_WITH_UPTURN
        1169: 1709,

        // XK_Ukrainian_ghe_with_upturn
        1488: 3296,

        // XK_hebrew_aleph
        1489: 3297,

        // XK_hebrew_bet
        1490: 3298,

        // XK_hebrew_gimel
        1491: 3299,

        // XK_hebrew_dalet
        1492: 3300,

        // XK_hebrew_he
        1493: 3301,

        // XK_hebrew_waw
        1494: 3302,

        // XK_hebrew_zain
        1495: 3303,

        // XK_hebrew_chet
        1496: 3304,

        // XK_hebrew_tet
        1497: 3305,

        // XK_hebrew_yod
        1498: 3306,

        // XK_hebrew_finalkaph
        1499: 3307,

        // XK_hebrew_kaph
        1500: 3308,

        // XK_hebrew_lamed
        1501: 3309,

        // XK_hebrew_finalmem
        1502: 3310,

        // XK_hebrew_mem
        1503: 3311,

        // XK_hebrew_finalnun
        1504: 3312,

        // XK_hebrew_nun
        1505: 3313,

        // XK_hebrew_samech
        1506: 3314,

        // XK_hebrew_ayin
        1507: 3315,

        // XK_hebrew_finalpe
        1508: 3316,

        // XK_hebrew_pe
        1509: 3317,

        // XK_hebrew_finalzade
        1510: 3318,

        // XK_hebrew_zade
        1511: 3319,

        // XK_hebrew_qoph
        1512: 3320,

        // XK_hebrew_resh
        1513: 3321,

        // XK_hebrew_shin
        1514: 3322,

        // XK_hebrew_taw
        1548: 1452,

        // XK_Arabic_comma
        1563: 1467,

        // XK_Arabic_semicolon
        1567: 1471,

        // XK_Arabic_question_mark
        1569: 1473,

        // XK_Arabic_hamza
        1570: 1474,

        // XK_Arabic_maddaonalef
        1571: 1475,

        // XK_Arabic_hamzaonalef
        1572: 1476,

        // XK_Arabic_hamzaonwaw
        1573: 1477,

        // XK_Arabic_hamzaunderalef
        1574: 1478,

        // XK_Arabic_hamzaonyeh
        1575: 1479,

        // XK_Arabic_alef
        1576: 1480,

        // XK_Arabic_beh
        1577: 1481,

        // XK_Arabic_tehmarbuta
        1578: 1482,

        // XK_Arabic_teh
        1579: 1483,

        // XK_Arabic_theh
        1580: 1484,

        // XK_Arabic_jeem
        1581: 1485,

        // XK_Arabic_hah
        1582: 1486,

        // XK_Arabic_khah
        1583: 1487,

        // XK_Arabic_dal
        1584: 1488,

        // XK_Arabic_thal
        1585: 1489,

        // XK_Arabic_ra
        1586: 1490,

        // XK_Arabic_zain
        1587: 1491,

        // XK_Arabic_seen
        1588: 1492,

        // XK_Arabic_sheen
        1589: 1493,

        // XK_Arabic_sad
        1590: 1494,

        // XK_Arabic_dad
        1591: 1495,

        // XK_Arabic_tah
        1592: 1496,

        // XK_Arabic_zah
        1593: 1497,

        // XK_Arabic_ain
        1594: 1498,

        // XK_Arabic_ghain
        1600: 1504,

        // XK_Arabic_tatweel
        1601: 1505,

        // XK_Arabic_feh
        1602: 1506,

        // XK_Arabic_qaf
        1603: 1507,

        // XK_Arabic_kaf
        1604: 1508,

        // XK_Arabic_lam
        1605: 1509,

        // XK_Arabic_meem
        1606: 1510,

        // XK_Arabic_noon
        1607: 1511,

        // XK_Arabic_ha
        1608: 1512,

        // XK_Arabic_waw
        1609: 1513,

        // XK_Arabic_alefmaksura
        1610: 1514,

        // XK_Arabic_yeh
        1611: 1515,

        // XK_Arabic_fathatan
        1612: 1516,

        // XK_Arabic_dammatan
        1613: 1517,

        // XK_Arabic_kasratan
        1614: 1518,

        // XK_Arabic_fatha
        1615: 1519,

        // XK_Arabic_damma
        1616: 1520,

        // XK_Arabic_kasra
        1617: 1521,

        // XK_Arabic_shadda
        1618: 1522,

        // XK_Arabic_sukun
        3585: 3489,

        // XK_Thai_kokai
        3586: 3490,

        // XK_Thai_khokhai
        3587: 3491,

        // XK_Thai_khokhuat
        3588: 3492,

        // XK_Thai_khokhwai
        3589: 3493,

        // XK_Thai_khokhon
        3590: 3494,

        // XK_Thai_khorakhang
        3591: 3495,

        // XK_Thai_ngongu
        3592: 3496,

        // XK_Thai_chochan
        3593: 3497,

        // XK_Thai_choching
        3594: 3498,

        // XK_Thai_chochang
        3595: 3499,

        // XK_Thai_soso
        3596: 3500,

        // XK_Thai_chochoe
        3597: 3501,

        // XK_Thai_yoying
        3598: 3502,

        // XK_Thai_dochada
        3599: 3503,

        // XK_Thai_topatak
        3600: 3504,

        // XK_Thai_thothan
        3601: 3505,

        // XK_Thai_thonangmontho
        3602: 3506,

        // XK_Thai_thophuthao
        3603: 3507,

        // XK_Thai_nonen
        3604: 3508,

        // XK_Thai_dodek
        3605: 3509,

        // XK_Thai_totao
        3606: 3510,

        // XK_Thai_thothung
        3607: 3511,

        // XK_Thai_thothahan
        3608: 3512,

        // XK_Thai_thothong
        3609: 3513,

        // XK_Thai_nonu
        3610: 3514,

        // XK_Thai_bobaimai
        3611: 3515,

        // XK_Thai_popla
        3612: 3516,

        // XK_Thai_phophung
        3613: 3517,

        // XK_Thai_fofa
        3614: 3518,

        // XK_Thai_phophan
        3615: 3519,

        // XK_Thai_fofan
        3616: 3520,

        // XK_Thai_phosamphao
        3617: 3521,

        // XK_Thai_moma
        3618: 3522,

        // XK_Thai_yoyak
        3619: 3523,

        // XK_Thai_rorua
        3620: 3524,

        // XK_Thai_ru
        3621: 3525,

        // XK_Thai_loling
        3622: 3526,

        // XK_Thai_lu
        3623: 3527,

        // XK_Thai_wowaen
        3624: 3528,

        // XK_Thai_sosala
        3625: 3529,

        // XK_Thai_sorusi
        3626: 3530,

        // XK_Thai_sosua
        3627: 3531,

        // XK_Thai_hohip
        3628: 3532,

        // XK_Thai_lochula
        3629: 3533,

        // XK_Thai_oang
        3630: 3534,

        // XK_Thai_honokhuk
        3631: 3535,

        // XK_Thai_paiyannoi
        3632: 3536,

        // XK_Thai_saraa
        3633: 3537,

        // XK_Thai_maihanakat
        3634: 3538,

        // XK_Thai_saraaa
        3635: 3539,

        // XK_Thai_saraam
        3636: 3540,

        // XK_Thai_sarai
        3637: 3541,

        // XK_Thai_saraii
        3638: 3542,

        // XK_Thai_saraue
        3639: 3543,

        // XK_Thai_sarauee
        3640: 3544,

        // XK_Thai_sarau
        3641: 3545,

        // XK_Thai_sarauu
        3642: 3546,

        // XK_Thai_phinthu
        3647: 3551,

        // XK_Thai_baht
        3648: 3552,

        // XK_Thai_sarae
        3649: 3553,

        // XK_Thai_saraae
        3650: 3554,

        // XK_Thai_sarao
        3651: 3555,

        // XK_Thai_saraaimaimuan
        3652: 3556,

        // XK_Thai_saraaimaimalai
        3653: 3557,

        // XK_Thai_lakkhangyao
        3654: 3558,

        // XK_Thai_maiyamok
        3655: 3559,

        // XK_Thai_maitaikhu
        3656: 3560,

        // XK_Thai_maiek
        3657: 3561,

        // XK_Thai_maitho
        3658: 3562,

        // XK_Thai_maitri
        3659: 3563,

        // XK_Thai_maichattawa
        3660: 3564,

        // XK_Thai_thanthakhat
        3661: 3565,

        // XK_Thai_nikhahit
        3664: 3568,

        // XK_Thai_leksun
        3665: 3569,

        // XK_Thai_leknung
        3666: 3570,

        // XK_Thai_leksong
        3667: 3571,

        // XK_Thai_leksam
        3668: 3572,

        // XK_Thai_leksi
        3669: 3573,

        // XK_Thai_lekha
        3670: 3574,

        // XK_Thai_lekhok
        3671: 3575,

        // XK_Thai_lekchet
        3672: 3576,

        // XK_Thai_lekpaet
        3673: 3577,

        // XK_Thai_lekkao
        8194: 2722,

        // XK_enspace
        8195: 2721,

        // XK_emspace
        8196: 2723,

        // XK_em3space
        8197: 2724,

        // XK_em4space
        8199: 2725,

        // XK_digitspace
        8200: 2726,

        // XK_punctspace
        8201: 2727,

        // XK_thinspace
        8202: 2728,

        // XK_hairspace
        8210: 2747,

        // XK_figdash
        8211: 2730,

        // XK_endash
        8212: 2729,

        // XK_emdash
        8213: 1967,

        // XK_Greek_horizbar
        8215: 3295,

        // XK_hebrew_doublelowline
        8216: 2768,

        // XK_leftsinglequotemark
        8217: 2769,

        // XK_rightsinglequotemark
        8218: 2813,

        // XK_singlelowquotemark
        8220: 2770,

        // XK_leftdoublequotemark
        8221: 2771,

        // XK_rightdoublequotemark
        8222: 2814,

        // XK_doublelowquotemark
        8224: 2801,

        // XK_dagger
        8225: 2802,

        // XK_doubledagger
        8226: 2790,

        // XK_enfilledcircbullet
        8229: 2735,

        // XK_doubbaselinedot
        8230: 2734,

        // XK_ellipsis
        8240: 2773,

        // XK_permille
        8242: 2774,

        // XK_minutes
        8243: 2775,

        // XK_seconds
        8248: 2812,

        // XK_caret
        8254: 1150,

        // XK_overline
        8361: 3839,

        // XK_Korean_Won
        8364: 8364,

        // XK_EuroSign
        8453: 2744,

        // XK_careof
        8470: 1712,

        // XK_numerosign
        8471: 2811,

        // XK_phonographcopyright
        8478: 2772,

        // XK_prescription
        8482: 2761,

        // XK_trademark
        8531: 2736,

        // XK_onethird
        8532: 2737,

        // XK_twothirds
        8533: 2738,

        // XK_onefifth
        8534: 2739,

        // XK_twofifths
        8535: 2740,

        // XK_threefifths
        8536: 2741,

        // XK_fourfifths
        8537: 2742,

        // XK_onesixth
        8538: 2743,

        // XK_fivesixths
        8539: 2755,

        // XK_oneeighth
        8540: 2756,

        // XK_threeeighths
        8541: 2757,

        // XK_fiveeighths
        8542: 2758,

        // XK_seveneighths
        8592: 2299,

        // XK_leftarrow
        8593: 2300,

        // XK_uparrow
        8594: 2301,

        // XK_rightarrow
        8595: 2302,

        // XK_downarrow
        8658: 2254,

        // XK_implies
        8660: 2253,

        // XK_ifonlyif
        8706: 2287,

        // XK_partialderivative
        8711: 2245,

        // XK_nabla
        8728: 3018,

        // XK_jot
        8730: 2262,

        // XK_radical
        8733: 2241,

        // XK_variation
        8734: 2242,

        // XK_infinity
        8743: 2270,

        // XK_logicaland
        8744: 2271,

        // XK_logicalor
        8745: 2268,

        // XK_intersection
        8746: 2269,

        // XK_union
        8747: 2239,

        // XK_integral
        8756: 2240,

        // XK_therefore
        8764: 2248,

        // XK_approximate
        8771: 2249,

        // XK_similarequal
        8773: 16785992,

        // XK_approxeq
        8800: 2237,

        // XK_notequal
        8801: 2255,

        // XK_identical
        8804: 2236,

        // XK_lessthanequal
        8805: 2238,

        // XK_greaterthanequal
        8834: 2266,

        // XK_includedin
        8835: 2267,

        // XK_includes
        8866: 3068,

        // XK_righttack
        8867: 3036,

        // XK_lefttack
        8868: 3010,

        // XK_downtack
        8869: 3022,

        // XK_uptack
        8968: 3027,

        // XK_upstile
        8970: 3012,

        // XK_downstile
        8981: 2810,

        // XK_telephonerecorder
        8992: 2212,

        // XK_topintegral
        8993: 2213,

        // XK_botintegral
        9109: 3020,

        // XK_quad
        9115: 2219,

        // XK_topleftparens
        9117: 2220,

        // XK_botleftparens
        9118: 2221,

        // XK_toprightparens
        9120: 2222,

        // XK_botrightparens
        9121: 2215,

        // XK_topleftsqbracket
        9123: 2216,

        // XK_botleftsqbracket
        9124: 2217,

        // XK_toprightsqbracket
        9126: 2218,

        // XK_botrightsqbracket
        9128: 2223,

        // XK_leftmiddlecurlybrace
        9132: 2224,

        // XK_rightmiddlecurlybrace
        9143: 2209,

        // XK_leftradical
        9146: 2543,

        // XK_horizlinescan1
        9147: 2544,

        // XK_horizlinescan3
        9148: 2546,

        // XK_horizlinescan7
        9149: 2547,

        // XK_horizlinescan9
        9225: 2530,

        // XK_ht
        9226: 2533,

        // XK_lf
        9227: 2537,

        // XK_vt
        9228: 2531,

        // XK_ff
        9229: 2532,

        // XK_cr
        9251: 2732,

        // XK_signifblank
        9252: 2536,

        // XK_nl
        9472: 2211,

        // XK_horizconnector
        9474: 2214,

        // XK_vertconnector
        9484: 2210,

        // XK_topleftradical
        9488: 2539,

        // XK_uprightcorner
        9492: 2541,

        // XK_lowleftcorner
        9496: 2538,

        // XK_lowrightcorner
        9500: 2548,

        // XK_leftt
        9508: 2549,

        // XK_rightt
        9516: 2551,

        // XK_topt
        9524: 2550,

        // XK_bott
        9532: 2542,

        // XK_crossinglines
        9618: 2529,

        // XK_checkerboard
        9642: 2791,

        // XK_enfilledsqbullet
        9643: 2785,

        // XK_enopensquarebullet
        9644: 2779,

        // XK_filledrectbullet
        9645: 2786,

        // XK_openrectbullet
        9646: 2783,

        // XK_emfilledrect
        9647: 2767,

        // XK_emopenrectangle
        9650: 2792,

        // XK_filledtribulletup
        9651: 2787,

        // XK_opentribulletup
        9654: 2781,

        // XK_filledrighttribullet
        9655: 2765,

        // XK_rightopentriangle
        9660: 2793,

        // XK_filledtribulletdown
        9661: 2788,

        // XK_opentribulletdown
        9664: 2780,

        // XK_filledlefttribullet
        9665: 2764,

        // XK_leftopentriangle
        9670: 2528,

        // XK_soliddiamond
        9675: 2766,

        // XK_emopencircle
        9679: 2782,

        // XK_emfilledcircle
        9702: 2784,

        // XK_enopencircbullet
        9734: 2789,

        // XK_openstar
        9742: 2809,

        // XK_telephone
        9747: 2762,

        // XK_signaturemark
        9756: 2794,

        // XK_leftpointer
        9758: 2795,

        // XK_rightpointer
        9792: 2808,

        // XK_femalesymbol
        9794: 2807,

        // XK_malesymbol
        9827: 2796,

        // XK_club
        9829: 2798,

        // XK_heart
        9830: 2797,

        // XK_diamond
        9837: 2806,

        // XK_musicalflat
        9839: 2805,

        // XK_musicalsharp
        10003: 2803,

        // XK_checkmark
        10007: 2804,

        // XK_ballotcross
        10013: 2777,

        // XK_latincross
        10016: 2800,

        // XK_maltesecross
        10216: 2748,

        // XK_leftanglebracket
        10217: 2750,

        // XK_rightanglebracket
        12289: 1188,

        // XK_kana_comma
        12290: 1185,

        // XK_kana_fullstop
        12300: 1186,

        // XK_kana_openingbracket
        12301: 1187,

        // XK_kana_closingbracket
        12443: 1246,

        // XK_voicedsound
        12444: 1247,

        // XK_semivoicedsound
        12449: 1191,

        // XK_kana_a
        12450: 1201,

        // XK_kana_A
        12451: 1192,

        // XK_kana_i
        12452: 1202,

        // XK_kana_I
        12453: 1193,

        // XK_kana_u
        12454: 1203,

        // XK_kana_U
        12455: 1194,

        // XK_kana_e
        12456: 1204,

        // XK_kana_E
        12457: 1195,

        // XK_kana_o
        12458: 1205,

        // XK_kana_O
        12459: 1206,

        // XK_kana_KA
        12461: 1207,

        // XK_kana_KI
        12463: 1208,

        // XK_kana_KU
        12465: 1209,

        // XK_kana_KE
        12467: 1210,

        // XK_kana_KO
        12469: 1211,

        // XK_kana_SA
        12471: 1212,

        // XK_kana_SHI
        12473: 1213,

        // XK_kana_SU
        12475: 1214,

        // XK_kana_SE
        12477: 1215,

        // XK_kana_SO
        12479: 1216,

        // XK_kana_TA
        12481: 1217,

        // XK_kana_CHI
        12483: 1199,

        // XK_kana_tsu
        12484: 1218,

        // XK_kana_TSU
        12486: 1219,

        // XK_kana_TE
        12488: 1220,

        // XK_kana_TO
        12490: 1221,

        // XK_kana_NA
        12491: 1222,

        // XK_kana_NI
        12492: 1223,

        // XK_kana_NU
        12493: 1224,

        // XK_kana_NE
        12494: 1225,

        // XK_kana_NO
        12495: 1226,

        // XK_kana_HA
        12498: 1227,

        // XK_kana_HI
        12501: 1228,

        // XK_kana_FU
        12504: 1229,

        // XK_kana_HE
        12507: 1230,

        // XK_kana_HO
        12510: 1231,

        // XK_kana_MA
        12511: 1232,

        // XK_kana_MI
        12512: 1233,

        // XK_kana_MU
        12513: 1234,

        // XK_kana_ME
        12514: 1235,

        // XK_kana_MO
        12515: 1196,

        // XK_kana_ya
        12516: 1236,

        // XK_kana_YA
        12517: 1197,

        // XK_kana_yu
        12518: 1237,

        // XK_kana_YU
        12519: 1198,

        // XK_kana_yo
        12520: 1238,

        // XK_kana_YO
        12521: 1239,

        // XK_kana_RA
        12522: 1240,

        // XK_kana_RI
        12523: 1241,

        // XK_kana_RU
        12524: 1242,

        // XK_kana_RE
        12525: 1243,

        // XK_kana_RO
        12527: 1244,

        // XK_kana_WA
        12530: 1190,

        // XK_kana_WO
        12531: 1245,

        // XK_kana_N
        12539: 1189,

        // XK_kana_conjunctive
        12540: 1200

        // XK_prolongedsound
      };
      var _default = exports["default"] = {
        lookup: function lookup(u) {
          if (u >= 32 && u <= 255) {
            return u;
          }

          var keysym = codepoints[u];

          if (keysym !== void 0) {
            return keysym;
          }

          
return 16777216 | u;
        }
      };
    }
  });

  // node_modules/@novnc/novnc/lib/input/vkeys.js
  var require_vkeys = __commonJS({
    "node_modules/@novnc/novnc/lib/input/vkeys.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _default = exports["default"] = {
        8: "Backspace",
        9: "Tab",
        10: "NumpadClear",
        13: "Enter",
        16: "ShiftLeft",
        17: "ControlLeft",
        18: "AltLeft",
        19: "Pause",
        20: "CapsLock",
        21: "Lang1",
        25: "Lang2",
        27: "Escape",
        28: "Convert",
        29: "NonConvert",
        32: "Space",
        33: "PageUp",
        34: "PageDown",
        35: "End",
        36: "Home",
        37: "ArrowLeft",
        38: "ArrowUp",
        39: "ArrowRight",
        40: "ArrowDown",
        41: "Select",
        44: "PrintScreen",
        45: "Insert",
        46: "Delete",
        47: "Help",
        48: "Digit0",
        49: "Digit1",
        50: "Digit2",
        51: "Digit3",
        52: "Digit4",
        53: "Digit5",
        54: "Digit6",
        55: "Digit7",
        56: "Digit8",
        57: "Digit9",
        91: "MetaLeft",
        92: "MetaRight",
        93: "ContextMenu",
        95: "Sleep",
        96: "Numpad0",
        97: "Numpad1",
        98: "Numpad2",
        99: "Numpad3",
        100: "Numpad4",
        101: "Numpad5",
        102: "Numpad6",
        103: "Numpad7",
        104: "Numpad8",
        105: "Numpad9",
        106: "NumpadMultiply",
        107: "NumpadAdd",
        108: "NumpadDecimal",
        109: "NumpadSubtract",
        110: "NumpadDecimal",

        // Duplicate, because buggy on Windows
        111: "NumpadDivide",
        112: "F1",
        113: "F2",
        114: "F3",
        115: "F4",
        116: "F5",
        117: "F6",
        118: "F7",
        119: "F8",
        120: "F9",
        121: "F10",
        122: "F11",
        123: "F12",
        124: "F13",
        125: "F14",
        126: "F15",
        127: "F16",
        128: "F17",
        129: "F18",
        130: "F19",
        131: "F20",
        132: "F21",
        133: "F22",
        134: "F23",
        135: "F24",
        144: "NumLock",
        145: "ScrollLock",
        166: "BrowserBack",
        167: "BrowserForward",
        168: "BrowserRefresh",
        169: "BrowserStop",
        170: "BrowserSearch",
        171: "BrowserFavorites",
        172: "BrowserHome",
        173: "AudioVolumeMute",
        174: "AudioVolumeDown",
        175: "AudioVolumeUp",
        176: "MediaTrackNext",
        177: "MediaTrackPrevious",
        178: "MediaStop",
        179: "MediaPlayPause",
        180: "LaunchMail",
        181: "MediaSelect",
        182: "LaunchApp1",
        183: "LaunchApp2",
        225: "AltRight"

        // Only when it is AltGraph
      };
    }
  });

  // node_modules/@novnc/novnc/lib/input/fixedkeys.js
  var require_fixedkeys = __commonJS({
    "node_modules/@novnc/novnc/lib/input/fixedkeys.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _default = exports["default"] = {
        // 3.1.1.1. Writing System Keys
        "Backspace": "Backspace",

        // 3.1.1.2. Functional Keys
        "AltLeft": "Alt",
        "AltRight": "Alt",

        // This could also be 'AltGraph'
        "CapsLock": "CapsLock",
        "ContextMenu": "ContextMenu",
        "ControlLeft": "Control",
        "ControlRight": "Control",
        "Enter": "Enter",
        "MetaLeft": "Meta",
        "MetaRight": "Meta",
        "ShiftLeft": "Shift",
        "ShiftRight": "Shift",
        "Tab": "Tab",

        // FIXME: Japanese/Korean keys
        // 3.1.2. Control Pad Section
        "Delete": "Delete",
        "End": "End",
        "Help": "Help",
        "Home": "Home",
        "Insert": "Insert",
        "PageDown": "PageDown",
        "PageUp": "PageUp",

        // 3.1.3. Arrow Pad Section
        "ArrowDown": "ArrowDown",
        "ArrowLeft": "ArrowLeft",
        "ArrowRight": "ArrowRight",
        "ArrowUp": "ArrowUp",

        // 3.1.4. Numpad Section
        "NumLock": "NumLock",
        "NumpadBackspace": "Backspace",
        "NumpadClear": "Clear",

        // 3.1.5. Function Section
        "Escape": "Escape",
        "F1": "F1",
        "F2": "F2",
        "F3": "F3",
        "F4": "F4",
        "F5": "F5",
        "F6": "F6",
        "F7": "F7",
        "F8": "F8",
        "F9": "F9",
        "F10": "F10",
        "F11": "F11",
        "F12": "F12",
        "F13": "F13",
        "F14": "F14",
        "F15": "F15",
        "F16": "F16",
        "F17": "F17",
        "F18": "F18",
        "F19": "F19",
        "F20": "F20",
        "F21": "F21",
        "F22": "F22",
        "F23": "F23",
        "F24": "F24",
        "F25": "F25",
        "F26": "F26",
        "F27": "F27",
        "F28": "F28",
        "F29": "F29",
        "F30": "F30",
        "F31": "F31",
        "F32": "F32",
        "F33": "F33",
        "F34": "F34",
        "F35": "F35",
        "PrintScreen": "PrintScreen",
        "ScrollLock": "ScrollLock",
        "Pause": "Pause",

        // 3.1.6. Media Keys
        "BrowserBack": "BrowserBack",
        "BrowserFavorites": "BrowserFavorites",
        "BrowserForward": "BrowserForward",
        "BrowserHome": "BrowserHome",
        "BrowserRefresh": "BrowserRefresh",
        "BrowserSearch": "BrowserSearch",
        "BrowserStop": "BrowserStop",
        "Eject": "Eject",
        "LaunchApp1": "LaunchMyComputer",
        "LaunchApp2": "LaunchCalendar",
        "LaunchMail": "LaunchMail",
        "MediaPlayPause": "MediaPlay",
        "MediaStop": "MediaStop",
        "MediaTrackNext": "MediaTrackNext",
        "MediaTrackPrevious": "MediaTrackPrevious",
        "Power": "Power",
        "Sleep": "Sleep",
        "AudioVolumeDown": "AudioVolumeDown",
        "AudioVolumeMute": "AudioVolumeMute",
        "AudioVolumeUp": "AudioVolumeUp",
        "WakeUp": "WakeUp"
      };
    }
  });

  // node_modules/@novnc/novnc/lib/input/domkeytable.js
  var require_domkeytable = __commonJS({
    "node_modules/@novnc/novnc/lib/input/domkeytable.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _keysym = _interopRequireDefault(require_keysym());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      var DOMKeyTable = {};

      function addStandard(key, standard) {
        if (standard === void 0) throw new Error('Undefined keysym for key "' + key + '"');
        if (key in DOMKeyTable) throw new Error('Duplicate entry for key "' + key + '"');
        DOMKeyTable[key] = [standard, standard, standard, standard];
      }

      function addLeftRight(key, left, right) {
        if (left === void 0) throw new Error('Undefined keysym for key "' + key + '"');
        if (right === void 0) throw new Error('Undefined keysym for key "' + key + '"');
        if (key in DOMKeyTable) throw new Error('Duplicate entry for key "' + key + '"');
        DOMKeyTable[key] = [left, left, right, left];
      }

      function addNumpad(key, standard, numpad) {
        if (standard === void 0) throw new Error('Undefined keysym for key "' + key + '"');
        if (numpad === void 0) throw new Error('Undefined keysym for key "' + key + '"');
        if (key in DOMKeyTable) throw new Error('Duplicate entry for key "' + key + '"');
        DOMKeyTable[key] = [standard, standard, standard, numpad];
      }

      addLeftRight("Alt", _keysym["default"].XK_Alt_L, _keysym["default"].XK_Alt_R);
      addStandard("AltGraph", _keysym["default"].XK_ISO_Level3_Shift);
      addStandard("CapsLock", _keysym["default"].XK_Caps_Lock);
      addLeftRight("Control", _keysym["default"].XK_Control_L, _keysym["default"].XK_Control_R);
      addLeftRight("Meta", _keysym["default"].XK_Super_L, _keysym["default"].XK_Super_R);
      addStandard("NumLock", _keysym["default"].XK_Num_Lock);
      addStandard("ScrollLock", _keysym["default"].XK_Scroll_Lock);
      addLeftRight("Shift", _keysym["default"].XK_Shift_L, _keysym["default"].XK_Shift_R);
      addNumpad("Enter", _keysym["default"].XK_Return, _keysym["default"].XK_KP_Enter);
      addStandard("Tab", _keysym["default"].XK_Tab);
      addNumpad(" ", _keysym["default"].XK_space, _keysym["default"].XK_KP_Space);
      addNumpad("ArrowDown", _keysym["default"].XK_Down, _keysym["default"].XK_KP_Down);
      addNumpad("ArrowLeft", _keysym["default"].XK_Left, _keysym["default"].XK_KP_Left);
      addNumpad("ArrowRight", _keysym["default"].XK_Right, _keysym["default"].XK_KP_Right);
      addNumpad("ArrowUp", _keysym["default"].XK_Up, _keysym["default"].XK_KP_Up);
      addNumpad("End", _keysym["default"].XK_End, _keysym["default"].XK_KP_End);
      addNumpad("Home", _keysym["default"].XK_Home, _keysym["default"].XK_KP_Home);
      addNumpad("PageDown", _keysym["default"].XK_Next, _keysym["default"].XK_KP_Next);
      addNumpad("PageUp", _keysym["default"].XK_Prior, _keysym["default"].XK_KP_Prior);
      addStandard("Backspace", _keysym["default"].XK_BackSpace);
      addNumpad("Clear", _keysym["default"].XK_Clear, _keysym["default"].XK_KP_Begin);
      addStandard("Copy", _keysym["default"].XF86XK_Copy);
      addStandard("Cut", _keysym["default"].XF86XK_Cut);
      addNumpad("Delete", _keysym["default"].XK_Delete, _keysym["default"].XK_KP_Delete);
      addNumpad("Insert", _keysym["default"].XK_Insert, _keysym["default"].XK_KP_Insert);
      addStandard("Paste", _keysym["default"].XF86XK_Paste);
      addStandard("Redo", _keysym["default"].XK_Redo);
      addStandard("Undo", _keysym["default"].XK_Undo);
      addStandard("Cancel", _keysym["default"].XK_Cancel);
      addStandard("ContextMenu", _keysym["default"].XK_Menu);
      addStandard("Escape", _keysym["default"].XK_Escape);
      addStandard("Execute", _keysym["default"].XK_Execute);
      addStandard("Find", _keysym["default"].XK_Find);
      addStandard("Help", _keysym["default"].XK_Help);
      addStandard("Pause", _keysym["default"].XK_Pause);
      addStandard("Select", _keysym["default"].XK_Select);
      addStandard("ZoomIn", _keysym["default"].XF86XK_ZoomIn);
      addStandard("ZoomOut", _keysym["default"].XF86XK_ZoomOut);
      addStandard("BrightnessDown", _keysym["default"].XF86XK_MonBrightnessDown);
      addStandard("BrightnessUp", _keysym["default"].XF86XK_MonBrightnessUp);
      addStandard("Eject", _keysym["default"].XF86XK_Eject);
      addStandard("LogOff", _keysym["default"].XF86XK_LogOff);
      addStandard("Power", _keysym["default"].XF86XK_PowerOff);
      addStandard("PowerOff", _keysym["default"].XF86XK_PowerDown);
      addStandard("PrintScreen", _keysym["default"].XK_Print);
      addStandard("Hibernate", _keysym["default"].XF86XK_Hibernate);
      addStandard("Standby", _keysym["default"].XF86XK_Standby);
      addStandard("WakeUp", _keysym["default"].XF86XK_WakeUp);
      addStandard("AllCandidates", _keysym["default"].XK_MultipleCandidate);
      addStandard("Alphanumeric", _keysym["default"].XK_Eisu_toggle);
      addStandard("CodeInput", _keysym["default"].XK_Codeinput);
      addStandard("Compose", _keysym["default"].XK_Multi_key);
      addStandard("Convert", _keysym["default"].XK_Henkan);
      addStandard("GroupFirst", _keysym["default"].XK_ISO_First_Group);
      addStandard("GroupLast", _keysym["default"].XK_ISO_Last_Group);
      addStandard("GroupNext", _keysym["default"].XK_ISO_Next_Group);
      addStandard("GroupPrevious", _keysym["default"].XK_ISO_Prev_Group);
      addStandard("NonConvert", _keysym["default"].XK_Muhenkan);
      addStandard("PreviousCandidate", _keysym["default"].XK_PreviousCandidate);
      addStandard("SingleCandidate", _keysym["default"].XK_SingleCandidate);
      addStandard("HangulMode", _keysym["default"].XK_Hangul);
      addStandard("HanjaMode", _keysym["default"].XK_Hangul_Hanja);
      addStandard("JunjaMode", _keysym["default"].XK_Hangul_Jeonja);
      addStandard("Eisu", _keysym["default"].XK_Eisu_toggle);
      addStandard("Hankaku", _keysym["default"].XK_Hankaku);
      addStandard("Hiragana", _keysym["default"].XK_Hiragana);
      addStandard("HiraganaKatakana", _keysym["default"].XK_Hiragana_Katakana);
      addStandard("KanaMode", _keysym["default"].XK_Kana_Shift);
      addStandard("KanjiMode", _keysym["default"].XK_Kanji);
      addStandard("Katakana", _keysym["default"].XK_Katakana);
      addStandard("Romaji", _keysym["default"].XK_Romaji);
      addStandard("Zenkaku", _keysym["default"].XK_Zenkaku);
      addStandard("ZenkakuHankaku", _keysym["default"].XK_Zenkaku_Hankaku);
      addStandard("F1", _keysym["default"].XK_F1);
      addStandard("F2", _keysym["default"].XK_F2);
      addStandard("F3", _keysym["default"].XK_F3);
      addStandard("F4", _keysym["default"].XK_F4);
      addStandard("F5", _keysym["default"].XK_F5);
      addStandard("F6", _keysym["default"].XK_F6);
      addStandard("F7", _keysym["default"].XK_F7);
      addStandard("F8", _keysym["default"].XK_F8);
      addStandard("F9", _keysym["default"].XK_F9);
      addStandard("F10", _keysym["default"].XK_F10);
      addStandard("F11", _keysym["default"].XK_F11);
      addStandard("F12", _keysym["default"].XK_F12);
      addStandard("F13", _keysym["default"].XK_F13);
      addStandard("F14", _keysym["default"].XK_F14);
      addStandard("F15", _keysym["default"].XK_F15);
      addStandard("F16", _keysym["default"].XK_F16);
      addStandard("F17", _keysym["default"].XK_F17);
      addStandard("F18", _keysym["default"].XK_F18);
      addStandard("F19", _keysym["default"].XK_F19);
      addStandard("F20", _keysym["default"].XK_F20);
      addStandard("F21", _keysym["default"].XK_F21);
      addStandard("F22", _keysym["default"].XK_F22);
      addStandard("F23", _keysym["default"].XK_F23);
      addStandard("F24", _keysym["default"].XK_F24);
      addStandard("F25", _keysym["default"].XK_F25);
      addStandard("F26", _keysym["default"].XK_F26);
      addStandard("F27", _keysym["default"].XK_F27);
      addStandard("F28", _keysym["default"].XK_F28);
      addStandard("F29", _keysym["default"].XK_F29);
      addStandard("F30", _keysym["default"].XK_F30);
      addStandard("F31", _keysym["default"].XK_F31);
      addStandard("F32", _keysym["default"].XK_F32);
      addStandard("F33", _keysym["default"].XK_F33);
      addStandard("F34", _keysym["default"].XK_F34);
      addStandard("F35", _keysym["default"].XK_F35);
      addStandard("Close", _keysym["default"].XF86XK_Close);
      addStandard("MailForward", _keysym["default"].XF86XK_MailForward);
      addStandard("MailReply", _keysym["default"].XF86XK_Reply);
      addStandard("MailSend", _keysym["default"].XF86XK_Send);
      addStandard("MediaFastForward", _keysym["default"].XF86XK_AudioForward);
      addStandard("MediaPause", _keysym["default"].XF86XK_AudioPause);
      addStandard("MediaPlay", _keysym["default"].XF86XK_AudioPlay);
      addStandard("MediaRecord", _keysym["default"].XF86XK_AudioRecord);
      addStandard("MediaRewind", _keysym["default"].XF86XK_AudioRewind);
      addStandard("MediaStop", _keysym["default"].XF86XK_AudioStop);
      addStandard("MediaTrackNext", _keysym["default"].XF86XK_AudioNext);
      addStandard("MediaTrackPrevious", _keysym["default"].XF86XK_AudioPrev);
      addStandard("New", _keysym["default"].XF86XK_New);
      addStandard("Open", _keysym["default"].XF86XK_Open);
      addStandard("Print", _keysym["default"].XK_Print);
      addStandard("Save", _keysym["default"].XF86XK_Save);
      addStandard("SpellCheck", _keysym["default"].XF86XK_Spell);
      addStandard("AudioVolumeDown", _keysym["default"].XF86XK_AudioLowerVolume);
      addStandard("AudioVolumeUp", _keysym["default"].XF86XK_AudioRaiseVolume);
      addStandard("AudioVolumeMute", _keysym["default"].XF86XK_AudioMute);
      addStandard("MicrophoneVolumeMute", _keysym["default"].XF86XK_AudioMicMute);
      addStandard("LaunchApplication1", _keysym["default"].XF86XK_MyComputer);
      addStandard("LaunchApplication2", _keysym["default"].XF86XK_Calculator);
      addStandard("LaunchCalendar", _keysym["default"].XF86XK_Calendar);
      addStandard("LaunchMail", _keysym["default"].XF86XK_Mail);
      addStandard("LaunchMediaPlayer", _keysym["default"].XF86XK_AudioMedia);
      addStandard("LaunchMusicPlayer", _keysym["default"].XF86XK_Music);
      addStandard("LaunchPhone", _keysym["default"].XF86XK_Phone);
      addStandard("LaunchScreenSaver", _keysym["default"].XF86XK_ScreenSaver);
      addStandard("LaunchSpreadsheet", _keysym["default"].XF86XK_Excel);
      addStandard("LaunchWebBrowser", _keysym["default"].XF86XK_WWW);
      addStandard("LaunchWebCam", _keysym["default"].XF86XK_WebCam);
      addStandard("LaunchWordProcessor", _keysym["default"].XF86XK_Word);
      addStandard("BrowserBack", _keysym["default"].XF86XK_Back);
      addStandard("BrowserFavorites", _keysym["default"].XF86XK_Favorites);
      addStandard("BrowserForward", _keysym["default"].XF86XK_Forward);
      addStandard("BrowserHome", _keysym["default"].XF86XK_HomePage);
      addStandard("BrowserRefresh", _keysym["default"].XF86XK_Refresh);
      addStandard("BrowserSearch", _keysym["default"].XF86XK_Search);
      addStandard("BrowserStop", _keysym["default"].XF86XK_Stop);
      addStandard("Dimmer", _keysym["default"].XF86XK_BrightnessAdjust);
      addStandard("MediaAudioTrack", _keysym["default"].XF86XK_AudioCycleTrack);
      addStandard("RandomToggle", _keysym["default"].XF86XK_AudioRandomPlay);
      addStandard("SplitScreenToggle", _keysym["default"].XF86XK_SplitScreen);
      addStandard("Subtitle", _keysym["default"].XF86XK_Subtitle);
      addStandard("VideoModeNext", _keysym["default"].XF86XK_Next_VMode);
      addNumpad("=", _keysym["default"].XK_equal, _keysym["default"].XK_KP_Equal);
      addNumpad("+", _keysym["default"].XK_plus, _keysym["default"].XK_KP_Add);
      addNumpad("-", _keysym["default"].XK_minus, _keysym["default"].XK_KP_Subtract);
      addNumpad("*", _keysym["default"].XK_asterisk, _keysym["default"].XK_KP_Multiply);
      addNumpad("/", _keysym["default"].XK_slash, _keysym["default"].XK_KP_Divide);
      addNumpad(".", _keysym["default"].XK_period, _keysym["default"].XK_KP_Decimal);
      addNumpad(",", _keysym["default"].XK_comma, _keysym["default"].XK_KP_Separator);
      addNumpad("0", _keysym["default"].XK_0, _keysym["default"].XK_KP_0);
      addNumpad("1", _keysym["default"].XK_1, _keysym["default"].XK_KP_1);
      addNumpad("2", _keysym["default"].XK_2, _keysym["default"].XK_KP_2);
      addNumpad("3", _keysym["default"].XK_3, _keysym["default"].XK_KP_3);
      addNumpad("4", _keysym["default"].XK_4, _keysym["default"].XK_KP_4);
      addNumpad("5", _keysym["default"].XK_5, _keysym["default"].XK_KP_5);
      addNumpad("6", _keysym["default"].XK_6, _keysym["default"].XK_KP_6);
      addNumpad("7", _keysym["default"].XK_7, _keysym["default"].XK_KP_7);
      addNumpad("8", _keysym["default"].XK_8, _keysym["default"].XK_KP_8);
      addNumpad("9", _keysym["default"].XK_9, _keysym["default"].XK_KP_9);
      var _default = exports["default"] = DOMKeyTable;
    }
  });

  // node_modules/@novnc/novnc/lib/input/util.js
  var require_util = __commonJS({
    "node_modules/@novnc/novnc/lib/input/util.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.getKey = getKey;
      exports.getKeycode = getKeycode;
      exports.getKeysym = getKeysym;
      var _keysym = _interopRequireDefault(require_keysym());
      var _keysymdef = _interopRequireDefault(require_keysymdef());
      var _vkeys = _interopRequireDefault(require_vkeys());
      var _fixedkeys = _interopRequireDefault(require_fixedkeys());
      var _domkeytable = _interopRequireDefault(require_domkeytable());
      var browser = _interopRequireWildcard(require_browser());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function getKeycode(evt) {
        if (evt.code) {
          switch (evt.code) {
            case "OSLeft":
              return "MetaLeft";
            case "OSRight":
              return "MetaRight";
          }

          
return evt.code;
        }

        if (evt.keyCode in _vkeys["default"]) {
          var code = _vkeys["default"][evt.keyCode];

          if (browser.isMac() && code === "ContextMenu") {
            code = "MetaRight";
          }

          if (evt.location === 2) {
            switch (code) {
              case "ShiftLeft":
                return "ShiftRight";
              case "ControlLeft":
                return "ControlRight";
              case "AltLeft":
                return "AltRight";
            }
          }

          if (evt.location === 3) {
            switch (code) {
              case "Delete":
                return "NumpadDecimal";
              case "Insert":
                return "Numpad0";
              case "End":
                return "Numpad1";
              case "ArrowDown":
                return "Numpad2";
              case "PageDown":
                return "Numpad3";
              case "ArrowLeft":
                return "Numpad4";
              case "ArrowRight":
                return "Numpad6";
              case "Home":
                return "Numpad7";
              case "ArrowUp":
                return "Numpad8";
              case "PageUp":
                return "Numpad9";
              case "Enter":
                return "NumpadEnter";
            }
          }

          
return code;
        }

        
return "Unidentified";
      }

      function getKey(evt) {
        if (evt.key !== void 0 && evt.key !== "Unidentified") {
          switch (evt.key) {
            case "OS":
              return "Meta";
            case "LaunchMyComputer":
              return "LaunchApplication1";
            case "LaunchCalculator":
              return "LaunchApplication2";
          }

          switch (evt.key) {
            case "UIKeyInputUpArrow":
              return "ArrowUp";
            case "UIKeyInputDownArrow":
              return "ArrowDown";
            case "UIKeyInputLeftArrow":
              return "ArrowLeft";
            case "UIKeyInputRightArrow":
              return "ArrowRight";
            case "UIKeyInputEscape":
              return "Escape";
          }

          if (evt.key === "\0" && evt.code === "NumpadDecimal") {
            return "Delete";
          }

          
return evt.key;
        }

        var code = getKeycode(evt);

        if (code in _fixedkeys["default"]) {
          return _fixedkeys["default"][code];
        }

        if (evt.charCode) {
          return String.fromCharCode(evt.charCode);
        }

        
return "Unidentified";
      }

      function getKeysym(evt) {
        var key = getKey(evt);

        if (key === "Unidentified") {
          return null;
        }

        if (key in _domkeytable["default"]) {
          var location = evt.location;

          if (key === "Meta" && location === 0) {
            location = 2;
          }

          if (key === "Clear" && location === 3) {
            var code = getKeycode(evt);

            if (code === "NumLock") {
              location = 0;
            }
          }

          if (location === void 0 || location > 3) {
            location = 0;
          }

          if (key === "Meta") {
            var _code = getKeycode(evt);

            if (_code === "AltLeft") {
              return _keysym["default"].XK_Meta_L;
            } else if (_code === "AltRight") {
              return _keysym["default"].XK_Meta_R;
            }
          }

          if (key === "Clear") {
            var _code2 = getKeycode(evt);

            if (_code2 === "NumLock") {
              return _keysym["default"].XK_Num_Lock;
            }
          }

          if (browser.isWindows()) {
            switch (key) {
              case "Zenkaku":
              case "Hankaku":
                return _keysym["default"].XK_Zenkaku_Hankaku;
              case "Romaji":
              case "KanaMode":
                return _keysym["default"].XK_Romaji;
            }
          }

          
return _domkeytable["default"][key][location];
        }

        if (key.length !== 1) {
          return null;
        }

        var codepoint = key.charCodeAt();

        if (codepoint) {
          return _keysymdef["default"].lookup(codepoint);
        }

        
return null;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/input/keyboard.js
  var require_keyboard = __commonJS({
    "node_modules/@novnc/novnc/lib/input/keyboard.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());
      var _events = require_events();
      var KeyboardUtil = _interopRequireWildcard(require_util());
      var _keysym = _interopRequireDefault(require_keysym());
      var browser = _interopRequireWildcard(require_browser());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var Keyboard = exports["default"] = /* @__PURE__ */ (function() {
        function Keyboard2(target) {
          _classCallCheck(this, Keyboard2);
          this._target = target || null;
          this._keyDownList = {};
          this._altGrArmed = false;
          this._eventHandlers = {
            "keyup": this._handleKeyUp.bind(this),
            "keydown": this._handleKeyDown.bind(this),
            "blur": this._allKeysUp.bind(this)
          };

          this.onkeyevent = function() {
          };
        }

        
return _createClass(Keyboard2, [{
          key: "_sendKeyEvent",
          value: function _sendKeyEvent(keysym, code, down) {
            var numlock = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : null;
            var capslock = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : null;

            if (down) {
              this._keyDownList[code] = keysym;
            } else {
              if (!(code in this._keyDownList)) {
                return;
              }

              delete this._keyDownList[code];
            }

            Log.Debug("onkeyevent " + (down ? "down" : "up") + ", keysym: " + keysym, ", code: " + code + ", numlock: " + numlock + ", capslock: " + capslock);
            this.onkeyevent(keysym, code, down, numlock, capslock);
          }
        }, {
          key: "_getKeyCode",
          value: function _getKeyCode(e) {
            var code = KeyboardUtil.getKeycode(e);

            if (code !== "Unidentified") {
              return code;
            }

            if (e.keyCode) {
              if (e.keyCode !== 229) {
                return "Platform" + e.keyCode;
              }
            }

            if (e.keyIdentifier) {
              if (e.keyIdentifier.substr(0, 2) !== "U+") {
                return e.keyIdentifier;
              }

              var codepoint = parseInt(e.keyIdentifier.substr(2), 16);
              var _char = String.fromCharCode(codepoint).toUpperCase();

              
return "Platform" + _char.charCodeAt();
            }

            
return "Unidentified";
          }
        }, {
          key: "_handleKeyDown",
          value: function _handleKeyDown(e) {
            var code = this._getKeyCode(e);
            var keysym = KeyboardUtil.getKeysym(e);
            var numlock = e.getModifierState("NumLock");
            var capslock = e.getModifierState("CapsLock");

            if (browser.isMac() || browser.isIOS()) {
              numlock = null;
            }

            if (this._altGrArmed) {
              this._altGrArmed = false;
              clearTimeout(this._altGrTimeout);

              if (code === "AltRight" && e.timeStamp - this._altGrCtrlTime < 50) {
                keysym = _keysym["default"].XK_ISO_Level3_Shift;
              } else {
                this._sendKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true, numlock, capslock);
              }
            }

            if (code === "Unidentified") {
              if (keysym) {
                this._sendKeyEvent(keysym, code, true, numlock, capslock);
                this._sendKeyEvent(keysym, code, false, numlock, capslock);
              }

              (0, _events.stopEvent)(e);
              
return;
            }

            if (browser.isMac() || browser.isIOS()) {
              switch (keysym) {
                case _keysym["default"].XK_Super_L:
                  keysym = _keysym["default"].XK_Alt_L;
                  break;
                case _keysym["default"].XK_Super_R:
                  keysym = _keysym["default"].XK_Super_L;
                  break;
                case _keysym["default"].XK_Alt_L:
                  keysym = _keysym["default"].XK_Mode_switch;
                  break;
                case _keysym["default"].XK_Alt_R:
                  keysym = _keysym["default"].XK_ISO_Level3_Shift;
                  break;
              }
            }

            if (code in this._keyDownList) {
              keysym = this._keyDownList[code];
            }

            if ((browser.isMac() || browser.isIOS()) && e.metaKey && code !== "MetaLeft" && code !== "MetaRight") {
              this._sendKeyEvent(keysym, code, true, numlock, capslock);
              this._sendKeyEvent(keysym, code, false, numlock, capslock);
              (0, _events.stopEvent)(e);
              
return;
            }

            if ((browser.isMac() || browser.isIOS()) && code === "CapsLock") {
              this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, "CapsLock", true, numlock, capslock);
              this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, "CapsLock", false, numlock, capslock);
              (0, _events.stopEvent)(e);
              
return;
            }

            var jpBadKeys = [_keysym["default"].XK_Zenkaku_Hankaku, _keysym["default"].XK_Eisu_toggle, _keysym["default"].XK_Katakana, _keysym["default"].XK_Hiragana, _keysym["default"].XK_Romaji];

            if (browser.isWindows() && jpBadKeys.includes(keysym)) {
              this._sendKeyEvent(keysym, code, true, numlock, capslock);
              this._sendKeyEvent(keysym, code, false, numlock, capslock);
              (0, _events.stopEvent)(e);
              
return;
            }

            (0, _events.stopEvent)(e);

            if (code === "ControlLeft" && browser.isWindows() && !("ControlLeft" in this._keyDownList)) {
              this._altGrArmed = true;
              this._altGrTimeout = setTimeout(this._handleAltGrTimeout.bind(this), 100);
              this._altGrCtrlTime = e.timeStamp;
              
return;
            }

            this._sendKeyEvent(keysym, code, true, numlock, capslock);
          }
        }, {
          key: "_handleKeyUp",
          value: function _handleKeyUp(e) {
            (0, _events.stopEvent)(e);
            var code = this._getKeyCode(e);

            if (this._altGrArmed) {
              this._altGrArmed = false;
              clearTimeout(this._altGrTimeout);
              this._sendKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true);
            }

            if ((browser.isMac() || browser.isIOS()) && code === "CapsLock") {
              this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, "CapsLock", true);
              this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, "CapsLock", false);
              
return;
            }

            this._sendKeyEvent(this._keyDownList[code], code, false);

            if (browser.isWindows() && (code === "ShiftLeft" || code === "ShiftRight")) {
              if ("ShiftRight" in this._keyDownList) {
                this._sendKeyEvent(this._keyDownList["ShiftRight"], "ShiftRight", false);
              }

              if ("ShiftLeft" in this._keyDownList) {
                this._sendKeyEvent(this._keyDownList["ShiftLeft"], "ShiftLeft", false);
              }
            }
          }
        }, {
          key: "_handleAltGrTimeout",
          value: function _handleAltGrTimeout() {
            this._altGrArmed = false;
            clearTimeout(this._altGrTimeout);
            this._sendKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true);
          }
        }, {
          key: "_allKeysUp",
          value: function _allKeysUp() {
            Log.Debug(">> Keyboard.allKeysUp");

            for (var code in this._keyDownList) {
              this._sendKeyEvent(this._keyDownList[code], code, false);
            }

            Log.Debug("<< Keyboard.allKeysUp");
          }

          // ===== PUBLIC METHODS =====
        }, {
          key: "grab",
          value: function grab() {
            this._target.addEventListener("keydown", this._eventHandlers.keydown);
            this._target.addEventListener("keyup", this._eventHandlers.keyup);
            window.addEventListener("blur", this._eventHandlers.blur);
          }
        }, {
          key: "ungrab",
          value: function ungrab() {
            this._target.removeEventListener("keydown", this._eventHandlers.keydown);
            this._target.removeEventListener("keyup", this._eventHandlers.keyup);
            window.removeEventListener("blur", this._eventHandlers.blur);
            this._allKeysUp();
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/input/gesturehandler.js
  var require_gesturehandler = __commonJS({
    "node_modules/@novnc/novnc/lib/input/gesturehandler.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var GH_NOGESTURE = 0;
      var GH_ONETAP = 1;
      var GH_TWOTAP = 2;
      var GH_THREETAP = 4;
      var GH_DRAG = 8;
      var GH_LONGPRESS = 16;
      var GH_TWODRAG = 32;
      var GH_PINCH = 64;
      var GH_INITSTATE = 127;
      var GH_MOVE_THRESHOLD = 50;
      var GH_ANGLE_THRESHOLD = 90;
      var GH_MULTITOUCH_TIMEOUT = 250;
      var GH_TAP_TIMEOUT = 1e3;
      var GH_LONGPRESS_TIMEOUT = 1e3;
      var GH_TWOTOUCH_TIMEOUT = 50;
      var GestureHandler = exports["default"] = /* @__PURE__ */ (function() {
        function GestureHandler2() {
          _classCallCheck(this, GestureHandler2);
          this._target = null;
          this._state = GH_INITSTATE;
          this._tracked = [];
          this._ignored = [];
          this._waitingRelease = false;
          this._releaseStart = 0;
          this._longpressTimeoutId = null;
          this._twoTouchTimeoutId = null;
          this._boundEventHandler = this._eventHandler.bind(this);
        }

        
return _createClass(GestureHandler2, [{
          key: "attach",
          value: function attach(target) {
            this.detach();
            this._target = target;
            this._target.addEventListener("touchstart", this._boundEventHandler);
            this._target.addEventListener("touchmove", this._boundEventHandler);
            this._target.addEventListener("touchend", this._boundEventHandler);
            this._target.addEventListener("touchcancel", this._boundEventHandler);
          }
        }, {
          key: "detach",
          value: function detach() {
            if (!this._target) {
              return;
            }

            this._stopLongpressTimeout();
            this._stopTwoTouchTimeout();
            this._target.removeEventListener("touchstart", this._boundEventHandler);
            this._target.removeEventListener("touchmove", this._boundEventHandler);
            this._target.removeEventListener("touchend", this._boundEventHandler);
            this._target.removeEventListener("touchcancel", this._boundEventHandler);
            this._target = null;
          }
        }, {
          key: "_eventHandler",
          value: function _eventHandler(e) {
            var fn;

            e.stopPropagation();
            e.preventDefault();

            switch (e.type) {
              case "touchstart":
                fn = this._touchStart;
                break;
              case "touchmove":
                fn = this._touchMove;
                break;
              case "touchend":
              case "touchcancel":
                fn = this._touchEnd;
                break;
            }

            for (var i = 0; i < e.changedTouches.length; i++) {
              var touch = e.changedTouches[i];

              fn.call(this, touch.identifier, touch.clientX, touch.clientY);
            }
          }
        }, {
          key: "_touchStart",
          value: function _touchStart(id, x, y) {
            if (this._hasDetectedGesture() || this._state === GH_NOGESTURE) {
              this._ignored.push(id);
              
return;
            }

            if (this._tracked.length > 0 && Date.now() - this._tracked[0].started > GH_MULTITOUCH_TIMEOUT) {
              this._state = GH_NOGESTURE;
              this._ignored.push(id);
              
return;
            }

            if (this._waitingRelease) {
              this._state = GH_NOGESTURE;
              this._ignored.push(id);
              
return;
            }

            this._tracked.push({
              id,
              started: Date.now(),
              active: true,
              firstX: x,
              firstY: y,
              lastX: x,
              lastY: y,
              angle: 0
            });

            switch (this._tracked.length) {
              case 1:
                this._startLongpressTimeout();
                break;
              case 2:
                this._state &= ~(GH_ONETAP | GH_DRAG | GH_LONGPRESS);
                this._stopLongpressTimeout();
                break;
              case 3:
                this._state &= ~(GH_TWOTAP | GH_TWODRAG | GH_PINCH);
                break;
              default:
                this._state = GH_NOGESTURE;
            }
          }
        }, {
          key: "_touchMove",
          value: function _touchMove(id, x, y) {
            var touch = this._tracked.find(function(t) {
              return t.id === id;
            });

            if (touch === void 0) {
              return;
            }

            touch.lastX = x;
            touch.lastY = y;
            var deltaX = x - touch.firstX;
            var deltaY = y - touch.firstY;

            if (touch.firstX !== touch.lastX || touch.firstY !== touch.lastY) {
              touch.angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
            }

            if (!this._hasDetectedGesture()) {
              if (Math.hypot(deltaX, deltaY) < GH_MOVE_THRESHOLD) {
                return;
              }

              this._state &= ~(GH_ONETAP | GH_TWOTAP | GH_THREETAP | GH_LONGPRESS);
              this._stopLongpressTimeout();

              if (this._tracked.length !== 1) {
                this._state &= ~GH_DRAG;
              }

              if (this._tracked.length !== 2) {
                this._state &= ~(GH_TWODRAG | GH_PINCH);
              }

              if (this._tracked.length === 2) {
                var prevTouch = this._tracked.find(function(t) {
                  return t.id !== id;
                });
                var prevDeltaMove = Math.hypot(prevTouch.firstX - prevTouch.lastX, prevTouch.firstY - prevTouch.lastY);

                if (prevDeltaMove > GH_MOVE_THRESHOLD) {
                  var deltaAngle = Math.abs(touch.angle - prevTouch.angle);

                  deltaAngle = Math.abs((deltaAngle + 180) % 360 - 180);

                  if (deltaAngle > GH_ANGLE_THRESHOLD) {
                    this._state &= ~GH_TWODRAG;
                  } else {
                    this._state &= ~GH_PINCH;
                  }

                  if (this._isTwoTouchTimeoutRunning()) {
                    this._stopTwoTouchTimeout();
                  }
                } else if (!this._isTwoTouchTimeoutRunning()) {
                  this._startTwoTouchTimeout();
                }
              }

              if (!this._hasDetectedGesture()) {
                return;
              }

              this._pushEvent("gesturestart");
            }

            this._pushEvent("gesturemove");
          }
        }, {
          key: "_touchEnd",
          value: function _touchEnd(id, x, y) {
            if (this._ignored.indexOf(id) !== -1) {
              this._ignored.splice(this._ignored.indexOf(id), 1);

              if (this._ignored.length === 0 && this._tracked.length === 0) {
                this._state = GH_INITSTATE;
                this._waitingRelease = false;
              }

              
return;
            }

            if (!this._hasDetectedGesture() && this._isTwoTouchTimeoutRunning()) {
              this._stopTwoTouchTimeout();
              this._state = GH_NOGESTURE;
            }

            if (!this._hasDetectedGesture()) {
              this._state &= ~(GH_DRAG | GH_TWODRAG | GH_PINCH);
              this._state &= ~GH_LONGPRESS;
              this._stopLongpressTimeout();

              if (!this._waitingRelease) {
                this._releaseStart = Date.now();
                this._waitingRelease = true;

                switch (this._tracked.length) {
                  case 1:
                    this._state &= ~(GH_TWOTAP | GH_THREETAP);
                    break;
                  case 2:
                    this._state &= ~(GH_ONETAP | GH_THREETAP);
                    break;
                }
              }
            }

            if (this._waitingRelease) {
              if (Date.now() - this._releaseStart > GH_MULTITOUCH_TIMEOUT) {
                this._state = GH_NOGESTURE;
              }

              if (this._tracked.some(function(t) {
                return Date.now() - t.started > GH_TAP_TIMEOUT;
              })) {
                this._state = GH_NOGESTURE;
              }

              var touch = this._tracked.find(function(t) {
                return t.id === id;
              });

              touch.active = false;

              if (this._hasDetectedGesture()) {
                this._pushEvent("gesturestart");
              } else {
                if (this._state !== GH_NOGESTURE) {
                  return;
                }
              }
            }

            if (this._hasDetectedGesture()) {
              this._pushEvent("gestureend");
            }

            for (var i = 0; i < this._tracked.length; i++) {
              if (this._tracked[i].active) {
                this._ignored.push(this._tracked[i].id);
              }
            }

            this._tracked = [];
            this._state = GH_NOGESTURE;

            if (this._ignored.indexOf(id) !== -1) {
              this._ignored.splice(this._ignored.indexOf(id), 1);
            }

            if (this._ignored.length === 0) {
              this._state = GH_INITSTATE;
              this._waitingRelease = false;
            }
          }
        }, {
          key: "_hasDetectedGesture",
          value: function _hasDetectedGesture() {
            if (this._state === GH_NOGESTURE) {
              return false;
            }

            if (this._state & this._state - 1) {
              return false;
            }

            if (this._state & (GH_ONETAP | GH_TWOTAP | GH_THREETAP)) {
              if (this._tracked.some(function(t) {
                return t.active;
              })) {
                return false;
              }
            }

            
return true;
          }
        }, {
          key: "_startLongpressTimeout",
          value: function _startLongpressTimeout() {
            var _this = this;

            this._stopLongpressTimeout();
            this._longpressTimeoutId = setTimeout(function() {
              return _this._longpressTimeout();
            }, GH_LONGPRESS_TIMEOUT);
          }
        }, {
          key: "_stopLongpressTimeout",
          value: function _stopLongpressTimeout() {
            clearTimeout(this._longpressTimeoutId);
            this._longpressTimeoutId = null;
          }
        }, {
          key: "_longpressTimeout",
          value: function _longpressTimeout() {
            if (this._hasDetectedGesture()) {
              throw new Error("A longpress gesture failed, conflict with a different gesture");
            }

            this._state = GH_LONGPRESS;
            this._pushEvent("gesturestart");
          }
        }, {
          key: "_startTwoTouchTimeout",
          value: function _startTwoTouchTimeout() {
            var _this2 = this;

            this._stopTwoTouchTimeout();
            this._twoTouchTimeoutId = setTimeout(function() {
              return _this2._twoTouchTimeout();
            }, GH_TWOTOUCH_TIMEOUT);
          }
        }, {
          key: "_stopTwoTouchTimeout",
          value: function _stopTwoTouchTimeout() {
            clearTimeout(this._twoTouchTimeoutId);
            this._twoTouchTimeoutId = null;
          }
        }, {
          key: "_isTwoTouchTimeoutRunning",
          value: function _isTwoTouchTimeoutRunning() {
            return this._twoTouchTimeoutId !== null;
          }
        }, {
          key: "_twoTouchTimeout",
          value: function _twoTouchTimeout() {
            if (this._tracked.length === 0) {
              throw new Error("A pinch or two drag gesture failed, no tracked touches");
            }

            var avgM = this._getAverageMovement();
            var avgMoveH = Math.abs(avgM.x);
            var avgMoveV = Math.abs(avgM.y);
            var avgD = this._getAverageDistance();
            var deltaTouchDistance = Math.abs(Math.hypot(avgD.first.x, avgD.first.y) - Math.hypot(avgD.last.x, avgD.last.y));

            if (avgMoveV < deltaTouchDistance && avgMoveH < deltaTouchDistance) {
              this._state = GH_PINCH;
            } else {
              this._state = GH_TWODRAG;
            }

            this._pushEvent("gesturestart");
            this._pushEvent("gesturemove");
          }
        }, {
          key: "_pushEvent",
          value: function _pushEvent(type) {
            var detail = {
              type: this._stateToGesture(this._state)
            };
            var avg = this._getPosition();
            var pos = avg.last;

            if (type === "gesturestart") {
              pos = avg.first;
            }

            switch (this._state) {
              case GH_TWODRAG:
              case GH_PINCH:
                pos = avg.first;
                break;
            }

            detail["clientX"] = pos.x;
            detail["clientY"] = pos.y;

            if (this._state === GH_PINCH) {
              var distance = this._getAverageDistance();

              if (type === "gesturestart") {
                detail["magnitudeX"] = distance.first.x;
                detail["magnitudeY"] = distance.first.y;
              } else {
                detail["magnitudeX"] = distance.last.x;
                detail["magnitudeY"] = distance.last.y;
              }
            } else if (this._state === GH_TWODRAG) {
              if (type === "gesturestart") {
                detail["magnitudeX"] = 0;
                detail["magnitudeY"] = 0;
              } else {
                var movement = this._getAverageMovement();

                detail["magnitudeX"] = movement.x;
                detail["magnitudeY"] = movement.y;
              }
            }

            var gev = new CustomEvent(type, {
              detail
            });

            this._target.dispatchEvent(gev);
          }
        }, {
          key: "_stateToGesture",
          value: function _stateToGesture(state) {
            switch (state) {
              case GH_ONETAP:
                return "onetap";
              case GH_TWOTAP:
                return "twotap";
              case GH_THREETAP:
                return "threetap";
              case GH_DRAG:
                return "drag";
              case GH_LONGPRESS:
                return "longpress";
              case GH_TWODRAG:
                return "twodrag";
              case GH_PINCH:
                return "pinch";
            }

            throw new Error("Unknown gesture state: " + state);
          }
        }, {
          key: "_getPosition",
          value: function _getPosition() {
            if (this._tracked.length === 0) {
              throw new Error("Failed to get gesture position, no tracked touches");
            }

            var size = this._tracked.length;
            var fx = 0, fy = 0, lx = 0, ly = 0;

            for (var i = 0; i < this._tracked.length; i++) {
              fx += this._tracked[i].firstX;
              fy += this._tracked[i].firstY;
              lx += this._tracked[i].lastX;
              ly += this._tracked[i].lastY;
            }

            
return {
              first: {
                x: fx / size,
                y: fy / size
              },
              last: {
                x: lx / size,
                y: ly / size
              }
            };
          }
        }, {
          key: "_getAverageMovement",
          value: function _getAverageMovement() {
            if (this._tracked.length === 0) {
              throw new Error("Failed to get gesture movement, no tracked touches");
            }

            var totalH, totalV;

            totalH = totalV = 0;
            var size = this._tracked.length;

            for (var i = 0; i < this._tracked.length; i++) {
              totalH += this._tracked[i].lastX - this._tracked[i].firstX;
              totalV += this._tracked[i].lastY - this._tracked[i].firstY;
            }

            
return {
              x: totalH / size,
              y: totalV / size
            };
          }
        }, {
          key: "_getAverageDistance",
          value: function _getAverageDistance() {
            if (this._tracked.length === 0) {
              throw new Error("Failed to get gesture distance, no tracked touches");
            }

            var first = this._tracked[0];
            var last = this._tracked[this._tracked.length - 1];
            var fdx = Math.abs(last.firstX - first.firstX);
            var fdy = Math.abs(last.firstY - first.firstY);
            var ldx = Math.abs(last.lastX - first.lastX);
            var ldy = Math.abs(last.lastY - first.lastY);

            
return {
              first: {
                x: fdx,
                y: fdy
              },
              last: {
                x: ldx,
                y: ldy
              }
            };
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/util/cursor.js
  var require_cursor = __commonJS({
    "node_modules/@novnc/novnc/lib/util/cursor.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _browser = require_browser();

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var useFallback = !_browser.supportsCursorURIs || _browser.isTouchDevice;
      var Cursor = exports["default"] = /* @__PURE__ */ (function() {
        function Cursor2() {
          _classCallCheck(this, Cursor2);
          this._target = null;
          this._canvas = document.createElement("canvas");

          if (useFallback) {
            this._canvas.style.position = "fixed";
            this._canvas.style.zIndex = "65535";
            this._canvas.style.pointerEvents = "none";
            this._canvas.style.userSelect = "none";
            this._canvas.style.WebkitUserSelect = "none";
            this._canvas.style.visibility = "hidden";
          }

          this._position = {
            x: 0,
            y: 0
          };
          this._hotSpot = {
            x: 0,
            y: 0
          };
          this._eventHandlers = {
            "mouseover": this._handleMouseOver.bind(this),
            "mouseleave": this._handleMouseLeave.bind(this),
            "mousemove": this._handleMouseMove.bind(this),
            "mouseup": this._handleMouseUp.bind(this)
          };
        }

        
return _createClass(Cursor2, [{
          key: "attach",
          value: function attach(target) {
            if (this._target) {
              this.detach();
            }

            this._target = target;

            if (useFallback) {
              document.body.appendChild(this._canvas);
              var options = {
                capture: true,
                passive: true
              };

              this._target.addEventListener("mouseover", this._eventHandlers.mouseover, options);
              this._target.addEventListener("mouseleave", this._eventHandlers.mouseleave, options);
              this._target.addEventListener("mousemove", this._eventHandlers.mousemove, options);
              this._target.addEventListener("mouseup", this._eventHandlers.mouseup, options);
            }

            this.clear();
          }
        }, {
          key: "detach",
          value: function detach() {
            if (!this._target) {
              return;
            }

            if (useFallback) {
              var options = {
                capture: true,
                passive: true
              };

              this._target.removeEventListener("mouseover", this._eventHandlers.mouseover, options);
              this._target.removeEventListener("mouseleave", this._eventHandlers.mouseleave, options);
              this._target.removeEventListener("mousemove", this._eventHandlers.mousemove, options);
              this._target.removeEventListener("mouseup", this._eventHandlers.mouseup, options);

              if (document.contains(this._canvas)) {
                document.body.removeChild(this._canvas);
              }
            }

            this._target = null;
          }
        }, {
          key: "change",
          value: function change(rgba, hotx, hoty, w, h) {
            if (w === 0 || h === 0) {
              this.clear();
              
return;
            }

            this._position.x = this._position.x + this._hotSpot.x - hotx;
            this._position.y = this._position.y + this._hotSpot.y - hoty;
            this._hotSpot.x = hotx;
            this._hotSpot.y = hoty;
            var ctx = this._canvas.getContext("2d");

            this._canvas.width = w;
            this._canvas.height = h;
            var img = new ImageData(new Uint8ClampedArray(rgba), w, h);

            ctx.clearRect(0, 0, w, h);
            ctx.putImageData(img, 0, 0);

            if (useFallback) {
              this._updatePosition();
            } else {
              var url = this._canvas.toDataURL();

              this._target.style.cursor = "url(" + url + ")" + hotx + " " + hoty + ", default";
            }
          }
        }, {
          key: "clear",
          value: function clear() {
            this._target.style.cursor = "none";
            this._canvas.width = 0;
            this._canvas.height = 0;
            this._position.x = this._position.x + this._hotSpot.x;
            this._position.y = this._position.y + this._hotSpot.y;
            this._hotSpot.x = 0;
            this._hotSpot.y = 0;
          }

          // Mouse events might be emulated, this allows
          // moving the cursor in such cases
        }, {
          key: "move",
          value: function move(clientX, clientY) {
            if (!useFallback) {
              return;
            }

            if (window.visualViewport) {
              this._position.x = clientX + window.visualViewport.offsetLeft;
              this._position.y = clientY + window.visualViewport.offsetTop;
            } else {
              this._position.x = clientX;
              this._position.y = clientY;
            }

            this._updatePosition();
            var target = document.elementFromPoint(clientX, clientY);

            this._updateVisibility(target);
          }
        }, {
          key: "_handleMouseOver",
          value: function _handleMouseOver(event) {
            this._handleMouseMove(event);
          }
        }, {
          key: "_handleMouseLeave",
          value: function _handleMouseLeave(event) {
            this._updateVisibility(event.relatedTarget);
          }
        }, {
          key: "_handleMouseMove",
          value: function _handleMouseMove(event) {
            this._updateVisibility(event.target);
            this._position.x = event.clientX - this._hotSpot.x;
            this._position.y = event.clientY - this._hotSpot.y;
            this._updatePosition();
          }
        }, {
          key: "_handleMouseUp",
          value: function _handleMouseUp(event) {
            var _this = this;
            var target = document.elementFromPoint(event.clientX, event.clientY);

            this._updateVisibility(target);

            if (this._captureIsActive()) {
              window.setTimeout(function() {
                if (!_this._target) {
                  return;
                }

                target = document.elementFromPoint(event.clientX, event.clientY);
                _this._updateVisibility(target);
              }, 0);
            }
          }
        }, {
          key: "_showCursor",
          value: function _showCursor() {
            if (this._canvas.style.visibility === "hidden") {
              this._canvas.style.visibility = "";
            }
          }
        }, {
          key: "_hideCursor",
          value: function _hideCursor() {
            if (this._canvas.style.visibility !== "hidden") {
              this._canvas.style.visibility = "hidden";
            }
          }

          // Should we currently display the cursor?
          // (i.e. are we over the target, or a child of the target without a
          // different cursor set)
        }, {
          key: "_shouldShowCursor",
          value: function _shouldShowCursor(target) {
            if (!target) {
              return false;
            }

            if (target === this._target) {
              return true;
            }

            if (!this._target.contains(target)) {
              return false;
            }

            if (window.getComputedStyle(target).cursor !== "none") {
              return false;
            }

            
return true;
          }
        }, {
          key: "_updateVisibility",
          value: function _updateVisibility(target) {
            if (this._captureIsActive()) {
              target = document.captureElement;
            }

            if (this._shouldShowCursor(target)) {
              this._showCursor();
            } else {
              this._hideCursor();
            }
          }
        }, {
          key: "_updatePosition",
          value: function _updatePosition() {
            this._canvas.style.left = this._position.x + "px";
            this._canvas.style.top = this._position.y + "px";
          }
        }, {
          key: "_captureIsActive",
          value: function _captureIsActive() {
            return document.captureElement && document.documentElement.contains(document.captureElement);
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/websock.js
  var require_websock = __commonJS({
    "node_modules/@novnc/novnc/lib/websock.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _toConsumableArray(r) {
        return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
      }

      function _nonIterableSpread() {
        throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }

      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);

          
return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }

      function _iterableToArray(r) {
        if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
      }

      function _arrayWithoutHoles(r) {
        if (Array.isArray(r)) return _arrayLikeToArray(r);
      }

      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        
return n;
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var MAX_RQ_GROW_SIZE = 40 * 1024 * 1024;
      var DataChannel = {
        CONNECTING: "connecting",
        OPEN: "open",
        CLOSING: "closing",
        CLOSED: "closed"
      };
      var ReadyStates = {
        CONNECTING: [WebSocket.CONNECTING, DataChannel.CONNECTING],
        OPEN: [WebSocket.OPEN, DataChannel.OPEN],
        CLOSING: [WebSocket.CLOSING, DataChannel.CLOSING],
        CLOSED: [WebSocket.CLOSED, DataChannel.CLOSED]
      };
      var rawChannelProps = ["send", "close", "binaryType", "onerror", "onmessage", "onopen", "protocol", "readyState"];
      var Websock = exports["default"] = /* @__PURE__ */ (function() {
        function Websock2() {
          _classCallCheck(this, Websock2);
          this._websocket = null;
          this._rQi = 0;
          this._rQlen = 0;
          this._rQbufferSize = 1024 * 1024 * 4;
          this._rQ = null;
          this._sQbufferSize = 1024 * 10;
          this._sQlen = 0;
          this._sQ = null;
          this._eventHandlers = {
            message: function message() {
            },
            open: function open() {
            },
            close: function close() {
            },
            error: function error() {
            }
          };
        }

        
return _createClass(Websock2, [{
          key: "readyState",
          get: function get() {
            var subState;

            if (this._websocket === null) {
              return "unused";
            }

            subState = this._websocket.readyState;

            if (ReadyStates.CONNECTING.includes(subState)) {
              return "connecting";
            } else if (ReadyStates.OPEN.includes(subState)) {
              return "open";
            } else if (ReadyStates.CLOSING.includes(subState)) {
              return "closing";
            } else if (ReadyStates.CLOSED.includes(subState)) {
              return "closed";
            }

            
return "unknown";
          }

          // Receive Queue
        }, {
          key: "rQpeek8",
          value: function rQpeek8() {
            return this._rQ[this._rQi];
          }
        }, {
          key: "rQskipBytes",
          value: function rQskipBytes(bytes) {
            this._rQi += bytes;
          }
        }, {
          key: "rQshift8",
          value: function rQshift8() {
            return this._rQshift(1);
          }
        }, {
          key: "rQshift16",
          value: function rQshift16() {
            return this._rQshift(2);
          }
        }, {
          key: "rQshift32",
          value: function rQshift32() {
            return this._rQshift(4);
          }

          // TODO(directxman12): test performance with these vs a DataView
        }, {
          key: "_rQshift",
          value: function _rQshift(bytes) {
            var res = 0;

            for (var _byte = bytes - 1; _byte >= 0; _byte--) {
              res += this._rQ[this._rQi++] << _byte * 8;
            }

            
return res >>> 0;
          }
        }, {
          key: "rQshiftStr",
          value: function rQshiftStr(len) {
            var str = "";

            for (var i = 0; i < len; i += 4096) {
              var part = this.rQshiftBytes(Math.min(4096, len - i), false);

              str += String.fromCharCode.apply(null, part);
            }

            
return str;
          }
        }, {
          key: "rQshiftBytes",
          value: function rQshiftBytes(len) {
            var copy = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : true;

            this._rQi += len;

            if (copy) {
              return this._rQ.slice(this._rQi - len, this._rQi);
            } else {
              return this._rQ.subarray(this._rQi - len, this._rQi);
            }
          }
        }, {
          key: "rQshiftTo",
          value: function rQshiftTo(target, len) {
            target.set(new Uint8Array(this._rQ.buffer, this._rQi, len));
            this._rQi += len;
          }
        }, {
          key: "rQpeekBytes",
          value: function rQpeekBytes(len) {
            var copy = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : true;

            if (copy) {
              return this._rQ.slice(this._rQi, this._rQi + len);
            } else {
              return this._rQ.subarray(this._rQi, this._rQi + len);
            }
          }

          // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
          // to be available in the receive queue. Return true if we need to
          // wait (and possibly print a debug message), otherwise false.
        }, {
          key: "rQwait",
          value: function rQwait(msg, num, goback) {
            if (this._rQlen - this._rQi < num) {
              if (goback) {
                if (this._rQi < goback) {
                  throw new Error("rQwait cannot backup " + goback + " bytes");
                }

                this._rQi -= goback;
              }

              
return true;
            }

            
return false;
          }

          // Send Queue
        }, {
          key: "sQpush8",
          value: function sQpush8(num) {
            this._sQensureSpace(1);
            this._sQ[this._sQlen++] = num;
          }
        }, {
          key: "sQpush16",
          value: function sQpush16(num) {
            this._sQensureSpace(2);
            this._sQ[this._sQlen++] = num >> 8 & 255;
            this._sQ[this._sQlen++] = num >> 0 & 255;
          }
        }, {
          key: "sQpush32",
          value: function sQpush32(num) {
            this._sQensureSpace(4);
            this._sQ[this._sQlen++] = num >> 24 & 255;
            this._sQ[this._sQlen++] = num >> 16 & 255;
            this._sQ[this._sQlen++] = num >> 8 & 255;
            this._sQ[this._sQlen++] = num >> 0 & 255;
          }
        }, {
          key: "sQpushString",
          value: function sQpushString(str) {
            var bytes = str.split("").map(function(chr) {
              return chr.charCodeAt(0);
            });

            this.sQpushBytes(new Uint8Array(bytes));
          }
        }, {
          key: "sQpushBytes",
          value: function sQpushBytes(bytes) {
            for (var offset = 0; offset < bytes.length; ) {
              this._sQensureSpace(1);
              var chunkSize = this._sQbufferSize - this._sQlen;

              if (chunkSize > bytes.length - offset) {
                chunkSize = bytes.length - offset;
              }

              this._sQ.set(bytes.subarray(offset, chunkSize), this._sQlen);
              this._sQlen += chunkSize;
              offset += chunkSize;
            }
          }
        }, {
          key: "flush",
          value: function flush() {
            if (this._sQlen > 0 && this.readyState === "open") {
              this._websocket.send(new Uint8Array(this._sQ.buffer, 0, this._sQlen));
              this._sQlen = 0;
            }
          }
        }, {
          key: "_sQensureSpace",
          value: function _sQensureSpace(bytes) {
            if (this._sQbufferSize - this._sQlen < bytes) {
              this.flush();
            }
          }

          // Event Handlers
        }, {
          key: "off",
          value: function off(evt) {
            this._eventHandlers[evt] = function() {
            };
          }
        }, {
          key: "on",
          value: function on(evt, handler) {
            this._eventHandlers[evt] = handler;
          }
        }, {
          key: "_allocateBuffers",
          value: function _allocateBuffers() {
            this._rQ = new Uint8Array(this._rQbufferSize);
            this._sQ = new Uint8Array(this._sQbufferSize);
          }
        }, {
          key: "init",
          value: function init() {
            this._allocateBuffers();
            this._rQi = 0;
            this._websocket = null;
          }
        }, {
          key: "open",
          value: function open(uri, protocols) {
            this.attach(new WebSocket(uri, protocols));
          }
        }, {
          key: "attach",
          value: function attach(rawChannel) {
            var _this = this;

            this.init();
            var channelProps = [].concat(_toConsumableArray(Object.keys(rawChannel)), _toConsumableArray(Object.getOwnPropertyNames(Object.getPrototypeOf(rawChannel))));

            for (var i = 0; i < rawChannelProps.length; i++) {
              var prop = rawChannelProps[i];

              if (channelProps.indexOf(prop) < 0) {
                throw new Error("Raw channel missing property: " + prop);
              }
            }

            this._websocket = rawChannel;
            this._websocket.binaryType = "arraybuffer";
            this._websocket.onmessage = this._recvMessage.bind(this);

            this._websocket.onopen = function() {
              Log.Debug(">> WebSock.onopen");

              if (_this._websocket.protocol) {
                Log.Info("Server choose sub-protocol: " + _this._websocket.protocol);
              }

              _this._eventHandlers.open();
              Log.Debug("<< WebSock.onopen");
            };

            this._websocket.onclose = function(e) {
              Log.Debug(">> WebSock.onclose");
              _this._eventHandlers.close(e);
              Log.Debug("<< WebSock.onclose");
            };

            this._websocket.onerror = function(e) {
              Log.Debug(">> WebSock.onerror: " + e);
              _this._eventHandlers.error(e);
              Log.Debug("<< WebSock.onerror: " + e);
            };
          }
        }, {
          key: "close",
          value: function close() {
            if (this._websocket) {
              if (this.readyState === "connecting" || this.readyState === "open") {
                Log.Info("Closing WebSocket connection");
                this._websocket.close();
              }

              this._websocket.onmessage = function() {
              };
            }
          }

          // private methods
          // We want to move all the unread data to the start of the queue,
          // e.g. compacting.
          // The function also expands the receive que if needed, and for
          // performance reasons we combine these two actions to avoid
          // unnecessary copying.
        }, {
          key: "_expandCompactRQ",
          value: function _expandCompactRQ(minFit) {
            var requiredBufferSize = (this._rQlen - this._rQi + minFit) * 8;
            var resizeNeeded = this._rQbufferSize < requiredBufferSize;

            if (resizeNeeded) {
              this._rQbufferSize = Math.max(this._rQbufferSize * 2, requiredBufferSize);
            }

            if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
              this._rQbufferSize = MAX_RQ_GROW_SIZE;

              if (this._rQbufferSize - (this._rQlen - this._rQi) < minFit) {
                throw new Error("Receive Queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit");
              }
            }

            if (resizeNeeded) {
              var oldRQbuffer = this._rQ.buffer;

              this._rQ = new Uint8Array(this._rQbufferSize);
              this._rQ.set(new Uint8Array(oldRQbuffer, this._rQi, this._rQlen - this._rQi));
            } else {
              this._rQ.copyWithin(0, this._rQi, this._rQlen);
            }

            this._rQlen = this._rQlen - this._rQi;
            this._rQi = 0;
          }

          // push arraybuffer values onto the end of the receive que
        }, {
          key: "_recvMessage",
          value: function _recvMessage(e) {
            if (this._rQlen == this._rQi) {
              this._rQlen = 0;
              this._rQi = 0;
            }

            var u8 = new Uint8Array(e.data);

            if (u8.length > this._rQbufferSize - this._rQlen) {
              this._expandCompactRQ(u8.length);
            }

            this._rQ.set(u8, this._rQlen);
            this._rQlen += u8.length;

            if (this._rQlen - this._rQi > 0) {
              this._eventHandlers.message();
            } else {
              Log.Debug("Ignoring empty message");
            }
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/input/xtscancodes.js
  var require_xtscancodes = __commonJS({
    "node_modules/@novnc/novnc/lib/input/xtscancodes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _default = exports["default"] = {
        "Again": 57349,

        /* html:Again (Again) -> linux:129 (KEY_AGAIN) -> atset1:57349 */
        "AltLeft": 56,

        /* html:AltLeft (AltLeft) -> linux:56 (KEY_LEFTALT) -> atset1:56 */
        "AltRight": 57400,

        /* html:AltRight (AltRight) -> linux:100 (KEY_RIGHTALT) -> atset1:57400 */
        "ArrowDown": 57424,

        /* html:ArrowDown (ArrowDown) -> linux:108 (KEY_DOWN) -> atset1:57424 */
        "ArrowLeft": 57419,

        /* html:ArrowLeft (ArrowLeft) -> linux:105 (KEY_LEFT) -> atset1:57419 */
        "ArrowRight": 57421,

        /* html:ArrowRight (ArrowRight) -> linux:106 (KEY_RIGHT) -> atset1:57421 */
        "ArrowUp": 57416,

        /* html:ArrowUp (ArrowUp) -> linux:103 (KEY_UP) -> atset1:57416 */
        "AudioVolumeDown": 57390,

        /* html:AudioVolumeDown (AudioVolumeDown) -> linux:114 (KEY_VOLUMEDOWN) -> atset1:57390 */
        "AudioVolumeMute": 57376,

        /* html:AudioVolumeMute (AudioVolumeMute) -> linux:113 (KEY_MUTE) -> atset1:57376 */
        "AudioVolumeUp": 57392,

        /* html:AudioVolumeUp (AudioVolumeUp) -> linux:115 (KEY_VOLUMEUP) -> atset1:57392 */
        "Backquote": 41,

        /* html:Backquote (Backquote) -> linux:41 (KEY_GRAVE) -> atset1:41 */
        "Backslash": 43,

        /* html:Backslash (Backslash) -> linux:43 (KEY_BACKSLASH) -> atset1:43 */
        "Backspace": 14,

        /* html:Backspace (Backspace) -> linux:14 (KEY_BACKSPACE) -> atset1:14 */
        "BracketLeft": 26,

        /* html:BracketLeft (BracketLeft) -> linux:26 (KEY_LEFTBRACE) -> atset1:26 */
        "BracketRight": 27,

        /* html:BracketRight (BracketRight) -> linux:27 (KEY_RIGHTBRACE) -> atset1:27 */
        "BrowserBack": 57450,

        /* html:BrowserBack (BrowserBack) -> linux:158 (KEY_BACK) -> atset1:57450 */
        "BrowserFavorites": 57446,

        /* html:BrowserFavorites (BrowserFavorites) -> linux:156 (KEY_BOOKMARKS) -> atset1:57446 */
        "BrowserForward": 57449,

        /* html:BrowserForward (BrowserForward) -> linux:159 (KEY_FORWARD) -> atset1:57449 */
        "BrowserHome": 57394,

        /* html:BrowserHome (BrowserHome) -> linux:172 (KEY_HOMEPAGE) -> atset1:57394 */
        "BrowserRefresh": 57447,

        /* html:BrowserRefresh (BrowserRefresh) -> linux:173 (KEY_REFRESH) -> atset1:57447 */
        "BrowserSearch": 57445,

        /* html:BrowserSearch (BrowserSearch) -> linux:217 (KEY_SEARCH) -> atset1:57445 */
        "BrowserStop": 57448,

        /* html:BrowserStop (BrowserStop) -> linux:128 (KEY_STOP) -> atset1:57448 */
        "CapsLock": 58,

        /* html:CapsLock (CapsLock) -> linux:58 (KEY_CAPSLOCK) -> atset1:58 */
        "Comma": 51,

        /* html:Comma (Comma) -> linux:51 (KEY_COMMA) -> atset1:51 */
        "ContextMenu": 57437,

        /* html:ContextMenu (ContextMenu) -> linux:127 (KEY_COMPOSE) -> atset1:57437 */
        "ControlLeft": 29,

        /* html:ControlLeft (ControlLeft) -> linux:29 (KEY_LEFTCTRL) -> atset1:29 */
        "ControlRight": 57373,

        /* html:ControlRight (ControlRight) -> linux:97 (KEY_RIGHTCTRL) -> atset1:57373 */
        "Convert": 121,

        /* html:Convert (Convert) -> linux:92 (KEY_HENKAN) -> atset1:121 */
        "Copy": 57464,

        /* html:Copy (Copy) -> linux:133 (KEY_COPY) -> atset1:57464 */
        "Cut": 57404,

        /* html:Cut (Cut) -> linux:137 (KEY_CUT) -> atset1:57404 */
        "Delete": 57427,

        /* html:Delete (Delete) -> linux:111 (KEY_DELETE) -> atset1:57427 */
        "Digit0": 11,

        /* html:Digit0 (Digit0) -> linux:11 (KEY_0) -> atset1:11 */
        "Digit1": 2,

        /* html:Digit1 (Digit1) -> linux:2 (KEY_1) -> atset1:2 */
        "Digit2": 3,

        /* html:Digit2 (Digit2) -> linux:3 (KEY_2) -> atset1:3 */
        "Digit3": 4,

        /* html:Digit3 (Digit3) -> linux:4 (KEY_3) -> atset1:4 */
        "Digit4": 5,

        /* html:Digit4 (Digit4) -> linux:5 (KEY_4) -> atset1:5 */
        "Digit5": 6,

        /* html:Digit5 (Digit5) -> linux:6 (KEY_5) -> atset1:6 */
        "Digit6": 7,

        /* html:Digit6 (Digit6) -> linux:7 (KEY_6) -> atset1:7 */
        "Digit7": 8,

        /* html:Digit7 (Digit7) -> linux:8 (KEY_7) -> atset1:8 */
        "Digit8": 9,

        /* html:Digit8 (Digit8) -> linux:9 (KEY_8) -> atset1:9 */
        "Digit9": 10,

        /* html:Digit9 (Digit9) -> linux:10 (KEY_9) -> atset1:10 */
        "Eject": 57469,

        /* html:Eject (Eject) -> linux:162 (KEY_EJECTCLOSECD) -> atset1:57469 */
        "End": 57423,

        /* html:End (End) -> linux:107 (KEY_END) -> atset1:57423 */
        "Enter": 28,

        /* html:Enter (Enter) -> linux:28 (KEY_ENTER) -> atset1:28 */
        "Equal": 13,

        /* html:Equal (Equal) -> linux:13 (KEY_EQUAL) -> atset1:13 */
        "Escape": 1,

        /* html:Escape (Escape) -> linux:1 (KEY_ESC) -> atset1:1 */
        "F1": 59,

        /* html:F1 (F1) -> linux:59 (KEY_F1) -> atset1:59 */
        "F10": 68,

        /* html:F10 (F10) -> linux:68 (KEY_F10) -> atset1:68 */
        "F11": 87,

        /* html:F11 (F11) -> linux:87 (KEY_F11) -> atset1:87 */
        "F12": 88,

        /* html:F12 (F12) -> linux:88 (KEY_F12) -> atset1:88 */
        "F13": 93,

        /* html:F13 (F13) -> linux:183 (KEY_F13) -> atset1:93 */
        "F14": 94,

        /* html:F14 (F14) -> linux:184 (KEY_F14) -> atset1:94 */
        "F15": 95,

        /* html:F15 (F15) -> linux:185 (KEY_F15) -> atset1:95 */
        "F16": 85,

        /* html:F16 (F16) -> linux:186 (KEY_F16) -> atset1:85 */
        "F17": 57347,

        /* html:F17 (F17) -> linux:187 (KEY_F17) -> atset1:57347 */
        "F18": 57463,

        /* html:F18 (F18) -> linux:188 (KEY_F18) -> atset1:57463 */
        "F19": 57348,

        /* html:F19 (F19) -> linux:189 (KEY_F19) -> atset1:57348 */
        "F2": 60,

        /* html:F2 (F2) -> linux:60 (KEY_F2) -> atset1:60 */
        "F20": 90,

        /* html:F20 (F20) -> linux:190 (KEY_F20) -> atset1:90 */
        "F21": 116,

        /* html:F21 (F21) -> linux:191 (KEY_F21) -> atset1:116 */
        "F22": 57465,

        /* html:F22 (F22) -> linux:192 (KEY_F22) -> atset1:57465 */
        "F23": 109,

        /* html:F23 (F23) -> linux:193 (KEY_F23) -> atset1:109 */
        "F24": 111,

        /* html:F24 (F24) -> linux:194 (KEY_F24) -> atset1:111 */
        "F3": 61,

        /* html:F3 (F3) -> linux:61 (KEY_F3) -> atset1:61 */
        "F4": 62,

        /* html:F4 (F4) -> linux:62 (KEY_F4) -> atset1:62 */
        "F5": 63,

        /* html:F5 (F5) -> linux:63 (KEY_F5) -> atset1:63 */
        "F6": 64,

        /* html:F6 (F6) -> linux:64 (KEY_F6) -> atset1:64 */
        "F7": 65,

        /* html:F7 (F7) -> linux:65 (KEY_F7) -> atset1:65 */
        "F8": 66,

        /* html:F8 (F8) -> linux:66 (KEY_F8) -> atset1:66 */
        "F9": 67,

        /* html:F9 (F9) -> linux:67 (KEY_F9) -> atset1:67 */
        "Find": 57409,

        /* html:Find (Find) -> linux:136 (KEY_FIND) -> atset1:57409 */
        "Help": 57461,

        /* html:Help (Help) -> linux:138 (KEY_HELP) -> atset1:57461 */
        "Hiragana": 119,

        /* html:Hiragana (Lang4) -> linux:91 (KEY_HIRAGANA) -> atset1:119 */
        "Home": 57415,

        /* html:Home (Home) -> linux:102 (KEY_HOME) -> atset1:57415 */
        "Insert": 57426,

        /* html:Insert (Insert) -> linux:110 (KEY_INSERT) -> atset1:57426 */
        "IntlBackslash": 86,

        /* html:IntlBackslash (IntlBackslash) -> linux:86 (KEY_102ND) -> atset1:86 */
        "IntlRo": 115,

        /* html:IntlRo (IntlRo) -> linux:89 (KEY_RO) -> atset1:115 */
        "IntlYen": 125,

        /* html:IntlYen (IntlYen) -> linux:124 (KEY_YEN) -> atset1:125 */
        "KanaMode": 112,

        /* html:KanaMode (KanaMode) -> linux:93 (KEY_KATAKANAHIRAGANA) -> atset1:112 */
        "Katakana": 120,

        /* html:Katakana (Lang3) -> linux:90 (KEY_KATAKANA) -> atset1:120 */
        "KeyA": 30,

        /* html:KeyA (KeyA) -> linux:30 (KEY_A) -> atset1:30 */
        "KeyB": 48,

        /* html:KeyB (KeyB) -> linux:48 (KEY_B) -> atset1:48 */
        "KeyC": 46,

        /* html:KeyC (KeyC) -> linux:46 (KEY_C) -> atset1:46 */
        "KeyD": 32,

        /* html:KeyD (KeyD) -> linux:32 (KEY_D) -> atset1:32 */
        "KeyE": 18,

        /* html:KeyE (KeyE) -> linux:18 (KEY_E) -> atset1:18 */
        "KeyF": 33,

        /* html:KeyF (KeyF) -> linux:33 (KEY_F) -> atset1:33 */
        "KeyG": 34,

        /* html:KeyG (KeyG) -> linux:34 (KEY_G) -> atset1:34 */
        "KeyH": 35,

        /* html:KeyH (KeyH) -> linux:35 (KEY_H) -> atset1:35 */
        "KeyI": 23,

        /* html:KeyI (KeyI) -> linux:23 (KEY_I) -> atset1:23 */
        "KeyJ": 36,

        /* html:KeyJ (KeyJ) -> linux:36 (KEY_J) -> atset1:36 */
        "KeyK": 37,

        /* html:KeyK (KeyK) -> linux:37 (KEY_K) -> atset1:37 */
        "KeyL": 38,

        /* html:KeyL (KeyL) -> linux:38 (KEY_L) -> atset1:38 */
        "KeyM": 50,

        /* html:KeyM (KeyM) -> linux:50 (KEY_M) -> atset1:50 */
        "KeyN": 49,

        /* html:KeyN (KeyN) -> linux:49 (KEY_N) -> atset1:49 */
        "KeyO": 24,

        /* html:KeyO (KeyO) -> linux:24 (KEY_O) -> atset1:24 */
        "KeyP": 25,

        /* html:KeyP (KeyP) -> linux:25 (KEY_P) -> atset1:25 */
        "KeyQ": 16,

        /* html:KeyQ (KeyQ) -> linux:16 (KEY_Q) -> atset1:16 */
        "KeyR": 19,

        /* html:KeyR (KeyR) -> linux:19 (KEY_R) -> atset1:19 */
        "KeyS": 31,

        /* html:KeyS (KeyS) -> linux:31 (KEY_S) -> atset1:31 */
        "KeyT": 20,

        /* html:KeyT (KeyT) -> linux:20 (KEY_T) -> atset1:20 */
        "KeyU": 22,

        /* html:KeyU (KeyU) -> linux:22 (KEY_U) -> atset1:22 */
        "KeyV": 47,

        /* html:KeyV (KeyV) -> linux:47 (KEY_V) -> atset1:47 */
        "KeyW": 17,

        /* html:KeyW (KeyW) -> linux:17 (KEY_W) -> atset1:17 */
        "KeyX": 45,

        /* html:KeyX (KeyX) -> linux:45 (KEY_X) -> atset1:45 */
        "KeyY": 21,

        /* html:KeyY (KeyY) -> linux:21 (KEY_Y) -> atset1:21 */
        "KeyZ": 44,

        /* html:KeyZ (KeyZ) -> linux:44 (KEY_Z) -> atset1:44 */
        "Lang1": 114,

        /* html:Lang1 (Lang1) -> linux:122 (KEY_HANGEUL) -> atset1:114 */
        "Lang2": 113,

        /* html:Lang2 (Lang2) -> linux:123 (KEY_HANJA) -> atset1:113 */
        "Lang3": 120,

        /* html:Lang3 (Lang3) -> linux:90 (KEY_KATAKANA) -> atset1:120 */
        "Lang4": 119,

        /* html:Lang4 (Lang4) -> linux:91 (KEY_HIRAGANA) -> atset1:119 */
        "Lang5": 118,

        /* html:Lang5 (Lang5) -> linux:85 (KEY_ZENKAKUHANKAKU) -> atset1:118 */
        "LaunchApp1": 57451,

        /* html:LaunchApp1 (LaunchApp1) -> linux:157 (KEY_COMPUTER) -> atset1:57451 */
        "LaunchApp2": 57377,

        /* html:LaunchApp2 (LaunchApp2) -> linux:140 (KEY_CALC) -> atset1:57377 */
        "LaunchMail": 57452,

        /* html:LaunchMail (LaunchMail) -> linux:155 (KEY_MAIL) -> atset1:57452 */
        "MediaPlayPause": 57378,

        /* html:MediaPlayPause (MediaPlayPause) -> linux:164 (KEY_PLAYPAUSE) -> atset1:57378 */
        "MediaSelect": 57453,

        /* html:MediaSelect (MediaSelect) -> linux:226 (KEY_MEDIA) -> atset1:57453 */
        "MediaStop": 57380,

        /* html:MediaStop (MediaStop) -> linux:166 (KEY_STOPCD) -> atset1:57380 */
        "MediaTrackNext": 57369,

        /* html:MediaTrackNext (MediaTrackNext) -> linux:163 (KEY_NEXTSONG) -> atset1:57369 */
        "MediaTrackPrevious": 57360,

        /* html:MediaTrackPrevious (MediaTrackPrevious) -> linux:165 (KEY_PREVIOUSSONG) -> atset1:57360 */
        "MetaLeft": 57435,

        /* html:MetaLeft (MetaLeft) -> linux:125 (KEY_LEFTMETA) -> atset1:57435 */
        "MetaRight": 57436,

        /* html:MetaRight (MetaRight) -> linux:126 (KEY_RIGHTMETA) -> atset1:57436 */
        "Minus": 12,

        /* html:Minus (Minus) -> linux:12 (KEY_MINUS) -> atset1:12 */
        "NonConvert": 123,

        /* html:NonConvert (NonConvert) -> linux:94 (KEY_MUHENKAN) -> atset1:123 */
        "NumLock": 69,

        /* html:NumLock (NumLock) -> linux:69 (KEY_NUMLOCK) -> atset1:69 */
        "Numpad0": 82,

        /* html:Numpad0 (Numpad0) -> linux:82 (KEY_KP0) -> atset1:82 */
        "Numpad1": 79,

        /* html:Numpad1 (Numpad1) -> linux:79 (KEY_KP1) -> atset1:79 */
        "Numpad2": 80,

        /* html:Numpad2 (Numpad2) -> linux:80 (KEY_KP2) -> atset1:80 */
        "Numpad3": 81,

        /* html:Numpad3 (Numpad3) -> linux:81 (KEY_KP3) -> atset1:81 */
        "Numpad4": 75,

        /* html:Numpad4 (Numpad4) -> linux:75 (KEY_KP4) -> atset1:75 */
        "Numpad5": 76,

        /* html:Numpad5 (Numpad5) -> linux:76 (KEY_KP5) -> atset1:76 */
        "Numpad6": 77,

        /* html:Numpad6 (Numpad6) -> linux:77 (KEY_KP6) -> atset1:77 */
        "Numpad7": 71,

        /* html:Numpad7 (Numpad7) -> linux:71 (KEY_KP7) -> atset1:71 */
        "Numpad8": 72,

        /* html:Numpad8 (Numpad8) -> linux:72 (KEY_KP8) -> atset1:72 */
        "Numpad9": 73,

        /* html:Numpad9 (Numpad9) -> linux:73 (KEY_KP9) -> atset1:73 */
        "NumpadAdd": 78,

        /* html:NumpadAdd (NumpadAdd) -> linux:78 (KEY_KPPLUS) -> atset1:78 */
        "NumpadComma": 126,

        /* html:NumpadComma (NumpadComma) -> linux:121 (KEY_KPCOMMA) -> atset1:126 */
        "NumpadDecimal": 83,

        /* html:NumpadDecimal (NumpadDecimal) -> linux:83 (KEY_KPDOT) -> atset1:83 */
        "NumpadDivide": 57397,

        /* html:NumpadDivide (NumpadDivide) -> linux:98 (KEY_KPSLASH) -> atset1:57397 */
        "NumpadEnter": 57372,

        /* html:NumpadEnter (NumpadEnter) -> linux:96 (KEY_KPENTER) -> atset1:57372 */
        "NumpadEqual": 89,

        /* html:NumpadEqual (NumpadEqual) -> linux:117 (KEY_KPEQUAL) -> atset1:89 */
        "NumpadMultiply": 55,

        /* html:NumpadMultiply (NumpadMultiply) -> linux:55 (KEY_KPASTERISK) -> atset1:55 */
        "NumpadParenLeft": 57462,

        /* html:NumpadParenLeft (NumpadParenLeft) -> linux:179 (KEY_KPLEFTPAREN) -> atset1:57462 */
        "NumpadParenRight": 57467,

        /* html:NumpadParenRight (NumpadParenRight) -> linux:180 (KEY_KPRIGHTPAREN) -> atset1:57467 */
        "NumpadSubtract": 74,

        /* html:NumpadSubtract (NumpadSubtract) -> linux:74 (KEY_KPMINUS) -> atset1:74 */
        "Open": 100,

        /* html:Open (Open) -> linux:134 (KEY_OPEN) -> atset1:100 */
        "PageDown": 57425,

        /* html:PageDown (PageDown) -> linux:109 (KEY_PAGEDOWN) -> atset1:57425 */
        "PageUp": 57417,

        /* html:PageUp (PageUp) -> linux:104 (KEY_PAGEUP) -> atset1:57417 */
        "Paste": 101,

        /* html:Paste (Paste) -> linux:135 (KEY_PASTE) -> atset1:101 */
        "Pause": 57414,

        /* html:Pause (Pause) -> linux:119 (KEY_PAUSE) -> atset1:57414 */
        "Period": 52,

        /* html:Period (Period) -> linux:52 (KEY_DOT) -> atset1:52 */
        "Power": 57438,

        /* html:Power (Power) -> linux:116 (KEY_POWER) -> atset1:57438 */
        "PrintScreen": 84,

        /* html:PrintScreen (PrintScreen) -> linux:99 (KEY_SYSRQ) -> atset1:84 */
        "Props": 57350,

        /* html:Props (Props) -> linux:130 (KEY_PROPS) -> atset1:57350 */
        "Quote": 40,

        /* html:Quote (Quote) -> linux:40 (KEY_APOSTROPHE) -> atset1:40 */
        "ScrollLock": 70,

        /* html:ScrollLock (ScrollLock) -> linux:70 (KEY_SCROLLLOCK) -> atset1:70 */
        "Semicolon": 39,

        /* html:Semicolon (Semicolon) -> linux:39 (KEY_SEMICOLON) -> atset1:39 */
        "ShiftLeft": 42,

        /* html:ShiftLeft (ShiftLeft) -> linux:42 (KEY_LEFTSHIFT) -> atset1:42 */
        "ShiftRight": 54,

        /* html:ShiftRight (ShiftRight) -> linux:54 (KEY_RIGHTSHIFT) -> atset1:54 */
        "Slash": 53,

        /* html:Slash (Slash) -> linux:53 (KEY_SLASH) -> atset1:53 */
        "Sleep": 57439,

        /* html:Sleep (Sleep) -> linux:142 (KEY_SLEEP) -> atset1:57439 */
        "Space": 57,

        /* html:Space (Space) -> linux:57 (KEY_SPACE) -> atset1:57 */
        "Suspend": 57381,

        /* html:Suspend (Suspend) -> linux:205 (KEY_SUSPEND) -> atset1:57381 */
        "Tab": 15,

        /* html:Tab (Tab) -> linux:15 (KEY_TAB) -> atset1:15 */
        "Undo": 57351,

        /* html:Undo (Undo) -> linux:131 (KEY_UNDO) -> atset1:57351 */
        "WakeUp": 57443

        /* html:WakeUp (WakeUp) -> linux:143 (KEY_WAKEUP) -> atset1:57443 */
      };
    }
  });

  // node_modules/@novnc/novnc/lib/encodings.js
  var require_encodings = __commonJS({
    "node_modules/@novnc/novnc/lib/encodings.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.encodingName = encodingName;
      exports.encodings = void 0;
      var encodings = exports.encodings = {
        encodingRaw: 0,
        encodingCopyRect: 1,
        encodingRRE: 2,
        encodingHextile: 5,
        encodingTight: 7,
        encodingZRLE: 16,
        encodingTightPNG: -260,
        encodingJPEG: 21,
        pseudoEncodingQualityLevel9: -23,
        pseudoEncodingQualityLevel0: -32,
        pseudoEncodingDesktopSize: -223,
        pseudoEncodingLastRect: -224,
        pseudoEncodingCursor: -239,
        pseudoEncodingQEMUExtendedKeyEvent: -258,
        pseudoEncodingQEMULedEvent: -261,
        pseudoEncodingDesktopName: -307,
        pseudoEncodingExtendedDesktopSize: -308,
        pseudoEncodingXvp: -309,
        pseudoEncodingFence: -312,
        pseudoEncodingContinuousUpdates: -313,
        pseudoEncodingCompressLevel9: -247,
        pseudoEncodingCompressLevel0: -256,
        pseudoEncodingVMwareCursor: 1464686180,
        pseudoEncodingExtendedClipboard: 3231835598
      };

      function encodingName(num) {
        switch (num) {
          case encodings.encodingRaw:
            return "Raw";
          case encodings.encodingCopyRect:
            return "CopyRect";
          case encodings.encodingRRE:
            return "RRE";
          case encodings.encodingHextile:
            return "Hextile";
          case encodings.encodingTight:
            return "Tight";
          case encodings.encodingZRLE:
            return "ZRLE";
          case encodings.encodingTightPNG:
            return "TightPNG";
          case encodings.encodingJPEG:
            return "JPEG";
          default:
            return "[unknown encoding " + num + "]";
        }
      }
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/aes.js
  var require_aes = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/aes.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.AESECBCipher = exports.AESEAXCipher = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _regeneratorRuntime() {
        "use strict";

        _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        };

        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, { value: r2, enumerable: true, configurable: true, writable: true }), t2[e2];
        }

        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }

        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);

          
return o(a2, "_invoke", { value: makeInvokeMethod(t2, r2, c2) }), a2;
        }

        function tryCatch(t2, e2, r2) {
          try {
            return { type: "normal", arg: t2.call(e2, r2) };
          } catch (t3) {
            return { type: "throw", arg: t3 };
          }
        }

        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

        function Generator() {
        }

        function GeneratorFunction() {
        }

        function GeneratorFunctionPrototype() {
        }

        var p = {};

        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));

        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }

        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);

            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;

              
return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }

            a2(c2.arg);
          }

          var r2;

          o(this, "_invoke", { value: function value(t3, n2) {
            function callInvokeWithMethodAndArg() {
              return new e2(function(e3, r3) {
                invoke(t3, n2, e3, r3);
              });
            }

            
return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
          } });
        }

        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;

          
return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");

            if (o2 === s) {
              if ("throw" === i2) throw a2;
              
return { value: t, done: true };
            }

            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;

              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);

                if (u2) {
                  if (u2 === y) continue;
                  
return u2;
                }
              }

              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);

              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                
return { value: p2.arg, done: n2.done };
              }

              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }

        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];

          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);

          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;

          
return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }

        function pushTryEntry(t2) {
          var e2 = { tryLoc: t2[0] };

          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }

        function resetTryEntry(t2) {
          var e2 = t2.completion || {};

          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }

        function Context(t2) {
          this.tryEntries = [{ tryLoc: "root" }], t2.forEach(pushTryEntry, this), this.reset(true);
        }

        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];

            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;

            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                
return next.value = t, next.done = true, next;
              };

              
return i2.next = i2;
            }
          }

          throw new TypeError(_typeof(e2) + " is not iterable");
        }

        
return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: true }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: true }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;

          
return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return { __await: t2 };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);

          
return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];

          for (var n2 in e2) r2.push(n2);

          
return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();

              if (t3 in e2) return next.value = t3, next.done = false, next;
            }

            
return next.done = true, next;
          };
        }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e2) {
          if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
        }, stop: function stop() {
          this.done = true;
          var t2 = this.tryEntries[0].completion;

          if ("throw" === t2.type) throw t2.arg;
          
return this.rval;
        }, dispatchException: function dispatchException(e2) {
          if (this.done) throw e2;
          var r2 = this;

          function handle(n2, o3) {
            return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
          }

          for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
            var i2 = this.tryEntries[o2], a2 = i2.completion;

            if ("root" === i2.tryLoc) return handle("end");

            if (i2.tryLoc <= this.prev) {
              var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");

              if (c2 && u2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              } else if (c2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
              } else {
                if (!u2) throw Error("try statement without catch or finally");
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              }
            }
          }
        }, abrupt: function abrupt(t2, e2) {
          for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
            var o2 = this.tryEntries[r2];

            if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
              var i2 = o2;

              break;
            }
          }

          i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
          var a2 = i2 ? i2.completion : {};

          
return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
        }, complete: function complete(t2, e2) {
          if ("throw" === t2.type) throw t2.arg;
          
return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
        }, finish: function finish(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
          }
        }, "catch": function _catch(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.tryLoc === t2) {
              var n2 = r2.completion;

              if ("throw" === n2.type) {
                var o2 = n2.arg;

                resetTryEntry(r2);
              }

              
return o2;
            }
          }

          throw Error("illegal catch attempt");
        }, delegateYield: function delegateYield(e2, r2, n2) {
          return this.delegate = { iterator: values(e2), resultName: r2, nextLoc: n2 }, "next" === this.method && (this.arg = t), y;
        } }, e;
      }

      function asyncGeneratorStep(n, t, e, r, o, a, c) {
        try {
          var i = n[a](c), u = i.value;
        } catch (n2) {
          return void e(n2);
        }

        i.done ? t(u) : Promise.resolve(u).then(r, o);
      }

      function _asyncToGenerator(n) {
        return function() {
          var t = this, e = arguments;

          
return new Promise(function(r, o) {
            var a = n.apply(t, e);

            function _next(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
            }

            function _throw(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
            }

            _next(void 0);
          });
        };
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var AESECBCipher = exports.AESECBCipher = /* @__PURE__ */ (function() {
        function AESECBCipher2() {
          _classCallCheck(this, AESECBCipher2);
          this._key = null;
        }

        
return _createClass(AESECBCipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "AES-ECB"
            };
          }
        }, {
          key: "_importKey",
          value: (function() {
            var _importKey2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee(key, extractable, keyUsages) {
              return _regeneratorRuntime().wrap(function _callee$(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    _context.next = 2;
                    
return window.crypto.subtle.importKey("raw", key, {
                      name: "AES-CBC"
                    }, extractable, keyUsages);
                  case 2:
                    this._key = _context.sent;
                  case 3:
                  case "end":
                    return _context.stop();
                }
              }, _callee, this);
            }));

            function _importKey(_x, _x2, _x3) {
              return _importKey2.apply(this, arguments);
            }

            
return _importKey;
          })()
        }, {
          key: "encrypt",
          value: (function() {
            var _encrypt = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee2(_algorithm, plaintext) {
              var x, n, i, y;

              
return _regeneratorRuntime().wrap(function _callee2$(_context2) {
                while (1) switch (_context2.prev = _context2.next) {
                  case 0:
                    x = new Uint8Array(plaintext);

                    if (!(x.length % 16 !== 0 || this._key === null)) {
                      _context2.next = 3;
                      break;
                    }

                    
return _context2.abrupt("return", null);
                  case 3:
                    n = x.length / 16;
                    i = 0;
                  case 5:
                    if (!(i < n)) {
                      _context2.next = 15;
                      break;
                    }

                    _context2.t0 = Uint8Array;
                    _context2.next = 9;
                    
return window.crypto.subtle.encrypt({
                      name: "AES-CBC",
                      iv: new Uint8Array(16)
                    }, this._key, x.slice(i * 16, i * 16 + 16));
                  case 9:
                    _context2.t1 = _context2.sent;
                    y = new _context2.t0(_context2.t1).slice(0, 16);
                    x.set(y, i * 16);
                  case 12:
                    i++;
                    _context2.next = 5;
                    break;
                  case 15:
                    return _context2.abrupt("return", x);
                  case 16:
                  case "end":
                    return _context2.stop();
                }
              }, _callee2, this);
            }));

            function encrypt(_x4, _x5) {
              return _encrypt.apply(this, arguments);
            }

            
return encrypt;
          })()
        }], [{
          key: "importKey",
          value: (function() {
            var _importKey3 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee3(key, _algorithm, extractable, keyUsages) {
              var cipher;

              
return _regeneratorRuntime().wrap(function _callee3$(_context3) {
                while (1) switch (_context3.prev = _context3.next) {
                  case 0:
                    cipher = new AESECBCipher2();
                    _context3.next = 3;
                    
return cipher._importKey(key, extractable, keyUsages);
                  case 3:
                    return _context3.abrupt("return", cipher);
                  case 4:
                  case "end":
                    return _context3.stop();
                }
              }, _callee3);
            }));

            function importKey(_x6, _x7, _x8, _x9) {
              return _importKey3.apply(this, arguments);
            }

            
return importKey;
          })()
        }]);
      })();
      var AESEAXCipher = exports.AESEAXCipher = /* @__PURE__ */ (function() {
        function AESEAXCipher2() {
          _classCallCheck(this, AESEAXCipher2);
          this._rawKey = null;
          this._ctrKey = null;
          this._cbcKey = null;
          this._zeroBlock = new Uint8Array(16);
          this._prefixBlock0 = this._zeroBlock;
          this._prefixBlock1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
          this._prefixBlock2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
        }

        
return _createClass(AESEAXCipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "AES-EAX"
            };
          }
        }, {
          key: "_encryptBlock",
          value: (function() {
            var _encryptBlock2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee4(block) {
              var encrypted;

              
return _regeneratorRuntime().wrap(function _callee4$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    _context4.next = 2;
                    
return window.crypto.subtle.encrypt({
                      name: "AES-CBC",
                      iv: this._zeroBlock
                    }, this._cbcKey, block);
                  case 2:
                    encrypted = _context4.sent;
                    
return _context4.abrupt("return", new Uint8Array(encrypted).slice(0, 16));
                  case 4:
                  case "end":
                    return _context4.stop();
                }
              }, _callee4, this);
            }));

            function _encryptBlock(_x10) {
              return _encryptBlock2.apply(this, arguments);
            }

            
return _encryptBlock;
          })()
        }, {
          key: "_initCMAC",
          value: (function() {
            var _initCMAC2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee5() {
              var k1, k2, v, i, lut;

              
return _regeneratorRuntime().wrap(function _callee5$(_context5) {
                while (1) switch (_context5.prev = _context5.next) {
                  case 0:
                    _context5.next = 2;
                    
return this._encryptBlock(this._zeroBlock);
                  case 2:
                    k1 = _context5.sent;
                    k2 = new Uint8Array(16);
                    v = k1[0] >>> 6;

                    for (i = 0; i < 15; i++) {
                      k2[i] = k1[i + 1] >> 6 | k1[i] << 2;
                      k1[i] = k1[i + 1] >> 7 | k1[i] << 1;
                    }

                    lut = [0, 135, 14, 137];
                    k2[14] ^= v >>> 1;
                    k2[15] = k1[15] << 2 ^ lut[v];
                    k1[15] = k1[15] << 1 ^ lut[v >> 1];
                    this._k1 = k1;
                    this._k2 = k2;
                  case 12:
                  case "end":
                    return _context5.stop();
                }
              }, _callee5, this);
            }));

            function _initCMAC() {
              return _initCMAC2.apply(this, arguments);
            }

            
return _initCMAC;
          })()
        }, {
          key: "_encryptCTR",
          value: (function() {
            var _encryptCTR2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee6(data, counter) {
              var encrypted;

              
return _regeneratorRuntime().wrap(function _callee6$(_context6) {
                while (1) switch (_context6.prev = _context6.next) {
                  case 0:
                    _context6.next = 2;
                    
return window.crypto.subtle.encrypt({
                      name: "AES-CTR",
                      counter,
                      length: 128
                    }, this._ctrKey, data);
                  case 2:
                    encrypted = _context6.sent;
                    
return _context6.abrupt("return", new Uint8Array(encrypted));
                  case 4:
                  case "end":
                    return _context6.stop();
                }
              }, _callee6, this);
            }));

            function _encryptCTR(_x11, _x12) {
              return _encryptCTR2.apply(this, arguments);
            }

            
return _encryptCTR;
          })()
        }, {
          key: "_decryptCTR",
          value: (function() {
            var _decryptCTR2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee7(data, counter) {
              var decrypted;

              
return _regeneratorRuntime().wrap(function _callee7$(_context7) {
                while (1) switch (_context7.prev = _context7.next) {
                  case 0:
                    _context7.next = 2;
                    
return window.crypto.subtle.decrypt({
                      name: "AES-CTR",
                      counter,
                      length: 128
                    }, this._ctrKey, data);
                  case 2:
                    decrypted = _context7.sent;
                    
return _context7.abrupt("return", new Uint8Array(decrypted));
                  case 4:
                  case "end":
                    return _context7.stop();
                }
              }, _callee7, this);
            }));

            function _decryptCTR(_x13, _x14) {
              return _decryptCTR2.apply(this, arguments);
            }

            
return _decryptCTR;
          })()
        }, {
          key: "_computeCMAC",
          value: (function() {
            var _computeCMAC2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee8(data, prefixBlock) {
              var n, m, r, cbcData, i, _i, cbcEncrypted, mac;

              
return _regeneratorRuntime().wrap(function _callee8$(_context8) {
                while (1) switch (_context8.prev = _context8.next) {
                  case 0:
                    if (!(prefixBlock.length !== 16)) {
                      _context8.next = 2;
                      break;
                    }

                    
return _context8.abrupt("return", null);
                  case 2:
                    n = Math.floor(data.length / 16);
                    m = Math.ceil(data.length / 16);
                    r = data.length - n * 16;
                    cbcData = new Uint8Array((m + 1) * 16);
                    cbcData.set(prefixBlock);
                    cbcData.set(data, 16);

                    if (r === 0) {
                      for (i = 0; i < 16; i++) {
                        cbcData[n * 16 + i] ^= this._k1[i];
                      }
                    } else {
                      cbcData[(n + 1) * 16 + r] = 128;

                      for (_i = 0; _i < 16; _i++) {
                        cbcData[(n + 1) * 16 + _i] ^= this._k2[_i];
                      }
                    }

                    _context8.next = 11;
                    
return window.crypto.subtle.encrypt({
                      name: "AES-CBC",
                      iv: this._zeroBlock
                    }, this._cbcKey, cbcData);
                  case 11:
                    cbcEncrypted = _context8.sent;
                    cbcEncrypted = new Uint8Array(cbcEncrypted);
                    mac = cbcEncrypted.slice(cbcEncrypted.length - 32, cbcEncrypted.length - 16);
                    
return _context8.abrupt("return", mac);
                  case 15:
                  case "end":
                    return _context8.stop();
                }
              }, _callee8, this);
            }));

            function _computeCMAC(_x15, _x16) {
              return _computeCMAC2.apply(this, arguments);
            }

            
return _computeCMAC;
          })()
        }, {
          key: "_importKey",
          value: (function() {
            var _importKey4 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee9(key) {
              return _regeneratorRuntime().wrap(function _callee9$(_context9) {
                while (1) switch (_context9.prev = _context9.next) {
                  case 0:
                    this._rawKey = key;
                    _context9.next = 3;
                    
return window.crypto.subtle.importKey("raw", key, {
                      name: "AES-CTR"
                    }, false, ["encrypt", "decrypt"]);
                  case 3:
                    this._ctrKey = _context9.sent;
                    _context9.next = 6;
                    
return window.crypto.subtle.importKey("raw", key, {
                      name: "AES-CBC"
                    }, false, ["encrypt"]);
                  case 6:
                    this._cbcKey = _context9.sent;
                    _context9.next = 9;
                    
return this._initCMAC();
                  case 9:
                  case "end":
                    return _context9.stop();
                }
              }, _callee9, this);
            }));

            function _importKey(_x17) {
              return _importKey4.apply(this, arguments);
            }

            
return _importKey;
          })()
        }, {
          key: "encrypt",
          value: (function() {
            var _encrypt2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee10(algorithm, message) {
              var ad, nonce, nCMAC, encrypted, adCMAC, mac, i, res;

              
return _regeneratorRuntime().wrap(function _callee10$(_context10) {
                while (1) switch (_context10.prev = _context10.next) {
                  case 0:
                    ad = algorithm.additionalData;
                    nonce = algorithm.iv;
                    _context10.next = 4;
                    
return this._computeCMAC(nonce, this._prefixBlock0);
                  case 4:
                    nCMAC = _context10.sent;
                    _context10.next = 7;
                    
return this._encryptCTR(message, nCMAC);
                  case 7:
                    encrypted = _context10.sent;
                    _context10.next = 10;
                    
return this._computeCMAC(ad, this._prefixBlock1);
                  case 10:
                    adCMAC = _context10.sent;
                    _context10.next = 13;
                    
return this._computeCMAC(encrypted, this._prefixBlock2);
                  case 13:
                    mac = _context10.sent;

                    for (i = 0; i < 16; i++) {
                      mac[i] ^= nCMAC[i] ^ adCMAC[i];
                    }

                    res = new Uint8Array(16 + encrypted.length);
                    res.set(encrypted);
                    res.set(mac, encrypted.length);
                    
return _context10.abrupt("return", res);
                  case 19:
                  case "end":
                    return _context10.stop();
                }
              }, _callee10, this);
            }));

            function encrypt(_x18, _x19) {
              return _encrypt2.apply(this, arguments);
            }

            
return encrypt;
          })()
        }, {
          key: "decrypt",
          value: (function() {
            var _decrypt = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee11(algorithm, data) {
              var encrypted, ad, nonce, mac, nCMAC, adCMAC, computedMac, i, _i2, res;

              
return _regeneratorRuntime().wrap(function _callee11$(_context11) {
                while (1) switch (_context11.prev = _context11.next) {
                  case 0:
                    encrypted = data.slice(0, data.length - 16);
                    ad = algorithm.additionalData;
                    nonce = algorithm.iv;
                    mac = data.slice(data.length - 16);
                    _context11.next = 6;
                    
return this._computeCMAC(nonce, this._prefixBlock0);
                  case 6:
                    nCMAC = _context11.sent;
                    _context11.next = 9;
                    
return this._computeCMAC(ad, this._prefixBlock1);
                  case 9:
                    adCMAC = _context11.sent;
                    _context11.next = 12;
                    
return this._computeCMAC(encrypted, this._prefixBlock2);
                  case 12:
                    computedMac = _context11.sent;

                    for (i = 0; i < 16; i++) {
                      computedMac[i] ^= nCMAC[i] ^ adCMAC[i];
                    }

                    if (!(computedMac.length !== mac.length)) {
                      _context11.next = 16;
                      break;
                    }

                    
return _context11.abrupt("return", null);
                  case 16:
                    _i2 = 0;
                  case 17:
                    if (!(_i2 < mac.length)) {
                      _context11.next = 23;
                      break;
                    }

                    if (!(computedMac[_i2] !== mac[_i2])) {
                      _context11.next = 20;
                      break;
                    }

                    
return _context11.abrupt("return", null);
                  case 20:
                    _i2++;
                    _context11.next = 17;
                    break;
                  case 23:
                    _context11.next = 25;
                    
return this._decryptCTR(encrypted, nCMAC);
                  case 25:
                    res = _context11.sent;
                    
return _context11.abrupt("return", res);
                  case 27:
                  case "end":
                    return _context11.stop();
                }
              }, _callee11, this);
            }));

            function decrypt(_x20, _x21) {
              return _decrypt.apply(this, arguments);
            }

            
return decrypt;
          })()
        }], [{
          key: "importKey",
          value: (function() {
            var _importKey5 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee12(key, _algorithm, _extractable, _keyUsages) {
              var cipher;

              
return _regeneratorRuntime().wrap(function _callee12$(_context12) {
                while (1) switch (_context12.prev = _context12.next) {
                  case 0:
                    cipher = new AESEAXCipher2();
                    _context12.next = 3;
                    
return cipher._importKey(key);
                  case 3:
                    return _context12.abrupt("return", cipher);
                  case 4:
                  case "end":
                    return _context12.stop();
                }
              }, _callee12);
            }));

            function importKey(_x22, _x23, _x24, _x25) {
              return _importKey5.apply(this, arguments);
            }

            
return importKey;
          })()
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/des.js
  var require_des = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/des.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.DESECBCipher = exports.DESCBCCipher = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a2, n) {
        if (!(a2 instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e2, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e2, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e2, r, t) {
        return r && _defineProperties(e2.prototype, r), t && _defineProperties(e2, t), Object.defineProperty(e2, "prototype", { writable: false }), e2;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e2 = t[Symbol.toPrimitive];

        if (void 0 !== e2) {
          var i = e2.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var PC2 = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];
      var totrot = [1, 2, 4, 6, 8, 10, 12, 14, 15, 17, 19, 21, 23, 25, 27, 28];
      var z = 0;
      var a;
      var b;
      var c;
      var d;
      var e;
      var f;

      a = 1 << 16;
      b = 1 << 24;
      c = a | b;
      d = 1 << 2;
      e = 1 << 10;
      f = d | e;
      var SP1 = [c | e, z | z, a | z, c | f, c | d, a | f, z | d, a | z, z | e, c | e, c | f, z | e, b | f, c | d, b | z, z | d, z | f, b | e, b | e, a | e, a | e, c | z, c | z, b | f, a | d, b | d, b | d, a | d, z | z, z | f, a | f, b | z, a | z, c | f, z | d, c | z, c | e, b | z, b | z, z | e, c | d, a | z, a | e, b | d, z | e, z | d, b | f, a | f, c | f, a | d, c | z, b | f, b | d, z | f, a | f, c | e, z | f, b | e, b | e, z | z, a | d, a | e, z | z, c | d];

      a = 1 << 20;
      b = 1 << 31;
      c = a | b;
      d = 1 << 5;
      e = 1 << 15;
      f = d | e;
      var SP2 = [c | f, b | e, z | e, a | f, a | z, z | d, c | d, b | f, b | d, c | f, c | e, b | z, b | e, a | z, z | d, c | d, a | e, a | d, b | f, z | z, b | z, z | e, a | f, c | z, a | d, b | d, z | z, a | e, z | f, c | e, c | z, z | f, z | z, a | f, c | d, a | z, b | f, c | z, c | e, z | e, c | z, b | e, z | d, c | f, a | f, z | d, z | e, b | z, z | f, c | e, a | z, b | d, a | d, b | f, b | d, a | d, a | e, z | z, b | e, z | f, b | z, c | d, c | f, a | e];

      a = 1 << 17;
      b = 1 << 27;
      c = a | b;
      d = 1 << 3;
      e = 1 << 9;
      f = d | e;
      var SP3 = [z | f, c | e, z | z, c | d, b | e, z | z, a | f, b | e, a | d, b | d, b | d, a | z, c | f, a | d, c | z, z | f, b | z, z | d, c | e, z | e, a | e, c | z, c | d, a | f, b | f, a | e, a | z, b | f, z | d, c | f, z | e, b | z, c | e, b | z, a | d, z | f, a | z, c | e, b | e, z | z, z | e, a | d, c | f, b | e, b | d, z | e, z | z, c | d, b | f, a | z, b | z, c | f, z | d, a | f, a | e, b | d, c | z, b | f, z | f, c | z, a | f, z | d, c | d, a | e];

      a = 1 << 13;
      b = 1 << 23;
      c = a | b;
      d = 1 << 0;
      e = 1 << 7;
      f = d | e;
      var SP4 = [c | d, a | f, a | f, z | e, c | e, b | f, b | d, a | d, z | z, c | z, c | z, c | f, z | f, z | z, b | e, b | d, z | d, a | z, b | z, c | d, z | e, b | z, a | d, a | e, b | f, z | d, a | e, b | e, a | z, c | e, c | f, z | f, b | e, b | d, c | z, c | f, z | f, z | z, z | z, c | z, a | e, b | e, b | f, z | d, c | d, a | f, a | f, z | e, c | f, z | f, z | d, a | z, b | d, a | d, c | e, b | f, a | d, a | e, b | z, c | d, z | e, b | z, a | z, c | e];

      a = 1 << 25;
      b = 1 << 30;
      c = a | b;
      d = 1 << 8;
      e = 1 << 19;
      f = d | e;
      var SP5 = [z | d, a | f, a | e, c | d, z | e, z | d, b | z, a | e, b | f, z | e, a | d, b | f, c | d, c | e, z | f, b | z, a | z, b | e, b | e, z | z, b | d, c | f, c | f, a | d, c | e, b | d, z | z, c | z, a | f, a | z, c | z, z | f, z | e, c | d, z | d, a | z, b | z, a | e, c | d, b | f, a | d, b | z, c | e, a | f, b | f, z | d, a | z, c | e, c | f, z | f, c | z, c | f, a | e, z | z, b | e, c | z, z | f, a | d, b | d, z | e, z | z, b | e, a | f, b | d];

      a = 1 << 22;
      b = 1 << 29;
      c = a | b;
      d = 1 << 4;
      e = 1 << 14;
      f = d | e;
      var SP6 = [b | d, c | z, z | e, c | f, c | z, z | d, c | f, a | z, b | e, a | f, a | z, b | d, a | d, b | e, b | z, z | f, z | z, a | d, b | f, z | e, a | e, b | f, z | d, c | d, c | d, z | z, a | f, c | e, z | f, a | e, c | e, b | z, b | e, z | d, c | d, a | e, c | f, a | z, z | f, b | d, a | z, b | e, b | z, z | f, b | d, c | f, a | e, c | z, a | f, c | e, z | z, c | d, z | d, z | e, c | z, a | f, z | e, a | d, b | f, z | z, c | e, b | z, a | d, b | f];

      a = 1 << 21;
      b = 1 << 26;
      c = a | b;
      d = 1 << 1;
      e = 1 << 11;
      f = d | e;
      var SP7 = [a | z, c | d, b | f, z | z, z | e, b | f, a | f, c | e, c | f, a | z, z | z, b | d, z | d, b | z, c | d, z | f, b | e, a | f, a | d, b | e, b | d, c | z, c | e, a | d, c | z, z | e, z | f, c | f, a | e, z | d, b | z, a | e, b | z, a | e, a | z, b | f, b | f, c | d, c | d, z | d, a | d, b | z, b | e, a | z, c | e, z | f, a | f, c | e, z | f, b | d, c | f, c | z, a | e, z | z, z | d, c | f, z | z, a | f, c | z, z | e, b | d, b | e, z | e, a | d];

      a = 1 << 18;
      b = 1 << 28;
      c = a | b;
      d = 1 << 6;
      e = 1 << 12;
      f = d | e;
      var SP8 = [b | f, z | e, a | z, c | f, b | z, b | f, z | d, b | z, a | d, c | z, c | f, a | e, c | e, a | f, z | e, z | d, c | z, b | d, b | e, z | f, a | e, a | d, c | d, c | e, z | f, z | z, z | z, c | d, b | d, b | e, a | f, a | z, a | f, a | z, c | e, z | e, z | d, c | d, z | e, a | f, b | e, z | d, b | d, c | z, c | d, b | z, a | z, b | f, z | z, c | f, a | d, b | d, c | z, b | e, b | f, z | z, c | f, a | e, a | e, z | f, z | f, a | d, b | z, c | e];
      var DES = /* @__PURE__ */ (function() {
        function DES2(password) {
          _classCallCheck(this, DES2);
          this.keys = [];
          var pc1m = [], pcr = [], kn = [];

          for (var j = 0, l = 56; j < 56; ++j, l -= 8) {
            l += l < -5 ? 65 : l < -3 ? 31 : l < -1 ? 63 : l === 27 ? 35 : 0;
            var m = l & 7;

            pc1m[j] = (password[l >>> 3] & 1 << m) !== 0 ? 1 : 0;
          }

          for (var i = 0; i < 16; ++i) {
            var _m = i << 1;
            var n = _m + 1;

            kn[_m] = kn[n] = 0;

            for (var o = 28; o < 59; o += 28) {
              for (var _j = o - 28; _j < o; ++_j) {
                var _l = _j + totrot[i];

                pcr[_j] = _l < o ? pc1m[_l] : pc1m[_l - 28];
              }
            }

            for (var _j2 = 0; _j2 < 24; ++_j2) {
              if (pcr[PC2[_j2]] !== 0) {
                kn[_m] |= 1 << 23 - _j2;
              }

              if (pcr[PC2[_j2 + 24]] !== 0) {
                kn[n] |= 1 << 23 - _j2;
              }
            }
          }

          for (var _i = 0, rawi = 0, KnLi = 0; _i < 16; ++_i) {
            var raw0 = kn[rawi++];
            var raw1 = kn[rawi++];

            this.keys[KnLi] = (raw0 & 16515072) << 6;
            this.keys[KnLi] |= (raw0 & 4032) << 10;
            this.keys[KnLi] |= (raw1 & 16515072) >>> 10;
            this.keys[KnLi] |= (raw1 & 4032) >>> 6;
            ++KnLi;
            this.keys[KnLi] = (raw0 & 258048) << 12;
            this.keys[KnLi] |= (raw0 & 63) << 16;
            this.keys[KnLi] |= (raw1 & 258048) >>> 4;
            this.keys[KnLi] |= raw1 & 63;
            ++KnLi;
          }
        }

        
return _createClass(DES2, [{
          key: "enc8",
          value: function enc8(text) {
            var b2 = text.slice();
            var i = 0, l, r, x;

            l = b2[i++] << 24 | b2[i++] << 16 | b2[i++] << 8 | b2[i++];
            r = b2[i++] << 24 | b2[i++] << 16 | b2[i++] << 8 | b2[i++];
            x = (l >>> 4 ^ r) & 252645135;
            r ^= x;
            l ^= x << 4;
            x = (l >>> 16 ^ r) & 65535;
            r ^= x;
            l ^= x << 16;
            x = (r >>> 2 ^ l) & 858993459;
            l ^= x;
            r ^= x << 2;
            x = (r >>> 8 ^ l) & 16711935;
            l ^= x;
            r ^= x << 8;
            r = r << 1 | r >>> 31 & 1;
            x = (l ^ r) & 2863311530;
            l ^= x;
            r ^= x;
            l = l << 1 | l >>> 31 & 1;

            for (var _i2 = 0, keysi = 0; _i2 < 8; ++_i2) {
              x = r << 28 | r >>> 4;
              x ^= this.keys[keysi++];
              var fval = SP7[x & 63];

              fval |= SP5[x >>> 8 & 63];
              fval |= SP3[x >>> 16 & 63];
              fval |= SP1[x >>> 24 & 63];
              x = r ^ this.keys[keysi++];
              fval |= SP8[x & 63];
              fval |= SP6[x >>> 8 & 63];
              fval |= SP4[x >>> 16 & 63];
              fval |= SP2[x >>> 24 & 63];
              l ^= fval;
              x = l << 28 | l >>> 4;
              x ^= this.keys[keysi++];
              fval = SP7[x & 63];
              fval |= SP5[x >>> 8 & 63];
              fval |= SP3[x >>> 16 & 63];
              fval |= SP1[x >>> 24 & 63];
              x = l ^ this.keys[keysi++];
              fval |= SP8[x & 63];
              fval |= SP6[x >>> 8 & 63];
              fval |= SP4[x >>> 16 & 63];
              fval |= SP2[x >>> 24 & 63];
              r ^= fval;
            }

            r = r << 31 | r >>> 1;
            x = (l ^ r) & 2863311530;
            l ^= x;
            r ^= x;
            l = l << 31 | l >>> 1;
            x = (l >>> 8 ^ r) & 16711935;
            r ^= x;
            l ^= x << 8;
            x = (l >>> 2 ^ r) & 858993459;
            r ^= x;
            l ^= x << 2;
            x = (r >>> 16 ^ l) & 65535;
            l ^= x;
            r ^= x << 16;
            x = (r >>> 4 ^ l) & 252645135;
            l ^= x;
            r ^= x << 4;
            x = [r, l];

            for (i = 0; i < 8; i++) {
              b2[i] = (x[i >>> 2] >>> 8 * (3 - i % 4)) % 256;

              if (b2[i] < 0) {
                b2[i] += 256;
              }
            }

            
return b2;
          }
        }]);
      })();
      var DESECBCipher = exports.DESECBCipher = /* @__PURE__ */ (function() {
        function DESECBCipher2() {
          _classCallCheck(this, DESECBCipher2);
          this._cipher = null;
        }

        
return _createClass(DESECBCipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "DES-ECB"
            };
          }
        }, {
          key: "_importKey",
          value: function _importKey(key, _extractable, _keyUsages) {
            this._cipher = new DES(key);
          }
        }, {
          key: "encrypt",
          value: function encrypt(_algorithm, plaintext) {
            var x = new Uint8Array(plaintext);

            if (x.length % 8 !== 0 || this._cipher === null) {
              return null;
            }

            var n = x.length / 8;

            for (var i = 0; i < n; i++) {
              x.set(this._cipher.enc8(x.slice(i * 8, i * 8 + 8)), i * 8);
            }

            
return x;
          }
        }], [{
          key: "importKey",
          value: function importKey(key, _algorithm, _extractable, _keyUsages) {
            var cipher = new DESECBCipher2();

            cipher._importKey(key);
            
return cipher;
          }
        }]);
      })();
      var DESCBCCipher = exports.DESCBCCipher = /* @__PURE__ */ (function() {
        function DESCBCCipher2() {
          _classCallCheck(this, DESCBCCipher2);
          this._cipher = null;
        }

        
return _createClass(DESCBCCipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "DES-CBC"
            };
          }
        }, {
          key: "_importKey",
          value: function _importKey(key) {
            this._cipher = new DES(key);
          }
        }, {
          key: "encrypt",
          value: function encrypt(algorithm, plaintext) {
            var x = new Uint8Array(plaintext);
            var y = new Uint8Array(algorithm.iv);

            if (x.length % 8 !== 0 || this._cipher === null) {
              return null;
            }

            var n = x.length / 8;

            for (var i = 0; i < n; i++) {
              for (var j = 0; j < 8; j++) {
                y[j] ^= plaintext[i * 8 + j];
              }

              y = this._cipher.enc8(y);
              x.set(y, i * 8);
            }

            
return x;
          }
        }], [{
          key: "importKey",
          value: function importKey(key, _algorithm, _extractable, _keyUsages) {
            var cipher = new DESCBCCipher2();

            cipher._importKey(key);
            
return cipher;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/bigint.js
  var require_bigint = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/bigint.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.bigIntToU8Array = bigIntToU8Array;
      exports.modPow = modPow;
      exports.u8ArrayToBigInt = u8ArrayToBigInt;

      function modPow(b, e, m) {
        var r = 1n;

        b = b % m;

        while (e > 0n) {
          if ((e & 1n) === 1n) {
            r = r * b % m;
          }

          e = e >> 1n;
          b = b * b % m;
        }

        
return r;
      }

      function bigIntToU8Array(bigint) {
        var padLength = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
        var hex = bigint.toString(16);

        if (padLength === 0) {
          padLength = Math.ceil(hex.length / 2);
        }

        hex = hex.padStart(padLength * 2, "0");
        var length = hex.length / 2;
        var arr = new Uint8Array(length);

        for (var i = 0; i < length; i++) {
          arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }

        
return arr;
      }

      function u8ArrayToBigInt(arr) {
        var hex = "0x";

        for (var i = 0; i < arr.length; i++) {
          hex += arr[i].toString(16).padStart(2, "0");
        }

        
return BigInt(hex);
      }
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/rsa.js
  var require_rsa = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/rsa.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.RSACipher = void 0;
      var _base = _interopRequireDefault(require_base64());
      var _bigint = require_bigint();

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _regeneratorRuntime() {
        "use strict";

        _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        };

        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, { value: r2, enumerable: true, configurable: true, writable: true }), t2[e2];
        }

        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }

        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);

          
return o(a2, "_invoke", { value: makeInvokeMethod(t2, r2, c2) }), a2;
        }

        function tryCatch(t2, e2, r2) {
          try {
            return { type: "normal", arg: t2.call(e2, r2) };
          } catch (t3) {
            return { type: "throw", arg: t3 };
          }
        }

        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

        function Generator() {
        }

        function GeneratorFunction() {
        }

        function GeneratorFunctionPrototype() {
        }

        var p = {};

        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));

        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }

        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);

            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;

              
return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }

            a2(c2.arg);
          }

          var r2;

          o(this, "_invoke", { value: function value(t3, n2) {
            function callInvokeWithMethodAndArg() {
              return new e2(function(e3, r3) {
                invoke(t3, n2, e3, r3);
              });
            }

            
return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
          } });
        }

        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;

          
return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");

            if (o2 === s) {
              if ("throw" === i2) throw a2;
              
return { value: t, done: true };
            }

            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;

              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);

                if (u2) {
                  if (u2 === y) continue;
                  
return u2;
                }
              }

              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);

              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                
return { value: p2.arg, done: n2.done };
              }

              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }

        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];

          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);

          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;

          
return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }

        function pushTryEntry(t2) {
          var e2 = { tryLoc: t2[0] };

          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }

        function resetTryEntry(t2) {
          var e2 = t2.completion || {};

          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }

        function Context(t2) {
          this.tryEntries = [{ tryLoc: "root" }], t2.forEach(pushTryEntry, this), this.reset(true);
        }

        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];

            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;

            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                
return next.value = t, next.done = true, next;
              };

              
return i2.next = i2;
            }
          }

          throw new TypeError(_typeof(e2) + " is not iterable");
        }

        
return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: true }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: true }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;

          
return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return { __await: t2 };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);

          
return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];

          for (var n2 in e2) r2.push(n2);

          
return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();

              if (t3 in e2) return next.value = t3, next.done = false, next;
            }

            
return next.done = true, next;
          };
        }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e2) {
          if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
        }, stop: function stop() {
          this.done = true;
          var t2 = this.tryEntries[0].completion;

          if ("throw" === t2.type) throw t2.arg;
          
return this.rval;
        }, dispatchException: function dispatchException(e2) {
          if (this.done) throw e2;
          var r2 = this;

          function handle(n2, o3) {
            return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
          }

          for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
            var i2 = this.tryEntries[o2], a2 = i2.completion;

            if ("root" === i2.tryLoc) return handle("end");

            if (i2.tryLoc <= this.prev) {
              var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");

              if (c2 && u2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              } else if (c2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
              } else {
                if (!u2) throw Error("try statement without catch or finally");
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              }
            }
          }
        }, abrupt: function abrupt(t2, e2) {
          for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
            var o2 = this.tryEntries[r2];

            if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
              var i2 = o2;

              break;
            }
          }

          i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
          var a2 = i2 ? i2.completion : {};

          
return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
        }, complete: function complete(t2, e2) {
          if ("throw" === t2.type) throw t2.arg;
          
return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
        }, finish: function finish(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
          }
        }, "catch": function _catch(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.tryLoc === t2) {
              var n2 = r2.completion;

              if ("throw" === n2.type) {
                var o2 = n2.arg;

                resetTryEntry(r2);
              }

              
return o2;
            }
          }

          throw Error("illegal catch attempt");
        }, delegateYield: function delegateYield(e2, r2, n2) {
          return this.delegate = { iterator: values(e2), resultName: r2, nextLoc: n2 }, "next" === this.method && (this.arg = t), y;
        } }, e;
      }

      function asyncGeneratorStep(n, t, e, r, o, a, c) {
        try {
          var i = n[a](c), u = i.value;
        } catch (n2) {
          return void e(n2);
        }

        i.done ? t(u) : Promise.resolve(u).then(r, o);
      }

      function _asyncToGenerator(n) {
        return function() {
          var t = this, e = arguments;

          
return new Promise(function(r, o) {
            var a = n.apply(t, e);

            function _next(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
            }

            function _throw(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
            }

            _next(void 0);
          });
        };
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var RSACipher = exports.RSACipher = /* @__PURE__ */ (function() {
        function RSACipher2() {
          _classCallCheck(this, RSACipher2);
          this._keyLength = 0;
          this._keyBytes = 0;
          this._n = null;
          this._e = null;
          this._d = null;
          this._nBigInt = null;
          this._eBigInt = null;
          this._dBigInt = null;
          this._extractable = false;
        }

        
return _createClass(RSACipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "RSA-PKCS1-v1_5"
            };
          }
        }, {
          key: "_base64urlDecode",
          value: function _base64urlDecode(data) {
            data = data.replace(/-/g, "+").replace(/_/g, "/");
            data = data.padEnd(Math.ceil(data.length / 4) * 4, "=");
            
return _base["default"].decode(data);
          }
        }, {
          key: "_padArray",
          value: function _padArray(arr, length) {
            var res = new Uint8Array(length);

            res.set(arr, length - arr.length);
            
return res;
          }
        }, {
          key: "_generateKey",
          value: (function() {
            var _generateKey2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee(algorithm, extractable) {
              var key, privateKey;

              
return _regeneratorRuntime().wrap(function _callee$(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    this._keyLength = algorithm.modulusLength;
                    this._keyBytes = Math.ceil(this._keyLength / 8);
                    _context.next = 4;
                    
return window.crypto.subtle.generateKey({
                      name: "RSA-OAEP",
                      modulusLength: algorithm.modulusLength,
                      publicExponent: algorithm.publicExponent,
                      hash: {
                        name: "SHA-256"
                      }
                    }, true, ["encrypt", "decrypt"]);
                  case 4:
                    key = _context.sent;
                    _context.next = 7;
                    
return window.crypto.subtle.exportKey("jwk", key.privateKey);
                  case 7:
                    privateKey = _context.sent;
                    this._n = this._padArray(this._base64urlDecode(privateKey.n), this._keyBytes);
                    this._nBigInt = (0, _bigint.u8ArrayToBigInt)(this._n);
                    this._e = this._padArray(this._base64urlDecode(privateKey.e), this._keyBytes);
                    this._eBigInt = (0, _bigint.u8ArrayToBigInt)(this._e);
                    this._d = this._padArray(this._base64urlDecode(privateKey.d), this._keyBytes);
                    this._dBigInt = (0, _bigint.u8ArrayToBigInt)(this._d);
                    this._extractable = extractable;
                  case 15:
                  case "end":
                    return _context.stop();
                }
              }, _callee, this);
            }));

            function _generateKey(_x, _x2) {
              return _generateKey2.apply(this, arguments);
            }

            
return _generateKey;
          })()
        }, {
          key: "_importKey",
          value: (function() {
            var _importKey2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee2(key, extractable) {
              var n, e;

              
return _regeneratorRuntime().wrap(function _callee2$(_context2) {
                while (1) switch (_context2.prev = _context2.next) {
                  case 0:
                    n = key.n;
                    e = key.e;

                    if (!(n.length !== e.length)) {
                      _context2.next = 4;
                      break;
                    }

                    throw new Error("the sizes of modulus and public exponent do not match");
                  case 4:
                    this._keyBytes = n.length;
                    this._keyLength = this._keyBytes * 8;
                    this._n = new Uint8Array(this._keyBytes);
                    this._e = new Uint8Array(this._keyBytes);
                    this._n.set(n);
                    this._e.set(e);
                    this._nBigInt = (0, _bigint.u8ArrayToBigInt)(this._n);
                    this._eBigInt = (0, _bigint.u8ArrayToBigInt)(this._e);
                    this._extractable = extractable;
                  case 13:
                  case "end":
                    return _context2.stop();
                }
              }, _callee2, this);
            }));

            function _importKey(_x3, _x4) {
              return _importKey2.apply(this, arguments);
            }

            
return _importKey;
          })()
        }, {
          key: "encrypt",
          value: (function() {
            var _encrypt = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee3(_algorithm, message) {
              var ps, i, em, emBigInt, c;

              
return _regeneratorRuntime().wrap(function _callee3$(_context3) {
                while (1) switch (_context3.prev = _context3.next) {
                  case 0:
                    if (!(message.length > this._keyBytes - 11)) {
                      _context3.next = 2;
                      break;
                    }

                    
return _context3.abrupt("return", null);
                  case 2:
                    ps = new Uint8Array(this._keyBytes - message.length - 3);
                    window.crypto.getRandomValues(ps);

                    for (i = 0; i < ps.length; i++) {
                      ps[i] = Math.floor(ps[i] * 254 / 255 + 1);
                    }

                    em = new Uint8Array(this._keyBytes);
                    em[1] = 2;
                    em.set(ps, 2);
                    em.set(message, ps.length + 3);
                    emBigInt = (0, _bigint.u8ArrayToBigInt)(em);
                    c = (0, _bigint.modPow)(emBigInt, this._eBigInt, this._nBigInt);
                    
return _context3.abrupt("return", (0, _bigint.bigIntToU8Array)(c, this._keyBytes));
                  case 12:
                  case "end":
                    return _context3.stop();
                }
              }, _callee3, this);
            }));

            function encrypt(_x5, _x6) {
              return _encrypt.apply(this, arguments);
            }

            
return encrypt;
          })()
        }, {
          key: "decrypt",
          value: (function() {
            var _decrypt = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee4(_algorithm, message) {
              var msgBigInt, emBigInt, em, i;

              
return _regeneratorRuntime().wrap(function _callee4$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    if (!(message.length !== this._keyBytes)) {
                      _context4.next = 2;
                      break;
                    }

                    
return _context4.abrupt("return", null);
                  case 2:
                    msgBigInt = (0, _bigint.u8ArrayToBigInt)(message);
                    emBigInt = (0, _bigint.modPow)(msgBigInt, this._dBigInt, this._nBigInt);
                    em = (0, _bigint.bigIntToU8Array)(emBigInt, this._keyBytes);

                    if (!(em[0] !== 0 || em[1] !== 2)) {
                      _context4.next = 7;
                      break;
                    }

                    
return _context4.abrupt("return", null);
                  case 7:
                    i = 2;
                  case 8:
                    if (!(i < em.length)) {
                      _context4.next = 14;
                      break;
                    }

                    if (!(em[i] === 0)) {
                      _context4.next = 11;
                      break;
                    }

                    
return _context4.abrupt("break", 14);
                  case 11:
                    i++;
                    _context4.next = 8;
                    break;
                  case 14:
                    if (!(i === em.length)) {
                      _context4.next = 16;
                      break;
                    }

                    
return _context4.abrupt("return", null);
                  case 16:
                    return _context4.abrupt("return", em.slice(i + 1, em.length));
                  case 17:
                  case "end":
                    return _context4.stop();
                }
              }, _callee4, this);
            }));

            function decrypt(_x7, _x8) {
              return _decrypt.apply(this, arguments);
            }

            
return decrypt;
          })()
        }, {
          key: "exportKey",
          value: (function() {
            var _exportKey = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee5() {
              return _regeneratorRuntime().wrap(function _callee5$(_context5) {
                while (1) switch (_context5.prev = _context5.next) {
                  case 0:
                    if (this._extractable) {
                      _context5.next = 2;
                      break;
                    }

                    throw new Error("key is not extractable");
                  case 2:
                    return _context5.abrupt("return", {
                      n: this._n,
                      e: this._e,
                      d: this._d
                    });
                  case 3:
                  case "end":
                    return _context5.stop();
                }
              }, _callee5, this);
            }));

            function exportKey() {
              return _exportKey.apply(this, arguments);
            }

            
return exportKey;
          })()
        }], [{
          key: "generateKey",
          value: (function() {
            var _generateKey3 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee6(algorithm, extractable, _keyUsages) {
              var cipher;

              
return _regeneratorRuntime().wrap(function _callee6$(_context6) {
                while (1) switch (_context6.prev = _context6.next) {
                  case 0:
                    cipher = new RSACipher2();
                    _context6.next = 3;
                    
return cipher._generateKey(algorithm, extractable);
                  case 3:
                    return _context6.abrupt("return", {
                      privateKey: cipher
                    });
                  case 4:
                  case "end":
                    return _context6.stop();
                }
              }, _callee6);
            }));

            function generateKey(_x9, _x10, _x11) {
              return _generateKey3.apply(this, arguments);
            }

            
return generateKey;
          })()
        }, {
          key: "importKey",
          value: (function() {
            var _importKey3 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee7(key, _algorithm, extractable, keyUsages) {
              var cipher;

              
return _regeneratorRuntime().wrap(function _callee7$(_context7) {
                while (1) switch (_context7.prev = _context7.next) {
                  case 0:
                    if (!(keyUsages.length !== 1 || keyUsages[0] !== "encrypt")) {
                      _context7.next = 2;
                      break;
                    }

                    throw new Error("only support importing RSA public key");
                  case 2:
                    cipher = new RSACipher2();
                    _context7.next = 5;
                    
return cipher._importKey(key, extractable);
                  case 5:
                    return _context7.abrupt("return", cipher);
                  case 6:
                  case "end":
                    return _context7.stop();
                }
              }, _callee7);
            }));

            function importKey(_x12, _x13, _x14, _x15) {
              return _importKey3.apply(this, arguments);
            }

            
return importKey;
          })()
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/dh.js
  var require_dh = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/dh.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.DHCipher = void 0;
      var _bigint = require_bigint();

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var DHPublicKey = /* @__PURE__ */ (function() {
        function DHPublicKey2(key) {
          _classCallCheck(this, DHPublicKey2);
          this._key = key;
        }

        
return _createClass(DHPublicKey2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "DH"
            };
          }
        }, {
          key: "exportKey",
          value: function exportKey() {
            return this._key;
          }
        }]);
      })();
      var DHCipher = exports.DHCipher = /* @__PURE__ */ (function() {
        function DHCipher2() {
          _classCallCheck(this, DHCipher2);
          this._g = null;
          this._p = null;
          this._gBigInt = null;
          this._pBigInt = null;
          this._privateKey = null;
        }

        
return _createClass(DHCipher2, [{
          key: "algorithm",
          get: function get() {
            return {
              name: "DH"
            };
          }
        }, {
          key: "_generateKey",
          value: function _generateKey(algorithm) {
            var g = algorithm.g;
            var p = algorithm.p;

            this._keyBytes = p.length;
            this._gBigInt = (0, _bigint.u8ArrayToBigInt)(g);
            this._pBigInt = (0, _bigint.u8ArrayToBigInt)(p);
            this._privateKey = window.crypto.getRandomValues(new Uint8Array(this._keyBytes));
            this._privateKeyBigInt = (0, _bigint.u8ArrayToBigInt)(this._privateKey);
            this._publicKey = (0, _bigint.bigIntToU8Array)((0, _bigint.modPow)(this._gBigInt, this._privateKeyBigInt, this._pBigInt), this._keyBytes);
          }
        }, {
          key: "deriveBits",
          value: function deriveBits(algorithm, length) {
            var bytes = Math.ceil(length / 8);
            var pkey = new Uint8Array(algorithm["public"]);
            var len = bytes > this._keyBytes ? bytes : this._keyBytes;
            var secret = (0, _bigint.modPow)((0, _bigint.u8ArrayToBigInt)(pkey), this._privateKeyBigInt, this._pBigInt);

            
return (0, _bigint.bigIntToU8Array)(secret, len).slice(0, len);
          }
        }], [{
          key: "generateKey",
          value: function generateKey(algorithm, _extractable) {
            var cipher = new DHCipher2();

            cipher._generateKey(algorithm);
            
return {
              privateKey: cipher,
              publicKey: new DHPublicKey(cipher._publicKey)
            };
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/md5.js
  var require_md5 = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/md5.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports.MD5 = MD5;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _regeneratorRuntime() {
        "use strict";

        _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        };

        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, { value: r2, enumerable: true, configurable: true, writable: true }), t2[e2];
        }

        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }

        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);

          
return o(a2, "_invoke", { value: makeInvokeMethod(t2, r2, c2) }), a2;
        }

        function tryCatch(t2, e2, r2) {
          try {
            return { type: "normal", arg: t2.call(e2, r2) };
          } catch (t3) {
            return { type: "throw", arg: t3 };
          }
        }

        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

        function Generator() {
        }

        function GeneratorFunction() {
        }

        function GeneratorFunctionPrototype() {
        }

        var p = {};

        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));

        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }

        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);

            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;

              
return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }

            a2(c2.arg);
          }

          var r2;

          o(this, "_invoke", { value: function value(t3, n2) {
            function callInvokeWithMethodAndArg() {
              return new e2(function(e3, r3) {
                invoke(t3, n2, e3, r3);
              });
            }

            
return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
          } });
        }

        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;

          
return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");

            if (o2 === s) {
              if ("throw" === i2) throw a2;
              
return { value: t, done: true };
            }

            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;

              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);

                if (u2) {
                  if (u2 === y) continue;
                  
return u2;
                }
              }

              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);

              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                
return { value: p2.arg, done: n2.done };
              }

              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }

        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];

          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);

          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;

          
return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }

        function pushTryEntry(t2) {
          var e2 = { tryLoc: t2[0] };

          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }

        function resetTryEntry(t2) {
          var e2 = t2.completion || {};

          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }

        function Context(t2) {
          this.tryEntries = [{ tryLoc: "root" }], t2.forEach(pushTryEntry, this), this.reset(true);
        }

        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];

            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;

            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                
return next.value = t, next.done = true, next;
              };

              
return i2.next = i2;
            }
          }

          throw new TypeError(_typeof(e2) + " is not iterable");
        }

        
return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: true }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: true }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;

          
return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return { __await: t2 };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);

          
return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];

          for (var n2 in e2) r2.push(n2);

          
return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();

              if (t3 in e2) return next.value = t3, next.done = false, next;
            }

            
return next.done = true, next;
          };
        }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e2) {
          if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
        }, stop: function stop() {
          this.done = true;
          var t2 = this.tryEntries[0].completion;

          if ("throw" === t2.type) throw t2.arg;
          
return this.rval;
        }, dispatchException: function dispatchException(e2) {
          if (this.done) throw e2;
          var r2 = this;

          function handle(n2, o3) {
            return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
          }

          for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
            var i2 = this.tryEntries[o2], a2 = i2.completion;

            if ("root" === i2.tryLoc) return handle("end");

            if (i2.tryLoc <= this.prev) {
              var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");

              if (c2 && u2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              } else if (c2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
              } else {
                if (!u2) throw Error("try statement without catch or finally");
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              }
            }
          }
        }, abrupt: function abrupt(t2, e2) {
          for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
            var o2 = this.tryEntries[r2];

            if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
              var i2 = o2;

              break;
            }
          }

          i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
          var a2 = i2 ? i2.completion : {};

          
return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
        }, complete: function complete(t2, e2) {
          if ("throw" === t2.type) throw t2.arg;
          
return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
        }, finish: function finish(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
          }
        }, "catch": function _catch(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.tryLoc === t2) {
              var n2 = r2.completion;

              if ("throw" === n2.type) {
                var o2 = n2.arg;

                resetTryEntry(r2);
              }

              
return o2;
            }
          }

          throw Error("illegal catch attempt");
        }, delegateYield: function delegateYield(e2, r2, n2) {
          return this.delegate = { iterator: values(e2), resultName: r2, nextLoc: n2 }, "next" === this.method && (this.arg = t), y;
        } }, e;
      }

      function asyncGeneratorStep(n, t, e, r, o, a, c) {
        try {
          var i = n[a](c), u = i.value;
        } catch (n2) {
          return void e(n2);
        }

        i.done ? t(u) : Promise.resolve(u).then(r, o);
      }

      function _asyncToGenerator(n) {
        return function() {
          var t = this, e = arguments;

          
return new Promise(function(r, o) {
            var a = n.apply(t, e);

            function _next(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
            }

            function _throw(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
            }

            _next(void 0);
          });
        };
      }

      function MD5(_x) {
        return _MD.apply(this, arguments);
      }

      function _MD() {
        _MD = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee(d) {
          var s, i;

          
return _regeneratorRuntime().wrap(function _callee$(_context) {
            while (1) switch (_context.prev = _context.next) {
              case 0:
                s = "";

                for (i = 0; i < d.length; i++) {
                  s += String.fromCharCode(d[i]);
                }

                
return _context.abrupt("return", M(V(Y(X(s), 8 * s.length))));
              case 3:
              case "end":
                return _context.stop();
            }
          }, _callee);
        }));
        
return _MD.apply(this, arguments);
      }

      function M(d) {
        var f = new Uint8Array(d.length);

        for (var i = 0; i < d.length; i++) {
          f[i] = d.charCodeAt(i);
        }

        
return f;
      }

      function X(d) {
        var r = Array(d.length >> 2);

        for (var m = 0; m < r.length; m++) r[m] = 0;
        for (var _m = 0; _m < 8 * d.length; _m += 8) r[_m >> 5] |= (255 & d.charCodeAt(_m / 8)) << _m % 32;
        
return r;
      }

      function V(d) {
        var r = "";

        for (var m = 0; m < 32 * d.length; m += 8) r += String.fromCharCode(d[m >> 5] >>> m % 32 & 255);
        
return r;
      }

      function Y(d, g) {
        d[g >> 5] |= 128 << g % 32, d[14 + (g + 64 >>> 9 << 4)] = g;
        var m = 1732584193, f = -271733879, r = -1732584194, i = 271733878;

        for (var n = 0; n < d.length; n += 16) {
          var h = m, t = f, _g = r, e = i;

          f = ii(f = ii(f = ii(f = ii(f = hh(f = hh(f = hh(f = hh(f = gg(f = gg(f = gg(f = gg(f = ff(f = ff(f = ff(f = ff(f, r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 0], 7, -680876936), f, r, d[n + 1], 12, -389564586), m, f, d[n + 2], 17, 606105819), i, m, d[n + 3], 22, -1044525330), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 4], 7, -176418897), f, r, d[n + 5], 12, 1200080426), m, f, d[n + 6], 17, -1473231341), i, m, d[n + 7], 22, -45705983), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 8], 7, 1770035416), f, r, d[n + 9], 12, -1958414417), m, f, d[n + 10], 17, -42063), i, m, d[n + 11], 22, -1990404162), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 12], 7, 1804603682), f, r, d[n + 13], 12, -40341101), m, f, d[n + 14], 17, -1502002290), i, m, d[n + 15], 22, 1236535329), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 1], 5, -165796510), f, r, d[n + 6], 9, -1069501632), m, f, d[n + 11], 14, 643717713), i, m, d[n + 0], 20, -373897302), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 5], 5, -701558691), f, r, d[n + 10], 9, 38016083), m, f, d[n + 15], 14, -660478335), i, m, d[n + 4], 20, -405537848), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 9], 5, 568446438), f, r, d[n + 14], 9, -1019803690), m, f, d[n + 3], 14, -187363961), i, m, d[n + 8], 20, 1163531501), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 13], 5, -1444681467), f, r, d[n + 2], 9, -51403784), m, f, d[n + 7], 14, 1735328473), i, m, d[n + 12], 20, -1926607734), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 5], 4, -378558), f, r, d[n + 8], 11, -2022574463), m, f, d[n + 11], 16, 1839030562), i, m, d[n + 14], 23, -35309556), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 1], 4, -1530992060), f, r, d[n + 4], 11, 1272893353), m, f, d[n + 7], 16, -155497632), i, m, d[n + 10], 23, -1094730640), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 13], 4, 681279174), f, r, d[n + 0], 11, -358537222), m, f, d[n + 3], 16, -722521979), i, m, d[n + 6], 23, 76029189), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 9], 4, -640364487), f, r, d[n + 12], 11, -421815835), m, f, d[n + 15], 16, 530742520), i, m, d[n + 2], 23, -995338651), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 0], 6, -198630844), f, r, d[n + 7], 10, 1126891415), m, f, d[n + 14], 15, -1416354905), i, m, d[n + 5], 21, -57434055), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 12], 6, 1700485571), f, r, d[n + 3], 10, -1894986606), m, f, d[n + 10], 15, -1051523), i, m, d[n + 1], 21, -2054922799), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 8], 6, 1873313359), f, r, d[n + 15], 10, -30611744), m, f, d[n + 6], 15, -1560198380), i, m, d[n + 13], 21, 1309151649), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 4], 6, -145523070), f, r, d[n + 11], 10, -1120210379), m, f, d[n + 2], 15, 718787259), i, m, d[n + 9], 21, -343485551), m = add(m, h), f = add(f, t), r = add(r, _g), i = add(i, e);
        }

        
return Array(m, f, r, i);
      }

      function cmn(d, g, m, f, r, i) {
        return add(rol(add(add(g, d), add(f, i)), r), m);
      }

      function ff(d, g, m, f, r, i, n) {
        return cmn(g & m | ~g & f, d, g, r, i, n);
      }

      function gg(d, g, m, f, r, i, n) {
        return cmn(g & f | m & ~f, d, g, r, i, n);
      }

      function hh(d, g, m, f, r, i, n) {
        return cmn(g ^ m ^ f, d, g, r, i, n);
      }

      function ii(d, g, m, f, r, i, n) {
        return cmn(m ^ (g | ~f), d, g, r, i, n);
      }

      function add(d, g) {
        var m = (65535 & d) + (65535 & g);

        
return (d >> 16) + (g >> 16) + (m >> 16) << 16 | 65535 & m;
      }

      function rol(d, g) {
        return d << g | d >>> 32 - g;
      }
    }
  });

  // node_modules/@novnc/novnc/lib/crypto/crypto.js
  var require_crypto = __commonJS({
    "node_modules/@novnc/novnc/lib/crypto/crypto.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _aes = require_aes();
      var _des = require_des();
      var _rsa = require_rsa();
      var _dh = require_dh();
      var _md = require_md5();

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var LegacyCrypto = /* @__PURE__ */ (function() {
        function LegacyCrypto2() {
          _classCallCheck(this, LegacyCrypto2);
          this._algorithms = {
            "AES-ECB": _aes.AESECBCipher,
            "AES-EAX": _aes.AESEAXCipher,
            "DES-ECB": _des.DESECBCipher,
            "DES-CBC": _des.DESCBCCipher,
            "RSA-PKCS1-v1_5": _rsa.RSACipher,
            "DH": _dh.DHCipher,
            "MD5": _md.MD5
          };
        }

        
return _createClass(LegacyCrypto2, [{
          key: "encrypt",
          value: function encrypt(algorithm, key, data) {
            if (key.algorithm.name !== algorithm.name) {
              throw new Error("algorithm does not match");
            }

            if (typeof key.encrypt !== "function") {
              throw new Error("key does not support encryption");
            }

            
return key.encrypt(algorithm, data);
          }
        }, {
          key: "decrypt",
          value: function decrypt(algorithm, key, data) {
            if (key.algorithm.name !== algorithm.name) {
              throw new Error("algorithm does not match");
            }

            if (typeof key.decrypt !== "function") {
              throw new Error("key does not support encryption");
            }

            
return key.decrypt(algorithm, data);
          }
        }, {
          key: "importKey",
          value: function importKey(format, keyData, algorithm, extractable, keyUsages) {
            if (format !== "raw") {
              throw new Error("key format is not supported");
            }

            var alg = this._algorithms[algorithm.name];

            if (typeof alg === "undefined" || typeof alg.importKey !== "function") {
              throw new Error("algorithm is not supported");
            }

            
return alg.importKey(keyData, algorithm, extractable, keyUsages);
          }
        }, {
          key: "generateKey",
          value: function generateKey(algorithm, extractable, keyUsages) {
            var alg = this._algorithms[algorithm.name];

            if (typeof alg === "undefined" || typeof alg.generateKey !== "function") {
              throw new Error("algorithm is not supported");
            }

            
return alg.generateKey(algorithm, extractable, keyUsages);
          }
        }, {
          key: "exportKey",
          value: function exportKey(format, key) {
            if (format !== "raw") {
              throw new Error("key format is not supported");
            }

            if (typeof key.exportKey !== "function") {
              throw new Error("key does not support exportKey");
            }

            
return key.exportKey();
          }
        }, {
          key: "digest",
          value: function digest(algorithm, data) {
            var alg = this._algorithms[algorithm];

            if (typeof alg !== "function") {
              throw new Error("algorithm is not supported");
            }

            
return alg(data);
          }
        }, {
          key: "deriveBits",
          value: function deriveBits(algorithm, key, length) {
            if (key.algorithm.name !== algorithm.name) {
              throw new Error("algorithm does not match");
            }

            if (typeof key.deriveBits !== "function") {
              throw new Error("key does not support deriveBits");
            }

            
return key.deriveBits(algorithm, length);
          }
        }]);
      })();
      var _default = exports["default"] = new LegacyCrypto();
    }
  });

  // node_modules/@novnc/novnc/lib/ra2.js
  var require_ra2 = __commonJS({
    "node_modules/@novnc/novnc/lib/ra2.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _strings = require_strings();
      var _eventtarget = _interopRequireDefault(require_eventtarget());
      var _crypto = _interopRequireDefault(require_crypto());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _callSuper(t, o, e) {
        return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
      }

      function _possibleConstructorReturn(t, e) {
        if (e && ("object" == _typeof(e) || "function" == typeof e)) return e;
        if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
        
return _assertThisInitialized(t);
      }

      function _assertThisInitialized(e) {
        if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        
return e;
      }

      function _isNativeReflectConstruct() {
        try {
          var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
          }));
        } catch (t2) {
        }

        
return (_isNativeReflectConstruct = function _isNativeReflectConstruct2() {
          return !!t;
        })();
      }

      function _getPrototypeOf(t) {
        return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t2) {
          return t2.__proto__ || Object.getPrototypeOf(t2);
        }, _getPrototypeOf(t);
      }

      function _inherits(t, e) {
        if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
        t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } }), Object.defineProperty(t, "prototype", { writable: false }), e && _setPrototypeOf(t, e);
      }

      function _setPrototypeOf(t, e) {
        return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t2, e2) {
          return t2.__proto__ = e2, t2;
        }, _setPrototypeOf(t, e);
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _regeneratorRuntime() {
        "use strict";

        _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        };

        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, { value: r2, enumerable: true, configurable: true, writable: true }), t2[e2];
        }

        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }

        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);

          
return o(a2, "_invoke", { value: makeInvokeMethod(t2, r2, c2) }), a2;
        }

        function tryCatch(t2, e2, r2) {
          try {
            return { type: "normal", arg: t2.call(e2, r2) };
          } catch (t3) {
            return { type: "throw", arg: t3 };
          }
        }

        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

        function Generator() {
        }

        function GeneratorFunction() {
        }

        function GeneratorFunctionPrototype() {
        }

        var p = {};

        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));

        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }

        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);

            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;

              
return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }

            a2(c2.arg);
          }

          var r2;

          o(this, "_invoke", { value: function value(t3, n2) {
            function callInvokeWithMethodAndArg() {
              return new e2(function(e3, r3) {
                invoke(t3, n2, e3, r3);
              });
            }

            
return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
          } });
        }

        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;

          
return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");

            if (o2 === s) {
              if ("throw" === i2) throw a2;
              
return { value: t, done: true };
            }

            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;

              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);

                if (u2) {
                  if (u2 === y) continue;
                  
return u2;
                }
              }

              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);

              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                
return { value: p2.arg, done: n2.done };
              }

              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }

        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];

          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);

          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;

          
return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }

        function pushTryEntry(t2) {
          var e2 = { tryLoc: t2[0] };

          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }

        function resetTryEntry(t2) {
          var e2 = t2.completion || {};

          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }

        function Context(t2) {
          this.tryEntries = [{ tryLoc: "root" }], t2.forEach(pushTryEntry, this), this.reset(true);
        }

        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];

            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;

            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                
return next.value = t, next.done = true, next;
              };

              
return i2.next = i2;
            }
          }

          throw new TypeError(_typeof(e2) + " is not iterable");
        }

        
return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: true }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: true }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;

          
return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return { __await: t2 };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);

          
return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];

          for (var n2 in e2) r2.push(n2);

          
return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();

              if (t3 in e2) return next.value = t3, next.done = false, next;
            }

            
return next.done = true, next;
          };
        }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e2) {
          if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
        }, stop: function stop() {
          this.done = true;
          var t2 = this.tryEntries[0].completion;

          if ("throw" === t2.type) throw t2.arg;
          
return this.rval;
        }, dispatchException: function dispatchException(e2) {
          if (this.done) throw e2;
          var r2 = this;

          function handle(n2, o3) {
            return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
          }

          for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
            var i2 = this.tryEntries[o2], a2 = i2.completion;

            if ("root" === i2.tryLoc) return handle("end");

            if (i2.tryLoc <= this.prev) {
              var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");

              if (c2 && u2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              } else if (c2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
              } else {
                if (!u2) throw Error("try statement without catch or finally");
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              }
            }
          }
        }, abrupt: function abrupt(t2, e2) {
          for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
            var o2 = this.tryEntries[r2];

            if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
              var i2 = o2;

              break;
            }
          }

          i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
          var a2 = i2 ? i2.completion : {};

          
return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
        }, complete: function complete(t2, e2) {
          if ("throw" === t2.type) throw t2.arg;
          
return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
        }, finish: function finish(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
          }
        }, "catch": function _catch(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.tryLoc === t2) {
              var n2 = r2.completion;

              if ("throw" === n2.type) {
                var o2 = n2.arg;

                resetTryEntry(r2);
              }

              
return o2;
            }
          }

          throw Error("illegal catch attempt");
        }, delegateYield: function delegateYield(e2, r2, n2) {
          return this.delegate = { iterator: values(e2), resultName: r2, nextLoc: n2 }, "next" === this.method && (this.arg = t), y;
        } }, e;
      }

      function asyncGeneratorStep(n, t, e, r, o, a, c) {
        try {
          var i = n[a](c), u = i.value;
        } catch (n2) {
          return void e(n2);
        }

        i.done ? t(u) : Promise.resolve(u).then(r, o);
      }

      function _asyncToGenerator(n) {
        return function() {
          var t = this, e = arguments;

          
return new Promise(function(r, o) {
            var a = n.apply(t, e);

            function _next(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
            }

            function _throw(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
            }

            _next(void 0);
          });
        };
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var RA2Cipher = /* @__PURE__ */ (function() {
        function RA2Cipher2() {
          _classCallCheck(this, RA2Cipher2);
          this._cipher = null;
          this._counter = new Uint8Array(16);
        }

        
return _createClass(RA2Cipher2, [{
          key: "setKey",
          value: (function() {
            var _setKey = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee(key) {
              return _regeneratorRuntime().wrap(function _callee$(_context) {
                while (1) switch (_context.prev = _context.next) {
                  case 0:
                    _context.next = 2;
                    
return _crypto["default"].importKey("raw", key, {
                      name: "AES-EAX"
                    }, false, ["encrypt, decrypt"]);
                  case 2:
                    this._cipher = _context.sent;
                  case 3:
                  case "end":
                    return _context.stop();
                }
              }, _callee, this);
            }));

            function setKey(_x) {
              return _setKey.apply(this, arguments);
            }

            
return setKey;
          })()
        }, {
          key: "makeMessage",
          value: (function() {
            var _makeMessage = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee2(message) {
              var ad, encrypted, i, res;

              
return _regeneratorRuntime().wrap(function _callee2$(_context2) {
                while (1) switch (_context2.prev = _context2.next) {
                  case 0:
                    ad = new Uint8Array([(message.length & 65280) >>> 8, message.length & 255]);
                    _context2.next = 3;
                    
return _crypto["default"].encrypt({
                      name: "AES-EAX",
                      iv: this._counter,
                      additionalData: ad
                    }, this._cipher, message);
                  case 3:
                    encrypted = _context2.sent;
                    for (i = 0; i < 16 && this._counter[i]++ === 255; i++) ;
                    res = new Uint8Array(message.length + 2 + 16);
                    res.set(ad);
                    res.set(encrypted, 2);
                    
return _context2.abrupt("return", res);
                  case 9:
                  case "end":
                    return _context2.stop();
                }
              }, _callee2, this);
            }));

            function makeMessage(_x2) {
              return _makeMessage.apply(this, arguments);
            }

            
return makeMessage;
          })()
        }, {
          key: "receiveMessage",
          value: (function() {
            var _receiveMessage = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee3(length, encrypted) {
              var ad, res, i;

              
return _regeneratorRuntime().wrap(function _callee3$(_context3) {
                while (1) switch (_context3.prev = _context3.next) {
                  case 0:
                    ad = new Uint8Array([(length & 65280) >>> 8, length & 255]);
                    _context3.next = 3;
                    
return _crypto["default"].decrypt({
                      name: "AES-EAX",
                      iv: this._counter,
                      additionalData: ad
                    }, this._cipher, encrypted);
                  case 3:
                    res = _context3.sent;
                    for (i = 0; i < 16 && this._counter[i]++ === 255; i++) ;
                    
return _context3.abrupt("return", res);
                  case 6:
                  case "end":
                    return _context3.stop();
                }
              }, _callee3, this);
            }));

            function receiveMessage(_x3, _x4) {
              return _receiveMessage.apply(this, arguments);
            }

            
return receiveMessage;
          })()
        }]);
      })();
      var RSAAESAuthenticationState = exports["default"] = /* @__PURE__ */ (function(_EventTargetMixin) {
        function RSAAESAuthenticationState2(sock, getCredentials) {
          var _this;

          _classCallCheck(this, RSAAESAuthenticationState2);
          _this = _callSuper(this, RSAAESAuthenticationState2);
          _this._hasStarted = false;
          _this._checkSock = null;
          _this._checkCredentials = null;
          _this._approveServerResolve = null;
          _this._sockReject = null;
          _this._credentialsReject = null;
          _this._approveServerReject = null;
          _this._sock = sock;
          _this._getCredentials = getCredentials;
          
return _this;
        }

        _inherits(RSAAESAuthenticationState2, _EventTargetMixin);
        
return _createClass(RSAAESAuthenticationState2, [{
          key: "_waitSockAsync",
          value: function _waitSockAsync(len) {
            var _this2 = this;

            
return new Promise(function(resolve, reject) {
              var hasData = function hasData2() {
                return !_this2._sock.rQwait("RA2", len);
              };

              if (hasData()) {
                resolve();
              } else {
                _this2._checkSock = function() {
                  if (hasData()) {
                    resolve();
                    _this2._checkSock = null;
                    _this2._sockReject = null;
                  }
                };

                _this2._sockReject = reject;
              }
            });
          }
        }, {
          key: "_waitApproveKeyAsync",
          value: function _waitApproveKeyAsync() {
            var _this3 = this;

            
return new Promise(function(resolve, reject) {
              _this3._approveServerResolve = resolve;
              _this3._approveServerReject = reject;
            });
          }
        }, {
          key: "_waitCredentialsAsync",
          value: function _waitCredentialsAsync(subtype) {
            var _this4 = this;

            var hasCredentials = function hasCredentials2() {
              if (subtype === 1 && _this4._getCredentials().username !== void 0 && _this4._getCredentials().password !== void 0) {
                return true;
              } else if (subtype === 2 && _this4._getCredentials().password !== void 0) {
                return true;
              }

              
return false;
            };

            
return new Promise(function(resolve, reject) {
              if (hasCredentials()) {
                resolve();
              } else {
                _this4._checkCredentials = function() {
                  if (hasCredentials()) {
                    resolve();
                    _this4._checkCredentials = null;
                    _this4._credentialsReject = null;
                  }
                };

                _this4._credentialsReject = reject;
              }
            });
          }
        }, {
          key: "checkInternalEvents",
          value: function checkInternalEvents() {
            if (this._checkSock !== null) {
              this._checkSock();
            }

            if (this._checkCredentials !== null) {
              this._checkCredentials();
            }
          }
        }, {
          key: "approveServer",
          value: function approveServer() {
            if (this._approveServerResolve !== null) {
              this._approveServerResolve();
              this._approveServerResolve = null;
            }
          }
        }, {
          key: "disconnect",
          value: function disconnect() {
            if (this._sockReject !== null) {
              this._sockReject(new Error("disconnect normally"));
              this._sockReject = null;
            }

            if (this._credentialsReject !== null) {
              this._credentialsReject(new Error("disconnect normally"));
              this._credentialsReject = null;
            }

            if (this._approveServerReject !== null) {
              this._approveServerReject(new Error("disconnect normally"));
              this._approveServerReject = null;
            }
          }
        }, {
          key: "negotiateRA2neAuthAsync",
          value: (function() {
            var _negotiateRA2neAuthAsync = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee4() {
              var serverKeyLengthBuffer, serverKeyLength, serverKeyBytes, serverN, serverE, serverRSACipher, serverPublickey, approveKey, clientKeyLength, clientKeyBytes, clientRSACipher, clientExportedRSAKey, clientN, clientE, clientPublicKey, clientRandom, clientEncryptedRandom, clientRandomMessage, serverEncryptedRandom, serverRandom, clientSessionKey, serverSessionKey, clientCipher, serverCipher, serverHash, clientHash, serverHashReceived, i, subtype, waitCredentials, username, password, credentials, _i, _i2;

              
return _regeneratorRuntime().wrap(function _callee4$(_context4) {
                while (1) switch (_context4.prev = _context4.next) {
                  case 0:
                    this._hasStarted = true;
                    _context4.next = 3;
                    
return this._waitSockAsync(4);
                  case 3:
                    serverKeyLengthBuffer = this._sock.rQpeekBytes(4);
                    serverKeyLength = this._sock.rQshift32();

                    if (!(serverKeyLength < 1024)) {
                      _context4.next = 9;
                      break;
                    }

                    throw new Error("RA2: server public key is too short: " + serverKeyLength);
                  case 9:
                    if (!(serverKeyLength > 8192)) {
                      _context4.next = 11;
                      break;
                    }

                    throw new Error("RA2: server public key is too long: " + serverKeyLength);
                  case 11:
                    serverKeyBytes = Math.ceil(serverKeyLength / 8);
                    _context4.next = 14;
                    
return this._waitSockAsync(serverKeyBytes * 2);
                  case 14:
                    serverN = this._sock.rQshiftBytes(serverKeyBytes);
                    serverE = this._sock.rQshiftBytes(serverKeyBytes);
                    _context4.next = 18;
                    
return _crypto["default"].importKey("raw", {
                      n: serverN,
                      e: serverE
                    }, {
                      name: "RSA-PKCS1-v1_5"
                    }, false, ["encrypt"]);
                  case 18:
                    serverRSACipher = _context4.sent;
                    serverPublickey = new Uint8Array(4 + serverKeyBytes * 2);
                    serverPublickey.set(serverKeyLengthBuffer);
                    serverPublickey.set(serverN, 4);
                    serverPublickey.set(serverE, 4 + serverKeyBytes);
                    approveKey = this._waitApproveKeyAsync();
                    this.dispatchEvent(new CustomEvent("serververification", {
                      detail: {
                        type: "RSA",
                        publickey: serverPublickey
                      }
                    }));
                    _context4.next = 27;
                    
return approveKey;
                  case 27:
                    clientKeyLength = 2048;
                    clientKeyBytes = Math.ceil(clientKeyLength / 8);
                    _context4.next = 31;
                    
return _crypto["default"].generateKey({
                      name: "RSA-PKCS1-v1_5",
                      modulusLength: clientKeyLength,
                      publicExponent: new Uint8Array([1, 0, 1])
                    }, true, ["encrypt"]);
                  case 31:
                    clientRSACipher = _context4.sent.privateKey;
                    _context4.next = 34;
                    
return _crypto["default"].exportKey("raw", clientRSACipher);
                  case 34:
                    clientExportedRSAKey = _context4.sent;
                    clientN = clientExportedRSAKey.n;
                    clientE = clientExportedRSAKey.e;
                    clientPublicKey = new Uint8Array(4 + clientKeyBytes * 2);
                    clientPublicKey[0] = (clientKeyLength & 4278190080) >>> 24;
                    clientPublicKey[1] = (clientKeyLength & 16711680) >>> 16;
                    clientPublicKey[2] = (clientKeyLength & 65280) >>> 8;
                    clientPublicKey[3] = clientKeyLength & 255;
                    clientPublicKey.set(clientN, 4);
                    clientPublicKey.set(clientE, 4 + clientKeyBytes);
                    this._sock.sQpushBytes(clientPublicKey);
                    this._sock.flush();
                    clientRandom = new Uint8Array(16);
                    window.crypto.getRandomValues(clientRandom);
                    _context4.next = 50;
                    
return _crypto["default"].encrypt({
                      name: "RSA-PKCS1-v1_5"
                    }, serverRSACipher, clientRandom);
                  case 50:
                    clientEncryptedRandom = _context4.sent;
                    clientRandomMessage = new Uint8Array(2 + serverKeyBytes);
                    clientRandomMessage[0] = (serverKeyBytes & 65280) >>> 8;
                    clientRandomMessage[1] = serverKeyBytes & 255;
                    clientRandomMessage.set(clientEncryptedRandom, 2);
                    this._sock.sQpushBytes(clientRandomMessage);
                    this._sock.flush();
                    _context4.next = 59;
                    
return this._waitSockAsync(2);
                  case 59:
                    if (!(this._sock.rQshift16() !== clientKeyBytes)) {
                      _context4.next = 61;
                      break;
                    }

                    throw new Error("RA2: wrong encrypted message length");
                  case 61:
                    serverEncryptedRandom = this._sock.rQshiftBytes(clientKeyBytes);
                    _context4.next = 64;
                    
return _crypto["default"].decrypt({
                      name: "RSA-PKCS1-v1_5"
                    }, clientRSACipher, serverEncryptedRandom);
                  case 64:
                    serverRandom = _context4.sent;

                    if (!(serverRandom === null || serverRandom.length !== 16)) {
                      _context4.next = 67;
                      break;
                    }

                    throw new Error("RA2: corrupted server encrypted random");
                  case 67:
                    clientSessionKey = new Uint8Array(32);
                    serverSessionKey = new Uint8Array(32);
                    clientSessionKey.set(serverRandom);
                    clientSessionKey.set(clientRandom, 16);
                    serverSessionKey.set(clientRandom);
                    serverSessionKey.set(serverRandom, 16);
                    _context4.next = 75;
                    
return window.crypto.subtle.digest("SHA-1", clientSessionKey);
                  case 75:
                    clientSessionKey = _context4.sent;
                    clientSessionKey = new Uint8Array(clientSessionKey).slice(0, 16);
                    _context4.next = 79;
                    
return window.crypto.subtle.digest("SHA-1", serverSessionKey);
                  case 79:
                    serverSessionKey = _context4.sent;
                    serverSessionKey = new Uint8Array(serverSessionKey).slice(0, 16);
                    clientCipher = new RA2Cipher();
                    _context4.next = 84;
                    
return clientCipher.setKey(clientSessionKey);
                  case 84:
                    serverCipher = new RA2Cipher();
                    _context4.next = 87;
                    
return serverCipher.setKey(serverSessionKey);
                  case 87:
                    serverHash = new Uint8Array(8 + serverKeyBytes * 2 + clientKeyBytes * 2);
                    clientHash = new Uint8Array(8 + serverKeyBytes * 2 + clientKeyBytes * 2);
                    serverHash.set(serverPublickey);
                    serverHash.set(clientPublicKey, 4 + serverKeyBytes * 2);
                    clientHash.set(clientPublicKey);
                    clientHash.set(serverPublickey, 4 + clientKeyBytes * 2);
                    _context4.next = 95;
                    
return window.crypto.subtle.digest("SHA-1", serverHash);
                  case 95:
                    serverHash = _context4.sent;
                    _context4.next = 98;
                    
return window.crypto.subtle.digest("SHA-1", clientHash);
                  case 98:
                    clientHash = _context4.sent;
                    serverHash = new Uint8Array(serverHash);
                    clientHash = new Uint8Array(clientHash);
                    _context4.t0 = this._sock;
                    _context4.next = 104;
                    
return clientCipher.makeMessage(clientHash);
                  case 104:
                    _context4.t1 = _context4.sent;
                    _context4.t0.sQpushBytes.call(_context4.t0, _context4.t1);
                    this._sock.flush();
                    _context4.next = 109;
                    
return this._waitSockAsync(2 + 20 + 16);
                  case 109:
                    if (!(this._sock.rQshift16() !== 20)) {
                      _context4.next = 111;
                      break;
                    }

                    throw new Error("RA2: wrong server hash");
                  case 111:
                    _context4.next = 113;
                    
return serverCipher.receiveMessage(20, this._sock.rQshiftBytes(20 + 16));
                  case 113:
                    serverHashReceived = _context4.sent;

                    if (!(serverHashReceived === null)) {
                      _context4.next = 116;
                      break;
                    }

                    throw new Error("RA2: failed to authenticate the message");
                  case 116:
                    i = 0;
                  case 117:
                    if (!(i < 20)) {
                      _context4.next = 123;
                      break;
                    }

                    if (!(serverHashReceived[i] !== serverHash[i])) {
                      _context4.next = 120;
                      break;
                    }

                    throw new Error("RA2: wrong server hash");
                  case 120:
                    i++;
                    _context4.next = 117;
                    break;
                  case 123:
                    _context4.next = 125;
                    
return this._waitSockAsync(2 + 1 + 16);
                  case 125:
                    if (!(this._sock.rQshift16() !== 1)) {
                      _context4.next = 127;
                      break;
                    }

                    throw new Error("RA2: wrong subtype");
                  case 127:
                    _context4.next = 129;
                    
return serverCipher.receiveMessage(1, this._sock.rQshiftBytes(1 + 16));
                  case 129:
                    subtype = _context4.sent;

                    if (!(subtype === null)) {
                      _context4.next = 132;
                      break;
                    }

                    throw new Error("RA2: failed to authenticate the message");
                  case 132:
                    subtype = subtype[0];
                    waitCredentials = this._waitCredentialsAsync(subtype);

                    if (!(subtype === 1)) {
                      _context4.next = 138;
                      break;
                    }

                    if (this._getCredentials().username === void 0 || this._getCredentials().password === void 0) {
                      this.dispatchEvent(new CustomEvent("credentialsrequired", {
                        detail: {
                          types: ["username", "password"]
                        }
                      }));
                    }

                    _context4.next = 143;
                    break;
                  case 138:
                    if (!(subtype === 2)) {
                      _context4.next = 142;
                      break;
                    }

                    if (this._getCredentials().password === void 0) {
                      this.dispatchEvent(new CustomEvent("credentialsrequired", {
                        detail: {
                          types: ["password"]
                        }
                      }));
                    }

                    _context4.next = 143;
                    break;
                  case 142:
                    throw new Error("RA2: wrong subtype");
                  case 143:
                    _context4.next = 145;
                    
return waitCredentials;
                  case 145:
                    if (subtype === 1) {
                      username = (0, _strings.encodeUTF8)(this._getCredentials().username).slice(0, 255);
                    } else {
                      username = "";
                    }

                    password = (0, _strings.encodeUTF8)(this._getCredentials().password).slice(0, 255);
                    credentials = new Uint8Array(username.length + password.length + 2);
                    credentials[0] = username.length;
                    credentials[username.length + 1] = password.length;

                    for (_i = 0; _i < username.length; _i++) {
                      credentials[_i + 1] = username.charCodeAt(_i);
                    }

                    for (_i2 = 0; _i2 < password.length; _i2++) {
                      credentials[username.length + 2 + _i2] = password.charCodeAt(_i2);
                    }

                    _context4.t2 = this._sock;
                    _context4.next = 155;
                    
return clientCipher.makeMessage(credentials);
                  case 155:
                    _context4.t3 = _context4.sent;
                    _context4.t2.sQpushBytes.call(_context4.t2, _context4.t3);
                    this._sock.flush();
                  case 158:
                  case "end":
                    return _context4.stop();
                }
              }, _callee4, this);
            }));

            function negotiateRA2neAuthAsync() {
              return _negotiateRA2neAuthAsync.apply(this, arguments);
            }

            
return negotiateRA2neAuthAsync;
          })()
        }, {
          key: "hasStarted",
          get: function get() {
            return this._hasStarted;
          },
          set: function set(s) {
            this._hasStarted = s;
          }
        }]);
      })(_eventtarget["default"]);
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/raw.js
  var require_raw = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/raw.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var RawDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function RawDecoder2() {
          _classCallCheck(this, RawDecoder2);
          this._lines = 0;
        }

        
return _createClass(RawDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (width === 0 || height === 0) {
              return true;
            }

            if (this._lines === 0) {
              this._lines = height;
            }

            var pixelSize = depth == 8 ? 1 : 4;
            var bytesPerLine = width * pixelSize;

            while (this._lines > 0) {
              if (sock.rQwait("RAW", bytesPerLine)) {
                return false;
              }

              var curY = y + (height - this._lines);
              var data = sock.rQshiftBytes(bytesPerLine, false);

              if (depth == 8) {
                var newdata = new Uint8Array(width * 4);

                for (var i = 0; i < width; i++) {
                  newdata[i * 4 + 0] = (data[i] >> 0 & 3) * 255 / 3;
                  newdata[i * 4 + 1] = (data[i] >> 2 & 3) * 255 / 3;
                  newdata[i * 4 + 2] = (data[i] >> 4 & 3) * 255 / 3;
                  newdata[i * 4 + 3] = 255;
                }

                data = newdata;
              }

              for (var _i = 0; _i < width; _i++) {
                data[_i * 4 + 3] = 255;
              }

              display.blitImage(x, curY, width, 1, data, 0);
              this._lines--;
            }

            
return true;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/copyrect.js
  var require_copyrect = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/copyrect.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var CopyRectDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function CopyRectDecoder2() {
          _classCallCheck(this, CopyRectDecoder2);
        }

        
return _createClass(CopyRectDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (sock.rQwait("COPYRECT", 4)) {
              return false;
            }

            var deltaX = sock.rQshift16();
            var deltaY = sock.rQshift16();

            if (width === 0 || height === 0) {
              return true;
            }

            display.copyImage(deltaX, deltaY, x, y, width, height);
            
return true;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/rre.js
  var require_rre = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/rre.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var RREDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function RREDecoder2() {
          _classCallCheck(this, RREDecoder2);
          this._subrects = 0;
        }

        
return _createClass(RREDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (this._subrects === 0) {
              if (sock.rQwait("RRE", 4 + 4)) {
                return false;
              }

              this._subrects = sock.rQshift32();
              var color = sock.rQshiftBytes(4);

              display.fillRect(x, y, width, height, color);
            }

            while (this._subrects > 0) {
              if (sock.rQwait("RRE", 4 + 8)) {
                return false;
              }

              var _color = sock.rQshiftBytes(4);
              var sx = sock.rQshift16();
              var sy = sock.rQshift16();
              var swidth = sock.rQshift16();
              var sheight = sock.rQshift16();

              display.fillRect(x + sx, y + sy, swidth, sheight, _color);
              this._subrects--;
            }

            
return true;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/hextile.js
  var require_hextile = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/hextile.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var HextileDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function HextileDecoder2() {
          _classCallCheck(this, HextileDecoder2);
          this._tiles = 0;
          this._lastsubencoding = 0;
          this._tileBuffer = new Uint8Array(16 * 16 * 4);
        }

        
return _createClass(HextileDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (this._tiles === 0) {
              this._tilesX = Math.ceil(width / 16);
              this._tilesY = Math.ceil(height / 16);
              this._totalTiles = this._tilesX * this._tilesY;
              this._tiles = this._totalTiles;
            }

            while (this._tiles > 0) {
              var bytes = 1;

              if (sock.rQwait("HEXTILE", bytes)) {
                return false;
              }

              var subencoding = sock.rQpeek8();

              if (subencoding > 30) {
                throw new Error("Illegal hextile subencoding (subencoding: " + subencoding + ")");
              }

              var currTile = this._totalTiles - this._tiles;
              var tileX = currTile % this._tilesX;
              var tileY = Math.floor(currTile / this._tilesX);
              var tx = x + tileX * 16;
              var ty = y + tileY * 16;
              var tw = Math.min(16, x + width - tx);
              var th = Math.min(16, y + height - ty);

              if (subencoding & 1) {
                bytes += tw * th * 4;
              } else {
                if (subencoding & 2) {
                  bytes += 4;
                }

                if (subencoding & 4) {
                  bytes += 4;
                }

                if (subencoding & 8) {
                  bytes++;

                  if (sock.rQwait("HEXTILE", bytes)) {
                    return false;
                  }

                  var subrects = sock.rQpeekBytes(bytes).at(-1);

                  if (subencoding & 16) {
                    bytes += subrects * (4 + 2);
                  } else {
                    bytes += subrects * 2;
                  }
                }
              }

              if (sock.rQwait("HEXTILE", bytes)) {
                return false;
              }

              sock.rQshift8();

              if (subencoding === 0) {
                if (this._lastsubencoding & 1) {
                  Log.Debug("     Ignoring blank after RAW");
                } else {
                  display.fillRect(tx, ty, tw, th, this._background);
                }
              } else if (subencoding & 1) {
                var pixels = tw * th;
                var data = sock.rQshiftBytes(pixels * 4, false);

                for (var i = 0; i < pixels; i++) {
                  data[i * 4 + 3] = 255;
                }

                display.blitImage(tx, ty, tw, th, data, 0);
              } else {
                if (subencoding & 2) {
                  this._background = new Uint8Array(sock.rQshiftBytes(4));
                }

                if (subencoding & 4) {
                  this._foreground = new Uint8Array(sock.rQshiftBytes(4));
                }

                this._startTile(tx, ty, tw, th, this._background);

                if (subencoding & 8) {
                  var _subrects = sock.rQshift8();

                  for (var s = 0; s < _subrects; s++) {
                    var color = void 0;

                    if (subencoding & 16) {
                      color = sock.rQshiftBytes(4);
                    } else {
                      color = this._foreground;
                    }

                    var xy = sock.rQshift8();
                    var sx = xy >> 4;
                    var sy = xy & 15;
                    var wh = sock.rQshift8();
                    var sw = (wh >> 4) + 1;
                    var sh = (wh & 15) + 1;

                    this._subTile(sx, sy, sw, sh, color);
                  }
                }

                this._finishTile(display);
              }

              this._lastsubencoding = subencoding;
              this._tiles--;
            }

            
return true;
          }

          // start updating a tile
        }, {
          key: "_startTile",
          value: function _startTile(x, y, width, height, color) {
            this._tileX = x;
            this._tileY = y;
            this._tileW = width;
            this._tileH = height;
            var red = color[0];
            var green = color[1];
            var blue = color[2];
            var data = this._tileBuffer;

            for (var i = 0; i < width * height * 4; i += 4) {
              data[i] = red;
              data[i + 1] = green;
              data[i + 2] = blue;
              data[i + 3] = 255;
            }
          }

          // update sub-rectangle of the current tile
        }, {
          key: "_subTile",
          value: function _subTile(x, y, w, h, color) {
            var red = color[0];
            var green = color[1];
            var blue = color[2];
            var xend = x + w;
            var yend = y + h;
            var data = this._tileBuffer;
            var width = this._tileW;

            for (var j = y; j < yend; j++) {
              for (var i = x; i < xend; i++) {
                var p = (i + j * width) * 4;

                data[p] = red;
                data[p + 1] = green;
                data[p + 2] = blue;
                data[p + 3] = 255;
              }
            }
          }

          // draw the current tile to the screen
        }, {
          key: "_finishTile",
          value: function _finishTile(display) {
            display.blitImage(this._tileX, this._tileY, this._tileW, this._tileH, this._tileBuffer, 0);
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/tight.js
  var require_tight = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/tight.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var Log = _interopRequireWildcard(require_logging());
      var _inflator = _interopRequireDefault(require_inflator());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var TightDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function TightDecoder2() {
          _classCallCheck(this, TightDecoder2);
          this._ctl = null;
          this._filter = null;
          this._numColors = 0;
          this._palette = new Uint8Array(1024);
          this._len = 0;
          this._zlibs = [];

          for (var i = 0; i < 4; i++) {
            this._zlibs[i] = new _inflator["default"]();
          }
        }

        
return _createClass(TightDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (this._ctl === null) {
              if (sock.rQwait("TIGHT compression-control", 1)) {
                return false;
              }

              this._ctl = sock.rQshift8();

              for (var i = 0; i < 4; i++) {
                if (this._ctl >> i & 1) {
                  this._zlibs[i].reset();
                  Log.Info("Reset zlib stream " + i);
                }
              }

              this._ctl = this._ctl >> 4;
            }

            var ret;

            if (this._ctl === 8) {
              ret = this._fillRect(x, y, width, height, sock, display, depth);
            } else if (this._ctl === 9) {
              ret = this._jpegRect(x, y, width, height, sock, display, depth);
            } else if (this._ctl === 10) {
              ret = this._pngRect(x, y, width, height, sock, display, depth);
            } else if ((this._ctl & 8) == 0) {
              ret = this._basicRect(this._ctl, x, y, width, height, sock, display, depth);
            } else {
              throw new Error("Illegal tight compression received (ctl: " + this._ctl + ")");
            }

            if (ret) {
              this._ctl = null;
            }

            
return ret;
          }
        }, {
          key: "_fillRect",
          value: function _fillRect(x, y, width, height, sock, display, depth) {
            if (sock.rQwait("TIGHT", 3)) {
              return false;
            }

            var pixel = sock.rQshiftBytes(3);

            display.fillRect(x, y, width, height, pixel, false);
            
return true;
          }
        }, {
          key: "_jpegRect",
          value: function _jpegRect(x, y, width, height, sock, display, depth) {
            var data = this._readData(sock);

            if (data === null) {
              return false;
            }

            display.imageRect(x, y, width, height, "image/jpeg", data);
            
return true;
          }
        }, {
          key: "_pngRect",
          value: function _pngRect(x, y, width, height, sock, display, depth) {
            throw new Error("PNG received in standard Tight rect");
          }
        }, {
          key: "_basicRect",
          value: function _basicRect(ctl, x, y, width, height, sock, display, depth) {
            if (this._filter === null) {
              if (ctl & 4) {
                if (sock.rQwait("TIGHT", 1)) {
                  return false;
                }

                this._filter = sock.rQshift8();
              } else {
                this._filter = 0;
              }
            }

            var streamId = ctl & 3;
            var ret;

            switch (this._filter) {
              case 0:
                ret = this._copyFilter(streamId, x, y, width, height, sock, display, depth);
                break;
              case 1:
                ret = this._paletteFilter(streamId, x, y, width, height, sock, display, depth);
                break;
              case 2:
                ret = this._gradientFilter(streamId, x, y, width, height, sock, display, depth);
                break;
              default:
                throw new Error("Illegal tight filter received (ctl: " + this._filter + ")");
            }

            if (ret) {
              this._filter = null;
            }

            
return ret;
          }
        }, {
          key: "_copyFilter",
          value: function _copyFilter(streamId, x, y, width, height, sock, display, depth) {
            var uncompressedSize = width * height * 3;
            var data;

            if (uncompressedSize === 0) {
              return true;
            }

            if (uncompressedSize < 12) {
              if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
              }

              data = sock.rQshiftBytes(uncompressedSize);
            } else {
              data = this._readData(sock);

              if (data === null) {
                return false;
              }

              this._zlibs[streamId].setInput(data);
              data = this._zlibs[streamId].inflate(uncompressedSize);
              this._zlibs[streamId].setInput(null);
            }

            var rgbx = new Uint8Array(width * height * 4);

            for (var i = 0, j = 0; i < width * height * 4; i += 4, j += 3) {
              rgbx[i] = data[j];
              rgbx[i + 1] = data[j + 1];
              rgbx[i + 2] = data[j + 2];
              rgbx[i + 3] = 255;
            }

            display.blitImage(x, y, width, height, rgbx, 0, false);
            
return true;
          }
        }, {
          key: "_paletteFilter",
          value: function _paletteFilter(streamId, x, y, width, height, sock, display, depth) {
            if (this._numColors === 0) {
              if (sock.rQwait("TIGHT palette", 1)) {
                return false;
              }

              var numColors = sock.rQpeek8() + 1;
              var paletteSize = numColors * 3;

              if (sock.rQwait("TIGHT palette", 1 + paletteSize)) {
                return false;
              }

              this._numColors = numColors;
              sock.rQskipBytes(1);
              sock.rQshiftTo(this._palette, paletteSize);
            }

            var bpp = this._numColors <= 2 ? 1 : 8;
            var rowSize = Math.floor((width * bpp + 7) / 8);
            var uncompressedSize = rowSize * height;
            var data;

            if (uncompressedSize === 0) {
              return true;
            }

            if (uncompressedSize < 12) {
              if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
              }

              data = sock.rQshiftBytes(uncompressedSize);
            } else {
              data = this._readData(sock);

              if (data === null) {
                return false;
              }

              this._zlibs[streamId].setInput(data);
              data = this._zlibs[streamId].inflate(uncompressedSize);
              this._zlibs[streamId].setInput(null);
            }

            if (this._numColors == 2) {
              this._monoRect(x, y, width, height, data, this._palette, display);
            } else {
              this._paletteRect(x, y, width, height, data, this._palette, display);
            }

            this._numColors = 0;
            
return true;
          }
        }, {
          key: "_monoRect",
          value: function _monoRect(x, y, width, height, data, palette, display) {
            var dest = this._getScratchBuffer(width * height * 4);
            var w = Math.floor((width + 7) / 8);
            var w1 = Math.floor(width / 8);

            for (var _y = 0; _y < height; _y++) {
              var dp = void 0, sp = void 0, _x = void 0;

              for (_x = 0; _x < w1; _x++) {
                for (var b = 7; b >= 0; b--) {
                  dp = (_y * width + _x * 8 + 7 - b) * 4;
                  sp = (data[_y * w + _x] >> b & 1) * 3;
                  dest[dp] = palette[sp];
                  dest[dp + 1] = palette[sp + 1];
                  dest[dp + 2] = palette[sp + 2];
                  dest[dp + 3] = 255;
                }
              }

              for (var _b = 7; _b >= 8 - width % 8; _b--) {
                dp = (_y * width + _x * 8 + 7 - _b) * 4;
                sp = (data[_y * w + _x] >> _b & 1) * 3;
                dest[dp] = palette[sp];
                dest[dp + 1] = palette[sp + 1];
                dest[dp + 2] = palette[sp + 2];
                dest[dp + 3] = 255;
              }
            }

            display.blitImage(x, y, width, height, dest, 0, false);
          }
        }, {
          key: "_paletteRect",
          value: function _paletteRect(x, y, width, height, data, palette, display) {
            var dest = this._getScratchBuffer(width * height * 4);
            var total = width * height * 4;

            for (var i = 0, j = 0; i < total; i += 4, j++) {
              var sp = data[j] * 3;

              dest[i] = palette[sp];
              dest[i + 1] = palette[sp + 1];
              dest[i + 2] = palette[sp + 2];
              dest[i + 3] = 255;
            }

            display.blitImage(x, y, width, height, dest, 0, false);
          }
        }, {
          key: "_gradientFilter",
          value: function _gradientFilter(streamId, x, y, width, height, sock, display, depth) {
            var uncompressedSize = width * height * 3;
            var data;

            if (uncompressedSize === 0) {
              return true;
            }

            if (uncompressedSize < 12) {
              if (sock.rQwait("TIGHT", uncompressedSize)) {
                return false;
              }

              data = sock.rQshiftBytes(uncompressedSize);
            } else {
              data = this._readData(sock);

              if (data === null) {
                return false;
              }

              this._zlibs[streamId].setInput(data);
              data = this._zlibs[streamId].inflate(uncompressedSize);
              this._zlibs[streamId].setInput(null);
            }

            var rgbx = new Uint8Array(4 * width * height);
            var rgbxIndex = 0, dataIndex = 0;
            var left = new Uint8Array(3);

            for (var _x2 = 0; _x2 < width; _x2++) {
              for (var c = 0; c < 3; c++) {
                var prediction = left[c];
                var value = data[dataIndex++] + prediction;

                rgbx[rgbxIndex++] = value;
                left[c] = value;
              }

              rgbx[rgbxIndex++] = 255;
            }

            var upperIndex = 0;
            var upper = new Uint8Array(3), upperleft = new Uint8Array(3);

            for (var _y2 = 1; _y2 < height; _y2++) {
              left.fill(0);
              upperleft.fill(0);

              for (var _x3 = 0; _x3 < width; _x3++) {
                for (var _c = 0; _c < 3; _c++) {
                  upper[_c] = rgbx[upperIndex++];
                  var _prediction = left[_c] + upper[_c] - upperleft[_c];

                  if (_prediction < 0) {
                    _prediction = 0;
                  } else if (_prediction > 255) {
                    _prediction = 255;
                  }

                  var _value = data[dataIndex++] + _prediction;

                  rgbx[rgbxIndex++] = _value;
                  upperleft[_c] = upper[_c];
                  left[_c] = _value;
                }

                rgbx[rgbxIndex++] = 255;
                upperIndex++;
              }
            }

            display.blitImage(x, y, width, height, rgbx, 0, false);
            
return true;
          }
        }, {
          key: "_readData",
          value: function _readData(sock) {
            if (this._len === 0) {
              if (sock.rQwait("TIGHT", 3)) {
                return null;
              }

              var _byte;

              _byte = sock.rQshift8();
              this._len = _byte & 127;

              if (_byte & 128) {
                _byte = sock.rQshift8();
                this._len |= (_byte & 127) << 7;

                if (_byte & 128) {
                  _byte = sock.rQshift8();
                  this._len |= _byte << 14;
                }
              }
            }

            if (sock.rQwait("TIGHT", this._len)) {
              return null;
            }

            var data = sock.rQshiftBytes(this._len, false);

            this._len = 0;
            
return data;
          }
        }, {
          key: "_getScratchBuffer",
          value: function _getScratchBuffer(size) {
            if (!this._scratchBuffer || this._scratchBuffer.length < size) {
              this._scratchBuffer = new Uint8Array(size);
            }

            
return this._scratchBuffer;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/tightpng.js
  var require_tightpng = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/tightpng.js"(exports) {
      "use strict";

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _tight = _interopRequireDefault(require_tight());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      function _callSuper(t, o, e) {
        return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
      }

      function _possibleConstructorReturn(t, e) {
        if (e && ("object" == _typeof(e) || "function" == typeof e)) return e;
        if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
        
return _assertThisInitialized(t);
      }

      function _assertThisInitialized(e) {
        if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        
return e;
      }

      function _isNativeReflectConstruct() {
        try {
          var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
          }));
        } catch (t2) {
        }

        
return (_isNativeReflectConstruct = function _isNativeReflectConstruct2() {
          return !!t;
        })();
      }

      function _getPrototypeOf(t) {
        return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t2) {
          return t2.__proto__ || Object.getPrototypeOf(t2);
        }, _getPrototypeOf(t);
      }

      function _inherits(t, e) {
        if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
        t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } }), Object.defineProperty(t, "prototype", { writable: false }), e && _setPrototypeOf(t, e);
      }

      function _setPrototypeOf(t, e) {
        return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t2, e2) {
          return t2.__proto__ = e2, t2;
        }, _setPrototypeOf(t, e);
      }

      var TightPNGDecoder = exports["default"] = /* @__PURE__ */ (function(_TightDecoder) {
        function TightPNGDecoder2() {
          _classCallCheck(this, TightPNGDecoder2);
          
return _callSuper(this, TightPNGDecoder2, arguments);
        }

        _inherits(TightPNGDecoder2, _TightDecoder);
        
return _createClass(TightPNGDecoder2, [{
          key: "_pngRect",
          value: function _pngRect(x, y, width, height, sock, display, depth) {
            var data = this._readData(sock);

            if (data === null) {
              return false;
            }

            display.imageRect(x, y, width, height, "image/png", data);
            
return true;
          }
        }, {
          key: "_basicRect",
          value: function _basicRect(ctl, x, y, width, height, sock, display, depth) {
            throw new Error("BasicCompression received in TightPNG rect");
          }
        }]);
      })(_tight["default"]);
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/zrle.js
  var require_zrle = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/zrle.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _inflator = _interopRequireDefault(require_inflator());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var ZRLE_TILE_WIDTH = 64;
      var ZRLE_TILE_HEIGHT = 64;
      var ZRLEDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function ZRLEDecoder2() {
          _classCallCheck(this, ZRLEDecoder2);
          this._length = 0;
          this._inflator = new _inflator["default"]();
          this._pixelBuffer = new Uint8Array(ZRLE_TILE_WIDTH * ZRLE_TILE_HEIGHT * 4);
          this._tileBuffer = new Uint8Array(ZRLE_TILE_WIDTH * ZRLE_TILE_HEIGHT * 4);
        }

        
return _createClass(ZRLEDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            if (this._length === 0) {
              if (sock.rQwait("ZLib data length", 4)) {
                return false;
              }

              this._length = sock.rQshift32();
            }

            if (sock.rQwait("Zlib data", this._length)) {
              return false;
            }

            var data = sock.rQshiftBytes(this._length, false);

            this._inflator.setInput(data);

            for (var ty = y; ty < y + height; ty += ZRLE_TILE_HEIGHT) {
              var th = Math.min(ZRLE_TILE_HEIGHT, y + height - ty);

              for (var tx = x; tx < x + width; tx += ZRLE_TILE_WIDTH) {
                var tw = Math.min(ZRLE_TILE_WIDTH, x + width - tx);
                var tileSize = tw * th;
                var subencoding = this._inflator.inflate(1)[0];

                if (subencoding === 0) {
                  var _data = this._readPixels(tileSize);

                  display.blitImage(tx, ty, tw, th, _data, 0, false);
                } else if (subencoding === 1) {
                  var background = this._readPixels(1);

                  display.fillRect(tx, ty, tw, th, [background[0], background[1], background[2]]);
                } else if (subencoding >= 2 && subencoding <= 16) {
                  var _data2 = this._decodePaletteTile(subencoding, tileSize, tw, th);

                  display.blitImage(tx, ty, tw, th, _data2, 0, false);
                } else if (subencoding === 128) {
                  var _data3 = this._decodeRLETile(tileSize);

                  display.blitImage(tx, ty, tw, th, _data3, 0, false);
                } else if (subencoding >= 130 && subencoding <= 255) {
                  var _data4 = this._decodeRLEPaletteTile(subencoding - 128, tileSize);

                  display.blitImage(tx, ty, tw, th, _data4, 0, false);
                } else {
                  throw new Error("Unknown subencoding: " + subencoding);
                }
              }
            }

            this._length = 0;
            
return true;
          }
        }, {
          key: "_getBitsPerPixelInPalette",
          value: function _getBitsPerPixelInPalette(paletteSize) {
            if (paletteSize <= 2) {
              return 1;
            } else if (paletteSize <= 4) {
              return 2;
            } else if (paletteSize <= 16) {
              return 4;
            }
          }
        }, {
          key: "_readPixels",
          value: function _readPixels(pixels) {
            var data = this._pixelBuffer;
            var buffer = this._inflator.inflate(3 * pixels);

            for (var i = 0, j = 0; i < pixels * 4; i += 4, j += 3) {
              data[i] = buffer[j];
              data[i + 1] = buffer[j + 1];
              data[i + 2] = buffer[j + 2];
              data[i + 3] = 255;
            }

            
return data;
          }
        }, {
          key: "_decodePaletteTile",
          value: function _decodePaletteTile(paletteSize, tileSize, tilew, tileh) {
            var data = this._tileBuffer;
            var palette = this._readPixels(paletteSize);
            var bitsPerPixel = this._getBitsPerPixelInPalette(paletteSize);
            var mask = (1 << bitsPerPixel) - 1;
            var offset = 0;
            var encoded = this._inflator.inflate(1)[0];

            for (var y = 0; y < tileh; y++) {
              var shift = 8 - bitsPerPixel;

              for (var x = 0; x < tilew; x++) {
                if (shift < 0) {
                  shift = 8 - bitsPerPixel;
                  encoded = this._inflator.inflate(1)[0];
                }

                var indexInPalette = encoded >> shift & mask;

                data[offset] = palette[indexInPalette * 4];
                data[offset + 1] = palette[indexInPalette * 4 + 1];
                data[offset + 2] = palette[indexInPalette * 4 + 2];
                data[offset + 3] = palette[indexInPalette * 4 + 3];
                offset += 4;
                shift -= bitsPerPixel;
              }

              if (shift < 8 - bitsPerPixel && y < tileh - 1) {
                encoded = this._inflator.inflate(1)[0];
              }
            }

            
return data;
          }
        }, {
          key: "_decodeRLETile",
          value: function _decodeRLETile(tileSize) {
            var data = this._tileBuffer;
            var i = 0;

            while (i < tileSize) {
              var pixel = this._readPixels(1);
              var length = this._readRLELength();

              for (var j = 0; j < length; j++) {
                data[i * 4] = pixel[0];
                data[i * 4 + 1] = pixel[1];
                data[i * 4 + 2] = pixel[2];
                data[i * 4 + 3] = pixel[3];
                i++;
              }
            }

            
return data;
          }
        }, {
          key: "_decodeRLEPaletteTile",
          value: function _decodeRLEPaletteTile(paletteSize, tileSize) {
            var data = this._tileBuffer;
            var palette = this._readPixels(paletteSize);
            var offset = 0;

            while (offset < tileSize) {
              var indexInPalette = this._inflator.inflate(1)[0];
              var length = 1;

              if (indexInPalette >= 128) {
                indexInPalette -= 128;
                length = this._readRLELength();
              }

              if (indexInPalette > paletteSize) {
                throw new Error("Too big index in palette: " + indexInPalette + ", palette size: " + paletteSize);
              }

              if (offset + length > tileSize) {
                throw new Error("Too big rle length in palette mode: " + length + ", allowed length is: " + (tileSize - offset));
              }

              for (var j = 0; j < length; j++) {
                data[offset * 4] = palette[indexInPalette * 4];
                data[offset * 4 + 1] = palette[indexInPalette * 4 + 1];
                data[offset * 4 + 2] = palette[indexInPalette * 4 + 2];
                data[offset * 4 + 3] = palette[indexInPalette * 4 + 3];
                offset++;
              }
            }

            
return data;
          }
        }, {
          key: "_readRLELength",
          value: function _readRLELength() {
            var length = 0;
            var current = 0;

            do {
              current = this._inflator.inflate(1)[0];
              length += current;
            } while (current === 255);

            
return length + 1;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/decoders/jpeg.js
  var require_jpeg = __commonJS({
    "node_modules/@novnc/novnc/lib/decoders/jpeg.js"(exports) {
      "use strict";
      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;

      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      function _toConsumableArray(r) {
        return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread();
      }

      function _nonIterableSpread() {
        throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }

      function _iterableToArray(r) {
        if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r);
      }

      function _arrayWithoutHoles(r) {
        if (Array.isArray(r)) return _arrayLikeToArray(r);
      }

      function _createForOfIteratorHelper(r, e) {
        var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

        if (!t) {
          if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
            t && (r = t);

            var _n = 0, F = function F2() {
            };

            
return { s: F, n: function n() {
              return _n >= r.length ? { done: true } : { done: false, value: r[_n++] };
            }, e: function e2(r2) {
              throw r2;
            }, f: F };
          }

          throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
        }

        var o, a = true, u = false;

        
return { s: function s() {
          t = t.call(r);
        }, n: function n() {
          var r2 = t.next();

          
return a = r2.done, r2;
        }, e: function e2(r2) {
          u = true, o = r2;
        }, f: function f() {
          try {
            a || null == t["return"] || t["return"]();
          } finally {
            if (u) throw o;
          }
        } };
      }

      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);

          
return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }

      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        
return n;
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      var JPEGDecoder = exports["default"] = /* @__PURE__ */ (function() {
        function JPEGDecoder2() {
          _classCallCheck(this, JPEGDecoder2);
          this._cachedQuantTables = [];
          this._cachedHuffmanTables = [];
          this._segments = [];
        }

        
return _createClass(JPEGDecoder2, [{
          key: "decodeRect",
          value: function decodeRect(x, y, width, height, sock, display, depth) {
            while (true) {
              var segment = this._readSegment(sock);

              if (segment === null) {
                return false;
              }

              this._segments.push(segment);

              if (segment[1] === 217) {
                break;
              }
            }

            var huffmanTables = [];
            var quantTables = [];
            var _iterator = _createForOfIteratorHelper(this._segments), _step;

            try {
              for (_iterator.s(); !(_step = _iterator.n()).done; ) {
                var _segment = _step.value;
                var type = _segment[1];

                if (type === 196) {
                  huffmanTables.push(_segment);
                } else if (type === 219) {
                  quantTables.push(_segment);
                }
              }
            } catch (err) {
              _iterator.e(err);
            } finally {
              _iterator.f();
            }

            var sofIndex = this._segments.findIndex(function(x2) {
              return x2[1] == 192 || x2[1] == 194;
            });

            if (sofIndex == -1) {
              throw new Error("Illegal JPEG image without SOF");
            }

            if (quantTables.length === 0) {
              var _this$_segments;

              (_this$_segments = this._segments).splice.apply(_this$_segments, [sofIndex + 1, 0].concat(_toConsumableArray(this._cachedQuantTables)));
            }

            if (huffmanTables.length === 0) {
              var _this$_segments2;

              (_this$_segments2 = this._segments).splice.apply(_this$_segments2, [sofIndex + 1, 0].concat(_toConsumableArray(this._cachedHuffmanTables)));
            }

            var length = 0;
            var _iterator2 = _createForOfIteratorHelper(this._segments), _step2;

            try {
              for (_iterator2.s(); !(_step2 = _iterator2.n()).done; ) {
                var _segment2 = _step2.value;

                length += _segment2.length;
              }
            } catch (err) {
              _iterator2.e(err);
            } finally {
              _iterator2.f();
            }

            var data = new Uint8Array(length);

            length = 0;
            var _iterator3 = _createForOfIteratorHelper(this._segments), _step3;

            try {
              for (_iterator3.s(); !(_step3 = _iterator3.n()).done; ) {
                var _segment3 = _step3.value;

                data.set(_segment3, length);
                length += _segment3.length;
              }
            } catch (err) {
              _iterator3.e(err);
            } finally {
              _iterator3.f();
            }

            display.imageRect(x, y, width, height, "image/jpeg", data);

            if (huffmanTables.length !== 0) {
              this._cachedHuffmanTables = huffmanTables;
            }

            if (quantTables.length !== 0) {
              this._cachedQuantTables = quantTables;
            }

            this._segments = [];
            
return true;
          }
        }, {
          key: "_readSegment",
          value: function _readSegment(sock) {
            if (sock.rQwait("JPEG", 2)) {
              return null;
            }

            var marker = sock.rQshift8();

            if (marker != 255) {
              throw new Error("Illegal JPEG marker received (byte: " + marker + ")");
            }

            var type = sock.rQshift8();

            if (type >= 208 && type <= 217 || type == 1) {
              return new Uint8Array([marker, type]);
            }

            if (sock.rQwait("JPEG", 2, 2)) {
              return null;
            }

            var length = sock.rQshift16();

            if (length < 2) {
              throw new Error("Illegal JPEG length received (length: " + length + ")");
            }

            if (sock.rQwait("JPEG", length - 2, 4)) {
              return null;
            }

            var extra = 0;

            if (type === 218) {
              extra += 2;

              while (true) {
                if (sock.rQwait("JPEG", length - 2 + extra, 4)) {
                  return null;
                }

                var data = sock.rQpeekBytes(length - 2 + extra, false);

                if (data.at(-2) === 255 && data.at(-1) !== 0 && !(data.at(-1) >= 208 && data.at(-1) <= 215)) {
                  extra -= 2;
                  break;
                }

                extra++;
              }
            }

            var segment = new Uint8Array(2 + length + extra);

            segment[0] = marker;
            segment[1] = type;
            segment[2] = length >> 8;
            segment[3] = length;
            segment.set(sock.rQshiftBytes(length - 2 + extra, false), 4);
            
return segment;
          }
        }]);
      })();
    }
  });

  // node_modules/@novnc/novnc/lib/rfb.js
  var require_rfb = __commonJS({
    "node_modules/@novnc/novnc/lib/rfb.js"(exports) {
      function _typeof(o) {
        "@babel/helpers - typeof";
        
return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o2) {
          return typeof o2;
        } : function(o2) {
          return o2 && "function" == typeof Symbol && o2.constructor === Symbol && o2 !== Symbol.prototype ? "symbol" : typeof o2;
        }, _typeof(o);
      }

      Object.defineProperty(exports, "__esModule", {
        value: true
      });
      exports["default"] = void 0;
      var _int = require_int();
      var Log = _interopRequireWildcard(require_logging());
      var _strings = require_strings();
      var _browser = require_browser();
      var _element = require_element();
      var _events = require_events();
      var _eventtarget = _interopRequireDefault(require_eventtarget());
      var _display = _interopRequireDefault(require_display());
      var _inflator = _interopRequireDefault(require_inflator());
      var _deflator = _interopRequireDefault(require_deflator());
      var _keyboard = _interopRequireDefault(require_keyboard());
      var _gesturehandler = _interopRequireDefault(require_gesturehandler());
      var _cursor = _interopRequireDefault(require_cursor());
      var _websock = _interopRequireDefault(require_websock());
      var _keysym = _interopRequireDefault(require_keysym());
      var _xtscancodes = _interopRequireDefault(require_xtscancodes());
      var _encodings = require_encodings();
      var _ra = _interopRequireDefault(require_ra2());
      var _crypto = _interopRequireDefault(require_crypto());
      var _raw = _interopRequireDefault(require_raw());
      var _copyrect = _interopRequireDefault(require_copyrect());
      var _rre = _interopRequireDefault(require_rre());
      var _hextile = _interopRequireDefault(require_hextile());
      var _tight = _interopRequireDefault(require_tight());
      var _tightpng = _interopRequireDefault(require_tightpng());
      var _zrle = _interopRequireDefault(require_zrle());
      var _jpeg = _interopRequireDefault(require_jpeg());

      function _interopRequireDefault(e) {
        return e && e.__esModule ? e : { "default": e };
      }

      function _getRequireWildcardCache(e) {
        if ("function" != typeof WeakMap) return null;
        var r = /* @__PURE__ */ new WeakMap(), t = /* @__PURE__ */ new WeakMap();

        
return (_getRequireWildcardCache = function _getRequireWildcardCache2(e2) {
          return e2 ? t : r;
        })(e);
      }

      function _interopRequireWildcard(e, r) {
        if (!r && e && e.__esModule) return e;
        if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e };
        var t = _getRequireWildcardCache(r);

        if (t && t.has(e)) return t.get(e);
        var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

        for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) {
          var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

          i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u];
        }

        
return n["default"] = e, t && t.set(e, n), n;
      }

      function _regeneratorRuntime() {
        "use strict";

        _regeneratorRuntime = function _regeneratorRuntime2() {
          return e;
        };

        var t, e = {}, r = Object.prototype, n = r.hasOwnProperty, o = Object.defineProperty || function(t2, e2, r2) {
          t2[e2] = r2.value;
        }, i = "function" == typeof Symbol ? Symbol : {}, a = i.iterator || "@@iterator", c = i.asyncIterator || "@@asyncIterator", u = i.toStringTag || "@@toStringTag";

        function define(t2, e2, r2) {
          return Object.defineProperty(t2, e2, { value: r2, enumerable: true, configurable: true, writable: true }), t2[e2];
        }

        try {
          define({}, "");
        } catch (t2) {
          define = function define2(t3, e2, r2) {
            return t3[e2] = r2;
          };
        }

        function wrap(t2, e2, r2, n2) {
          var i2 = e2 && e2.prototype instanceof Generator ? e2 : Generator, a2 = Object.create(i2.prototype), c2 = new Context(n2 || []);

          
return o(a2, "_invoke", { value: makeInvokeMethod(t2, r2, c2) }), a2;
        }

        function tryCatch(t2, e2, r2) {
          try {
            return { type: "normal", arg: t2.call(e2, r2) };
          } catch (t3) {
            return { type: "throw", arg: t3 };
          }
        }

        e.wrap = wrap;
        var h = "suspendedStart", l = "suspendedYield", f = "executing", s = "completed", y = {};

        function Generator() {
        }

        function GeneratorFunction() {
        }

        function GeneratorFunctionPrototype() {
        }

        var p = {};

        define(p, a, function() {
          return this;
        });
        var d = Object.getPrototypeOf, v = d && d(d(values([])));

        v && v !== r && n.call(v, a) && (p = v);
        var g = GeneratorFunctionPrototype.prototype = Generator.prototype = Object.create(p);

        function defineIteratorMethods(t2) {
          ["next", "throw", "return"].forEach(function(e2) {
            define(t2, e2, function(t3) {
              return this._invoke(e2, t3);
            });
          });
        }

        function AsyncIterator(t2, e2) {
          function invoke(r3, o2, i2, a2) {
            var c2 = tryCatch(t2[r3], t2, o2);

            if ("throw" !== c2.type) {
              var u2 = c2.arg, h2 = u2.value;

              
return h2 && "object" == _typeof(h2) && n.call(h2, "__await") ? e2.resolve(h2.__await).then(function(t3) {
                invoke("next", t3, i2, a2);
              }, function(t3) {
                invoke("throw", t3, i2, a2);
              }) : e2.resolve(h2).then(function(t3) {
                u2.value = t3, i2(u2);
              }, function(t3) {
                return invoke("throw", t3, i2, a2);
              });
            }

            a2(c2.arg);
          }

          var r2;

          o(this, "_invoke", { value: function value(t3, n2) {
            function callInvokeWithMethodAndArg() {
              return new e2(function(e3, r3) {
                invoke(t3, n2, e3, r3);
              });
            }

            
return r2 = r2 ? r2.then(callInvokeWithMethodAndArg, callInvokeWithMethodAndArg) : callInvokeWithMethodAndArg();
          } });
        }

        function makeInvokeMethod(e2, r2, n2) {
          var o2 = h;

          
return function(i2, a2) {
            if (o2 === f) throw Error("Generator is already running");

            if (o2 === s) {
              if ("throw" === i2) throw a2;
              
return { value: t, done: true };
            }

            for (n2.method = i2, n2.arg = a2; ; ) {
              var c2 = n2.delegate;

              if (c2) {
                var u2 = maybeInvokeDelegate(c2, n2);

                if (u2) {
                  if (u2 === y) continue;
                  
return u2;
                }
              }

              if ("next" === n2.method) n2.sent = n2._sent = n2.arg;
              else if ("throw" === n2.method) {
                if (o2 === h) throw o2 = s, n2.arg;
                n2.dispatchException(n2.arg);
              } else "return" === n2.method && n2.abrupt("return", n2.arg);
              o2 = f;
              var p2 = tryCatch(e2, r2, n2);

              if ("normal" === p2.type) {
                if (o2 = n2.done ? s : l, p2.arg === y) continue;
                
return { value: p2.arg, done: n2.done };
              }

              "throw" === p2.type && (o2 = s, n2.method = "throw", n2.arg = p2.arg);
            }
          };
        }

        function maybeInvokeDelegate(e2, r2) {
          var n2 = r2.method, o2 = e2.iterator[n2];

          if (o2 === t) return r2.delegate = null, "throw" === n2 && e2.iterator["return"] && (r2.method = "return", r2.arg = t, maybeInvokeDelegate(e2, r2), "throw" === r2.method) || "return" !== n2 && (r2.method = "throw", r2.arg = new TypeError("The iterator does not provide a '" + n2 + "' method")), y;
          var i2 = tryCatch(o2, e2.iterator, r2.arg);

          if ("throw" === i2.type) return r2.method = "throw", r2.arg = i2.arg, r2.delegate = null, y;
          var a2 = i2.arg;

          
return a2 ? a2.done ? (r2[e2.resultName] = a2.value, r2.next = e2.nextLoc, "return" !== r2.method && (r2.method = "next", r2.arg = t), r2.delegate = null, y) : a2 : (r2.method = "throw", r2.arg = new TypeError("iterator result is not an object"), r2.delegate = null, y);
        }

        function pushTryEntry(t2) {
          var e2 = { tryLoc: t2[0] };

          1 in t2 && (e2.catchLoc = t2[1]), 2 in t2 && (e2.finallyLoc = t2[2], e2.afterLoc = t2[3]), this.tryEntries.push(e2);
        }

        function resetTryEntry(t2) {
          var e2 = t2.completion || {};

          e2.type = "normal", delete e2.arg, t2.completion = e2;
        }

        function Context(t2) {
          this.tryEntries = [{ tryLoc: "root" }], t2.forEach(pushTryEntry, this), this.reset(true);
        }

        function values(e2) {
          if (e2 || "" === e2) {
            var r2 = e2[a];

            if (r2) return r2.call(e2);
            if ("function" == typeof e2.next) return e2;

            if (!isNaN(e2.length)) {
              var o2 = -1, i2 = function next() {
                for (; ++o2 < e2.length; ) if (n.call(e2, o2)) return next.value = e2[o2], next.done = false, next;
                
return next.value = t, next.done = true, next;
              };

              
return i2.next = i2;
            }
          }

          throw new TypeError(_typeof(e2) + " is not iterable");
        }

        
return GeneratorFunction.prototype = GeneratorFunctionPrototype, o(g, "constructor", { value: GeneratorFunctionPrototype, configurable: true }), o(GeneratorFunctionPrototype, "constructor", { value: GeneratorFunction, configurable: true }), GeneratorFunction.displayName = define(GeneratorFunctionPrototype, u, "GeneratorFunction"), e.isGeneratorFunction = function(t2) {
          var e2 = "function" == typeof t2 && t2.constructor;

          
return !!e2 && (e2 === GeneratorFunction || "GeneratorFunction" === (e2.displayName || e2.name));
        }, e.mark = function(t2) {
          return Object.setPrototypeOf ? Object.setPrototypeOf(t2, GeneratorFunctionPrototype) : (t2.__proto__ = GeneratorFunctionPrototype, define(t2, u, "GeneratorFunction")), t2.prototype = Object.create(g), t2;
        }, e.awrap = function(t2) {
          return { __await: t2 };
        }, defineIteratorMethods(AsyncIterator.prototype), define(AsyncIterator.prototype, c, function() {
          return this;
        }), e.AsyncIterator = AsyncIterator, e.async = function(t2, r2, n2, o2, i2) {
          void 0 === i2 && (i2 = Promise);
          var a2 = new AsyncIterator(wrap(t2, r2, n2, o2), i2);

          
return e.isGeneratorFunction(r2) ? a2 : a2.next().then(function(t3) {
            return t3.done ? t3.value : a2.next();
          });
        }, defineIteratorMethods(g), define(g, u, "Generator"), define(g, a, function() {
          return this;
        }), define(g, "toString", function() {
          return "[object Generator]";
        }), e.keys = function(t2) {
          var e2 = Object(t2), r2 = [];

          for (var n2 in e2) r2.push(n2);

          
return r2.reverse(), function next() {
            for (; r2.length; ) {
              var t3 = r2.pop();

              if (t3 in e2) return next.value = t3, next.done = false, next;
            }

            
return next.done = true, next;
          };
        }, e.values = values, Context.prototype = { constructor: Context, reset: function reset(e2) {
          if (this.prev = 0, this.next = 0, this.sent = this._sent = t, this.done = false, this.delegate = null, this.method = "next", this.arg = t, this.tryEntries.forEach(resetTryEntry), !e2) for (var r2 in this) "t" === r2.charAt(0) && n.call(this, r2) && !isNaN(+r2.slice(1)) && (this[r2] = t);
        }, stop: function stop() {
          this.done = true;
          var t2 = this.tryEntries[0].completion;

          if ("throw" === t2.type) throw t2.arg;
          
return this.rval;
        }, dispatchException: function dispatchException(e2) {
          if (this.done) throw e2;
          var r2 = this;

          function handle(n2, o3) {
            return a2.type = "throw", a2.arg = e2, r2.next = n2, o3 && (r2.method = "next", r2.arg = t), !!o3;
          }

          for (var o2 = this.tryEntries.length - 1; o2 >= 0; --o2) {
            var i2 = this.tryEntries[o2], a2 = i2.completion;

            if ("root" === i2.tryLoc) return handle("end");

            if (i2.tryLoc <= this.prev) {
              var c2 = n.call(i2, "catchLoc"), u2 = n.call(i2, "finallyLoc");

              if (c2 && u2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              } else if (c2) {
                if (this.prev < i2.catchLoc) return handle(i2.catchLoc, true);
              } else {
                if (!u2) throw Error("try statement without catch or finally");
                if (this.prev < i2.finallyLoc) return handle(i2.finallyLoc);
              }
            }
          }
        }, abrupt: function abrupt(t2, e2) {
          for (var r2 = this.tryEntries.length - 1; r2 >= 0; --r2) {
            var o2 = this.tryEntries[r2];

            if (o2.tryLoc <= this.prev && n.call(o2, "finallyLoc") && this.prev < o2.finallyLoc) {
              var i2 = o2;

              break;
            }
          }

          i2 && ("break" === t2 || "continue" === t2) && i2.tryLoc <= e2 && e2 <= i2.finallyLoc && (i2 = null);
          var a2 = i2 ? i2.completion : {};

          
return a2.type = t2, a2.arg = e2, i2 ? (this.method = "next", this.next = i2.finallyLoc, y) : this.complete(a2);
        }, complete: function complete(t2, e2) {
          if ("throw" === t2.type) throw t2.arg;
          
return "break" === t2.type || "continue" === t2.type ? this.next = t2.arg : "return" === t2.type ? (this.rval = this.arg = t2.arg, this.method = "return", this.next = "end") : "normal" === t2.type && e2 && (this.next = e2), y;
        }, finish: function finish(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.finallyLoc === t2) return this.complete(r2.completion, r2.afterLoc), resetTryEntry(r2), y;
          }
        }, "catch": function _catch(t2) {
          for (var e2 = this.tryEntries.length - 1; e2 >= 0; --e2) {
            var r2 = this.tryEntries[e2];

            if (r2.tryLoc === t2) {
              var n2 = r2.completion;

              if ("throw" === n2.type) {
                var o2 = n2.arg;

                resetTryEntry(r2);
              }

              
return o2;
            }
          }

          throw Error("illegal catch attempt");
        }, delegateYield: function delegateYield(e2, r2, n2) {
          return this.delegate = { iterator: values(e2), resultName: r2, nextLoc: n2 }, "next" === this.method && (this.arg = t), y;
        } }, e;
      }

      function asyncGeneratorStep(n, t, e, r, o, a, c) {
        try {
          var i = n[a](c), u = i.value;
        } catch (n2) {
          return void e(n2);
        }

        i.done ? t(u) : Promise.resolve(u).then(r, o);
      }

      function _asyncToGenerator(n) {
        return function() {
          var t = this, e = arguments;

          
return new Promise(function(r, o) {
            var a = n.apply(t, e);

            function _next(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "next", n2);
            }

            function _throw(n2) {
              asyncGeneratorStep(a, r, o, _next, _throw, "throw", n2);
            }

            _next(void 0);
          });
        };
      }

      function _slicedToArray(r, e) {
        return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest();
      }

      function _nonIterableRest() {
        throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
      }

      function _iterableToArrayLimit(r, l) {
        var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

        if (null != t) {
          var e, n, i, u, a = [], f = true, o = false;

          try {
            if (i = (t = t.call(r)).next, 0 === l) {
              if (Object(t) !== t) return;
              f = false;
            } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = true) ;
          } catch (r2) {
            o = true, n = r2;
          } finally {
            try {
              if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return;
            } finally {
              if (o) throw n;
            }
          }

          
return a;
        }
      }

      function _arrayWithHoles(r) {
        if (Array.isArray(r)) return r;
      }

      function _createForOfIteratorHelper(r, e) {
        var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

        if (!t) {
          if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) {
            t && (r = t);

            var _n = 0, F = function F2() {
            };

            
return { s: F, n: function n() {
              return _n >= r.length ? { done: true } : { done: false, value: r[_n++] };
            }, e: function e2(r2) {
              throw r2;
            }, f: F };
          }

          throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
        }

        var o, a = true, u = false;

        
return { s: function s() {
          t = t.call(r);
        }, n: function n() {
          var r2 = t.next();

          
return a = r2.done, r2;
        }, e: function e2(r2) {
          u = true, o = r2;
        }, f: function f() {
          try {
            a || null == t["return"] || t["return"]();
          } finally {
            if (u) throw o;
          }
        } };
      }

      function _unsupportedIterableToArray(r, a) {
        if (r) {
          if ("string" == typeof r) return _arrayLikeToArray(r, a);
          var t = {}.toString.call(r).slice(8, -1);

          
return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0;
        }
      }

      function _arrayLikeToArray(r, a) {
        (null == a || a > r.length) && (a = r.length);
        for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e];
        
return n;
      }

      function _classCallCheck(a, n) {
        if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function");
      }

      function _defineProperties(e, r) {
        for (var t = 0; t < r.length; t++) {
          var o = r[t];

          o.enumerable = o.enumerable || false, o.configurable = true, "value" in o && (o.writable = true), Object.defineProperty(e, _toPropertyKey(o.key), o);
        }
      }

      function _createClass(e, r, t) {
        return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: false }), e;
      }

      function _toPropertyKey(t) {
        var i = _toPrimitive(t, "string");

        
return "symbol" == _typeof(i) ? i : i + "";
      }

      function _toPrimitive(t, r) {
        if ("object" != _typeof(t) || !t) return t;
        var e = t[Symbol.toPrimitive];

        if (void 0 !== e) {
          var i = e.call(t, r || "default");

          if ("object" != _typeof(i)) return i;
          throw new TypeError("@@toPrimitive must return a primitive value.");
        }

        
return ("string" === r ? String : Number)(t);
      }

      function _callSuper(t, o, e) {
        return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e));
      }

      function _possibleConstructorReturn(t, e) {
        if (e && ("object" == _typeof(e) || "function" == typeof e)) return e;
        if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined");
        
return _assertThisInitialized(t);
      }

      function _assertThisInitialized(e) {
        if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
        
return e;
      }

      function _isNativeReflectConstruct() {
        try {
          var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
          }));
        } catch (t2) {
        }

        
return (_isNativeReflectConstruct = function _isNativeReflectConstruct2() {
          return !!t;
        })();
      }

      function _getPrototypeOf(t) {
        return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function(t2) {
          return t2.__proto__ || Object.getPrototypeOf(t2);
        }, _getPrototypeOf(t);
      }

      function _inherits(t, e) {
        if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function");
        t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: true, configurable: true } }), Object.defineProperty(t, "prototype", { writable: false }), e && _setPrototypeOf(t, e);
      }

      function _setPrototypeOf(t, e) {
        return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function(t2, e2) {
          return t2.__proto__ = e2, t2;
        }, _setPrototypeOf(t, e);
      }

      var DISCONNECT_TIMEOUT = 3;
      var DEFAULT_BACKGROUND = "rgb(40, 40, 40)";
      var MOUSE_MOVE_DELAY = 17;
      var WHEEL_STEP = 50;
      var WHEEL_LINE_HEIGHT = 19;
      var GESTURE_ZOOMSENS = 75;
      var GESTURE_SCRLSENS = 50;
      var DOUBLE_TAP_TIMEOUT = 1e3;
      var DOUBLE_TAP_THRESHOLD = 50;
      var securityTypeNone = 1;
      var securityTypeVNCAuth = 2;
      var securityTypeRA2ne = 6;
      var securityTypeTight = 16;
      var securityTypeVeNCrypt = 19;
      var securityTypeXVP = 22;
      var securityTypeARD = 30;
      var securityTypeMSLogonII = 113;
      var securityTypeUnixLogon = 129;
      var securityTypePlain = 256;
      var extendedClipboardFormatText = 1;
      var extendedClipboardFormatRtf = 1 << 1;
      var extendedClipboardFormatHtml = 1 << 2;
      var extendedClipboardFormatDib = 1 << 3;
      var extendedClipboardFormatFiles = 1 << 4;
      var extendedClipboardActionCaps = 1 << 24;
      var extendedClipboardActionRequest = 1 << 25;
      var extendedClipboardActionPeek = 1 << 26;
      var extendedClipboardActionNotify = 1 << 27;
      var extendedClipboardActionProvide = 1 << 28;
      var RFB = exports["default"] = /* @__PURE__ */ (function(_EventTargetMixin) {
        function RFB2(target, urlOrChannel, options) {
          var _this;

          _classCallCheck(this, RFB2);

          if (!target) {
            throw new Error("Must specify target");
          }

          if (!urlOrChannel) {
            throw new Error("Must specify URL, WebSocket or RTCDataChannel");
          }

          if (!window.isSecureContext) {
            Log.Error("noVNC requires a secure context (TLS). Expect crashes!");
          }

          _this = _callSuper(this, RFB2);
          _this._target = target;

          if (typeof urlOrChannel === "string") {
            _this._url = urlOrChannel;
          } else {
            _this._url = null;
            _this._rawChannel = urlOrChannel;
          }

          options = options || {};
          _this._rfbCredentials = options.credentials || {};
          _this._shared = "shared" in options ? !!options.shared : true;
          _this._repeaterID = options.repeaterID || "";
          _this._wsProtocols = options.wsProtocols || [];
          _this._rfbConnectionState = "";
          _this._rfbInitState = "";
          _this._rfbAuthScheme = -1;
          _this._rfbCleanDisconnect = true;
          _this._rfbRSAAESAuthenticationState = null;
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
          _this._qemuExtKeyEventSupported = false;
          _this._clipboardText = null;
          _this._clipboardServerCapabilitiesActions = {};
          _this._clipboardServerCapabilitiesFormats = {};
          _this._sock = null;
          _this._display = null;
          _this._flushing = false;
          _this._keyboard = null;
          _this._gestures = null;
          _this._resizeObserver = null;
          _this._disconnTimer = null;
          _this._resizeTimeout = null;
          _this._mouseMoveTimer = null;
          _this._decoders = {};
          _this._FBU = {
            rects: 0,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            encoding: null
          };
          _this._mousePos = {};
          _this._mouseButtonMask = 0;
          _this._mouseLastMoveTime = 0;
          _this._viewportDragging = false;
          _this._viewportDragPos = {};
          _this._viewportHasMoved = false;
          _this._accumulatedWheelDeltaX = 0;
          _this._accumulatedWheelDeltaY = 0;
          _this._gestureLastTapTime = null;
          _this._gestureFirstDoubleTapEv = null;
          _this._gestureLastMagnitudeX = 0;
          _this._gestureLastMagnitudeY = 0;
          _this._eventHandlers = {
            focusCanvas: _this._focusCanvas.bind(_this),
            handleResize: _this._handleResize.bind(_this),
            handleMouse: _this._handleMouse.bind(_this),
            handleWheel: _this._handleWheel.bind(_this),
            handleGesture: _this._handleGesture.bind(_this),
            handleRSAAESCredentialsRequired: _this._handleRSAAESCredentialsRequired.bind(_this),
            handleRSAAESServerVerification: _this._handleRSAAESServerVerification.bind(_this)
          };
          Log.Debug(">> RFB.constructor");
          _this._screen = document.createElement("div");
          _this._screen.style.display = "flex";
          _this._screen.style.width = "100%";
          _this._screen.style.height = "100%";
          _this._screen.style.overflow = "auto";
          _this._screen.style.background = DEFAULT_BACKGROUND;
          _this._canvas = document.createElement("canvas");
          _this._canvas.style.margin = "auto";
          _this._canvas.style.outline = "none";
          _this._canvas.width = 0;
          _this._canvas.height = 0;
          _this._canvas.tabIndex = -1;
          _this._screen.appendChild(_this._canvas);
          _this._cursor = new _cursor["default"]();
          _this._cursorImage = RFB2.cursors.none;
          _this._decoders[_encodings.encodings.encodingRaw] = new _raw["default"]();
          _this._decoders[_encodings.encodings.encodingCopyRect] = new _copyrect["default"]();
          _this._decoders[_encodings.encodings.encodingRRE] = new _rre["default"]();
          _this._decoders[_encodings.encodings.encodingHextile] = new _hextile["default"]();
          _this._decoders[_encodings.encodings.encodingTight] = new _tight["default"]();
          _this._decoders[_encodings.encodings.encodingTightPNG] = new _tightpng["default"]();
          _this._decoders[_encodings.encodings.encodingZRLE] = new _zrle["default"]();
          _this._decoders[_encodings.encodings.encodingJPEG] = new _jpeg["default"]();

          try {
            _this._display = new _display["default"](_this._canvas);
          } catch (exc) {
            Log.Error("Display exception: " + exc);
            throw exc;
          }

          _this._keyboard = new _keyboard["default"](_this._canvas);
          _this._keyboard.onkeyevent = _this._handleKeyEvent.bind(_this);
          _this._remoteCapsLock = null;
          _this._remoteNumLock = null;
          _this._gestures = new _gesturehandler["default"]();
          _this._sock = new _websock["default"]();
          _this._sock.on("open", _this._socketOpen.bind(_this));
          _this._sock.on("close", _this._socketClose.bind(_this));
          _this._sock.on("message", _this._handleMessage.bind(_this));
          _this._sock.on("error", _this._socketError.bind(_this));
          _this._expectedClientWidth = null;
          _this._expectedClientHeight = null;
          _this._resizeObserver = new ResizeObserver(_this._eventHandlers.handleResize);
          _this._updateConnectionState("connecting");
          Log.Debug("<< RFB.constructor");
          _this.dragViewport = false;
          _this.focusOnClick = true;
          _this._viewOnly = false;
          _this._clipViewport = false;
          _this._clippingViewport = false;
          _this._scaleViewport = false;
          _this._resizeSession = false;
          _this._showDotCursor = false;

          if (options.showDotCursor !== void 0) {
            Log.Warn("Specifying showDotCursor as a RFB constructor argument is deprecated");
            _this._showDotCursor = options.showDotCursor;
          }

          _this._qualityLevel = 6;
          _this._compressionLevel = 2;
          
return _this;
        }

        _inherits(RFB2, _EventTargetMixin);
        
return _createClass(RFB2, [{
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

            if (this._rfbConnectionState === "connected") {
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

            if (this._rfbConnectionState === "connected") {
              this._sendEncodings();
            }
          }

          // ===== PUBLIC METHODS =====
        }, {
          key: "disconnect",
          value: function disconnect() {
            this._updateConnectionState("disconnecting");
            this._sock.off("error");
            this._sock.off("message");
            this._sock.off("open");

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
            if (this._rfbConnectionState !== "connected" || this._viewOnly) {
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
            if (this._rfbConnectionState !== "connected" || this._viewOnly) {
              return;
            }

            if (down === void 0) {
              this.sendKey(keysym, code, true);
              this.sendKey(keysym, code, false);
              
return;
            }

            var scancode = _xtscancodes["default"][code];

            if (this._qemuExtKeyEventSupported && scancode) {
              keysym = keysym || 0;
              Log.Info("Sending key (" + (down ? "down" : "up") + "): keysym " + keysym + ", scancode " + scancode);
              RFB2.messages.QEMUExtendedKeyEvent(this._sock, keysym, down, scancode);
            } else {
              if (!keysym) {
                return;
              }

              Log.Info("Sending keysym (" + (down ? "down" : "up") + "): " + keysym);
              RFB2.messages.keyEvent(this._sock, keysym, down ? 1 : 0);
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
            if (this._rfbConnectionState !== "connected" || this._viewOnly) {
              return;
            }

            if (this._clipboardServerCapabilitiesFormats[extendedClipboardFormatText] && this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {
              this._clipboardText = text;
              RFB2.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
            } else {
              var length, i;
              var data;

              length = 0;
              var _iterator = _createForOfIteratorHelper(text), _step;

              try {
                for (_iterator.s(); !(_step = _iterator.n()).done; ) {
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
              var _iterator2 = _createForOfIteratorHelper(text), _step2;

              try {
                for (_iterator2.s(); !(_step2 = _iterator2.n()).done; ) {
                  var _codePoint = _step2.value;
                  var code = _codePoint.codePointAt(0);

                  if (code > 255) {
                    code = 63;
                  }

                  data[i++] = code;
                }
              } catch (err) {
                _iterator2.e(err);
              } finally {
                _iterator2.f();
              }

              RFB2.messages.clientCutText(this._sock, data);
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

              if (this._sock.readyState === "closed") {
                throw Error("Cannot use already closed WebSocket/RTCDataChannel");
              }

              if (this._sock.readyState === "open") {
                this._socketOpen();
              }
            }

            this._target.appendChild(this._screen);
            this._gestures.attach(this._canvas);
            this._cursor.attach(this._canvas);
            this._refreshCursor();
            this._resizeObserver.observe(this._screen);
            this._canvas.addEventListener("mousedown", this._eventHandlers.focusCanvas);
            this._canvas.addEventListener("touchstart", this._eventHandlers.focusCanvas);
            this._canvas.addEventListener("mousedown", this._eventHandlers.handleMouse);
            this._canvas.addEventListener("mouseup", this._eventHandlers.handleMouse);
            this._canvas.addEventListener("mousemove", this._eventHandlers.handleMouse);
            this._canvas.addEventListener("click", this._eventHandlers.handleMouse);
            this._canvas.addEventListener("contextmenu", this._eventHandlers.handleMouse);
            this._canvas.addEventListener("wheel", this._eventHandlers.handleWheel);
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
            this._canvas.removeEventListener("mousedown", this._eventHandlers.handleMouse);
            this._canvas.removeEventListener("mouseup", this._eventHandlers.handleMouse);
            this._canvas.removeEventListener("mousemove", this._eventHandlers.handleMouse);
            this._canvas.removeEventListener("click", this._eventHandlers.handleMouse);
            this._canvas.removeEventListener("contextmenu", this._eventHandlers.handleMouse);
            this._canvas.removeEventListener("mousedown", this._eventHandlers.focusCanvas);
            this._canvas.removeEventListener("touchstart", this._eventHandlers.focusCanvas);
            this._resizeObserver.disconnect();
            this._keyboard.ungrab();
            this._gestures.detach();
            this._sock.close();

            try {
              this._target.removeChild(this._screen);
            } catch (e) {
              if (e.name === "NotFoundError") {
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
            if (this._rfbConnectionState === "connecting" && this._rfbInitState === "") {
              this._rfbInitState = "ProtocolVersion";
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
              case "connecting":
                this._fail("Connection closed " + msg);
                break;
              case "connected":
                this._updateConnectionState("disconnecting");
                this._updateConnectionState("disconnected");
                break;
              case "disconnecting":
                this._updateConnectionState("disconnected");
                break;
              case "disconnected":
                this._fail("Unexpected server disconnect when already disconnected " + msg);
                break;
              default:
                this._fail("Unexpected server disconnect before connecting " + msg);
                break;
            }

            this._sock.off("close");
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
            var _this$_currentClientS = this._currentClientSize(), _this$_currentClientS2 = _slicedToArray(_this$_currentClientS, 2), currentWidth = _this$_currentClientS2[0], currentHeight = _this$_currentClientS2[1];

            
return currentWidth == this._expectedClientWidth && currentHeight == this._expectedClientHeight;
          }
        }, {
          key: "_handleResize",
          value: function _handleResize() {
            var _this2 = this;

            if (this._clientHasExpectedSize()) {
              return;
            }

            window.requestAnimationFrame(function() {
              _this2._updateClip();
              _this2._updateScale();
            });

            if (this._resizeSession) {
              clearTimeout(this._resizeTimeout);
              this._resizeTimeout = setTimeout(this._requestRemoteResize.bind(this), 500);
            }
          }

          // Update state of clipping in Display object, and make sure the
          // configured viewport matches the current screen size
        }, {
          key: "_updateClip",
          value: function _updateClip() {
            var curClip = this._display.clipViewport;
            var newClip = this._clipViewport;

            if (this._scaleViewport) {
              newClip = false;
            }

            if (curClip !== newClip) {
              this._display.clipViewport = newClip;
            }

            if (newClip) {
              var size = this._screenSize();

              this._display.viewportChangeSize(size.w, size.h);
              this._fixScrollbars();
              this._setClippingViewport(size.w < this._display.width || size.h < this._display.height);
            } else {
              this._setClippingViewport(false);
            }

            if (curClip !== newClip) {
              this._saveExpectedClientSize();
            }
          }
        }, {
          key: "_updateScale",
          value: function _updateScale() {
            if (!this._scaleViewport) {
              this._display.scale = 1;
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
            clearTimeout(this._resizeTimeout);
            this._resizeTimeout = null;

            if (!this._resizeSession || this._viewOnly || !this._supportsSetDesktopSize) {
              return;
            }

            var size = this._screenSize();

            RFB2.messages.setDesktopSize(this._sock, Math.floor(size.w), Math.floor(size.h), this._screenID, this._screenFlags);
            Log.Debug("Requested new desktop size: " + size.w + "x" + size.h);
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
            var orig = this._screen.style.overflow;

            this._screen.style.overflow = "hidden";
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

            if (oldstate === "disconnected") {
              Log.Error("Tried changing state of a disconnected RFB object");
              
return;
            }

            switch (state) {
              case "connected":
                if (oldstate !== "connecting") {
                  Log.Error("Bad transition to connected state, previous connection state: " + oldstate);
                  
return;
                }

                break;
              case "disconnected":
                if (oldstate !== "disconnecting") {
                  Log.Error("Bad transition to disconnected state, previous connection state: " + oldstate);
                  
return;
                }

                break;
              case "connecting":
                if (oldstate !== "") {
                  Log.Error("Bad transition to connecting state, previous connection state: " + oldstate);
                  
return;
                }

                break;
              case "disconnecting":
                if (oldstate !== "connected" && oldstate !== "connecting") {
                  Log.Error("Bad transition to disconnecting state, previous connection state: " + oldstate);
                  
return;
                }

                break;
              default:
                Log.Error("Unknown connection state: " + state);
                
return;
            }

            this._rfbConnectionState = state;
            Log.Debug("New state '" + state + "', was '" + oldstate + "'.");

            if (this._disconnTimer && state !== "disconnecting") {
              Log.Debug("Clearing disconnect timer");
              clearTimeout(this._disconnTimer);
              this._disconnTimer = null;
              this._sock.off("close");
            }

            switch (state) {
              case "connecting":
                this._connect();
                break;
              case "connected":
                this.dispatchEvent(new CustomEvent("connect", {
                  detail: {}
                }));
                break;
              case "disconnecting":
                this._disconnect();
                this._disconnTimer = setTimeout(function() {
                  Log.Error("Disconnection timed out.");
                  _this3._updateConnectionState("disconnected");
                }, DISCONNECT_TIMEOUT * 1e3);
                break;
              case "disconnected":
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
              case "disconnecting":
                Log.Error("Failed when disconnecting: " + details);
                break;
              case "connected":
                Log.Error("Failed while connected: " + details);
                break;
              case "connecting":
                Log.Error("Failed when connecting: " + details);
                break;
              default:
                Log.Error("RFB failure: " + details);
                break;
            }

            this._rfbCleanDisconnect = false;
            this._updateConnectionState("disconnecting");
            this._updateConnectionState("disconnected");
            
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
              case "disconnected":
                Log.Error("Got data while disconnected");
                break;
              case "connected":
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
              case "connecting":
                while (this._rfbConnectionState === "connecting") {
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
            if (code == "CapsLock" && down) {
              this._remoteCapsLock = null;
            }

            if (this._remoteCapsLock !== null && capslock !== null && this._remoteCapsLock !== capslock && down) {
              Log.Debug("Fixing remote caps lock");
              this.sendKey(_keysym["default"].XK_Caps_Lock, "CapsLock", true);
              this.sendKey(_keysym["default"].XK_Caps_Lock, "CapsLock", false);
              this._remoteCapsLock = null;
            }

            if (code == "NumLock" && down) {
              this._remoteNumLock = null;
            }

            if (this._remoteNumLock !== null && numlock !== null && this._remoteNumLock !== numlock && down) {
              Log.Debug("Fixing remote num lock");
              this.sendKey(_keysym["default"].XK_Num_Lock, "NumLock", true);
              this.sendKey(_keysym["default"].XK_Num_Lock, "NumLock", false);
              this._remoteNumLock = null;
            }

            this.sendKey(keysym, code, down);
          }
        }, {
          key: "_handleMouse",
          value: function _handleMouse(ev) {
            if (ev.type === "click") {
              if (ev.target !== this._canvas) {
                return;
              }
            }

            ev.stopPropagation();
            ev.preventDefault();

            if (ev.type === "click" || ev.type === "contextmenu") {
              return;
            }

            var pos = (0, _element.clientToElement)(ev.clientX, ev.clientY, this._canvas);

            switch (ev.type) {
              case "mousedown":
                (0, _events.setCapture)(this._canvas);
                this._handleMouseButton(pos.x, pos.y, true, 1 << ev.button);
                break;
              case "mouseup":
                this._handleMouseButton(pos.x, pos.y, false, 1 << ev.button);
                break;
              case "mousemove":
                this._handleMouseMove(pos.x, pos.y);
                break;
            }
          }
        }, {
          key: "_handleMouseButton",
          value: function _handleMouseButton(x, y, down, bmask) {
            if (this.dragViewport) {
              if (down && !this._viewportDragging) {
                this._viewportDragging = true;
                this._viewportDragPos = {
                  "x": x,
                  "y": y
                };
                this._viewportHasMoved = false;
                
return;
              } else {
                this._viewportDragging = false;

                if (this._viewportHasMoved) {
                  return;
                }

                this._sendMouse(x, y, bmask);
              }
            }

            if (this._mouseMoveTimer !== null) {
              clearTimeout(this._mouseMoveTimer);
              this._mouseMoveTimer = null;
              this._sendMouse(x, y, this._mouseButtonMask);
            }

            if (down) {
              this._mouseButtonMask |= bmask;
            } else {
              this._mouseButtonMask &= ~bmask;
            }

            this._sendMouse(x, y, this._mouseButtonMask);
          }
        }, {
          key: "_handleMouseMove",
          value: function _handleMouseMove(x, y) {
            var _this4 = this;

            if (this._viewportDragging) {
              var deltaX = this._viewportDragPos.x - x;
              var deltaY = this._viewportDragPos.y - y;

              if (this._viewportHasMoved || Math.abs(deltaX) > _browser.dragThreshold || Math.abs(deltaY) > _browser.dragThreshold) {
                this._viewportHasMoved = true;
                this._viewportDragPos = {
                  "x": x,
                  "y": y
                };
                this._display.viewportChangePos(deltaX, deltaY);
              }

              
return;
            }

            this._mousePos = {
              "x": x,
              "y": y
            };

            if (this._mouseMoveTimer == null) {
              var timeSinceLastMove = Date.now() - this._mouseLastMoveTime;

              if (timeSinceLastMove > MOUSE_MOVE_DELAY) {
                this._sendMouse(x, y, this._mouseButtonMask);
                this._mouseLastMoveTime = Date.now();
              } else {
                this._mouseMoveTimer = setTimeout(function() {
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
            if (this._rfbConnectionState !== "connected") {
              return;
            }

            if (this._viewOnly) {
              return;
            }

            RFB2.messages.pointerEvent(this._sock, this._display.absX(x), this._display.absY(y), mask);
          }
        }, {
          key: "_handleWheel",
          value: function _handleWheel(ev) {
            if (this._rfbConnectionState !== "connected") {
              return;
            }

            if (this._viewOnly) {
              return;
            }

            ev.stopPropagation();
            ev.preventDefault();
            var pos = (0, _element.clientToElement)(ev.clientX, ev.clientY, this._canvas);
            var dX = ev.deltaX;
            var dY = ev.deltaY;

            if (ev.deltaMode !== 0) {
              dX *= WHEEL_LINE_HEIGHT;
              dY *= WHEEL_LINE_HEIGHT;
            }

            this._accumulatedWheelDeltaX += dX;
            this._accumulatedWheelDeltaY += dY;

            if (Math.abs(this._accumulatedWheelDeltaX) >= WHEEL_STEP) {
              if (this._accumulatedWheelDeltaX < 0) {
                this._handleMouseButton(pos.x, pos.y, true, 1 << 5);
                this._handleMouseButton(pos.x, pos.y, false, 1 << 5);
              } else if (this._accumulatedWheelDeltaX > 0) {
                this._handleMouseButton(pos.x, pos.y, true, 1 << 6);
                this._handleMouseButton(pos.x, pos.y, false, 1 << 6);
              }

              this._accumulatedWheelDeltaX = 0;
            }

            if (Math.abs(this._accumulatedWheelDeltaY) >= WHEEL_STEP) {
              if (this._accumulatedWheelDeltaY < 0) {
                this._handleMouseButton(pos.x, pos.y, true, 1 << 3);
                this._handleMouseButton(pos.x, pos.y, false, 1 << 3);
              } else if (this._accumulatedWheelDeltaY > 0) {
                this._handleMouseButton(pos.x, pos.y, true, 1 << 4);
                this._handleMouseButton(pos.x, pos.y, false, 1 << 4);
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
            this._handleMouseButton(pos.x, pos.y, true, bmask);
            this._handleMouseButton(pos.x, pos.y, false, bmask);
          }
        }, {
          key: "_handleGesture",
          value: function _handleGesture(ev) {
            var magnitude;
            var pos = (0, _element.clientToElement)(ev.detail.clientX, ev.detail.clientY, this._canvas);

            switch (ev.type) {
              case "gesturestart":
                switch (ev.detail.type) {
                  case "onetap":
                    this._handleTapEvent(ev, 1);
                    break;
                  case "twotap":
                    this._handleTapEvent(ev, 4);
                    break;
                  case "threetap":
                    this._handleTapEvent(ev, 2);
                    break;
                  case "drag":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    this._handleMouseButton(pos.x, pos.y, true, 1);
                    break;
                  case "longpress":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    this._handleMouseButton(pos.x, pos.y, true, 4);
                    break;
                  case "twodrag":
                    this._gestureLastMagnitudeX = ev.detail.magnitudeX;
                    this._gestureLastMagnitudeY = ev.detail.magnitudeY;
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    break;
                  case "pinch":
                    this._gestureLastMagnitudeX = Math.hypot(ev.detail.magnitudeX, ev.detail.magnitudeY);
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    break;
                }

                break;
              case "gesturemove":
                switch (ev.detail.type) {
                  case "onetap":
                  case "twotap":
                  case "threetap":
                    break;
                  case "drag":
                  case "longpress":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    break;
                  case "twodrag":
                    this._fakeMouseMove(ev, pos.x, pos.y);

                    while (ev.detail.magnitudeY - this._gestureLastMagnitudeY > GESTURE_SCRLSENS) {
                      this._handleMouseButton(pos.x, pos.y, true, 8);
                      this._handleMouseButton(pos.x, pos.y, false, 8);
                      this._gestureLastMagnitudeY += GESTURE_SCRLSENS;
                    }

                    while (ev.detail.magnitudeY - this._gestureLastMagnitudeY < -GESTURE_SCRLSENS) {
                      this._handleMouseButton(pos.x, pos.y, true, 16);
                      this._handleMouseButton(pos.x, pos.y, false, 16);
                      this._gestureLastMagnitudeY -= GESTURE_SCRLSENS;
                    }

                    while (ev.detail.magnitudeX - this._gestureLastMagnitudeX > GESTURE_SCRLSENS) {
                      this._handleMouseButton(pos.x, pos.y, true, 32);
                      this._handleMouseButton(pos.x, pos.y, false, 32);
                      this._gestureLastMagnitudeX += GESTURE_SCRLSENS;
                    }

                    while (ev.detail.magnitudeX - this._gestureLastMagnitudeX < -GESTURE_SCRLSENS) {
                      this._handleMouseButton(pos.x, pos.y, true, 64);
                      this._handleMouseButton(pos.x, pos.y, false, 64);
                      this._gestureLastMagnitudeX -= GESTURE_SCRLSENS;
                    }

                    break;
                  case "pinch":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    magnitude = Math.hypot(ev.detail.magnitudeX, ev.detail.magnitudeY);

                    if (Math.abs(magnitude - this._gestureLastMagnitudeX) > GESTURE_ZOOMSENS) {
                      this._handleKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true);

                      while (magnitude - this._gestureLastMagnitudeX > GESTURE_ZOOMSENS) {
                        this._handleMouseButton(pos.x, pos.y, true, 8);
                        this._handleMouseButton(pos.x, pos.y, false, 8);
                        this._gestureLastMagnitudeX += GESTURE_ZOOMSENS;
                      }

                      while (magnitude - this._gestureLastMagnitudeX < -GESTURE_ZOOMSENS) {
                        this._handleMouseButton(pos.x, pos.y, true, 16);
                        this._handleMouseButton(pos.x, pos.y, false, 16);
                        this._gestureLastMagnitudeX -= GESTURE_ZOOMSENS;
                      }
                    }

                    this._handleKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", false);
                    break;
                }

                break;
              case "gestureend":
                switch (ev.detail.type) {
                  case "onetap":
                  case "twotap":
                  case "threetap":
                  case "pinch":
                  case "twodrag":
                    break;
                  case "drag":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    this._handleMouseButton(pos.x, pos.y, false, 1);
                    break;
                  case "longpress":
                    this._fakeMouseMove(ev, pos.x, pos.y);
                    this._handleMouseButton(pos.x, pos.y, false, 4);
                    break;
                }

                break;
            }
          }

          // Message Handlers
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
                isRepeater = 1;
                break;
              case "003.003":
              case "003.006":
                this._rfbVersion = 3.3;
                break;
              case "003.007":
                this._rfbVersion = 3.7;
                break;
              case "003.008":
              case "003.889":

              // Apple Remote Desktop
              case "004.000":

              // Intel AMT KVM
              case "004.001":

              // RealVNC 4.6
              case "005.000":
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
            Log.Debug("Sent ProtocolVersion: " + cversion);
            this._rfbInitState = "Security";
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
              this._rfbAuthScheme = -1;
              var _iterator3 = _createForOfIteratorHelper(types), _step3;

              try {
                for (_iterator3.s(); !(_step3 = _iterator3.n()).done; ) {
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

            this._rfbInitState = "Authentication";
            Log.Debug("Authenticating using scheme: " + this._rfbAuthScheme);
            
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
                  reason
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
            if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0 || this._rfbCredentials.target === void 0) {
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

            if (this._rfbVeNCryptState == 2) {
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

            if (this._rfbVeNCryptState == 3) {
              if (this._sock.rQwait("vencrypt subtypes", 4 * this._rfbVeNCryptSubtypesLength)) {
                return false;
              }

              var subtypes = [];

              for (var i = 0; i < this._rfbVeNCryptSubtypesLength; i++) {
                subtypes.push(this._sock.rQshift32());
              }

              this._rfbAuthScheme = -1;

              for (var _i = 0, _subtypes = subtypes; _i < _subtypes.length; _i++) {
                var type = _subtypes[_i];

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
            if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0) {
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

            if (this._rfbCredentials.password === void 0) {
              this.dispatchEvent(new CustomEvent("credentialsrequired", {
                detail: {
                  types: ["password"]
                }
              }));
              
return false;
            }

            var challenge = Array.prototype.slice.call(this._sock.rQshiftBytes(16));
            var response = RFB2.genDES(this._rfbCredentials.password, challenge);

            this._sock.sQpushBytes(response);
            this._sock.flush();
            this._rfbInitState = "SecurityResult";
            
return true;
          }
        }, {
          key: "_negotiateARDAuth",
          value: function _negotiateARDAuth() {
            if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0) {
              this.dispatchEvent(new CustomEvent("credentialsrequired", {
                detail: {
                  types: ["username", "password"]
                }
              }));
              
return false;
            }

            if (this._rfbCredentials.ardPublicKey != void 0 && this._rfbCredentials.ardCredentials != void 0) {
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

            var generator = this._sock.rQshiftBytes(2);
            var keyLength = this._sock.rQshift16();

            if (this._sock.rQwait("read ard keylength", keyLength * 2, 4)) {
              return false;
            }

            var prime = this._sock.rQshiftBytes(keyLength);
            var serverPublicKey = this._sock.rQshiftBytes(keyLength);
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
          value: (function() {
            var _negotiateARDAuthAsync2 = _asyncToGenerator(/* @__PURE__ */ _regeneratorRuntime().mark(function _callee(keyLength, serverPublicKey, clientKey) {
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
          })()
        }, {
          key: "_negotiateTightUnixAuth",
          value: function _negotiateTightUnixAuth() {
            if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0) {
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
                vendor: "TGHT",
                signature: "NOTUNNEL"
              }
            };
            var serverSupportedTunnelTypes = {};

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

            if (serverSupportedTunnelTypes[1] && serverSupportedTunnelTypes[1].vendor === "SICR" && serverSupportedTunnelTypes[1].signature === "SCHANNEL") {
              Log.Debug("Detected Siemens server. Assuming NOTUNNEL support.");
              serverSupportedTunnelTypes[0] = {
                vendor: "TGHT",
                signature: "NOTUNNEL"
              };
            }

            if (serverSupportedTunnelTypes[0]) {
              if (serverSupportedTunnelTypes[0].vendor != clientSupportedTunnelTypes[0].vendor || serverSupportedTunnelTypes[0].signature != clientSupportedTunnelTypes[0].signature) {
                return this._fail("Client's tunnel type had the incorrect vendor or signature");
              }

              Log.Debug("Selected tunnel type: " + clientSupportedTunnelTypes[0]);
              this._sock.sQpush32(0);
              this._sock.flush();
              
return false;
            } else {
              return this._fail("Server wanted tunnels, but doesn't support the notunnel type");
            }
          }
        }, {
          key: "_negotiateTightAuth",
          value: function _negotiateTightAuth() {
            if (!this._rfbTightVNC) {
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
                
return false;
              }
            }

            if (this._sock.rQwait("sub auth count", 4)) {
              return false;
            }

            var subAuthCount = this._sock.rQshift32();

            if (subAuthCount === 0) {
              this._rfbInitState = "SecurityResult";
              
return true;
            }

            if (this._sock.rQwait("sub auth capabilities", 16 * subAuthCount, 4)) {
              return false;
            }

            var clientSupportedTypes = {
              "STDVNOAUTH__": 1,
              "STDVVNCAUTH_": 2,
              "TGHTULGNAUTH": 129
            };
            var serverSupportedTypes = [];

            for (var i = 0; i < subAuthCount; i++) {
              this._sock.rQshift32();
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
                  case "STDVNOAUTH__":
                    this._rfbInitState = "SecurityResult";
                    
return true;
                  case "STDVVNCAUTH_":
                    this._rfbAuthScheme = securityTypeVNCAuth;
                    
return true;
                  case "TGHTULGNAUTH":
                    this._rfbAuthScheme = securityTypeUnixLogon;
                    
return true;
                  default:
                    return this._fail("Unsupported tiny auth scheme (scheme: " + authType + ")");
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
              this._rfbRSAAESAuthenticationState = new _ra["default"](this._sock, function() {
                return _this5._rfbCredentials;
              });
              this._rfbRSAAESAuthenticationState.addEventListener("serververification", this._eventHandlers.handleRSAAESServerVerification);
              this._rfbRSAAESAuthenticationState.addEventListener("credentialsrequired", this._eventHandlers.handleRSAAESCredentialsRequired);
            }

            this._rfbRSAAESAuthenticationState.checkInternalEvents();

            if (!this._rfbRSAAESAuthenticationState.hasStarted) {
              this._rfbRSAAESAuthenticationState.negotiateRA2neAuthAsync()["catch"](function(e) {
                if (e.message !== "disconnect normally") {
                  _this5._fail(e.message);
                }
              }).then(function() {
                _this5._rfbInitState = "SecurityResult";
                
return true;
              })["finally"](function() {
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

            if (this._rfbCredentials.username === void 0 || this._rfbCredentials.password === void 0) {
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
              g,
              p
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
                  this._rfbInitState = "SecurityResult";
                } else {
                  this._rfbInitState = "ClientInitialisation";
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
            if (this._sock.rQwait("VNC auth response ", 4)) {
              return false;
            }

            var status = this._sock.rQshift32();

            if (status === 0) {
              this._rfbInitState = "ClientInitialisation";
              Log.Debug("Authentication OK");
              
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
                    status
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

            var width = this._sock.rQshift16();
            var height = this._sock.rQshift16();
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

            this._sock.rQskipBytes(3);
            var nameLength = this._sock.rQshift32();

            if (this._sock.rQwait("server init name", nameLength, 24)) {
              return false;
            }

            var name = this._sock.rQshiftStr(nameLength);

            name = (0, _strings.decodeUTF8)(name, true);

            if (this._rfbTightVNC) {
              if (this._sock.rQwait("TightVNC extended server init header", 8, 24 + nameLength)) {
                return false;
              }

              var numServerMessages = this._sock.rQshift16();
              var numClientMessages = this._sock.rQshift16();
              var numEncodings = this._sock.rQshift16();

              this._sock.rQskipBytes(2);
              var totalMessagesLength = (numServerMessages + numClientMessages + numEncodings) * 16;

              if (this._sock.rQwait("TightVNC extended server init header", totalMessagesLength, 32 + nameLength)) {
                return false;
              }

              this._sock.rQskipBytes(16 * numServerMessages);
              this._sock.rQskipBytes(16 * numClientMessages);
              this._sock.rQskipBytes(16 * numEncodings);
            }

            Log.Info("Screen: " + width + "x" + height + ", bpp: " + bpp + ", depth: " + depth + ", bigEndian: " + bigEndian + ", trueColor: " + trueColor + ", redMax: " + redMax + ", greenMax: " + greenMax + ", blueMax: " + blueMax + ", redShift: " + redShift + ", greenShift: " + greenShift + ", blueShift: " + blueShift);
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

            RFB2.messages.pixelFormat(this._sock, this._fbDepth, true);
            this._sendEncodings();
            RFB2.messages.fbUpdateRequest(this._sock, false, 0, 0, this._fbWidth, this._fbHeight);
            this._updateConnectionState("connected");
            
return true;
          }
        }, {
          key: "_sendEncodings",
          value: function _sendEncodings() {
            var encs = [];

            encs.push(_encodings.encodings.encodingCopyRect);

            if (this._fbDepth == 24) {
              encs.push(_encodings.encodings.encodingTight);
              encs.push(_encodings.encodings.encodingTightPNG);
              encs.push(_encodings.encodings.encodingZRLE);
              encs.push(_encodings.encodings.encodingJPEG);
              encs.push(_encodings.encodings.encodingHextile);
              encs.push(_encodings.encodings.encodingRRE);
            }

            encs.push(_encodings.encodings.encodingRaw);
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

            if (this._fbDepth == 24) {
              encs.push(_encodings.encodings.pseudoEncodingVMwareCursor);
              encs.push(_encodings.encodings.pseudoEncodingCursor);
            }

            RFB2.messages.clientEncodings(this._sock, encs);
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
              case "ProtocolVersion":
                return this._negotiateProtocolVersion();
              case "Security":
                return this._negotiateSecurity();
              case "Authentication":
                return this._negotiateAuthentication();
              case "SecurityResult":
                return this._handleSecurityResult();
              case "SecurityReason":
                return this._handleSecurityReason();
              case "ClientInitialisation":
                this._sock.sQpush8(this._shared ? 1 : 0);
                this._sock.flush();
                this._rfbInitState = "ServerInitialisation";
                
return true;
              case "ServerInitialisation":
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

            this._sock.rQskipBytes(3);
            var length = this._sock.rQshift32();

            length = (0, _int.toSigned32bit)(length);

            if (this._sock.rQwait("ServerCutText content", Math.abs(length), 8)) {
              return false;
            }

            if (length >= 0) {
              var text = this._sock.rQshiftStr(length);

              if (this._viewOnly) {
                return true;
              }

              this.dispatchEvent(new CustomEvent("clipboard", {
                detail: {
                  text
                }
              }));
            } else {
              length = Math.abs(length);
              var flags = this._sock.rQshift32();
              var formats = flags & 65535;
              var actions = flags & 4278190080;
              var isCaps = !!(actions & extendedClipboardActionCaps);

              if (isCaps) {
                this._clipboardServerCapabilitiesFormats = {};
                this._clipboardServerCapabilitiesActions = {};

                for (var i = 0; i <= 15; i++) {
                  var index = 1 << i;

                  if (formats & index) {
                    this._clipboardServerCapabilitiesFormats[index] = true;
                    this._sock.rQshift32();
                  }
                }

                for (var _i4 = 24; _i4 <= 31; _i4++) {
                  var _index = 1 << _i4;

                  this._clipboardServerCapabilitiesActions[_index] = !!(actions & _index);
                }

                var clientActions = [extendedClipboardActionCaps, extendedClipboardActionRequest, extendedClipboardActionPeek, extendedClipboardActionNotify, extendedClipboardActionProvide];

                RFB2.messages.extendedClipboardCaps(this._sock, clientActions, {
                  extendedClipboardFormatText: 0
                });
              } else if (actions === extendedClipboardActionRequest) {
                if (this._viewOnly) {
                  return true;
                }

                if (this._clipboardText != null && this._clipboardServerCapabilitiesActions[extendedClipboardActionProvide]) {
                  if (formats & extendedClipboardFormatText) {
                    RFB2.messages.extendedClipboardProvide(this._sock, [extendedClipboardFormatText], [this._clipboardText]);
                  }
                }
              } else if (actions === extendedClipboardActionPeek) {
                if (this._viewOnly) {
                  return true;
                }

                if (this._clipboardServerCapabilitiesActions[extendedClipboardActionNotify]) {
                  if (this._clipboardText != null) {
                    RFB2.messages.extendedClipboardNotify(this._sock, [extendedClipboardFormatText]);
                  } else {
                    RFB2.messages.extendedClipboardNotify(this._sock, []);
                  }
                }
              } else if (actions === extendedClipboardActionNotify) {
                if (this._viewOnly) {
                  return true;
                }

                if (this._clipboardServerCapabilitiesActions[extendedClipboardActionRequest]) {
                  if (formats & extendedClipboardFormatText) {
                    RFB2.messages.extendedClipboardRequest(this._sock, [extendedClipboardFormatText]);
                  }
                }
              } else if (actions === extendedClipboardActionProvide) {
                if (this._viewOnly) {
                  return true;
                }

                if (!(formats & extendedClipboardFormatText)) {
                  return true;
                }

                this._clipboardText = null;
                var zlibStream = this._sock.rQshiftBytes(length - 4);
                var streamInflator = new _inflator["default"]();
                var textData = null;

                streamInflator.setInput(zlibStream);

                for (var _i5 = 0; _i5 <= 15; _i5++) {
                  var format = 1 << _i5;

                  if (formats & format) {
                    var size = 0;
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

            this._sock.rQskipBytes(3);
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

            if (!(flags & 1 << 31)) {
              return this._fail("Unexpected fence response");
            }

            flags &= 1 << 0 | 1 << 1;
            RFB2.messages.clientFence(this._sock, flags, payload);
            
return true;
          }
        }, {
          key: "_handleXvpMsg",
          value: function _handleXvpMsg() {
            if (this._sock.rQwait("XVP version and message", 3, 1)) {
              return false;
            }

            this._sock.rQskipBytes(1);
            var xvpVer = this._sock.rQshift8();
            var xvpMsg = this._sock.rQshift8();

            switch (xvpMsg) {
              case 0:
                Log.Error("XVP Operation Failed");
                break;
              case 1:
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
                ret = this._framebufferUpdate();

                if (ret && !this._enabledContinuousUpdates) {
                  RFB2.messages.fbUpdateRequest(this._sock, true, 0, 0, this._fbWidth, this._fbHeight);
                }

                
return ret;
              case 1:
                return this._handleSetColourMapMsg();
              case 2:
                Log.Debug("Bell");
                this.dispatchEvent(new CustomEvent("bell", {
                  detail: {}
                }));
                
return true;
              case 3:
                return this._handleServerCutText();
              case 150:
                first = !this._supportsContinuousUpdates;
                this._supportsContinuousUpdates = true;
                this._enabledContinuousUpdates = false;

                if (first) {
                  this._enabledContinuousUpdates = true;
                  this._updateContinuousUpdates();
                  Log.Info("Enabling continuous updates.");
                } else {
                }

                
return true;
              case 248:
                return this._handleServerFenceMsg();
              case 250:
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

              this._sock.rQskipBytes(1);
              this._FBU.rects = this._sock.rQshift16();

              if (this._display.pending()) {
                this._flushing = true;
                this._display.flush().then(function() {
                  _this6._flushing = false;

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

                this._FBU.x = this._sock.rQshift16();
                this._FBU.y = this._sock.rQshift16();
                this._FBU.width = this._sock.rQshift16();
                this._FBU.height = this._sock.rQshift16();
                this._FBU.encoding = this._sock.rQshift32();
                this._FBU.encoding >>= 0;
              }

              if (!this._handleRect()) {
                return false;
              }

              this._FBU.rects--;
              this._FBU.encoding = null;
            }

            this._display.flip();
            
return true;
          }
        }, {
          key: "_handleRect",
          value: function _handleRect() {
            switch (this._FBU.encoding) {
              case _encodings.encodings.pseudoEncodingLastRect:
                this._FBU.rects = 1;
                
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
              case _encodings.encodings.pseudoEncodingQEMULedEvent:
                return this._handleLedEvent();
              default:
                return this._handleDataRect();
            }
          }
        }, {
          key: "_handleVMwareCursor",
          value: function _handleVMwareCursor() {
            var hotx = this._FBU.x;
            var hoty = this._FBU.y;
            var w = this._FBU.width;
            var h = this._FBU.height;

            if (this._sock.rQwait("VMware cursor encoding", 1)) {
              return false;
            }

            var cursorType = this._sock.rQshift8();

            this._sock.rQshift8();
            var rgba;
            var bytesPerPixel = 4;

            if (cursorType == 0) {
              var PIXEL_MASK = 4294967040 | 0;

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
                  var bgr = xorMask[_pixel2];
                  var r = bgr >> 8 & 255;
                  var g = bgr >> 16 & 255;
                  var b = bgr >> 24 & 255;

                  rgba[_pixel2 * bytesPerPixel] = r;
                  rgba[_pixel2 * bytesPerPixel + 1] = g;
                  rgba[_pixel2 * bytesPerPixel + 2] = b;
                  rgba[_pixel2 * bytesPerPixel + 3] = 255;
                } else if ((andMask[_pixel2] & PIXEL_MASK) == PIXEL_MASK) {
                  if (xorMask[_pixel2] == 0) {
                    rgba[_pixel2 * bytesPerPixel] = 0;
                    rgba[_pixel2 * bytesPerPixel + 1] = 0;
                    rgba[_pixel2 * bytesPerPixel + 2] = 0;
                    rgba[_pixel2 * bytesPerPixel + 3] = 0;
                  } else if ((xorMask[_pixel2] & PIXEL_MASK) == PIXEL_MASK) {
                    rgba[_pixel2 * bytesPerPixel] = 0;
                    rgba[_pixel2 * bytesPerPixel + 1] = 0;
                    rgba[_pixel2 * bytesPerPixel + 2] = 0;
                    rgba[_pixel2 * bytesPerPixel + 3] = 255;
                  } else {
                    rgba[_pixel2 * bytesPerPixel] = 0;
                    rgba[_pixel2 * bytesPerPixel + 1] = 0;
                    rgba[_pixel2 * bytesPerPixel + 2] = 0;
                    rgba[_pixel2 * bytesPerPixel + 3] = 255;
                  }
                } else {
                  rgba[_pixel2 * bytesPerPixel] = 0;
                  rgba[_pixel2 * bytesPerPixel + 1] = 0;
                  rgba[_pixel2 * bytesPerPixel + 2] = 0;
                  rgba[_pixel2 * bytesPerPixel + 3] = 255;
                }
              }
            } else if (cursorType == 1) {
              if (this._sock.rQwait("VMware cursor alpha encoding", w * h * 4, 2)) {
                return false;
              }

              rgba = new Array(w * h * bytesPerPixel);

              for (var _pixel3 = 0; _pixel3 < w * h; _pixel3++) {
                var data = this._sock.rQshift32();

                rgba[_pixel3 * 4] = data >> 24 & 255;
                rgba[_pixel3 * 4 + 1] = data >> 16 & 255;
                rgba[_pixel3 * 4 + 2] = data >> 8 & 255;
                rgba[_pixel3 * 4 + 3] = data & 255;
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
            var hotx = this._FBU.x;
            var hoty = this._FBU.y;
            var w = this._FBU.width;
            var h = this._FBU.height;
            var pixelslength = w * h * 4;
            var masklength = Math.ceil(w / 8) * h;
            var bytes = pixelslength + masklength;

            if (this._sock.rQwait("cursor encoding", bytes)) {
              return false;
            }

            var pixels = this._sock.rQshiftBytes(pixelslength);
            var mask = this._sock.rQshiftBytes(masklength);
            var rgba = new Uint8Array(w * h * 4);
            var pixIdx = 0;

            for (var y = 0; y < h; y++) {
              for (var x = 0; x < w; x++) {
                var maskIdx = y * Math.ceil(w / 8) + Math.floor(x / 8);
                var alpha = mask[maskIdx] << x % 8 & 128 ? 255 : 0;

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
            if (this._sock.rQwait("LED Status", 1)) {
              return false;
            }

            var data = this._sock.rQshift8();
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
            this._sock.rQskipBytes(1);
            this._sock.rQskipBytes(3);

            for (var i = 0; i < numberOfScreens; i += 1) {
              if (i === 0) {
                this._screenID = this._sock.rQshift32();
                this._sock.rQskipBytes(2);
                this._sock.rQskipBytes(2);
                this._sock.rQskipBytes(2);
                this._sock.rQskipBytes(2);
                this._screenFlags = this._sock.rQshift32();
              } else {
                this._sock.rQskipBytes(16);
              }
            }

            if (this._FBU.x === 1 && this._FBU.y !== 0) {
              var msg = "";

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

            if (firstUpdate) {
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

            RFB2.messages.enableContinuousUpdates(this._sock, true, 0, 0, this._fbWidth, this._fbHeight);
          }
        }, {
          key: "_resize",
          value: function _resize(width, height) {
            this._fbWidth = width;
            this._fbHeight = height;
            this._display.resize(this._fbWidth, this._fbHeight);
            this._updateClip();
            this._updateScale();
            this._updateContinuousUpdates();
            this._saveExpectedClientSize();
          }
        }, {
          key: "_xvpOp",
          value: function _xvpOp(ver, op) {
            if (this._rfbXvpVer < ver) {
              return;
            }

            Log.Info("Sending XVP operation " + op + " (version " + ver + ")");
            RFB2.messages.xvpOp(this._sock, ver, op);
          }
        }, {
          key: "_updateCursor",
          value: function _updateCursor(rgba, hotx, hoty, w, h) {
            this._cursorImage = {
              rgbaPixels: rgba,
              hotx,
              hoty,
              w,
              h
            };
            this._refreshCursor();
          }
        }, {
          key: "_shouldShowDotCursor",
          value: function _shouldShowDotCursor() {
            if (!this._showDotCursor) {
              return false;
            }

            for (var i = 3; i < this._cursorImage.rgbaPixels.length; i += 4) {
              if (this._cursorImage.rgbaPixels[i]) {
                return false;
              }
            }

            
return true;
          }
        }, {
          key: "_refreshCursor",
          value: function _refreshCursor() {
            if (this._rfbConnectionState !== "connecting" && this._rfbConnectionState !== "connected") {
              return;
            }

            var image = this._shouldShowDotCursor() ? RFB2.cursors.dot : this._cursorImage;

            this._cursor.change(image.rgbaPixels, image.hotx, image.hoty, image.w, image.h);
          }
        }], [{
          key: "genDES",
          value: function genDES(password, challenge) {
            var passwordChars = password.split("").map(function(c) {
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
      })(_eventtarget["default"]);

      RFB.messages = {
        keyEvent: function keyEvent(sock, keysym, down) {
          sock.sQpush8(4);
          sock.sQpush8(down);
          sock.sQpush16(0);
          sock.sQpush32(keysym);
          sock.flush();
        },
        QEMUExtendedKeyEvent: function QEMUExtendedKeyEvent(sock, keysym, down, keycode) {
          function getRFBkeycode(xtScanCode) {
            var upperByte = keycode >> 8;
            var lowerByte = keycode & 255;

            if (upperByte === 224 && lowerByte < 127) {
              return lowerByte | 128;
            }

            
return xtScanCode;
          }

          sock.sQpush8(255);
          sock.sQpush8(0);
          sock.sQpush16(down);
          sock.sQpush32(keysym);
          var RFBkeycode = getRFBkeycode(keycode);

          sock.sQpush32(RFBkeycode);
          sock.flush();
        },
        pointerEvent: function pointerEvent(sock, x, y, mask) {
          sock.sQpush8(5);
          sock.sQpush8(mask);
          sock.sQpush16(x);
          sock.sQpush16(y);
          sock.flush();
        },

        // Used to build Notify and Request data.
        _buildExtendedClipboardFlags: function _buildExtendedClipboardFlags(actions, formats) {
          var data = new Uint8Array(4);
          var formatFlag = 0;
          var actionFlag = 0;

          for (var i = 0; i < actions.length; i++) {
            actionFlag |= actions[i];
          }

          for (var _i7 = 0; _i7 < formats.length; _i7++) {
            formatFlag |= formats[_i7];
          }

          data[0] = actionFlag >> 24;
          data[1] = 0;
          data[2] = 0;
          data[3] = formatFlag;
          
return data;
        },
        extendedClipboardProvide: function extendedClipboardProvide(sock, formats, inData) {
          var deflator = new _deflator["default"]();
          var dataToDeflate = [];

          for (var i = 0; i < formats.length; i++) {
            if (formats[i] != extendedClipboardFormatText) {
              throw new Error("Unsupported extended clipboard format for Provide message.");
            }

            inData[i] = inData[i].replace(/\r\n|\r|\n/gm, "\r\n");
            var text = (0, _strings.encodeUTF8)(inData[i] + "\0");

            dataToDeflate.push(text.length >> 24 & 255, text.length >> 16 & 255, text.length >> 8 & 255, text.length & 255);

            for (var j = 0; j < text.length; j++) {
              dataToDeflate.push(text.charCodeAt(j));
            }
          }

          var deflatedData = deflator.deflate(new Uint8Array(dataToDeflate));
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

          formatKeys.map(function(x) {
            return parseInt(x);
          });
          formatKeys.sort(function(a, b) {
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
            data[3] |= 1 << formatKeys[i];
          }

          RFB.messages.clientCutText(sock, data, true);
        },
        clientCutText: function clientCutText(sock, data) {
          var extended = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;

          sock.sQpush8(6);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(0);
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
          sock.sQpush8(251);
          sock.sQpush8(0);
          sock.sQpush16(width);
          sock.sQpush16(height);
          sock.sQpush8(1);
          sock.sQpush8(0);
          sock.sQpush32(id);
          sock.sQpush16(0);
          sock.sQpush16(0);
          sock.sQpush16(width);
          sock.sQpush16(height);
          sock.sQpush32(flags);
          sock.flush();
        },
        clientFence: function clientFence(sock, flags, payload) {
          sock.sQpush8(248);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush32(flags);
          sock.sQpush8(payload.length);
          sock.sQpushString(payload);
          sock.flush();
        },
        enableContinuousUpdates: function enableContinuousUpdates(sock, enable, x, y, width, height) {
          sock.sQpush8(150);
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

          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(bpp);
          sock.sQpush8(depth);
          sock.sQpush8(0);
          sock.sQpush8(trueColor ? 1 : 0);
          sock.sQpush16((1 << bits) - 1);
          sock.sQpush16((1 << bits) - 1);
          sock.sQpush16((1 << bits) - 1);
          sock.sQpush8(bits * 0);
          sock.sQpush8(bits * 1);
          sock.sQpush8(bits * 2);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.sQpush8(0);
          sock.flush();
        },
        clientEncodings: function clientEncodings(sock, encodings) {
          sock.sQpush8(2);
          sock.sQpush8(0);
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

          sock.sQpush8(3);
          sock.sQpush8(incremental ? 1 : 0);
          sock.sQpush16(x);
          sock.sQpush16(y);
          sock.sQpush16(w);
          sock.sQpush16(h);
          sock.flush();
        },
        xvpOp: function xvpOp(sock, ver, op) {
          sock.sQpush8(250);
          sock.sQpush8(0);
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
    }
  });

  
return require_rfb();
})();


/*! Bundled license information:

@novnc/novnc/lib/crypto/aes.js:
@novnc/novnc/lib/crypto/rsa.js:
@novnc/novnc/lib/crypto/md5.js:
@novnc/novnc/lib/ra2.js:
@novnc/novnc/lib/rfb.js:
  (*! regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc. -- license (MIT): https://github.com/facebook/regenerator/blob/main/LICENSE *)
*/
window.RFB = noVNC.default;
