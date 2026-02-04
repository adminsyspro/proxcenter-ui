"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.decodeUTF8 = decodeUTF8;
exports.encodeUTF8 = encodeUTF8;

/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2019 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

// Decode from UTF-8
function decodeUTF8(utf8string) {
  var allowLatin1 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

  try {
    return decodeURIComponent(escape(utf8string));
  } catch (e) {
    if (e instanceof URIError) {
      if (allowLatin1) {
        // If we allow Latin1 we can ignore any decoding fails
        // and in these cases return the original string
        return utf8string;
      }
    }

    throw e;
  }
}

// Encode to UTF-8
function encodeUTF8(DOMString) {
  return unescape(encodeURIComponent(DOMString));
}