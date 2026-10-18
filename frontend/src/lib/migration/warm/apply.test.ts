import { describe, expect, it } from "vitest"

import { warmFinalTransfer } from "./apply"

describe("warmFinalTransfer", () => {
  it("leaves the disks' capacity as totalBytes and every pass's bytes as bytesTransferred", () => {
    expect(warmFinalTransfer([3 * 2 ** 30, 2 ** 30], 1.5 * 2 ** 30 + 4096)).toEqual({ totalBytes: BigInt(4 * 2 ** 30), bytesTransferred: BigInt(1.5 * 2 ** 30 + 4096) })
  })

  it("never writes a negative or non-finite figure", () => {
    expect(warmFinalTransfer([], -5)).toEqual({ totalBytes: BigInt(0), bytesTransferred: BigInt(0) })
    expect(warmFinalTransfer([Number.NaN], Number.POSITIVE_INFINITY)).toEqual({ totalBytes: BigInt(0), bytesTransferred: BigInt(0) })
  })
})
