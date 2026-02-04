"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Warn = exports.Info = exports.Error = exports.Debug = void 0;
exports.getLogging = getLogging;
exports.initLogging = initLogging;

/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

/*
 * Logging/debug routines
 */

var _logLevel = 'warn';
var Debug = exports.Debug = function Debug() {};
var Info = exports.Info = function Info() {};
var Warn = exports.Warn = function Warn() {};
var Error = exports.Error = function Error() {};

function initLogging(level) {
  if (typeof level === 'undefined') {
    level = _logLevel;
  } else {
    _logLevel = level;
  }

  exports.Debug = Debug = exports.Info = Info = exports.Warn = Warn = exports.Error = Error = function Error() {};

  if (typeof window.console !== "undefined") {
    /* eslint-disable no-console, no-fallthrough */
    switch (level) {
      case 'debug':
        exports.Debug = Debug = console.debug.bind(window.console);
      case 'info':
        exports.Info = Info = console.info.bind(window.console);
      case 'warn':
        exports.Warn = Warn = console.warn.bind(window.console);
      case 'error':
        exports.Error = Error = console.error.bind(window.console);
      case 'none':
        break;
      default:
        throw new window.Error("invalid logging type '" + level + "'");
    }
    /* eslint-enable no-console, no-fallthrough */
  }
}

function getLogging() {
  return _logLevel;
}


// Initialize logging level
initLogging();