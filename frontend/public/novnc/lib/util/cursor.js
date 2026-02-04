"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var _browser = require("./browser.js");

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

var useFallback = !_browser.supportsCursorURIs || _browser.isTouchDevice;
var Cursor = exports["default"] = /*#__PURE__*/function () {
  function Cursor() {
    _classCallCheck(this, Cursor);
    this._target = null;
    this._canvas = document.createElement('canvas');

    if (useFallback) {
      this._canvas.style.position = 'fixed';
      this._canvas.style.zIndex = '65535';
      this._canvas.style.pointerEvents = 'none';

      // Safari on iOS can select the cursor image
      // https://bugs.webkit.org/show_bug.cgi?id=249223
      this._canvas.style.userSelect = 'none';
      this._canvas.style.WebkitUserSelect = 'none';

      // Can't use "display" because of Firefox bug #1445997
      this._canvas.style.visibility = 'hidden';
    }

    this._position = {
      x: 0,
      y: 0
    };
    this._hotSpot = {
      x: 0,
      y: 0
    };
    this._eventHandlers = {
      'mouseover': this._handleMouseOver.bind(this),
      'mouseleave': this._handleMouseLeave.bind(this),
      'mousemove': this._handleMouseMove.bind(this),
      'mouseup': this._handleMouseUp.bind(this)
    };
  }

  
return _createClass(Cursor, [{
    key: "attach",
    value: function attach(target) {
      if (this._target) {
        this.detach();
      }

      this._target = target;

      if (useFallback) {
        document.body.appendChild(this._canvas);
        var options = {
          capture: true,
          passive: true
        };

        this._target.addEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.addEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.addEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.addEventListener('mouseup', this._eventHandlers.mouseup, options);
      }

      this.clear();
    }
  }, {
    key: "detach",
    value: function detach() {
      if (!this._target) {
        return;
      }

      if (useFallback) {
        var options = {
          capture: true,
          passive: true
        };

        this._target.removeEventListener('mouseover', this._eventHandlers.mouseover, options);
        this._target.removeEventListener('mouseleave', this._eventHandlers.mouseleave, options);
        this._target.removeEventListener('mousemove', this._eventHandlers.mousemove, options);
        this._target.removeEventListener('mouseup', this._eventHandlers.mouseup, options);

        if (document.contains(this._canvas)) {
          document.body.removeChild(this._canvas);
        }
      }

      this._target = null;
    }
  }, {
    key: "change",
    value: function change(rgba, hotx, hoty, w, h) {
      if (w === 0 || h === 0) {
        this.clear();
        
return;
      }

      this._position.x = this._position.x + this._hotSpot.x - hotx;
      this._position.y = this._position.y + this._hotSpot.y - hoty;
      this._hotSpot.x = hotx;
      this._hotSpot.y = hoty;
      var ctx = this._canvas.getContext('2d');

      this._canvas.width = w;
      this._canvas.height = h;
      var img = new ImageData(new Uint8ClampedArray(rgba), w, h);

      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(img, 0, 0);

      if (useFallback) {
        this._updatePosition();
      } else {
        var url = this._canvas.toDataURL();

        this._target.style.cursor = 'url(' + url + ')' + hotx + ' ' + hoty + ', default';
      }
    }
  }, {
    key: "clear",
    value: function clear() {
      this._target.style.cursor = 'none';
      this._canvas.width = 0;
      this._canvas.height = 0;
      this._position.x = this._position.x + this._hotSpot.x;
      this._position.y = this._position.y + this._hotSpot.y;
      this._hotSpot.x = 0;
      this._hotSpot.y = 0;
    }

    // Mouse events might be emulated, this allows
    // moving the cursor in such cases
  }, {
    key: "move",
    value: function move(clientX, clientY) {
      if (!useFallback) {
        return;
      }


      // clientX/clientY are relative the _visual viewport_,
      // but our position is relative the _layout viewport_,
      // so try to compensate when we can
      if (window.visualViewport) {
        this._position.x = clientX + window.visualViewport.offsetLeft;
        this._position.y = clientY + window.visualViewport.offsetTop;
      } else {
        this._position.x = clientX;
        this._position.y = clientY;
      }

      this._updatePosition();
      var target = document.elementFromPoint(clientX, clientY);

      this._updateVisibility(target);
    }
  }, {
    key: "_handleMouseOver",
    value: function _handleMouseOver(event) {
      // This event could be because we're entering the target, or
      // moving around amongst its sub elements. Let the move handler
      // sort things out.
      this._handleMouseMove(event);
    }
  }, {
    key: "_handleMouseLeave",
    value: function _handleMouseLeave(event) {
      // Check if we should show the cursor on the element we are leaving to
      this._updateVisibility(event.relatedTarget);
    }
  }, {
    key: "_handleMouseMove",
    value: function _handleMouseMove(event) {
      this._updateVisibility(event.target);
      this._position.x = event.clientX - this._hotSpot.x;
      this._position.y = event.clientY - this._hotSpot.y;
      this._updatePosition();
    }
  }, {
    key: "_handleMouseUp",
    value: function _handleMouseUp(event) {
      var _this = this;

      // We might get this event because of a drag operation that
      // moved outside of the target. Check what's under the cursor
      // now and adjust visibility based on that.
      var target = document.elementFromPoint(event.clientX, event.clientY);

      this._updateVisibility(target);

      // Captures end with a mouseup but we can't know the event order of
      // mouseup vs releaseCapture.
      //
      // In the cases when releaseCapture comes first, the code above is
      // enough.
      //
      // In the cases when the mouseup comes first, we need wait for the
      // browser to flush all events and then check again if the cursor
      // should be visible.
      if (this._captureIsActive()) {
        window.setTimeout(function () {
          // We might have detached at this point
          if (!_this._target) {
            return;
          }


          // Refresh the target from elementFromPoint since queued events
          // might have altered the DOM
          target = document.elementFromPoint(event.clientX, event.clientY);
          _this._updateVisibility(target);
        }, 0);
      }
    }
  }, {
    key: "_showCursor",
    value: function _showCursor() {
      if (this._canvas.style.visibility === 'hidden') {
        this._canvas.style.visibility = '';
      }
    }
  }, {
    key: "_hideCursor",
    value: function _hideCursor() {
      if (this._canvas.style.visibility !== 'hidden') {
        this._canvas.style.visibility = 'hidden';
      }
    }

    // Should we currently display the cursor?
    // (i.e. are we over the target, or a child of the target without a
    // different cursor set)
  }, {
    key: "_shouldShowCursor",
    value: function _shouldShowCursor(target) {
      if (!target) {
        return false;
      }


      // Easy case
      if (target === this._target) {
        return true;
      }


      // Other part of the DOM?
      if (!this._target.contains(target)) {
        return false;
      }


      // Has the child its own cursor?
      // FIXME: How can we tell that a sub element has an
      //        explicit "cursor: none;"?
      if (window.getComputedStyle(target).cursor !== 'none') {
        return false;
      }

      
return true;
    }
  }, {
    key: "_updateVisibility",
    value: function _updateVisibility(target) {
      // When the cursor target has capture we want to show the cursor.
      // So, if a capture is active - look at the captured element instead.
      if (this._captureIsActive()) {
        target = document.captureElement;
      }

      if (this._shouldShowCursor(target)) {
        this._showCursor();
      } else {
        this._hideCursor();
      }
    }
  }, {
    key: "_updatePosition",
    value: function _updatePosition() {
      this._canvas.style.left = this._position.x + "px";
      this._canvas.style.top = this._position.y + "px";
    }
  }, {
    key: "_captureIsActive",
    value: function _captureIsActive() {
      return document.captureElement && document.documentElement.contains(document.captureElement);
    }
  }]);
}();