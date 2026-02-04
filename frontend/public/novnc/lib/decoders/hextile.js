"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var Log = _interopRequireWildcard(require("../util/logging.js"));

function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap();

 

return (_getRequireWildcardCache = function _getRequireWildcardCache(e) { return e ? t : r; })(e); }

function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e }; var t = _getRequireWildcardCache(r);

 if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

 for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

 i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } 

return n["default"] = e, t && t.set(e, n), n; }

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
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

var HextileDecoder = exports["default"] = /*#__PURE__*/function () {
  function HextileDecoder() {
    _classCallCheck(this, HextileDecoder);
    this._tiles = 0;
    this._lastsubencoding = 0;
    this._tileBuffer = new Uint8Array(16 * 16 * 4);
  }

  
return _createClass(HextileDecoder, [{
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
          // Raw
          throw new Error("Illegal hextile subencoding (subencoding: " + subencoding + ")");
        }

        var currTile = this._totalTiles - this._tiles;
        var tileX = currTile % this._tilesX;
        var tileY = Math.floor(currTile / this._tilesX);
        var tx = x + tileX * 16;
        var ty = y + tileY * 16;
        var tw = Math.min(16, x + width - tx);
        var th = Math.min(16, y + height - ty);

        // Figure out how much we are expecting
        if (subencoding & 0x01) {
          // Raw
          bytes += tw * th * 4;
        } else {
          if (subencoding & 0x02) {
            // Background
            bytes += 4;
          }

          if (subencoding & 0x04) {
            // Foreground
            bytes += 4;
          }

          if (subencoding & 0x08) {
            // AnySubrects
            bytes++; // Since we aren't shifting it off

            if (sock.rQwait("HEXTILE", bytes)) {
              return false;
            }

            var subrects = sock.rQpeekBytes(bytes).at(-1);

            if (subencoding & 0x10) {
              // SubrectsColoured
              bytes += subrects * (4 + 2);
            } else {
              bytes += subrects * 2;
            }
          }
        }

        if (sock.rQwait("HEXTILE", bytes)) {
          return false;
        }

        // We know the encoding and have a whole tile
        sock.rQshift8();

        if (subencoding === 0) {
          if (this._lastsubencoding & 0x01) {
            // Weird: ignore blanks are RAW
            Log.Debug("     Ignoring blank after RAW");
          } else {
            display.fillRect(tx, ty, tw, th, this._background);
          }
        } else if (subencoding & 0x01) {
          // Raw
          var pixels = tw * th;
          var data = sock.rQshiftBytes(pixels * 4, false);


          // Max sure the image is fully opaque
          for (var i = 0; i < pixels; i++) {
            data[i * 4 + 3] = 255;
          }

          display.blitImage(tx, ty, tw, th, data, 0);
        } else {
          if (subencoding & 0x02) {
            // Background
            this._background = new Uint8Array(sock.rQshiftBytes(4));
          }

          if (subencoding & 0x04) {
            // Foreground
            this._foreground = new Uint8Array(sock.rQshiftBytes(4));
          }

          this._startTile(tx, ty, tw, th, this._background);

          if (subencoding & 0x08) {
            // AnySubrects
            var _subrects = sock.rQshift8();

            for (var s = 0; s < _subrects; s++) {
              var color = void 0;

              if (subencoding & 0x10) {
                // SubrectsColoured
                color = sock.rQshiftBytes(4);
              } else {
                color = this._foreground;
              }

              var xy = sock.rQshift8();
              var sx = xy >> 4;
              var sy = xy & 0x0f;
              var wh = sock.rQshift8();
              var sw = (wh >> 4) + 1;
              var sh = (wh & 0x0f) + 1;

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
}();