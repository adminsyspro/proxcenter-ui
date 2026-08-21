import { describe, it, expect } from "vitest"

import { parseMemoryProperty, mergeMemoryProperty } from "./memoryProperty"

describe("parseMemoryProperty", () => {
  it("reads the plain integer PVE normally stores", () => {
    expect(parseMemoryProperty(8192)).toEqual({ current: 8192, extras: [] })
    expect(parseMemoryProperty("8192")).toEqual({ current: 8192, extras: [] })
  })

  it("reads the named form of the default key", () => {
    expect(parseMemoryProperty("current=8192")).toEqual({ current: 8192, extras: [] })
  })

  it("keeps every other segment verbatim, bare default key or not", () => {
    // The whole point: a value we cannot interpret must survive a round trip
    // instead of being dropped by a write that only edits the online amount.
    expect(parseMemoryProperty("8192,max=32768")).toEqual({ current: 8192, extras: ["max=32768"] })
    expect(parseMemoryProperty("current=8192,max=32768")).toEqual({ current: 8192, extras: ["max=32768"] })
  })

  it("tolerates spacing and empty segments", () => {
    expect(parseMemoryProperty(" current=512 , max=1024 ,")).toEqual({ current: 512, extras: ["max=1024"] })
  })

  it("reports an unreadable value as null rather than NaN", () => {
    // A NaN would reach a numeric field and break the RAM slider.
    expect(parseMemoryProperty("current=abc").current).toBeNull()
    expect(parseMemoryProperty(undefined).current).toBeNull()
    expect(parseMemoryProperty(null).current).toBeNull()
    expect(parseMemoryProperty({}).current).toBeNull()
    expect(parseMemoryProperty(Number.NaN).current).toBeNull()
  })
})

describe("mergeMemoryProperty", () => {
  it("returns null when the previous value carried nothing to preserve", () => {
    // Nothing to merge: the caller keeps sending the plain integer it built.
    expect(mergeMemoryProperty(8192, 4096)).toBeNull()
    expect(mergeMemoryProperty("current=8192", "4096")).toBeNull()
    expect(mergeMemoryProperty(undefined, 4096)).toBeNull()
  })

  it("re-emits the segments the caller does not edit", () => {
    expect(mergeMemoryProperty("8192,max=32768", 4096)).toBe("current=4096,max=32768")
    expect(mergeMemoryProperty("current=8192,max=32768", "4096")).toBe("current=4096,max=32768")
  })

  it("leaves a caller that spelled out its own property string alone", () => {
    expect(mergeMemoryProperty("8192,max=32768", "current=4096,max=16384")).toBeNull()
  })

  it("leaves an unreadable new value alone", () => {
    expect(mergeMemoryProperty("8192,max=32768", "")).toBeNull()
    expect(mergeMemoryProperty("8192,max=32768", undefined)).toBeNull()
  })
})
