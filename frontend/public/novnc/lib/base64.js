"use strict";

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var Log = _interopRequireWildcard(require("./util/logging.js"));

function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap();

 

return (_getRequireWildcardCache = function _getRequireWildcardCache(e) { return e ? t : r; })(e); }

function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != _typeof(e) && "function" != typeof e) return { "default": e }; var t = _getRequireWildcardCache(r);

 if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor;

 for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;

 i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } 

return n["default"] = e, t && t.set(e, n), n; }


/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
// From: http://hg.mozilla.org/mozilla-central/raw-file/ec10630b1a54/js/src/devtools/jint/sunspider/string-base64.js
var _default = exports["default"] = {
  /* Convert data (an array of integers) to a Base64 string. */
  toBase64Table: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='.split(''),
  base64Pad: '=',
  encode: function encode(data) {
    "use strict";

    var result = '';
    var length = data.length;
    var lengthpad = length % 3;

    // Convert every three bytes to 4 ascii characters.

    for (var i = 0; i < length - 2; i += 3) {
      result += this.toBase64Table[data[i] >> 2];
      result += this.toBase64Table[((data[i] & 0x03) << 4) + (data[i + 1] >> 4)];
      result += this.toBase64Table[((data[i + 1] & 0x0f) << 2) + (data[i + 2] >> 6)];
      result += this.toBase64Table[data[i + 2] & 0x3f];
    }

    // Convert the remaining 1 or 2 bytes, pad out to 4 characters.
    var j = length - lengthpad;

    if (lengthpad === 2) {
      result += this.toBase64Table[data[j] >> 2];
      result += this.toBase64Table[((data[j] & 0x03) << 4) + (data[j + 1] >> 4)];
      result += this.toBase64Table[(data[j + 1] & 0x0f) << 2];
      result += this.toBase64Table[64];
    } else if (lengthpad === 1) {
      result += this.toBase64Table[data[j] >> 2];
      result += this.toBase64Table[(data[j] & 0x03) << 4];
      result += this.toBase64Table[64];
      result += this.toBase64Table[64];
    }

    
return result;
  },

  /* Convert Base64 data to a string */
  /* eslint-disable comma-spacing */
  toBinaryTable: [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 62, -1, -1, -1, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, -1, -1, -1, 0, -1, -1, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, -1, -1, -1, -1, -1, -1, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, -1, -1, -1, -1, -1],
  /* eslint-enable comma-spacing */decode: function decode(data) {
    var offset = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
    var dataLength = data.indexOf('=') - offset;

    if (dataLength < 0) {
      dataLength = data.length - offset;
    }

    /* Every four characters is 3 resulting numbers */
    var resultLength = (dataLength >> 2) * 3 + Math.floor(dataLength % 4 / 1.5);
    var result = new Array(resultLength);

    // Convert one by one.

    var leftbits = 0; // number of bits decoded, but yet to be appended
    var leftdata = 0; // bits decoded, but yet to be appended

    for (var idx = 0, i = offset; i < data.length; i++) {
      var c = this.toBinaryTable[data.charCodeAt(i) & 0x7f];
      var padding = data.charAt(i) === this.base64Pad;


      // Skip illegal characters and whitespace
      if (c === -1) {
        Log.Error("Illegal character code " + data.charCodeAt(i) + " at position " + i);
        continue;
      }

      // Collect data into leftdata, update bitcount
      leftdata = leftdata << 6 | c;
      leftbits += 6;

      // If we have 8 or more bits, append 8 bits to the result
      if (leftbits >= 8) {
        leftbits -= 8;


        // Append if not padding.
        if (!padding) {
          result[idx++] = leftdata >> leftbits & 0xff;
        }

        leftdata &= (1 << leftbits) - 1;
      }
    }

    // If there are any bits left, the base64 string was corrupted
    if (leftbits) {
      var err = new Error('Corrupted base64 string');

      err.name = 'Base64-Error';
      throw err;
    }

    
return result;
  }
};

/* End of Base64 namespace */