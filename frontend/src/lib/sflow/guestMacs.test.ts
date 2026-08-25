import { describe, expect, it } from "vitest"

import { GUEST_MACS_COMMAND, parseGuestMACs } from "./guestMacs"

// Real output, taken from a three node lab, asked of a node hosting no guest.
// That is the case that broke: the answer covers the whole cluster only because
// the command reads /etc/pve/nodes/*, not the per-node symlink.
const REAL_OUTPUT = [
  "/etc/pve/nodes/pve3/qemu-server/100.conf:net0: virtio=BC:24:11:07:B8:AC,bridge=v42fc503",
  "/etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=CLIENT",
  "/etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=v42fc503",
].join("\n")

describe("GUEST_MACS_COMMAND", () => {
  // `/etc/pve/qemu-server` is a per-node symlink, so it only ever lists the
  // guests of the node answering. Asking a node that hosts none returned
  // nothing and no flow was ever attributed. Guard the cluster-wide path.
  it("reads the cluster-wide path, not the per-node symlink", () => {
    expect(GUEST_MACS_COMMAND).toContain("/etc/pve/nodes/*/qemu-server/*.conf")
    expect(GUEST_MACS_COMMAND).toContain("/etc/pve/nodes/*/lxc/*.conf")
    expect(GUEST_MACS_COMMAND).not.toMatch(/\/etc\/pve\/qemu-server/)
    expect(GUEST_MACS_COMMAND).not.toMatch(/\/etc\/pve\/lxc/)
  })

  // The orchestrator authorises SSH commands on an exact prefix
  // (internal/api/ssh_allowlist.go, entry `grep -H "^net" /etc/pve/`). Changing
  // the start of this command silently breaks the feature with a 403.
  it("keeps the prefix the SSH allowlist matches on", () => {
    expect(GUEST_MACS_COMMAND.startsWith('grep -H "^net" /etc/pve/')).toBe(true)
  })

  it("cannot fail the whole probe when no config file matches", () => {
    expect(GUEST_MACS_COMMAND).toContain("|| true")
  })
})

describe("parseGuestMACs", () => {
  it("maps each guest MAC to its guest id", () => {
    expect(parseGuestMACs(REAL_OUTPUT)).toEqual({
      "bc:24:11:07:b8:ac": 100,
      "bc:24:11:b6:00:5d": 101,
    })
  })

  // A guest with a pending change yields the live line and the pending one.
  it("is unaffected by a duplicated line from a pending change", () => {
    const withPending = [
      "/etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=CLIENT",
      "/etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=v42fc503",
    ].join("\n")

    expect(parseGuestMACs(withPending)).toEqual({ "bc:24:11:b6:00:5d": 101 })
  })

  it("reads a container NIC, where the address is under hwaddr", () => {
    const lxc = "/etc/pve/nodes/pve1/lxc/109.conf:net0: name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF,ip=dhcp"

    expect(parseGuestMACs(lxc)).toEqual({ "aa:bb:cc:dd:ee:ff": 109 })
  })

  it("keeps every NIC of a multi-homed guest", () => {
    const twoNics = [
      "/etc/pve/nodes/pve1/qemu-server/200.conf:net0: virtio=AA:00:00:00:00:01,bridge=vmbr0",
      "/etc/pve/nodes/pve1/qemu-server/200.conf:net1: virtio=AA:00:00:00:00:02,bridge=vmbr1",
    ].join("\n")

    expect(parseGuestMACs(twoNics)).toEqual({
      "aa:00:00:00:00:01": 200,
      "aa:00:00:00:00:02": 200,
    })
  })

  // The decoder produces lower case from net.HardwareAddr while Proxmox stores
  // upper case, so the table has to be normalised on the way in.
  it("normalises to lower case", () => {
    const macs = parseGuestMACs(REAL_OUTPUT)
    for (const key of Object.keys(macs)) {
      expect(key).toBe(key.toLowerCase())
    }
  })

  it("ignores lines carrying no address or no guest id", () => {
    const noise = [
      "",
      "grep: /etc/pve/nodes/*/lxc/*.conf: No such file or directory",
      "/etc/pve/nodes/pve1/qemu-server/300.conf:net0: virtio,bridge=vmbr0",
      "/etc/pve/nodes/pve1/qemu-server/notanumber.conf:net0: virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0",
    ].join("\n")

    expect(parseGuestMACs(noise)).toEqual({})
  })

  it("returns an empty map for empty output", () => {
    expect(parseGuestMACs("")).toEqual({})
  })
})
