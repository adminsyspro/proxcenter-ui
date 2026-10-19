import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  buildNetworkPinScript, describeNetworkPinReport, guestNicsFromNets, macOfNetValue, NETWORK_PIN_REPORT,
  parseNetworkPinReport, type GuestNic,
} from "./guest-network"

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }) })

/**
 * Run the in-guest script against a fake root: every absolute guest path is
 * moved under a temporary directory, the way virt-customize's chroot would
 * see the guest. Returns the report and the .link files written.
 */
function runPin(nics: GuestNic[], files: Record<string, string>, opts: { systemd?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "netpin-"))
  roots.push(root)
  for (const [path, content] of Object.entries({ ...(opts.systemd === false ? {} : { "/usr/lib/systemd/.keep": "" }), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  mkdirSync(join(root, "tmp"), { recursive: true })
  const script = buildNetworkPinScript(nics).replaceAll(/(?<![\w/])\/(etc|usr|lib|boot|tmp)\//g, `${root}/$1/`)
  writeFileSync(join(root, "pin.sh"), script)
  execFileSync("sh", [join(root, "pin.sh")])
  const dir = join(root, "etc/systemd/network")
  const links = existsSync(dir)
    ? Object.fromEntries(readdirSync(dir).filter(f => f.endsWith(".link")).map(f => [f, readFileSync(join(dir, f), "utf8")]))
    : {}
  return { report: readFileSync(join(root, NETWORK_PIN_REPORT), "utf8"), links }
}

const nmKeyfile = (name: string) => `[connection]\nid=${name}\ntype=ethernet\ninterface-name=${name}\n\n[ipv4]\naddress1=10.42.0.235/24\nmethod=manual\n`

describe("buildNetworkPinScript: the lab cases (#1000 follow-up, 19/10)", () => {
  it("pins a NetworkManager profile bound to ens33 (Rocky 9)", () => {
    const r = runPin([{ mac: "00:50:56:9c:c0:8f", names: ["ens33"] }], { "/etc/NetworkManager/system-connections/ens33.nmconnection": nmKeyfile("ens33") })
    expect(r.report.trim()).toBe("pinned ens33 00:50:56:9c:c0:8f")
    expect(r.links["10-proxcenter-ens33.link"]).toContain("[Match]\nMACAddress=00:50:56:9c:c0:8f\n\n[Link]\nName=ens33\n")
  })

  it("pins an ifcfg file named after its device (CentOS 7)", () => {
    const r = runPin([{ mac: "00:50:56:9c:83:69", names: ["ens192"] }], {
      "/etc/sysconfig/network-scripts/ifcfg-ens192": "DEVICE=ens192\nBOOTPROTO=none\nIPADDR=10.42.0.236\n",
      "/etc/sysconfig/network-scripts/ifcfg-lo": "DEVICE=lo\n",
    })
    expect(r.report.trim()).toBe("pinned ens192 00:50:56:9c:83:69")
  })

  it("pins a netplan ethernet without mistaking the section name for an interface (Debian 13)", () => {
    const r = runPin([{ mac: "02:00:00:00:93:01", names: ["ens192"] }], {
      "/etc/netplan/01-static.yaml": "network:\n  version: 2\n  ethernets:\n    ens192:\n      addresses: [10.42.0.237/24]\n",
    })
    expect(r.report.trim()).toBe("pinned ens192 02:00:00:00:93:01")
  })
})

describe("buildNetworkPinScript: matching", () => {
  it("reads /etc/network/interfaces, keeps a VLAN on its parent, and pins every NIC it can attribute", () => {
    const r = runPin([
      { mac: "00:50:56:00:00:01", names: ["ens192"] },
      { mac: "00:50:56:00:00:02", names: ["ens224"] },
    ], {
      "/etc/network/interfaces": "auto lo ens192\niface lo inet loopback\niface ens192 inet static\n  address 10.0.0.2/24\nallow-hotplug ens224\niface ens224.10 inet dhcp\n",
    })
    expect(r.report.split("\n").filter(Boolean).sort()).toEqual(["pinned ens192 00:50:56:00:00:01", "pinned ens224 00:50:56:00:00:02"])
    expect(Object.keys(r.links).sort()).toEqual(["10-proxcenter-ens192.link", "10-proxcenter-ens224.link"])
  })

  it("pins the only interface of a single-NIC guest whatever its naming scheme", () => {
    const r = runPin([{ mac: "00:50:56:00:00:01", names: ["ens160"] }], { "/etc/sysconfig/network-scripts/ifcfg-eno16777736": "DEVICE=eno16777736\n" })
    expect(r.report.trim()).toBe("pinned eno16777736 00:50:56:00:00:01")
  })

  it("never guesses between several NICs, and says which names it left", () => {
    const r = runPin([{ mac: "00:50:56:00:00:01", names: [] }, { mac: "00:50:56:00:00:02", names: [] }], {
      "/etc/NetworkManager/system-connections/a.nmconnection": nmKeyfile("eno1"),
    })
    expect(r.report.trim()).toBe("unmatched eno1")
    expect(r.links).toEqual({})
  })

  it("leaves a NIC the guest already pinned by MAC", () => {
    const r = runPin([{ mac: "00:50:56:00:00:01", names: ["ens192"] }], {
      "/etc/NetworkManager/system-connections/a.nmconnection": nmKeyfile("ens192"),
      "/etc/systemd/network/50-lan.link": "[Match]\nMACAddress=00:50:56:00:00:01\n[Link]\nName=lan0\n",
    })
    expect(r.report.trim()).toBe("kept ens192")
    expect(Object.keys(r.links)).toEqual(["50-lan.link"])
  })

  it("skips kernel names when the guest turned predictable names off", () => {
    const r = runPin([{ mac: "00:50:56:00:00:01", names: ["eth0"] }], {
      "/etc/sysconfig/network-scripts/ifcfg-eth0": "DEVICE=eth0\n",
      "/etc/default/grub": 'GRUB_CMDLINE_LINUX="console=ttyS0 net.ifnames=0"\n',
    })
    expect(r.report).toBe("")
    expect(r.links).toEqual({})
  })

  it("pins the enX1 a recent systemd names the second VIF of an XCP-ng guest", () => {
    const r = runPin([{ mac: "aa:bb:cc:dd:ee:01", names: ["eth0", "enX0"] }, { mac: "aa:bb:cc:dd:ee:02", names: ["eth1", "enX1"] }], {
      "/etc/NetworkManager/system-connections/a.nmconnection": nmKeyfile("enX0"),
      "/etc/NetworkManager/system-connections/b.nmconnection": nmKeyfile("enX1"),
    })
    expect(r.report.split("\n").filter(Boolean).sort()).toEqual(["pinned enX0 aa:bb:cc:dd:ee:01", "pinned enX1 aa:bb:cc:dd:ee:02"])
  })

  it("pins a netfront eth0 of an XCP-ng guest with predictable names", () => {
    const r = runPin([{ mac: "aa:bb:cc:dd:ee:01", names: ["eth0"] }], { "/etc/sysconfig/network-scripts/ifcfg-eth0": "DEVICE=eth0\n" })
    expect(r.report.trim()).toBe("pinned eth0 aa:bb:cc:dd:ee:01")
  })

  it("reports a guest without systemd and writes nothing", () => {
    const r = runPin([{ mac: "00:50:56:00:00:01", names: ["ens192"] }], { "/etc/sysconfig/network-scripts/ifcfg-ens192": "DEVICE=ens192\n" }, { systemd: false })
    expect(r.report.trim()).toBe("nosystemd")
    expect(r.links).toEqual({})
  })

  it("keeps hostile names out of the script", () => {
    const script = buildNetworkPinScript([{ mac: "00:50:56:00:00:01", names: ["ens192", "x'; rm -rf /; '"] }, { mac: "not-a-mac", names: ["eth1"] }])
    expect(script).not.toContain("rm -rf")
    expect(script).toContain("NICS='00:50:56:00:00:01 ens192'")
    expect(script).toContain("SINGLE=''")
  })
})

describe("target NICs", () => {
  it("reads the MAC of both netN spellings", () => {
    expect(macOfNetValue("virtio,bridge=vmbr0,macaddr=00:50:56:9C:C0:8F,tag=10")).toBe("00:50:56:9c:c0:8f")
    expect(macOfNetValue("virtio=00:50:56:9c:c0:8f,bridge=vmbr0")).toBe("00:50:56:9c:c0:8f")
    expect(macOfNetValue("e1000,bridge=vmbr0")).toBeUndefined()
  })

  it("lists the NICs with a fixed MAC in netN order, with their source names", () => {
    const nics = guestNicsFromNets(
      { net1: "virtio,bridge=vmbr0,macaddr=00:50:56:00:00:02", net0: "virtio,bridge=vmbr0,macaddr=00:50:56:00:00:01", net2: "virtio,bridge=vmbr0" },
      i => [`ens${160 + 32 * i}`, "bad name!"],
    )
    expect(nics).toEqual([
      { mac: "00:50:56:00:00:02", names: ["ens192"] },
      { mac: "00:50:56:00:00:01", names: ["ens160"] },
    ])
  })
})

describe("the pin report", () => {
  it("parses every line kind", () => {
    expect(parseNetworkPinReport("pinned ens192 00:50:56:00:00:01\nkept ens224\nunmatched eno1\nnosystemd\ngarbage\n")).toEqual({
      pinned: [{ name: "ens192", mac: "00:50:56:00:00:01" }], kept: ["ens224"], unmatched: ["eno1"], noSystemd: true,
    })
  })

  it("says what was kept and what to check", () => {
    const lines = describeNetworkPinReport(parseNetworkPinReport("pinned ens192 00:50:56:00:00:01\nkept ens224\nunmatched eno1"))
    expect(lines.map(l => l.level)).toEqual(["success", "info", "warn"])
    expect(lines[0].msg).toBe("Guest network: ens192 (00:50:56:00:00:01) keeps the name it had on the source, so the guest network configuration still applies")
    expect(lines[2].msg).toContain("eno1")
    expect(describeNetworkPinReport(parseNetworkPinReport("pinned a 1\npinned b 2"))[0].msg).toContain("keep the name they had")
  })

  it("only warns for a guest without systemd, and stays silent when there was nothing to pin", () => {
    expect(describeNetworkPinReport(parseNetworkPinReport("nosystemd"))).toEqual([expect.objectContaining({ level: "warn" })])
    expect(describeNetworkPinReport(parseNetworkPinReport(""))).toEqual([])
  })
})
