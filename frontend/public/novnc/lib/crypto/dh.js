"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.DHCipher = void 0;
var _bigint = require("./bigint.js");

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

var DHPublicKey = /*#__PURE__*/function () {
  function DHPublicKey(key) {
    _classCallCheck(this, DHPublicKey);
    this._key = key;
  }

  
return _createClass(DHPublicKey, [{
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
}();
var DHCipher = exports.DHCipher = /*#__PURE__*/function () {
  function DHCipher() {
    _classCallCheck(this, DHCipher);
    this._g = null;
    this._p = null;
    this._gBigInt = null;
    this._pBigInt = null;
    this._privateKey = null;
  }

  
return _createClass(DHCipher, [{
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
      var cipher = new DHCipher();

      cipher._generateKey(algorithm);
      
return {
        privateKey: cipher,
        publicKey: new DHPublicKey(cipher._publicKey)
      };
    }
  }]);
}();