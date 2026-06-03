"use strict";
var SpiceHtml5 = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // vendor/spice-html5/main.js
  var main_exports = {};
  __export(main_exports, {
    SpiceMainConn: () => SpiceMainConn,
    handle_file_dragover: () => handle_file_dragover,
    handle_file_drop: () => handle_file_drop,
    handle_resize: () => handle_resize,
    resize_helper: () => resize_helper,
    sendCtrlAltDel: () => sendCtrlAltDel
  });

  // vendor/spice-html5/enums.js
  var Constants = {
    SPICE_MAGIC: "REDQ",
    SPICE_VERSION_MAJOR: 2,
    SPICE_VERSION_MINOR: 2,
    SPICE_CONNECT_TIMEOUT: 30 * 1e3,
    SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION: 0,
    SPICE_COMMON_CAP_AUTH_SPICE: 1,
    SPICE_COMMON_CAP_AUTH_SASL: 2,
    SPICE_COMMON_CAP_MINI_HEADER: 3,
    SPICE_TICKET_KEY_PAIR_LENGTH: 1024,
    SPICE_TICKET_PUBKEY_BYTES: 1024 / 8 + 34,
    // (SPICE_TICKET_KEY_PAIR_LENGTH / 8 + 34)
    SPICE_LINK_ERR_OK: 0,
    SPICE_LINK_ERR_ERROR: 1,
    SPICE_LINK_ERR_INVALID_MAGIC: 2,
    SPICE_LINK_ERR_INVALID_DATA: 3,
    SPICE_LINK_ERR_VERSION_MISMATCH: 4,
    SPICE_LINK_ERR_NEED_SECURED: 5,
    SPICE_LINK_ERR_NEED_UNSECURED: 6,
    SPICE_LINK_ERR_PERMISSION_DENIED: 7,
    SPICE_LINK_ERR_BAD_CONNECTION_ID: 8,
    SPICE_LINK_ERR_CHANNEL_NOT_AVAILABLE: 9,
    SPICE_MSG_MIGRATE: 1,
    SPICE_MSG_MIGRATE_DATA: 2,
    SPICE_MSG_SET_ACK: 3,
    SPICE_MSG_PING: 4,
    SPICE_MSG_WAIT_FOR_CHANNELS: 5,
    SPICE_MSG_DISCONNECTING: 6,
    SPICE_MSG_NOTIFY: 7,
    SPICE_MSG_LIST: 8,
    SPICE_MSG_MAIN_MIGRATE_BEGIN: 101,
    SPICE_MSG_MAIN_MIGRATE_CANCEL: 102,
    SPICE_MSG_MAIN_INIT: 103,
    SPICE_MSG_MAIN_CHANNELS_LIST: 104,
    SPICE_MSG_MAIN_MOUSE_MODE: 105,
    SPICE_MSG_MAIN_MULTI_MEDIA_TIME: 106,
    SPICE_MSG_MAIN_AGENT_CONNECTED: 107,
    SPICE_MSG_MAIN_AGENT_DISCONNECTED: 108,
    SPICE_MSG_MAIN_AGENT_DATA: 109,
    SPICE_MSG_MAIN_AGENT_TOKEN: 110,
    SPICE_MSG_MAIN_MIGRATE_SWITCH_HOST: 111,
    SPICE_MSG_MAIN_MIGRATE_END: 112,
    SPICE_MSG_MAIN_NAME: 113,
    SPICE_MSG_MAIN_UUID: 114,
    SPICE_MSG_MAIN_AGENT_CONNECTED_TOKENS: 115,
    SPICE_MSG_MAIN_MIGRATE_BEGIN_SEAMLESS: 116,
    SPICE_MSG_MAIN_MIGRATE_DST_SEAMLESS_ACK: 117,
    SPICE_MSG_MAIN_MIGRATE_DST_SEAMLESS_NACK: 118,
    SPICE_MSG_END_MAIN: 119,
    SPICE_MSGC_ACK_SYNC: 1,
    SPICE_MSGC_ACK: 2,
    SPICE_MSGC_PONG: 3,
    SPICE_MSGC_MIGRATE_FLUSH_MARK: 4,
    SPICE_MSGC_MIGRATE_DATA: 5,
    SPICE_MSGC_DISCONNECTING: 6,
    SPICE_MSGC_MAIN_CLIENT_INFO: 101,
    SPICE_MSGC_MAIN_MIGRATE_CONNECTED: 102,
    SPICE_MSGC_MAIN_MIGRATE_CONNECT_ERROR: 103,
    SPICE_MSGC_MAIN_ATTACH_CHANNELS: 104,
    SPICE_MSGC_MAIN_MOUSE_MODE_REQUEST: 105,
    SPICE_MSGC_MAIN_AGENT_START: 106,
    SPICE_MSGC_MAIN_AGENT_DATA: 107,
    SPICE_MSGC_MAIN_AGENT_TOKEN: 108,
    SPICE_MSGC_MAIN_MIGRATE_END: 109,
    SPICE_MSGC_END_MAIN: 110,
    SPICE_MSG_DISPLAY_MODE: 101,
    SPICE_MSG_DISPLAY_MARK: 102,
    SPICE_MSG_DISPLAY_RESET: 103,
    SPICE_MSG_DISPLAY_COPY_BITS: 104,
    SPICE_MSG_DISPLAY_INVAL_LIST: 105,
    SPICE_MSG_DISPLAY_INVAL_ALL_PIXMAPS: 106,
    SPICE_MSG_DISPLAY_INVAL_PALETTE: 107,
    SPICE_MSG_DISPLAY_INVAL_ALL_PALETTES: 108,
    SPICE_MSG_DISPLAY_STREAM_CREATE: 122,
    SPICE_MSG_DISPLAY_STREAM_DATA: 123,
    SPICE_MSG_DISPLAY_STREAM_CLIP: 124,
    SPICE_MSG_DISPLAY_STREAM_DESTROY: 125,
    SPICE_MSG_DISPLAY_STREAM_DESTROY_ALL: 126,
    SPICE_MSG_DISPLAY_DRAW_FILL: 302,
    SPICE_MSG_DISPLAY_DRAW_OPAQUE: 303,
    SPICE_MSG_DISPLAY_DRAW_COPY: 304,
    SPICE_MSG_DISPLAY_DRAW_BLEND: 305,
    SPICE_MSG_DISPLAY_DRAW_BLACKNESS: 306,
    SPICE_MSG_DISPLAY_DRAW_WHITENESS: 307,
    SPICE_MSG_DISPLAY_DRAW_INVERS: 308,
    SPICE_MSG_DISPLAY_DRAW_ROP3: 309,
    SPICE_MSG_DISPLAY_DRAW_STROKE: 310,
    SPICE_MSG_DISPLAY_DRAW_TEXT: 311,
    SPICE_MSG_DISPLAY_DRAW_TRANSPARENT: 312,
    SPICE_MSG_DISPLAY_DRAW_ALPHA_BLEND: 313,
    SPICE_MSG_DISPLAY_SURFACE_CREATE: 314,
    SPICE_MSG_DISPLAY_SURFACE_DESTROY: 315,
    SPICE_MSG_DISPLAY_STREAM_DATA_SIZED: 316,
    SPICE_MSG_DISPLAY_MONITORS_CONFIG: 317,
    SPICE_MSG_DISPLAY_DRAW_COMPOSITE: 318,
    SPICE_MSG_DISPLAY_STREAM_ACTIVATE_REPORT: 319,
    SPICE_MSGC_DISPLAY_INIT: 101,
    SPICE_MSGC_DISPLAY_STREAM_REPORT: 102,
    SPICE_MSG_INPUTS_INIT: 101,
    SPICE_MSG_INPUTS_KEY_MODIFIERS: 102,
    SPICE_MSG_INPUTS_MOUSE_MOTION_ACK: 111,
    SPICE_MSGC_INPUTS_KEY_DOWN: 101,
    SPICE_MSGC_INPUTS_KEY_UP: 102,
    SPICE_MSGC_INPUTS_KEY_MODIFIERS: 103,
    SPICE_MSGC_INPUTS_MOUSE_MOTION: 111,
    SPICE_MSGC_INPUTS_MOUSE_POSITION: 112,
    SPICE_MSGC_INPUTS_MOUSE_PRESS: 113,
    SPICE_MSGC_INPUTS_MOUSE_RELEASE: 114,
    SPICE_MSG_CURSOR_INIT: 101,
    SPICE_MSG_CURSOR_RESET: 102,
    SPICE_MSG_CURSOR_SET: 103,
    SPICE_MSG_CURSOR_MOVE: 104,
    SPICE_MSG_CURSOR_HIDE: 105,
    SPICE_MSG_CURSOR_TRAIL: 106,
    SPICE_MSG_CURSOR_INVAL_ONE: 107,
    SPICE_MSG_CURSOR_INVAL_ALL: 108,
    SPICE_MSG_PLAYBACK_DATA: 101,
    SPICE_MSG_PLAYBACK_MODE: 102,
    SPICE_MSG_PLAYBACK_START: 103,
    SPICE_MSG_PLAYBACK_STOP: 104,
    SPICE_MSG_PLAYBACK_VOLUME: 105,
    SPICE_MSG_PLAYBACK_MUTE: 106,
    SPICE_MSG_PLAYBACK_LATENCY: 107,
    SPICE_MSG_SPICEVMC_DATA: 101,
    SPICE_MSG_PORT_INIT: 201,
    SPICE_MSG_PORT_EVENT: 202,
    SPICE_MSG_END_PORT: 203,
    SPICE_MSGC_SPICEVMC_DATA: 101,
    SPICE_MSGC_PORT_EVENT: 201,
    SPICE_MSGC_END_PORT: 202,
    SPICE_PLAYBACK_CAP_CELT_0_5_1: 0,
    SPICE_PLAYBACK_CAP_VOLUME: 1,
    SPICE_PLAYBACK_CAP_LATENCY: 2,
    SPICE_PLAYBACK_CAP_OPUS: 3,
    SPICE_MAIN_CAP_SEMI_SEAMLESS_MIGRATE: 0,
    SPICE_MAIN_CAP_NAME_AND_UUID: 1,
    SPICE_MAIN_CAP_AGENT_CONNECTED_TOKENS: 2,
    SPICE_MAIN_CAP_SEAMLESS_MIGRATE: 3,
    SPICE_DISPLAY_CAP_SIZED_STREAM: 0,
    SPICE_DISPLAY_CAP_MONITORS_CONFIG: 1,
    SPICE_DISPLAY_CAP_COMPOSITE: 2,
    SPICE_DISPLAY_CAP_A8_SURFACE: 3,
    SPICE_DISPLAY_CAP_STREAM_REPORT: 4,
    SPICE_DISPLAY_CAP_LZ4_COMPRESSION: 5,
    SPICE_DISPLAY_CAP_PREF_COMPRESSION: 6,
    SPICE_DISPLAY_CAP_GL_SCANOUT: 7,
    SPICE_DISPLAY_CAP_MULTI_CODEC: 8,
    SPICE_DISPLAY_CAP_CODEC_MJPEG: 9,
    SPICE_DISPLAY_CAP_CODEC_VP8: 10,
    SPICE_AUDIO_DATA_MODE_INVALID: 0,
    SPICE_AUDIO_DATA_MODE_RAW: 1,
    SPICE_AUDIO_DATA_MODE_CELT_0_5_1: 2,
    SPICE_AUDIO_DATA_MODE_OPUS: 3,
    SPICE_AUDIO_FMT_INVALID: 0,
    SPICE_AUDIO_FMT_S16: 1,
    SPICE_CHANNEL_MAIN: 1,
    SPICE_CHANNEL_DISPLAY: 2,
    SPICE_CHANNEL_INPUTS: 3,
    SPICE_CHANNEL_CURSOR: 4,
    SPICE_CHANNEL_PLAYBACK: 5,
    SPICE_CHANNEL_RECORD: 6,
    SPICE_CHANNEL_TUNNEL: 7,
    SPICE_CHANNEL_SMARTCARD: 8,
    SPICE_CHANNEL_USBREDIR: 9,
    SPICE_CHANNEL_PORT: 10,
    SPICE_CHANNEL_WEBDAV: 11,
    SPICE_SURFACE_FLAGS_PRIMARY: 1 << 0,
    SPICE_NOTIFY_SEVERITY_INFO: 0,
    SPICE_NOTIFY_SEVERITY_WARN: 1,
    SPICE_NOTIFY_SEVERITY_ERROR: 2,
    SPICE_MOUSE_MODE_SERVER: 1 << 0,
    SPICE_MOUSE_MODE_CLIENT: 1 << 1,
    SPICE_MOUSE_MODE_MASK: 3,
    SPICE_CLIP_TYPE_NONE: 0,
    SPICE_CLIP_TYPE_RECTS: 1,
    SPICE_IMAGE_TYPE_BITMAP: 0,
    SPICE_IMAGE_TYPE_QUIC: 1,
    SPICE_IMAGE_TYPE_RESERVED: 2,
    SPICE_IMAGE_TYPE_LZ_PLT: 100,
    SPICE_IMAGE_TYPE_LZ_RGB: 101,
    SPICE_IMAGE_TYPE_GLZ_RGB: 102,
    SPICE_IMAGE_TYPE_FROM_CACHE: 103,
    SPICE_IMAGE_TYPE_SURFACE: 104,
    SPICE_IMAGE_TYPE_JPEG: 105,
    SPICE_IMAGE_TYPE_FROM_CACHE_LOSSLESS: 106,
    SPICE_IMAGE_TYPE_ZLIB_GLZ_RGB: 107,
    SPICE_IMAGE_TYPE_JPEG_ALPHA: 108,
    SPICE_IMAGE_FLAGS_CACHE_ME: 1 << 0,
    SPICE_IMAGE_FLAGS_HIGH_BITS_SET: 1 << 1,
    SPICE_IMAGE_FLAGS_CACHE_REPLACE_ME: 1 << 2,
    SPICE_BITMAP_FLAGS_PAL_CACHE_ME: 1 << 0,
    SPICE_BITMAP_FLAGS_PAL_FROM_CACHE: 1 << 1,
    SPICE_BITMAP_FLAGS_TOP_DOWN: 1 << 2,
    SPICE_BITMAP_FLAGS_MASK: 7,
    SPICE_BITMAP_FMT_INVALID: 0,
    SPICE_BITMAP_FMT_1BIT_LE: 1,
    SPICE_BITMAP_FMT_1BIT_BE: 2,
    SPICE_BITMAP_FMT_4BIT_LE: 3,
    SPICE_BITMAP_FMT_4BIT_BE: 4,
    SPICE_BITMAP_FMT_8BIT: 5,
    SPICE_BITMAP_FMT_16BIT: 6,
    SPICE_BITMAP_FMT_24BIT: 7,
    SPICE_BITMAP_FMT_32BIT: 8,
    SPICE_BITMAP_FMT_RGBA: 9,
    SPICE_CURSOR_FLAGS_NONE: 1 << 0,
    SPICE_CURSOR_FLAGS_CACHE_ME: 1 << 1,
    SPICE_CURSOR_FLAGS_FROM_CACHE: 1 << 2,
    SPICE_CURSOR_FLAGS_MASK: 7,
    SPICE_MOUSE_BUTTON_MASK_LEFT: 1 << 0,
    SPICE_MOUSE_BUTTON_MASK_MIDDLE: 1 << 1,
    SPICE_MOUSE_BUTTON_MASK_RIGHT: 1 << 2,
    SPICE_MOUSE_BUTTON_MASK_MASK: 7,
    SPICE_MOUSE_BUTTON_INVALID: 0,
    SPICE_MOUSE_BUTTON_LEFT: 1,
    SPICE_MOUSE_BUTTON_MIDDLE: 2,
    SPICE_MOUSE_BUTTON_RIGHT: 3,
    SPICE_MOUSE_BUTTON_UP: 4,
    SPICE_MOUSE_BUTTON_DOWN: 5,
    SPICE_BRUSH_TYPE_NONE: 0,
    SPICE_BRUSH_TYPE_SOLID: 1,
    SPICE_BRUSH_TYPE_PATTERN: 2,
    SPICE_SURFACE_FMT_INVALID: 0,
    SPICE_SURFACE_FMT_1_A: 1,
    SPICE_SURFACE_FMT_8_A: 8,
    SPICE_SURFACE_FMT_16_555: 16,
    SPICE_SURFACE_FMT_32_xRGB: 32,
    SPICE_SURFACE_FMT_16_565: 80,
    SPICE_SURFACE_FMT_32_ARGB: 96,
    SPICE_ROPD_INVERS_SRC: 1 << 0,
    SPICE_ROPD_INVERS_BRUSH: 1 << 1,
    SPICE_ROPD_INVERS_DEST: 1 << 2,
    SPICE_ROPD_OP_PUT: 1 << 3,
    SPICE_ROPD_OP_OR: 1 << 4,
    SPICE_ROPD_OP_AND: 1 << 5,
    SPICE_ROPD_OP_XOR: 1 << 6,
    SPICE_ROPD_OP_BLACKNESS: 1 << 7,
    SPICE_ROPD_OP_WHITENESS: 1 << 8,
    SPICE_ROPD_OP_INVERS: 1 << 9,
    SPICE_ROPD_INVERS_RES: 1 << 10,
    SPICE_ROPD_MASK: 2047,
    LZ_IMAGE_TYPE_INVALID: 0,
    LZ_IMAGE_TYPE_PLT1_LE: 1,
    LZ_IMAGE_TYPE_PLT1_BE: 2,
    // PLT stands for palette
    LZ_IMAGE_TYPE_PLT4_LE: 3,
    LZ_IMAGE_TYPE_PLT4_BE: 4,
    LZ_IMAGE_TYPE_PLT8: 5,
    LZ_IMAGE_TYPE_RGB16: 6,
    LZ_IMAGE_TYPE_RGB24: 7,
    LZ_IMAGE_TYPE_RGB32: 8,
    LZ_IMAGE_TYPE_RGBA: 9,
    LZ_IMAGE_TYPE_XXXA: 10,
    SPICE_INPUT_MOTION_ACK_BUNCH: 4,
    SPICE_CURSOR_TYPE_ALPHA: 0,
    SPICE_CURSOR_TYPE_MONO: 1,
    SPICE_CURSOR_TYPE_COLOR4: 2,
    SPICE_CURSOR_TYPE_COLOR8: 3,
    SPICE_CURSOR_TYPE_COLOR16: 4,
    SPICE_CURSOR_TYPE_COLOR24: 5,
    SPICE_CURSOR_TYPE_COLOR32: 6,
    SPICE_VIDEO_CODEC_TYPE_MJPEG: 1,
    SPICE_VIDEO_CODEC_TYPE_VP8: 2,
    VD_AGENT_PROTOCOL: 1,
    VD_AGENT_MAX_DATA_SIZE: 2048,
    VD_AGENT_MOUSE_STATE: 1,
    VD_AGENT_MONITORS_CONFIG: 2,
    VD_AGENT_REPLY: 3,
    VD_AGENT_CLIPBOARD: 4,
    VD_AGENT_DISPLAY_CONFIG: 5,
    VD_AGENT_ANNOUNCE_CAPABILITIES: 6,
    VD_AGENT_CLIPBOARD_GRAB: 7,
    VD_AGENT_CLIPBOARD_REQUEST: 8,
    VD_AGENT_CLIPBOARD_RELEASE: 9,
    VD_AGENT_FILE_XFER_START: 10,
    VD_AGENT_FILE_XFER_STATUS: 11,
    VD_AGENT_FILE_XFER_DATA: 12,
    VD_AGENT_CLIENT_DISCONNECTED: 13,
    VD_AGENT_MAX_CLIPBOARD: 14,
    VD_AGENT_CAP_MOUSE_STATE: 0,
    VD_AGENT_CAP_MONITORS_CONFIG: 1,
    VD_AGENT_CAP_REPLY: 2,
    VD_AGENT_CAP_CLIPBOARD: 3,
    VD_AGENT_CAP_DISPLAY_CONFIG: 4,
    VD_AGENT_CAP_CLIPBOARD_BY_DEMAND: 5,
    VD_AGENT_CAP_CLIPBOARD_SELECTION: 6,
    VD_AGENT_CAP_SPARSE_MONITORS_CONFIG: 7,
    VD_AGENT_CAP_GUEST_LINEEND_LF: 8,
    VD_AGENT_CAP_GUEST_LINEEND_CRLF: 9,
    VD_AGENT_CAP_MAX_CLIPBOARD: 10,
    VD_AGENT_END_CAP: 11,
    VD_AGENT_FILE_XFER_STATUS_CAN_SEND_DATA: 0,
    VD_AGENT_FILE_XFER_STATUS_CANCELLED: 1,
    VD_AGENT_FILE_XFER_STATUS_ERROR: 2,
    VD_AGENT_FILE_XFER_STATUS_SUCCESS: 3,
    VD_AGENT_CLIPBOARD_NONE: 0,
    VD_AGENT_CLIPBOARD_UTF8_TEXT: 1,
    VD_AGENT_CLIPBOARD_IMAGE_PNG: 2,
    VD_AGENT_CLIPBOARD_IMAGE_BMP: 3,
    VD_AGENT_CLIPBOARD_IMAGE_TIFF: 4,
    VD_AGENT_CLIPBOARD_IMAGE_JPG: 5
  };

  // vendor/spice-html5/spicedataview.js
  function SpiceDataView(buffer, byteOffset, byteLength) {
    if (byteOffset !== void 0) {
      if (byteLength !== void 0)
        this.u8 = new Uint8Array(buffer, byteOffset, byteLength);
      else
        this.u8 = new Uint8Array(buffer, byteOffset);
    } else
      this.u8 = new Uint8Array(buffer);
  }
  SpiceDataView.prototype = {
    getUint8: function(byteOffset) {
      return this.u8[byteOffset];
    },
    getUint16: function(byteOffset, littleEndian) {
      var low = 1, high = 0;
      if (littleEndian) {
        low = 0;
        high = 1;
      }
      return this.u8[byteOffset + high] << 8 | this.u8[byteOffset + low];
    },
    getUint32: function(byteOffset, littleEndian) {
      var low = 2, high = 0;
      if (littleEndian) {
        low = 0;
        high = 2;
      }
      return this.getUint16(byteOffset + high, littleEndian) << 16 | this.getUint16(byteOffset + low, littleEndian);
    },
    getUint64: function(byteOffset, littleEndian) {
      var low = 4, high = 0;
      if (littleEndian) {
        low = 0;
        high = 4;
      }
      return this.getUint32(byteOffset + high, littleEndian) << 32 | this.getUint32(byteOffset + low, littleEndian);
    },
    setUint8: function(byteOffset, b) {
      this.u8[byteOffset] = b & 255;
    },
    setUint16: function(byteOffset, i, littleEndian) {
      var low = 1, high = 0;
      if (littleEndian) {
        low = 0;
        high = 1;
      }
      this.u8[byteOffset + high] = (i & 65535) >> 8;
      this.u8[byteOffset + low] = i & 255;
    },
    setUint32: function(byteOffset, w, littleEndian) {
      var low = 2, high = 0;
      if (littleEndian) {
        low = 0;
        high = 2;
      }
      this.setUint16(byteOffset + high, (w & 4294967295) >> 16, littleEndian);
      this.setUint16(byteOffset + low, w & 65535, littleEndian);
    },
    setUint64: function(byteOffset, w, littleEndian) {
      var low = 4, high = 0;
      if (littleEndian) {
        low = 0;
        high = 4;
      }
      this.setUint32(byteOffset + high, (w & 18446744073709552e3) >> 32, littleEndian);
      this.setUint32(byteOffset + low, w & 4294967295, littleEndian);
    }
  };

  // vendor/spice-html5/thirdparty/jsbn.js
  var dbits;
  var canary = 244837814094590;
  var j_lm = (canary & 16777215) == 15715070;
  function BigInteger(a, b, c) {
    if (a != null)
      if ("number" == typeof a) this.fromNumber(a, b, c);
      else if (b == null && "string" != typeof a) this.fromString(a, 256);
      else this.fromString(a, b);
  }
  function nbi() {
    return new BigInteger(null);
  }
  function am1(i, x, w, j, c, n) {
    while (--n >= 0) {
      var v = x * this[i++] + w[j] + c;
      c = Math.floor(v / 67108864);
      w[j++] = v & 67108863;
    }
    return c;
  }
  function am2(i, x, w, j, c, n) {
    var xl = x & 32767, xh = x >> 15;
    while (--n >= 0) {
      var l = this[i] & 32767;
      var h = this[i++] >> 15;
      var m = xh * l + h * xl;
      l = xl * l + ((m & 32767) << 15) + w[j] + (c & 1073741823);
      c = (l >>> 30) + (m >>> 15) + xh * h + (c >>> 30);
      w[j++] = l & 1073741823;
    }
    return c;
  }
  function am3(i, x, w, j, c, n) {
    var xl = x & 16383, xh = x >> 14;
    while (--n >= 0) {
      var l = this[i] & 16383;
      var h = this[i++] >> 14;
      var m = xh * l + h * xl;
      l = xl * l + ((m & 16383) << 14) + w[j] + c;
      c = (l >> 28) + (m >> 14) + xh * h;
      w[j++] = l & 268435455;
    }
    return c;
  }
  if (j_lm && navigator.appName == "Microsoft Internet Explorer") {
    BigInteger.prototype.am = am2;
    dbits = 30;
  } else if (j_lm && navigator.appName != "Netscape") {
    BigInteger.prototype.am = am1;
    dbits = 26;
  } else {
    BigInteger.prototype.am = am3;
    dbits = 28;
  }
  BigInteger.prototype.DB = dbits;
  BigInteger.prototype.DM = (1 << dbits) - 1;
  BigInteger.prototype.DV = 1 << dbits;
  var BI_FP = 52;
  BigInteger.prototype.FV = Math.pow(2, BI_FP);
  BigInteger.prototype.F1 = BI_FP - dbits;
  BigInteger.prototype.F2 = 2 * dbits - BI_FP;
  var BI_RM = "0123456789abcdefghijklmnopqrstuvwxyz";
  var BI_RC = new Array();
  var rr;
  var vv;
  rr = "0".charCodeAt(0);
  for (vv = 0; vv <= 9; ++vv) BI_RC[rr++] = vv;
  rr = "a".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
  rr = "A".charCodeAt(0);
  for (vv = 10; vv < 36; ++vv) BI_RC[rr++] = vv;
  function int2char(n) {
    return BI_RM.charAt(n);
  }
  function intAt(s, i) {
    var c = BI_RC[s.charCodeAt(i)];
    return c == null ? -1 : c;
  }
  function bnpCopyTo(r) {
    for (var i = this.t - 1; i >= 0; --i) r[i] = this[i];
    r.t = this.t;
    r.s = this.s;
  }
  function bnpFromInt(x) {
    this.t = 1;
    this.s = x < 0 ? -1 : 0;
    if (x > 0) this[0] = x;
    else if (x < -1) this[0] = x + DV;
    else this.t = 0;
  }
  function nbv(i) {
    var r = nbi();
    r.fromInt(i);
    return r;
  }
  function bnpFromString(s, b) {
    var k;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 256) k = 8;
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else {
      this.fromRadix(s, b);
      return;
    }
    this.t = 0;
    this.s = 0;
    var i = s.length, mi = false, sh = 0;
    while (--i >= 0) {
      var x = k == 8 ? s[i] & 255 : intAt(s, i);
      if (x < 0) {
        if (s.charAt(i) == "-") mi = true;
        continue;
      }
      mi = false;
      if (sh == 0)
        this[this.t++] = x;
      else if (sh + k > this.DB) {
        this[this.t - 1] |= (x & (1 << this.DB - sh) - 1) << sh;
        this[this.t++] = x >> this.DB - sh;
      } else
        this[this.t - 1] |= x << sh;
      sh += k;
      if (sh >= this.DB) sh -= this.DB;
    }
    if (k == 8 && (s[0] & 128) != 0) {
      this.s = -1;
      if (sh > 0) this[this.t - 1] |= (1 << this.DB - sh) - 1 << sh;
    }
    this.clamp();
    if (mi) BigInteger.ZERO.subTo(this, this);
  }
  function bnpClamp() {
    var c = this.s & this.DM;
    while (this.t > 0 && this[this.t - 1] == c) --this.t;
  }
  function bnToString(b) {
    if (this.s < 0) return "-" + this.negate().toString(b);
    var k;
    if (b == 16) k = 4;
    else if (b == 8) k = 3;
    else if (b == 2) k = 1;
    else if (b == 32) k = 5;
    else if (b == 4) k = 2;
    else return this.toRadix(b);
    var km = (1 << k) - 1, d, m = false, r = "", i = this.t;
    var p = this.DB - i * this.DB % k;
    if (i-- > 0) {
      if (p < this.DB && (d = this[i] >> p) > 0) {
        m = true;
        r = int2char(d);
      }
      while (i >= 0) {
        if (p < k) {
          d = (this[i] & (1 << p) - 1) << k - p;
          d |= this[--i] >> (p += this.DB - k);
        } else {
          d = this[i] >> (p -= k) & km;
          if (p <= 0) {
            p += this.DB;
            --i;
          }
        }
        if (d > 0) m = true;
        if (m) r += int2char(d);
      }
    }
    return m ? r : "0";
  }
  function bnNegate() {
    var r = nbi();
    BigInteger.ZERO.subTo(this, r);
    return r;
  }
  function bnAbs() {
    return this.s < 0 ? this.negate() : this;
  }
  function bnCompareTo(a) {
    var r = this.s - a.s;
    if (r != 0) return r;
    var i = this.t;
    r = i - a.t;
    if (r != 0) return r;
    while (--i >= 0) if ((r = this[i] - a[i]) != 0) return r;
    return 0;
  }
  function nbits(x) {
    var r = 1, t;
    if ((t = x >>> 16) != 0) {
      x = t;
      r += 16;
    }
    if ((t = x >> 8) != 0) {
      x = t;
      r += 8;
    }
    if ((t = x >> 4) != 0) {
      x = t;
      r += 4;
    }
    if ((t = x >> 2) != 0) {
      x = t;
      r += 2;
    }
    if ((t = x >> 1) != 0) {
      x = t;
      r += 1;
    }
    return r;
  }
  function bnBitLength() {
    if (this.t <= 0) return 0;
    return this.DB * (this.t - 1) + nbits(this[this.t - 1] ^ this.s & this.DM);
  }
  function bnpDLShiftTo(n, r) {
    var i;
    for (i = this.t - 1; i >= 0; --i) r[i + n] = this[i];
    for (i = n - 1; i >= 0; --i) r[i] = 0;
    r.t = this.t + n;
    r.s = this.s;
  }
  function bnpDRShiftTo(n, r) {
    for (var i = n; i < this.t; ++i) r[i - n] = this[i];
    r.t = Math.max(this.t - n, 0);
    r.s = this.s;
  }
  function bnpLShiftTo(n, r) {
    var bs = n % this.DB;
    var cbs = this.DB - bs;
    var bm = (1 << cbs) - 1;
    var ds = Math.floor(n / this.DB), c = this.s << bs & this.DM, i;
    for (i = this.t - 1; i >= 0; --i) {
      r[i + ds + 1] = this[i] >> cbs | c;
      c = (this[i] & bm) << bs;
    }
    for (i = ds - 1; i >= 0; --i) r[i] = 0;
    r[ds] = c;
    r.t = this.t + ds + 1;
    r.s = this.s;
    r.clamp();
  }
  function bnpRShiftTo(n, r) {
    r.s = this.s;
    var ds = Math.floor(n / this.DB);
    if (ds >= this.t) {
      r.t = 0;
      return;
    }
    var bs = n % this.DB;
    var cbs = this.DB - bs;
    var bm = (1 << bs) - 1;
    r[0] = this[ds] >> bs;
    for (var i = ds + 1; i < this.t; ++i) {
      r[i - ds - 1] |= (this[i] & bm) << cbs;
      r[i - ds] = this[i] >> bs;
    }
    if (bs > 0) r[this.t - ds - 1] |= (this.s & bm) << cbs;
    r.t = this.t - ds;
    r.clamp();
  }
  function bnpSubTo(a, r) {
    var i = 0, c = 0, m = Math.min(a.t, this.t);
    while (i < m) {
      c += this[i] - a[i];
      r[i++] = c & this.DM;
      c >>= this.DB;
    }
    if (a.t < this.t) {
      c -= a.s;
      while (i < this.t) {
        c += this[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c += this.s;
    } else {
      c += this.s;
      while (i < a.t) {
        c -= a[i];
        r[i++] = c & this.DM;
        c >>= this.DB;
      }
      c -= a.s;
    }
    r.s = c < 0 ? -1 : 0;
    if (c < -1) r[i++] = this.DV + c;
    else if (c > 0) r[i++] = c;
    r.t = i;
    r.clamp();
  }
  function bnpMultiplyTo(a, r) {
    var x = this.abs(), y = a.abs();
    var i = x.t;
    r.t = i + y.t;
    while (--i >= 0) r[i] = 0;
    for (i = 0; i < y.t; ++i) r[i + x.t] = x.am(0, y[i], r, i, 0, x.t);
    r.s = 0;
    r.clamp();
    if (this.s != a.s) BigInteger.ZERO.subTo(r, r);
  }
  function bnpSquareTo(r) {
    var x = this.abs();
    var i = r.t = 2 * x.t;
    while (--i >= 0) r[i] = 0;
    for (i = 0; i < x.t - 1; ++i) {
      var c = x.am(i, x[i], r, 2 * i, 0, 1);
      if ((r[i + x.t] += x.am(i + 1, 2 * x[i], r, 2 * i + 1, c, x.t - i - 1)) >= x.DV) {
        r[i + x.t] -= x.DV;
        r[i + x.t + 1] = 1;
      }
    }
    if (r.t > 0) r[r.t - 1] += x.am(i, x[i], r, 2 * i, 0, 1);
    r.s = 0;
    r.clamp();
  }
  function bnpDivRemTo(m, q, r) {
    var pm = m.abs();
    if (pm.t <= 0) return;
    var pt = this.abs();
    if (pt.t < pm.t) {
      if (q != null) q.fromInt(0);
      if (r != null) this.copyTo(r);
      return;
    }
    if (r == null) r = nbi();
    var y = nbi(), ts = this.s, ms = m.s;
    var nsh = this.DB - nbits(pm[pm.t - 1]);
    if (nsh > 0) {
      pm.lShiftTo(nsh, y);
      pt.lShiftTo(nsh, r);
    } else {
      pm.copyTo(y);
      pt.copyTo(r);
    }
    var ys = y.t;
    var y0 = y[ys - 1];
    if (y0 == 0) return;
    var yt = y0 * (1 << this.F1) + (ys > 1 ? y[ys - 2] >> this.F2 : 0);
    var d1 = this.FV / yt, d2 = (1 << this.F1) / yt, e = 1 << this.F2;
    var i = r.t, j = i - ys, t = q == null ? nbi() : q;
    y.dlShiftTo(j, t);
    if (r.compareTo(t) >= 0) {
      r[r.t++] = 1;
      r.subTo(t, r);
    }
    BigInteger.ONE.dlShiftTo(ys, t);
    t.subTo(y, y);
    while (y.t < ys) y[y.t++] = 0;
    while (--j >= 0) {
      var qd = r[--i] == y0 ? this.DM : Math.floor(r[i] * d1 + (r[i - 1] + e) * d2);
      if ((r[i] += y.am(0, qd, r, j, 0, ys)) < qd) {
        y.dlShiftTo(j, t);
        r.subTo(t, r);
        while (r[i] < --qd) r.subTo(t, r);
      }
    }
    if (q != null) {
      r.drShiftTo(ys, q);
      if (ts != ms) BigInteger.ZERO.subTo(q, q);
    }
    r.t = ys;
    r.clamp();
    if (nsh > 0) r.rShiftTo(nsh, r);
    if (ts < 0) BigInteger.ZERO.subTo(r, r);
  }
  function bnMod(a) {
    var r = nbi();
    this.abs().divRemTo(a, null, r);
    if (this.s < 0 && r.compareTo(BigInteger.ZERO) > 0) a.subTo(r, r);
    return r;
  }
  function Classic(m) {
    this.m = m;
  }
  function cConvert(x) {
    if (x.s < 0 || x.compareTo(this.m) >= 0) return x.mod(this.m);
    else return x;
  }
  function cRevert(x) {
    return x;
  }
  function cReduce(x) {
    x.divRemTo(this.m, null, x);
  }
  function cMulTo(x, y, r) {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  function cSqrTo(x, r) {
    x.squareTo(r);
    this.reduce(r);
  }
  Classic.prototype.convert = cConvert;
  Classic.prototype.revert = cRevert;
  Classic.prototype.reduce = cReduce;
  Classic.prototype.mulTo = cMulTo;
  Classic.prototype.sqrTo = cSqrTo;
  function bnpInvDigit() {
    if (this.t < 1) return 0;
    var x = this[0];
    if ((x & 1) == 0) return 0;
    var y = x & 3;
    y = y * (2 - (x & 15) * y) & 15;
    y = y * (2 - (x & 255) * y) & 255;
    y = y * (2 - ((x & 65535) * y & 65535)) & 65535;
    y = y * (2 - x * y % this.DV) % this.DV;
    return y > 0 ? this.DV - y : -y;
  }
  function Montgomery(m) {
    this.m = m;
    this.mp = m.invDigit();
    this.mpl = this.mp & 32767;
    this.mph = this.mp >> 15;
    this.um = (1 << m.DB - 15) - 1;
    this.mt2 = 2 * m.t;
  }
  function montConvert(x) {
    var r = nbi();
    x.abs().dlShiftTo(this.m.t, r);
    r.divRemTo(this.m, null, r);
    if (x.s < 0 && r.compareTo(BigInteger.ZERO) > 0) this.m.subTo(r, r);
    return r;
  }
  function montRevert(x) {
    var r = nbi();
    x.copyTo(r);
    this.reduce(r);
    return r;
  }
  function montReduce(x) {
    while (x.t <= this.mt2)
      x[x.t++] = 0;
    for (var i = 0; i < this.m.t; ++i) {
      var j = x[i] & 32767;
      var u0 = j * this.mpl + ((j * this.mph + (x[i] >> 15) * this.mpl & this.um) << 15) & x.DM;
      j = i + this.m.t;
      x[j] += this.m.am(0, u0, x, i, 0, this.m.t);
      while (x[j] >= x.DV) {
        x[j] -= x.DV;
        x[++j]++;
      }
    }
    x.clamp();
    x.drShiftTo(this.m.t, x);
    if (x.compareTo(this.m) >= 0) x.subTo(this.m, x);
  }
  function montSqrTo(x, r) {
    x.squareTo(r);
    this.reduce(r);
  }
  function montMulTo(x, y, r) {
    x.multiplyTo(y, r);
    this.reduce(r);
  }
  Montgomery.prototype.convert = montConvert;
  Montgomery.prototype.revert = montRevert;
  Montgomery.prototype.reduce = montReduce;
  Montgomery.prototype.mulTo = montMulTo;
  Montgomery.prototype.sqrTo = montSqrTo;
  function bnpIsEven() {
    return (this.t > 0 ? this[0] & 1 : this.s) == 0;
  }
  function bnpExp(e, z) {
    if (e > 4294967295 || e < 1) return BigInteger.ONE;
    var r = nbi(), r2 = nbi(), g = z.convert(this), i = nbits(e) - 1;
    g.copyTo(r);
    while (--i >= 0) {
      z.sqrTo(r, r2);
      if ((e & 1 << i) > 0) z.mulTo(r2, g, r);
      else {
        var t = r;
        r = r2;
        r2 = t;
      }
    }
    return z.revert(r);
  }
  function bnModPowInt(e, m) {
    var z;
    if (e < 256 || m.isEven()) z = new Classic(m);
    else z = new Montgomery(m);
    return this.exp(e, z);
  }
  BigInteger.prototype.copyTo = bnpCopyTo;
  BigInteger.prototype.fromInt = bnpFromInt;
  BigInteger.prototype.fromString = bnpFromString;
  BigInteger.prototype.clamp = bnpClamp;
  BigInteger.prototype.dlShiftTo = bnpDLShiftTo;
  BigInteger.prototype.drShiftTo = bnpDRShiftTo;
  BigInteger.prototype.lShiftTo = bnpLShiftTo;
  BigInteger.prototype.rShiftTo = bnpRShiftTo;
  BigInteger.prototype.subTo = bnpSubTo;
  BigInteger.prototype.multiplyTo = bnpMultiplyTo;
  BigInteger.prototype.squareTo = bnpSquareTo;
  BigInteger.prototype.divRemTo = bnpDivRemTo;
  BigInteger.prototype.invDigit = bnpInvDigit;
  BigInteger.prototype.isEven = bnpIsEven;
  BigInteger.prototype.exp = bnpExp;
  BigInteger.prototype.toString = bnToString;
  BigInteger.prototype.negate = bnNegate;
  BigInteger.prototype.abs = bnAbs;
  BigInteger.prototype.compareTo = bnCompareTo;
  BigInteger.prototype.bitLength = bnBitLength;
  BigInteger.prototype.mod = bnMod;
  BigInteger.prototype.modPowInt = bnModPowInt;
  BigInteger.ZERO = nbv(0);
  BigInteger.ONE = nbv(1);

  // vendor/spice-html5/thirdparty/prng4.js
  function Arcfour() {
    this.i = 0;
    this.j = 0;
    this.S = new Array();
  }
  function ARC4init(key) {
    var i, j, t;
    for (i = 0; i < 256; ++i)
      this.S[i] = i;
    j = 0;
    for (i = 0; i < 256; ++i) {
      j = j + this.S[i] + key[i % key.length] & 255;
      t = this.S[i];
      this.S[i] = this.S[j];
      this.S[j] = t;
    }
    this.i = 0;
    this.j = 0;
  }
  function ARC4next() {
    var t;
    this.i = this.i + 1 & 255;
    this.j = this.j + this.S[this.i] & 255;
    t = this.S[this.i];
    this.S[this.i] = this.S[this.j];
    this.S[this.j] = t;
    return this.S[t + this.S[this.i] & 255];
  }
  Arcfour.prototype.init = ARC4init;
  Arcfour.prototype.next = ARC4next;
  function prng_newstate() {
    return new Arcfour();
  }
  var rng_psize = 256;

  // vendor/spice-html5/thirdparty/rng.js
  var rng_state;
  var rng_pool;
  var rng_pptr;
  function rng_seed_int(x) {
    rng_pool[rng_pptr++] ^= x & 255;
    rng_pool[rng_pptr++] ^= x >> 8 & 255;
    rng_pool[rng_pptr++] ^= x >> 16 & 255;
    rng_pool[rng_pptr++] ^= x >> 24 & 255;
    if (rng_pptr >= rng_psize) rng_pptr -= rng_psize;
  }
  function rng_seed_time() {
    rng_seed_int((/* @__PURE__ */ new Date()).getTime());
  }
  if (rng_pool == null) {
    rng_pool = new Array();
    rng_pptr = 0;
    if (navigator.appName == "Netscape" && navigator.appVersion < "5" && window.crypto) {
      z = window.crypto.random(32);
      for (t = 0; t < z.length; ++t)
        rng_pool[rng_pptr++] = z.charCodeAt(t) & 255;
    }
    while (rng_pptr < rng_psize) {
      t = Math.floor(65536 * Math.random());
      rng_pool[rng_pptr++] = t >>> 8;
      rng_pool[rng_pptr++] = t & 255;
    }
    rng_pptr = 0;
    rng_seed_time();
  }
  var t;
  var z;
  function rng_get_byte() {
    if (rng_state == null) {
      rng_seed_time();
      rng_state = prng_newstate();
      rng_state.init(rng_pool);
      for (rng_pptr = 0; rng_pptr < rng_pool.length; ++rng_pptr)
        rng_pool[rng_pptr] = 0;
      rng_pptr = 0;
    }
    return rng_state.next();
  }
  function rng_get_bytes(ba) {
    var i;
    for (i = 0; i < ba.length; ++i) ba[i] = rng_get_byte();
  }
  function SecureRandom() {
  }
  SecureRandom.prototype.nextBytes = rng_get_bytes;

  // vendor/spice-html5/thirdparty/rsa.js
  function parseBigInt(str, r) {
    return new BigInteger(str, r);
  }
  function pkcs1pad2(s, n) {
    if (n < s.length + 11) {
      alert("Message too long for RSA");
      return null;
    }
    var ba = new Array();
    var i = s.length - 1;
    while (i >= 0 && n > 0) {
      var c = s.charCodeAt(i--);
      if (c < 128) {
        ba[--n] = c;
      } else if (c > 127 && c < 2048) {
        ba[--n] = c & 63 | 128;
        ba[--n] = c >> 6 | 192;
      } else {
        ba[--n] = c & 63 | 128;
        ba[--n] = c >> 6 & 63 | 128;
        ba[--n] = c >> 12 | 224;
      }
    }
    ba[--n] = 0;
    var rng = new SecureRandom();
    var x = new Array();
    while (n > 2) {
      x[0] = 0;
      while (x[0] == 0) rng.nextBytes(x);
      ba[--n] = x[0];
    }
    ba[--n] = 2;
    ba[--n] = 0;
    return new BigInteger(ba);
  }
  function RSAKey() {
    this.n = null;
    this.e = 0;
    this.d = null;
    this.p = null;
    this.q = null;
    this.dmp1 = null;
    this.dmq1 = null;
    this.coeff = null;
  }
  function RSASetPublic(N, E) {
    if (N != null && E != null && N.length > 0 && E.length > 0) {
      this.n = parseBigInt(N, 16);
      this.e = parseInt(E, 16);
    } else
      alert("Invalid RSA public key");
  }
  function RSADoPublic(x) {
    return x.modPowInt(this.e, this.n);
  }
  function RSAEncrypt(text) {
    var m = pkcs1pad2(text, this.n.bitLength() + 7 >> 3);
    if (m == null) return null;
    var c = this.doPublic(m);
    if (c == null) return null;
    var h = c.toString(16);
    if ((h.length & 1) == 0) return h;
    else return "0" + h;
  }
  RSAKey.prototype.doPublic = RSADoPublic;
  RSAKey.prototype.setPublic = RSASetPublic;
  RSAKey.prototype.encrypt = RSAEncrypt;

  // vendor/spice-html5/thirdparty/sha1.js
  var hexcase = 0;
  function hex_sha1(s) {
    return rstr2hex(rstr_sha1(str2rstr_utf8(s)));
  }
  function rstr_sha1(s) {
    return binb2rstr(binb_sha1(rstr2binb(s), s.length * 8));
  }
  function rstr2hex(input) {
    try {
      hexcase;
    } catch (e) {
      hexcase = 0;
    }
    var hex_tab = hexcase ? "0123456789ABCDEF" : "0123456789abcdef";
    var output = "";
    var x;
    for (var i = 0; i < input.length; i++) {
      x = input.charCodeAt(i);
      output += hex_tab.charAt(x >>> 4 & 15) + hex_tab.charAt(x & 15);
    }
    return output;
  }
  function str2rstr_utf8(input) {
    var output = "";
    var i = -1;
    var x, y;
    while (++i < input.length) {
      x = input.charCodeAt(i);
      y = i + 1 < input.length ? input.charCodeAt(i + 1) : 0;
      if (55296 <= x && x <= 56319 && 56320 <= y && y <= 57343) {
        x = 65536 + ((x & 1023) << 10) + (y & 1023);
        i++;
      }
      if (x <= 127)
        output += String.fromCharCode(x);
      else if (x <= 2047)
        output += String.fromCharCode(
          192 | x >>> 6 & 31,
          128 | x & 63
        );
      else if (x <= 65535)
        output += String.fromCharCode(
          224 | x >>> 12 & 15,
          128 | x >>> 6 & 63,
          128 | x & 63
        );
      else if (x <= 2097151)
        output += String.fromCharCode(
          240 | x >>> 18 & 7,
          128 | x >>> 12 & 63,
          128 | x >>> 6 & 63,
          128 | x & 63
        );
    }
    return output;
  }
  function rstr2binb(input) {
    var output = Array(input.length >> 2);
    for (var i = 0; i < output.length; i++)
      output[i] = 0;
    for (var i = 0; i < input.length * 8; i += 8)
      output[i >> 5] |= (input.charCodeAt(i / 8) & 255) << 24 - i % 32;
    return output;
  }
  function binb2rstr(input) {
    var output = "";
    for (var i = 0; i < input.length * 32; i += 8)
      output += String.fromCharCode(input[i >> 5] >>> 24 - i % 32 & 255);
    return output;
  }
  function binb_sha1(x, len) {
    x[len >> 5] |= 128 << 24 - len % 32;
    x[(len + 64 >> 9 << 4) + 15] = len;
    var w = Array(80);
    var a = 1732584193;
    var b = -271733879;
    var c = -1732584194;
    var d = 271733878;
    var e = -1009589776;
    for (var i = 0; i < x.length; i += 16) {
      var olda = a;
      var oldb = b;
      var oldc = c;
      var oldd = d;
      var olde = e;
      for (var j = 0; j < 80; j++) {
        if (j < 16) w[j] = x[i + j];
        else w[j] = bit_rol(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
        var t = safe_add(
          safe_add(bit_rol(a, 5), sha1_ft(j, b, c, d)),
          safe_add(safe_add(e, w[j]), sha1_kt(j))
        );
        e = d;
        d = c;
        c = bit_rol(b, 30);
        b = a;
        a = t;
      }
      a = safe_add(a, olda);
      b = safe_add(b, oldb);
      c = safe_add(c, oldc);
      d = safe_add(d, oldd);
      e = safe_add(e, olde);
    }
    return Array(a, b, c, d, e);
  }
  function sha1_ft(t, b, c, d) {
    if (t < 20) return b & c | ~b & d;
    if (t < 40) return b ^ c ^ d;
    if (t < 60) return b & c | b & d | c & d;
    return b ^ c ^ d;
  }
  function sha1_kt(t) {
    return t < 20 ? 1518500249 : t < 40 ? 1859775393 : t < 60 ? -1894007588 : -899497514;
  }
  function safe_add(x, y) {
    var lsw = (x & 65535) + (y & 65535);
    var msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return msw << 16 | lsw & 65535;
  }
  function bit_rol(num, cnt) {
    return num << cnt | num >>> 32 - cnt;
  }

  // vendor/spice-html5/ticket.js
  var SHA_DIGEST_LENGTH = 20;
  function MGF1(mask, seed) {
    var i, j, outlen;
    for (i = 0, outlen = 0; outlen < mask.length; i++) {
      var combo_buf = new String();
      for (j = 0; j < seed.length; j++)
        combo_buf += String.fromCharCode(seed[j]);
      combo_buf += String.fromCharCode(i >> 24 & 255);
      combo_buf += String.fromCharCode(i >> 16 & 255);
      combo_buf += String.fromCharCode(i >> 8 & 255);
      combo_buf += String.fromCharCode(i & 255);
      var combo_hash = rstr_sha1(combo_buf);
      for (j = 0; j < combo_hash.length && outlen < mask.length; j++, outlen++) {
        mask[outlen] = combo_hash.charCodeAt(j);
      }
    }
  }
  function RSA_padding_add_PKCS1_OAEP(tolen, from, param) {
    var seed = new Array(SHA_DIGEST_LENGTH);
    var rand = new SecureRandom();
    rand.nextBytes(seed);
    var dblen = tolen - 1 - seed.length;
    var db = new Array(dblen);
    var padlen = dblen - from.length - 1;
    var i;
    if (param === void 0)
      param = "";
    if (padlen < SHA_DIGEST_LENGTH) {
      console.log("Error - data too large for key size.");
      return null;
    }
    for (i = 0; i < padlen; i++)
      db[i] = 0;
    var param_hash = rstr_sha1(param);
    for (i = 0; i < param_hash.length; i++)
      db[i] = param_hash.charCodeAt(i);
    db[padlen] = 1;
    for (i = 0; i < from.length; i++)
      db[i + padlen + 1] = from.charCodeAt(i);
    var dbmask = new Array(dblen);
    if (MGF1(dbmask, seed) < 0)
      return null;
    for (i = 0; i < dbmask.length; i++)
      db[i] ^= dbmask[i];
    var seedmask = Array(SHA_DIGEST_LENGTH);
    if (MGF1(seedmask, db) < 0)
      return null;
    for (i = 0; i < seedmask.length; i++)
      seed[i] ^= seedmask[i];
    var ret = new String();
    ret += String.fromCharCode(0);
    for (i = 0; i < seed.length; i++)
      ret += String.fromCharCode(seed[i]);
    for (i = 0; i < db.length; i++)
      ret += String.fromCharCode(db[i]);
    return ret;
  }
  function asn_get_length(u8, at) {
    var len = u8[at++];
    if (len > 128) {
      if (len != 129) {
        console.log("Error:  we lazily don't support keys bigger than 255 bytes.  It'd be easy to fix.");
        return null;
      }
      len = u8[at++];
    }
    return [at, len];
  }
  function find_sequence(u8, at) {
    var lenblock;
    at = at || 0;
    if (u8[at++] != 48) {
      console.log("Error:  public key should start with a sequence flag.");
      return null;
    }
    lenblock = asn_get_length(u8, at);
    if (!lenblock)
      return null;
    return lenblock;
  }
  function create_rsa_from_mb(mb, at) {
    var u8 = new Uint8Array(mb);
    var lenblock;
    var seq;
    var ba;
    var i;
    var ret;
    seq = find_sequence(u8, at);
    if (!seq)
      return null;
    at = seq[0];
    seq = find_sequence(u8, at);
    if (!seq)
      return null;
    at = seq[0] + seq[1];
    if (u8[at++] != 3) {
      console.log("Error: expecting bit string next.");
      return null;
    }
    lenblock = asn_get_length(u8, at);
    if (!lenblock)
      return null;
    at = lenblock[0];
    if (u8[at] != 0 && u8[at + 1] != 48) {
      console.log("Error: unexpected values in bit string.");
      return null;
    }
    seq = find_sequence(u8, at + 1);
    if (!seq)
      return null;
    at = seq[0];
    if (u8[at++] != 2) {
      console.log("Error: expecting integer n next.");
      return null;
    }
    lenblock = asn_get_length(u8, at);
    if (!lenblock)
      return null;
    at = lenblock[0];
    ba = new Array(lenblock[1]);
    for (i = 0; i < lenblock[1]; i++)
      ba[i] = u8[at + i];
    ret = new RSAKey();
    ret.n = new BigInteger(ba);
    at += lenblock[1];
    if (u8[at++] != 2) {
      console.log("Error: expecting integer e next.");
      return null;
    }
    lenblock = asn_get_length(u8, at);
    if (!lenblock)
      return null;
    at = lenblock[0];
    ret.e = u8[at++];
    for (i = 1; i < lenblock[1]; i++) {
      ret.e <<= 8;
      ret.e |= u8[at++];
    }
    return ret;
  }
  function rsa_encrypt(rsa, str) {
    var i;
    var ret = [];
    var oaep = RSA_padding_add_PKCS1_OAEP(rsa.n.bitLength() + 7 >> 3, str);
    if (!oaep)
      return null;
    var ba = new Array(oaep.length);
    for (i = 0; i < oaep.length; i++)
      ba[i] = oaep.charCodeAt(i);
    var bigint = new BigInteger(ba);
    var enc = rsa.doPublic(bigint);
    var h = enc.toString(16);
    if ((h.length & 1) != 0)
      h = "0" + h;
    for (i = 0; i < h.length; i += 2)
      ret[i / 2] = parseInt(h.substring(i, i + 2), 16);
    return ret;
  }

  // vendor/spice-html5/quic.js
  var encoder;
  var Constants2 = {
    QUIC_IMAGE_TYPE_INVALID: 0,
    QUIC_IMAGE_TYPE_GRAY: 1,
    QUIC_IMAGE_TYPE_RGB16: 2,
    QUIC_IMAGE_TYPE_RGB24: 3,
    QUIC_IMAGE_TYPE_RGB32: 4,
    QUIC_IMAGE_TYPE_RGBA: 5
  };
  var DEFevol = 3;
  var DEFwmimax = 6;
  var DEFwminext = 2048;
  var need_init = true;
  var DEFmaxclen = 26;
  var evol = DEFevol;
  var wmimax = DEFwmimax;
  var wminext = DEFwminext;
  var family_5bpc = {
    nGRcodewords: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRcwlen: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRprefixmask: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRsuffixlen: [0, 0, 0, 0, 0, 0, 0, 0],
    xlatU2L: [0, 0, 0, 0, 0, 0, 0, 0],
    xlatL2U: [0, 0, 0, 0, 0, 0, 0, 0]
  };
  var family_8bpc = {
    nGRcodewords: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRcwlen: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRprefixmask: [0, 0, 0, 0, 0, 0, 0, 0],
    notGRsuffixlen: [0, 0, 0, 0, 0, 0, 0, 0],
    xlatU2L: [0, 0, 0, 0, 0, 0, 0, 0],
    xlatL2U: [0, 0, 0, 0, 0, 0, 0, 0]
  };
  var bppmask = [
    0,
    1,
    3,
    7,
    15,
    31,
    63,
    127,
    255,
    511,
    1023,
    2047,
    4095,
    8191,
    16383,
    32767,
    65535,
    131071,
    262143,
    524287,
    1048575,
    2097151,
    4194303,
    8388607,
    16777215,
    33554431,
    67108863,
    134217727,
    268435455,
    536870911,
    1073741823,
    2147483647,
    4294967295
  ];
  var zeroLUT = [];
  var besttrigtab = [
    [550, 900, 800, 700, 500, 350, 300, 200, 180, 180, 160],
    [110, 550, 900, 800, 550, 400, 350, 250, 140, 160, 140],
    [100, 120, 550, 900, 700, 500, 400, 300, 220, 250, 160]
  ];
  var J = [
    0,
    0,
    0,
    0,
    1,
    1,
    1,
    1,
    2,
    2,
    2,
    2,
    3,
    3,
    3,
    3,
    4,
    4,
    5,
    5,
    6,
    6,
    7,
    7,
    8,
    9,
    10,
    11,
    12,
    13,
    14,
    15
  ];
  var lzeroes = [
    8,
    7,
    6,
    6,
    5,
    5,
    5,
    5,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    4,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    3,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    2,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    1,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0
  ];
  var tabrand_chaos = [
    46495042,
    893548311,
    794435923,
    2453991765,
    2077388039,
    894197842,
    1462934312,
    697534094,
    1826128012,
    343623392,
    2581292719,
    3811265708,
    459739748,
    2638427270,
    1654964626,
    101227083,
    2654850628,
    3668700691,
    572794346,
    2758751005,
    3445133904,
    2344099199,
    3367450297,
    898927923,
    3618406352,
    1606297603,
    754696453,
    20823118,
    2050458127,
    972590750,
    3990194068,
    3305596553,
    4239238564,
    1690498157,
    3015324227,
    2306127097,
    1510321853,
    548392192,
    971157512,
    2292288069,
    1611390505,
    4086766286,
    4084927083,
    1883326811,
    1891043243,
    113180603,
    1107690783,
    3778825955,
    3248980775,
    2443839100,
    2190866218,
    1932072870,
    495393613,
    1078522166,
    4051963518,
    1784694977,
    1768732442,
    2146763203,
    264646923,
    1474361405,
    2361552500,
    296035746,
    2489922759,
    2094565616,
    2409465348,
    1334241083,
    72483606,
    3740181004,
    4057920662,
    1734898312,
    4114662834,
    574624900,
    880305546,
    3258472262,
    26713132,
    1571648456,
    52557195,
    4043234286,
    2458021343,
    676064371,
    1528437109,
    64953873,
    546717185,
    2709319979,
    1947039598,
    2812723004,
    28691684,
    286829174,
    4235176970,
    3465707163,
    12526951,
    2154766700,
    3165032534,
    2036061161,
    3386656087,
    2301212354,
    2023576300,
    1061142336,
    3105452904,
    2743866805,
    3283373992,
    3397596080,
    3085489552,
    3196092395,
    3210707808,
    3651022684,
    925444321,
    2088074316,
    230011220,
    3223248386,
    533229176,
    523863486,
    3028311159,
    13140218,
    2538347282,
    900399636,
    3000796173,
    1526771255,
    3541282854,
    2992674461,
    2135722105,
    389334227,
    1225164337,
    3119947809,
    1803959919,
    3471171263,
    704170491,
    1407019136,
    1924534819,
    526887421,
    168782227,
    333811993,
    298623278,
    4268451686,
    381087740,
    2542899140,
    3266880867,
    2498950977,
    200969370,
    3511909096,
    3252303004,
    2268881098,
    2499828613,
    2606499854,
    3163208665,
    3790254546,
    1840025712,
    1319758833,
    3771674836,
    519421307,
    3512796222,
    1563402978,
    4284300462,
    2263719815,
    715250337,
    3178437172,
    2660191010,
    2982332026,
    3256309961,
    2709659997,
    3434092872,
    2367065591,
    69438718,
    915160508,
    183164069,
    3134331940,
    175242981,
    2680543346,
    1421955782,
    4231173251,
    1736652874,
    3990568476,
    1710820912,
    2286604440,
    3464587098,
    1261907837,
    1757387321,
    1128554270,
    1090050251,
    2429922486,
    1288729218,
    882830086,
    211637042,
    1376462063,
    2147615815,
    1737974929,
    798170275,
    4271572277,
    4241687072,
    1638524620,
    2760366295,
    1065115089,
    2097227717,
    1224023317,
    1625204849,
    3383303351,
    1488272307,
    2640186157,
    1649047732,
    819719707,
    2615091943,
    502645401,
    760628135,
    4108137983,
    63606742,
    1404337880,
    1865161130,
    4272996852,
    1239761976,
    790984678,
    3213322601,
    1917062825,
    4195069880,
    1962259360,
    2111002573,
    2311983960,
    1861406170,
    511141875,
    2797510619,
    1331661048,
    3130608186,
    147483493,
    3767089176,
    2650841450,
    4096523407,
    2574446300,
    1956416337,
    851468126,
    3607527519,
    1811658703,
    3642821136,
    832691095,
    2453312857,
    933732854,
    94341217,
    3393797730,
    1695907457,
    2405722077,
    2877685663,
    2469507058,
    2249636341,
    3988608661,
    4001245617,
    825934927,
    3103985967,
    1127151177,
    3691656896,
    1640967098,
    2168932645,
    2830550957,
    3998822878,
    3002602893,
    1509651465,
    775813869,
    2599574079,
    3791574229
  ];
  var rgb32_pixel_pad = 3;
  var rgb32_pixel_r = 2;
  var rgb32_pixel_g = 1;
  var rgb32_pixel_b = 0;
  var rgb32_pixel_size = 4;
  function ceil_log_2(val) {
    if (val === 1)
      return 0;
    var result = 1;
    val -= 1;
    while (val = val >>> 1)
      result++;
    return result;
  }
  function family_init(family, bpc, limit) {
    var l;
    for (l = 0; l < bpc; l++) {
      var altprefixlen, altcodewords;
      altprefixlen = limit - bpc;
      if (altprefixlen > bppmask[bpc - l])
        altprefixlen = bppmask[bpc - l];
      altcodewords = bppmask[bpc] + 1 - (altprefixlen << l);
      family.nGRcodewords[l] = altprefixlen << l;
      family.notGRcwlen[l] = altprefixlen + ceil_log_2(altcodewords);
      family.notGRprefixmask[l] = bppmask[32 - altprefixlen] >>> 0;
      family.notGRsuffixlen[l] = ceil_log_2(altcodewords);
    }
    var pixelbitmask = bppmask[bpc];
    var pixelbitmaskshr = pixelbitmask >>> 1;
    var s;
    for (s = 0; s <= pixelbitmask; s++) {
      if (s <= pixelbitmaskshr) {
        family.xlatU2L[s] = s << 1;
      } else {
        family.xlatU2L[s] = (pixelbitmask - s << 1) + 1;
      }
    }
    for (s = 0; s <= pixelbitmask; s++) {
      if (s & 1) {
        family.xlatL2U[s] = pixelbitmask - (s >>> 1);
      } else {
        family.xlatL2U[s] = s >>> 1;
      }
    }
  }
  function quic_image_bpc(type) {
    switch (type) {
      case Constants2.QUIC_IMAGE_TYPE_GRAY:
        return 8;
      case Constants2.QUIC_IMAGE_TYPE_RGB16:
        return 5;
      case Constants2.QUIC_IMAGE_TYPE_RGB24:
        return 8;
      case Constants2.QUIC_IMAGE_TYPE_RGB32:
        return 8;
      case Constants2.QUIC_IMAGE_TYPE_RGBA:
        return 8;
      case Constants2.QUIC_IMAGE_TYPE_INVALID:
      default:
        console.log("quic: bad image type\n");
        return 0;
    }
  }
  function cnt_l_zeroes(bits) {
    if (bits & 4286578688) {
      return lzeroes[bits >>> 24];
    } else if (bits & 4294934528) {
      return 8 + lzeroes[bits >>> 16 & 255];
    } else if (bits & 4294967168) {
      return 16 + lzeroes[bits >>> 8 & 255];
    } else {
      return 24 + lzeroes[bits & 255];
    }
  }
  function golomb_decoding_8bpc(l, bits) {
    var rc;
    var cwlen;
    if (bits < 0 || bits > family_8bpc.notGRprefixmask[l]) {
      var zeroprefix = cnt_l_zeroes(bits);
      cwlen = zeroprefix + 1 + l;
      rc = zeroprefix << l | bits >> 32 - cwlen & bppmask[l];
    } else {
      cwlen = family_8bpc.notGRcwlen[l];
      rc = family_8bpc.nGRcodewords[l] + (bits >> 32 - cwlen & bppmask[family_8bpc.notGRsuffixlen[l]]);
    }
    return { "codewordlen": cwlen, "rc": rc };
  }
  function golomb_code_len_8bpc(n, l) {
    if (n < family_8bpc.nGRcodewords[l]) {
      return (n >>> l) + 1 + l;
    } else {
      return family_8bpc.notGRcwlen[l];
    }
  }
  function QuicModel(bpc) {
    var bstart;
    var bend = 0;
    this.levels = 1 << bpc;
    this.n_buckets_ptrs = 0;
    switch (evol) {
      case 1:
        this.repfirst = 3;
        this.firstsize = 1;
        this.repnext = 2;
        this.mulsize = 2;
        break;
      case 3:
        this.repfirst = 1;
        this.firstsize = 1;
        this.repnext = 1;
        this.mulsize = 2;
        break;
      case 5:
        this.repfirst = 1;
        this.firstsize = 1;
        this.repnext = 1;
        this.mulsize = 4;
        break;
      case 0:
      case 2:
      case 4:
        console.log("quic: findmodelparams(): evol value obsolete!!!\n");
        break;
      default:
        console.log("quic: findmodelparams(): evol out of range!!!\n");
    }
    this.n_buckets = 0;
    var repcntr = this.repfirst + 1;
    var bsize = this.firstsize;
    do {
      if (this.n_buckets) {
        bstart = bend + 1;
      } else {
        bstart = 0;
      }
      if (!--repcntr) {
        repcntr = this.repnext;
        bsize *= this.mulsize;
      }
      bend = bstart + bsize - 1;
      if (bend + bsize >= this.levels) {
        bend = this.levels - 1;
      }
      if (!this.n_buckets_ptrs) {
        this.n_buckets_ptrs = this.levels;
      }
      this.n_buckets++;
    } while (bend < this.levels - 1);
  }
  QuicModel.prototype = {
    n_buckets: 0,
    n_buckets_ptrs: 0,
    repfirst: 0,
    firstsize: 0,
    repnext: 0,
    mulsize: 0,
    levels: 0
  };
  function QuicBucket() {
    this.counters = [0, 0, 0, 0, 0, 0, 0, 0];
  }
  QuicBucket.prototype = {
    bestcode: 0,
    reste: function(bpp) {
      this.bestcode = bpp;
      this.counters = [0, 0, 0, 0, 0, 0, 0, 0];
    },
    update_model_8bpc: function(state, curval, bpp) {
      var i;
      var bestcode = bpp - 1;
      var bestcodelen = this.counters[bestcode] += golomb_code_len_8bpc(curval, bestcode);
      for (i = bpp - 2; i >= 0; i--) {
        var ithcodelen = this.counters[i] += golomb_code_len_8bpc(curval, i);
        if (ithcodelen < bestcodelen) {
          bestcode = i;
          bestcodelen = ithcodelen;
        }
      }
      this.bestcode = bestcode;
      if (bestcodelen > state.wm_trigger) {
        for (i = 0; i < bpp; i++) {
          this.counters[i] = this.counters[i] >>> 1;
        }
      }
    }
  };
  function QuicFamilyStat() {
    this.buckets_ptrs = [];
    this.buckets_buf = [];
  }
  QuicFamilyStat.prototype = {
    fill_model_structures: function(model) {
      var bstart;
      var bend = 0;
      var bnumber = 0;
      var repcntr = model.repfirst + 1;
      var bsize = model.firstsize;
      do {
        if (bnumber) {
          bstart = bend + 1;
        } else {
          bstart = 0;
        }
        if (!--repcntr) {
          repcntr = model.repnext;
          bsize *= model.mulsize;
        }
        bend = bstart + bsize - 1;
        if (bend + bsize >= model.levels) {
          bend = model.levels - 1;
        }
        this.buckets_buf[bnumber] = new QuicBucket();
        var i;
        for (i = bstart; i <= bend; i++) {
          this.buckets_ptrs[i] = this.buckets_buf[bnumber];
        }
        bnumber++;
      } while (bend < model.levels - 1);
      return true;
    }
  };
  function QuicChannel(model_8bpc, model_5bpc) {
    this.state = new CommonState();
    this.family_stat_8bpc = new QuicFamilyStat();
    this.family_stat_5bpc = new QuicFamilyStat();
    this.correlate_row = { zero: 0, row: [] };
    this.model_8bpc = model_8bpc;
    this.model_5bpc = model_5bpc;
    this.buckets_ptrs = [];
    if (!this.family_stat_8bpc.fill_model_structures(this.model_8bpc))
      return void 0;
    if (!this.family_stat_5bpc.fill_model_structures(this.model_5bpc))
      return void 0;
  }
  QuicChannel.prototype = {
    reste: function(bpc) {
      var j;
      this.correlate_row = { zero: 0, row: [] };
      if (bpc == 8) {
        for (j = 0; j < this.model_8bpc.n_buckets; j++)
          this.family_stat_8bpc.buckets_buf[j].reste(7);
        this.buckets_ptrs = this.family_stat_8bpc.buckets_ptrs;
      } else if (bpc == 5) {
        for (j = 0; j < this.model_5bpc.n_buckets; j++)
          this.family_stat_8bpc.buckets_buf[j].reste(4);
        this.buckets_ptrs = this.family_stat_5bpc.buckets_ptrs;
      } else {
        console.log("quic: %s: bad bpc %d\n", __FUNCTION__, bpc);
        return false;
      }
      this.state.reste();
      return true;
    }
  };
  function CommonState() {
  }
  CommonState.prototype = {
    waitcnt: 0,
    tabrand_seed: 255,
    wm_trigger: 0,
    wmidx: 0,
    wmileft: wminext,
    melcstate: 0,
    melclen: 0,
    melcorder: 0,
    set_wm_trigger: function() {
      var wm = this.wmidx;
      if (wm > 10) {
        wm = 10;
      }
      this.wm_trigger = besttrigtab[Math.floor(evol / 2)][wm];
    },
    reste: function() {
      this.waitcnt = 0;
      this.tabrand_seed = 255;
      this.wmidx = 0;
      this.wmileft = wminext;
      this.set_wm_trigger();
      this.melcstate = 0;
      this.melclen = J[0];
      this.melcorder = 1 << this.melclen;
    },
    tabrand: function() {
      this.tabrand_seed++;
      return tabrand_chaos[this.tabrand_seed & 255];
    }
  };
  function QuicEncoder() {
    this.rgb_state = new CommonState();
    this.model_8bpc = new QuicModel(8);
    this.model_5bpc = new QuicModel(5);
    this.channels = [];
    var i;
    for (i = 0; i < 4; i++) {
      this.channels[i] = new QuicChannel(this.model_8bpc, this.model_5bpc);
      if (!this.channels[i]) {
        console.log("quic: failed to create channel");
        return void 0;
      }
    }
  }
  QuicEncoder.prototype = {
    type: 0,
    width: 0,
    height: 0,
    io_idx: 0,
    io_available_bits: 0,
    io_word: 0,
    io_next_word: 0,
    io_now: 0,
    io_end: 0,
    rows_completed: 0
  };
  QuicEncoder.prototype.reste = function(io_ptr) {
    this.rgb_state.reste();
    this.io_now = io_ptr;
    this.io_end = this.io_now.length;
    this.io_idx = 0;
    this.rows_completed = 0;
    return true;
  };
  QuicEncoder.prototype.read_io_word = function() {
    if (this.io_idx >= this.io_end)
      throw "quic: out of data";
    this.io_next_word = this.io_now[this.io_idx++] | this.io_now[this.io_idx++] << 8 | this.io_now[this.io_idx++] << 16 | this.io_now[this.io_idx++] << 24;
  };
  QuicEncoder.prototype.decode_eatbits = function(len) {
    this.io_word = this.io_word << len;
    var delta = this.io_available_bits - len;
    if (delta >= 0) {
      this.io_available_bits = delta;
      this.io_word |= this.io_next_word >>> this.io_available_bits;
    } else {
      delta = -1 * delta;
      this.io_word |= this.io_next_word << delta;
      this.read_io_word();
      this.io_available_bits = 32 - delta;
      this.io_word |= this.io_next_word >>> this.io_available_bits;
    }
  };
  QuicEncoder.prototype.decode_eat32bits = function() {
    this.decode_eatbits(16);
    this.decode_eatbits(16);
  };
  QuicEncoder.prototype.reste_channels = function(bpc) {
    var i;
    for (i = 0; i < 4; i++)
      if (!this.channels[i].reste(bpc))
        return false;
    return true;
  };
  QuicEncoder.prototype.quic_decode_begin = function(io_ptr) {
    if (!this.reste(io_ptr)) {
      return false;
    }
    this.io_idx = 0;
    this.io_next_word = this.io_now[this.io_idx++] | this.io_now[this.io_idx++] << 8 | this.io_now[this.io_idx++] << 16 | this.io_now[this.io_idx++] << 24;
    this.io_word = this.io_next_word;
    this.io_available_bits = 0;
    var magic = this.io_word;
    this.decode_eat32bits();
    if (magic != 1128879441) {
      console.log("quic: bad magic " + magic.toString(16));
      return false;
    }
    var version = this.io_word;
    this.decode_eat32bits();
    if (version != (0 << 16 | 0 & 65535)) {
      console.log("quic: bad version " + version.toString(16));
      return false;
    }
    this.type = this.io_word;
    this.decode_eat32bits();
    this.width = this.io_word;
    this.decode_eat32bits();
    this.height = this.io_word;
    this.decode_eat32bits();
    var bpc = quic_image_bpc(this.type);
    if (!this.reste_channels(bpc))
      return false;
    return true;
  };
  QuicEncoder.prototype.quic_rgb32_uncompress_row0_seg = function(i, cur_row, end, waitmask, bpc, bpc_mask) {
    var stopidx;
    var n_channels = 3;
    var c;
    var a;
    if (!i) {
      cur_row[rgb32_pixel_pad] = 0;
      c = 0;
      do {
        a = golomb_decoding_8bpc(this.channels[c].buckets_ptrs[this.channels[c].correlate_row.zero].bestcode, this.io_word);
        this.channels[c].correlate_row.row[0] = a.rc;
        cur_row[2 - c] = family_8bpc.xlatL2U[a.rc] & 255;
        this.decode_eatbits(a.codewordlen);
      } while (++c < n_channels);
      if (this.rgb_state.waitcnt) {
        --this.rgb_state.waitcnt;
      } else {
        this.rgb_state.waitcnt = this.rgb_state.tabrand() & waitmask;
        c = 0;
        do {
          this.channels[c].buckets_ptrs[this.channels[c].correlate_row.zero].update_model_8bpc(this.rgb_state, this.channels[c].correlate_row.row[0], bpc);
        } while (++c < n_channels);
      }
      stopidx = ++i + this.rgb_state.waitcnt;
    } else {
      stopidx = i + this.rgb_state.waitcnt;
    }
    while (stopidx < end) {
      for (; i <= stopidx; i++) {
        cur_row[i * rgb32_pixel_size + rgb32_pixel_pad] = 0;
        c = 0;
        do {
          a = golomb_decoding_8bpc(this.channels[c].buckets_ptrs[this.channels[c].correlate_row.row[i - 1]].bestcode, this.io_word);
          this.channels[c].correlate_row.row[i] = a.rc;
          cur_row[i * rgb32_pixel_size + (2 - c)] = family_8bpc.xlatL2U[a.rc] + cur_row[(i - 1) * rgb32_pixel_size + (2 - c)] & bpc_mask;
          this.decode_eatbits(a.codewordlen);
        } while (++c < n_channels);
      }
      c = 0;
      do {
        this.channels[c].buckets_ptrs[this.channels[c].correlate_row.row[stopidx - 1]].update_model_8bpc(this.rgb_state, this.channels[c].correlate_row.row[stopidx], bpc);
      } while (++c < n_channels);
      stopidx = i + (this.rgb_state.tabrand() & waitmask);
    }
    for (; i < end; i++) {
      cur_row[i * rgb32_pixel_size + rgb32_pixel_pad] = 0;
      c = 0;
      do {
        a = golomb_decoding_8bpc(this.channels[c].buckets_ptrs[this.channels[c].correlate_row.row[i - 1]].bestcode, this.io_word);
        this.channels[c].correlate_row.row[i] = a.rc;
        cur_row[i * rgb32_pixel_size + (2 - c)] = family_8bpc.xlatL2U[a.rc] + cur_row[(i - 1) * rgb32_pixel_size + (2 - c)] & bpc_mask;
        this.decode_eatbits(a.codewordlen);
      } while (++c < n_channels);
    }
    this.rgb_state.waitcnt = stopidx - end;
  };
  QuicEncoder.prototype.quic_rgb32_uncompress_row0 = function(cur_row) {
    var bpc = 8;
    var bpc_mask = 255;
    var pos = 0;
    var width = this.width;
    while (wmimax > this.rgb_state.wmidx && this.rgb_state.wmileft <= width) {
      if (this.rgb_state.wmileft) {
        this.quic_rgb32_uncompress_row0_seg(
          pos,
          cur_row,
          pos + this.rgb_state.wmileft,
          bppmask[this.rgb_state.wmidx],
          bpc,
          bpc_mask
        );
        pos += this.rgb_state.wmileft;
        width -= this.rgb_state.wmileft;
      }
      this.rgb_state.wmidx++;
      this.rgb_state.set_wm_trigger();
      this.rgb_state.wmileft = wminext;
    }
    if (width) {
      this.quic_rgb32_uncompress_row0_seg(
        pos,
        cur_row,
        pos + width,
        bppmask[this.rgb_state.wmidx],
        bpc,
        bpc_mask
      );
      if (wmimax > this.rgb_state.wmidx) {
        this.rgb_state.wmileft -= width;
      }
    }
  };
  QuicEncoder.prototype.quic_rgb32_uncompress_row_seg = function(prev_row, cur_row, i, end, bpc, bpc_mask) {
    var n_channels = 3;
    var waitmask = bppmask[this.rgb_state.wmidx];
    var a;
    var run_index = 0;
    var stopidx = 0;
    var run_end = 0;
    var c;
    if (!i) {
      cur_row[rgb32_pixel_pad] = 0;
      c = 0;
      do {
        a = golomb_decoding_8bpc(this.channels[c].buckets_ptrs[this.channels[c].correlate_row.zero].bestcode, this.io_word);
        this.channels[c].correlate_row.row[0] = a.rc;
        cur_row[2 - c] = family_8bpc.xlatL2U[this.channels[c].correlate_row.row[0]] + prev_row[2 - c] & bpc_mask;
        this.decode_eatbits(a.codewordlen);
      } while (++c < n_channels);
      if (this.rgb_state.waitcnt) {
        --this.rgb_state.waitcnt;
      } else {
        this.rgb_state.waitcnt = this.rgb_state.tabrand() & waitmask;
        c = 0;
        do {
          this.channels[c].buckets_ptrs[this.channels[c].correlate_row.zero].update_model_8bpc(this.rgb_state, this.channels[c].correlate_row.row[0], bpc);
        } while (++c < n_channels);
      }
      stopidx = ++i + this.rgb_state.waitcnt;
    } else {
      stopidx = i + this.rgb_state.waitcnt;
    }
    for (; ; ) {
      var rc = 0;
      while (stopidx < end && !rc) {
        for (; i <= stopidx && !rc; i++) {
          var pixel = i * rgb32_pixel_size;
          var pixelm1 = (i - 1) * rgb32_pixel_size;
          var pixelm2 = (i - 2) * rgb32_pixel_size;
          if (prev_row[pixelm1 + rgb32_pixel_r] == prev_row[pixel + rgb32_pixel_r] && prev_row[pixelm1 + rgb32_pixel_g] == prev_row[pixel + rgb32_pixel_g] && prev_row[pixelm1 + rgb32_pixel_b] == prev_row[pixel + rgb32_pixel_b]) {
            if (run_index != i && i > 2 && (cur_row[pixelm1 + rgb32_pixel_r] == cur_row[pixelm2 + rgb32_pixel_r] && cur_row[pixelm1 + rgb32_pixel_g] == cur_row[pixelm2 + rgb32_pixel_g] && cur_row[pixelm1 + rgb32_pixel_b] == cur_row[pixelm2 + rgb32_pixel_b])) {
              this.rgb_state.waitcnt = stopidx - i;
              run_index = i;
              run_end = i + this.decode_run(this.rgb_state);
              for (; i < run_end; i++) {
                var pixel = i * rgb32_pixel_size;
                var pixelm1 = (i - 1) * rgb32_pixel_size;
                cur_row[pixel + rgb32_pixel_pad] = 0;
                cur_row[pixel + rgb32_pixel_r] = cur_row[pixelm1 + rgb32_pixel_r];
                cur_row[pixel + rgb32_pixel_g] = cur_row[pixelm1 + rgb32_pixel_g];
                cur_row[pixel + rgb32_pixel_b] = cur_row[pixelm1 + rgb32_pixel_b];
              }
              if (i == end) {
                return;
              } else {
                stopidx = i + this.rgb_state.waitcnt;
                rc = 1;
                break;
              }
            }
          }
          c = 0;
          cur_row[pixel + rgb32_pixel_pad] = 0;
          do {
            var cc = this.channels[c];
            var cr = cc.correlate_row;
            a = golomb_decoding_8bpc(cc.buckets_ptrs[cr.row[i - 1]].bestcode, this.io_word);
            cr.row[i] = a.rc;
            cur_row[pixel + (2 - c)] = family_8bpc.xlatL2U[a.rc] + (cur_row[pixelm1 + (2 - c)] + prev_row[pixel + (2 - c)] >> 1) & bpc_mask;
            this.decode_eatbits(a.codewordlen);
          } while (++c < n_channels);
        }
        if (rc)
          break;
        c = 0;
        do {
          this.channels[c].buckets_ptrs[this.channels[c].correlate_row.row[stopidx - 1]].update_model_8bpc(this.rgb_state, this.channels[c].correlate_row.row[stopidx], bpc);
        } while (++c < n_channels);
        stopidx = i + (this.rgb_state.tabrand() & waitmask);
      }
      for (; i < end && !rc; i++) {
        var pixel = i * rgb32_pixel_size;
        var pixelm1 = (i - 1) * rgb32_pixel_size;
        var pixelm2 = (i - 2) * rgb32_pixel_size;
        if (prev_row[pixelm1 + rgb32_pixel_r] == prev_row[pixel + rgb32_pixel_r] && prev_row[pixelm1 + rgb32_pixel_g] == prev_row[pixel + rgb32_pixel_g] && prev_row[pixelm1 + rgb32_pixel_b] == prev_row[pixel + rgb32_pixel_b]) {
          if (run_index != i && i > 2 && (cur_row[pixelm1 + rgb32_pixel_r] == cur_row[pixelm2 + rgb32_pixel_r] && cur_row[pixelm1 + rgb32_pixel_g] == cur_row[pixelm2 + rgb32_pixel_g] && cur_row[pixelm1 + rgb32_pixel_b] == cur_row[pixelm2 + rgb32_pixel_b])) {
            this.rgb_state.waitcnt = stopidx - i;
            run_index = i;
            run_end = i + this.decode_run(this.rgb_state);
            for (; i < run_end; i++) {
              var pixel = i * rgb32_pixel_size;
              var pixelm1 = (i - 1) * rgb32_pixel_size;
              cur_row[pixel + rgb32_pixel_pad] = 0;
              cur_row[pixel + rgb32_pixel_r] = cur_row[pixelm1 + rgb32_pixel_r];
              cur_row[pixel + rgb32_pixel_g] = cur_row[pixelm1 + rgb32_pixel_g];
              cur_row[pixel + rgb32_pixel_b] = cur_row[pixelm1 + rgb32_pixel_b];
            }
            if (i == end) {
              return;
            } else {
              stopidx = i + this.rgb_state.waitcnt;
              rc = 1;
              break;
            }
          }
        }
        cur_row[pixel + rgb32_pixel_pad] = 0;
        c = 0;
        do {
          a = golomb_decoding_8bpc(this.channels[c].buckets_ptrs[this.channels[c].correlate_row.row[i - 1]].bestcode, this.io_word);
          this.channels[c].correlate_row.row[i] = a.rc;
          cur_row[pixel + (2 - c)] = family_8bpc.xlatL2U[a.rc] + (cur_row[pixelm1 + (2 - c)] + prev_row[pixel + (2 - c)] >> 1) & bpc_mask;
          this.decode_eatbits(a.codewordlen);
        } while (++c < n_channels);
      }
      if (!rc) {
        this.rgb_state.waitcnt = stopidx - end;
        return;
      }
    }
  };
  QuicEncoder.prototype.decode_run = function(state) {
    var runlen = 0;
    do {
      var hits;
      var x = ~(this.io_word >>> 24) >>> 0 & 255;
      var temp = zeroLUT[x];
      for (hits = 1; hits <= temp; hits++) {
        runlen += state.melcorder;
        if (state.melcstate < 32) {
          state.melclen = J[++state.melcstate];
          state.melcorder = 1 << state.melclen;
        }
      }
      if (temp != 8) {
        this.decode_eatbits(temp + 1);
        break;
      }
      this.decode_eatbits(8);
    } while (true);
    if (state.melclen) {
      runlen += this.io_word >>> 32 - state.melclen;
      this.decode_eatbits(state.melclen);
    }
    if (state.melcstate) {
      state.melclen = J[--state.melcstate];
      state.melcorder = 1 << state.melclen;
    }
    return runlen;
  };
  QuicEncoder.prototype.quic_rgb32_uncompress_row = function(prev_row, cur_row) {
    var bpc = 8;
    var bpc_mask = 255;
    var pos = 0;
    var width = this.width;
    while (wmimax > this.rgb_state.wmidx && this.rgb_state.wmileft <= width) {
      if (this.rgb_state.wmileft) {
        this.quic_rgb32_uncompress_row_seg(
          prev_row,
          cur_row,
          pos,
          pos + this.rgb_state.wmileft,
          bpc,
          bpc_mask
        );
        pos += this.rgb_state.wmileft;
        width -= this.rgb_state.wmileft;
      }
      this.rgb_state.wmidx++;
      this.rgb_state.set_wm_trigger();
      this.rgb_state.wmileft = wminext;
    }
    if (width) {
      this.quic_rgb32_uncompress_row_seg(
        prev_row,
        cur_row,
        pos,
        pos + width,
        bpc,
        bpc_mask
      );
      if (wmimax > this.rgb_state.wmidx) {
        this.rgb_state.wmileft -= width;
      }
    }
  };
  QuicEncoder.prototype.quic_four_uncompress_row0_seg = function(channel, i, correlate_row, cur_row, end, waitmask, bpc, bpc_mask) {
    var stopidx;
    var a;
    if (i == 0) {
      a = golomb_decoding_8bpc(channel.buckets_ptrs[correlate_row.zero].bestcode, this.io_word);
      correlate_row.row[0] = a.rc;
      cur_row[rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc];
      this.decode_eatbits(a.codewordlen);
      if (channel.state.waitcnt) {
        --channel.state.waitcnt;
      } else {
        channel.state.waitcnt = channel.state.tabrand() & waitmask;
        channel.buckets_ptrs[correlate_row.zero].update_model_8bpc(channel.state, correlate_row.row[0], bpc);
      }
      stopidx = ++i + channel.state.waitcnt;
    } else {
      stopidx = i + channel.state.waitcnt;
    }
    while (stopidx < end) {
      var pbucket;
      for (; i <= stopidx; i++) {
        pbucket = channel.buckets_ptrs[correlate_row.row[i - 1]];
        a = golomb_decoding_8bpc(pbucket.bestcode, this.io_word);
        correlate_row.row[i] = a.rc;
        cur_row[i * rgb32_pixel_size + rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc] + cur_row[(i - 1) * rgb32_pixel_size + rgb32_pixel_pad] & bpc_mask;
        this.decode_eatbits(a.codewordlen);
      }
      pbucket.update_model_8bpc(channel.state, correlate_row.row[stopidx], bpc);
      stopidx = i + (channel.state.tabrand() & waitmask);
    }
    for (; i < end; i++) {
      a = golomb_decoding_8bpc(channel.buckets_ptrs[correlate_row.row[i - 1]].bestcode, this.io_word);
      correlate_row.row[i] = a.rc;
      cur_row[i * rgb32_pixel_size + rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc] + cur_row[(i - 1) * rgb32_pixel_size + rgb32_pixel_pad] & bpc_mask;
      this.decode_eatbits(a.codewordlen);
    }
    channel.state.waitcnt = stopidx - end;
  };
  QuicEncoder.prototype.quic_four_uncompress_row0 = function(channel, cur_row) {
    var bpc = 8;
    var bpc_mask = 255;
    var correlate_row = channel.correlate_row;
    var pos = 0;
    var width = this.width;
    while (wmimax > channel.state.wmidx && channel.state.wmileft <= width) {
      if (channel.state.wmileft) {
        this.quic_four_uncompress_row0_seg(
          channel,
          pos,
          correlate_row,
          cur_row,
          pos + channel.state.wmileft,
          bppmask[channel.state.wmidx],
          bpc,
          bpc_mask
        );
        pos += channel.state.wmileft;
        width -= channel.state.wmileft;
      }
      channel.state.wmidx++;
      channel.state.set_wm_trigger();
      channel.state.wmileft = wminext;
    }
    if (width) {
      this.quic_four_uncompress_row0_seg(
        channel,
        pos,
        correlate_row,
        cur_row,
        pos + width,
        bppmask[channel.state.wmidx],
        bpc,
        bpc_mask
      );
      if (wmimax > channel.state.wmidx) {
        channel.state.wmileft -= width;
      }
    }
  };
  QuicEncoder.prototype.quic_four_uncompress_row_seg = function(channel, correlate_row, prev_row, cur_row, i, end, bpc, bpc_mask) {
    var waitmask = bppmask[channel.state.wmidx];
    var stopidx;
    var run_index = 0;
    var run_end;
    var a;
    if (i == 0) {
      a = golomb_decoding_8bpc(channel.buckets_ptrs[correlate_row.zero].bestcode, this.io_word);
      correlate_row.row[0] = a.rc;
      cur_row[rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc] + prev_row[rgb32_pixel_pad] & bpc_mask;
      this.decode_eatbits(a.codewordlen);
      if (channel.state.waitcnt) {
        --channel.state.waitcnt;
      } else {
        channel.state.waitcnt = channel.state.tabrand() & waitmask;
        channel.buckets_ptrs[correlate_row.zero].update_model_8bpc(channel.state, correlate_row.row[0], bpc);
      }
      stopidx = ++i + channel.state.waitcnt;
    } else {
      stopidx = i + channel.state.waitcnt;
    }
    for (; ; ) {
      var rc = 0;
      while (stopidx < end && !rc) {
        var pbucket;
        for (; i <= stopidx && !rc; i++) {
          var pixel = i * rgb32_pixel_size;
          var pixelm1 = (i - 1) * rgb32_pixel_size;
          var pixelm2 = (i - 2) * rgb32_pixel_size;
          if (prev_row[pixelm1 + rgb32_pixel_pad] == prev_row[pixel + rgb32_pixel_pad]) {
            if (run_index != i && i > 2 && cur_row[pixelm1 + rgb32_pixel_pad] == cur_row[pixelm2 + rgb32_pixel_pad]) {
              channel.state.waitcnt = stopidx - i;
              run_index = i;
              run_end = i + this.decode_run(channel.state);
              for (; i < run_end; i++) {
                var pixel = i * rgb32_pixel_size;
                var pixelm1 = (i - 1) * rgb32_pixel_size;
                cur_row[pixel + rgb32_pixel_pad] = cur_row[pixelm1 + rgb32_pixel_pad];
              }
              if (i == end) {
                return;
              } else {
                stopidx = i + channel.state.waitcnt;
                rc = 1;
                break;
              }
            }
          }
          pbucket = channel.buckets_ptrs[correlate_row.row[i - 1]];
          a = golomb_decoding_8bpc(pbucket.bestcode, this.io_word);
          correlate_row.row[i] = a.rc;
          cur_row[pixel + rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc] + (cur_row[pixelm1 + rgb32_pixel_pad] + prev_row[pixel + rgb32_pixel_pad] >> 1) & bpc_mask;
          this.decode_eatbits(a.codewordlen);
        }
        if (rc)
          break;
        pbucket.update_model_8bpc(channel.state, correlate_row.row[stopidx], bpc);
        stopidx = i + (channel.state.tabrand() & waitmask);
      }
      for (; i < end && !rc; i++) {
        var pixel = i * rgb32_pixel_size;
        var pixelm1 = (i - 1) * rgb32_pixel_size;
        var pixelm2 = (i - 2) * rgb32_pixel_size;
        if (prev_row[pixelm1 + rgb32_pixel_pad] == prev_row[pixel + rgb32_pixel_pad]) {
          if (run_index != i && i > 2 && cur_row[pixelm1 + rgb32_pixel_pad] == cur_row[pixelm2 + rgb32_pixel_pad]) {
            channel.state.waitcnt = stopidx - i;
            run_index = i;
            run_end = i + this.decode_run(channel.state);
            for (; i < run_end; i++) {
              var pixel = i * rgb32_pixel_size;
              var pixelm1 = (i - 1) * rgb32_pixel_size;
              cur_row[pixel + rgb32_pixel_pad] = cur_row[pixelm1 + rgb32_pixel_pad];
            }
            if (i == end) {
              return;
            } else {
              stopidx = i + channel.state.waitcnt;
              rc = 1;
              break;
            }
          }
        }
        a = golomb_decoding_8bpc(channel.buckets_ptrs[correlate_row.row[i - 1]].bestcode, this.io_word);
        correlate_row.row[i] = a.rc;
        cur_row[pixel + rgb32_pixel_pad] = family_8bpc.xlatL2U[a.rc] + (cur_row[pixelm1 + rgb32_pixel_pad] + prev_row[pixel + rgb32_pixel_pad] >> 1) & bpc_mask;
        this.decode_eatbits(a.codewordlen);
      }
      if (!rc) {
        channel.state.waitcnt = stopidx - end;
        return;
      }
    }
  };
  QuicEncoder.prototype.quic_four_uncompress_row = function(channel, prev_row, cur_row) {
    var bpc = 8;
    var bpc_mask = 255;
    var correlate_row = channel.correlate_row;
    var pos = 0;
    var width = this.width;
    while (wmimax > channel.state.wmidx && channel.state.wmileft <= width) {
      if (channel.state.wmileft) {
        this.quic_four_uncompress_row_seg(
          channel,
          correlate_row,
          prev_row,
          cur_row,
          pos,
          pos + channel.state.wmileft,
          bpc,
          bpc_mask
        );
        pos += channel.state.wmileft;
        width -= channel.state.wmileft;
      }
      channel.state.wmidx++;
      channel.state.set_wm_trigger();
      channel.state.wmileft = wminext;
    }
    if (width) {
      this.quic_four_uncompress_row_seg(
        channel,
        correlate_row,
        prev_row,
        cur_row,
        pos,
        pos + width,
        bpc,
        bpc_mask
      );
      if (wmimax > channel.state.wmidx) {
        channel.state.wmileft -= width;
      }
    }
  };
  QuicEncoder.prototype.quic_decode = function(buf, stride) {
    var row;
    switch (this.type) {
      case Constants2.QUIC_IMAGE_TYPE_RGB32:
      case Constants2.QUIC_IMAGE_TYPE_RGB24:
        this.channels[0].correlate_row.zero = 0;
        this.channels[1].correlate_row.zero = 0;
        this.channels[2].correlate_row.zero = 0;
        this.quic_rgb32_uncompress_row0(buf);
        this.rows_completed++;
        for (row = 1; row < this.height; row++) {
          var prev = buf;
          buf = prev.subarray(stride);
          this.channels[0].correlate_row.zero = this.channels[0].correlate_row.row[0];
          this.channels[1].correlate_row.zero = this.channels[1].correlate_row.row[0];
          this.channels[2].correlate_row.zero = this.channels[2].correlate_row.row[0];
          this.quic_rgb32_uncompress_row(prev, buf);
          this.rows_completed++;
        }
        ;
        break;
      case Constants2.QUIC_IMAGE_TYPE_RGB16:
        console.log("quic: unsupported output format\n");
        return false;
        break;
      case Constants2.QUIC_IMAGE_TYPE_RGBA:
        this.channels[0].correlate_row.zero = 0;
        this.channels[1].correlate_row.zero = 0;
        this.channels[2].correlate_row.zero = 0;
        this.quic_rgb32_uncompress_row0(buf);
        this.channels[3].correlate_row.zero = 0;
        this.quic_four_uncompress_row0(this.channels[3], buf);
        this.rows_completed++;
        for (row = 1; row < this.height; row++) {
          var prev = buf;
          buf = prev.subarray(stride);
          this.channels[0].correlate_row.zero = this.channels[0].correlate_row.row[0];
          this.channels[1].correlate_row.zero = this.channels[1].correlate_row.row[0];
          this.channels[2].correlate_row.zero = this.channels[2].correlate_row.row[0];
          this.quic_rgb32_uncompress_row(prev, buf);
          this.channels[3].correlate_row.zero = this.channels[3].correlate_row.row[0];
          this.quic_four_uncompress_row(encoder.channels[3], prev, buf);
          this.rows_completed++;
        }
        break;
      case Constants2.QUIC_IMAGE_TYPE_GRAY:
        console.log("quic: unsupported output format\n");
        return false;
        break;
      case Constants2.QUIC_IMAGE_TYPE_INVALID:
      default:
        console.log("quic: bad image type\n");
        return false;
    }
    return true;
  };
  QuicEncoder.prototype.simple_quic_decode = function(buf) {
    var stride = 4;
    if (!this.quic_decode_begin(buf))
      return void 0;
    if (this.type != Constants2.QUIC_IMAGE_TYPE_RGB32 && this.type != Constants2.QUIC_IMAGE_TYPE_RGB24 && this.type != Constants2.QUIC_IMAGE_TYPE_RGBA)
      return void 0;
    var out = new Uint8Array(this.width * this.height * 4);
    out[0] = 69;
    if (this.quic_decode(out, this.width * stride))
      return out;
    return void 0;
  };
  function SpiceQuic() {
  }
  SpiceQuic.prototype = {
    from_dv: function(dv, at, mb) {
      if (!encoder)
        throw "quic: no quic encoder";
      this.data_size = dv.getUint32(at, true);
      at += 4;
      var buf = new Uint8Array(mb.slice(at));
      this.outptr = encoder.simple_quic_decode(buf);
      if (this.outptr) {
        this.type = encoder.type;
        this.width = encoder.width;
        this.height = encoder.height;
      }
      at += buf.length;
      return at;
    }
  };
  function convert_spice_quic_to_web(context, spice_quic) {
    var ret = context.createImageData(spice_quic.width, spice_quic.height);
    var i;
    for (i = 0; i < ret.width * ret.height * 4; i += 4) {
      ret.data[i + 0] = spice_quic.outptr[i + 2];
      ret.data[i + 1] = spice_quic.outptr[i + 1];
      ret.data[i + 2] = spice_quic.outptr[i + 0];
      if (spice_quic.type !== Constants2.QUIC_IMAGE_TYPE_RGBA)
        ret.data[i + 3] = 255;
      else
        ret.data[i + 3] = 255 - spice_quic.outptr[i + 3];
    }
    return ret;
  }
  if (need_init) {
    need_init = false;
    family_init(family_8bpc, 8, DEFmaxclen);
    family_init(family_5bpc, 5, DEFmaxclen);
    j = k = 1;
    l = 8;
    for (i = 0; i < 256; ++i) {
      zeroLUT[i] = l;
      --k;
      if (k == 0) {
        k = j;
        --l;
        j *= 2;
      }
    }
    encoder = new QuicEncoder();
    if (!encoder)
      throw "quic: failed to create encoder";
  }
  var i;
  var j;
  var k;
  var l;

  // vendor/spice-html5/spicetype.js
  function SpiceChannelId() {
  }
  SpiceChannelId.prototype = {
    from_dv: function(dv, at, mb) {
      this.type = dv.getUint8(at, true);
      at++;
      this.id = dv.getUint8(at, true);
      at++;
      return at;
    }
  };
  function SpiceRect() {
  }
  SpiceRect.prototype = {
    from_dv: function(dv, at, mb) {
      this.top = dv.getUint32(at, true);
      at += 4;
      this.left = dv.getUint32(at, true);
      at += 4;
      this.bottom = dv.getUint32(at, true);
      at += 4;
      this.right = dv.getUint32(at, true);
      at += 4;
      return at;
    },
    is_same_size: function(r) {
      if (this.bottom - this.top == r.bottom - r.top && this.right - this.left == r.right - r.left)
        return true;
      return false;
    }
  };
  function SpiceClipRects() {
  }
  SpiceClipRects.prototype = {
    from_dv: function(dv, at, mb) {
      var i;
      this.num_rects = dv.getUint32(at, true);
      at += 4;
      if (this.num_rects > 0)
        this.rects = [];
      for (i = 0; i < this.num_rects; i++) {
        this.rects[i] = new SpiceRect();
        at = this.rects[i].from_dv(dv, at, mb);
      }
      return at;
    }
  };
  function SpiceClip() {
  }
  SpiceClip.prototype = {
    from_dv: function(dv, at, mb) {
      this.type = dv.getUint8(at, true);
      at++;
      if (this.type == Constants.SPICE_CLIP_TYPE_RECTS) {
        this.rects = new SpiceClipRects();
        at = this.rects.from_dv(dv, at, mb);
      }
      return at;
    }
  };
  function SpiceImageDescriptor() {
  }
  SpiceImageDescriptor.prototype = {
    from_dv: function(dv, at, mb) {
      this.id = dv.getUint64(at, true);
      at += 8;
      this.type = dv.getUint8(at, true);
      at++;
      this.flags = dv.getUint8(at, true);
      at++;
      this.width = dv.getUint32(at, true);
      at += 4;
      this.height = dv.getUint32(at, true);
      at += 4;
      return at;
    }
  };
  function SpicePalette() {
  }
  SpicePalette.prototype = {
    from_dv: function(dv, at, mb) {
      var i;
      this.unique = dv.getUint64(at, true);
      at += 8;
      this.num_ents = dv.getUint16(at, true);
      at += 2;
      this.ents = [];
      for (i = 0; i < this.num_ents; i++) {
        this.ents[i] = dv.getUint32(at, true);
        at += 4;
      }
      return at;
    }
  };
  function SpiceBitmap() {
  }
  SpiceBitmap.prototype = {
    from_dv: function(dv, at, mb) {
      this.format = dv.getUint8(at, true);
      at++;
      this.flags = dv.getUint8(at, true);
      at++;
      this.x = dv.getUint32(at, true);
      at += 4;
      this.y = dv.getUint32(at, true);
      at += 4;
      this.stride = dv.getUint32(at, true);
      at += 4;
      if (this.flags & Constants.SPICE_BITMAP_FLAGS_PAL_FROM_CACHE) {
        this.palette_id = dv.getUint64(at, true);
        at += 8;
      } else {
        var offset = dv.getUint32(at, true);
        at += 4;
        if (offset == 0)
          this.palette = null;
        else {
          this.palette = new SpicePalette();
          this.palette.from_dv(dv, offset, mb);
        }
      }
      this.data = mb.slice(at);
      at += this.data.byteLength;
      return at;
    }
  };
  function SpiceImage() {
  }
  SpiceImage.prototype = {
    from_dv: function(dv, at, mb) {
      this.descriptor = new SpiceImageDescriptor();
      at = this.descriptor.from_dv(dv, at, mb);
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_LZ_RGB) {
        this.lz_rgb = new Object();
        this.lz_rgb.length = dv.getUint32(at, true);
        at += 4;
        var initial_at = at;
        this.lz_rgb.magic = "";
        for (var i = 3; i >= 0; i--)
          this.lz_rgb.magic += String.fromCharCode(dv.getUint8(at + i));
        at += 4;
        this.lz_rgb.version = dv.getUint32(at);
        at += 4;
        this.lz_rgb.type = dv.getUint32(at);
        at += 4;
        this.lz_rgb.width = dv.getUint32(at);
        at += 4;
        this.lz_rgb.height = dv.getUint32(at);
        at += 4;
        this.lz_rgb.stride = dv.getUint32(at);
        at += 4;
        this.lz_rgb.top_down = dv.getUint32(at);
        at += 4;
        var header_size = at - initial_at;
        this.lz_rgb.data = mb.slice(at, this.lz_rgb.length + at - header_size);
        at += this.lz_rgb.data.byteLength;
      }
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_BITMAP) {
        this.bitmap = new SpiceBitmap();
        at = this.bitmap.from_dv(dv, at, mb);
      }
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_SURFACE) {
        this.surface_id = dv.getUint32(at, true);
        at += 4;
      }
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_JPEG) {
        this.jpeg = new Object();
        this.jpeg.data_size = dv.getUint32(at, true);
        at += 4;
        this.jpeg.data = mb.slice(at);
        at += this.jpeg.data.byteLength;
      }
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_JPEG_ALPHA) {
        this.jpeg_alpha = new Object();
        this.jpeg_alpha.flags = dv.getUint8(at, true);
        at += 1;
        this.jpeg_alpha.jpeg_size = dv.getUint32(at, true);
        at += 4;
        this.jpeg_alpha.data_size = dv.getUint32(at, true);
        at += 4;
        this.jpeg_alpha.data = mb.slice(at, this.jpeg_alpha.jpeg_size + at);
        at += this.jpeg_alpha.data.byteLength;
        this.jpeg_alpha.alpha = new Object();
        this.jpeg_alpha.alpha.length = this.jpeg_alpha.data_size - this.jpeg_alpha.jpeg_size;
        var initial_at = at;
        this.jpeg_alpha.alpha.magic = "";
        for (var i = 3; i >= 0; i--)
          this.jpeg_alpha.alpha.magic += String.fromCharCode(dv.getUint8(at + i));
        at += 4;
        this.jpeg_alpha.alpha.version = dv.getUint32(at);
        at += 4;
        this.jpeg_alpha.alpha.type = dv.getUint32(at);
        at += 4;
        this.jpeg_alpha.alpha.width = dv.getUint32(at);
        at += 4;
        this.jpeg_alpha.alpha.height = dv.getUint32(at);
        at += 4;
        this.jpeg_alpha.alpha.stride = dv.getUint32(at);
        at += 4;
        this.jpeg_alpha.alpha.top_down = dv.getUint32(at);
        at += 4;
        var header_size = at - initial_at;
        this.jpeg_alpha.alpha.data = mb.slice(at, this.jpeg_alpha.alpha.length + at - header_size);
        at += this.jpeg_alpha.alpha.data.byteLength;
      }
      if (this.descriptor.type == Constants.SPICE_IMAGE_TYPE_QUIC) {
        this.quic = new SpiceQuic();
        at = this.quic.from_dv(dv, at, mb);
      }
      return at;
    }
  };
  function SpiceQMask() {
  }
  SpiceQMask.prototype = {
    from_dv: function(dv, at, mb) {
      this.flags = dv.getUint8(at, true);
      at++;
      this.pos = new SpicePoint();
      at = this.pos.from_dv(dv, at, mb);
      var offset = dv.getUint32(at, true);
      at += 4;
      if (offset == 0) {
        this.bitmap = null;
        return at;
      }
      this.bitmap = new SpiceImage();
      return this.bitmap.from_dv(dv, offset, mb);
    }
  };
  function SpicePattern() {
  }
  SpicePattern.prototype = {
    from_dv: function(dv, at, mb) {
      var offset = dv.getUint32(at, true);
      at += 4;
      if (offset == 0) {
        this.pat = null;
      } else {
        this.pat = new SpiceImage();
        this.pat.from_dv(dv, offset, mb);
      }
      this.pos = new SpicePoint();
      return this.pos.from_dv(dv, at, mb);
    }
  };
  function SpiceBrush() {
  }
  SpiceBrush.prototype = {
    from_dv: function(dv, at, mb) {
      this.type = dv.getUint8(at, true);
      at++;
      if (this.type == Constants.SPICE_BRUSH_TYPE_SOLID) {
        this.color = dv.getUint32(at, true);
        at += 4;
      } else if (this.type == Constants.SPICE_BRUSH_TYPE_PATTERN) {
        this.pattern = new SpicePattern();
        at = this.pattern.from_dv(dv, at, mb);
      }
      return at;
    }
  };
  function SpiceFill() {
  }
  SpiceFill.prototype = {
    from_dv: function(dv, at, mb) {
      this.brush = new SpiceBrush();
      at = this.brush.from_dv(dv, at, mb);
      this.rop_descriptor = dv.getUint16(at, true);
      at += 2;
      this.mask = new SpiceQMask();
      return this.mask.from_dv(dv, at, mb);
    }
  };
  function SpiceCopy() {
  }
  SpiceCopy.prototype = {
    from_dv: function(dv, at, mb) {
      var offset = dv.getUint32(at, true);
      at += 4;
      if (offset == 0) {
        this.src_bitmap = null;
      } else {
        this.src_bitmap = new SpiceImage();
        this.src_bitmap.from_dv(dv, offset, mb);
      }
      this.src_area = new SpiceRect();
      at = this.src_area.from_dv(dv, at, mb);
      this.rop_descriptor = dv.getUint16(at, true);
      at += 2;
      this.scale_mode = dv.getUint8(at, true);
      at++;
      this.mask = new SpiceQMask();
      return this.mask.from_dv(dv, at, mb);
    }
  };
  function SpicePoint16() {
  }
  SpicePoint16.prototype = {
    from_dv: function(dv, at, mb) {
      this.x = dv.getUint16(at, true);
      at += 2;
      this.y = dv.getUint16(at, true);
      at += 2;
      return at;
    }
  };
  function SpicePoint() {
  }
  SpicePoint.prototype = {
    from_dv: function(dv, at, mb) {
      this.x = dv.getUint32(at, true);
      at += 4;
      this.y = dv.getUint32(at, true);
      at += 4;
      return at;
    }
  };
  function SpiceCursorHeader() {
  }
  SpiceCursorHeader.prototype = {
    from_dv: function(dv, at, mb) {
      this.unique = dv.getUint64(at, true);
      at += 8;
      this.type = dv.getUint8(at, true);
      at++;
      this.width = dv.getUint16(at, true);
      at += 2;
      this.height = dv.getUint16(at, true);
      at += 2;
      this.hot_spot_x = dv.getUint16(at, true);
      at += 2;
      this.hot_spot_y = dv.getUint16(at, true);
      at += 2;
      return at;
    }
  };
  function SpiceCursor() {
  }
  SpiceCursor.prototype = {
    from_dv: function(dv, at, mb) {
      this.flags = dv.getUint16(at, true);
      at += 2;
      if (this.flags & Constants.SPICE_CURSOR_FLAGS_NONE)
        this.header = null;
      else {
        this.header = new SpiceCursorHeader();
        at = this.header.from_dv(dv, at, mb);
        this.data = mb.slice(at);
        at += this.data.byteLength;
      }
      return at;
    }
  };
  function SpiceSurface() {
  }
  SpiceSurface.prototype = {
    from_dv: function(dv, at, mb) {
      this.surface_id = dv.getUint32(at, true);
      at += 4;
      this.width = dv.getUint32(at, true);
      at += 4;
      this.height = dv.getUint32(at, true);
      at += 4;
      this.format = dv.getUint32(at, true);
      at += 4;
      this.flags = dv.getUint32(at, true);
      at += 4;
      return at;
    }
  };

  // vendor/spice-html5/atKeynames.js
  var KeyNames = {
    /*
     * definition of the AT84/MF101/MF102 Keyboard:
     * ============================================================
     *       Defined             Key Cap Glyphs       Pressed value
     *      Key Name            Main       Also       (hex)    (dec)
     *      ----------------   ---------- -------    ------    ------
     */
    KEY_Escape: (
      /* Escape                0x01  */
      1
    ),
    KEY_1: (
      /* 1           !         0x02  */
      2
    ),
    KEY_2: (
      /* 2           @         0x03  */
      3
    ),
    KEY_3: (
      /* 3           #         0x04  */
      4
    ),
    KEY_4: (
      /* 4           $         0x05  */
      5
    ),
    KEY_5: (
      /* 5           %         0x06  */
      6
    ),
    KEY_6: (
      /* 6           ^         0x07  */
      7
    ),
    KEY_7: (
      /* 7           &         0x08  */
      8
    ),
    KEY_8: (
      /* 8           *         0x09  */
      9
    ),
    KEY_9: (
      /* 9           (         0x0a  */
      10
    ),
    KEY_0: (
      /* 0           )         0x0b  */
      11
    ),
    KEY_Minus: (
      /* - (Minus)   _ (Under) 0x0c  */
      12
    ),
    KEY_Equal: (
      /* = (Equal)   +         0x0d  */
      13
    ),
    KEY_BackSpace: (
      /* Back Space            0x0e  */
      14
    ),
    KEY_Tab: (
      /* Tab                   0x0f  */
      15
    ),
    KEY_Q: (
      /* Q                     0x10  */
      16
    ),
    KEY_W: (
      /* W                     0x11  */
      17
    ),
    KEY_E: (
      /* E                     0x12  */
      18
    ),
    KEY_R: (
      /* R                     0x13  */
      19
    ),
    KEY_T: (
      /* T                     0x14  */
      20
    ),
    KEY_Y: (
      /* Y                     0x15  */
      21
    ),
    KEY_U: (
      /* U                     0x16  */
      22
    ),
    KEY_I: (
      /* I                     0x17  */
      23
    ),
    KEY_O: (
      /* O                     0x18  */
      24
    ),
    KEY_P: (
      /* P                     0x19  */
      25
    ),
    KEY_LBrace: (
      /* [           {         0x1a  */
      26
    ),
    KEY_RBrace: (
      /* ]           }         0x1b  */
      27
    ),
    KEY_Enter: (
      /* Enter                 0x1c  */
      28
    ),
    KEY_LCtrl: (
      /* Ctrl(left)            0x1d  */
      29
    ),
    KEY_A: (
      /* A                     0x1e  */
      30
    ),
    KEY_S: (
      /* S                     0x1f  */
      31
    ),
    KEY_D: (
      /* D                     0x20  */
      32
    ),
    KEY_F: (
      /* F                     0x21  */
      33
    ),
    KEY_G: (
      /* G                     0x22  */
      34
    ),
    KEY_H: (
      /* H                     0x23  */
      35
    ),
    KEY_J: (
      /* J                     0x24  */
      36
    ),
    KEY_K: (
      /* K                     0x25  */
      37
    ),
    KEY_L: (
      /* L                     0x26  */
      38
    ),
    KEY_SemiColon: (
      /* ;(SemiColon) :(Colon) 0x27  */
      39
    ),
    KEY_Quote: (
      /* ' (Apostr)  " (Quote) 0x28  */
      40
    ),
    KEY_Tilde: (
      /* ` (Accent)  ~ (Tilde) 0x29  */
      41
    ),
    KEY_ShiftL: (
      /* Shift(left)           0x2a  */
      42
    ),
    KEY_BSlash: (
      /* \(BckSlash) |(VertBar)0x2b  */
      43
    ),
    KEY_Z: (
      /* Z                     0x2c  */
      44
    ),
    KEY_X: (
      /* X                     0x2d  */
      45
    ),
    KEY_C: (
      /* C                     0x2e  */
      46
    ),
    KEY_V: (
      /* V                     0x2f  */
      47
    ),
    KEY_B: (
      /* B                     0x30  */
      48
    ),
    KEY_N: (
      /* N                     0x31  */
      49
    ),
    KEY_M: (
      /* M                     0x32  */
      50
    ),
    KEY_Comma: (
      /* , (Comma)   < (Less)  0x33  */
      51
    ),
    KEY_Period: (
      /* . (Period)  >(Greater)0x34  */
      52
    ),
    KEY_Slash: (
      /* / (Slash)   ?         0x35  */
      53
    ),
    KEY_ShiftR: (
      /* Shift(right)          0x36  */
      54
    ),
    KEY_KP_Multiply: (
      /* *                     0x37  */
      55
    ),
    KEY_Alt: (
      /* Alt(left)             0x38  */
      56
    ),
    KEY_Space: (
      /*   (SpaceBar)          0x39  */
      57
    ),
    KEY_CapsLock: (
      /* CapsLock              0x3a  */
      58
    ),
    KEY_F1: (
      /* F1                    0x3b  */
      59
    ),
    KEY_F2: (
      /* F2                    0x3c  */
      60
    ),
    KEY_F3: (
      /* F3                    0x3d  */
      61
    ),
    KEY_F4: (
      /* F4                    0x3e  */
      62
    ),
    KEY_F5: (
      /* F5                    0x3f  */
      63
    ),
    KEY_F6: (
      /* F6                    0x40  */
      64
    ),
    KEY_F7: (
      /* F7                    0x41  */
      65
    ),
    KEY_F8: (
      /* F8                    0x42  */
      66
    ),
    KEY_F9: (
      /* F9                    0x43  */
      67
    ),
    KEY_F10: (
      /* F10                   0x44  */
      68
    ),
    KEY_NumLock: (
      /* NumLock               0x45  */
      69
    ),
    KEY_ScrollLock: (
      /* ScrollLock            0x46  */
      70
    ),
    KEY_KP_7: (
      /* 7           Home      0x47  */
      71
    ),
    KEY_KP_8: (
      /* 8           Up        0x48  */
      72
    ),
    KEY_KP_9: (
      /* 9           PgUp      0x49  */
      73
    ),
    KEY_KP_Minus: (
      /* - (Minus)             0x4a  */
      74
    ),
    KEY_KP_4: (
      /* 4           Left      0x4b  */
      75
    ),
    KEY_KP_5: (
      /* 5                     0x4c  */
      76
    ),
    KEY_KP_6: (
      /* 6           Right     0x4d  */
      77
    ),
    KEY_KP_Plus: (
      /* + (Plus)              0x4e  */
      78
    ),
    KEY_KP_1: (
      /* 1           End       0x4f  */
      79
    ),
    KEY_KP_2: (
      /* 2           Down      0x50  */
      80
    ),
    KEY_KP_3: (
      /* 3           PgDown    0x51  */
      81
    ),
    KEY_KP_0: (
      /* 0           Insert    0x52  */
      82
    ),
    KEY_KP_Decimal: (
      /* . (Decimal) Delete    0x53  */
      83
    ),
    KEY_SysRequest: (
      /* SysRequest            0x54  */
      84
    ),
    /* NOTUSED               0x55  */
    KEY_Less: (
      /* < (Less)   >(Greater) 0x56  */
      86
    ),
    KEY_F11: (
      /* F11                   0x57  */
      87
    ),
    KEY_F12: (
      /* F12                   0x58  */
      88
    ),
    KEY_Prefix0: (
      /* special               0x60  */
      96
    ),
    KEY_Prefix1: (
      /* specail               0x61  */
      97
    )
  };

  // vendor/spice-html5/code_to_scancode.js
  var code_to_scancode = [];
  code_to_scancode["Escape"] = 1;
  code_to_scancode["Digit1"] = 2;
  code_to_scancode["Digit2"] = 3;
  code_to_scancode["Digit3"] = 4;
  code_to_scancode["Digit4"] = 5;
  code_to_scancode["Digit5"] = 6;
  code_to_scancode["Digit6"] = 7;
  code_to_scancode["Digit7"] = 8;
  code_to_scancode["Digit8"] = 9;
  code_to_scancode["Digit9"] = 10;
  code_to_scancode["Digit0"] = 11;
  code_to_scancode["Minus"] = 12;
  code_to_scancode["Equal"] = 13;
  code_to_scancode["Backspace"] = 14;
  code_to_scancode["Tab"] = 15;
  code_to_scancode["KeyQ"] = 16;
  code_to_scancode["KeyW"] = 17;
  code_to_scancode["KeyE"] = 18;
  code_to_scancode["KeyR"] = 19;
  code_to_scancode["KeyT"] = 20;
  code_to_scancode["KeyY"] = 21;
  code_to_scancode["KeyU"] = 22;
  code_to_scancode["KeyI"] = 23;
  code_to_scancode["KeyO"] = 24;
  code_to_scancode["KeyP"] = 25;
  code_to_scancode["BracketLeft"] = 26;
  code_to_scancode["BracketRight"] = 27;
  code_to_scancode["Enter"] = 28;
  code_to_scancode["ControlLeft"] = 29;
  code_to_scancode["KeyA"] = 30;
  code_to_scancode["KeyS"] = 31;
  code_to_scancode["KeyD"] = 32;
  code_to_scancode["KeyF"] = 33;
  code_to_scancode["KeyG"] = 34;
  code_to_scancode["KeyH"] = 35;
  code_to_scancode["KeyJ"] = 36;
  code_to_scancode["KeyK"] = 37;
  code_to_scancode["KeyL"] = 38;
  code_to_scancode["Semicolon"] = 39;
  code_to_scancode["Quote"] = 40;
  code_to_scancode["Backquote"] = 41;
  code_to_scancode["ShiftLeft"] = 42;
  code_to_scancode["Backslash"] = 43;
  code_to_scancode["KeyZ"] = 44;
  code_to_scancode["KeyX"] = 45;
  code_to_scancode["KeyC"] = 46;
  code_to_scancode["KeyV"] = 47;
  code_to_scancode["KeyB"] = 48;
  code_to_scancode["KeyN"] = 49;
  code_to_scancode["KeyM"] = 50;
  code_to_scancode["Comma"] = 51;
  code_to_scancode["Period"] = 52;
  code_to_scancode["Slash"] = 53;
  code_to_scancode["ShiftRight"] = 54;
  code_to_scancode["NumpadMultiply"] = 55;
  code_to_scancode["AltLeft"] = 56;
  code_to_scancode["Space"] = 57;
  code_to_scancode["CapsLock"] = 58;
  code_to_scancode["F1"] = 59;
  code_to_scancode["F2"] = 60;
  code_to_scancode["F3"] = 61;
  code_to_scancode["F4"] = 62;
  code_to_scancode["F5"] = 63;
  code_to_scancode["F6"] = 64;
  code_to_scancode["F7"] = 65;
  code_to_scancode["F8"] = 66;
  code_to_scancode["F9"] = 67;
  code_to_scancode["F10"] = 68;
  code_to_scancode["Pause"] = 69;
  code_to_scancode["ScrollLock"] = 70;
  code_to_scancode["Numpad7"] = 71;
  code_to_scancode["Numpad8"] = 72;
  code_to_scancode["Numpad9"] = 73;
  code_to_scancode["NumpadSubtract"] = 74;
  code_to_scancode["Numpad4"] = 75;
  code_to_scancode["Numpad5"] = 76;
  code_to_scancode["Numpad6"] = 77;
  code_to_scancode["NumpadAdd"] = 78;
  code_to_scancode["Numpad1"] = 79;
  code_to_scancode["Numpad2"] = 80;
  code_to_scancode["Numpad3"] = 81;
  code_to_scancode["Numpad0"] = 82;
  code_to_scancode["NumpadDecimal"] = 83;
  code_to_scancode["PrintScreen"] = 84;
  code_to_scancode["IntlBackslash"] = 86;
  code_to_scancode["F11"] = 87;
  code_to_scancode["F12"] = 88;
  code_to_scancode["NumpadEqual"] = 89;
  code_to_scancode["F13"] = 100;
  code_to_scancode["F14"] = 101;
  code_to_scancode["F15"] = 102;
  code_to_scancode["F16"] = 103;
  code_to_scancode["F17"] = 104;
  code_to_scancode["F18"] = 105;
  code_to_scancode["F19"] = 106;
  code_to_scancode["F20"] = 107;
  code_to_scancode["F21"] = 108;
  code_to_scancode["F22"] = 109;
  code_to_scancode["F23"] = 110;
  code_to_scancode["KanaMode"] = 112;
  code_to_scancode["IntlRo"] = 115;
  code_to_scancode["F24"] = 118;
  code_to_scancode["Convert"] = 121;
  code_to_scancode["NonConvert"] = 123;
  code_to_scancode["IntlYen"] = 125;
  code_to_scancode["NumpadComma"] = 126;
  code_to_scancode["MediaTrackPrevious"] = 224 | 16 << 8;
  code_to_scancode["MediaTrackNext"] = 224 | 25 << 8;
  code_to_scancode["NumpadEnter"] = 224 | 28 << 8;
  code_to_scancode["ControlRight"] = 224 | 29 << 8;
  code_to_scancode["AudioVolumeMute"] = 224 | 32 << 8;
  code_to_scancode["LaunchApp2"] = 224 | 33 << 8;
  code_to_scancode["MediaPlayPause"] = 224 | 34 << 8;
  code_to_scancode["MediaStop"] = 224 | 36 << 8;
  code_to_scancode["VolumeDown"] = 224 | 46 << 8;
  code_to_scancode["VolumeUp"] = 224 | 48 << 8;
  code_to_scancode["BrowserHome"] = 224 | 50 << 8;
  code_to_scancode["NumpadDivide"] = 224 | 53 << 8;
  code_to_scancode["PrintScreen"] = 224 | 55 << 8;
  code_to_scancode["AltRight"] = 224 | 56 << 8;
  code_to_scancode["NumLock"] = 224 | 69 << 8;
  code_to_scancode["Pause"] = 224 | 70 << 8;
  code_to_scancode["Home"] = 224 | 71 << 8;
  code_to_scancode["ArrowUp"] = 224 | 72 << 8;
  code_to_scancode["PageUp"] = 224 | 73 << 8;
  code_to_scancode["ArrowLeft"] = 224 | 75 << 8;
  code_to_scancode["ArrowRight"] = 224 | 77 << 8;
  code_to_scancode["End"] = 224 | 79 << 8;
  code_to_scancode["ArrowDown"] = 224 | 80 << 8;
  code_to_scancode["PageDown"] = 224 | 81 << 8;
  code_to_scancode["Insert"] = 224 | 82 << 8;
  code_to_scancode["Delete"] = 224 | 83 << 8;
  code_to_scancode["MetaLeft"] = 224 | 91 << 8;
  code_to_scancode["MetaRight"] = 224 | 92 << 8;
  code_to_scancode["ContextMenu"] = 224 | 93 << 8;
  code_to_scancode["Power"] = 224 | 94 << 8;
  code_to_scancode["BrowserSearch"] = 224 | 101 << 8;
  code_to_scancode["BrowserFavorites"] = 224 | 102 << 8;
  code_to_scancode["BrowserRefresh"] = 224 | 103 << 8;
  code_to_scancode["BrowserStop"] = 224 | 104 << 8;
  code_to_scancode["BrowserForward"] = 224 | 105 << 8;
  code_to_scancode["BrowserBack"] = 224 | 106 << 8;
  code_to_scancode["LaunchApp1"] = 224 | 107 << 8;
  code_to_scancode["LaunchMail"] = 224 | 108 << 8;
  code_to_scancode["MediaSelect"] = 224 | 109 << 8;

  // vendor/spice-html5/utils.js
  var DEBUG = 0;
  var PLAYBACK_DEBUG = 0;
  var STREAM_DEBUG = 0;
  var DUMP_DRAWS = false;
  var DUMP_CANVASES = false;
  var EMPTY_GIF_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  function arraybuffer_to_str(buf) {
    return String.fromCharCode.apply(null, new Uint16Array(buf));
  }
  var common_scanmap = [];
  common_scanmap["1".charCodeAt(0)] = KeyNames.KEY_1;
  common_scanmap["2".charCodeAt(0)] = KeyNames.KEY_2;
  common_scanmap["3".charCodeAt(0)] = KeyNames.KEY_3;
  common_scanmap["4".charCodeAt(0)] = KeyNames.KEY_4;
  common_scanmap["5".charCodeAt(0)] = KeyNames.KEY_5;
  common_scanmap["6".charCodeAt(0)] = KeyNames.KEY_6;
  common_scanmap["7".charCodeAt(0)] = KeyNames.KEY_7;
  common_scanmap["8".charCodeAt(0)] = KeyNames.KEY_8;
  common_scanmap["9".charCodeAt(0)] = KeyNames.KEY_9;
  common_scanmap["0".charCodeAt(0)] = KeyNames.KEY_0;
  common_scanmap[145] = KeyNames.KEY_ScrollLock;
  common_scanmap[103] = KeyNames.KEY_KP_7;
  common_scanmap[104] = KeyNames.KEY_KP_8;
  common_scanmap[105] = KeyNames.KEY_KP_9;
  common_scanmap[100] = KeyNames.KEY_KP_4;
  common_scanmap[101] = KeyNames.KEY_KP_5;
  common_scanmap[102] = KeyNames.KEY_KP_6;
  common_scanmap[107] = KeyNames.KEY_KP_Plus;
  common_scanmap[97] = KeyNames.KEY_KP_1;
  common_scanmap[98] = KeyNames.KEY_KP_2;
  common_scanmap[99] = KeyNames.KEY_KP_3;
  common_scanmap[96] = KeyNames.KEY_KP_0;
  common_scanmap[109] = KeyNames.KEY_Minus;
  common_scanmap[110] = KeyNames.KEY_KP_Decimal;
  common_scanmap[191] = KeyNames.KEY_Slash;
  common_scanmap[190] = KeyNames.KEY_Period;
  common_scanmap[188] = KeyNames.KEY_Comma;
  common_scanmap[220] = KeyNames.KEY_BSlash;
  common_scanmap[192] = KeyNames.KEY_Tilde;
  common_scanmap[222] = KeyNames.KEY_Quote;
  common_scanmap[219] = KeyNames.KEY_LBrace;
  common_scanmap[221] = KeyNames.KEY_RBrace;
  common_scanmap["Q".charCodeAt(0)] = KeyNames.KEY_Q;
  common_scanmap["W".charCodeAt(0)] = KeyNames.KEY_W;
  common_scanmap["E".charCodeAt(0)] = KeyNames.KEY_E;
  common_scanmap["R".charCodeAt(0)] = KeyNames.KEY_R;
  common_scanmap["T".charCodeAt(0)] = KeyNames.KEY_T;
  common_scanmap["Y".charCodeAt(0)] = KeyNames.KEY_Y;
  common_scanmap["U".charCodeAt(0)] = KeyNames.KEY_U;
  common_scanmap["I".charCodeAt(0)] = KeyNames.KEY_I;
  common_scanmap["O".charCodeAt(0)] = KeyNames.KEY_O;
  common_scanmap["P".charCodeAt(0)] = KeyNames.KEY_P;
  common_scanmap["A".charCodeAt(0)] = KeyNames.KEY_A;
  common_scanmap["S".charCodeAt(0)] = KeyNames.KEY_S;
  common_scanmap["D".charCodeAt(0)] = KeyNames.KEY_D;
  common_scanmap["F".charCodeAt(0)] = KeyNames.KEY_F;
  common_scanmap["G".charCodeAt(0)] = KeyNames.KEY_G;
  common_scanmap["H".charCodeAt(0)] = KeyNames.KEY_H;
  common_scanmap["J".charCodeAt(0)] = KeyNames.KEY_J;
  common_scanmap["K".charCodeAt(0)] = KeyNames.KEY_K;
  common_scanmap["L".charCodeAt(0)] = KeyNames.KEY_L;
  common_scanmap["Z".charCodeAt(0)] = KeyNames.KEY_Z;
  common_scanmap["X".charCodeAt(0)] = KeyNames.KEY_X;
  common_scanmap["C".charCodeAt(0)] = KeyNames.KEY_C;
  common_scanmap["V".charCodeAt(0)] = KeyNames.KEY_V;
  common_scanmap["B".charCodeAt(0)] = KeyNames.KEY_B;
  common_scanmap["N".charCodeAt(0)] = KeyNames.KEY_N;
  common_scanmap["M".charCodeAt(0)] = KeyNames.KEY_M;
  common_scanmap[" ".charCodeAt(0)] = KeyNames.KEY_Space;
  common_scanmap[13] = KeyNames.KEY_Enter;
  common_scanmap[27] = KeyNames.KEY_Escape;
  common_scanmap[8] = KeyNames.KEY_BackSpace;
  common_scanmap[9] = KeyNames.KEY_Tab;
  common_scanmap[16] = KeyNames.KEY_ShiftL;
  common_scanmap[17] = KeyNames.KEY_LCtrl;
  common_scanmap[18] = KeyNames.KEY_Alt;
  common_scanmap[20] = KeyNames.KEY_CapsLock;
  common_scanmap[44] = KeyNames.KEY_SysReqest;
  common_scanmap[144] = KeyNames.KEY_NumLock;
  common_scanmap[112] = KeyNames.KEY_F1;
  common_scanmap[113] = KeyNames.KEY_F2;
  common_scanmap[114] = KeyNames.KEY_F3;
  common_scanmap[115] = KeyNames.KEY_F4;
  common_scanmap[116] = KeyNames.KEY_F5;
  common_scanmap[117] = KeyNames.KEY_F6;
  common_scanmap[118] = KeyNames.KEY_F7;
  common_scanmap[119] = KeyNames.KEY_F8;
  common_scanmap[120] = KeyNames.KEY_F9;
  common_scanmap[121] = KeyNames.KEY_F10;
  common_scanmap[122] = KeyNames.KEY_F11;
  common_scanmap[123] = KeyNames.KEY_F12;
  common_scanmap[42] = 99;
  common_scanmap[19] = 101;
  common_scanmap[111] = 224 | KeyNames.KEY_Slash << 8;
  common_scanmap[106] = 224 | KeyNames.KEY_KP_Multiply << 8;
  common_scanmap[36] = 224 | KeyNames.KEY_KP_7 << 8;
  common_scanmap[38] = 224 | KeyNames.KEY_KP_8 << 8;
  common_scanmap[33] = 224 | KeyNames.KEY_KP_9 << 8;
  common_scanmap[37] = 224 | KeyNames.KEY_KP_4 << 8;
  common_scanmap[39] = 224 | KeyNames.KEY_KP_6 << 8;
  common_scanmap[35] = 224 | KeyNames.KEY_KP_1 << 8;
  common_scanmap[40] = 224 | KeyNames.KEY_KP_2 << 8;
  common_scanmap[34] = 224 | KeyNames.KEY_KP_3 << 8;
  common_scanmap[45] = 224 | KeyNames.KEY_KP_0 << 8;
  common_scanmap[46] = 224 | KeyNames.KEY_KP_Decimal << 8;
  common_scanmap[91] = 224 | 91 << 8;
  common_scanmap[92] = 224 | 92 << 8;
  common_scanmap[93] = 224 | 93 << 8;
  var firefox_scanmap = [];
  firefox_scanmap[173] = KeyNames.KEY_Minus;
  firefox_scanmap[61] = KeyNames.KEY_Equal;
  firefox_scanmap[59] = KeyNames.KEY_SemiColon;
  var DOM_scanmap = [];
  DOM_scanmap[189] = KeyNames.KEY_Minus;
  DOM_scanmap[187] = KeyNames.KEY_Equal;
  DOM_scanmap[186] = KeyNames.KEY_SemiColon;
  function get_scancode(keyCode, code) {
    if (code_to_scancode[code] !== void 0) {
      return code_to_scancode[code];
    }
    if (common_scanmap[keyCode] === void 0) {
      if (navigator.userAgent.indexOf("Firefox") != -1)
        return firefox_scanmap[keyCode];
      else
        return DOM_scanmap[keyCode];
    } else
      return common_scanmap[keyCode];
  }
  function keycode_to_start_scan(keyCode, code) {
    var scancode = get_scancode(keyCode, code);
    if (scancode === void 0) {
      alert("no map for " + keyCode);
      return 0;
    }
    return scancode;
  }
  function keycode_to_end_scan(keyCode, code) {
    var scancode = get_scancode(keyCode, code);
    if (scancode === void 0)
      return 0;
    if (scancode < 256) {
      return scancode | 128;
    } else {
      return scancode | 32768;
    }
  }
  function dump_media_element(m) {
    var ret = "[networkState " + m.networkState + "|readyState " + m.readyState + "|error " + m.error + "|seeking " + m.seeking + "|duration " + m.duration + "|paused " + m.paused + "|ended " + m.error + "|buffered " + dump_timerange(m.buffered) + "]";
    return ret;
  }
  function dump_media_source(ms) {
    var ret = "[duration " + ms.duration + "|readyState " + ms.readyState + "]";
    return ret;
  }
  function dump_source_buffer(sb) {
    var ret = "[appendWindowStart " + sb.appendWindowStart + "|appendWindowEnd " + sb.appendWindowEnd + "|buffered " + dump_timerange(sb.buffered) + "|timeStampOffset " + sb.timeStampOffset + "|updating " + sb.updating + "]";
    return ret;
  }
  function dump_timerange(tr) {
    var ret;
    if (tr) {
      var i = tr.length;
      ret = "{len " + i;
      if (i > 0)
        ret += "; start " + tr.start(0) + "; end " + tr.end(i - 1);
      ret += "}";
    } else
      ret = "N/A";
    return ret;
  }

  // vendor/spice-html5/spicemsg.js
  function SpiceLinkHeader(a, at) {
    this.magic = Constants.SPICE_MAGIC;
    this.major_version = Constants.SPICE_VERSION_MAJOR;
    this.minor_version = Constants.SPICE_VERSION_MINOR;
    this.size = 0;
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceLinkHeader.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.magic = "";
      for (var i = 0; i < 4; i++)
        this.magic += String.fromCharCode(dv.getUint8(at + i));
      at += 4;
      this.major_version = dv.getUint32(at, true);
      at += 4;
      this.minor_version = dv.getUint32(at, true);
      at += 4;
      this.size = dv.getUint32(at, true);
      at += 4;
    },
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      for (var i = 0; i < 4; i++)
        dv.setUint8(at + i, this.magic.charCodeAt(i));
      at += 4;
      dv.setUint32(at, this.major_version, true);
      at += 4;
      dv.setUint32(at, this.minor_version, true);
      at += 4;
      dv.setUint32(at, this.size, true);
      at += 4;
    },
    buffer_size: function() {
      return 16;
    }
  };
  function SpiceLinkMess(a, at) {
    this.connection_id = 0;
    this.channel_type = 0;
    this.channel_id = 0;
    this.common_caps = [];
    this.channel_caps = [];
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceLinkMess.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var i;
      var orig_at = at;
      var dv = new SpiceDataView(a);
      this.connection_id = dv.getUint32(at, true);
      at += 4;
      this.channel_type = dv.getUint8(at, true);
      at++;
      this.channel_id = dv.getUint8(at, true);
      at++;
      var num_common_caps = dv.getUint32(at, true);
      at += 4;
      var num_channel_caps = dv.getUint32(at, true);
      at += 4;
      var caps_offset = dv.getUint32(at, true);
      at += 4;
      at = orig_at + caps_offset;
      this.common_caps = [];
      for (i = 0; i < num_common_caps; i++) {
        this.common_caps.unshift(dv.getUint32(at, true));
        at += 4;
      }
      this.channel_caps = [];
      for (i = 0; i < num_channel_caps; i++) {
        this.channel_caps.unshift(dv.getUint32(at, true));
        at += 4;
      }
    },
    to_buffer: function(a, at) {
      at = at || 0;
      var orig_at = at;
      var i;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.connection_id, true);
      at += 4;
      dv.setUint8(at, this.channel_type, true);
      at++;
      dv.setUint8(at, this.channel_id, true);
      at++;
      dv.setUint32(at, this.common_caps.length, true);
      at += 4;
      dv.setUint32(at, this.channel_caps.length, true);
      at += 4;
      dv.setUint32(at, at - orig_at + 4, true);
      at += 4;
      for (i = 0; i < this.common_caps.length; i++) {
        dv.setUint32(at, this.common_caps[i], true);
        at += 4;
      }
      for (i = 0; i < this.channel_caps.length; i++) {
        dv.setUint32(at, this.channel_caps[i], true);
        at += 4;
      }
    },
    buffer_size: function() {
      return 18 + 4 * this.common_caps.length + 4 * this.channel_caps.length;
    }
  };
  function SpiceLinkReply(a, at) {
    this.error = 0;
    this.pub_key = void 0;
    this.common_caps = [];
    this.channel_caps = [];
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceLinkReply.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var i;
      var orig_at = at;
      var dv = new SpiceDataView(a);
      this.error = dv.getUint32(at, true);
      at += 4;
      this.pub_key = create_rsa_from_mb(a, at);
      at += Constants.SPICE_TICKET_PUBKEY_BYTES;
      var num_common_caps = dv.getUint32(at, true);
      at += 4;
      var num_channel_caps = dv.getUint32(at, true);
      at += 4;
      var caps_offset = dv.getUint32(at, true);
      at += 4;
      at = orig_at + caps_offset;
      this.common_caps = [];
      for (i = 0; i < num_common_caps; i++) {
        this.common_caps.unshift(dv.getUint32(at, true));
        at += 4;
      }
      this.channel_caps = [];
      for (i = 0; i < num_channel_caps; i++) {
        this.channel_caps.unshift(dv.getUint32(at, true));
        at += 4;
      }
    }
  };
  function SpiceLinkAuthTicket(a, at) {
    this.auth_mechanism = 0;
    this.encrypted_data = void 0;
  }
  SpiceLinkAuthTicket.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var i;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.auth_mechanism, true);
      at += 4;
      for (i = 0; i < Constants.SPICE_TICKET_KEY_PAIR_LENGTH / 8; i++) {
        if (this.encrypted_data && i < this.encrypted_data.length)
          dv.setUint8(at, this.encrypted_data[i], true);
        else
          dv.setUint8(at, 0, true);
        at++;
      }
    },
    buffer_size: function() {
      return 4 + Constants.SPICE_TICKET_KEY_PAIR_LENGTH / 8;
    }
  };
  function SpiceLinkAuthReply(a, at) {
    this.auth_code = 0;
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceLinkAuthReply.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.auth_code = dv.getUint32(at, true);
      at += 4;
    },
    buffer_size: function() {
      return 4;
    }
  };
  function SpiceMiniData(a, at) {
    this.type = 0;
    this.size = 0;
    this.data = void 0;
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceMiniData.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var i;
      var dv = new SpiceDataView(a);
      this.type = dv.getUint16(at, true);
      at += 2;
      this.size = dv.getUint32(at, true);
      at += 4;
      if (a.byteLength > at) {
        this.data = a.slice(at);
        at += this.data.byteLength;
      }
    },
    to_buffer: function(a, at) {
      at = at || 0;
      var i;
      var dv = new SpiceDataView(a);
      dv.setUint16(at, this.type, true);
      at += 2;
      dv.setUint32(at, this.data ? this.data.byteLength : 0, true);
      at += 4;
      if (this.data && this.data.byteLength > 0) {
        var u8arr = new Uint8Array(this.data);
        for (i = 0; i < u8arr.length; i++, at++)
          dv.setUint8(at, u8arr[i], true);
      }
    },
    build_msg: function(in_type, extra) {
      this.type = in_type;
      this.size = extra.buffer_size();
      this.data = new ArrayBuffer(this.size);
      extra.to_buffer(this.data);
    },
    buffer_size: function() {
      if (this.data)
        return 6 + this.data.byteLength;
      else
        return 6;
    }
  };
  function SpiceMsgChannels(a, at) {
    this.num_of_channels = 0;
    this.channels = [];
    if (a !== void 0)
      this.from_buffer(a, at);
  }
  SpiceMsgChannels.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var i;
      var dv = new SpiceDataView(a);
      this.num_of_channels = dv.getUint32(at, true);
      at += 4;
      for (i = 0; i < this.num_of_channels; i++) {
        var chan = new SpiceChannelId();
        at = chan.from_dv(dv, at, a);
        this.channels.push(chan);
      }
    }
  };
  function hasClipboardSelection(caps) {
    return (caps[0] >> Constants.VD_AGENT_CAP_CLIPBOARD_SELECTION & 1) != 0;
  }
  function SpiceMsgClipboardGrab(type, caps) {
    this.has_clipboard_selection = hasClipboardSelection(caps);
    this.type = type;
  }
  SpiceMsgClipboardGrab.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      if (this.has_clipboard_selection) {
        dv.setUint32(at, 0, true);
        at += 4;
      }
      dv.setUint32(at, this.type, true);
      at += 4;
    },
    buffer_size: function() {
      return this.has_clipboard_selection ? 8 : 4;
    }
  };
  function SpiceMsgClipboardReceive(agent_data, caps) {
    this.has_clipboard_selection = hasClipboardSelection(caps);
    const dv = new DataView(agent_data.data);
    var at = this.has_clipboard_selection ? 4 : 0;
    this.type = dv.getUint32(at, true);
    at += 4;
    this.payload = agent_data.data.slice(at);
  }
  SpiceMsgClipboardReceive.prototype = {
    get_text: function() {
      return new TextDecoder("utf-8").decode(this.payload);
    }
  };
  function SpiceMsgClipboardRequest(type, caps) {
    this.has_clipboard_selection = hasClipboardSelection(caps);
    this.type = type;
  }
  SpiceMsgClipboardRequest.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      if (this.has_clipboard_selection) {
        dv.setUint32(at, 0, true);
        at += 4;
      }
      dv.setUint32(at, this.type, true);
      at += 4;
    },
    buffer_size: function() {
      return this.has_clipboard_selection ? 8 : 4;
    }
  };
  function SpiceMsgClipboardSend(type, text, caps) {
    this.has_clipboard_selection = hasClipboardSelection(caps);
    this.type = type;
    this.text = text;
  }
  SpiceMsgClipboardSend.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      const dv = new SpiceDataView(a);
      if (this.has_clipboard_selection) {
        dv.setUint32(at, 0, true);
        at += 4;
      }
      dv.setUint32(at, this.type, true);
      at += 4;
      const payload = new TextEncoder().encode(this.text);
      new Uint8Array(a, at, payload.byteLength).set(payload);
      at += payload.byteLength;
    },
    buffer_size: function() {
      const payloadLength = new TextEncoder().encode(this.text).byteLength;
      return (this.has_clipboard_selection ? 8 : 4) + payloadLength;
    }
  };
  function SpiceMsgMainInit(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgMainInit.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.session_id = dv.getUint32(at, true);
      at += 4;
      this.display_channels_hint = dv.getUint32(at, true);
      at += 4;
      this.supported_mouse_modes = dv.getUint32(at, true);
      at += 4;
      this.current_mouse_mode = dv.getUint32(at, true);
      at += 4;
      this.agent_connected = dv.getUint32(at, true);
      at += 4;
      this.agent_tokens = dv.getUint32(at, true);
      at += 4;
      this.multi_media_time = dv.getUint32(at, true);
      at += 4;
      this.ram_hint = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgMainMouseMode(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgMainMouseMode.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.supported_modes = dv.getUint16(at, true);
      at += 2;
      this.current_mode = dv.getUint16(at, true);
      at += 2;
    }
  };
  function SpiceMsgMainAgentData(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgMainAgentData.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.protocol = dv.getUint32(at, true);
      at += 4;
      this.type = dv.getUint32(at, true);
      at += 4;
      this.opaque = dv.getUint64(at, true);
      at += 8;
      this.size = dv.getUint32(at, true);
      at += 4;
      if (a.byteLength > at) {
        this.data = a.slice(at);
        at += this.data.byteLength;
      }
    }
  };
  function SpiceMsgMainAgentTokens(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgMainAgentTokens.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.num_tokens = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgSetAck(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgSetAck.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.generation = dv.getUint32(at, true);
      at += 4;
      this.window = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgcAckSync(ack) {
    this.generation = ack.generation;
  }
  SpiceMsgcAckSync.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.generation, true);
      at += 4;
    },
    buffer_size: function() {
      return 4;
    }
  };
  function SpiceMsgcMainMouseModeRequest(mode) {
    this.mode = mode;
  }
  SpiceMsgcMainMouseModeRequest.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint16(at, this.mode, true);
      at += 2;
    },
    buffer_size: function() {
      return 2;
    }
  };
  function SpiceMsgcMainAgentStart(num_tokens) {
    this.num_tokens = num_tokens;
  }
  SpiceMsgcMainAgentStart.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.num_tokens, true);
      at += 4;
    },
    buffer_size: function() {
      return 4;
    }
  };
  function SpiceMsgcMainAgentData(type, data) {
    this.protocol = Constants.VD_AGENT_PROTOCOL;
    this.type = type;
    this.opaque = 0;
    this.size = data.buffer_size();
    this.data = data;
  }
  SpiceMsgcMainAgentData.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.protocol, true);
      at += 4;
      dv.setUint32(at, this.type, true);
      at += 4;
      dv.setUint64(at, this.opaque, true);
      at += 8;
      dv.setUint32(at, this.size, true);
      at += 4;
      this.data.to_buffer(a, at);
    },
    buffer_size: function() {
      return 4 + 4 + 8 + 4 + this.data.buffer_size();
    }
  };
  function VDAgentAnnounceCapabilities(request, caps) {
    if (caps) {
      this.request = request;
      this.caps = caps;
    } else
      this.from_buffer(request);
  }
  VDAgentAnnounceCapabilities.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.request, true);
      at += 4;
      dv.setUint32(at, this.caps, true);
      at += 4;
    },
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.request = dv.getUint32(at, true);
      at += 4;
      this.caps = dv.getUint32(at, true);
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 8;
    }
  };
  function VDAgentMonitorsConfig(flags, width, height, depth, x, y) {
    this.num_mon = 1;
    this.flags = flags;
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.x = x;
    this.y = y;
  }
  VDAgentMonitorsConfig.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.num_mon, true);
      at += 4;
      dv.setUint32(at, this.flags, true);
      at += 4;
      dv.setUint32(at, this.height, true);
      at += 4;
      dv.setUint32(at, this.width, true);
      at += 4;
      dv.setUint32(at, this.depth, true);
      at += 4;
      dv.setUint32(at, this.x, true);
      at += 4;
      dv.setUint32(at, this.y, true);
      at += 4;
    },
    buffer_size: function() {
      return 28;
    }
  };
  function VDAgentFileXferStatusMessage(data, result) {
    if (result) {
      this.id = data;
      this.result = result;
    } else
      this.from_buffer(data);
  }
  VDAgentFileXferStatusMessage.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.id, true);
      at += 4;
      dv.setUint32(at, this.result, true);
      at += 4;
    },
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.id = dv.getUint32(at, true);
      at += 4;
      this.result = dv.getUint32(at, true);
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 8;
    }
  };
  function VDAgentFileXferStartMessage(id, name, size) {
    this.id = id;
    this.string = "[vdagent-file-xfer]\nname=" + name + "\nsize=" + size + "\n";
  }
  VDAgentFileXferStartMessage.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.id, true);
      at += 4;
      for (var i = 0; i < this.string.length; i++, at++)
        dv.setUint8(at, this.string.charCodeAt(i));
    },
    buffer_size: function() {
      return 4 + this.string.length + 1;
    }
  };
  function VDAgentFileXferDataMessage(id, size, data) {
    this.id = id;
    this.size = size;
    this.data = data;
  }
  VDAgentFileXferDataMessage.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.id, true);
      at += 4;
      dv.setUint64(at, this.size, true);
      at += 8;
      if (this.data && this.data.byteLength > 0) {
        var u8arr = new Uint8Array(this.data);
        for (var i = 0; i < u8arr.length; i++, at++)
          dv.setUint8(at, u8arr[i]);
      }
    },
    buffer_size: function() {
      return 12 + this.size;
    }
  };
  function SpiceMsgNotify(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgNotify.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var i;
      var dv = new SpiceDataView(a);
      this.time_stamp = dv.getUint64(at, true);
      at += 8;
      this.severity = dv.getUint32(at, true);
      at += 4;
      this.visibility = dv.getUint32(at, true);
      at += 4;
      this.what = dv.getUint32(at, true);
      at += 4;
      this.message_len = dv.getUint32(at, true);
      at += 4;
      this.message = "";
      for (i = 0; i < this.message_len; i++) {
        var c = dv.getUint8(at, true);
        at++;
        this.message += String.fromCharCode(c);
      }
    }
  };
  function SpiceMsgcDisplayInit() {
    this.pixmap_cache_id = 1;
    this.glz_dictionary_id = 0;
    this.pixmap_cache_size = 10 * 1024 * 1024;
    this.glz_dictionary_window_size = 0;
  }
  SpiceMsgcDisplayInit.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint8(at, this.pixmap_cache_id, true);
      at++;
      dv.setUint64(at, this.pixmap_cache_size, true);
      at += 8;
      dv.setUint8(at, this.glz_dictionary_id, true);
      at++;
      dv.setUint32(at, this.glz_dictionary_window_size, true);
      at += 4;
    },
    buffer_size: function() {
      return 14;
    }
  };
  function SpiceMsgDisplayBase() {
  }
  SpiceMsgDisplayBase.prototype = {
    from_dv: function(dv, at, mb) {
      this.surface_id = dv.getUint32(at, true);
      at += 4;
      this.box = new SpiceRect();
      at = this.box.from_dv(dv, at, mb);
      this.clip = new SpiceClip();
      return this.clip.from_dv(dv, at, mb);
    }
  };
  function SpiceMsgDisplayDrawCopy(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayDrawCopy.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.base = new SpiceMsgDisplayBase();
      at = this.base.from_dv(dv, at, a);
      this.data = new SpiceCopy();
      return this.data.from_dv(dv, at, a);
    }
  };
  function SpiceMsgDisplayDrawFill(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayDrawFill.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.base = new SpiceMsgDisplayBase();
      at = this.base.from_dv(dv, at, a);
      this.data = new SpiceFill();
      return this.data.from_dv(dv, at, a);
    }
  };
  function SpiceMsgDisplayCopyBits(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayCopyBits.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.base = new SpiceMsgDisplayBase();
      at = this.base.from_dv(dv, at, a);
      this.src_pos = new SpicePoint();
      return this.src_pos.from_dv(dv, at, a);
    }
  };
  function SpiceMsgSurfaceCreate(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgSurfaceCreate.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.surface = new SpiceSurface();
      return this.surface.from_dv(dv, at, a);
    }
  };
  function SpiceMsgSurfaceDestroy(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgSurfaceDestroy.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.surface_id = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgInputsInit(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgInputsInit.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.keyboard_modifiers = dv.getUint16(at, true);
      at += 2;
      return at;
    }
  };
  function SpiceMsgInputsKeyModifiers(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgInputsKeyModifiers.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.keyboard_modifiers = dv.getUint16(at, true);
      at += 2;
      return at;
    }
  };
  function SpiceMsgCursorInit(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgCursorInit.prototype = {
    from_buffer: function(a, at, mb) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.position = new SpicePoint16();
      at = this.position.from_dv(dv, at, mb);
      this.trail_length = dv.getUint16(at, true);
      at += 2;
      this.trail_frequency = dv.getUint16(at, true);
      at += 2;
      this.visible = dv.getUint8(at, true);
      at++;
      this.cursor = new SpiceCursor();
      return this.cursor.from_dv(dv, at, a);
    }
  };
  function SpiceMsgPlaybackData(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgPlaybackData.prototype = {
    from_buffer: function(a, at, mb) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.time = dv.getUint32(at, true);
      at += 4;
      if (a.byteLength > at) {
        this.data = a.slice(at);
        at += this.data.byteLength;
      }
      return at;
    }
  };
  function SpiceMsgPlaybackMode(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgPlaybackMode.prototype = {
    from_buffer: function(a, at, mb) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.time = dv.getUint32(at, true);
      at += 4;
      this.mode = dv.getUint16(at, true);
      at += 2;
      if (a.byteLength > at) {
        this.data = a.slice(at);
        at += this.data.byteLength;
      }
      return at;
    }
  };
  function SpiceMsgPlaybackStart(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgPlaybackStart.prototype = {
    from_buffer: function(a, at, mb) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.channels = dv.getUint32(at, true);
      at += 4;
      this.format = dv.getUint16(at, true);
      at += 2;
      this.frequency = dv.getUint32(at, true);
      at += 4;
      this.time = dv.getUint32(at, true);
      at += 4;
      return at;
    }
  };
  function SpiceMsgCursorSet(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgCursorSet.prototype = {
    from_buffer: function(a, at, mb) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.position = new SpicePoint16();
      at = this.position.from_dv(dv, at, mb);
      this.visible = dv.getUint8(at, true);
      at++;
      this.cursor = new SpiceCursor();
      return this.cursor.from_dv(dv, at, a);
    }
  };
  function SpiceMsgcMousePosition(sc, e) {
    this.display_id = 0;
    this.buttons_state = sc.buttons_state;
    if (e) {
      this.x = e.offsetX;
      this.y = e.offsetY;
      sc.mousex = e.offsetX;
      sc.mousey = e.offsetY;
    } else {
      this.x = this.y = this.buttons_state = 0;
    }
  }
  SpiceMsgcMousePosition.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.x, true);
      at += 4;
      dv.setUint32(at, this.y, true);
      at += 4;
      dv.setUint16(at, this.buttons_state, true);
      at += 2;
      dv.setUint8(at, this.display_id, true);
      at += 1;
      return at;
    },
    buffer_size: function() {
      return 11;
    }
  };
  function SpiceMsgcMouseMotion(sc, e) {
    this.display_id = 0;
    this.buttons_state = sc.buttons_state;
    if (e) {
      this.x = e.offsetX;
      this.y = e.offsetY;
      if (sc.mousex !== void 0) {
        this.x -= sc.mousex;
        this.y -= sc.mousey;
      }
      sc.mousex = e.offsetX;
      sc.mousey = e.offsetY;
    } else {
      this.x = this.y = this.buttons_state = 0;
    }
  }
  SpiceMsgcMouseMotion.prototype.to_buffer = SpiceMsgcMousePosition.prototype.to_buffer;
  SpiceMsgcMouseMotion.prototype.buffer_size = SpiceMsgcMousePosition.prototype.buffer_size;
  function SpiceMsgcMousePress(sc, e) {
    if (e) {
      this.button = e.button + 1;
      this.buttons_state = 1 << e.button;
      sc.buttons_state = this.buttons_state;
    } else {
      this.button = Constants.SPICE_MOUSE_BUTTON_LEFT;
      this.buttons_state = Constants.SPICE_MOUSE_BUTTON_MASK_LEFT;
    }
  }
  SpiceMsgcMousePress.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint8(at, this.button, true);
      at++;
      dv.setUint16(at, this.buttons_state, true);
      at += 2;
      return at;
    },
    buffer_size: function() {
      return 3;
    }
  };
  function SpiceMsgcMouseRelease(sc, e) {
    if (e) {
      this.button = e.button + 1;
      this.buttons_state = 0;
      sc.buttons_state = this.buttons_state;
    } else {
      this.button = Constants.SPICE_MOUSE_BUTTON_LEFT;
      this.buttons_state = 0;
    }
  }
  SpiceMsgcMouseRelease.prototype.to_buffer = SpiceMsgcMousePress.prototype.to_buffer;
  SpiceMsgcMouseRelease.prototype.buffer_size = SpiceMsgcMousePress.prototype.buffer_size;
  function SpiceMsgcKeyDown(e) {
    if (e) {
      this.code = keycode_to_start_scan(e.keyCode, e.code);
    } else {
      this.code = 0;
    }
  }
  SpiceMsgcKeyDown.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.code, true);
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 4;
    }
  };
  function SpiceMsgcKeyUp(e) {
    if (e) {
      this.code = keycode_to_end_scan(e.keyCode, e.code);
    } else {
      this.code = 0;
    }
  }
  SpiceMsgcKeyUp.prototype.to_buffer = SpiceMsgcKeyDown.prototype.to_buffer;
  SpiceMsgcKeyUp.prototype.buffer_size = SpiceMsgcKeyDown.prototype.buffer_size;
  function SpiceMsgDisplayStreamCreate(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamCreate.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.surface_id = dv.getUint32(at, true);
      at += 4;
      this.id = dv.getUint32(at, true);
      at += 4;
      this.flags = dv.getUint8(at, true);
      at += 1;
      this.codec_type = dv.getUint8(at, true);
      at += 1;
      this.stamp = dv.getUint64(at, true);
      at += 8;
      this.stream_width = dv.getUint32(at, true);
      at += 4;
      this.stream_height = dv.getUint32(at, true);
      at += 4;
      this.src_width = dv.getUint32(at, true);
      at += 4;
      this.src_height = dv.getUint32(at, true);
      at += 4;
      this.dest = new SpiceRect();
      at = this.dest.from_dv(dv, at, a);
      this.clip = new SpiceClip();
      this.clip.from_dv(dv, at, a);
    }
  };
  function SpiceStreamDataHeader(a, at) {
  }
  SpiceStreamDataHeader.prototype = {
    from_dv: function(dv, at, mb) {
      this.id = dv.getUint32(at, true);
      at += 4;
      this.multi_media_time = dv.getUint32(at, true);
      at += 4;
      return at;
    }
  };
  function SpiceMsgDisplayStreamData(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamData.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.base = new SpiceStreamDataHeader();
      at = this.base.from_dv(dv, at, a);
      this.data_size = dv.getUint32(at, true);
      at += 4;
      this.data = dv.u8.subarray(at, at + this.data_size);
    }
  };
  function SpiceMsgDisplayStreamDataSized(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamDataSized.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.base = new SpiceStreamDataHeader();
      at = this.base.from_dv(dv, at, a);
      this.width = dv.getUint32(at, true);
      at += 4;
      this.height = dv.getUint32(at, true);
      at += 4;
      this.dest = new SpiceRect();
      at = this.dest.from_dv(dv, at, a);
      this.data_size = dv.getUint32(at, true);
      at += 4;
      this.data = dv.u8.subarray(at, at + this.data_size);
    }
  };
  function SpiceMsgDisplayStreamClip(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamClip.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.id = dv.getUint32(at, true);
      at += 4;
      this.clip = new SpiceClip();
      this.clip.from_dv(dv, at, a);
    }
  };
  function SpiceMsgDisplayStreamDestroy(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamDestroy.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.id = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgDisplayStreamActivateReport(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayStreamActivateReport.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.stream_id = dv.getUint32(at, true);
      at += 4;
      this.unique_id = dv.getUint32(at, true);
      at += 4;
      this.max_window_size = dv.getUint32(at, true);
      at += 4;
      this.timeout_ms = dv.getUint32(at, true);
      at += 4;
    }
  };
  function SpiceMsgcDisplayStreamReport(stream_id, unique_id) {
    this.stream_id = stream_id;
    this.unique_id = unique_id;
    this.start_frame_mm_time = 0;
    this.end_frame_mm_time = 0;
    this.num_frames = 0;
    this.num_drops = 0;
    this.last_frame_delay = 0;
    this.audio_delay = -1;
  }
  SpiceMsgcDisplayStreamReport.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.stream_id, true);
      at += 4;
      dv.setUint32(at, this.unique_id, true);
      at += 4;
      dv.setUint32(at, this.start_frame_mm_time, true);
      at += 4;
      dv.setUint32(at, this.end_frame_mm_time, true);
      at += 4;
      dv.setUint32(at, this.num_frames, true);
      at += 4;
      dv.setUint32(at, this.num_drops, true);
      at += 4;
      dv.setUint32(at, this.last_frame_delay, true);
      at += 4;
      dv.setUint32(at, this.audio_delay, true);
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 8 * 4;
    }
  };
  function SpiceMsgDisplayInvalList(a, at) {
    this.count = 0;
    this.resources = [];
    this.from_buffer(a, at);
  }
  SpiceMsgDisplayInvalList.prototype = {
    from_buffer: function(a, at) {
      var i;
      at = at || 0;
      var dv = new SpiceDataView(a);
      this.count = dv.getUint16(at, true);
      at += 2;
      for (i = 0; i < this.count; i++) {
        this.resources[i] = {};
        this.resources[i].type = dv.getUint8(at, true);
        at++;
        this.resources[i].id = dv.getUint64(at, true);
        at += 8;
      }
    }
  };
  function SpiceMsgPortInit(a, at) {
    this.from_buffer(a, at);
  }
  SpiceMsgPortInit.prototype = {
    from_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      var namesize = dv.getUint32(at, true);
      at += 4;
      var offset = dv.getUint32(at, true);
      at += 4;
      this.opened = dv.getUint8(at, true);
      at += 1;
      this.name = a.slice(offset, offset + namesize - 1);
    }
  };

  // vendor/spice-html5/png.js
  var rfc2083_crc_table = Array(256);
  var rfc2083_crc_table_computed = 0;
  function rfc2083_make_crc_table() {
    var c;
    var n, k;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) {
        if (c & 1)
          c = (3988292384 ^ c >>> 1) >>> 0 & 4294967295;
        else
          c = c >>> 1;
      }
      rfc2083_crc_table[n] = c;
    }
    rfc2083_crc_table_computed = 1;
  }
  function rfc2083_update_crc(crc, u8buf, at, len) {
    var c = crc;
    var n;
    if (!rfc2083_crc_table_computed)
      rfc2083_make_crc_table();
    for (n = 0; n < len; n++) {
      c = rfc2083_crc_table[(c ^ u8buf[at + n]) & 255] ^ c >>> 8;
    }
    return c;
  }
  function rfc2083_crc(u8buf, at, len) {
    return rfc2083_update_crc(4294967295, u8buf, at, len) ^ 4294967295;
  }
  function crc32(mb, at, len) {
    var u8 = new Uint8Array(mb);
    return rfc2083_crc(u8, at, len);
  }
  function PngIHDR(width, height) {
    this.width = width;
    this.height = height;
    this.depth = 8;
    this.type = 6;
    this.compression = 0;
    this.filter = 0;
    this.interlace = 0;
  }
  PngIHDR.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var orig = at;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.buffer_size() - 12);
      at += 4;
      dv.setUint8(at, "I".charCodeAt(0));
      at++;
      dv.setUint8(at, "H".charCodeAt(0));
      at++;
      dv.setUint8(at, "D".charCodeAt(0));
      at++;
      dv.setUint8(at, "R".charCodeAt(0));
      at++;
      dv.setUint32(at, this.width);
      at += 4;
      dv.setUint32(at, this.height);
      at += 4;
      dv.setUint8(at, this.depth);
      at++;
      dv.setUint8(at, this.type);
      at++;
      dv.setUint8(at, this.compression);
      at++;
      dv.setUint8(at, this.filter);
      at++;
      dv.setUint8(at, this.interlace);
      at++;
      dv.setUint32(at, crc32(a, orig + 4, this.buffer_size() - 8));
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 12 + 13;
    }
  };
  function adler() {
    this.s1 = 1;
    this.s2 = 0;
  }
  adler.prototype.update = function(b) {
    this.s1 += b;
    this.s1 %= 65521;
    this.s2 += this.s1;
    this.s2 %= 65521;
  };
  function PngIDAT(width, height, bytes) {
    if (bytes.byteLength > 65535) {
      throw new Error("Cannot handle more than 64K");
    }
    this.data = bytes;
    this.width = width;
    this.height = height;
  }
  PngIDAT.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var orig = at;
      var x, y, i, j;
      var dv = new SpiceDataView(a);
      var zsum = new adler();
      dv.setUint32(at, this.buffer_size() - 12);
      at += 4;
      dv.setUint8(at, "I".charCodeAt(0));
      at++;
      dv.setUint8(at, "D".charCodeAt(0));
      at++;
      dv.setUint8(at, "A".charCodeAt(0));
      at++;
      dv.setUint8(at, "T".charCodeAt(0));
      at++;
      dv.setUint8(at, 120);
      at++;
      dv.setUint8(at, 1);
      at++;
      dv.setUint8(at, 128);
      at++;
      dv.setUint16(at, this.data.byteLength + this.height);
      at += 2;
      dv.setUint16(at, ~(this.data.byteLength + this.height));
      at += 2;
      var u8 = new Uint8Array(this.data);
      for (i = 0, y = 0; y < this.height; y++) {
        dv.setUint8(at, 0);
        at++;
        zsum.update(0);
        for (x = 0; x < this.width && i < this.data.byteLength; x++) {
          zsum.update(u8[i]);
          dv.setUint8(at, u8[i++]);
          at++;
          zsum.update(u8[i]);
          dv.setUint8(at, u8[i++]);
          at++;
          zsum.update(u8[i]);
          dv.setUint8(at, u8[i++]);
          at++;
          zsum.update(u8[i]);
          dv.setUint8(at, u8[i++]);
          at++;
        }
      }
      dv.setUint16(at, zsum.s2);
      at += 2;
      dv.setUint16(at, zsum.s1);
      at += 2;
      dv.setUint32(at, crc32(a, orig + 4, this.buffer_size() - 8));
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 12 + this.data.byteLength + this.height + 4 + 2 + 1 + 2 + 2;
    }
  };
  function PngIEND() {
  }
  PngIEND.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var orig = at;
      var i;
      var dv = new SpiceDataView(a);
      dv.setUint32(at, this.buffer_size() - 12);
      at += 4;
      dv.setUint8(at, "I".charCodeAt(0));
      at++;
      dv.setUint8(at, "E".charCodeAt(0));
      at++;
      dv.setUint8(at, "N".charCodeAt(0));
      at++;
      dv.setUint8(at, "D".charCodeAt(0));
      at++;
      dv.setUint32(at, crc32(a, orig + 4, this.buffer_size() - 8));
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 12;
    }
  };
  function create_rgba_png(width, height, bytes) {
    var i;
    var ihdr = new PngIHDR(width, height);
    var idat = new PngIDAT(width, height, bytes);
    var iend = new PngIEND();
    var mb = new ArrayBuffer(ihdr.buffer_size() + idat.buffer_size() + iend.buffer_size());
    var at = ihdr.to_buffer(mb);
    at = idat.to_buffer(mb, at);
    at = iend.to_buffer(mb, at);
    var u8 = new Uint8Array(mb);
    var str = "";
    for (i = 0; i < at; i++) {
      str += "%";
      if (u8[i] < 16)
        str += "0";
      str += u8[i].toString(16);
    }
    return "%89PNG%0D%0A%1A%0A" + str;
  }

  // vendor/spice-html5/simulatecursor.js
  var SpiceSimulateCursor = {
    cursors: new Array(),
    unknown_cursors: new Array(),
    warned: false,
    add_cursor: function(sha1, value) {
      SpiceSimulateCursor.cursors[sha1] = value;
    },
    unknown_cursor: function(sha1, curdata) {
      if (!SpiceSimulateCursor.warned) {
        SpiceSimulateCursor.warned = true;
        alert("Internet Explorer does not support dynamic cursors.  This page will now simulate cursors with images, which will be imperfect.  We recommend using Chrome or Firefox instead.  \n\nIf you need to use Internet Explorer, you can create a static cursor file for each cursor your application uses.  View the console log for more information on creating static cursors for your environment.");
      }
      if (!SpiceSimulateCursor.unknown_cursors[sha1]) {
        SpiceSimulateCursor.unknown_cursors[sha1] = curdata;
        console.log("Unknown cursor.  Simulation required.  To avoid simulation for this cursor, create and include a custom javascript file, and add the following line:");
        console.log('SpiceCursorSimulator.add_cursor("' + sha1 + '"), "<your filename here>.cur");');
        console.log("And then run following command, redirecting output into <your filename here>.cur:");
        console.log(`php -r "echo urldecode('` + curdata + `');"`);
      }
    },
    simulate_cursor: function(spicecursor, cursor, screen, pngstr) {
      var cursor_sha = hex_sha1(pngstr + " " + cursor.header.hot_spot_x + " " + cursor.header.hot_spot_y);
      if (typeof SpiceSimulateCursor.cursors != "undefined") {
        if (typeof SpiceSimulateCursor.cursors[cursor_sha] != "undefined") {
          var curstr = "url(" + SpiceSimulateCursor.cursors[cursor_sha] + "), default";
          screen.style.cursor = curstr;
        }
      }
      if (window.getComputedStyle(screen, null).cursor == "auto") {
        SpiceSimulateCursor.unknown_cursor(
          cursor_sha,
          SpiceSimulateCursor.create_icondir(
            cursor.header.width,
            cursor.header.height,
            cursor.data.byteLength,
            cursor.header.hot_spot_x,
            cursor.header.hot_spot_y
          ) + pngstr
        );
        document.getElementById(spicecursor.parent.screen_id).style.cursor = "none";
        if (!spicecursor.spice_simulated_cursor) {
          spicecursor.spice_simulated_cursor = document.createElement("img");
          spicecursor.spice_simulated_cursor.style.position = "absolute";
          spicecursor.spice_simulated_cursor.style.display = "none";
          spicecursor.spice_simulated_cursor.style.overflow = "hidden";
          spicecursor.spice_simulated_cursor.spice_screen = document.getElementById(spicecursor.parent.screen_id);
          spicecursor.spice_simulated_cursor.addEventListener("mousemove", SpiceSimulateCursor.handle_sim_mousemove);
          spicecursor.spice_simulated_cursor.spice_screen.appendChild(spicecursor.spice_simulated_cursor);
        }
        spicecursor.spice_simulated_cursor.src = "data:image/png," + pngstr;
        spicecursor.spice_simulated_cursor.spice_hot_x = cursor.header.hot_spot_x;
        spicecursor.spice_simulated_cursor.spice_hot_y = cursor.header.hot_spot_y;
        spicecursor.spice_simulated_cursor.style.pointerEvents = "none";
      } else {
        if (spicecursor.spice_simulated_cursor) {
          spicecursor.spice_simulated_cursor.spice_screen.removeChild(spicecursor.spice_simulated_cursor);
          delete spicecursor.spice_simulated_cursor;
        }
      }
    },
    handle_sim_mousemove: function(e) {
      var retval;
      var f = SpiceSimulateCursor.duplicate_mouse_event(e, this.spice_screen);
      return this.spice_screen.dispatchEvent(f);
    },
    duplicate_mouse_event: function(e, target) {
      var evt = document.createEvent("mouseevent");
      evt.initMouseEvent(
        e.type,
        true,
        true,
        e.view,
        e.detail,
        e.screenX,
        e.screenY,
        e.clientX,
        e.clientY,
        e.ctrlKey,
        e.altKey,
        e.shiftKey,
        e.metaKey,
        e.button,
        e.relatedTarget
      );
      return evt;
    },
    ICONDIR: function() {
    },
    ICONDIRENTRY: function(width, height, bytes, hot_x, hot_y) {
      this.width = width;
      this.height = height;
      this.bytes = bytes;
      this.hot_x = hot_x;
      this.hot_y = hot_y;
    },
    create_icondir: function(width, height, bytes, hot_x, hot_y) {
      var i;
      var header = new SpiceSimulateCursor.ICONDIR();
      var entry = new SpiceSimulateCursor.ICONDIRENTRY(width, height, bytes, hot_x, hot_y);
      var mb = new ArrayBuffer(header.buffer_size() + entry.buffer_size());
      var at = header.to_buffer(mb);
      at = entry.to_buffer(mb, at);
      var u8 = new Uint8Array(mb);
      var str = "";
      for (i = 0; i < at; i++) {
        str += "%";
        if (u8[i] < 16)
          str += "0";
        str += u8[i].toString(16);
      }
      return str;
    }
  };
  SpiceSimulateCursor.ICONDIR.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint16(at, 0, true);
      at += 2;
      dv.setUint16(at, 2, true);
      at += 2;
      dv.setUint16(at, 1, true);
      at += 2;
      return at;
    },
    buffer_size: function() {
      return 6;
    }
  };
  SpiceSimulateCursor.ICONDIRENTRY.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new SpiceDataView(a);
      dv.setUint8(at, this.width);
      at++;
      dv.setUint8(at, this.height);
      at++;
      dv.setUint8(at, 0);
      at++;
      dv.setUint8(at, 0);
      at++;
      dv.setUint16(at, this.hot_x, true);
      at += 2;
      dv.setUint16(at, this.hot_y, true);
      at += 2;
      dv.setUint32(at, this.bytes, true);
      at += 4;
      dv.setUint32(at, at + 4, true);
      at += 4;
      return at;
    },
    buffer_size: function() {
      return 16;
    }
  };

  // vendor/spice-html5/wire.js
  function SpiceWireReader(sc, callback) {
    this.sc = sc;
    this.callback = callback;
    this.needed = 0;
    this.size = 0;
    this.buffers = [];
    this.sc.ws.wire_reader = this;
    this.sc.ws.binaryType = "arraybuffer";
    this.sc.ws.addEventListener("message", wire_blob_catcher);
  }
  SpiceWireReader.prototype = {
    /*------------------------------------------------------------------------
    **  Process messages coming in from our WebSocket
    **----------------------------------------------------------------------*/
    inbound: function(mb) {
      var at;
      if (this.needed == 0) {
        this.buffers.push(mb);
        this.size += mb.byteLength;
        return;
      }
      if (this.buffers.length == 0 && mb.byteLength >= this.needed) {
        if (mb.byteLength > this.needed) {
          this.size = mb.byteLength - this.needed;
          this.buffers.push(mb.slice(this.needed));
          mb = mb.slice(0, this.needed);
        }
        this.callback.call(
          this.sc,
          mb,
          this.saved_msg_header || void 0
        );
      } else {
        this.buffers.push(mb);
        this.size += mb.byteLength;
      }
      while (this.size >= this.needed) {
        var count = 0;
        var frame = new ArrayBuffer(this.needed);
        var view = new Uint8Array(frame);
        while (count < frame.byteLength && this.buffers.length > 0) {
          var buf = this.buffers.shift();
          if (!buf) {
            return;
          }
          var uint8 = new Uint8Array(buf);
          var step = frame.byteLength - count;
          if (uint8.length <= step) {
            view.set(uint8, count);
            count += uint8.length;
            this.size -= uint8.length;
          } else {
            var temp = uint8.slice(0, step);
            view.set(temp, count);
            count += temp.length;
            this.size -= temp.length;
            this.buffers.unshift(uint8.slice(step));
          }
        }
        this.callback.call(this.sc, frame, this.saved_msg_header || void 0);
      }
    },
    request: function(n) {
      this.needed = n;
    },
    save_header: function(h) {
      this.saved_msg_header = h;
    },
    clear_header: function() {
      this.saved_msg_header = void 0;
    }
  };
  function wire_blob_catcher(e) {
    DEBUG > 1 && console.log(">> WebSockets.onmessage");
    DEBUG > 1 && console.log("id " + this.wire_reader.sc.connection_id + "; type " + this.wire_reader.sc.type);
    SpiceWireReader.prototype.inbound.call(this.wire_reader, e.data);
  }

  // vendor/spice-html5/webm.js
  var EBML_HEADER = [26, 69, 223, 163];
  var EBML_HEADER_VERSION = [66, 134];
  var EBML_HEADER_READ_VERSION = [66, 247];
  var EBML_HEADER_MAX_ID_LENGTH = [66, 242];
  var EBML_HEADER_MAX_SIZE_LENGTH = [66, 243];
  var EBML_HEADER_DOC_TYPE = [66, 130];
  var EBML_HEADER_DOC_TYPE_VERSION = [66, 135];
  var EBML_HEADER_DOC_TYPE_READ_VERSION = [66, 133];
  var WEBM_SEGMENT_HEADER = [24, 83, 128, 103];
  var WEBM_SEGMENT_INFORMATION = [21, 73, 169, 102];
  var WEBM_TIMECODE_SCALE = [42, 215, 177];
  var WEBM_MUXING_APP = [77, 128];
  var WEBM_WRITING_APP = [87, 65];
  var WEBM_SEEK_HEAD = [17, 77, 155, 116];
  var WEBM_SEEK = [77, 187];
  var WEBM_SEEK_ID = [83, 171];
  var WEBM_SEEK_POSITION = [83, 172];
  var WEBM_TRACKS = [22, 84, 174, 107];
  var WEBM_TRACK_ENTRY = [174];
  var WEBM_TRACK_NUMBER = [215];
  var WEBM_TRACK_UID = [115, 197];
  var WEBM_TRACK_TYPE = [131];
  var WEBM_FLAG_ENABLED = [185];
  var WEBM_FLAG_DEFAULT = [136];
  var WEBM_FLAG_FORCED = [85, 170];
  var WEBM_FLAG_LACING = [156];
  var WEBM_MIN_CACHE = [109, 231];
  var WEBM_MAX_BLOCK_ADDITION_ID = [85, 238];
  var WEBM_CODEC_DECODE_ALL = [170];
  var WEBM_SEEK_PRE_ROLL = [86, 187];
  var WEBM_CODEC_DELAY = [86, 170];
  var WEBM_CODEC_PRIVATE = [99, 162];
  var WEBM_CODEC_ID = [134];
  var WEBM_VIDEO = [224];
  var WEBM_FLAG_INTERLACED = [154];
  var WEBM_PIXEL_WIDTH = [176];
  var WEBM_PIXEL_HEIGHT = [186];
  var WEBM_AUDIO = [225];
  var WEBM_SAMPLING_FREQUENCY = [181];
  var WEBM_CHANNELS = [159];
  var WEBM_CLUSTER = [31, 67, 182, 117];
  var WEBM_TIME_CODE = [231];
  var WEBM_SIMPLE_BLOCK = [163];
  var Constants3 = {
    CLUSTER_SIMPLEBLOCK_FLAG_KEYFRAME: 1 << 7,
    OPUS_FREQUENCY: 48e3,
    OPUS_CHANNELS: 2,
    SPICE_PLAYBACK_CODEC: 'audio/webm; codecs="opus"',
    MAX_CLUSTER_TIME: 1e3,
    EXPECTED_PACKET_DURATION: 10,
    GAP_DETECTION_THRESHOLD: 50,
    SPICE_VP8_CODEC: 'video/webm; codecs="vp8"'
  };
  function EBML_write_u1_data_len(len, dv, at) {
    var b = 128 | len;
    dv.setUint8(at, b);
    return at + 1;
  }
  function EBML_write_u8_value(id, val, dv, at) {
    at = EBML_write_array(id, dv, at);
    at = EBML_write_u1_data_len(1, dv, at);
    dv.setUint8(at, val);
    return at + 1;
  }
  function EBML_write_u32_value(id, val, dv, at) {
    at = EBML_write_array(id, dv, at);
    at = EBML_write_u1_data_len(4, dv, at);
    dv.setUint32(at, val);
    return at + 4;
  }
  function EBML_write_u16_value(id, val, dv, at) {
    at = EBML_write_array(id, dv, at);
    at = EBML_write_u1_data_len(2, dv, at);
    dv.setUint16(at, val);
    return at + 2;
  }
  function EBML_write_float_value(id, val, dv, at) {
    at = EBML_write_array(id, dv, at);
    at = EBML_write_u1_data_len(4, dv, at);
    dv.setFloat32(at, val);
    return at + 4;
  }
  function EBML_write_u64_data_len(len, dv, at) {
    dv.setUint8(at++, 1);
    dv.setUint8(at++, 0);
    dv.setUint8(at++, 0);
    dv.setUint8(at++, 0);
    var val = len & 4294967295;
    for (var shift = 24; shift >= 0; shift -= 8)
      dv.setUint8(at++, val >> shift);
    return at;
  }
  function EBML_write_array(arr, dv, at) {
    for (var i = 0; i < arr.length; i++)
      dv.setUint8(at + i, arr[i]);
    return at + arr.length;
  }
  function EBML_write_string(str, dv, at) {
    for (var i = 0; i < str.length; i++)
      dv.setUint8(at + i, str.charCodeAt(i));
    return at + str.length;
  }
  function EBML_write_data(id, data, dv, at) {
    at = EBML_write_array(id, dv, at);
    if (data.length < 127)
      at = EBML_write_u1_data_len(data.length, dv, at);
    else
      at = EBML_write_u64_data_len(data.length, dv, at);
    if (typeof data == "string")
      at = EBML_write_string(data, dv, at);
    else
      at = EBML_write_array(data, dv, at);
    return at;
  }
  function EBMLHeader() {
    this.id = EBML_HEADER;
    this.Version = 1;
    this.ReadVersion = 1;
    this.MaxIDLength = 4;
    this.MaxSizeLength = 8;
    this.DocType = "webm";
    this.DocTypeVersion = 2;
    this.DocTypeReadVersion = 2;
  }
  EBMLHeader.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(31, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_VERSION, this.Version, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_READ_VERSION, this.ReadVersion, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_MAX_ID_LENGTH, this.MaxIDLength, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_MAX_SIZE_LENGTH, this.MaxSizeLength, dv, at);
      at = EBML_write_data(EBML_HEADER_DOC_TYPE, this.DocType, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_DOC_TYPE_VERSION, this.DocTypeVersion, dv, at);
      at = EBML_write_u8_value(EBML_HEADER_DOC_TYPE_READ_VERSION, this.DocTypeReadVersion, dv, at);
      return at;
    },
    buffer_size: function() {
      return 31 + 8 + this.id.length;
    }
  };
  function webm_Segment() {
    this.id = WEBM_SEGMENT_HEADER;
  }
  webm_Segment.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      dv.setUint8(at++, 255);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 1;
    }
  };
  function webm_SegmentInformation() {
    this.id = WEBM_SEGMENT_INFORMATION;
    this.timecode_scale = 1e6;
    this.muxing_app = "spice";
    this.writing_app = "spice-html5";
  }
  webm_SegmentInformation.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = EBML_write_u32_value(WEBM_TIMECODE_SCALE, this.timecode_scale, dv, at);
      at = EBML_write_data(WEBM_MUXING_APP, this.muxing_app, dv, at);
      at = EBML_write_data(WEBM_WRITING_APP, this.writing_app, dv, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + WEBM_TIMECODE_SCALE.length + 1 + 4 + WEBM_MUXING_APP.length + 1 + this.muxing_app.length + WEBM_WRITING_APP.length + 1 + this.writing_app.length;
    }
  };
  function webm_Audio(frequency) {
    this.id = WEBM_AUDIO;
    this.sampling_frequency = frequency;
    this.channels = Constants3.OPUS_CHANNELS;
  }
  webm_Audio.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = EBML_write_u8_value(WEBM_CHANNELS, this.channels, dv, at);
      at = EBML_write_float_value(WEBM_SAMPLING_FREQUENCY, this.sampling_frequency, dv, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + WEBM_SAMPLING_FREQUENCY.length + 1 + 4 + WEBM_CHANNELS.length + 1 + 1;
    }
  };
  function webm_Video(width, height) {
    this.id = WEBM_VIDEO;
    this.flag_interlaced = 0;
    this.width = width;
    this.height = height;
  }
  webm_Video.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_INTERLACED, this.flag_interlaced, dv, at);
      at = EBML_write_u16_value(WEBM_PIXEL_WIDTH, this.width, dv, at);
      at = EBML_write_u16_value(WEBM_PIXEL_HEIGHT, this.height, dv, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + WEBM_FLAG_INTERLACED.length + 1 + 1 + WEBM_PIXEL_WIDTH.length + 1 + 2 + WEBM_PIXEL_HEIGHT.length + 1 + 2;
    }
  };
  function webm_Seek(seekid, pos) {
    this.id = WEBM_SEEK;
    this.pos = pos;
    this.seekid = seekid;
  }
  webm_Seek.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u1_data_len(this.buffer_size() - 1 - this.id.length, dv, at);
      at = EBML_write_data(WEBM_SEEK_ID, this.seekid, dv, at);
      at = EBML_write_u16_value(WEBM_SEEK_POSITION, this.pos, dv, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 1 + WEBM_SEEK_ID.length + 1 + this.seekid.length + WEBM_SEEK_POSITION.length + 1 + 2;
    }
  };
  function webm_SeekHead(info_pos, track_pos) {
    this.id = WEBM_SEEK_HEAD;
    this.info = new webm_Seek(WEBM_SEGMENT_INFORMATION, info_pos);
    this.track = new webm_Seek(WEBM_TRACKS, track_pos);
  }
  webm_SeekHead.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = this.info.to_buffer(a, at);
      at = this.track.to_buffer(a, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + this.info.buffer_size() + this.track.buffer_size();
    }
  };
  function webm_AudioTrackEntry() {
    this.id = WEBM_TRACK_ENTRY;
    this.number = 1;
    this.uid = 2;
    this.type = 2;
    this.flag_enabled = 1;
    this.flag_default = 1;
    this.flag_forced = 1;
    this.flag_lacing = 0;
    this.min_cache = 0;
    this.max_block_addition_id = 0;
    this.codec_decode_all = 0;
    this.seek_pre_roll = 0;
    this.codec_delay = 8e7;
    this.codec_id = "A_OPUS";
    this.audio = new webm_Audio(Constants3.OPUS_FREQUENCY);
    this.codec_private = [
      79,
      112,
      117,
      115,
      72,
      101,
      97,
      100,
      // OpusHead
      1,
      // Version
      Constants3.OPUS_CHANNELS,
      0,
      15,
      // Preskip - 3840 samples - should be 8ms at 48kHz
      128,
      187,
      0,
      0,
      // 48000
      0,
      0,
      // Output gain
      0
      // Channel mapping family
    ];
  }
  webm_AudioTrackEntry.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_NUMBER, this.number, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_UID, this.uid, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_ENABLED, this.flag_enabled, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_DEFAULT, this.flag_default, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_FORCED, this.flag_forced, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_LACING, this.flag_lacing, dv, at);
      at = EBML_write_data(WEBM_CODEC_ID, this.codec_id, dv, at);
      at = EBML_write_u8_value(WEBM_MIN_CACHE, this.min_cache, dv, at);
      at = EBML_write_u8_value(WEBM_MAX_BLOCK_ADDITION_ID, this.max_block_addition_id, dv, at);
      at = EBML_write_u8_value(WEBM_CODEC_DECODE_ALL, this.codec_decode_all, dv, at);
      at = EBML_write_u32_value(WEBM_CODEC_DELAY, this.codec_delay, dv, at);
      at = EBML_write_u32_value(WEBM_SEEK_PRE_ROLL, this.seek_pre_roll, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_TYPE, this.type, dv, at);
      at = EBML_write_data(WEBM_CODEC_PRIVATE, this.codec_private, dv, at);
      at = this.audio.to_buffer(a, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + WEBM_TRACK_NUMBER.length + 1 + 1 + WEBM_TRACK_UID.length + 1 + 1 + WEBM_TRACK_TYPE.length + 1 + 1 + WEBM_FLAG_ENABLED.length + 1 + 1 + WEBM_FLAG_DEFAULT.length + 1 + 1 + WEBM_FLAG_FORCED.length + 1 + 1 + WEBM_FLAG_LACING.length + 1 + 1 + WEBM_MIN_CACHE.length + 1 + 1 + WEBM_MAX_BLOCK_ADDITION_ID.length + 1 + 1 + WEBM_CODEC_DECODE_ALL.length + 1 + 1 + WEBM_SEEK_PRE_ROLL.length + 1 + 4 + WEBM_CODEC_DELAY.length + 1 + 4 + WEBM_CODEC_ID.length + this.codec_id.length + 1 + WEBM_CODEC_PRIVATE.length + 1 + this.codec_private.length + this.audio.buffer_size();
    }
  };
  function webm_VideoTrackEntry(width, height) {
    this.id = WEBM_TRACK_ENTRY;
    this.number = 1;
    this.uid = 1;
    this.type = 1;
    this.flag_enabled = 1;
    this.flag_default = 1;
    this.flag_forced = 1;
    this.flag_lacing = 1;
    this.min_cache = 0;
    this.max_block_addition_id = 0;
    this.codec_id = "V_VP8";
    this.codec_decode_all = 1;
    this.seek_pre_roll = 0;
    this.video = new webm_Video(width, height);
  }
  webm_VideoTrackEntry.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_NUMBER, this.number, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_UID, this.uid, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_ENABLED, this.flag_enabled, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_DEFAULT, this.flag_default, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_FORCED, this.flag_forced, dv, at);
      at = EBML_write_u8_value(WEBM_FLAG_LACING, this.flag_lacing, dv, at);
      at = EBML_write_data(WEBM_CODEC_ID, this.codec_id, dv, at);
      at = EBML_write_u8_value(WEBM_MIN_CACHE, this.min_cache, dv, at);
      at = EBML_write_u8_value(WEBM_MAX_BLOCK_ADDITION_ID, this.max_block_addition_id, dv, at);
      at = EBML_write_u8_value(WEBM_CODEC_DECODE_ALL, this.codec_decode_all, dv, at);
      at = EBML_write_u32_value(WEBM_SEEK_PRE_ROLL, this.seek_pre_roll, dv, at);
      at = EBML_write_u8_value(WEBM_TRACK_TYPE, this.type, dv, at);
      at = this.video.to_buffer(a, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + WEBM_TRACK_NUMBER.length + 1 + 1 + WEBM_TRACK_UID.length + 1 + 1 + WEBM_FLAG_ENABLED.length + 1 + 1 + WEBM_FLAG_DEFAULT.length + 1 + 1 + WEBM_FLAG_FORCED.length + 1 + 1 + WEBM_FLAG_LACING.length + 1 + 1 + WEBM_CODEC_ID.length + this.codec_id.length + 1 + WEBM_MIN_CACHE.length + 1 + 1 + WEBM_MAX_BLOCK_ADDITION_ID.length + 1 + 1 + WEBM_CODEC_DECODE_ALL.length + 1 + 1 + WEBM_SEEK_PRE_ROLL.length + 1 + 4 + WEBM_TRACK_TYPE.length + 1 + 1 + this.video.buffer_size();
    }
  };
  function webm_Tracks(entry) {
    this.id = WEBM_TRACKS;
    this.track_entry = entry;
  }
  webm_Tracks.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.buffer_size() - 8 - this.id.length, dv, at);
      at = this.track_entry.to_buffer(a, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + this.track_entry.buffer_size();
    }
  };
  function webm_Cluster(timecode, data) {
    this.id = WEBM_CLUSTER;
    this.timecode = timecode;
    this.data = data;
  }
  webm_Cluster.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      dv.setUint8(at++, 255);
      at = EBML_write_u32_value(WEBM_TIME_CODE, this.timecode, dv, at);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 1 + WEBM_TIME_CODE.length + 1 + 4;
    }
  };
  function webm_SimpleBlock(timecode, data, keyframe) {
    this.id = WEBM_SIMPLE_BLOCK;
    this.timecode = timecode;
    this.data = data;
    this.keyframe = keyframe;
  }
  webm_SimpleBlock.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      var dv = new DataView(a);
      at = EBML_write_array(this.id, dv, at);
      at = EBML_write_u64_data_len(this.data.byteLength + 4, dv, at);
      at = EBML_write_u1_data_len(1, dv, at);
      dv.setUint16(at, this.timecode);
      at += 2;
      dv.setUint8(at, this.keyframe ? Constants3.CLUSTER_SIMPLEBLOCK_FLAG_KEYFRAME : 0);
      at += 1;
      var u8 = new Uint8Array(this.data);
      for (var i = 0; i < this.data.byteLength; i++)
        dv.setUint8(at++, u8[i]);
      return at;
    },
    buffer_size: function() {
      return this.id.length + 8 + 1 + 2 + 1 + this.data.byteLength;
    }
  };
  function webm_Header() {
    this.ebml = new EBMLHeader();
    this.segment = new webm_Segment();
    this.seek_head = new webm_SeekHead(0, 0);
    this.seek_head.info.pos = this.segment.buffer_size() + this.seek_head.buffer_size();
    this.info = new webm_SegmentInformation();
    this.seek_head.track.pos = this.seek_head.info.pos + this.info.buffer_size();
  }
  webm_Header.prototype = {
    to_buffer: function(a, at) {
      at = at || 0;
      at = this.ebml.to_buffer(a, at);
      at = this.segment.to_buffer(a, at);
      at = this.info.to_buffer(a, at);
      return at;
    },
    buffer_size: function() {
      return this.ebml.buffer_size() + this.segment.buffer_size() + this.info.buffer_size();
    }
  };

  // vendor/spice-html5/spiceconn.js
  function SpiceConn(o) {
    if (o === void 0 || o.uri === void 0 || !o.uri)
      throw new Error("You must specify a uri");
    this.ws = new WebSocket(o.uri, "binary");
    if (!this.ws.binaryType)
      throw new Error("WebSocket doesn't support binaryType.  Try a different browser.");
    this.connection_id = o.connection_id !== void 0 ? o.connection_id : 0;
    this.type = o.type !== void 0 ? o.type : Constants.SPICE_CHANNEL_MAIN;
    this.chan_id = o.chan_id !== void 0 ? o.chan_id : 0;
    if (o.parent !== void 0) {
      this.parent = o.parent;
      this.message_id = o.parent.message_id;
      this.password = o.parent.password;
    }
    if (o.screen_id !== void 0)
      this.screen_id = o.screen_id;
    if (o.dump_id !== void 0)
      this.dump_id = o.dump_id;
    if (o.message_id !== void 0)
      this.message_id = o.message_id;
    if (o.password !== void 0)
      this.password = o.password;
    if (o.onerror !== void 0)
      this.onerror = o.onerror;
    if (o.onsuccess !== void 0)
      this.onsuccess = o.onsuccess;
    if (o.onagent !== void 0)
      this.onagent = o.onagent;
    this.state = "connecting";
    this.ws.parent = this;
    this.wire_reader = new SpiceWireReader(this, this.process_inbound);
    this.messages_sent = 0;
    this.warnings = [];
    this.ws.addEventListener("open", function(e) {
      DEBUG > 0 && console.log(">> WebSockets.onopen");
      DEBUG > 0 && console.log("id " + this.parent.connection_id + "; type " + this.parent.type);
      this.parent.send_hdr();
      this.parent.wire_reader.request(SpiceLinkHeader.prototype.buffer_size());
      this.parent.state = "start";
    });
    this.ws.addEventListener("error", function(e) {
      if ("url" in e.target) {
        this.parent.log_err("WebSocket error: Can't connect to websocket on URL: " + e.target.url);
      }
      this.parent.report_error(e);
    });
    this.ws.addEventListener("close", function(e) {
      DEBUG > 0 && console.log(">> WebSockets.onclose");
      DEBUG > 0 && console.log("id " + this.parent.connection_id + "; type " + this.parent.type);
      DEBUG > 0 && console.log(e);
      if (this.parent.state != "closing" && this.parent.state != "error" && this.parent.onerror !== void 0) {
        var e;
        if (this.parent.state == "connecting")
          e = new Error("Connection refused.");
        else if (this.parent.state == "start" || this.parent.state == "link")
          e = new Error("Unexpected protocol mismatch.");
        else if (this.parent.state == "ticket")
          e = new Error("Bad password.");
        else
          e = new Error("Unexpected close while " + this.parent.state);
        this.parent.onerror(e);
        this.parent.log_err(e.toString());
      }
    });
    if (this.ws.readyState == 2 || this.ws.readyState == 3)
      throw new Error("Unable to connect to " + o.uri);
    this.timeout = window.setTimeout(spiceconn_timeout, Constants.SPICE_CONNECT_TIMEOUT, this);
  }
  SpiceConn.prototype = {
    send_hdr: function() {
      var hdr = new SpiceLinkHeader();
      var msg = new SpiceLinkMess();
      msg.connection_id = this.connection_id;
      msg.channel_type = this.type;
      msg.channel_id = this.chan_id;
      msg.common_caps.push(
        1 << Constants.SPICE_COMMON_CAP_PROTOCOL_AUTH_SELECTION | 1 << Constants.SPICE_COMMON_CAP_MINI_HEADER
      );
      if (msg.channel_type == Constants.SPICE_CHANNEL_PLAYBACK) {
        var caps = 0;
        if ("MediaSource" in window && MediaSource.isTypeSupported(Constants3.SPICE_PLAYBACK_CODEC))
          caps |= 1 << Constants.SPICE_PLAYBACK_CAP_OPUS;
        msg.channel_caps.push(caps);
      } else if (msg.channel_type == Constants.SPICE_CHANNEL_MAIN) {
        msg.channel_caps.push(
          1 << Constants.SPICE_MAIN_CAP_AGENT_CONNECTED_TOKENS
        );
      } else if (msg.channel_type == Constants.SPICE_CHANNEL_DISPLAY) {
        var caps = 1 << Constants.SPICE_DISPLAY_CAP_SIZED_STREAM | 1 << Constants.SPICE_DISPLAY_CAP_STREAM_REPORT | 1 << Constants.SPICE_DISPLAY_CAP_MULTI_CODEC | 1 << Constants.SPICE_DISPLAY_CAP_CODEC_MJPEG;
        if ("MediaSource" in window && MediaSource.isTypeSupported(Constants3.SPICE_VP8_CODEC))
          caps |= 1 << Constants.SPICE_DISPLAY_CAP_CODEC_VP8;
        msg.channel_caps.push(caps);
      }
      hdr.size = msg.buffer_size();
      var mb = new ArrayBuffer(hdr.buffer_size() + msg.buffer_size());
      hdr.to_buffer(mb);
      msg.to_buffer(mb, hdr.buffer_size());
      DEBUG > 1 && console.log("Sending header:");
      DEBUG > 2 && hexdump_buffer(mb);
      this.ws.send(mb);
    },
    send_ticket: function(ticket) {
      var hdr = new SpiceLinkAuthTicket();
      hdr.auth_mechanism = Constants.SPICE_COMMON_CAP_AUTH_SPICE;
      hdr.encrypted_data = ticket;
      var mb = new ArrayBuffer(hdr.buffer_size());
      hdr.to_buffer(mb);
      DEBUG > 1 && console.log("Sending ticket:");
      DEBUG > 2 && hexdump_buffer(mb);
      this.ws.send(mb);
    },
    send_msg: function(msg) {
      var mb = new ArrayBuffer(msg.buffer_size());
      msg.to_buffer(mb);
      this.messages_sent++;
      DEBUG > 0 && console.log(">> hdr " + this.channel_type() + " type " + msg.type + " size " + mb.byteLength);
      DEBUG > 2 && hexdump_buffer(mb);
      this.ws.send(mb);
    },
    process_inbound: function(mb, saved_header) {
      DEBUG > 2 && console.log(this.type + ": processing message of size " + mb.byteLength + "; state is " + this.state);
      if (this.state == "ready") {
        if (saved_header == void 0) {
          var msg = new SpiceMiniData(mb);
          if (msg.type > 500) {
            if (DEBUG > 0) {
              alert("Something has gone very wrong; we think we have message of type " + msg.type);
              debugger;
            }
          }
          if (msg.size == 0) {
            this.process_message(msg);
            this.wire_reader.request(SpiceMiniData.prototype.buffer_size());
          } else {
            this.wire_reader.request(msg.size);
            this.wire_reader.save_header(msg);
          }
        } else {
          saved_header.data = mb;
          this.process_message(saved_header);
          this.wire_reader.request(SpiceMiniData.prototype.buffer_size());
          this.wire_reader.save_header(void 0);
        }
      } else if (this.state == "start") {
        this.reply_hdr = new SpiceLinkHeader(mb);
        if (this.reply_hdr.magic != Constants.SPICE_MAGIC) {
          this.state = "error";
          var e = new Error("Error: magic mismatch: " + this.reply_hdr.magic);
          this.report_error(e);
        } else {
          this.wire_reader.request(this.reply_hdr.size);
          this.state = "link";
        }
      } else if (this.state == "link") {
        this.reply_link = new SpiceLinkReply(mb);
        if (this.reply_link.error) {
          this.state = "error";
          var e = new Error("Error: reply link error " + this.reply_link.error);
          this.report_error(e);
        } else {
          this.send_ticket(rsa_encrypt(this.reply_link.pub_key, this.password + String.fromCharCode(0)));
          this.state = "ticket";
          this.wire_reader.request(SpiceLinkAuthReply.prototype.buffer_size());
        }
      } else if (this.state == "ticket") {
        this.auth_reply = new SpiceLinkAuthReply(mb);
        if (this.auth_reply.auth_code == Constants.SPICE_LINK_ERR_OK) {
          DEBUG > 0 && console.log(this.type + ": Connected");
          if (this.type == Constants.SPICE_CHANNEL_DISPLAY) {
            var dinit = new SpiceMsgcDisplayInit();
            var reply = new SpiceMiniData();
            reply.build_msg(Constants.SPICE_MSGC_DISPLAY_INIT, dinit);
            DEBUG > 0 && console.log("Request display init");
            this.send_msg(reply);
          }
          this.state = "ready";
          this.wire_reader.request(SpiceMiniData.prototype.buffer_size());
          if (this.timeout) {
            window.clearTimeout(this.timeout);
            delete this.timeout;
          }
        } else {
          this.state = "error";
          if (this.auth_reply.auth_code == Constants.SPICE_LINK_ERR_PERMISSION_DENIED) {
            var e = new Error("Permission denied.");
          } else {
            var e = new Error("Unexpected link error " + this.auth_reply.auth_code);
          }
          this.report_error(e);
        }
      }
    },
    process_common_messages: function(msg) {
      if (msg.type == Constants.SPICE_MSG_SET_ACK) {
        var ack = new SpiceMsgSetAck(msg.data);
        this.ack_window = ack.window;
        DEBUG > 1 && console.log(this.type + ": set ack to " + ack.window);
        this.msgs_until_ack = this.ack_window;
        var ackack = new SpiceMsgcAckSync(ack);
        var reply = new SpiceMiniData();
        reply.build_msg(Constants.SPICE_MSGC_ACK_SYNC, ackack);
        this.send_msg(reply);
        return true;
      }
      if (msg.type == Constants.SPICE_MSG_PING) {
        DEBUG > 1 && console.log("ping!");
        var pong = new SpiceMiniData();
        pong.type = Constants.SPICE_MSGC_PONG;
        if (msg.data) {
          pong.data = msg.data.slice(0, 12);
        }
        pong.size = pong.buffer_size();
        this.send_msg(pong);
        return true;
      }
      if (msg.type == Constants.SPICE_MSG_NOTIFY) {
        var notify = new SpiceMsgNotify(msg.data);
        if (notify.severity == Constants.SPICE_NOTIFY_SEVERITY_ERROR)
          this.log_err(notify.message);
        else if (notify.severity == Constants.SPICE_NOTIFY_SEVERITY_WARN)
          this.log_warn(notify.message);
        else
          this.log_info(notify.message);
        return true;
      }
      return false;
    },
    process_message: function(msg) {
      var rc;
      var start = Date.now();
      DEBUG > 0 && console.log("<< hdr " + this.channel_type() + " type " + msg.type + " size " + (msg.data && msg.data.byteLength));
      rc = this.process_common_messages(msg);
      if (!rc) {
        if (this.process_channel_message) {
          rc = this.process_channel_message(msg);
          if (!rc)
            this.log_warn(this.channel_type() + ": Unknown message type " + msg.type + "!");
        } else
          this.log_err(this.channel_type() + ": No message handlers for this channel; message " + msg.type);
      }
      if (this.msgs_until_ack !== void 0 && this.ack_window) {
        this.msgs_until_ack--;
        if (this.msgs_until_ack <= 0) {
          this.msgs_until_ack = this.ack_window;
          var ack = new SpiceMiniData();
          ack.type = Constants.SPICE_MSGC_ACK;
          this.send_msg(ack);
          DEBUG > 1 && console.log(this.type + ": sent ack");
        }
      }
      var delta = Date.now() - start;
      if (DEBUG > 0 || delta > Constants3.GAP_DETECTION_THRESHOLD)
        console.log("delta " + this.channel_type() + ":" + msg.type + " " + delta);
      return rc;
    },
    channel_type: function() {
      if (this.type == Constants.SPICE_CHANNEL_MAIN)
        return "main";
      else if (this.type == Constants.SPICE_CHANNEL_DISPLAY)
        return "display";
      else if (this.type == Constants.SPICE_CHANNEL_INPUTS)
        return "inputs";
      else if (this.type == Constants.SPICE_CHANNEL_CURSOR)
        return "cursor";
      else if (this.type == Constants.SPICE_CHANNEL_PLAYBACK)
        return "playback";
      else if (this.type == Constants.SPICE_CHANNEL_RECORD)
        return "record";
      else if (this.type == Constants.SPICE_CHANNEL_TUNNEL)
        return "tunnel";
      else if (this.type == Constants.SPICE_CHANNEL_SMARTCARD)
        return "smartcard";
      else if (this.type == Constants.SPICE_CHANNEL_USBREDIR)
        return "usbredir";
      else if (this.type == Constants.SPICE_CHANNEL_PORT)
        return "port";
      else if (this.type == Constants.SPICE_CHANNEL_WEBDAV)
        return "webdav";
      return "unknown-" + this.type;
    },
    log_info: function() {
      var msg = Array.prototype.join.call(arguments, " ");
      console.log(msg);
      if (this.message_id) {
        var p = document.createElement("p");
        p.appendChild(document.createTextNode(msg));
        p.className += "spice-message-info";
        document.getElementById(this.message_id).appendChild(p);
      }
    },
    log_warn: function() {
      var msg = Array.prototype.join.call(arguments, " ");
      console.log("WARNING: " + msg);
      if (this.message_id) {
        var p = document.createElement("p");
        p.appendChild(document.createTextNode(msg));
        p.className += "spice-message-warning";
        document.getElementById(this.message_id).appendChild(p);
      }
    },
    log_err: function() {
      var msg = Array.prototype.join.call(arguments, " ");
      console.log("ERROR: " + msg);
      if (this.message_id) {
        var p = document.createElement("p");
        p.appendChild(document.createTextNode(msg));
        p.className += "spice-message-error";
        document.getElementById(this.message_id).appendChild(p);
      }
    },
    known_unimplemented: function(type, msg) {
      if (!this.warnings[type] || DEBUG > 1) {
        var str = "";
        if (DEBUG <= 1)
          str = " [ further notices suppressed ]";
        this.log_warn("Unimplemented function " + type + "(" + msg + ")" + str);
        this.warnings[type] = true;
      }
    },
    report_error: function(e) {
      this.log_err(e.toString());
      if (this.onerror != void 0)
        this.onerror(e);
      else
        throw e;
    },
    report_success: function(m) {
      if (this.onsuccess != void 0)
        this.onsuccess(m);
    },
    cleanup: function() {
      if (this.timeout) {
        window.clearTimeout(this.timeout);
        delete this.timeout;
      }
      if (this.ws) {
        this.ws.close();
        this.ws = void 0;
      }
    },
    handle_timeout: function() {
      var e = new Error("Connection timed out.");
      this.report_error(e);
    }
  };
  function spiceconn_timeout(sc) {
    SpiceConn.prototype.handle_timeout.call(sc);
  }

  // vendor/spice-html5/cursor.js
  function SpiceCursorConn() {
    SpiceConn.apply(this, arguments);
  }
  SpiceCursorConn.prototype = Object.create(SpiceConn.prototype);
  SpiceCursorConn.prototype.process_channel_message = function(msg) {
    if (msg.type == Constants.SPICE_MSG_CURSOR_INIT) {
      var cursor_init = new SpiceMsgCursorInit(msg.data);
      DEBUG > 1 && console.log("SpiceMsgCursorInit");
      if (this.parent && this.parent.inputs && this.parent.inputs.mouse_mode == Constants.SPICE_MOUSE_MODE_SERVER) {
        this.parent.inputs.mousex = cursor_init.position.x;
        this.parent.inputs.mousey = cursor_init.position.y;
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_SET) {
      var cursor_set = new SpiceMsgCursorSet(msg.data);
      DEBUG > 1 && console.log("SpiceMsgCursorSet");
      if (cursor_set.flags & Constants.SPICE_CURSOR_FLAGS_NONE) {
        document.getElementById(this.parent.screen_id).style.cursor = "none";
        return true;
      }
      if (cursor_set.flags > 0)
        this.log_warn("FIXME: No support for cursor flags " + cursor_set.flags);
      if (cursor_set.cursor.header.type != Constants.SPICE_CURSOR_TYPE_ALPHA) {
        this.log_warn("FIXME: No support for cursor type " + cursor_set.cursor.header.type);
        return false;
      }
      this.set_cursor(cursor_set.cursor);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_MOVE) {
      this.known_unimplemented(msg.type, "Cursor Move");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_HIDE) {
      DEBUG > 1 && console.log("SpiceMsgCursorHide");
      document.getElementById(this.parent.screen_id).style.cursor = "none";
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_TRAIL) {
      this.known_unimplemented(msg.type, "Cursor Trail");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_RESET) {
      DEBUG > 1 && console.log("SpiceMsgCursorReset");
      document.getElementById(this.parent.screen_id).style.cursor = "auto";
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_INVAL_ONE) {
      this.known_unimplemented(msg.type, "Cursor Inval One");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_CURSOR_INVAL_ALL) {
      DEBUG > 1 && console.log("SpiceMsgCursorInvalAll");
      return true;
    }
    return false;
  };
  SpiceCursorConn.prototype.set_cursor = function(cursor) {
    var pngstr = create_rgba_png(cursor.header.width, cursor.header.height, cursor.data);
    var curstr = "url(data:image/png," + pngstr + ") " + cursor.header.hot_spot_x + " " + cursor.header.hot_spot_y + ", default";
    var screen = document.getElementById(this.parent.screen_id);
    screen.style.cursor = "auto";
    screen.style.cursor = curstr;
    if (window.getComputedStyle(screen, null).cursor == "auto")
      SpiceSimulateCursor.simulate_cursor(this, cursor, screen, pngstr);
  };

  // vendor/spice-html5/filexfer.js
  function SpiceFileXferTask(id, file) {
    this.id = id;
    this.file = file;
  }
  SpiceFileXferTask.prototype.create_progressbar = function() {
    var _this = this;
    var cancel = document.createElement("input");
    this.progressbar_container = document.createElement("div");
    this.progressbar = document.createElement("progress");
    cancel.type = "button";
    cancel.value = "Cancel";
    cancel.style.float = "right";
    cancel.onclick = function() {
      _this.cancelled = true;
      _this.remove_progressbar();
    };
    this.progressbar.setAttribute("max", this.file.size);
    this.progressbar.setAttribute("value", 0);
    this.progressbar.style.width = "100%";
    this.progressbar.style.margin = "4px auto";
    this.progressbar.style.display = "inline-block";
    this.progressbar_container.style.width = "90%";
    this.progressbar_container.style.margin = "auto";
    this.progressbar_container.style.padding = "4px";
    this.progressbar_container.textContent = this.file.name;
    this.progressbar_container.appendChild(cancel);
    this.progressbar_container.appendChild(this.progressbar);
    document.getElementById("spice-xfer-area").appendChild(this.progressbar_container);
  };
  SpiceFileXferTask.prototype.update_progressbar = function(value) {
    this.progressbar.setAttribute("value", value);
  };
  SpiceFileXferTask.prototype.remove_progressbar = function() {
    if (this.progressbar_container && this.progressbar_container.parentNode)
      this.progressbar_container.parentNode.removeChild(this.progressbar_container);
  };
  function handle_file_dragover(e) {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }
  function handle_file_drop(e) {
    var sc = window.spice_connection;
    var files = e.dataTransfer.files;
    e.stopPropagation();
    e.preventDefault();
    for (var i = files.length - 1; i >= 0; i--) {
      if (files[i].type)
        sc.file_xfer_start(files[i]);
    }
  }

  // vendor/spice-html5/inputs.js
  var Shift_state = -1;
  var Ctrl_state = -1;
  var Alt_state = -1;
  var Meta_state = -1;
  function SpiceInputsConn() {
    SpiceConn.apply(this, arguments);
    this.mousex = void 0;
    this.mousey = void 0;
    this.button_state = 0;
    this.waiting_for_ack = 0;
  }
  SpiceInputsConn.prototype = Object.create(SpiceConn.prototype);
  SpiceInputsConn.prototype.process_channel_message = function(msg) {
    if (msg.type == Constants.SPICE_MSG_INPUTS_INIT) {
      var inputs_init = new SpiceMsgInputsInit(msg.data);
      this.keyboard_modifiers = inputs_init.keyboard_modifiers;
      DEBUG > 1 && console.log("MsgInputsInit - modifier " + this.keyboard_modifiers);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_INPUTS_KEY_MODIFIERS) {
      var key = new SpiceMsgInputsKeyModifiers(msg.data);
      this.keyboard_modifiers = key.keyboard_modifiers;
      DEBUG > 1 && console.log("MsgInputsKeyModifiers - modifier " + this.keyboard_modifiers);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_INPUTS_MOUSE_MOTION_ACK) {
      DEBUG > 1 && console.log("mouse motion ack");
      this.waiting_for_ack -= Constants.SPICE_INPUT_MOTION_ACK_BUNCH;
      return true;
    }
    return false;
  };
  function handle_mousemove(e) {
    var msg = new SpiceMiniData();
    var move;
    if (this.sc.mouse_mode == Constants.SPICE_MOUSE_MODE_CLIENT) {
      move = new SpiceMsgcMousePosition(this.sc, e);
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_POSITION, move);
    } else {
      move = new SpiceMsgcMouseMotion(this.sc, e);
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_MOTION, move);
    }
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready") {
      if (this.sc.inputs.waiting_for_ack < 2 * Constants.SPICE_INPUT_MOTION_ACK_BUNCH) {
        this.sc.inputs.send_msg(msg);
        this.sc.inputs.waiting_for_ack++;
      } else {
        DEBUG > 0 && this.sc.log_info("Discarding mouse motion");
      }
    }
    if (this.sc && this.sc.cursor && this.sc.cursor.spice_simulated_cursor) {
      this.sc.cursor.spice_simulated_cursor.style.display = "block";
      this.sc.cursor.spice_simulated_cursor.style.left = e.pageX - this.sc.cursor.spice_simulated_cursor.spice_hot_x + "px";
      this.sc.cursor.spice_simulated_cursor.style.top = e.pageY - this.sc.cursor.spice_simulated_cursor.spice_hot_y + "px";
      e.preventDefault();
    }
  }
  function handle_mousedown(e) {
    var press = new SpiceMsgcMousePress(this.sc, e);
    var msg = new SpiceMiniData();
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_PRESS, press);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    e.preventDefault();
  }
  function handle_contextmenu(e) {
    e.preventDefault();
    return false;
  }
  function handle_mouseup(e) {
    var release = new SpiceMsgcMouseRelease(this.sc, e);
    var msg = new SpiceMiniData();
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_RELEASE, release);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    e.preventDefault();
  }
  function handle_mousewheel(e) {
    var press = new SpiceMsgcMousePress();
    var release = new SpiceMsgcMouseRelease();
    if (e.deltaY < 0)
      press.button = release.button = Constants.SPICE_MOUSE_BUTTON_UP;
    else
      press.button = release.button = Constants.SPICE_MOUSE_BUTTON_DOWN;
    press.buttons_state = 0;
    release.buttons_state = 0;
    var msg = new SpiceMiniData();
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_PRESS, press);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_MOUSE_RELEASE, release);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    e.preventDefault();
  }
  function handle_keydown(e) {
    var key = new SpiceMsgcKeyDown(e);
    var msg = new SpiceMiniData();
    check_and_update_modifiers(e, key.code, this.sc);
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_DOWN, key);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    e.preventDefault();
  }
  function handle_keyup(e) {
    var key = new SpiceMsgcKeyUp(e);
    var msg = new SpiceMiniData();
    check_and_update_modifiers(e, key.code, this.sc);
    msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_UP, key);
    if (this.sc && this.sc.inputs && this.sc.inputs.state === "ready")
      this.sc.inputs.send_msg(msg);
    e.preventDefault();
  }
  function sendCtrlAltDel(sc) {
    if (sc && sc.inputs && sc.inputs.state === "ready") {
      var key = new SpiceMsgcKeyDown();
      var msg = new SpiceMiniData();
      update_modifier(true, KeyNames.KEY_LCtrl, sc);
      update_modifier(true, KeyNames.KEY_Alt, sc);
      key.code = KeyNames.KEY_KP_Decimal;
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_DOWN, key);
      sc.inputs.send_msg(msg);
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_UP, key);
      sc.inputs.send_msg(msg);
      if (Ctrl_state == false) update_modifier(false, KeyNames.KEY_LCtrl, sc);
      if (Alt_state == false) update_modifier(false, KeyNames.KEY_Alt, sc);
    }
  }
  function update_modifier(state, code, sc) {
    var msg = new SpiceMiniData();
    if (!state) {
      var key = new SpiceMsgcKeyUp();
      key.code = 128 | code;
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_UP, key);
    } else {
      var key = new SpiceMsgcKeyDown();
      key.code = code;
      msg.build_msg(Constants.SPICE_MSGC_INPUTS_KEY_DOWN, key);
    }
    sc.inputs.send_msg(msg);
  }
  function check_and_update_modifiers(e, code, sc) {
    if (Shift_state === -1) {
      Shift_state = e.shiftKey;
      Ctrl_state = e.ctrlKey;
      Alt_state = e.altKey;
      Meta_state = e.metaKey;
    }
    if (code === KeyNames.KEY_ShiftL)
      Shift_state = true;
    else if (code === KeyNames.KEY_Alt)
      Alt_state = true;
    else if (code === KeyNames.KEY_LCtrl)
      Ctrl_state = true;
    else if (code === 57525)
      Meta_state = true;
    else if (code === (128 | KeyNames.KEY_ShiftL))
      Shift_state = false;
    else if (code === (128 | KeyNames.KEY_Alt))
      Alt_state = false;
    else if (code === (128 | KeyNames.KEY_LCtrl))
      Ctrl_state = false;
    else if (code === (128 | 57525))
      Meta_state = false;
    if (sc && sc.inputs && sc.inputs.state === "ready") {
      if (Shift_state != e.shiftKey) {
        console.log("Shift state out of sync");
        update_modifier(e.shiftKey, KeyNames.KEY_ShiftL, sc);
        Shift_state = e.shiftKey;
      }
      if (Alt_state != e.altKey) {
        console.log("Alt state out of sync");
        update_modifier(e.altKey, KeyNames.KEY_Alt, sc);
        Alt_state = e.altKey;
      }
      if (Ctrl_state != e.ctrlKey) {
        console.log("Ctrl state out of sync");
        update_modifier(e.ctrlKey, KeyNames.KEY_LCtrl, sc);
        Ctrl_state = e.ctrlKey;
      }
      if (Meta_state != e.metaKey) {
        console.log("Meta state out of sync");
        update_modifier(e.metaKey, 57525, sc);
        Meta_state = e.metaKey;
      }
    }
  }

  // vendor/spice-html5/lz.js
  function lz_rgb32_decompress(in_buf, at, out_buf, type, default_alpha) {
    var encoder2 = at;
    var op = 0;
    var ctrl;
    var ctr = 0;
    var i = 0;
    for (ctrl = in_buf[encoder2++]; op * 4 < out_buf.length; ctrl = in_buf[encoder2++]) {
      var ref = op;
      var len = ctrl >> 5;
      var ofs = (ctrl & 31) << 8;
      if (ctrl >= 32) {
        var code;
        len--;
        if (len == 7 - 1) {
          do {
            code = in_buf[encoder2++];
            len += code;
          } while (code == 255);
        }
        code = in_buf[encoder2++];
        ofs += code;
        if (code == 255) {
          if (ofs - code == 31 << 8) {
            ofs = in_buf[encoder2++] << 8;
            ofs += in_buf[encoder2++];
            ofs += 8191;
          }
        }
        len += 1;
        if (type == Constants.LZ_IMAGE_TYPE_RGBA)
          len += 2;
        ofs += 1;
        ref -= ofs;
        if (ref == op - 1) {
          var b = ref;
          for (; len; --len) {
            if (type == Constants.LZ_IMAGE_TYPE_RGBA) {
              out_buf[op * 4 + 3] = out_buf[b * 4 + 3];
            } else {
              for (i = 0; i < 4; i++)
                out_buf[op * 4 + i] = out_buf[b * 4 + i];
            }
            op++;
          }
        } else {
          for (; len; --len) {
            if (type == Constants.LZ_IMAGE_TYPE_RGBA) {
              out_buf[op * 4 + 3] = out_buf[ref * 4 + 3];
            } else {
              for (i = 0; i < 4; i++)
                out_buf[op * 4 + i] = out_buf[ref * 4 + i];
            }
            op++;
            ref++;
          }
        }
      } else {
        ctrl++;
        if (type == Constants.LZ_IMAGE_TYPE_RGBA) {
          out_buf[op * 4 + 3] = in_buf[encoder2++];
        } else {
          out_buf[op * 4 + 0] = in_buf[encoder2 + 2];
          out_buf[op * 4 + 1] = in_buf[encoder2 + 1];
          out_buf[op * 4 + 2] = in_buf[encoder2 + 0];
          if (default_alpha)
            out_buf[op * 4 + 3] = 255;
          encoder2 += 3;
        }
        op++;
        for (--ctrl; ctrl; ctrl--) {
          if (type == Constants.LZ_IMAGE_TYPE_RGBA) {
            out_buf[op * 4 + 3] = in_buf[encoder2++];
          } else {
            out_buf[op * 4 + 0] = in_buf[encoder2 + 2];
            out_buf[op * 4 + 1] = in_buf[encoder2 + 1];
            out_buf[op * 4 + 2] = in_buf[encoder2 + 0];
            if (default_alpha)
              out_buf[op * 4 + 3] = 255;
            encoder2 += 3;
          }
          op++;
        }
      }
    }
    return encoder2 - 1;
  }
  function flip_image_data(img) {
    var wb = img.width * 4;
    var h = img.height;
    var temp_h = h;
    var buff = new Uint8Array(img.width * img.height * 4);
    while (temp_h--) {
      buff.set(img.data.subarray(temp_h * wb, (temp_h + 1) * wb), (h - temp_h - 1) * wb);
    }
    img.data.set(buff);
  }
  function convert_spice_lz_to_web(context, lz_image) {
    var at;
    if (lz_image.type === Constants.LZ_IMAGE_TYPE_RGB32 || lz_image.type === Constants.LZ_IMAGE_TYPE_RGBA) {
      var u8 = new Uint8Array(lz_image.data);
      var ret = context.createImageData(lz_image.width, lz_image.height);
      at = lz_rgb32_decompress(u8, 0, ret.data, Constants.LZ_IMAGE_TYPE_RGB32, lz_image.type != Constants.LZ_IMAGE_TYPE_RGBA);
      if (!lz_image.top_down)
        flip_image_data(ret);
      if (lz_image.type == Constants.LZ_IMAGE_TYPE_RGBA)
        lz_rgb32_decompress(u8, at, ret.data, Constants.LZ_IMAGE_TYPE_RGBA, false);
    } else if (lz_image.type === Constants.LZ_IMAGE_TYPE_XXXA) {
      var u8 = new Uint8Array(lz_image.data);
      var ret = context.createImageData(lz_image.width, lz_image.height);
      lz_rgb32_decompress(u8, 0, ret.data, Constants.LZ_IMAGE_TYPE_RGBA, false);
    } else
      return void 0;
    return ret;
  }

  // vendor/spice-html5/bitmap.js
  function convert_spice_bitmap_to_web(context, spice_bitmap) {
    var ret;
    var offset, x, src_offset = 0, src_dec = 0;
    var u8 = new Uint8Array(spice_bitmap.data);
    if (spice_bitmap.format != Constants.SPICE_BITMAP_FMT_32BIT && spice_bitmap.format != Constants.SPICE_BITMAP_FMT_RGBA)
      return void 0;
    if (!(spice_bitmap.flags & Constants.SPICE_BITMAP_FLAGS_TOP_DOWN)) {
      src_offset = (spice_bitmap.y - 1) * spice_bitmap.stride;
      src_dec = 2 * spice_bitmap.stride;
    }
    ret = context.createImageData(spice_bitmap.x, spice_bitmap.y);
    for (offset = 0; offset < spice_bitmap.y * spice_bitmap.stride; src_offset -= src_dec)
      for (x = 0; x < spice_bitmap.x; x++, offset += 4, src_offset += 4) {
        ret.data[offset + 0] = u8[src_offset + 2];
        ret.data[offset + 1] = u8[src_offset + 1];
        ret.data[offset + 2] = u8[src_offset + 0];
        if (spice_bitmap.format == Constants.SPICE_BITMAP_FMT_32BIT)
          ret.data[offset + 3] = 255;
        else
          ret.data[offset + 3] = u8[src_offset];
      }
    return ret;
  }

  // vendor/spice-html5/display.js
  function putImageDataWithAlpha(context, d, x, y) {
    var c = document.createElement("canvas");
    var t = c.getContext("2d");
    c.setAttribute("width", d.width);
    c.setAttribute("height", d.height);
    t.putImageData(d, 0, 0);
    context.drawImage(c, x, y, d.width, d.height);
  }
  function stripAlpha(d) {
    var i;
    for (i = 0; i < d.width * d.height * 4; i += 4)
      d.data[i + 3] = 255;
  }
  function SpiceDisplayConn() {
    SpiceConn.apply(this, arguments);
  }
  SpiceDisplayConn.prototype = Object.create(SpiceConn.prototype);
  SpiceDisplayConn.prototype.process_channel_message = function(msg) {
    if (msg.type == Constants.SPICE_MSG_DISPLAY_MODE) {
      this.known_unimplemented(msg.type, "Display Mode");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_MARK) {
      this.known_unimplemented(msg.type, "Display Mark");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_RESET) {
      DEBUG > 2 && console.log("Display reset");
      this.surfaces[this.primary_surface].canvas.context.restore();
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_COPY) {
      var draw_copy = new SpiceMsgDisplayDrawCopy(msg.data);
      DEBUG > 1 && this.log_draw("DrawCopy", draw_copy);
      if (!draw_copy.base.box.is_same_size(draw_copy.data.src_area))
        this.log_warn("FIXME: DrawCopy src_area is a different size than base.box; we do not handle that yet.");
      if (draw_copy.base.clip.type != Constants.SPICE_CLIP_TYPE_NONE)
        this.log_warn("FIXME: DrawCopy we don't handle clipping yet");
      if (draw_copy.data.rop_descriptor != Constants.SPICE_ROPD_OP_PUT)
        this.log_warn("FIXME: DrawCopy we don't handle ropd type: " + draw_copy.data.rop_descriptor);
      if (draw_copy.data.mask.flags)
        this.log_warn("FIXME: DrawCopy we don't handle mask flag: " + draw_copy.data.mask.flags);
      if (draw_copy.data.mask.bitmap)
        this.log_warn("FIXME: DrawCopy we don't handle mask");
      if (draw_copy.data && draw_copy.data.src_bitmap) {
        if (draw_copy.data.src_bitmap.descriptor.flags && draw_copy.data.src_bitmap.descriptor.flags != Constants.SPICE_IMAGE_FLAGS_CACHE_ME && draw_copy.data.src_bitmap.descriptor.flags != Constants.SPICE_IMAGE_FLAGS_HIGH_BITS_SET) {
          this.log_warn("FIXME: DrawCopy unhandled image flags: " + draw_copy.data.src_bitmap.descriptor.flags);
          DEBUG <= 1 && this.log_draw("DrawCopy", draw_copy);
        }
        if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_QUIC) {
          var canvas = this.surfaces[draw_copy.base.surface_id].canvas;
          if (!draw_copy.data.src_bitmap.quic) {
            this.log_warn("FIXME: DrawCopy could not handle this QUIC file.");
            return false;
          }
          var source_img = convert_spice_quic_to_web(
            canvas.context,
            draw_copy.data.src_bitmap.quic
          );
          return this.draw_copy_helper(
            {
              base: draw_copy.base,
              src_area: draw_copy.data.src_area,
              image_data: source_img,
              tag: "copyquic." + draw_copy.data.src_bitmap.quic.type,
              has_alpha: draw_copy.data.src_bitmap.quic.type == Constants2.QUIC_IMAGE_TYPE_RGBA ? true : false,
              descriptor: draw_copy.data.src_bitmap.descriptor
            }
          );
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_FROM_CACHE || draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_FROM_CACHE_LOSSLESS) {
          if (!this.cache || !this.cache[draw_copy.data.src_bitmap.descriptor.id]) {
            this.log_warn("FIXME: DrawCopy did not find image id " + draw_copy.data.src_bitmap.descriptor.id + " in cache.");
            return false;
          }
          return this.draw_copy_helper(
            {
              base: draw_copy.base,
              src_area: draw_copy.data.src_area,
              image_data: this.cache[draw_copy.data.src_bitmap.descriptor.id],
              tag: "copycache." + draw_copy.data.src_bitmap.descriptor.id,
              has_alpha: true,
              /* FIXME - may want this to be false... */
              descriptor: draw_copy.data.src_bitmap.descriptor
            }
          );
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_SURFACE) {
          var source_context = this.surfaces[draw_copy.data.src_bitmap.surface_id].canvas.context;
          var target_context = this.surfaces[draw_copy.base.surface_id].canvas.context;
          var source_img = source_context.getImageData(
            draw_copy.data.src_area.left,
            draw_copy.data.src_area.top,
            draw_copy.data.src_area.right - draw_copy.data.src_area.left,
            draw_copy.data.src_area.bottom - draw_copy.data.src_area.top
          );
          var computed_src_area = new SpiceRect();
          computed_src_area.top = computed_src_area.left = 0;
          computed_src_area.right = source_img.width;
          computed_src_area.bottom = source_img.height;
          return this.draw_copy_helper(
            {
              base: draw_copy.base,
              src_area: computed_src_area,
              image_data: source_img,
              tag: "copysurf." + draw_copy.data.src_bitmap.surface_id,
              has_alpha: this.surfaces[draw_copy.data.src_bitmap.surface_id].format == Constants.SPICE_SURFACE_FMT_32_xRGB ? false : true,
              descriptor: draw_copy.data.src_bitmap.descriptor
            }
          );
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_JPEG) {
          if (!draw_copy.data.src_bitmap.jpeg) {
            this.log_warn("FIXME: DrawCopy could not handle this JPEG file.");
            return false;
          }
          var tmpstr = "data:image/jpeg,";
          var img = new Image();
          var i;
          var qdv = new Uint8Array(draw_copy.data.src_bitmap.jpeg.data);
          for (i = 0; i < qdv.length; i++) {
            tmpstr += "%";
            if (qdv[i] < 16)
              tmpstr += "0";
            tmpstr += qdv[i].toString(16);
          }
          img.o = {
            base: draw_copy.base,
            tag: "jpeg." + draw_copy.data.src_bitmap.surface_id,
            descriptor: draw_copy.data.src_bitmap.descriptor,
            sc: this
          };
          img.onload = handle_draw_jpeg_onload;
          img.src = tmpstr;
          return true;
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_JPEG_ALPHA) {
          if (!draw_copy.data.src_bitmap.jpeg_alpha) {
            this.log_warn("FIXME: DrawCopy could not handle this JPEG ALPHA file.");
            return false;
          }
          var tmpstr = "data:image/jpeg,";
          var img = new Image();
          var i;
          var qdv = new Uint8Array(draw_copy.data.src_bitmap.jpeg_alpha.data);
          for (i = 0; i < qdv.length; i++) {
            tmpstr += "%";
            if (qdv[i] < 16)
              tmpstr += "0";
            tmpstr += qdv[i].toString(16);
          }
          img.o = {
            base: draw_copy.base,
            tag: "jpeg." + draw_copy.data.src_bitmap.surface_id,
            descriptor: draw_copy.data.src_bitmap.descriptor,
            sc: this
          };
          if (this.surfaces[draw_copy.base.surface_id].format == Constants.SPICE_SURFACE_FMT_32_ARGB) {
            var canvas = this.surfaces[draw_copy.base.surface_id].canvas;
            img.alpha_img = convert_spice_lz_to_web(
              canvas.context,
              draw_copy.data.src_bitmap.jpeg_alpha.alpha
            );
          }
          img.onload = handle_draw_jpeg_onload;
          img.src = tmpstr;
          return true;
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_BITMAP) {
          var canvas = this.surfaces[draw_copy.base.surface_id].canvas;
          if (!draw_copy.data.src_bitmap.bitmap) {
            this.log_err("null bitmap");
            return false;
          }
          var source_img = convert_spice_bitmap_to_web(
            canvas.context,
            draw_copy.data.src_bitmap.bitmap
          );
          if (!source_img) {
            this.log_warn("FIXME: Unable to interpret bitmap of format: " + draw_copy.data.src_bitmap.bitmap.format);
            return false;
          }
          return this.draw_copy_helper(
            {
              base: draw_copy.base,
              src_area: draw_copy.data.src_area,
              image_data: source_img,
              tag: "bitmap." + draw_copy.data.src_bitmap.bitmap.format,
              has_alpha: draw_copy.data.src_bitmap.bitmap == Constants.SPICE_BITMAP_FMT_32BIT ? false : true,
              descriptor: draw_copy.data.src_bitmap.descriptor
            }
          );
        } else if (draw_copy.data.src_bitmap.descriptor.type == Constants.SPICE_IMAGE_TYPE_LZ_RGB) {
          var canvas = this.surfaces[draw_copy.base.surface_id].canvas;
          if (!draw_copy.data.src_bitmap.lz_rgb) {
            this.log_err("null lz_rgb ");
            return false;
          }
          var source_img = convert_spice_lz_to_web(
            canvas.context,
            draw_copy.data.src_bitmap.lz_rgb
          );
          if (!source_img) {
            this.log_warn("FIXME: Unable to interpret bitmap of type: " + draw_copy.data.src_bitmap.lz_rgb.type);
            return false;
          }
          return this.draw_copy_helper(
            {
              base: draw_copy.base,
              src_area: draw_copy.data.src_area,
              image_data: source_img,
              tag: "lz_rgb." + draw_copy.data.src_bitmap.lz_rgb.type,
              has_alpha: draw_copy.data.src_bitmap.lz_rgb.type == Constants.LZ_IMAGE_TYPE_RGBA ? true : false,
              descriptor: draw_copy.data.src_bitmap.descriptor
            }
          );
        } else {
          this.log_warn("FIXME: DrawCopy unhandled image type: " + draw_copy.data.src_bitmap.descriptor.type);
          this.log_draw("DrawCopy", draw_copy);
          return false;
        }
      }
      this.log_warn("FIXME: DrawCopy no src_bitmap.");
      return false;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_FILL) {
      var draw_fill = new SpiceMsgDisplayDrawFill(msg.data);
      DEBUG > 1 && this.log_draw("DrawFill", draw_fill);
      if (draw_fill.data.rop_descriptor != Constants.SPICE_ROPD_OP_PUT)
        this.log_warn("FIXME: DrawFill we don't handle ropd type: " + draw_fill.data.rop_descriptor);
      if (draw_fill.data.mask.flags)
        this.log_warn("FIXME: DrawFill we don't handle mask flag: " + draw_fill.data.mask.flags);
      if (draw_fill.data.mask.bitmap)
        this.log_warn("FIXME: DrawFill we don't handle mask");
      if (draw_fill.data.brush.type == Constants.SPICE_BRUSH_TYPE_SOLID) {
        var color = draw_fill.data.brush.color & 16777215;
        var color_str = "rgb(" + (color >> 16) + ", " + (color >> 8 & 255) + ", " + (color & 255) + ")";
        this.surfaces[draw_fill.base.surface_id].canvas.context.fillStyle = color_str;
        this.surfaces[draw_fill.base.surface_id].canvas.context.fillRect(
          draw_fill.base.box.left,
          draw_fill.base.box.top,
          draw_fill.base.box.right - draw_fill.base.box.left,
          draw_fill.base.box.bottom - draw_fill.base.box.top
        );
        if (DUMP_DRAWS && this.parent.dump_id) {
          var debug_canvas = document.createElement("canvas");
          debug_canvas.setAttribute("width", this.surfaces[draw_fill.base.surface_id].canvas.width);
          debug_canvas.setAttribute("height", this.surfaces[draw_fill.base.surface_id].canvas.height);
          debug_canvas.setAttribute("id", "fillbrush." + draw_fill.base.surface_id + "." + this.surfaces[draw_fill.base.surface_id].draw_count);
          debug_canvas.getContext("2d").fillStyle = color_str;
          debug_canvas.getContext("2d").fillRect(
            draw_fill.base.box.left,
            draw_fill.base.box.top,
            draw_fill.base.box.right - draw_fill.base.box.left,
            draw_fill.base.box.bottom - draw_fill.base.box.top
          );
          document.getElementById(this.parent.dump_id).appendChild(debug_canvas);
        }
        this.surfaces[draw_fill.base.surface_id].draw_count++;
      } else {
        this.log_warn("FIXME: DrawFill can't handle brush type: " + draw_fill.data.brush.type);
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_OPAQUE) {
      this.known_unimplemented(msg.type, "Display Draw Opaque");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_BLEND) {
      this.known_unimplemented(msg.type, "Display Draw Blend");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_BLACKNESS) {
      this.known_unimplemented(msg.type, "Display Draw Blackness");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_WHITENESS) {
      this.known_unimplemented(msg.type, "Display Draw Whiteness");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_INVERS) {
      this.known_unimplemented(msg.type, "Display Draw Invers");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_ROP3) {
      this.known_unimplemented(msg.type, "Display Draw ROP3");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_STROKE) {
      this.known_unimplemented(msg.type, "Display Draw Stroke");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_TRANSPARENT) {
      this.known_unimplemented(msg.type, "Display Draw Transparent");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_ALPHA_BLEND) {
      this.known_unimplemented(msg.type, "Display Draw Alpha Blend");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_COPY_BITS) {
      var copy_bits = new SpiceMsgDisplayCopyBits(msg.data);
      DEBUG > 1 && this.log_draw("CopyBits", copy_bits);
      var source_canvas = this.surfaces[copy_bits.base.surface_id].canvas;
      var source_context = source_canvas.context;
      var width = source_canvas.width - copy_bits.src_pos.x;
      var height = source_canvas.height - copy_bits.src_pos.y;
      if (width > copy_bits.base.box.right - copy_bits.base.box.left)
        width = copy_bits.base.box.right - copy_bits.base.box.left;
      if (height > copy_bits.base.box.bottom - copy_bits.base.box.top)
        height = copy_bits.base.box.bottom - copy_bits.base.box.top;
      var source_img = source_context.getImageData(
        copy_bits.src_pos.x,
        copy_bits.src_pos.y,
        width,
        height
      );
      putImageDataWithAlpha(source_context, source_img, copy_bits.base.box.left, copy_bits.base.box.top);
      if (DUMP_DRAWS && this.parent.dump_id) {
        var debug_canvas = document.createElement("canvas");
        debug_canvas.setAttribute("width", width);
        debug_canvas.setAttribute("height", height);
        debug_canvas.setAttribute("id", "copybits" + copy_bits.base.surface_id + "." + this.surfaces[copy_bits.base.surface_id].draw_count);
        debug_canvas.getContext("2d").putImageData(source_img, 0, 0);
        document.getElementById(this.parent.dump_id).appendChild(debug_canvas);
      }
      this.surfaces[copy_bits.base.surface_id].draw_count++;
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_INVAL_ALL_PIXMAPS) {
      this.known_unimplemented(msg.type, "Display Inval All Pixmaps");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_INVAL_PALETTE) {
      this.known_unimplemented(msg.type, "Display Inval Palette");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_INVAL_ALL_PALETTES) {
      this.known_unimplemented(msg.type, "Inval All Palettes");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_SURFACE_CREATE) {
      if (!("surfaces" in this))
        this.surfaces = [];
      var m = new SpiceMsgSurfaceCreate(msg.data);
      DEBUG > 1 && console.log(this.type + ": MsgSurfaceCreate id " + m.surface.surface_id + "; " + m.surface.width + "x" + m.surface.height + "; format " + m.surface.format + "; flags " + m.surface.flags);
      if (m.surface.format != Constants.SPICE_SURFACE_FMT_32_xRGB && m.surface.format != Constants.SPICE_SURFACE_FMT_32_ARGB) {
        this.log_warn("FIXME: cannot handle surface format " + m.surface.format + " yet.");
        return false;
      }
      var canvas = document.createElement("canvas");
      canvas.setAttribute("width", m.surface.width);
      canvas.setAttribute("height", m.surface.height);
      canvas.setAttribute("id", "spice_surface_" + m.surface.surface_id);
      canvas.setAttribute("tabindex", m.surface.surface_id);
      canvas.context = canvas.getContext("2d");
      if (DUMP_CANVASES && this.parent.dump_id)
        document.getElementById(this.parent.dump_id).appendChild(canvas);
      m.surface.canvas = canvas;
      m.surface.draw_count = 0;
      this.surfaces[m.surface.surface_id] = m.surface;
      if (m.surface.flags & Constants.SPICE_SURFACE_FLAGS_PRIMARY) {
        this.primary_surface = m.surface.surface_id;
        canvas.context.save();
        document.getElementById(this.parent.screen_id).appendChild(canvas);
        document.getElementById(this.parent.screen_id).style.height = m.surface.height + "px";
        this.hook_events();
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_SURFACE_DESTROY) {
      var m = new SpiceMsgSurfaceDestroy(msg.data);
      DEBUG > 1 && console.log(this.type + ": MsgSurfaceDestroy id " + m.surface_id);
      this.delete_surface(m.surface_id);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_CREATE) {
      var m = new SpiceMsgDisplayStreamCreate(msg.data);
      STREAM_DEBUG > 0 && console.log(
        this.type + ": MsgStreamCreate id" + m.id + "; type " + m.codec_type + "; width " + m.stream_width + "; height " + m.stream_height + "; left " + m.dest.left + "; top " + m.dest.top
      );
      if (!this.streams)
        this.streams = new Array();
      if (this.streams[m.id])
        console.log("Stream " + m.id + " already exists");
      else
        this.streams[m.id] = m;
      if (m.codec_type == Constants.SPICE_VIDEO_CODEC_TYPE_VP8) {
        var media = new MediaSource();
        var v = document.createElement("video");
        v.src = window.URL.createObjectURL(media);
        v.setAttribute("muted", true);
        v.setAttribute("autoplay", true);
        v.setAttribute("width", m.stream_width);
        v.setAttribute("height", m.stream_height);
        var left = m.dest.left;
        var top = m.dest.top;
        if (this.surfaces[m.surface_id] !== void 0) {
          left += this.surfaces[m.surface_id].canvas.offsetLeft;
          top += this.surfaces[m.surface_id].canvas.offsetTop;
        }
        document.getElementById(this.parent.screen_id).appendChild(v);
        v.setAttribute("style", "pointer-events:none; position: absolute; top:" + top + "px; left:" + left + "px;");
        media.addEventListener("sourceopen", handle_video_source_open, false);
        media.addEventListener("sourceended", handle_video_source_ended, false);
        media.addEventListener("sourceclosed", handle_video_source_closed, false);
        var s = this.streams[m.id];
        s.video = v;
        s.media = media;
        s.queue = new Array();
        s.start_time = 0;
        s.cluster_time = 0;
        s.append_okay = false;
        media.stream = s;
        media.spiceconn = this;
        v.spice_stream = s;
      } else if (m.codec_type == Constants.SPICE_VIDEO_CODEC_TYPE_MJPEG)
        this.streams[m.id].frames_loading = 0;
      else
        console.log("Unhandled stream codec: " + m.codec_type);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_DATA || msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_DATA_SIZED) {
      var m;
      if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_DATA_SIZED)
        m = new SpiceMsgDisplayStreamDataSized(msg.data);
      else
        m = new SpiceMsgDisplayStreamData(msg.data);
      if (!this.streams[m.base.id]) {
        console.log("no stream for data");
        return false;
      }
      var time_until_due = m.base.multi_media_time - this.parent.relative_now();
      if (this.streams[m.base.id].codec_type === Constants.SPICE_VIDEO_CODEC_TYPE_MJPEG)
        process_mjpeg_stream_data(this, m, time_until_due);
      if (this.streams[m.base.id].codec_type === Constants.SPICE_VIDEO_CODEC_TYPE_VP8)
        process_video_stream_data(this.streams[m.base.id], m);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_ACTIVATE_REPORT) {
      var m = new SpiceMsgDisplayStreamActivateReport(msg.data);
      var report = new SpiceMsgcDisplayStreamReport(m.stream_id, m.unique_id);
      if (this.streams[m.stream_id]) {
        this.streams[m.stream_id].report = report;
        this.streams[m.stream_id].max_window_size = m.max_window_size;
        this.streams[m.stream_id].timeout_ms = m.timeout_ms;
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_CLIP) {
      var m = new SpiceMsgDisplayStreamClip(msg.data);
      STREAM_DEBUG > 1 && console.log(this.type + ": MsgStreamClip id" + m.id);
      this.streams[m.id].clip = m.clip;
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_DESTROY) {
      var m = new SpiceMsgDisplayStreamDestroy(msg.data);
      STREAM_DEBUG > 0 && console.log(this.type + ": MsgStreamDestroy id" + m.id);
      if (this.streams[m.id].codec_type == Constants.SPICE_VIDEO_CODEC_TYPE_VP8) {
        document.getElementById(this.parent.screen_id).removeChild(this.streams[m.id].video);
        this.streams[m.id].source_buffer = null;
        this.streams[m.id].media = null;
        this.streams[m.id].video = null;
      }
      this.streams[m.id] = void 0;
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_STREAM_DESTROY_ALL) {
      this.known_unimplemented(msg.type, "Display Stream Destroy All");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_INVAL_LIST) {
      var m = new SpiceMsgDisplayInvalList(msg.data);
      var i;
      DEBUG > 1 && console.log(this.type + ": MsgInvalList " + m.count + " items");
      for (i = 0; i < m.count; i++)
        if (this.cache[m.resources[i].id] != void 0)
          delete this.cache[m.resources[i].id];
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_MONITORS_CONFIG) {
      this.known_unimplemented(msg.type, "Display Monitors Config");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_DISPLAY_DRAW_COMPOSITE) {
      this.known_unimplemented(msg.type, "Display Draw Composite");
      return true;
    }
    return false;
  };
  SpiceDisplayConn.prototype.delete_surface = function(surface_id) {
    var canvas = document.getElementById("spice_surface_" + surface_id);
    if (DUMP_CANVASES && this.parent.dump_id)
      document.getElementById(this.parent.dump_id).removeChild(canvas);
    if (this.primary_surface == surface_id) {
      this.unhook_events();
      this.primary_surface = void 0;
      document.getElementById(this.parent.screen_id).removeChild(canvas);
    }
    delete this.surfaces[surface_id];
  };
  SpiceDisplayConn.prototype.draw_copy_helper = function(o) {
    var canvas = this.surfaces[o.base.surface_id].canvas;
    if (o.has_alpha) {
      if (this.surfaces[o.base.surface_id].format == Constants.SPICE_SURFACE_FMT_32_xRGB) {
        stripAlpha(o.image_data);
        canvas.context.putImageData(o.image_data, o.base.box.left, o.base.box.top);
      } else
        putImageDataWithAlpha(
          canvas.context,
          o.image_data,
          o.base.box.left,
          o.base.box.top
        );
    } else
      canvas.context.putImageData(o.image_data, o.base.box.left, o.base.box.top);
    if (o.src_area.left > 0 || o.src_area.top > 0) {
      this.log_warn("FIXME: DrawCopy not shifting draw copies just yet...");
    }
    if (o.descriptor && o.descriptor.flags & Constants.SPICE_IMAGE_FLAGS_CACHE_ME) {
      if (!("cache" in this))
        this.cache = {};
      this.cache[o.descriptor.id] = o.image_data;
    }
    if (DUMP_DRAWS && this.parent.dump_id) {
      var debug_canvas = document.createElement("canvas");
      debug_canvas.setAttribute("width", o.image_data.width);
      debug_canvas.setAttribute("height", o.image_data.height);
      debug_canvas.setAttribute("id", o.tag + "." + this.surfaces[o.base.surface_id].draw_count + "." + o.base.surface_id + "@" + o.base.box.left + "x" + o.base.box.top);
      debug_canvas.getContext("2d").putImageData(o.image_data, 0, 0);
      document.getElementById(this.parent.dump_id).appendChild(debug_canvas);
    }
    this.surfaces[o.base.surface_id].draw_count++;
    return true;
  };
  SpiceDisplayConn.prototype.log_draw = function(prefix, draw) {
    var str = prefix + "." + draw.base.surface_id + "." + this.surfaces[draw.base.surface_id].draw_count + ": ";
    str += "base.box " + draw.base.box.left + ", " + draw.base.box.top + " to " + draw.base.box.right + ", " + draw.base.box.bottom;
    str += "; clip.type " + draw.base.clip.type;
    if (draw.data) {
      if (draw.data.src_area)
        str += "; src_area " + draw.data.src_area.left + ", " + draw.data.src_area.top + " to " + draw.data.src_area.right + ", " + draw.data.src_area.bottom;
      if (draw.data.src_bitmap && draw.data.src_bitmap != null) {
        str += "; src_bitmap id: " + draw.data.src_bitmap.descriptor.id;
        str += "; src_bitmap width " + draw.data.src_bitmap.descriptor.width + ", height " + draw.data.src_bitmap.descriptor.height;
        str += "; src_bitmap type " + draw.data.src_bitmap.descriptor.type + ", flags " + draw.data.src_bitmap.descriptor.flags;
        if (draw.data.src_bitmap.surface_id !== void 0)
          str += "; src_bitmap surface_id " + draw.data.src_bitmap.surface_id;
        if (draw.data.src_bitmap.bitmap)
          str += "; BITMAP format " + draw.data.src_bitmap.bitmap.format + "; flags " + draw.data.src_bitmap.bitmap.flags + "; x " + draw.data.src_bitmap.bitmap.x + "; y " + draw.data.src_bitmap.bitmap.y + "; stride " + draw.data.src_bitmap.bitmap.stride;
        if (draw.data.src_bitmap.quic)
          str += "; QUIC type " + draw.data.src_bitmap.quic.type + "; width " + draw.data.src_bitmap.quic.width + "; height " + draw.data.src_bitmap.quic.height;
        if (draw.data.src_bitmap.lz_rgb)
          str += "; LZ_RGB length " + draw.data.src_bitmap.lz_rgb.length + "; magic " + draw.data.src_bitmap.lz_rgb.magic + "; version 0x" + draw.data.src_bitmap.lz_rgb.version.toString(16) + "; type " + draw.data.src_bitmap.lz_rgb.type + "; width " + draw.data.src_bitmap.lz_rgb.width + "; height " + draw.data.src_bitmap.lz_rgb.height + "; stride " + draw.data.src_bitmap.lz_rgb.stride + "; top down " + draw.data.src_bitmap.lz_rgb.top_down;
      } else
        str += "; src_bitmap is null";
      if (draw.data.brush) {
        if (draw.data.brush.type == Constants.SPICE_BRUSH_TYPE_SOLID)
          str += "; brush.color 0x" + draw.data.brush.color.toString(16);
        if (draw.data.brush.type == Constants.SPICE_BRUSH_TYPE_PATTERN) {
          str += "; brush.pat ";
          if (draw.data.brush.pattern.pat != null)
            str += "[SpiceImage]";
          else
            str += "[null]";
          str += " at " + draw.data.brush.pattern.pos.x + ", " + draw.data.brush.pattern.pos.y;
        }
      }
      str += "; rop_descriptor " + draw.data.rop_descriptor;
      if (draw.data.scale_mode !== void 0)
        str += "; scale_mode " + draw.data.scale_mode;
      str += "; mask.flags " + draw.data.mask.flags;
      str += "; mask.pos " + draw.data.mask.pos.x + ", " + draw.data.mask.pos.y;
      if (draw.data.mask.bitmap != null) {
        str += "; mask.bitmap width " + draw.data.mask.bitmap.descriptor.width + ", height " + draw.data.mask.bitmap.descriptor.height;
        str += "; mask.bitmap type " + draw.data.mask.bitmap.descriptor.type + ", flags " + draw.data.mask.bitmap.descriptor.flags;
      } else
        str += "; mask.bitmap is null";
    }
    console.log(str);
  };
  SpiceDisplayConn.prototype.hook_events = function() {
    if (this.primary_surface !== void 0) {
      var canvas = this.surfaces[this.primary_surface].canvas;
      canvas.sc = this.parent;
      canvas.addEventListener("mousemove", handle_mousemove);
      canvas.addEventListener("mousedown", handle_mousedown);
      canvas.addEventListener("contextmenu", handle_contextmenu);
      canvas.addEventListener("mouseup", handle_mouseup);
      canvas.addEventListener("keydown", handle_keydown);
      canvas.addEventListener("keyup", handle_keyup);
      canvas.addEventListener("mouseout", handle_mouseout);
      canvas.addEventListener("mouseover", handle_mouseover);
      canvas.addEventListener("wheel", handle_mousewheel);
      canvas.focus();
      this.focusListener = () => this.parent.send_clipboard_grab();
      this.focusListener();
      canvas.addEventListener("focus", this.focusListener);
    }
  };
  SpiceDisplayConn.prototype.unhook_events = function() {
    if (this.primary_surface !== void 0) {
      var canvas = this.surfaces[this.primary_surface].canvas;
      canvas.removeEventListener("mousemove", handle_mousemove);
      canvas.removeEventListener("mousedown", handle_mousedown);
      canvas.removeEventListener("contextmenu", handle_contextmenu);
      canvas.removeEventListener("mouseup", handle_mouseup);
      canvas.removeEventListener("keydown", handle_keydown);
      canvas.removeEventListener("keyup", handle_keyup);
      canvas.removeEventListener("mouseout", handle_mouseout);
      canvas.removeEventListener("mouseover", handle_mouseover);
      canvas.removeEventListener("wheel", handle_mousewheel);
      canvas.removeEventListener("focus", this.focusListener);
    }
  };
  SpiceDisplayConn.prototype.destroy_surfaces = function() {
    for (var s in this.surfaces) {
      this.delete_surface(this.surfaces[s].surface_id);
    }
    this.surfaces = void 0;
  };
  function handle_mouseover(e) {
    this.focus();
  }
  function handle_mouseout(e) {
    if (this.sc && this.sc.cursor && this.sc.cursor.spice_simulated_cursor)
      this.sc.cursor.spice_simulated_cursor.style.display = "none";
    this.blur();
  }
  function handle_draw_jpeg_onload() {
    var temp_canvas = null;
    var context;
    if ("streams" in this.o.sc && this.o.sc.streams[this.o.id])
      this.o.sc.streams[this.o.id].frames_loading--;
    if (this.o.sc.surfaces[this.o.base.surface_id] === void 0) {
      DEBUG > 2 && this.o.sc.log_info("Discarding jpeg; presumed lost surface " + this.o.base.surface_id);
      temp_canvas = document.createElement("canvas");
      temp_canvas.setAttribute("width", this.o.base.box.right);
      temp_canvas.setAttribute("height", this.o.base.box.bottom);
      context = temp_canvas.getContext("2d");
    } else
      context = this.o.sc.surfaces[this.o.base.surface_id].canvas.context;
    if (this.alpha_img) {
      var c = document.createElement("canvas");
      var t = c.getContext("2d");
      c.setAttribute("width", this.alpha_img.width);
      c.setAttribute("height", this.alpha_img.height);
      t.putImageData(this.alpha_img, 0, 0);
      t.globalCompositeOperation = "source-in";
      t.drawImage(this, 0, 0);
      context.drawImage(c, this.o.base.box.left, this.o.base.box.top);
      if (this.o.descriptor && this.o.descriptor.flags & Constants.SPICE_IMAGE_FLAGS_CACHE_ME) {
        if (!("cache" in this.o.sc))
          this.o.sc.cache = {};
        this.o.sc.cache[this.o.descriptor.id] = t.getImageData(
          0,
          0,
          this.alpha_img.width,
          this.alpha_img.height
        );
      }
    } else {
      context.drawImage(this, this.o.base.box.left, this.o.base.box.top);
      this.onload = void 0;
      this.src = EMPTY_GIF_IMAGE;
      if (this.o.descriptor && this.o.descriptor.flags & Constants.SPICE_IMAGE_FLAGS_CACHE_ME) {
        if (!("cache" in this.o.sc))
          this.o.sc.cache = {};
        this.o.sc.cache[this.o.descriptor.id] = context.getImageData(
          this.o.base.box.left,
          this.o.base.box.top,
          this.o.base.box.right - this.o.base.box.left,
          this.o.base.box.bottom - this.o.base.box.top
        );
      }
    }
    if (temp_canvas == null) {
      if (DUMP_DRAWS && this.o.sc.parent.dump_id) {
        var debug_canvas = document.createElement("canvas");
        debug_canvas.setAttribute("id", this.o.tag + "." + this.o.sc.surfaces[this.o.base.surface_id].draw_count + "." + this.o.base.surface_id + "@" + this.o.base.box.left + "x" + this.o.base.box.top);
        debug_canvas.getContext("2d").drawImage(this, 0, 0);
        document.getElementById(this.o.sc.parent.dump_id).appendChild(debug_canvas);
      }
      this.o.sc.surfaces[this.o.base.surface_id].draw_count++;
    }
    if (this.o.sc.streams[this.o.id] && "report" in this.o.sc.streams[this.o.id])
      process_stream_data_report(this.o.sc, this.o.id, this.o.msg_mmtime, this.o.msg_mmtime - this.o.sc.parent.relative_now());
  }
  function process_mjpeg_stream_data(sc, m, time_until_due) {
    if (time_until_due < 0 && sc.streams[m.base.id].frames_loading > 0) {
      if ("report" in sc.streams[m.base.id])
        sc.streams[m.base.id].report.num_drops++;
      return;
    }
    var tmpstr = "data:image/jpeg,";
    var img = new Image();
    var i;
    for (i = 0; i < m.data.length; i++) {
      tmpstr += "%";
      if (m.data[i] < 16)
        tmpstr += "0";
      tmpstr += m.data[i].toString(16);
    }
    var strm_base = new SpiceMsgDisplayBase();
    strm_base.surface_id = sc.streams[m.base.id].surface_id;
    strm_base.box = m.dest || sc.streams[m.base.id].dest;
    strm_base.clip = sc.streams[m.base.id].clip;
    img.o = {
      base: strm_base,
      tag: "mjpeg." + m.base.id,
      descriptor: null,
      sc,
      id: m.base.id,
      msg_mmtime: m.base.multi_media_time
    };
    img.onload = handle_draw_jpeg_onload;
    img.src = tmpstr;
    sc.streams[m.base.id].frames_loading++;
  }
  function process_stream_data_report(sc, id, msg_mmtime, time_until_due) {
    sc.streams[id].report.num_frames++;
    if (sc.streams[id].report.start_frame_mm_time == 0)
      sc.streams[id].report.start_frame_mm_time = msg_mmtime;
    if (sc.streams[id].report.num_frames > sc.streams[id].max_window_size || msg_mmtime - sc.streams[id].report.start_frame_mm_time > sc.streams[id].timeout_ms) {
      sc.streams[id].report.end_frame_mm_time = msg_mmtime;
      sc.streams[id].report.last_frame_delay = time_until_due;
      var msg = new SpiceMiniData();
      msg.build_msg(Constants.SPICE_MSGC_DISPLAY_STREAM_REPORT, sc.streams[id].report);
      sc.send_msg(msg);
      sc.streams[id].report.start_frame_mm_time = 0;
      sc.streams[id].report.num_frames = 0;
      sc.streams[id].report.num_drops = 0;
    }
  }
  function handle_video_source_open(e) {
    var stream = this.stream;
    var p = this.spiceconn;
    if (stream.source_buffer)
      return;
    var s = this.addSourceBuffer(Constants3.SPICE_VP8_CODEC);
    if (!s) {
      p.log_err("Codec " + Constants3.SPICE_VP8_CODEC + " not available.");
      return;
    }
    stream.source_buffer = s;
    s.spiceconn = p;
    s.stream = stream;
    listen_for_video_events(stream);
    var h = new webm_Header();
    var te = new webm_VideoTrackEntry(this.stream.stream_width, this.stream.stream_height);
    var t = new webm_Tracks(te);
    var mb = new ArrayBuffer(h.buffer_size() + t.buffer_size());
    var b = h.to_buffer(mb);
    t.to_buffer(mb, b);
    s.addEventListener("error", handle_video_buffer_error, false);
    s.addEventListener("updateend", handle_append_video_buffer_done, false);
    append_video_buffer(s, mb);
  }
  function handle_video_source_ended(e) {
    var p = this.spiceconn;
    p.log_err("Video source unexpectedly ended.");
  }
  function handle_video_source_closed(e) {
    var p = this.spiceconn;
    p.log_err("Video source unexpectedly closed.");
  }
  function append_video_buffer(sb, mb) {
    try {
      sb.stream.append_okay = false;
      sb.appendBuffer(mb);
    } catch (e) {
      var p = sb.spiceconn;
      p.log_err("Error invoking appendBuffer: " + e.message);
    }
  }
  function handle_append_video_buffer_done(e) {
    var stream = this.stream;
    if (stream.current_frame && "report" in stream) {
      var sc = this.stream.media.spiceconn;
      var t = this.stream.current_frame.msg_mmtime;
      process_stream_data_report(sc, stream.id, t, t - sc.parent.relative_now());
    }
    if (stream.queue.length > 0) {
      stream.current_frame = stream.queue.shift();
      append_video_buffer(stream.source_buffer, stream.current_frame.mb);
    } else {
      stream.append_okay = true;
    }
    if (!stream.video) {
      if (STREAM_DEBUG > 0)
        console.log("Stream id " + stream.id + " received updateend after video is gone.");
      return;
    }
    if (stream.video.buffered.length > 0 && stream.video.currentTime < stream.video.buffered.start(stream.video.buffered.length - 1)) {
      console.log("Video appears to have fallen behind; advancing to " + stream.video.buffered.start(stream.video.buffered.length - 1));
      stream.video.currentTime = stream.video.buffered.start(stream.video.buffered.length - 1);
    }
    if (this.stream.video.paused && this.stream.video.readyState >= 2)
      var promise = this.stream.video.play();
    if (STREAM_DEBUG > 1)
      console.log(stream.video.currentTime + ":id " + stream.id + " updateend " + dump_media_element(stream.video));
  }
  function handle_video_buffer_error(e) {
    var p = this.spiceconn;
    p.log_err("source_buffer error " + e.message);
  }
  function push_or_queue(stream, msg, mb) {
    var frame = {
      msg_mmtime: msg.base.multi_media_time
    };
    if (stream.append_okay) {
      stream.current_frame = frame;
      append_video_buffer(stream.source_buffer, mb);
    } else {
      frame.mb = mb;
      stream.queue.push(frame);
    }
  }
  function video_simple_block(stream, msg, keyframe) {
    var simple = new webm_SimpleBlock(msg.base.multi_media_time - stream.cluster_time, msg.data, keyframe);
    var mb = new ArrayBuffer(simple.buffer_size());
    simple.to_buffer(mb);
    push_or_queue(stream, msg, mb);
  }
  function new_video_cluster(stream, msg) {
    stream.cluster_time = msg.base.multi_media_time;
    var c = new webm_Cluster(stream.cluster_time - stream.start_time, msg.data);
    var mb = new ArrayBuffer(c.buffer_size());
    c.to_buffer(mb);
    push_or_queue(stream, msg, mb);
    video_simple_block(stream, msg, true);
  }
  function process_video_stream_data(stream, msg) {
    if (stream.start_time == 0) {
      stream.start_time = msg.base.multi_media_time;
      new_video_cluster(stream, msg);
    } else if (msg.base.multi_media_time - stream.cluster_time >= Constants3.MAX_CLUSTER_TIME)
      new_video_cluster(stream, msg);
    else
      video_simple_block(stream, msg, false);
  }
  function video_handle_event_debug(e) {
    var s = this.spice_stream;
    if (s.video) {
      if (STREAM_DEBUG > 0 || s.video.buffered.len > 1)
        console.log(s.video.currentTime + ":id " + s.id + " event " + e.type + dump_media_element(s.video));
    }
    if (STREAM_DEBUG > 1 && s.media)
      console.log("  media_source " + dump_media_source(s.media));
    if (STREAM_DEBUG > 1 && s.source_buffer)
      console.log("  source_buffer " + dump_source_buffer(s.source_buffer));
    if (STREAM_DEBUG > 1 || s.queue.length > 1)
      console.log("  queue len " + s.queue.length + "; append_okay: " + s.append_okay);
  }
  function video_debug_listen_for_one_event(name) {
    this.addEventListener(name, video_handle_event_debug);
  }
  function listen_for_video_events(stream) {
    var video_0_events = [
      "abort",
      "error"
    ];
    var video_1_events = [
      "loadstart",
      "suspend",
      "emptied",
      "stalled",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "playing",
      "waiting",
      "seeking",
      "seeked",
      "ended",
      "durationchange",
      "play",
      "pause",
      "ratechange"
    ];
    var video_2_events = [
      "timeupdate",
      "progress",
      "resize",
      "volumechange"
    ];
    video_0_events.forEach(video_debug_listen_for_one_event, stream.video);
    if (STREAM_DEBUG > 0)
      video_1_events.forEach(video_debug_listen_for_one_event, stream.video);
    if (STREAM_DEBUG > 1)
      video_2_events.forEach(video_debug_listen_for_one_event, stream.video);
  }

  // vendor/spice-html5/playback.js
  function SpicePlaybackConn() {
    SpiceConn.apply(this, arguments);
    this.queue = new Array();
    this.append_okay = false;
    this.start_time = 0;
  }
  SpicePlaybackConn.prototype = Object.create(SpiceConn.prototype);
  SpicePlaybackConn.prototype.process_channel_message = function(msg) {
    if (!!!window.MediaSource) {
      this.log_err("MediaSource API is not available");
      return false;
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_START) {
      var start = new SpiceMsgPlaybackStart(msg.data);
      PLAYBACK_DEBUG > 0 && console.log("PlaybackStart; frequency " + start.frequency);
      if (start.frequency != Constants3.OPUS_FREQUENCY) {
        this.log_err("This player cannot handle frequency " + start.frequency);
        return false;
      }
      if (start.channels != Constants3.OPUS_CHANNELS) {
        this.log_err("This player cannot handle " + start.channels + " channels");
        return false;
      }
      if (start.format != Constants.SPICE_AUDIO_FMT_S16) {
        this.log_err("This player cannot format " + start.format);
        return false;
      }
      if (!this.source_buffer) {
        this.media_source = new MediaSource();
        this.media_source.spiceconn = this;
        this.audio = document.createElement("audio");
        this.audio.spiceconn = this;
        this.audio.setAttribute("autoplay", true);
        this.audio.src = window.URL.createObjectURL(this.media_source);
        document.getElementById(this.parent.screen_id).appendChild(this.audio);
        this.media_source.addEventListener("sourceopen", handle_source_open, false);
        this.media_source.addEventListener("sourceended", handle_source_ended, false);
        this.media_source.addEventListener("sourceclosed", handle_source_closed, false);
        this.bytes_written = 0;
        return true;
      }
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_DATA) {
      var data = new SpiceMsgPlaybackData(msg.data);
      if (!this.source_buffer)
        return true;
      if (this.audio.readyState >= 3 && this.audio.buffered.length > 1 && this.audio.currentTime == this.audio.buffered.end(0) && this.audio.currentTime < this.audio.buffered.start(this.audio.buffered.length - 1)) {
        console.log("Audio underrun: we appear to have fallen behind; advancing to " + this.audio.buffered.start(this.audio.buffered.length - 1));
        this.audio.currentTime = this.audio.buffered.start(this.audio.buffered.length - 1);
      }
      if (this.start_time != 0 && data.time != this.last_data_time + Constants3.EXPECTED_PACKET_DURATION) {
        if (Math.abs(data.time - (Constants3.EXPECTED_PACKET_DURATION + this.last_data_time)) < Constants3.MAX_CLUSTER_TIME) {
          PLAYBACK_DEBUG > 1 && console.log("Hacking time of " + data.time + " to " + (this.last_data_time + Constants3.EXPECTED_PACKET_DURATION));
          data.time = this.last_data_time + Constants3.EXPECTED_PACKET_DURATION;
        } else {
          PLAYBACK_DEBUG > 1 && console.log("Apparent gap in audio time; now is " + data.time + " last was " + this.last_data_time);
        }
      }
      this.last_data_time = data.time;
      PLAYBACK_DEBUG > 1 && console.log("PlaybackData; time " + data.time + "; length " + data.data.byteLength);
      if (this.start_time == 0)
        this.start_playback(data);
      else if (data.time - this.cluster_time >= Constants3.MAX_CLUSTER_TIME)
        this.new_cluster(data);
      else
        this.simple_block(data, false);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_MODE) {
      var mode = new SpiceMsgPlaybackMode(msg.data);
      if (mode.mode != Constants.SPICE_AUDIO_DATA_MODE_OPUS) {
        this.log_err("This player cannot handle mode " + mode.mode);
        delete this.source_buffer;
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_STOP) {
      PLAYBACK_DEBUG > 0 && console.log("PlaybackStop");
      if (this.source_buffer) {
        document.getElementById(this.parent.screen_id).removeChild(this.audio);
        window.URL.revokeObjectURL(this.audio.src);
        delete this.source_buffer;
        delete this.media_source;
        delete this.audio;
        this.append_okay = false;
        this.queue = new Array();
        this.start_time = 0;
        return true;
      }
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_VOLUME) {
      this.known_unimplemented(msg.type, "Playback Volume");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_MUTE) {
      this.known_unimplemented(msg.type, "Playback Mute");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_PLAYBACK_LATENCY) {
      this.known_unimplemented(msg.type, "Playback Latency");
      return true;
    }
    return false;
  };
  SpicePlaybackConn.prototype.start_playback = function(data) {
    this.start_time = data.time;
    var h = new webm_Header();
    var te = new webm_AudioTrackEntry();
    var t = new webm_Tracks(te);
    var mb = new ArrayBuffer(h.buffer_size() + t.buffer_size());
    this.bytes_written = h.to_buffer(mb);
    this.bytes_written = t.to_buffer(mb, this.bytes_written);
    this.source_buffer.addEventListener("error", handle_sourcebuffer_error, false);
    this.source_buffer.addEventListener("updateend", handle_append_buffer_done, false);
    playback_append_buffer(this, mb);
    this.new_cluster(data);
  };
  SpicePlaybackConn.prototype.new_cluster = function(data) {
    this.cluster_time = data.time;
    var c = new webm_Cluster(data.time - this.start_time);
    var mb = new ArrayBuffer(c.buffer_size());
    this.bytes_written += c.to_buffer(mb);
    if (this.append_okay)
      playback_append_buffer(this, mb);
    else
      this.queue.push(mb);
    this.simple_block(data, true);
  };
  SpicePlaybackConn.prototype.simple_block = function(data, keyframe) {
    var sb = new webm_SimpleBlock(data.time - this.cluster_time, data.data, keyframe);
    var mb = new ArrayBuffer(sb.buffer_size());
    this.bytes_written += sb.to_buffer(mb);
    if (this.append_okay)
      playback_append_buffer(this, mb);
    else
      this.queue.push(mb);
  };
  function handle_source_open(e) {
    var p = this.spiceconn;
    if (p.source_buffer)
      return;
    p.source_buffer = this.addSourceBuffer(Constants3.SPICE_PLAYBACK_CODEC);
    if (!p.source_buffer) {
      p.log_err("Codec " + Constants3.SPICE_PLAYBACK_CODEC + " not available.");
      return;
    }
    if (PLAYBACK_DEBUG > 0)
      playback_handle_event_debug.call(this, e);
    listen_for_audio_events(p);
    p.source_buffer.spiceconn = p;
    p.source_buffer.mode = "segments";
  }
  function handle_source_ended(e) {
    var p = this.spiceconn;
    p.log_err("Audio source unexpectedly ended.");
  }
  function handle_source_closed(e) {
    var p = this.spiceconn;
    p.log_err("Audio source unexpectedly closed.");
  }
  function condense_playback_queue(queue) {
    if (queue.length == 1)
      return queue.shift();
    var len = 0;
    var i = 0;
    for (i = 0; i < queue.length; i++)
      len += queue[i].byteLength;
    var mb = new ArrayBuffer(len);
    var tmp = new Uint8Array(mb);
    len = 0;
    for (i = 0; i < queue.length; i++) {
      tmp.set(new Uint8Array(queue[i]), len);
      len += queue[i].byteLength;
    }
    queue.length = 0;
    return mb;
  }
  function handle_append_buffer_done(e) {
    var p = this.spiceconn;
    if (PLAYBACK_DEBUG > 1)
      playback_handle_event_debug.call(this, e);
    if (p.queue.length > 0) {
      var mb = condense_playback_queue(p.queue);
      playback_append_buffer(p, mb);
    } else
      p.append_okay = true;
  }
  function handle_sourcebuffer_error(e) {
    var p = this.spiceconn;
    p.log_err("source_buffer error " + e.message);
  }
  function playback_append_buffer(p, b) {
    try {
      p.source_buffer.appendBuffer(b);
      p.append_okay = false;
    } catch (e) {
      p.log_err("Error invoking appendBuffer: " + e.message);
    }
  }
  function playback_handle_event_debug(e) {
    var p = this.spiceconn;
    if (p.audio) {
      if (PLAYBACK_DEBUG > 0 || p.audio.buffered.len > 1)
        console.log(p.audio.currentTime + ": event " + e.type + dump_media_element(p.audio));
    }
    if (PLAYBACK_DEBUG > 1 && p.media_source)
      console.log("  media_source " + dump_media_source(p.media_source));
    if (PLAYBACK_DEBUG > 1 && p.source_buffer)
      console.log("  source_buffer " + dump_source_buffer(p.source_buffer));
    if (PLAYBACK_DEBUG > 0 || p.queue.length > 1)
      console.log("  queue len " + p.queue.length + "; append_okay: " + p.append_okay);
  }
  function playback_debug_listen_for_one_event(name) {
    this.addEventListener(name, playback_handle_event_debug);
  }
  function listen_for_audio_events(spiceconn) {
    var audio_0_events = [
      "abort",
      "error"
    ];
    var audio_1_events = [
      "loadstart",
      "suspend",
      "emptied",
      "stalled",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "canplaythrough",
      "playing",
      "waiting",
      "seeking",
      "seeked",
      "ended",
      "durationchange",
      "timeupdate",
      "play",
      "pause",
      "ratechange"
    ];
    var audio_2_events = [
      "progress",
      "resize",
      "volumechange"
    ];
    audio_0_events.forEach(playback_debug_listen_for_one_event, spiceconn.audio);
    if (PLAYBACK_DEBUG > 0)
      audio_1_events.forEach(playback_debug_listen_for_one_event, spiceconn.audio);
    if (PLAYBACK_DEBUG > 1)
      audio_2_events.forEach(playback_debug_listen_for_one_event, spiceconn.audio);
  }

  // vendor/spice-html5/port.js
  function SpicePortConn() {
    DEBUG > 0 && console.log("SPICE port: created SPICE port channel. Args:", arguments);
    SpiceConn.apply(this, arguments);
    this.port_name = null;
  }
  SpicePortConn.prototype = Object.create(SpiceConn.prototype);
  SpicePortConn.prototype.process_channel_message = function(msg) {
    if (msg.type == Constants.SPICE_MSG_PORT_INIT) {
      if (this.port_name === null) {
        var m = new SpiceMsgPortInit(msg.data);
        this.portName = arraybuffer_to_str(new Uint8Array(m.name));
        this.portOpened = m.opened;
        DEBUG > 0 && console.log("SPICE port: Port", this.portName, "initialized");
        return true;
      }
      DEBUG > 0 && console.log("SPICE port: Port", this.port_name, "is already initialized.");
    } else if (msg.type == Constants.SPICE_MSG_PORT_EVENT) {
      DEBUG > 0 && console.log("SPICE port: Port event received for", this.portName, msg);
      var event = new CustomEvent("spice-port-event", {
        detail: {
          channel: this,
          spiceEvent: new Uint8Array(msg.data)
        },
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(event);
      return true;
    } else if (msg.type == Constants.SPICE_MSG_SPICEVMC_DATA) {
      DEBUG > 0 && console.log("SPICE port: Data received in port", this.portName, msg);
      var event = new CustomEvent("spice-port-data", {
        detail: {
          channel: this,
          data: msg.data
        },
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(event);
      return true;
    } else {
      DEBUG > 0 && console.log("SPICE port: SPICE message type not recognized:", msg);
    }
    return false;
  };

  // vendor/spice-html5/resize.js
  function resize_helper(sc) {
    var w = document.getElementById(sc.screen_id).clientWidth;
    var m = document.getElementById(sc.message_id);
    var h = window.innerHeight - 20;
    if (m != null) {
      if (window.getComputedStyle(m).getPropertyValue("display") == "none") {
        var mh = parseInt(window.getComputedStyle(m).getPropertyValue("height"), 10);
        h = h - mh;
      } else {
        h = h - m.offsetHeight - m.clientHeight;
      }
    }
    if (h % 8 > 0)
      h -= h % 8;
    if (w % 8 > 0)
      w -= w % 8;
    sc.resize_window(0, w, h, 32, 0, 0);
    sc.spice_resize_timer = void 0;
  }
  function handle_resize(e) {
    var sc = window.spice_connection;
    if (sc && sc.spice_resize_timer) {
      window.clearTimeout(sc.spice_resize_timer);
      sc.spice_resize_timer = void 0;
    }
    sc.spice_resize_timer = window.setTimeout(resize_helper, 200, sc);
  }

  // vendor/spice-html5/main.js
  function SpiceMainConn() {
    if (typeof WebSocket === "undefined")
      throw new Error("WebSocket unavailable.  You need to use a different browser.");
    SpiceConn.apply(this, arguments);
    this.agent_msg_queue = [];
    this.file_xfer_tasks = {};
    this.file_xfer_task_id = 0;
    this.file_xfer_read_queue = [];
    this.ports = [];
    this.agent_caps = [0];
  }
  SpiceMainConn.prototype = Object.create(SpiceConn.prototype);
  SpiceMainConn.prototype.process_channel_message = function(msg) {
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_BEGIN) {
      this.known_unimplemented(msg.type, "Main Migrate Begin");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_CANCEL) {
      this.known_unimplemented(msg.type, "Main Migrate Cancel");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_INIT) {
      this.log_info("Connected to " + this.ws.url);
      this.report_success("Connected");
      this.main_init = new SpiceMsgMainInit(msg.data);
      this.connection_id = this.main_init.session_id;
      this.agent_tokens = this.main_init.agent_tokens;
      if (DEBUG > 0) {
        this.log_info("session id " + this.main_init.session_id + " ; display_channels_hint " + this.main_init.display_channels_hint + " ; supported_mouse_modes " + this.main_init.supported_mouse_modes + " ; current_mouse_mode " + this.main_init.current_mouse_mode + " ; agent_connected " + this.main_init.agent_connected + " ; agent_tokens " + this.main_init.agent_tokens + " ; multi_media_time " + this.main_init.multi_media_time + " ; ram_hint " + this.main_init.ram_hint);
      }
      this.our_mm_time = Date.now();
      this.mm_time = this.main_init.multi_media_time;
      this.handle_mouse_mode(
        this.main_init.current_mouse_mode,
        this.main_init.supported_mouse_modes
      );
      if (this.main_init.agent_connected)
        this.connect_agent();
      var attach = new SpiceMiniData();
      attach.type = Constants.SPICE_MSGC_MAIN_ATTACH_CHANNELS;
      attach.size = attach.buffer_size();
      this.send_msg(attach);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MOUSE_MODE) {
      var mode = new SpiceMsgMainMouseMode(msg.data);
      DEBUG > 0 && this.log_info("Mouse supported modes " + mode.supported_modes + "; current " + mode.current_mode);
      this.handle_mouse_mode(mode.current_mode, mode.supported_modes);
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MULTI_MEDIA_TIME) {
      this.known_unimplemented(msg.type, "Main Multi Media Time");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_CHANNELS_LIST) {
      var i;
      var chans;
      DEBUG > 0 && console.log("channels");
      chans = new SpiceMsgChannels(msg.data);
      for (i = 0; i < chans.channels.length; i++) {
        var conn = {
          uri: this.ws.url,
          parent: this,
          connection_id: this.connection_id,
          type: chans.channels[i].type,
          chan_id: chans.channels[i].id
        };
        if (chans.channels[i].type == Constants.SPICE_CHANNEL_DISPLAY) {
          if (chans.channels[i].id == 0) {
            this.display = new SpiceDisplayConn(conn);
          } else {
            this.log_warn("The spice-html5 client does not handle multiple heads.");
          }
        } else if (chans.channels[i].type == Constants.SPICE_CHANNEL_INPUTS) {
          this.inputs = new SpiceInputsConn(conn);
          this.inputs.mouse_mode = this.mouse_mode;
        } else if (chans.channels[i].type == Constants.SPICE_CHANNEL_CURSOR)
          this.cursor = new SpiceCursorConn(conn);
        else if (chans.channels[i].type == Constants.SPICE_CHANNEL_PLAYBACK)
          this.cursor = new SpicePlaybackConn(conn);
        else if (chans.channels[i].type == Constants.SPICE_CHANNEL_PORT)
          this.ports.push(new SpicePortConn(conn));
        else {
          if (!("extra_channels" in this))
            this.extra_channels = [];
          this.extra_channels[i] = new SpiceConn(conn);
          this.log_err("Channel type " + this.extra_channels[i].channel_type() + " not implemented");
        }
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_AGENT_CONNECTED) {
      this.connect_agent();
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_AGENT_CONNECTED_TOKENS) {
      var connected_tokens = new SpiceMsgMainAgentTokens(msg.data);
      this.agent_tokens = connected_tokens.num_tokens;
      this.connect_agent();
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_AGENT_TOKEN) {
      var remaining_tokens, tokens = new SpiceMsgMainAgentTokens(msg.data);
      this.agent_tokens += tokens.num_tokens;
      this.send_agent_message_queue();
      remaining_tokens = this.agent_tokens;
      while (remaining_tokens > 0 && this.file_xfer_read_queue.length > 0) {
        var xfer_task = this.file_xfer_read_queue.shift();
        this.file_xfer_read(xfer_task, xfer_task.read_bytes);
        remaining_tokens--;
      }
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_AGENT_DISCONNECTED) {
      this.agent_connected = false;
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_AGENT_DATA) {
      var agent_data = new SpiceMsgMainAgentData(msg.data);
      if (agent_data.type == Constants.VD_AGENT_ANNOUNCE_CAPABILITIES) {
        var agent_caps = new VDAgentAnnounceCapabilities(agent_data.data);
        this.agent_caps = [agent_caps.caps];
        if (agent_caps.request)
          this.announce_agent_capabilities(0);
        return true;
      } else if (agent_data.type == Constants.VD_AGENT_FILE_XFER_STATUS) {
        this.handle_file_xfer_status(new VDAgentFileXferStatusMessage(agent_data.data));
        return true;
      } else if (agent_data.type == Constants.VD_AGENT_CLIPBOARD_GRAB) {
        this.handle_clipboard_grab();
        return true;
      } else if (agent_data.type == Constants.VD_AGENT_CLIPBOARD) {
        this.handle_clipboard_receive(agent_data);
        return true;
      } else if (agent_data.type == Constants.VD_AGENT_CLIPBOARD_REQUEST) {
        this.handle_clipboard_send();
        return true;
      } else if (agent_data.type == Constants.VD_AGENT_CLIPBOARD_RELEASE) {
        return true;
      }
      return false;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_SWITCH_HOST) {
      this.known_unimplemented(msg.type, "Main Migrate Switch Host");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_END) {
      this.known_unimplemented(msg.type, "Main Migrate End");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_NAME) {
      this.known_unimplemented(msg.type, "Main Name");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_UUID) {
      this.known_unimplemented(msg.type, "Main UUID");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_BEGIN_SEAMLESS) {
      this.known_unimplemented(msg.type, "Main Migrate Begin Seamless");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_DST_SEAMLESS_ACK) {
      this.known_unimplemented(msg.type, "Main Migrate Dst Seamless ACK");
      return true;
    }
    if (msg.type == Constants.SPICE_MSG_MAIN_MIGRATE_DST_SEAMLESS_NACK) {
      this.known_unimplemented(msg.type, "Main Migrate Dst Seamless NACK");
      return true;
    }
    return false;
  };
  SpiceMainConn.prototype.stop = function(msg) {
    this.state = "closing";
    if (this.inputs) {
      this.inputs.cleanup();
      this.inputs = void 0;
    }
    if (this.cursor) {
      this.cursor.cleanup();
      this.cursor = void 0;
    }
    if (this.display) {
      this.display.cleanup();
      this.display.destroy_surfaces();
      this.display = void 0;
    }
    this.cleanup();
    if ("extra_channels" in this)
      for (var e in this.extra_channels)
        this.extra_channels[e].cleanup();
    this.extra_channels = void 0;
  };
  SpiceMainConn.prototype.send_agent_message_queue = function(message) {
    if (!this.agent_connected)
      return;
    if (message)
      this.agent_msg_queue.push(message);
    while (this.agent_tokens > 0 && this.agent_msg_queue.length > 0) {
      var mr = this.agent_msg_queue.shift();
      this.send_msg(mr);
      this.agent_tokens--;
    }
  };
  SpiceMainConn.prototype.send_agent_message = function(type, message) {
    var agent_data = new SpiceMsgcMainAgentData(type, message);
    var sb = 0, maxsize = Constants.VD_AGENT_MAX_DATA_SIZE - SpiceMiniData.prototype.buffer_size();
    var data = new ArrayBuffer(agent_data.buffer_size());
    agent_data.to_buffer(data);
    while (sb < agent_data.buffer_size()) {
      var eb = Math.min(sb + maxsize, agent_data.buffer_size());
      var mr = new SpiceMiniData();
      mr.type = Constants.SPICE_MSGC_MAIN_AGENT_DATA;
      mr.size = eb - sb;
      mr.data = data.slice(sb, eb);
      this.send_agent_message_queue(mr);
      sb = eb;
    }
  };
  SpiceMainConn.prototype.announce_agent_capabilities = function(request) {
    var caps = new VDAgentAnnounceCapabilities(request, 1 << Constants.VD_AGENT_CAP_MOUSE_STATE | 1 << Constants.VD_AGENT_CAP_MONITORS_CONFIG | 1 << Constants.VD_AGENT_CAP_REPLY | 1 << Constants.VD_AGENT_CAP_CLIPBOARD_SELECTION | 1 << Constants.VD_AGENT_CAP_CLIPBOARD_BY_DEMAND);
    this.send_agent_message(Constants.VD_AGENT_ANNOUNCE_CAPABILITIES, caps);
  };
  SpiceMainConn.prototype.resize_window = function(flags, width, height, depth, x, y) {
    var monitors_config = new VDAgentMonitorsConfig(flags, width, height, depth, x, y);
    this.send_agent_message(Constants.VD_AGENT_MONITORS_CONFIG, monitors_config);
  };
  SpiceMainConn.prototype.file_xfer_start = function(file) {
    var task_id, xfer_start, task;
    task_id = this.file_xfer_task_id++;
    task = new SpiceFileXferTask(task_id, file);
    task.create_progressbar();
    this.file_xfer_tasks[task_id] = task;
    xfer_start = new VDAgentFileXferStartMessage(task_id, file.name, file.size);
    this.send_agent_message(Constants.VD_AGENT_FILE_XFER_START, xfer_start);
  };
  SpiceMainConn.prototype.handle_file_xfer_status = function(file_xfer_status) {
    var xfer_error, xfer_task;
    if (!this.file_xfer_tasks[file_xfer_status.id]) {
      return;
    }
    xfer_task = this.file_xfer_tasks[file_xfer_status.id];
    switch (file_xfer_status.result) {
      case Constants.VD_AGENT_FILE_XFER_STATUS_CAN_SEND_DATA:
        this.file_xfer_read(xfer_task);
        return;
      case Constants.VD_AGENT_FILE_XFER_STATUS_CANCELLED:
        xfer_error = "transfer is cancelled by spice agent";
        break;
      case Constants.VD_AGENT_FILE_XFER_STATUS_ERROR:
        xfer_error = "some errors occurred in the spice agent";
        break;
      case Constants.VD_AGENT_FILE_XFER_STATUS_SUCCESS:
        break;
      default:
        xfer_error = "unhandled status type: " + file_xfer_status.result;
        break;
    }
    this.file_xfer_completed(xfer_task, xfer_error);
  };
  SpiceMainConn.prototype.file_xfer_read = function(file_xfer_task, start_byte) {
    var FILE_XFER_CHUNK_SIZE = 32 * Constants.VD_AGENT_MAX_DATA_SIZE;
    var _this = this;
    var sb, eb;
    var slice, reader;
    if (!file_xfer_task || !this.file_xfer_tasks[file_xfer_task.id] || start_byte > 0 && start_byte == file_xfer_task.file.size) {
      return;
    }
    if (file_xfer_task.cancelled) {
      var xfer_status = new VDAgentFileXferStatusMessage(
        file_xfer_task.id,
        Constants.VD_AGENT_FILE_XFER_STATUS_CANCELLED
      );
      this.send_agent_message(Constants.VD_AGENT_FILE_XFER_STATUS, xfer_status);
      delete this.file_xfer_tasks[file_xfer_task.id];
      return;
    }
    sb = start_byte || 0, eb = Math.min(sb + FILE_XFER_CHUNK_SIZE, file_xfer_task.file.size);
    if (!this.agent_tokens) {
      file_xfer_task.read_bytes = sb;
      this.file_xfer_read_queue.push(file_xfer_task);
      return;
    }
    reader = new FileReader();
    reader.onload = function(e) {
      var xfer_data = new VDAgentFileXferDataMessage(
        file_xfer_task.id,
        e.target.result.byteLength,
        e.target.result
      );
      _this.send_agent_message(Constants.VD_AGENT_FILE_XFER_DATA, xfer_data);
      _this.file_xfer_read(file_xfer_task, eb);
      file_xfer_task.update_progressbar(eb);
    };
    slice = file_xfer_task.file.slice(sb, eb);
    reader.readAsArrayBuffer(slice);
  };
  SpiceMainConn.prototype.file_xfer_completed = function(file_xfer_task, error) {
    if (error)
      this.log_err(error);
    else
      this.log_info("transfer of '" + file_xfer_task.file.name + "' was successful");
    file_xfer_task.remove_progressbar();
    delete this.file_xfer_tasks[file_xfer_task.id];
  };
  SpiceMainConn.prototype.handle_clipboard_grab = function() {
    DEBUG > 1 && console.log("handling clipboard grab from agent");
    const type = Constants.VD_AGENT_CLIPBOARD_UTF8_TEXT;
    const clipboard_request = new SpiceMsgClipboardRequest(type, this.agent_caps);
    this.send_agent_message(Constants.VD_AGENT_CLIPBOARD_REQUEST, clipboard_request);
  };
  SpiceMainConn.prototype.handle_clipboard_receive = function(agent_data) {
    DEBUG > 1 && console.log("received clipboard data from agent");
    const received_clipboard = new SpiceMsgClipboardReceive(agent_data, this.agent_caps);
    if (received_clipboard.type === Constants.VD_AGENT_CLIPBOARD_UTF8_TEXT) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const text = received_clipboard.get_text();
        navigator.clipboard.writeText(text).catch((err) => {
          console.warn("Failed to write to navigator clipboard:", err);
        });
      }
    } else {
      console.log("Unsupported clipboard type:", received_clipboard.type);
    }
  };
  SpiceMainConn.prototype.handle_clipboard_send = function() {
    DEBUG > 1 && console.log("sending clipboard data to agent");
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then((text) => {
        const type = Constants.VD_AGENT_CLIPBOARD_UTF8_TEXT;
        const clipboard_msg = new SpiceMsgClipboardSend(type, text, this.agent_caps);
        this.send_agent_message(Constants.VD_AGENT_CLIPBOARD, clipboard_msg);
      }).catch((err) => {
        console.log("Failed to read clipboard:", err);
      });
    }
  };
  SpiceMainConn.prototype.send_clipboard_grab = function() {
    DEBUG > 1 && console.log("browser is asking agent to grab clipboard");
    const type = Constants.VD_AGENT_CLIPBOARD_UTF8_TEXT;
    const grab_message = new SpiceMsgClipboardGrab(type, this.agent_caps);
    this.send_agent_message(Constants.VD_AGENT_CLIPBOARD_GRAB, grab_message);
  };
  SpiceMainConn.prototype.connect_agent = function() {
    this.agent_connected = true;
    var agent_start = new SpiceMsgcMainAgentStart(~0);
    var mr = new SpiceMiniData();
    mr.build_msg(Constants.SPICE_MSGC_MAIN_AGENT_START, agent_start);
    this.send_msg(mr);
    this.announce_agent_capabilities(1);
    if (this.onagent !== void 0)
      this.onagent(this);
  };
  SpiceMainConn.prototype.handle_mouse_mode = function(current, supported) {
    this.mouse_mode = current;
    if (current != Constants.SPICE_MOUSE_MODE_CLIENT && supported & Constants.SPICE_MOUSE_MODE_CLIENT) {
      var mode_request = new SpiceMsgcMainMouseModeRequest(Constants.SPICE_MOUSE_MODE_CLIENT);
      var mr = new SpiceMiniData();
      mr.build_msg(Constants.SPICE_MSGC_MAIN_MOUSE_MODE_REQUEST, mode_request);
      this.send_msg(mr);
    }
    if (this.inputs)
      this.inputs.mouse_mode = current;
  };
  SpiceMainConn.prototype.relative_now = function() {
    var ret = Date.now() - this.our_mm_time + this.mm_time;
    return ret;
  };
  return __toCommonJS(main_exports);
})();
window.SpiceMainConn = SpiceHtml5.SpiceMainConn;
