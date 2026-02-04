"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports["default"] = void 0;
var Log = _interopRequireWildcard(require("./util/logging.js"));
var _base = _interopRequireDefault(require("./base64.js"));
var _int = require("./util/int.js");

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
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

var Display = exports["default"] = /*#__PURE__*/function () {
  function Display(target) {
    _classCallCheck(this, Display);
    this._drawCtx = null;
    this._renderQ = []; // queue drawing actions for in-oder rendering
    this._flushPromise = null;

    // the full frame buffer (logical canvas) size
    this._fbWidth = 0;
    this._fbHeight = 0;
    this._prevDrawStyle = "";
    Log.Debug(">> Display.constructor");

    // The visible canvas
    this._target = target;

    if (!this._target) {
      throw new Error("Target must be set");
    }

    if (typeof this._target === 'string') {
      throw new Error('target must be a DOM element');
    }

    if (!this._target.getContext) {
      throw new Error("no getContext method");
    }

    this._targetCtx = this._target.getContext('2d');

    // the visible canvas viewport (i.e. what actually gets seen)
    this._viewportLoc = {
      'x': 0,
      'y': 0,
      'w': this._target.width,
      'h': this._target.height
    };

    // The hidden canvas, where we do the actual rendering
    this._backbuffer = document.createElement('canvas');
    this._drawCtx = this._backbuffer.getContext('2d');
    this._damageBounds = {
      left: 0,
      top: 0,
      right: this._backbuffer.width,
      bottom: this._backbuffer.height
    };
    Log.Debug("User Agent: " + navigator.userAgent);
    Log.Debug("<< Display.constructor");

    // ===== PROPERTIES =====

    this._scale = 1.0;
    this._clipViewport = false;
  }

  // ===== PROPERTIES =====
  return _createClass(Display, [{
    key: "scale",
    get: function get() {
      return this._scale;
    },
    set: function set(scale) {
      this._rescale(scale);
    }
  }, {
    key: "clipViewport",
    get: function get() {
      return this._clipViewport;
    },
    set: function set(viewport) {
      this._clipViewport = viewport;

      // May need to readjust the viewport dimensions
      var vp = this._viewportLoc;

      this.viewportChangeSize(vp.w, vp.h);
      this.viewportChangePos(0, 0);
    }
  }, {
    key: "width",
    get: function get() {
      return this._fbWidth;
    }
  }, {
    key: "height",
    get: function get() {
      return this._fbHeight;
    }

    // ===== PUBLIC METHODS =====
  }, {
    key: "viewportChangePos",
    value: function viewportChangePos(deltaX, deltaY) {
      var vp = this._viewportLoc;

      deltaX = Math.floor(deltaX);
      deltaY = Math.floor(deltaY);

      if (!this._clipViewport) {
        deltaX = -vp.w; // clamped later of out of bounds
        deltaY = -vp.h;
      }

      var vx2 = vp.x + vp.w - 1;
      var vy2 = vp.y + vp.h - 1;

      // Position change

      if (deltaX < 0 && vp.x + deltaX < 0) {
        deltaX = -vp.x;
      }

      if (vx2 + deltaX >= this._fbWidth) {
        deltaX -= vx2 + deltaX - this._fbWidth + 1;
      }

      if (vp.y + deltaY < 0) {
        deltaY = -vp.y;
      }

      if (vy2 + deltaY >= this._fbHeight) {
        deltaY -= vy2 + deltaY - this._fbHeight + 1;
      }

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      Log.Debug("viewportChange deltaX: " + deltaX + ", deltaY: " + deltaY);
      vp.x += deltaX;
      vp.y += deltaY;
      this._damage(vp.x, vp.y, vp.w, vp.h);
      this.flip();
    }
  }, {
    key: "viewportChangeSize",
    value: function viewportChangeSize(width, height) {
      if (!this._clipViewport || typeof width === "undefined" || typeof height === "undefined") {
        Log.Debug("Setting viewport to full display region");
        width = this._fbWidth;
        height = this._fbHeight;
      }

      width = Math.floor(width);
      height = Math.floor(height);

      if (width > this._fbWidth) {
        width = this._fbWidth;
      }

      if (height > this._fbHeight) {
        height = this._fbHeight;
      }

      var vp = this._viewportLoc;

      if (vp.w !== width || vp.h !== height) {
        vp.w = width;
        vp.h = height;
        var canvas = this._target;

        canvas.width = width;
        canvas.height = height;

        // The position might need to be updated if we've grown
        this.viewportChangePos(0, 0);
        this._damage(vp.x, vp.y, vp.w, vp.h);
        this.flip();

        // Update the visible size of the target canvas
        this._rescale(this._scale);
      }
    }
  }, {
    key: "absX",
    value: function absX(x) {
      if (this._scale === 0) {
        return 0;
      }

      
return (0, _int.toSigned32bit)(x / this._scale + this._viewportLoc.x);
    }
  }, {
    key: "absY",
    value: function absY(y) {
      if (this._scale === 0) {
        return 0;
      }

      
return (0, _int.toSigned32bit)(y / this._scale + this._viewportLoc.y);
    }
  }, {
    key: "resize",
    value: function resize(width, height) {
      this._prevDrawStyle = "";
      this._fbWidth = width;
      this._fbHeight = height;
      var canvas = this._backbuffer;

      if (canvas.width !== width || canvas.height !== height) {
        // We have to save the canvas data since changing the size will clear it
        var saveImg = null;

        if (canvas.width > 0 && canvas.height > 0) {
          saveImg = this._drawCtx.getImageData(0, 0, canvas.width, canvas.height);
        }

        if (canvas.width !== width) {
          canvas.width = width;
        }

        if (canvas.height !== height) {
          canvas.height = height;
        }

        if (saveImg) {
          this._drawCtx.putImageData(saveImg, 0, 0);
        }
      }

      // Readjust the viewport as it may be incorrectly sized
      // and positioned
      var vp = this._viewportLoc;

      this.viewportChangeSize(vp.w, vp.h);
      this.viewportChangePos(0, 0);
    }
  }, {
    key: "getImageData",
    value: function getImageData() {
      return this._drawCtx.getImageData(0, 0, this.width, this.height);
    }
  }, {
    key: "toDataURL",
    value: function toDataURL(type, encoderOptions) {
      return this._backbuffer.toDataURL(type, encoderOptions);
    }
  }, {
    key: "toBlob",
    value: function toBlob(callback, type, quality) {
      return this._backbuffer.toBlob(callback, type, quality);
    }

    // Track what parts of the visible canvas that need updating
  }, {
    key: "_damage",
    value: function _damage(x, y, w, h) {
      if (x < this._damageBounds.left) {
        this._damageBounds.left = x;
      }

      if (y < this._damageBounds.top) {
        this._damageBounds.top = y;
      }

      if (x + w > this._damageBounds.right) {
        this._damageBounds.right = x + w;
      }

      if (y + h > this._damageBounds.bottom) {
        this._damageBounds.bottom = y + h;
      }
    }

    // Update the visible canvas with the contents of the
    // rendering canvas
  }, {
    key: "flip",
    value: function flip(fromQueue) {
      if (this._renderQ.length !== 0 && !fromQueue) {
        this._renderQPush({
          'type': 'flip'
        });
      } else {
        var x = this._damageBounds.left;
        var y = this._damageBounds.top;
        var w = this._damageBounds.right - x;
        var h = this._damageBounds.bottom - y;
        var vx = x - this._viewportLoc.x;
        var vy = y - this._viewportLoc.y;

        if (vx < 0) {
          w += vx;
          x -= vx;
          vx = 0;
        }

        if (vy < 0) {
          h += vy;
          y -= vy;
          vy = 0;
        }

        if (vx + w > this._viewportLoc.w) {
          w = this._viewportLoc.w - vx;
        }

        if (vy + h > this._viewportLoc.h) {
          h = this._viewportLoc.h - vy;
        }

        if (w > 0 && h > 0) {
          // FIXME: We may need to disable image smoothing here
          //        as well (see copyImage()), but we haven't
          //        noticed any problem yet.
          this._targetCtx.drawImage(this._backbuffer, x, y, w, h, vx, vy, w, h);
        }

        this._damageBounds.left = this._damageBounds.top = 65535;
        this._damageBounds.right = this._damageBounds.bottom = 0;
      }
    }
  }, {
    key: "pending",
    value: function pending() {
      return this._renderQ.length > 0;
    }
  }, {
    key: "flush",
    value: function flush() {
      var _this = this;

      if (this._renderQ.length === 0) {
        return Promise.resolve();
      } else {
        if (this._flushPromise === null) {
          this._flushPromise = new Promise(function (resolve) {
            _this._flushResolve = resolve;
          });
        }

        
return this._flushPromise;
      }
    }
  }, {
    key: "fillRect",
    value: function fillRect(x, y, width, height, color, fromQueue) {
      if (this._renderQ.length !== 0 && !fromQueue) {
        this._renderQPush({
          'type': 'fill',
          'x': x,
          'y': y,
          'width': width,
          'height': height,
          'color': color
        });
      } else {
        this._setFillColor(color);
        this._drawCtx.fillRect(x, y, width, height);
        this._damage(x, y, width, height);
      }
    }
  }, {
    key: "copyImage",
    value: function copyImage(oldX, oldY, newX, newY, w, h, fromQueue) {
      if (this._renderQ.length !== 0 && !fromQueue) {
        this._renderQPush({
          'type': 'copy',
          'oldX': oldX,
          'oldY': oldY,
          'x': newX,
          'y': newY,
          'width': w,
          'height': h
        });
      } else {
        // Due to this bug among others [1] we need to disable the image-smoothing to
        // avoid getting a blur effect when copying data.
        //
        // 1. https://bugzilla.mozilla.org/show_bug.cgi?id=1194719
        //
        // We need to set these every time since all properties are reset
        // when the the size is changed
        this._drawCtx.mozImageSmoothingEnabled = false;
        this._drawCtx.webkitImageSmoothingEnabled = false;
        this._drawCtx.msImageSmoothingEnabled = false;
        this._drawCtx.imageSmoothingEnabled = false;
        this._drawCtx.drawImage(this._backbuffer, oldX, oldY, w, h, newX, newY, w, h);
        this._damage(newX, newY, w, h);
      }
    }
  }, {
    key: "imageRect",
    value: function imageRect(x, y, width, height, mime, arr) {
      /* The internal logic cannot handle empty images, so bail early */
      if (width === 0 || height === 0) {
        return;
      }

      var img = new Image();

      img.src = "data: " + mime + ";base64," + _base["default"].encode(arr);
      this._renderQPush({
        'type': 'img',
        'img': img,
        'x': x,
        'y': y,
        'width': width,
        'height': height
      });
    }
  }, {
    key: "videoFrame",
    value: function videoFrame(x, y, width, height, frame) {
      this._renderQPush({
        'type': 'frame',
        'frame': frame,
        'x': x,
        'y': y,
        'width': width,
        'height': height
      });
    }
  }, {
    key: "blitImage",
    value: function blitImage(x, y, width, height, arr, offset, fromQueue) {
      if (this._renderQ.length !== 0 && !fromQueue) {
        // NB(directxman12): it's technically more performant here to use preallocated arrays,
        // but it's a lot of extra work for not a lot of payoff -- if we're using the render queue,
        // this probably isn't getting called *nearly* as much
        var newArr = new Uint8Array(width * height * 4);

        newArr.set(new Uint8Array(arr.buffer, 0, newArr.length));
        this._renderQPush({
          'type': 'blit',
          'data': newArr,
          'x': x,
          'y': y,
          'width': width,
          'height': height
        });
      } else {
        // NB(directxman12): arr must be an Type Array view
        var data = new Uint8ClampedArray(arr.buffer, arr.byteOffset + offset, width * height * 4);
        var img = new ImageData(data, width, height);

        this._drawCtx.putImageData(img, x, y);
        this._damage(x, y, width, height);
      }
    }
  }, {
    key: "drawImage",
    value: function drawImage(img) {
      var _this$_drawCtx;

      for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
        args[_key - 1] = arguments[_key];
      }

      (_this$_drawCtx = this._drawCtx).drawImage.apply(_this$_drawCtx, [img].concat(args));

      if (args.length <= 4) {
        var x = args[0],
          y = args[1];

        this._damage(x, y, img.width, img.height);
      } else {
        var sw = args[2],
          sh = args[3],
          dx = args[4],
          dy = args[5];

        this._damage(dx, dy, sw, sh);
      }
    }
  }, {
    key: "autoscale",
    value: function autoscale(containerWidth, containerHeight) {
      var scaleRatio;

      if (containerWidth === 0 || containerHeight === 0) {
        scaleRatio = 0;
      } else {
        var vp = this._viewportLoc;
        var targetAspectRatio = containerWidth / containerHeight;
        var fbAspectRatio = vp.w / vp.h;

        if (fbAspectRatio >= targetAspectRatio) {
          scaleRatio = containerWidth / vp.w;
        } else {
          scaleRatio = containerHeight / vp.h;
        }
      }

      this._rescale(scaleRatio);
    }

    // ===== PRIVATE METHODS =====
  }, {
    key: "_rescale",
    value: function _rescale(factor) {
      this._scale = factor;
      var vp = this._viewportLoc;

      // NB(directxman12): If you set the width directly, or set the
      //                   style width to a number, the canvas is cleared.
      //                   However, if you set the style width to a string
      //                   ('NNNpx'), the canvas is scaled without clearing.
      var width = factor * vp.w + 'px';
      var height = factor * vp.h + 'px';

      if (this._target.style.width !== width || this._target.style.height !== height) {
        this._target.style.width = width;
        this._target.style.height = height;
      }
    }
  }, {
    key: "_setFillColor",
    value: function _setFillColor(color) {
      var newStyle = 'rgb(' + color[0] + ',' + color[1] + ',' + color[2] + ')';

      if (newStyle !== this._prevDrawStyle) {
        this._drawCtx.fillStyle = newStyle;
        this._prevDrawStyle = newStyle;
      }
    }
  }, {
    key: "_renderQPush",
    value: function _renderQPush(action) {
      this._renderQ.push(action);

      if (this._renderQ.length === 1) {
        // If this can be rendered immediately it will be, otherwise
        // the scanner will wait for the relevant event
        this._scanRenderQ();
      }
    }
  }, {
    key: "_resumeRenderQ",
    value: function _resumeRenderQ() {
      // "this" is the object that is ready, not the
      // display object
      this.removeEventListener('load', this._noVNCDisplay._resumeRenderQ);
      this._noVNCDisplay._scanRenderQ();
    }
  }, {
    key: "_scanRenderQ",
    value: function _scanRenderQ() {
      var _this2 = this;
      var ready = true;
      var _loop = function _loop() {
          var a = _this2._renderQ[0];

          switch (a.type) {
            case 'flip':
              _this2.flip(true);
              break;
            case 'copy':
              _this2.copyImage(a.oldX, a.oldY, a.x, a.y, a.width, a.height, true);
              break;
            case 'fill':
              _this2.fillRect(a.x, a.y, a.width, a.height, a.color, true);
              break;
            case 'blit':
              _this2.blitImage(a.x, a.y, a.width, a.height, a.data, 0, true);
              break;
            case 'img':
              if (a.img.complete) {
                if (a.img.width !== a.width || a.img.height !== a.height) {
                  Log.Error("Decoded image has incorrect dimensions. Got " + a.img.width + "x" + a.img.height + ". Expected " + a.width + "x" + a.height + ".");
                  
return {
                    v: void 0
                  };
                }

                _this2.drawImage(a.img, a.x, a.y);
              } else {
                a.img._noVNCDisplay = _this2;
                a.img.addEventListener('load', _this2._resumeRenderQ);

                // We need to wait for this image to 'load'
                // to keep things in-order
                ready = false;
              }

              break;
            case 'frame':
              if (a.frame.ready) {
                // The encoded frame may be larger than the rect due to
                // limitations of the encoder, so we need to crop the
                // frame.
                var frame = a.frame.frame;

                if (frame.codedWidth < a.width || frame.codedHeight < a.height) {
                  Log.Warn("Decoded video frame does not cover its full rectangle area. Expecting at least " + a.width + "x" + a.height + " but got " + frame.codedWidth + "x" + frame.codedHeight);
                }

                var sx = 0;
                var sy = 0;
                var sw = a.width;
                var sh = a.height;
                var dx = a.x;
                var dy = a.y;
                var dw = sw;
                var dh = sh;

                _this2.drawImage(frame, sx, sy, sw, sh, dx, dy, dw, dh);
                frame.close();
              } else {
                var display = _this2;

                a.frame.promise.then(function () {
                  display._scanRenderQ();
                });
                ready = false;
              }

              break;
          }

          if (ready) {
            _this2._renderQ.shift();
          }
        },
        _ret;

      while (ready && this._renderQ.length > 0) {
        _ret = _loop();
        if (_ret) return _ret.v;
      }

      if (this._renderQ.length === 0 && this._flushPromise !== null) {
        this._flushResolve();
        this._flushPromise = null;
        this._flushResolve = null;
      }
    }
  }]);
}();