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
 */
var EventTargetMixin = exports["default"] = /*#__PURE__*/function () {
  function EventTargetMixin() {
    _classCallCheck(this, EventTargetMixin);
    this._listeners = new Map();
  }

  
return _createClass(EventTargetMixin, [{
    key: "addEventListener",
    value: function addEventListener(type, callback) {
      if (!this._listeners.has(type)) {
        this._listeners.set(type, new Set());
      }

      this._listeners.get(type).add(callback);
    }
  }, {
    key: "removeEventListener",
    value: function removeEventListener(type, callback) {
      if (this._listeners.has(type)) {
        this._listeners.get(type)["delete"](callback);
      }
    }
  }, {
    key: "dispatchEvent",
    value: function dispatchEvent(event) {
      var _this = this;

      if (!this._listeners.has(event.type)) {
        return true;
      }

      this._listeners.get(event.type).forEach(function (callback) {
        return callback.call(_this, event);
      });
      
return !event.defaultPrevented;
    }
  }]);
}();