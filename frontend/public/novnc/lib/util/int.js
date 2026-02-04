"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.toSigned32bit = toSigned32bit;
exports.toUnsigned32bit = toUnsigned32bit;

/*
 * noVNC: HTML5 VNC client
 * Copyright (C) 2020 The noVNC authors
 * Licensed under MPL 2.0 (see LICENSE.txt)
 *
 * See README.md for usage and integration instructions.
 */

function toUnsigned32bit(toConvert) {
  return toConvert >>> 0;
}

function toSigned32bit(toConvert) {
  return toConvert | 0;
}