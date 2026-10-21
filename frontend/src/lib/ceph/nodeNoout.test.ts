import { describe, expect, it } from "vitest"

import {
  crushHostMatchesNode,
  findNodeOsds,
  groupFlagCommand,
  hostFlagsOf,
  isCephGroupFlag,
  okToStopCommand,
  parseOkToStop,
  parseOsdFlagsDetail,
  pickOnlineNode,
  summarizeCephHealth,
} from "./nodeNoout"

/*
   ui#1164: the per-host noout helpers, against the payloads measured on the
   lab (Ceph 20.2.2 / PVE 9.2): the nested OSD tree of GET /nodes/{node}/ceph/osd,
   the OSD_FLAGS health detail and the JSON of `ceph osd ok-to-stop`.
*/

// The OSD tree as PVE returns it: a root bucket holding host buckets.
const OSD_TREE = {
  flags: "sortbitwise,recovery_deletes,purged_snapdirs,pglog_hardlimit",
  root: {
    children: [
      {
        type: "root", name: "default", id: "-1",
        children: [
          { type: "host", name: "pve1", id: "-3", children: [{ type: "osd", id: "0", name: "osd.0", host: "pve1", status: "up", in: 1 }] },
          { type: "host", name: "pve2", id: "-5", children: [{ type: "osd", id: "1", name: "osd.1", host: "pve2", status: "up", in: 1 }] },
          {
            type: "host", name: "pve3", id: "-7",
            children: [
              { type: "osd", id: "2", name: "osd.2", host: "pve3", status: "up", in: 1 },
              { type: "osd", id: "5", name: "osd.5", host: "pve3", status: "down", in: 0 },
            ],
          },
        ],
      },
    ],
  },
}

const HEALTH_WITH_FLAGS = {
  status: "HEALTH_WARN",
  checks: {
    MON_DISK_LOW: { detail: [{ message: "mon.pve1 has 30% avail" }], severity: "HEALTH_WARN", summary: { count: 1, message: "mon pve1 is low on available space" } },
    OSD_FLAGS: {
      detail: [
        { message: "host pve3 has flags noout" },
        { message: "host pve1 has flags noout,noin" },
        { message: "osd.4 has flags noup" },
        { message: "device class 'ssd' has flags nodown" },
      ],
      severity: "HEALTH_WARN",
      summary: { count: 1, message: "1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set" },
    },
  },
}

describe("crushHostMatchesNode", () => {
  it("matches the bucket named like the node, case-insensitively, and an FQDN on its first label", () => {
    expect(crushHostMatchesNode("pve3", "pve3")).toBe(true)
    expect(crushHostMatchesNode("PVE3", "pve3")).toBe(true)
    expect(crushHostMatchesNode("pve3.lab.local", "pve3")).toBe(true)
    expect(crushHostMatchesNode("pve3", "pve3.lab.local")).toBe(true)
    expect(crushHostMatchesNode("pve30", "pve3")).toBe(false)
    expect(crushHostMatchesNode(undefined, "pve3")).toBe(false)
    expect(crushHostMatchesNode("", "pve3")).toBe(false)
  })
})

describe("findNodeOsds", () => {
  it("walks the nested tree down to the host bucket of the node and its OSDs", () => {
    expect(findNodeOsds(OSD_TREE, "pve3")).toEqual({
      crushHost: "pve3",
      osds: [
        { id: 2, status: "up", in: true },
        { id: 5, status: "down", in: false },
      ],
      globalFlags: ["sortbitwise", "recovery_deletes", "purged_snapdirs", "pglog_hardlimit"],
    })
  })

  it("reports no host when the node hosts no OSD, and the global noout when set", () => {
    const tree = { ...OSD_TREE, flags: "sortbitwise,noout" }
    expect(findNodeOsds(tree, "pve9")).toEqual({ crushHost: null, osds: [], globalFlags: ["sortbitwise", "noout"] })
  })

  it("tolerates an empty or odd payload (demo mode answers {data: []})", () => {
    expect(findNodeOsds([], "pve3")).toEqual({ crushHost: null, osds: [], globalFlags: [] })
    expect(findNodeOsds(null, "pve3")).toEqual({ crushHost: null, osds: [], globalFlags: [] })
    expect(findNodeOsds({ root: "nope" }, "pve3")).toEqual({ crushHost: null, osds: [], globalFlags: [] })
  })

  it("accepts a root given as a list and OSDs named without a type, each once", () => {
    const tree = {
      root: [
        {
          type: "host", name: "pve3",
          children: [
            { name: "osd.7", status: "up", in: "1" },
            { type: "osd", id: 7, name: "osd.7", status: "up", in: 1 },
            { type: "osd", id: "x", name: "bogus" },
          ],
        },
      ],
    }
    expect(findNodeOsds(tree, "pve3").osds).toEqual([{ id: 7, status: "up", in: true }])
  })
})

