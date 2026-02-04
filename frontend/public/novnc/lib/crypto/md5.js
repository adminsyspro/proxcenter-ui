"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MD5 = MD5;

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


/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2021 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */
/*
 * Performs MD5 hashing on an array of bytes, returns an array of bytes
 */
function MD5(_x) {
  return _MD.apply(this, arguments);
}

function _MD() {
  _MD = _asyncToGenerator(/*#__PURE__*/_regeneratorRuntime().mark(function _callee(d) {
    var s, i;

    
return _regeneratorRuntime().wrap(function _callee$(_context) {
      while (1) switch (_context.prev = _context.next) {
        case 0:
          s = "";

          for (i = 0; i < d.length; i++) {
            s += String.fromCharCode(d[i]);
          }

          
return _context.abrupt("return", M(V(Y(X(s), 8 * s.length))));
        case 3:
        case "end":
          return _context.stop();
      }
    }, _callee);
  }));
  
return _MD.apply(this, arguments);
}

function M(d) {
  var f = new Uint8Array(d.length);

  for (var i = 0; i < d.length; i++) {
    f[i] = d.charCodeAt(i);
  }

  
return f;
}

function X(d) {
  var r = Array(d.length >> 2);

  for (var m = 0; m < r.length; m++) r[m] = 0;
  for (var _m = 0; _m < 8 * d.length; _m += 8) r[_m >> 5] |= (255 & d.charCodeAt(_m / 8)) << _m % 32;
  
return r;
}

function V(d) {
  var r = "";

  for (var m = 0; m < 32 * d.length; m += 8) r += String.fromCharCode(d[m >> 5] >>> m % 32 & 255);
  
return r;
}

function Y(d, g) {
  d[g >> 5] |= 128 << g % 32, d[14 + (g + 64 >>> 9 << 4)] = g;
  var m = 1732584193,
    f = -271733879,
    r = -1732584194,
    i = 271733878;

  for (var n = 0; n < d.length; n += 16) {
    var h = m,
      t = f,
      _g = r,
      e = i;

    f = ii(f = ii(f = ii(f = ii(f = hh(f = hh(f = hh(f = hh(f = gg(f = gg(f = gg(f = gg(f = ff(f = ff(f = ff(f = ff(f, r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 0], 7, -680876936), f, r, d[n + 1], 12, -389564586), m, f, d[n + 2], 17, 606105819), i, m, d[n + 3], 22, -1044525330), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 4], 7, -176418897), f, r, d[n + 5], 12, 1200080426), m, f, d[n + 6], 17, -1473231341), i, m, d[n + 7], 22, -45705983), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 8], 7, 1770035416), f, r, d[n + 9], 12, -1958414417), m, f, d[n + 10], 17, -42063), i, m, d[n + 11], 22, -1990404162), r = ff(r, i = ff(i, m = ff(m, f, r, i, d[n + 12], 7, 1804603682), f, r, d[n + 13], 12, -40341101), m, f, d[n + 14], 17, -1502002290), i, m, d[n + 15], 22, 1236535329), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 1], 5, -165796510), f, r, d[n + 6], 9, -1069501632), m, f, d[n + 11], 14, 643717713), i, m, d[n + 0], 20, -373897302), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 5], 5, -701558691), f, r, d[n + 10], 9, 38016083), m, f, d[n + 15], 14, -660478335), i, m, d[n + 4], 20, -405537848), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 9], 5, 568446438), f, r, d[n + 14], 9, -1019803690), m, f, d[n + 3], 14, -187363961), i, m, d[n + 8], 20, 1163531501), r = gg(r, i = gg(i, m = gg(m, f, r, i, d[n + 13], 5, -1444681467), f, r, d[n + 2], 9, -51403784), m, f, d[n + 7], 14, 1735328473), i, m, d[n + 12], 20, -1926607734), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 5], 4, -378558), f, r, d[n + 8], 11, -2022574463), m, f, d[n + 11], 16, 1839030562), i, m, d[n + 14], 23, -35309556), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 1], 4, -1530992060), f, r, d[n + 4], 11, 1272893353), m, f, d[n + 7], 16, -155497632), i, m, d[n + 10], 23, -1094730640), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 13], 4, 681279174), f, r, d[n + 0], 11, -358537222), m, f, d[n + 3], 16, -722521979), i, m, d[n + 6], 23, 76029189), r = hh(r, i = hh(i, m = hh(m, f, r, i, d[n + 9], 4, -640364487), f, r, d[n + 12], 11, -421815835), m, f, d[n + 15], 16, 530742520), i, m, d[n + 2], 23, -995338651), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 0], 6, -198630844), f, r, d[n + 7], 10, 1126891415), m, f, d[n + 14], 15, -1416354905), i, m, d[n + 5], 21, -57434055), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 12], 6, 1700485571), f, r, d[n + 3], 10, -1894986606), m, f, d[n + 10], 15, -1051523), i, m, d[n + 1], 21, -2054922799), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 8], 6, 1873313359), f, r, d[n + 15], 10, -30611744), m, f, d[n + 6], 15, -1560198380), i, m, d[n + 13], 21, 1309151649), r = ii(r, i = ii(i, m = ii(m, f, r, i, d[n + 4], 6, -145523070), f, r, d[n + 11], 10, -1120210379), m, f, d[n + 2], 15, 718787259), i, m, d[n + 9], 21, -343485551), m = add(m, h), f = add(f, t), r = add(r, _g), i = add(i, e);
  }

  
return Array(m, f, r, i);
}

function cmn(d, g, m, f, r, i) {
  return add(rol(add(add(g, d), add(f, i)), r), m);
}

function ff(d, g, m, f, r, i, n) {
  return cmn(g & m | ~g & f, d, g, r, i, n);
}

function gg(d, g, m, f, r, i, n) {
  return cmn(g & f | m & ~f, d, g, r, i, n);
}

function hh(d, g, m, f, r, i, n) {
  return cmn(g ^ m ^ f, d, g, r, i, n);
}

function ii(d, g, m, f, r, i, n) {
  return cmn(m ^ (g | ~f), d, g, r, i, n);
}

function add(d, g) {
  var m = (65535 & d) + (65535 & g);

  
return (d >> 16) + (g >> 16) + (m >> 16) << 16 | 65535 & m;
}

function rol(d, g) {
  return d << g | d >>> 32 - g;
}