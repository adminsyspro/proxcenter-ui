"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _strings = require("./util/strings.js");
var _eventtarget = _interopRequireDefault(require("./util/eventtarget.js"));
var _crypto = _interopRequireDefault(require("./crypto/crypto.js"));

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

function _callSuper(t, o, e) { return o = _getPrototypeOf(o), _possibleConstructorReturn(t, _isNativeReflectConstruct() ? Reflect.construct(o, e || [], _getPrototypeOf(t).constructor) : o.apply(t, e)); }

function _possibleConstructorReturn(t, e) { if (e && ("object" == _typeof(e) || "function" == typeof e)) return e; if (void 0 !== e) throw new TypeError("Derived constructors may only return object or undefined"); 

return _assertThisInitialized(t); }

function _assertThisInitialized(e) { if (void 0 === e) throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); 

return e; }

function _isNativeReflectConstruct() { try { var t = !Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {})); } catch (t) {} 

return (_isNativeReflectConstruct = function _isNativeReflectConstruct() { return !!t; })(); }

function _getPrototypeOf(t) { return _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function (t) { return t.__proto__ || Object.getPrototypeOf(t); }, _getPrototypeOf(t); }

function _inherits(t, e) { if ("function" != typeof e && null !== e) throw new TypeError("Super expression must either be null or a function"); t.prototype = Object.create(e && e.prototype, { constructor: { value: t, writable: !0, configurable: !0 } }), Object.defineProperty(t, "prototype", { writable: !1 }), e && _setPrototypeOf(t, e); }

function _setPrototypeOf(t, e) { return _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function (t, e) { return t.__proto__ = e, t; }, _setPrototypeOf(t, e); }

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

var RA2Cipher = /*#__PURE__*/function () {
  function RA2Cipher() {
    _classCallCheck(this, RA2Cipher);
    this._cipher = null;
    this._counter = new Uint8Array(16);
  }

  
return _createClass(RA2Cipher, [{
    key: "setKey",
    value: function () {
      var _setKey = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(key) {
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
    }()
  }, {
    key: "makeMessage",
    value: function () {
      var _makeMessage = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee2(message) {
        var ad, encrypted, i, res;

        
return _regeneratorRuntime().wrap(function _callee2$(_context2) {
          while (1) switch (_context2.prev = _context2.next) {
            case 0:
              ad = new Uint8Array([(message.length & 0xff00) >>> 8, message.length & 0xff]);
              _context2.next = 3;
              
return _crypto["default"].encrypt({
                name: "AES-EAX",
                iv: this._counter,
                additionalData: ad
              }, this._cipher, message);
            case 3:
              encrypted = _context2.sent;
              for (i = 0; i < 16 && this._counter[i]++ === 255; i++);
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
    }()
  }, {
    key: "receiveMessage",
    value: function () {
      var _receiveMessage = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee3(length, encrypted) {
        var ad, res, i;

        
return _regeneratorRuntime().wrap(function _callee3$(_context3) {
          while (1) switch (_context3.prev = _context3.next) {
            case 0:
              ad = new Uint8Array([(length & 0xff00) >>> 8, length & 0xff]);
              _context3.next = 3;
              
return _crypto["default"].decrypt({
                name: "AES-EAX",
                iv: this._counter,
                additionalData: ad
              }, this._cipher, encrypted);
            case 3:
              res = _context3.sent;
              for (i = 0; i < 16 && this._counter[i]++ === 255; i++);
              
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
    }()
  }]);
}();
var RSAAESAuthenticationState = exports["default"] = /*#__PURE__*/function (_EventTargetMixin) {
  function RSAAESAuthenticationState(sock, getCredentials) {
    var _this;

    _classCallCheck(this, RSAAESAuthenticationState);
    _this = _callSuper(this, RSAAESAuthenticationState);
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

  _inherits(RSAAESAuthenticationState, _EventTargetMixin);
  
return _createClass(RSAAESAuthenticationState, [{
    key: "_waitSockAsync",
    value: function _waitSockAsync(len) {
      var _this2 = this;

      
return new Promise(function (resolve, reject) {
        var hasData = function hasData() {
          return !_this2._sock.rQwait('RA2', len);
        };

        if (hasData()) {
          resolve();
        } else {
          _this2._checkSock = function () {
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

      
return new Promise(function (resolve, reject) {
        _this3._approveServerResolve = resolve;
        _this3._approveServerReject = reject;
      });
    }
  }, {
    key: "_waitCredentialsAsync",
    value: function _waitCredentialsAsync(subtype) {
      var _this4 = this;

      var hasCredentials = function hasCredentials() {
        if (subtype === 1 && _this4._getCredentials().username !== undefined && _this4._getCredentials().password !== undefined) {
          return true;
        } else if (subtype === 2 && _this4._getCredentials().password !== undefined) {
          return true;
        }

        
return false;
      };

      
return new Promise(function (resolve, reject) {
        if (hasCredentials()) {
          resolve();
        } else {
          _this4._checkCredentials = function () {
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
    value: function () {
      var _negotiateRA2neAuthAsync = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee4() {
        var serverKeyLengthBuffer, serverKeyLength, serverKeyBytes, serverN, serverE, serverRSACipher, serverPublickey, approveKey, clientKeyLength, clientKeyBytes, clientRSACipher, clientExportedRSAKey, clientN, clientE, clientPublicKey, clientRandom, clientEncryptedRandom, clientRandomMessage, serverEncryptedRandom, serverRandom, clientSessionKey, serverSessionKey, clientCipher, serverCipher, serverHash, clientHash, serverHashReceived, i, subtype, waitCredentials, username, password, credentials, _i, _i2;

        
return _regeneratorRuntime().wrap(function _callee4$(_context4) {
          while (1) switch (_context4.prev = _context4.next) {
            case 0:
              this._hasStarted = true;

              // 1: Receive server public key
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

              // verify server public key
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
              // 2: Send client public key
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
              clientPublicKey[0] = (clientKeyLength & 0xff000000) >>> 24;
              clientPublicKey[1] = (clientKeyLength & 0xff0000) >>> 16;
              clientPublicKey[2] = (clientKeyLength & 0xff00) >>> 8;
              clientPublicKey[3] = clientKeyLength & 0xff;
              clientPublicKey.set(clientN, 4);
              clientPublicKey.set(clientE, 4 + clientKeyBytes);
              this._sock.sQpushBytes(clientPublicKey);
              this._sock.flush();

              // 3: Send client random
              clientRandom = new Uint8Array(16);
              window.crypto.getRandomValues(clientRandom);
              _context4.next = 50;
              
return _crypto["default"].encrypt({
                name: "RSA-PKCS1-v1_5"
              }, serverRSACipher, clientRandom);
            case 50:
              clientEncryptedRandom = _context4.sent;
              clientRandomMessage = new Uint8Array(2 + serverKeyBytes);
              clientRandomMessage[0] = (serverKeyBytes & 0xff00) >>> 8;
              clientRandomMessage[1] = serverKeyBytes & 0xff;
              clientRandomMessage.set(clientEncryptedRandom, 2);
              this._sock.sQpushBytes(clientRandomMessage);
              this._sock.flush();

              // 4: Receive server random
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
              // 5: Compute session keys and set ciphers
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
              // 6: Compute and exchange hashes
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

              if (this._getCredentials().username === undefined || this._getCredentials().password === undefined) {
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

              if (this._getCredentials().password === undefined) {
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
    }()
  }, {
    key: "hasStarted",
    get: function get() {
      return this._hasStarted;
    },
    set: function set(s) {
      this._hasStarted = s;
    }
  }]);
}(_eventtarget["default"]);