"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var Log = _interopRequireWildcard(require("../util/logging.js"));
var _events = require("../util/events.js");
var KeyboardUtil = _interopRequireWildcard(require("./util.js"));
var _keysym = _interopRequireDefault(require("./keysym.js"));
var browser = _interopRequireWildcard(require("../util/browser.js"));

function _interopRequireDefault(e) { return e && e.__esModule ? e : { "default": e }; }

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
 * Licensed under MPL 2.0 or any later version (see LICENSE.txt)
 */

//
// Keyboard event handler
//
var Keyboard = exports["default"] = /*#__PURE__*/function () {
  function Keyboard(target) {
    _classCallCheck(this, Keyboard);
    this._target = target || null;
    this._keyDownList = {}; // List of depressed keys
    // (even if they are happy)
    this._altGrArmed = false; // Windows AltGr detection

    // keep these here so we can refer to them later
    this._eventHandlers = {
      'keyup': this._handleKeyUp.bind(this),
      'keydown': this._handleKeyDown.bind(this),
      'blur': this._allKeysUp.bind(this)
    };

    // ===== EVENT HANDLERS =====

    this.onkeyevent = function () {}; // Handler for key press/release
  }

  // ===== PRIVATE METHODS =====
  return _createClass(Keyboard, [{
    key: "_sendKeyEvent",
    value: function _sendKeyEvent(keysym, code, down) {
      var numlock = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;
      var capslock = arguments.length > 4 && arguments[4] !== undefined ? arguments[4] : null;

      if (down) {
        this._keyDownList[code] = keysym;
      } else {
        // Do we really think this key is down?
        if (!(code in this._keyDownList)) {
          return;
        }

        delete this._keyDownList[code];
      }

      Log.Debug("onkeyevent " + (down ? "down" : "up") + ", keysym: " + keysym, ", code: " + code + ", numlock: " + numlock + ", capslock: " + capslock);
      this.onkeyevent(keysym, code, down, numlock, capslock);
    }
  }, {
    key: "_getKeyCode",
    value: function _getKeyCode(e) {
      var code = KeyboardUtil.getKeycode(e);

      if (code !== 'Unidentified') {
        return code;
      }

      // Unstable, but we don't have anything else to go on
      if (e.keyCode) {
        // 229 is used for composition events
        if (e.keyCode !== 229) {
          return 'Platform' + e.keyCode;
        }
      }

      // A precursor to the final DOM3 standard. Unfortunately it
      // is not layout independent, so it is as bad as using keyCode
      if (e.keyIdentifier) {
        // Non-character key?
        if (e.keyIdentifier.substr(0, 2) !== 'U+') {
          return e.keyIdentifier;
        }

        var codepoint = parseInt(e.keyIdentifier.substr(2), 16);
        var _char = String.fromCharCode(codepoint).toUpperCase();

        
return 'Platform' + _char.charCodeAt();
      }

      
return 'Unidentified';
    }
  }, {
    key: "_handleKeyDown",
    value: function _handleKeyDown(e) {
      var code = this._getKeyCode(e);
      var keysym = KeyboardUtil.getKeysym(e);
      var numlock = e.getModifierState('NumLock');
      var capslock = e.getModifierState('CapsLock');

      // getModifierState for NumLock is not supported on mac and ios and always returns false.
      // Set to null to indicate unknown/unsupported instead.
      if (browser.isMac() || browser.isIOS()) {
        numlock = null;
      }

      // Windows doesn't have a proper AltGr, but handles it using
      // fake Ctrl+Alt. However the remote end might not be Windows,
      // so we need to merge those in to a single AltGr event. We
      // detect this case by seeing the two key events directly after
      // each other with a very short time between them (<50ms).
      if (this._altGrArmed) {
        this._altGrArmed = false;
        clearTimeout(this._altGrTimeout);

        if (code === "AltRight" && e.timeStamp - this._altGrCtrlTime < 50) {
          // FIXME: We fail to detect this if either Ctrl key is
          //        first manually pressed as Windows then no
          //        longer sends the fake Ctrl down event. It
          //        does however happily send real Ctrl events
          //        even when AltGr is already down. Some
          //        browsers detect this for us though and set the
          //        key to "AltGraph".
          keysym = _keysym["default"].XK_ISO_Level3_Shift;
        } else {
          this._sendKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true, numlock, capslock);
        }
      }

      // We cannot handle keys we cannot track, but we also need
      // to deal with virtual keyboards which omit key info
      if (code === 'Unidentified') {
        if (keysym) {
          // If it's a virtual keyboard then it should be
          // sufficient to just send press and release right
          // after each other
          this._sendKeyEvent(keysym, code, true, numlock, capslock);
          this._sendKeyEvent(keysym, code, false, numlock, capslock);
        }

        (0, _events.stopEvent)(e);
        
return;
      }

      // Alt behaves more like AltGraph on macOS, so shuffle the
      // keys around a bit to make things more sane for the remote
      // server. This method is used by RealVNC and TigerVNC (and
      // possibly others).
      if (browser.isMac() || browser.isIOS()) {
        switch (keysym) {
          case _keysym["default"].XK_Super_L:
            keysym = _keysym["default"].XK_Alt_L;
            break;
          case _keysym["default"].XK_Super_R:
            keysym = _keysym["default"].XK_Super_L;
            break;
          case _keysym["default"].XK_Alt_L:
            keysym = _keysym["default"].XK_Mode_switch;
            break;
          case _keysym["default"].XK_Alt_R:
            keysym = _keysym["default"].XK_ISO_Level3_Shift;
            break;
        }
      }

      // Is this key already pressed? If so, then we must use the
      // same keysym or we'll confuse the server
      if (code in this._keyDownList) {
        keysym = this._keyDownList[code];
      }

      // macOS doesn't send proper key releases if a key is pressed
      // while meta is held down
      if ((browser.isMac() || browser.isIOS()) && e.metaKey && code !== 'MetaLeft' && code !== 'MetaRight') {
        this._sendKeyEvent(keysym, code, true, numlock, capslock);
        this._sendKeyEvent(keysym, code, false, numlock, capslock);
        (0, _events.stopEvent)(e);
        
return;
      }

      // macOS doesn't send proper key events for modifiers, only
      // state change events. That gets extra confusing for CapsLock
      // which toggles on each press, but not on release. So pretend
      // it was a quick press and release of the button.
      if ((browser.isMac() || browser.isIOS()) && code === 'CapsLock') {
        this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, 'CapsLock', true, numlock, capslock);
        this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, 'CapsLock', false, numlock, capslock);
        (0, _events.stopEvent)(e);
        
return;
      }

      // Windows doesn't send proper key releases for a bunch of
      // Japanese IM keys so we have to fake the release right away
      var jpBadKeys = [_keysym["default"].XK_Zenkaku_Hankaku, _keysym["default"].XK_Eisu_toggle, _keysym["default"].XK_Katakana, _keysym["default"].XK_Hiragana, _keysym["default"].XK_Romaji];

      if (browser.isWindows() && jpBadKeys.includes(keysym)) {
        this._sendKeyEvent(keysym, code, true, numlock, capslock);
        this._sendKeyEvent(keysym, code, false, numlock, capslock);
        (0, _events.stopEvent)(e);
        
return;
      }

      (0, _events.stopEvent)(e);

      // Possible start of AltGr sequence? (see above)
      if (code === "ControlLeft" && browser.isWindows() && !("ControlLeft" in this._keyDownList)) {
        this._altGrArmed = true;
        this._altGrTimeout = setTimeout(this._interruptAltGrSequence.bind(this), 100);
        this._altGrCtrlTime = e.timeStamp;
        
return;
      }

      this._sendKeyEvent(keysym, code, true, numlock, capslock);
    }
  }, {
    key: "_handleKeyUp",
    value: function _handleKeyUp(e) {
      (0, _events.stopEvent)(e);
      var code = this._getKeyCode(e);

      // We can't get a release in the middle of an AltGr sequence, so
      // abort that detection
      this._interruptAltGrSequence();

      // See comment in _handleKeyDown()
      if ((browser.isMac() || browser.isIOS()) && code === 'CapsLock') {
        this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, 'CapsLock', true);
        this._sendKeyEvent(_keysym["default"].XK_Caps_Lock, 'CapsLock', false);
        
return;
      }

      this._sendKeyEvent(this._keyDownList[code], code, false);

      // Windows has a rather nasty bug where it won't send key
      // release events for a Shift button if the other Shift is still
      // pressed
      if (browser.isWindows() && (code === 'ShiftLeft' || code === 'ShiftRight')) {
        if ('ShiftRight' in this._keyDownList) {
          this._sendKeyEvent(this._keyDownList['ShiftRight'], 'ShiftRight', false);
        }

        if ('ShiftLeft' in this._keyDownList) {
          this._sendKeyEvent(this._keyDownList['ShiftLeft'], 'ShiftLeft', false);
        }
      }
    }
  }, {
    key: "_interruptAltGrSequence",
    value: function _interruptAltGrSequence() {
      if (this._altGrArmed) {
        this._altGrArmed = false;
        clearTimeout(this._altGrTimeout);
        this._sendKeyEvent(_keysym["default"].XK_Control_L, "ControlLeft", true);
      }
    }
  }, {
    key: "_allKeysUp",
    value: function _allKeysUp() {
      Log.Debug(">> Keyboard.allKeysUp");

      // Prevent control key being processed after losing focus.
      this._interruptAltGrSequence();

      for (var code in this._keyDownList) {
        this._sendKeyEvent(this._keyDownList[code], code, false);
      }

      Log.Debug("<< Keyboard.allKeysUp");
    }

    // ===== PUBLIC METHODS =====
  }, {
    key: "grab",
    value: function grab() {
      //Log.Debug(">> Keyboard.grab");

      this._target.addEventListener('keydown', this._eventHandlers.keydown);
      this._target.addEventListener('keyup', this._eventHandlers.keyup);

      // Release (key up) if window loses focus
      window.addEventListener('blur', this._eventHandlers.blur);

      //Log.Debug("<< Keyboard.grab");
    }
  }, {
    key: "ungrab",
    value: function ungrab() {
      //Log.Debug(">> Keyboard.ungrab");

      this._target.removeEventListener('keydown', this._eventHandlers.keydown);
      this._target.removeEventListener('keyup', this._eventHandlers.keyup);
      window.removeEventListener('blur', this._eventHandlers.blur);

      // Release (key up) all keys that are in a down state
      this._allKeysUp();

      //Log.Debug(">> Keyboard.ungrab");
    }
  }]);
}();