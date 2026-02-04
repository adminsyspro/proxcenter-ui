"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = exports.H264Parser = exports.H264Context = void 0;
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

function _slicedToArray(r, e) { return _arrayWithHoles(r) || _iterableToArrayLimit(r, e) || _unsupportedIterableToArray(r, e) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1);

 

return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }

function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; 

return n; }

function _iterableToArrayLimit(r, l) { var t = null == r ? null : "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"];

 if (null != t) { var e, n, i, u, a = [], f = !0, o = !1;

 try { if (i = (t = t.call(r)).next, 0 === l) { if (Object(t) !== t) return; f = !1; } else for (; !(f = (e = i.call(t)).done) && (a.push(e.value), a.length !== l); f = !0); } catch (r) { o = !0, n = r; } finally { try { if (!f && null != t["return"] && (u = t["return"](), Object(u) !== u)) return; } finally { if (o) throw n; } } 

return a; } }

function _arrayWithHoles(r) { if (Array.isArray(r)) return r; }

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
 * Copyright (C) 2024 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

var H264Parser = exports.H264Parser = /*#__PURE__*/function () {
  function H264Parser(data) {
    _classCallCheck(this, H264Parser);
    this._data = data;
    this._index = 0;
    this.profileIdc = null;
    this.constraintSet = null;
    this.levelIdc = null;
  }

  
return _createClass(H264Parser, [{
    key: "_getStartSequenceLen",
    value: function _getStartSequenceLen(index) {
      var data = this._data;

      if (data[index + 0] == 0 && data[index + 1] == 0 && data[index + 2] == 0 && data[index + 3] == 1) {
        return 4;
      }

      if (data[index + 0] == 0 && data[index + 1] == 0 && data[index + 2] == 1) {
        return 3;
      }

      
return 0;
    }
  }, {
    key: "_indexOfNextNalUnit",
    value: function _indexOfNextNalUnit(index) {
      var data = this._data;

      for (var i = index; i < data.length; ++i) {
        if (this._getStartSequenceLen(i) != 0) {
          return i;
        }
      }

      
return -1;
    }
  }, {
    key: "_parseSps",
    value: function _parseSps(index) {
      this.profileIdc = this._data[index];
      this.constraintSet = this._data[index + 1];
      this.levelIdc = this._data[index + 2];
    }
  }, {
    key: "_parseNalUnit",
    value: function _parseNalUnit(index) {
      var firstByte = this._data[index];

      if (firstByte & 0x80) {
        throw new Error('H264 parsing sanity check failed, forbidden zero bit is set');
      }

      var unitType = firstByte & 0x1f;

      switch (unitType) {
        case 1:
          // coded slice, non-idr
          return {
            slice: true
          };
        case 5:
          // coded slice, idr
          return {
            slice: true,
            key: true
          };
        case 6:
          // sei
          return {};
        case 7:
          // sps
          this._parseSps(index + 1);
          
return {};
        case 8:
          // pps
          return {};
        default:
          Log.Warn("Unhandled unit type: ", unitType);
          break;
      }

      
return {};
    }
  }, {
    key: "parse",
    value: function parse() {
      var startIndex = this._index;
      var isKey = false;

      while (this._index < this._data.length) {
        var startSequenceLen = this._getStartSequenceLen(this._index);

        if (startSequenceLen == 0) {
          throw new Error('Invalid start sequence in bit stream');
        }

        var _this$_parseNalUnit = this._parseNalUnit(this._index + startSequenceLen),
          slice = _this$_parseNalUnit.slice,
          key = _this$_parseNalUnit.key;
        var nextIndex = this._indexOfNextNalUnit(this._index + startSequenceLen);

        if (nextIndex == -1) {
          this._index = this._data.length;
        } else {
          this._index = nextIndex;
        }

        if (key) {
          isKey = true;
        }

        if (slice) {
          break;
        }
      }

      if (startIndex === this._index) {
        return null;
      }

      
return {
        frame: this._data.subarray(startIndex, this._index),
        key: isKey
      };
    }
  }]);
}();
var H264Context = exports.H264Context = /*#__PURE__*/function () {
  function H264Context(width, height) {
    _classCallCheck(this, H264Context);
    this.lastUsed = 0;
    this._width = width;
    this._height = height;
    this._profileIdc = null;
    this._constraintSet = null;
    this._levelIdc = null;
    this._decoder = null;
    this._pendingFrames = [];
  }

  
return _createClass(H264Context, [{
    key: "_handleFrame",
    value: function _handleFrame(frame) {
      var pending = this._pendingFrames.shift();

      if (pending === undefined) {
        throw new Error("Pending frame queue empty when receiving frame from decoder");
      }

      if (pending.timestamp != frame.timestamp) {
        throw new Error("Video frame timestamp mismatch. Expected " + frame.timestamp + " but but got " + pending.timestamp);
      }

      pending.frame = frame;
      pending.ready = true;
      pending.resolve();

      if (!pending.keep) {
        frame.close();
      }
    }
  }, {
    key: "_handleError",
    value: function _handleError(e) {
      throw new Error("Failed to decode frame: " + e.message);
    }
  }, {
    key: "_configureDecoder",
    value: function _configureDecoder(profileIdc, constraintSet, levelIdc) {
      var _this = this;

      if (this._decoder === null || this._decoder.state === 'closed') {
        this._decoder = new VideoDecoder({
          output: function output(frame) {
            return _this._handleFrame(frame);
          },
          error: function error(e) {
            return _this._handleError(e);
          }
        });
      }

      var codec = 'avc1.' + profileIdc.toString(16).padStart(2, '0') + constraintSet.toString(16).padStart(2, '0') + levelIdc.toString(16).padStart(2, '0');

      this._decoder.configure({
        codec: codec,
        codedWidth: this._width,
        codedHeight: this._height,
        optimizeForLatency: true
      });
    }
  }, {
    key: "_preparePendingFrame",
    value: function _preparePendingFrame(timestamp) {
      var pending = {
        timestamp: timestamp,
        promise: null,
        resolve: null,
        frame: null,
        ready: false,
        keep: false
      };

      pending.promise = new Promise(function (resolve) {
        pending.resolve = resolve;
      });
      this._pendingFrames.push(pending);
      
return pending;
    }
  }, {
    key: "decode",
    value: function decode(payload) {
      var parser = new H264Parser(payload);
      var result = null;

      // Ideally, this timestamp should come from the server, but we'll just
      // approximate it instead.
      var timestamp = Math.round(window.performance.now() * 1e3);

      while (true) {
        var encodedFrame = parser.parse();

        if (encodedFrame === null) {
          break;
        }

        if (parser.profileIdc !== null) {
          self._profileIdc = parser.profileIdc;
          self._constraintSet = parser.constraintSet;
          self._levelIdc = parser.levelIdc;
        }

        if (this._decoder === null || this._decoder.state !== 'configured') {
          if (!encodedFrame.key) {
            Log.Warn("Missing key frame. Can't decode until one arrives");
            continue;
          }

          if (self._profileIdc === null) {
            Log.Warn('Cannot config decoder. Have not received SPS and PPS yet.');
            continue;
          }

          this._configureDecoder(self._profileIdc, self._constraintSet, self._levelIdc);
        }

        result = this._preparePendingFrame(timestamp);
        var chunk = new EncodedVideoChunk({
          timestamp: timestamp,
          type: encodedFrame.key ? 'key' : 'delta',
          data: encodedFrame.frame
        });

        try {
          this._decoder.decode(chunk);
        } catch (e) {
          Log.Warn("Failed to decode:", e);
        }
      }

      // We only keep last frame of each payload
      if (result !== null) {
        result.keep = true;
      }

      
return result;
    }
  }]);
}();
var H264Decoder = exports["default"] = /*#__PURE__*/function () {
  function H264Decoder() {
    _classCallCheck(this, H264Decoder);
    this._tick = 0;
    this._contexts = {};
  }

  
return _createClass(H264Decoder, [{
    key: "_contextId",
    value: function _contextId(x, y, width, height) {
      return [x, y, width, height].join(',');
    }
  }, {
    key: "_findOldestContextId",
    value: function _findOldestContextId() {
      var oldestTick = Number.MAX_VALUE;
      var oldestKey = undefined;

      for (var _i = 0, _Object$entries = Object.entries(this._contexts); _i < _Object$entries.length; _i++) {
        var _Object$entries$_i = _slicedToArray(_Object$entries[_i], 2),
          key = _Object$entries$_i[0],
          value = _Object$entries$_i[1];

        if (value.lastUsed < oldestTick) {
          oldestTick = value.lastUsed;
          oldestKey = key;
        }
      }

      
return oldestKey;
    }
  }, {
    key: "_createContext",
    value: function _createContext(x, y, width, height) {
      var maxContexts = 64;

      if (Object.keys(this._contexts).length >= maxContexts) {
        var oldestContextId = this._findOldestContextId();

        delete this._contexts[oldestContextId];
      }

      var context = new H264Context(width, height);

      this._contexts[this._contextId(x, y, width, height)] = context;
      
return context;
    }
  }, {
    key: "_getContext",
    value: function _getContext(x, y, width, height) {
      var context = this._contexts[this._contextId(x, y, width, height)];

      
return context !== undefined ? context : this._createContext(x, y, width, height);
    }
  }, {
    key: "_resetContext",
    value: function _resetContext(x, y, width, height) {
      delete this._contexts[this._contextId(x, y, width, height)];
    }
  }, {
    key: "_resetAllContexts",
    value: function _resetAllContexts() {
      this._contexts = {};
    }
  }, {
    key: "decodeRect",
    value: function decodeRect(x, y, width, height, sock, display, depth) {
      var resetContextFlag = 1;
      var resetAllContextsFlag = 2;

      if (sock.rQwait("h264 header", 8)) {
        return false;
      }

      var length = sock.rQshift32();
      var flags = sock.rQshift32();

      if (sock.rQwait("h264 payload", length, 8)) {
        return false;
      }

      if (flags & resetAllContextsFlag) {
        this._resetAllContexts();
      } else if (flags & resetContextFlag) {
        this._resetContext(x, y, width, height);
      }

      var context = this._getContext(x, y, width, height);

      context.lastUsed = this._tick++;

      if (length !== 0) {
        var payload = sock.rQshiftBytes(length, false);
        var frame = context.decode(payload);

        if (frame !== null) {
          display.videoFrame(x, y, width, height, frame);
        }
      }

      
return true;
    }
  }]);
}();