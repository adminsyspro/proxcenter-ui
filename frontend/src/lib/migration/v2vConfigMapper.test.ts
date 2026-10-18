import { describe, it, expect } from "vitest"

import { parseV2vXml, buildPveCreateParams } from "./v2vConfigMapper"

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

describe("buildPveCreateParams: review-step overrides (#317)", () => {
  const config = {
    name: "web-01", memory: 2048, cores: 2, sockets: 1, firmware: "bios" as const, ostype: "l26", machine: "q35", scsihw: "virtio-scsi-single",
    nics: [{ model: "virtio", mac: "00:50:56:aa:00:01" }, { model: "virtio", mac: "00:50:56:aa:00:02" }],
    disks: [],
  }

  it("keeps every NIC on the default bridge with the global tag when nothing is mapped", () => {
    const p = buildPveCreateParams(config, 100, "vmbr0", 7)
    expect(p.net0).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:00:01,tag=7")
    expect(p.net1).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:00:02,tag=7")
    expect([p.cores, p.sockets, p.memory]).toEqual([2, 1, 2048])
  })

  it("applies the hardware override and the per-NIC bridge, tag and model", () => {
    const p = buildPveCreateParams(config, 100, "vmbr0", undefined, "host", {
      hardware: { cores: 4, memoryMB: 8192 },
      nics: [{ index: 1, bridge: "vf95117a", vlanTag: 20, model: "e1000" }],
    })
    expect([p.cores, p.sockets, p.memory, p.cpu]).toEqual([4, 1, 8192, "host"])
    expect(p.net0).toBe("virtio,bridge=vmbr0,macaddr=00:50:56:aa:00:01")
    expect(p.net1).toBe("e1000,bridge=vf95117a,macaddr=00:50:56:aa:00:02,tag=20")
  })

  it("maps the default NIC of a source without adapters", () => {
    const p = buildPveCreateParams({ ...config, nics: [] }, 100, "vmbr0", undefined, undefined, { nics: [{ index: 0, bridge: "vmbr1" }] })
    expect(p.net0).toBe("virtio,bridge=vmbr1")
    expect(p.net1).toBeUndefined()
  })
})
