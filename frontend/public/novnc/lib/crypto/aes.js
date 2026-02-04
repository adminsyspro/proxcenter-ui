"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AESECBCipher = exports.AESEAXCipher = void 0;

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

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

var AESECBCipher = exports.AESECBCipher = /*#__PURE__*/function () {
  function AESECBCipher() {
    _classCallCheck(this, AESECBCipher);
    this._key = null;
  }

  
return _createClass(AESECBCipher, [{
    key: "algorithm",
    get: function get() {
      return {
        name: "AES-ECB"
      };
    }
  }, {
    key: "_importKey",
    value: function () {
      var _importKey2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(key, extractable, keyUsages) {
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
    }()
  }, {
    key: "encrypt",
    value: function () {
      var _encrypt = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2(_algorithm, plaintext) {
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
    }()
  }], [{
    key: "importKey",
    value: function () {
      var _importKey3 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3(key, _algorithm, extractable, keyUsages) {
        var cipher;

        
return _regeneratorRuntime().wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              cipher = new AESECBCipher();
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
    }()
  }]);
}();
var AESEAXCipher = exports.AESEAXCipher = /*#__PURE__*/function () {
  function AESEAXCipher() {
    _classCallCheck(this, AESEAXCipher);
    this._rawKey = null;
    this._ctrKey = null;
    this._cbcKey = null;
    this._zeroBlock = new Uint8Array(16);
    this._prefixBlock0 = this._zeroBlock;
    this._prefixBlock1 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    this._prefixBlock2 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]);
  }

  
return _createClass(AESEAXCipher, [{
    key: "algorithm",
    get: function get() {
      return {
        name: "AES-EAX"
      };
    }
  }, {
    key: "_encryptBlock",
    value: function () {
      var _encryptBlock2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4(block) {
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
    }()
  }, {
    key: "_initCMAC",
    value: function () {
      var _initCMAC2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
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

              lut = [0x0, 0x87, 0x0e, 0x89];
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
    }()
  }, {
    key: "_encryptCTR",
    value: function () {
      var _encryptCTR2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee6(data, counter) {
        var encrypted;

        
return _regeneratorRuntime().wrap(function _callee6$(_context6) {
          while (1) switch (_context6.prev = _context6.next) {
            case 0:
              _context6.next = 2;
              
return window.crypto.subtle.encrypt({
                name: "AES-CTR",
                counter: counter,
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
    }()
  }, {
    key: "_decryptCTR",
    value: function () {
      var _decryptCTR2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee7(data, counter) {
        var decrypted;

        
return _regeneratorRuntime().wrap(function _callee7$(_context7) {
          while (1) switch (_context7.prev = _context7.next) {
            case 0:
              _context7.next = 2;
              
return window.crypto.subtle.decrypt({
                name: "AES-CTR",
                counter: counter,
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
    }()
  }, {
    key: "_computeCMAC",
    value: function () {
      var _computeCMAC2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee8(data, prefixBlock) {
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
                cbcData[(n + 1) * 16 + r] = 0x80;

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
    }()
  }, {
    key: "_importKey",
    value: function () {
      var _importKey4 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee9(key) {
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
    }()
  }, {
    key: "encrypt",
    value: function () {
      var _encrypt2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee10(algorithm, message) {
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
    }()
  }, {
    key: "decrypt",
    value: function () {
      var _decrypt = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee11(algorithm, data) {
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
    }()
  }], [{
    key: "importKey",
    value: function () {
      var _importKey5 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee12(key, _algorithm, _extractable, _keyUsages) {
        var cipher;

        
return _regeneratorRuntime().wrap(function _callee12$(_context12) {
          while (1) switch (_context12.prev = _context12.next) {
            case 0:
              cipher = new AESEAXCipher();
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
    }()
  }]);
}();