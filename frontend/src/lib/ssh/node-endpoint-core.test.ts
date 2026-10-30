import { describe, expect, it } from "vitest"

import { isSshAddress } from "./node-endpoint-core"

describe("isSshAddress: a bare host, nothing else (roadmap#99)", () => {
  it.each(["10.42.0.250", "192.168.1.1", "pve1", "pve1.lab.example", "bastion-01.example.net.", "2001:db8::1", "fe80::1", "::ffff:10.0.0.1", "  10.0.0.1  "])(
    "accepts %j",
    (value) => expect(isSshAddress(value)).toBe(true),
  )

  it.each([
    "", "   ", "10.42.0.250 evil", "ssh://10.42.0.250", "10.42.0.250/24", "root@10.42.0.250", "10.42.0.250:2222",
    "$(id)", "a..b", "-pve1", "pve1-", "256.1.1.1", "2001:db8:::1", "1:2:3:4:5:6:7:8:9", "host name", "pve1;reboot",
  ])("refuses %j", (value) => expect(isSshAddress(value)).toBe(false))

  it("refuses non-strings", () => {
    expect(isSshAddress(null)).toBe(false)
    expect(isSshAddress(42)).toBe(false)
  })
})
