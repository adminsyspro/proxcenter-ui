"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

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

return ("string" === r ? String : Number)(t); }


/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */
var RREDecoder = exports["default"] = /*#__PURE__*/function () {
  function RREDecoder() {
    _classCallCheck(this, RREDecoder);
    this._subrects = 0;
  }

  
return _createClass(RREDecoder, [{
    key: "decodeRect",
    value: function decodeRect(x, y, width, height, sock, display, depth) {
      if (this._subrects === 0) {
        if (sock.rQwait("RRE", 4 + 4)) {
          return false;
        }

        this._subrects = sock.rQshift32();
        var color = sock.rQshiftBytes(4); // Background

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
}();