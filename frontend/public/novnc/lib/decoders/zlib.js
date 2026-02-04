"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _inflator = _interopRequireDefault(require("../inflator.js"));

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }

function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t];

 o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }

function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }

function _toPropertyKey(t) { var i = _toPrimitive(t, "string");

 

return "symbol" == _typeof(i) ? i : i + ""; }

function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive];

 if (void 0 !== e) { var i = e.call(t, r || "default");

 if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } 

return ("string" === r ? String : Number)(t); } /*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2024 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

var ZlibDecoder = exports["default"] = /*#__PURE__*/function () {
  function ZlibDecoder() {
    _classCallCheck(this, ZlibDecoder);
    this._zlib = new _inflator["default"]();
    this._length = 0;
  }

  
return _createClass(ZlibDecoder, [{
    key: "decodeRect",
    value: function decodeRect(x, y, width, height, sock, display, depth) {
      if (width === 0 || height === 0) {
        return true;
      }

      if (this._length === 0) {
        if (sock.rQwait("ZLIB", 4)) {
          return false;
        }

        this._length = sock.rQshift32();
      }

      if (sock.rQwait("ZLIB", this._length)) {
        return false;
      }

      var data = new Uint8Array(sock.rQshiftBytes(this._length, false));

      this._length = 0;
      this._zlib.setInput(data);
      data = this._zlib.inflate(width * height * 4);
      this._zlib.setInput(null);

      // Max sure the image is fully opaque
      for (var i = 0; i < width * height; i++) {
        data[i * 4 + 3] = 255;
      }

      display.blitImage(x, y, width, height, data, 0);
      
return true;
    }
  }]);
}();