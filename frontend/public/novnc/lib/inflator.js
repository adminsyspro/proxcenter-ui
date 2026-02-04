"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _inflate2 = require("../lib/vendor/pako/lib/zlib/inflate.js");
var _zstream = _interopRequireDefault(require("../lib/vendor/pako/lib/zlib/zstream.js"));

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
 * Copyright (C) 2020 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

var Inflate = exports["default"] = /*#__PURE__*/function () {
  function Inflate() {
    _classCallCheck(this, Inflate);
    this.strm = new _zstream["default"]();
    this.chunkSize = 1024 * 10 * 10;
    this.strm.output = new Uint8Array(this.chunkSize);
    (0, _inflate2.inflateInit)(this.strm);
  }

  
return _createClass(Inflate, [{
    key: "setInput",
    value: function setInput(data) {
      if (!data) {
        //FIXME: flush remaining data.
        /* eslint-disable camelcase */
        this.strm.input = null;
        this.strm.avail_in = 0;
        this.strm.next_in = 0;
      } else {
        this.strm.input = data;
        this.strm.avail_in = this.strm.input.length;
        this.strm.next_in = 0;
        /* eslint-enable camelcase */
      }
    }
  }, {
    key: "inflate",
    value: function inflate(expected) {
      // resize our output buffer if it's too small
      // (we could just use multiple chunks, but that would cause an extra
      // allocation each time to flatten the chunks)
      if (expected > this.chunkSize) {
        this.chunkSize = expected;
        this.strm.output = new Uint8Array(this.chunkSize);
      }

      /* eslint-disable camelcase */
      this.strm.next_out = 0;
      this.strm.avail_out = expected;
      /* eslint-enable camelcase */

      var ret = (0, _inflate2.inflate)(this.strm, 0); // Flush argument not used.

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
}();