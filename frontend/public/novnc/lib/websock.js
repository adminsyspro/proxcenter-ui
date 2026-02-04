"use strict";

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

function _typeof(o) { "@babel/helpers - typeof"; 

return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }

function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1);

 

return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }

function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }

function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }

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

return ("string" === r ? String : Number)(t); } /*
 * Websock: high-performance buffering wrapper
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * Websock is similar to the standard WebSocket / RTCDataChannel object
 * but with extra buffer handling.
 *
 * Websock has built-in receive queue buffering; the message event
 * does not contain actual data but is simply a notification that
 * there is new data available. Several rQ* methods are available to
 * read binary data off of the receive queue.
 */

// this has performance issues in some versions Chromium, and
// doesn't gain a tremendous amount of performance increase in Firefox
// at the moment.  It may be valuable to turn it on in the future.
var MAX_RQ_GROW_SIZE = 40 * 1024 * 1024; // 40 MiB

// Constants pulled from RTCDataChannelState enum
// https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/readyState#RTCDataChannelState_enum
var DataChannel = {
  CONNECTING: "connecting",
  OPEN: "open",
  CLOSING: "closing",
  CLOSED: "closed"
};
var ReadyStates = {
  CONNECTING: [WebSocket.CONNECTING, DataChannel.CONNECTING],
  OPEN: [WebSocket.OPEN, DataChannel.OPEN],
  CLOSING: [WebSocket.CLOSING, DataChannel.CLOSING],
  CLOSED: [WebSocket.CLOSED, DataChannel.CLOSED]
};

