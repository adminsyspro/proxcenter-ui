import { describe, expect, it } from "vitest"

import { isValidSourceVmId } from "./source-vm-id"

describe("isValidSourceVmId", () => {
  it("accepts the ids the sources use", () => {
    for (const id of ["vm-20132", "42", "050d9de3-ac75-6529-a429-82b276a19d6f", "C1A6E1A2-2F0B-4D3C-9E1B-0A1B2C3D4E5F", "vm-1:esxi"]) expect(isValidSourceVmId(id)).toBe(true)
  })
  it("refuses markup, quotes, spaces and empty values", () => {
    for (const id of ["vm-1</urn:obj><x>", "a\"b", "a b", "", "-lead", "x".repeat(200), 12, null]) expect(isValidSourceVmId(id)).toBe(false)
  })
})
