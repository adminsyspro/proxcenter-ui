"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.bigIntToU8Array = bigIntToU8Array;
exports.modPow = modPow;
exports.u8ArrayToBigInt = u8ArrayToBigInt;

function modPow(b, e, m) {
  var r = 1n;

  b = b % m;

  while (e > 0n) {
    if ((e & 1n) === 1n) {
      r = r * b % m;
    }

    e = e >> 1n;
    b = b * b % m;
  }

  
return r;
}

function bigIntToU8Array(bigint) {
  var padLength = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;
  var hex = bigint.toString(16);

  if (padLength === 0) {
    padLength = Math.ceil(hex.length / 2);
  }

  hex = hex.padStart(padLength * 2, '0');
  var length = hex.length / 2;
  var arr = new Uint8Array(length);

  for (var i = 0; i < length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  
return arr;
}

function u8ArrayToBigInt(arr) {
  var hex = '0x';

  for (var i = 0; i < arr.length; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }

  
return BigInt(hex);
}