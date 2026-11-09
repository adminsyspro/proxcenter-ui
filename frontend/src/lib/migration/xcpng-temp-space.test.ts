import { describe, it, expect } from "vitest"
import { tempDirFilledUp, tempDirFullError, tempSpaceWarning, xcpngTempSpaceFits } from "./xcpng-temp-space"

const GB = 1073741824

describe("offline temp space (roadmap#60)", () => {
  it("fits when the largest disk, fully allocated, fits", () => {
    expect(xcpngTempSpaceFits(65 * GB, [{ sizeBytes: 64 * GB }, { sizeBytes: 10 * GB }])).toBe(true)
    expect(xcpngTempSpaceFits(9.9 * GB, [{ sizeBytes: 64 * GB }])).toBe(false)
    expect(xcpngTempSpaceFits(0, [])).toBe(true)
  })

  it("tells a download that filled the directory from one that broke for another reason", () => {
    expect(tempDirFilledUp(9.9 * GB, 9.88 * GB)).toBe(true)
    expect(tempDirFilledUp(9.9 * GB, 2 * GB)).toBe(false)
    expect(tempDirFilledUp(null, 50 * GB)).toBe(false)
  })

  it("words the warning and the error with the directory and the way out", () => {
    expect(tempSpaceWarning("/var/lib/vz/tmp", 9.9 * GB, [{ sizeBytes: 64 * GB }])).toMatch(/\/var\/lib\/vz\/tmp has 9\.9 GB free.*64\.0 GB.*Temporary Storage/)
    expect(tempDirFullError("/var/lib/vz/tmp", 9.9 * GB, 9.88 * GB)).toMatch(/\/var\/lib\/vz\/tmp filled up: 9\.9 GB were free.*9\.9 GB had been written.*Temporary Storage/)
  })
})
