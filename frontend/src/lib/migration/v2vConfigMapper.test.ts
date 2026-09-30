import { describe, it, expect } from "vitest"

import { parseV2vXml } from "./v2vConfigMapper"

const xml = (name: string) => `<domain type="kvm"><name>${name}</name><memory unit="KiB">2097152</memory><vcpu>2</vcpu><os><type>hvm</type></os></domain>`

describe("parseV2vXml name sanitisation", () => {
  it.each([
    ["web01", "web01"],
    ["..--web 01_prod--..", "web-01-prod"],
    ["-.-.srv.lab.-", "srv.lab"],
    ["Windows Server (2019).vmdk", "Windows-Server-2019"],
    ["...---...", "vm"],
    ["a".repeat(80), "a".repeat(63)],
  ])("maps %j to %j", (raw, expected) => {
    expect(parseV2vXml(xml(raw)).name).toBe(expected)
  })

  it("parses the rest of the domain", () => {
    const cfg = parseV2vXml(xml("db01"))
    expect(cfg).toMatchObject({ name: "db01", memory: 2048, cores: 2, sockets: 1, firmware: "bios", machine: "q35" })
  })
})