// Properties a raw channel must have, WebSocket and RTCDataChannel are two examples
var rawChannelProps = ["send", "close", "binaryType", "onerror", "onmessage", "onopen", "protocol", "readyState"];
var Websock = exports["default"] = /*#__PURE__*/function () {
  function Websock() {
    _classCallCheck(this, Websock);
    this._websocket = null; // WebSocket or RTCDataChannel object

    this._rQi = 0; // Receive queue index
    this._rQlen = 0; // Next write position in the receive queue
    this._rQbufferSize = 1024 * 1024 * 4; // Receive queue buffer size (4 MiB)
    // called in init: this._rQ = new Uint8Array(this._rQbufferSize);
    this._rQ = null; // Receive queue

    this._sQbufferSize = 1024 * 10; // 10 KiB
    // called in init: this._sQ = new Uint8Array(this._sQbufferSize);
    this._sQlen = 0;
    this._sQ = null; // Send queue

    this._eventHandlers = {
      message: function message() {},
      open: function open() {},
      close: function close() {},
      error: function error() {}
    };
  }

  // Getters and setters
  return _createClass(Websock, [{
    key: "readyState",
    get: function get() {
      var subState;

      if (this._websocket === null) {
        return "unused";
      }

      subState = this._websocket.readyState;

      if (ReadyStates.CONNECTING.includes(subState)) {
        return "connecting";
      } else if (ReadyStates.OPEN.includes(subState)) {
        return "open";
      } else if (ReadyStates.CLOSING.includes(subState)) {
        return "closing";
      } else if (ReadyStates.CLOSED.includes(subState)) {
        return "closed";
      }

      
return "unknown";
    }

    // Receive queue
  }, {
    key: "rQpeek8",
    value: function rQpeek8() {
      return this._rQ[this._rQi];
    }
  }, {
    key: "rQskipBytes",
    value: function rQskipBytes(bytes) {
      this._rQi += bytes;
    }
  }, {
    key: "rQshift8",
    value: function rQshift8() {
      return this._rQshift(1);
    }
  }, {
    key: "rQshift16",
    value: function rQshift16() {
      return this._rQshift(2);
    }
  }, {
    key: "rQshift32",
    value: function rQshift32() {
      return this._rQshift(4);
    }

    // TODO(directxman12): test performance with these vs a DataView
  }, {
    key: "_rQshift",
    value: function _rQshift(bytes) {
      var res = 0;

      for (var _byte = bytes - 1; _byte >= 0; _byte--) {
        res += this._rQ[this._rQi++] << _byte * 8;
      }

      
return res >>> 0;
    }
  }, {
    key: "rQshiftStr",
    value: function rQshiftStr(len) {
      var str = "";


      // Handle large arrays in steps to avoid long strings on the stack
      for (var i = 0; i < len; i += 4096) {
        var part = this.rQshiftBytes(Math.min(4096, len - i), false);

        str += String.fromCharCode.apply(null, part);
      }

      
return str;
    }
  }, {
    key: "rQshiftBytes",
    value: function rQshiftBytes(len) {
      var copy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

      this._rQi += len;

      if (copy) {
        return this._rQ.slice(this._rQi - len, this._rQi);
      } else {
        return this._rQ.subarray(this._rQi - len, this._rQi);
      }
    }
  }, {
    key: "rQshiftTo",
    value: function rQshiftTo(target, len) {
      // TODO: make this just use set with views when using a ArrayBuffer to store the rQ
      target.set(new Uint8Array(this._rQ.buffer, this._rQi, len));
      this._rQi += len;
    }
  }, {
    key: "rQpeekBytes",
    value: function rQpeekBytes(len) {
      var copy = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

      if (copy) {
        return this._rQ.slice(this._rQi, this._rQi + len);
      } else {
        return this._rQ.subarray(this._rQi, this._rQi + len);
      }
    }

    // Check to see if we must wait for 'num' bytes (default to FBU.bytes)
    // to be available in the receive queue. Return true if we need to
    // wait (and possibly print a debug message), otherwise false.
  }, {
    key: "rQwait",
    value: function rQwait(msg, num, goback) {
      if (this._rQlen - this._rQi < num) {
        if (goback) {
          if (this._rQi < goback) {
            throw new Error("rQwait cannot backup " + goback + " bytes");
          }

          this._rQi -= goback;
        }

        
return true; // true means need more data
      }

      
return false;
    }

    // Send queue
  }, {
    key: "sQpush8",
    value: function sQpush8(num) {
      this._sQensureSpace(1);
      this._sQ[this._sQlen++] = num;
    }
  }, {
    key: "sQpush16",
    value: function sQpush16(num) {
      this._sQensureSpace(2);
      this._sQ[this._sQlen++] = num >> 8 & 0xff;
      this._sQ[this._sQlen++] = num >> 0 & 0xff;
    }
  }, {
    key: "sQpush32",
    value: function sQpush32(num) {
      this._sQensureSpace(4);
      this._sQ[this._sQlen++] = num >> 24 & 0xff;
      this._sQ[this._sQlen++] = num >> 16 & 0xff;
      this._sQ[this._sQlen++] = num >> 8 & 0xff;
      this._sQ[this._sQlen++] = num >> 0 & 0xff;
    }
  }, {
    key: "sQpushString",
    value: function sQpushString(str) {
      var bytes = str.split('').map(function (chr) {
        return chr.charCodeAt(0);
      });

      this.sQpushBytes(new Uint8Array(bytes));
    }
  }, {
    key: "sQpushBytes",
    value: function sQpushBytes(bytes) {
      for (var offset = 0; offset < bytes.length;) {
        this._sQensureSpace(1);
        var chunkSize = this._sQbufferSize - this._sQlen;

        if (chunkSize > bytes.length - offset) {
          chunkSize = bytes.length - offset;
        }

        this._sQ.set(bytes.subarray(offset, offset + chunkSize), this._sQlen);
        this._sQlen += chunkSize;
        offset += chunkSize;
      }
    }
  }, {
    key: "flush",
    value: function flush() {
      if (this._sQlen > 0 && this.readyState === 'open') {
        this._websocket.send(new Uint8Array(this._sQ.buffer, 0, this._sQlen));
        this._sQlen = 0;
      }
    }
  }, {
    key: "_sQensureSpace",
    value: function _sQensureSpace(bytes) {
      if (this._sQbufferSize - this._sQlen < bytes) {
        this.flush();
      }
    }

    // Event handlers
  }, {
    key: "off",
    value: function off(evt) {
      this._eventHandlers[evt] = function () {};
    }
  }, {
    key: "on",
    value: function on(evt, handler) {
      this._eventHandlers[evt] = handler;
    }
  }, {
    key: "_allocateBuffers",
    value: function _allocateBuffers() {
      this._rQ = new Uint8Array(this._rQbufferSize);
      this._sQ = new Uint8Array(this._sQbufferSize);
    }
  }, {
    key: "init",
    value: function init() {
      this._allocateBuffers();
      this._rQi = 0;
      this._websocket = null;
    }
  }, {
    key: "open",
    value: function open(uri, protocols) {
      this.attach(new WebSocket(uri, protocols));
    }
  }, {
    key: "attach",
    value: function attach(rawChannel) {
      var _this = this;

      this.init();

      // Must get object and class methods to be compatible with the tests.
      var channelProps = [].concat(_toConsumableArray(Object.keys(rawChannel)), _toConsumableArray(Object.getOwnPropertyNames(Object.getPrototypeOf(rawChannel))));

      for (var i = 0; i < rawChannelProps.length; i++) {
        var prop = rawChannelProps[i];

        if (channelProps.indexOf(prop) < 0) {
          throw new Error('Raw channel missing property: ' + prop);
        }
      }

      this._websocket = rawChannel;
      this._websocket.binaryType = "arraybuffer";
      this._websocket.onmessage = this._recvMessage.bind(this);

      this._websocket.onopen = function () {
        Log.Debug('>> WebSock.onopen');

        if (_this._websocket.protocol) {
          Log.Info("Server choose sub-protocol: " + _this._websocket.protocol);
        }

        _this._eventHandlers.open();
        Log.Debug("<< WebSock.onopen");
      };

      this._websocket.onclose = function (e) {
        Log.Debug(">> WebSock.onclose");
        _this._eventHandlers.close(e);
        Log.Debug("<< WebSock.onclose");
      };

      this._websocket.onerror = function (e) {
        Log.Debug(">> WebSock.onerror: " + e);
        _this._eventHandlers.error(e);
        Log.Debug("<< WebSock.onerror: " + e);
      };
    }
  }, {
    key: "close",
    value: function close() {
      if (this._websocket) {
        if (this.readyState === 'connecting' || this.readyState === 'open') {
          Log.Info("Closing WebSocket connection");
          this._websocket.close();
        }

        this._websocket.onmessage = function () {};
      }
    }

    // private methods

    // We want to move all the unread data to the start of the queue,
    // e.g. compacting.
    // The function also expands the receive que if needed, and for
    // performance reasons we combine these two actions to avoid
    // unnecessary copying.
  }, {
    key: "_expandCompactRQ",
    value: function _expandCompactRQ(minFit) {
      // if we're using less than 1/8th of the buffer even with the incoming bytes, compact in place
      // instead of resizing
      var requiredBufferSize = (this._rQlen - this._rQi + minFit) * 8;
      var resizeNeeded = this._rQbufferSize < requiredBufferSize;

      if (resizeNeeded) {
        // Make sure we always *at least* double the buffer size, and have at least space for 8x
        // the current amount of data
        this._rQbufferSize = Math.max(this._rQbufferSize * 2, requiredBufferSize);
      }

      // we don't want to grow unboundedly
      if (this._rQbufferSize > MAX_RQ_GROW_SIZE) {
        this._rQbufferSize = MAX_RQ_GROW_SIZE;

        if (this._rQbufferSize - (this._rQlen - this._rQi) < minFit) {
          throw new Error("Receive queue buffer exceeded " + MAX_RQ_GROW_SIZE + " bytes, and the new message could not fit");
        }
      }

      if (resizeNeeded) {
        var oldRQbuffer = this._rQ.buffer;

        this._rQ = new Uint8Array(this._rQbufferSize);
        this._rQ.set(new Uint8Array(oldRQbuffer, this._rQi, this._rQlen - this._rQi));
      } else {
        this._rQ.copyWithin(0, this._rQi, this._rQlen);
      }

      this._rQlen = this._rQlen - this._rQi;
      this._rQi = 0;
    }

    // push arraybuffer values onto the end of the receive que
  }, {
    key: "_recvMessage",
    value: function _recvMessage(e) {
      if (this._rQlen == this._rQi) {
        // All data has now been processed, this means we
        // can reset the receive queue.
        this._rQlen = 0;
        this._rQi = 0;
      }

      var u8 = new Uint8Array(e.data);

      if (u8.length > this._rQbufferSize - this._rQlen) {
        this._expandCompactRQ(u8.length);
      }

      this._rQ.set(u8, this._rQlen);
      this._rQlen += u8.length;

      if (this._rQlen - this._rQi > 0) {
        this._eventHandlers.message();
      } else {
        Log.Debug("Ignoring empty message");
      }
    }
  }]);
}();