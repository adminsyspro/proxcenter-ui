"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RSACipher = void 0;
var _base = _interopRequireDefault(require("../base64.js"));
var _bigint = require("./bigint.js");

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

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

var RSACipher = exports.RSACipher = /*#__PURE__*/function () {
  function RSACipher() {
    _classCallCheck(this, RSACipher);
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

  
return _createClass(RSACipher, [{
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
    value: function () {
      var _generateKey2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(algorithm, extractable) {
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
    }()
  }, {
    key: "_importKey",
    value: function () {
      var _importKey2 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2(key, extractable) {
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
    }()
  }, {
    key: "encrypt",
    value: function () {
      var _encrypt = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3(_algorithm, message) {
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
              em[1] = 0x02;
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
    }()
  }, {
    key: "decrypt",
    value: function () {
      var _decrypt = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4(_algorithm, message) {
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

              if (!(em[0] !== 0x00 || em[1] !== 0x02)) {
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

              if (!(em[i] === 0x00)) {
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
    }()
  }, {
    key: "exportKey",
    value: function () {
      var _exportKey = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee5() {
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
    }()
  }], [{
    key: "generateKey",
    value: function () {
      var _generateKey3 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee6(algorithm, extractable, _keyUsages) {
        var cipher;

        
return _regeneratorRuntime().wrap(function _callee6$(_context6) {
          while (1) switch (_context6.prev = _context6.next) {
            case 0:
              cipher = new RSACipher();
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
    }()
  }, {
    key: "importKey",
    value: function () {
      var _importKey3 = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee7(key, _algorithm, extractable, keyUsages) {
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
              cipher = new RSACipher();
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
    }()
  }]);
}();