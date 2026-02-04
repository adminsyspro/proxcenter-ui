"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }

function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }

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


/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */
var JPEGDecoder = exports["default"] = /*#__PURE__*/function () {
  function JPEGDecoder() {
    _classCallCheck(this, JPEGDecoder);

    // RealVNC will reuse the quantization tables
    // and Huffman tables, so we need to cache them.
    this._cachedQuantTables = [];
    this._cachedHuffmanTables = [];
    this._segments = [];
  }

  
return _createClass(JPEGDecoder, [{
    key: "decodeRect",
    value: function decodeRect(x, y, width, height, sock, display, depth) {
      // A rect of JPEG encodings is simply a JPEG file
      while (true) {
        var segment = this._readSegment(sock);

        if (segment === null) {
          return false;
        }

        this._segments.push(segment);


        // End of image?
        if (segment[1] === 0xD9) {
          break;
        }
      }

      var huffmanTables = [];
      var quantTables = [];
      var _iterator = _createForOfIteratorHelper(this._segments),
        _step;

      try {
        for (_iterator.s(); !(_step = _iterator.n()).done;) {
          var _segment = _step.value;
          var type = _segment[1];

          if (type === 0xC4) {
            // Huffman tables
            huffmanTables.push(_segment);
          } else if (type === 0xDB) {
            // Quantization tables
            quantTables.push(_segment);
          }
        }
      } catch (err) {
        _iterator.e(err);
      } finally {
        _iterator.f();
      }

      var sofIndex = this._segments.findIndex(function (x) {
        return x[1] == 0xC0 || x[1] == 0xC2;
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
      var _iterator2 = _createForOfIteratorHelper(this._segments),
        _step2;

      try {
        for (_iterator2.s(); !(_step2 = _iterator2.n()).done;) {
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
      var _iterator3 = _createForOfIteratorHelper(this._segments),
        _step3;

      try {
        for (_iterator3.s(); !(_step3 = _iterator3.n()).done;) {
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

      if (marker != 0xFF) {
        throw new Error("Illegal JPEG marker received (byte: " + marker + ")");
      }

      var type = sock.rQshift8();

      if (type >= 0xD0 && type <= 0xD9 || type == 0x01) {
        // No length after marker
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

      if (type === 0xDA) {
        // start of scan
        extra += 2;

        while (true) {
          if (sock.rQwait("JPEG", length - 2 + extra, 4)) {
            return null;
          }

          var data = sock.rQpeekBytes(length - 2 + extra, false);

          if (data.at(-2) === 0xFF && data.at(-1) !== 0x00 && !(data.at(-1) >= 0xD0 && data.at(-1) <= 0xD7)) {
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
}();