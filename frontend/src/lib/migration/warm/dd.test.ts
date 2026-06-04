import { describe, it, expect } from "vitest"
import { buildDeltaApplyCmd } from "./dd"

describe("buildDeltaApplyCmd", () => {
  it("builds a byte-accurate dd command with matching offsets", () => {
    const cmd = buildDeltaApplyCmd("/dev/nbd0", "/dev/dm-3", { offset: 1048576, length: 65536 })
    expect(cmd).toContain("iflag=skip_bytes,count_bytes")
    expect(cmd).toContain("oflag=seek_bytes,direct")
    expect(cmd).toContain("conv=notrunc")
    expect(cmd).toContain("skip=1048576")
    expect(cmd).toContain("count=65536")
    expect(cmd).toContain("seek=1048576")
  })
})