describe("parseOsdFlagsDetail and hostFlagsOf", () => {
  it("splits the health detail into host, OSD and device-class flags", () => {
    const detail = parseOsdFlagsDetail(HEALTH_WITH_FLAGS)
    expect(detail).toEqual({
      hosts: { pve3: ["noout"], pve1: ["noout", "noin"] },
      osds: { "osd.4": ["noup"] },
      deviceClasses: { ssd: ["nodown"] },
    })
    expect(hostFlagsOf(detail, "pve3")).toEqual(["noout"])
    expect(hostFlagsOf(detail, "PVE1.lab")).toEqual(["noout", "noin"])
    expect(hostFlagsOf(detail, "pve2")).toEqual([])
    expect(hostFlagsOf(detail, null)).toEqual([])
  })

  it("returns nothing for a healthy cluster, a missing check or a bare string detail", () => {
    expect(parseOsdFlagsDetail({ status: "HEALTH_OK", checks: {} })).toEqual({ hosts: {}, osds: {}, deviceClasses: {} })
    expect(parseOsdFlagsDetail(undefined)).toEqual({ hosts: {}, osds: {}, deviceClasses: {} })
    expect(parseOsdFlagsDetail({ checks: { OSD_FLAGS: { detail: ["host pve2 has flags noout"] } } }).hosts).toEqual({ pve2: ["noout"] })
    expect(parseOsdFlagsDetail({ checks: { OSD_FLAGS: { detail: "x" } } }).hosts).toEqual({})
  })
})

describe("parseOkToStop", () => {
  it("reads the safe and the unsafe verdict out of the stdout JSON", () => {
    expect(parseOkToStop('{"ok_to_stop":true,"osds":[2],"num_ok_pgs":6,"num_not_ok_pgs":0,"ok_become_degraded":[1]}'))
      .toEqual({ ok: true, osds: [2], numOkPgs: 6, numNotOkPgs: 0 })
    // The unsafe case: rc 16 and a stderr line, both out of the picture; the JSON says it all.
    expect(parseOkToStop('{"ok_to_stop":false,"osds":[0,1,2],"num_ok_pgs":0,"num_not_ok_pgs":33,"bad_become_inactive":["1.0"]}\n'))
      .toEqual({ ok: false, osds: [0, 1, 2], numOkPgs: 0, numNotOkPgs: 33 })
  })

  it("is null without a JSON object or without the verdict field", () => {
    expect(parseOkToStop("")).toBeNull()
    expect(parseOkToStop(undefined)).toBeNull()
    expect(parseOkToStop("Error EINVAL: unable to parse osd id")).toBeNull()
    expect(parseOkToStop("{not json")).toBeNull()
    expect(parseOkToStop('{"osds":[2]}')).toBeNull()
  })
})

describe("pickOnlineNode", () => {
  const status = [
    { type: "cluster", name: "lab", quorate: 1 },
    { type: "node", name: "pve1", online: 1 },
    { type: "node", name: "pve2", online: 0 },
    { type: "node", name: "pve3", online: 1 },
  ]

  it("keeps the target node while it is online, else the first online node", () => {
    expect(pickOnlineNode(status, "pve3")).toBe("pve3")
    expect(pickOnlineNode(status, "pve2")).toBe("pve1")
    expect(pickOnlineNode([], "pve2")).toBeNull()
    expect(pickOnlineNode(undefined, "pve2")).toBeNull()
  })
})

describe("summarizeCephHealth", () => {
  it("lists each check with its severity and summary message", () => {
    expect(summarizeCephHealth(HEALTH_WITH_FLAGS)).toEqual({
      status: "HEALTH_WARN",
      checks: [
        { code: "MON_DISK_LOW", severity: "HEALTH_WARN", message: "mon pve1 is low on available space" },
        { code: "OSD_FLAGS", severity: "HEALTH_WARN", message: "1 OSDs or CRUSH {nodes, device-classes} have {NOUP,NODOWN,NOIN,NOOUT} flags set" },
      ],
    })
    expect(summarizeCephHealth(null)).toEqual({ status: "UNKNOWN", checks: [] })
  })
})

describe("commands", () => {
  it("builds ok-to-stop with the exit code swallowed and only integer ids", () => {
    expect(okToStopCommand([2, 5, -1, 1.5])).toBe("ceph osd ok-to-stop 2 5 -f json 2>/dev/null; true")
  })

  it("builds set-group / unset-group for a host held to the hostname grammar", () => {
    expect(groupFlagCommand("noout", "pve3", true)).toBe("ceph osd set-group noout pve3")
    expect(groupFlagCommand("noout", "pve3", false)).toBe("ceph osd unset-group noout pve3")
    expect(() => groupFlagCommand("noout", "pve3; rm -rf /", true)).toThrow(/invalid node name/i)
  })

  it("knows the four group flags", () => {
    expect(isCephGroupFlag("noout")).toBe(true)
    expect(isCephGroupFlag("noscrub")).toBe(false)
    expect(isCephGroupFlag(undefined)).toBe(false)
  })
})
