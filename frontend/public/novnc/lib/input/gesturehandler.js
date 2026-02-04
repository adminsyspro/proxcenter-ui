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
 * Copyright (C) 2020 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 *
 */

var GH_NOGESTURE = 0;
var GH_ONETAP = 1;
var GH_TWOTAP = 2;
var GH_THREETAP = 4;
var GH_DRAG = 8;
var GH_LONGPRESS = 16;
var GH_TWODRAG = 32;
var GH_PINCH = 64;
var GH_INITSTATE = 127;
var GH_MOVE_THRESHOLD = 50;
var GH_ANGLE_THRESHOLD = 90; // Degrees

// Timeout when waiting for gestures (ms)
var GH_MULTITOUCH_TIMEOUT = 250;

// Maximum time between press and release for a tap (ms)
var GH_TAP_TIMEOUT = 1000;

// Timeout when waiting for longpress (ms)
var GH_LONGPRESS_TIMEOUT = 1000;

// Timeout when waiting to decide between PINCH and TWODRAG (ms)
var GH_TWOTOUCH_TIMEOUT = 50;
var GestureHandler = exports["default"] = /*#__PURE__*/function () {
  function GestureHandler() {
    _classCallCheck(this, GestureHandler);
    this._target = null;
    this._state = GH_INITSTATE;
    this._tracked = [];
    this._ignored = [];
    this._waitingRelease = false;
    this._releaseStart = 0.0;
    this._longpressTimeoutId = null;
    this._twoTouchTimeoutId = null;
    this._boundEventHandler = this._eventHandler.bind(this);
  }

  
return _createClass(GestureHandler, [{
    key: "attach",
    value: function attach(target) {
      this.detach();
      this._target = target;
      this._target.addEventListener('touchstart', this._boundEventHandler);
      this._target.addEventListener('touchmove', this._boundEventHandler);
      this._target.addEventListener('touchend', this._boundEventHandler);
      this._target.addEventListener('touchcancel', this._boundEventHandler);
    }
  }, {
    key: "detach",
    value: function detach() {
      if (!this._target) {
        return;
      }

      this._stopLongpressTimeout();
      this._stopTwoTouchTimeout();
      this._target.removeEventListener('touchstart', this._boundEventHandler);
      this._target.removeEventListener('touchmove', this._boundEventHandler);
      this._target.removeEventListener('touchend', this._boundEventHandler);
      this._target.removeEventListener('touchcancel', this._boundEventHandler);
      this._target = null;
    }
  }, {
    key: "_eventHandler",
    value: function _eventHandler(e) {
      var fn;

      e.stopPropagation();
      e.preventDefault();

      switch (e.type) {
        case 'touchstart':
          fn = this._touchStart;
          break;
        case 'touchmove':
          fn = this._touchMove;
          break;
        case 'touchend':
        case 'touchcancel':
          fn = this._touchEnd;
          break;
      }

      for (var i = 0; i < e.changedTouches.length; i++) {
        var touch = e.changedTouches[i];

        fn.call(this, touch.identifier, touch.clientX, touch.clientY);
      }
    }
  }, {
    key: "_touchStart",
    value: function _touchStart(id, x, y) {
      // Ignore any new touches if there is already an active gesture,
      // or we're in a cleanup state
      if (this._hasDetectedGesture() || this._state === GH_NOGESTURE) {
        this._ignored.push(id);
        
return;
      }

      // Did it take too long between touches that we should no longer
      // consider this a single gesture?
      if (this._tracked.length > 0 && Date.now() - this._tracked[0].started > GH_MULTITOUCH_TIMEOUT) {
        this._state = GH_NOGESTURE;
        this._ignored.push(id);
        
return;
      }

      // If we're waiting for fingers to release then we should no longer
      // recognize new touches
      if (this._waitingRelease) {
        this._state = GH_NOGESTURE;
        this._ignored.push(id);
        
return;
      }

      this._tracked.push({
        id: id,
        started: Date.now(),
        active: true,
        firstX: x,
        firstY: y,
        lastX: x,
        lastY: y,
        angle: 0
      });

      switch (this._tracked.length) {
        case 1:
          this._startLongpressTimeout();
          break;
        case 2:
          this._state &= ~(GH_ONETAP | GH_DRAG | GH_LONGPRESS);
          this._stopLongpressTimeout();
          break;
        case 3:
          this._state &= ~(GH_TWOTAP | GH_TWODRAG | GH_PINCH);
          break;
        default:
          this._state = GH_NOGESTURE;
      }
    }
  }, {
    key: "_touchMove",
    value: function _touchMove(id, x, y) {
      var touch = this._tracked.find(function (t) {
        return t.id === id;
      });

      // If this is an update for a touch we're not tracking, ignore it
      if (touch === undefined) {
        return;
      }

      // Update the touches last position with the event coordinates
      touch.lastX = x;
      touch.lastY = y;
      var deltaX = x - touch.firstX;
      var deltaY = y - touch.firstY;

      // Update angle when the touch has moved
      if (touch.firstX !== touch.lastX || touch.firstY !== touch.lastY) {
        touch.angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
      }

      if (!this._hasDetectedGesture()) {
        // Ignore moves smaller than the minimum threshold
        if (Math.hypot(deltaX, deltaY) < GH_MOVE_THRESHOLD) {
          return;
        }

        // Can't be a tap or long press as we've seen movement
        this._state &= ~(GH_ONETAP | GH_TWOTAP | GH_THREETAP | GH_LONGPRESS);
        this._stopLongpressTimeout();

        if (this._tracked.length !== 1) {
          this._state &= ~GH_DRAG;
        }

        if (this._tracked.length !== 2) {
          this._state &= ~(GH_TWODRAG | GH_PINCH);
        }

        // We need to figure out which of our different two touch gestures
        // this might be
        if (this._tracked.length === 2) {
          // The other touch is the one where the id doesn't match
          var prevTouch = this._tracked.find(function (t) {
            return t.id !== id;
          });

          // How far the previous touch point has moved since start
          var prevDeltaMove = Math.hypot(prevTouch.firstX - prevTouch.lastX, prevTouch.firstY - prevTouch.lastY);

          // We know that the current touch moved far enough,
          // but unless both touches moved further than their
          // threshold we don't want to disqualify any gestures
          if (prevDeltaMove > GH_MOVE_THRESHOLD) {
            // The angle difference between the direction of the touch points
            var deltaAngle = Math.abs(touch.angle - prevTouch.angle);

            deltaAngle = Math.abs((deltaAngle + 180) % 360 - 180);

            // PINCH or TWODRAG can be eliminated depending on the angle
            if (deltaAngle > GH_ANGLE_THRESHOLD) {
              this._state &= ~GH_TWODRAG;
            } else {
              this._state &= ~GH_PINCH;
            }

            if (this._isTwoTouchTimeoutRunning()) {
              this._stopTwoTouchTimeout();
            }
          } else if (!this._isTwoTouchTimeoutRunning()) {
            // We can't determine the gesture right now, let's
            // wait and see if more events are on their way
            this._startTwoTouchTimeout();
          }
        }

        if (!this._hasDetectedGesture()) {
          return;
        }

        this._pushEvent('gesturestart');
      }

      this._pushEvent('gesturemove');
    }
  }, {
    key: "_touchEnd",
    value: function _touchEnd(id, x, y) {
      // Check if this is an ignored touch
      if (this._ignored.indexOf(id) !== -1) {
        // Remove this touch from ignored
        this._ignored.splice(this._ignored.indexOf(id), 1);

        // And reset the state if there are no more touches
        if (this._ignored.length === 0 && this._tracked.length === 0) {
          this._state = GH_INITSTATE;
          this._waitingRelease = false;
        }

        
return;
      }

      // We got a touchend before the timer triggered,
      // this cannot result in a gesture anymore.
      if (!this._hasDetectedGesture() && this._isTwoTouchTimeoutRunning()) {
        this._stopTwoTouchTimeout();
        this._state = GH_NOGESTURE;
      }

      // Some gestures don't trigger until a touch is released
      if (!this._hasDetectedGesture()) {
        // Can't be a gesture that relies on movement
        this._state &= ~(GH_DRAG | GH_TWODRAG | GH_PINCH);

        // Or something that relies on more time
        this._state &= ~GH_LONGPRESS;
        this._stopLongpressTimeout();

        if (!this._waitingRelease) {
          this._releaseStart = Date.now();
          this._waitingRelease = true;

          // Can't be a tap that requires more touches than we current have
          switch (this._tracked.length) {
            case 1:
              this._state &= ~(GH_TWOTAP | GH_THREETAP);
              break;
            case 2:
              this._state &= ~(GH_ONETAP | GH_THREETAP);
              break;
          }
        }
      }

      // Waiting for all touches to release? (i.e. some tap)
      if (this._waitingRelease) {
        // Were all touches released at roughly the same time?
        if (Date.now() - this._releaseStart > GH_MULTITOUCH_TIMEOUT) {
          this._state = GH_NOGESTURE;
        }

        // Did too long time pass between press and release?
        if (this._tracked.some(function (t) {
          return Date.now() - t.started > GH_TAP_TIMEOUT;
        })) {
          this._state = GH_NOGESTURE;
        }

        var touch = this._tracked.find(function (t) {
          return t.id === id;
        });

        touch.active = false;

        // Are we still waiting for more releases?
        if (this._hasDetectedGesture()) {
          this._pushEvent('gesturestart');
        } else {
          // Have we reached a dead end?
          if (this._state !== GH_NOGESTURE) {
            return;
          }
        }
      }

      if (this._hasDetectedGesture()) {
        this._pushEvent('gestureend');
      }

      // Ignore any remaining touches until they are ended
      for (var i = 0; i < this._tracked.length; i++) {
        if (this._tracked[i].active) {
          this._ignored.push(this._tracked[i].id);
        }
      }

      this._tracked = [];
      this._state = GH_NOGESTURE;

      // Remove this touch from ignored if it's in there
      if (this._ignored.indexOf(id) !== -1) {
        this._ignored.splice(this._ignored.indexOf(id), 1);
      }

      // We reset the state if ignored is empty
      if (this._ignored.length === 0) {
        this._state = GH_INITSTATE;
        this._waitingRelease = false;
      }
    }
  }, {
    key: "_hasDetectedGesture",
    value: function _hasDetectedGesture() {
      if (this._state === GH_NOGESTURE) {
        return false;
      }


      // Check to see if the bitmask value is a power of 2
      // (i.e. only one bit set). If it is, we have a state.
      if (this._state & this._state - 1) {
        return false;
      }

      // For taps we also need to have all touches released
      // before we've fully detected the gesture
      if (this._state & (GH_ONETAP | GH_TWOTAP | GH_THREETAP)) {
        if (this._tracked.some(function (t) {
          return t.active;
        })) {
          return false;
        }
      }

      
return true;
    }
  }, {
    key: "_startLongpressTimeout",
    value: function _startLongpressTimeout() {
      var _this = this;

      this._stopLongpressTimeout();
      this._longpressTimeoutId = setTimeout(function () {
        return _this._longpressTimeout();
      }, GH_LONGPRESS_TIMEOUT);
    }
  }, {
    key: "_stopLongpressTimeout",
    value: function _stopLongpressTimeout() {
      clearTimeout(this._longpressTimeoutId);
      this._longpressTimeoutId = null;
    }
  }, {
    key: "_longpressTimeout",
    value: function _longpressTimeout() {
      if (this._hasDetectedGesture()) {
        throw new Error("A longpress gesture failed, conflict with a different gesture");
      }

      this._state = GH_LONGPRESS;
      this._pushEvent('gesturestart');
    }
  }, {
    key: "_startTwoTouchTimeout",
    value: function _startTwoTouchTimeout() {
      var _this2 = this;

      this._stopTwoTouchTimeout();
      this._twoTouchTimeoutId = setTimeout(function () {
        return _this2._twoTouchTimeout();
      }, GH_TWOTOUCH_TIMEOUT);
    }
  }, {
    key: "_stopTwoTouchTimeout",
    value: function _stopTwoTouchTimeout() {
      clearTimeout(this._twoTouchTimeoutId);
      this._twoTouchTimeoutId = null;
    }
  }, {
    key: "_isTwoTouchTimeoutRunning",
    value: function _isTwoTouchTimeoutRunning() {
      return this._twoTouchTimeoutId !== null;
    }
  }, {
    key: "_twoTouchTimeout",
    value: function _twoTouchTimeout() {
      if (this._tracked.length === 0) {
        throw new Error("A pinch or two drag gesture failed, no tracked touches");
      }

      // How far each touch point has moved since start
      var avgM = this._getAverageMovement();
      var avgMoveH = Math.abs(avgM.x);
      var avgMoveV = Math.abs(avgM.y);

      // The difference in the distance between where
      // the touch points started and where they are now
      var avgD = this._getAverageDistance();
      var deltaTouchDistance = Math.abs(Math.hypot(avgD.first.x, avgD.first.y) - Math.hypot(avgD.last.x, avgD.last.y));

      if (avgMoveV < deltaTouchDistance && avgMoveH < deltaTouchDistance) {
        this._state = GH_PINCH;
      } else {
        this._state = GH_TWODRAG;
      }

      this._pushEvent('gesturestart');
      this._pushEvent('gesturemove');
    }
  }, {
    key: "_pushEvent",
    value: function _pushEvent(type) {
      var detail = {
        type: this._stateToGesture(this._state)
      };

      // For most gesture events the current (average) position is the
      // most useful
      var avg = this._getPosition();
      var pos = avg.last;

      // However we have a slight distance to detect gestures, so for the
      // first gesture event we want to use the first positions we saw
      if (type === 'gesturestart') {
        pos = avg.first;
      }

      // For these gestures, we always want the event coordinates
      // to be where the gesture began, not the current touch location.
      switch (this._state) {
        case GH_TWODRAG:
        case GH_PINCH:
          pos = avg.first;
          break;
      }

      detail['clientX'] = pos.x;
      detail['clientY'] = pos.y;

      // FIXME: other coordinates?

      // Some gestures also have a magnitude
      if (this._state === GH_PINCH) {
        var distance = this._getAverageDistance();

        if (type === 'gesturestart') {
          detail['magnitudeX'] = distance.first.x;
          detail['magnitudeY'] = distance.first.y;
        } else {
          detail['magnitudeX'] = distance.last.x;
          detail['magnitudeY'] = distance.last.y;
        }
      } else if (this._state === GH_TWODRAG) {
        if (type === 'gesturestart') {
          detail['magnitudeX'] = 0.0;
          detail['magnitudeY'] = 0.0;
        } else {
          var movement = this._getAverageMovement();

          detail['magnitudeX'] = movement.x;
          detail['magnitudeY'] = movement.y;
        }
      }

      var gev = new CustomEvent(type, {
        detail: detail
      });

      this._target.dispatchEvent(gev);
    }
  }, {
    key: "_stateToGesture",
    value: function _stateToGesture(state) {
      switch (state) {
        case GH_ONETAP:
          return 'onetap';
        case GH_TWOTAP:
          return 'twotap';
        case GH_THREETAP:
          return 'threetap';
        case GH_DRAG:
          return 'drag';
        case GH_LONGPRESS:
          return 'longpress';
        case GH_TWODRAG:
          return 'twodrag';
        case GH_PINCH:
          return 'pinch';
      }

      throw new Error("Unknown gesture state: " + state);
    }
  }, {
    key: "_getPosition",
    value: function _getPosition() {
      if (this._tracked.length === 0) {
        throw new Error("Failed to get gesture position, no tracked touches");
      }

      var size = this._tracked.length;
      var fx = 0,
        fy = 0,
        lx = 0,
        ly = 0;

      for (var i = 0; i < this._tracked.length; i++) {
        fx += this._tracked[i].firstX;
        fy += this._tracked[i].firstY;
        lx += this._tracked[i].lastX;
        ly += this._tracked[i].lastY;
      }

      
return {
        first: {
          x: fx / size,
          y: fy / size
        },
        last: {
          x: lx / size,
          y: ly / size
        }
      };
    }
  }, {
    key: "_getAverageMovement",
    value: function _getAverageMovement() {
      if (this._tracked.length === 0) {
        throw new Error("Failed to get gesture movement, no tracked touches");
      }

      var totalH, totalV;

      totalH = totalV = 0;
      var size = this._tracked.length;

      for (var i = 0; i < this._tracked.length; i++) {
        totalH += this._tracked[i].lastX - this._tracked[i].firstX;
        totalV += this._tracked[i].lastY - this._tracked[i].firstY;
      }

      
return {
        x: totalH / size,
        y: totalV / size
      };
    }
  }, {
    key: "_getAverageDistance",
    value: function _getAverageDistance() {
      if (this._tracked.length === 0) {
        throw new Error("Failed to get gesture distance, no tracked touches");
      }

      // Distance between the first and last tracked touches

      var first = this._tracked[0];
      var last = this._tracked[this._tracked.length - 1];
      var fdx = Math.abs(last.firstX - first.firstX);
      var fdy = Math.abs(last.firstY - first.firstY);
      var ldx = Math.abs(last.lastX - first.lastX);
      var ldy = Math.abs(last.lastY - first.lastY);

      
return {
        first: {
          x: fdx,
          y: fdy
        },
        last: {
          x: ldx,
          y: ldy
        }
      };
    }
  }]);
}();