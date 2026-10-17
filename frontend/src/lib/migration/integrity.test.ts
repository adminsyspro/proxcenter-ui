import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/ssh/exec", () => ({
  executeSSH: vi.fn(),
  shellEscape: (s: string) => "'" + s.replaceAll("'", "'\\''") + "'",
}))

import {
  buildRegionHashScript,
  parseRegionHashes,
  compareRegionHashes,
  buildQemuImgCheckCmd,
  parseQemuImgCheck,
  parseQemuImgInfo,
  faultInjectionFromEnv,
  buildFaultInjectCmd,
  verifyDiskIntegrity,
  IntegrityError,
  planSampleRegions,
  MIB,
  type SampleRegion,
  type RegionSource,
  verifyConvertedImage,
} from "./integrity"

const GIB = 1024 * MIB
const settings = { enabled: true, regionCount: 2, regionSizeMiB: 4 }
const regions = planSampleRegions(3 * GIB, settings) // offsets 0, 1024, 2048, 3068 MiB
const sha = (c: string) => c.repeat(64)
const hashes = (chars: string[]) => chars.map((c, i) => `R${i} ${sha(c)}`).join("\n")

describe("hash scripts", () => {
  it("reads every region of a raw device by byte offset into a temp file and prints R<i> <sha256>", () => {
    const s = buildRegionHashScript({ kind: "raw", path: "/dev/rbd4" }, regions)
    expect(s).toContain(`dd if='/dev/rbd4' of="$T" bs=1M iflag=skip_bytes,count_bytes skip=${1024 * MIB} count=${4 * MIB}`)
    expect(s).toContain(`echo "R3 $(sha256sum < "$T" | cut -d' ' -f1)"`)
    expect(s).toContain(`[ "$(stat -c %s "$T" 2>/dev/null)" = "${4 * MIB}" ]`)
    expect(s.match(/^if dd /gm)).toHaveLength(4)
  })

  it("uses HTTPS range requests with the SOAP cookie and requires a 206", () => {
    const s = buildRegionHashScript({ kind: "https", url: "https://esx/folder/vm/vm-flat.vmdk?dcPath=ha-datacenter&dsName=ds", cookie: 'vmware_soap_session="abc"' }, regions.slice(0, 2))
    expect(s).toContain(`curl -sk -b 'vmware_soap_session=abc' -r 0-${4 * MIB - 1}`)
    expect(s).toContain(`-r ${1024 * MIB}-${1028 * MIB - 1}`)
    expect(s).toContain(`[ "$code" = 206 ]`)
    expect(s).toContain("'https://esx/folder/vm/vm-flat.vmdk?dcPath=ha-datacenter&dsName=ds'")
  })

  it("attaches an image read-only to the first free NBD device, reads it and detaches", () => {
    const s = buildRegionHashScript({ kind: "image", path: "/mnt/pve/data/images/120/vm-120-disk-1.qcow2", format: "qcow2" }, regions.slice(0, 1))
    expect(s).toContain("[ -s /sys/block/nbd$i/pid ] && continue")
    expect(s).toContain(`qemu-nbd -r -f qcow2 -c /dev/nbd$i '/mnt/pve/data/images/120/vm-120-disk-1.qcow2'`)
    expect(s).toContain(`dd if="$NBD" of="$T"`)
    expect(s).toContain(`nbd_release_holders "$NBD"`)
    expect(s).toContain(`qemu-nbd -d "$NBD"`)
    expect(s).toContain('echo "R0 ERR qemu-nbd attach failed: $err"')
  })

  it("is a no-op for an empty plan", () => {
    expect(buildRegionHashScript({ kind: "raw", path: "/dev/x" }, [])).toBe("true")
  })
})

describe("parsing and comparison", () => {
  it("parses hashes and errors, ignoring noise", () => {
    const m = parseRegionHashes(`noise\nR0 ${sha("a")}\nR1 ERR dd: short read (got 0 bytes of 4194304)\nR2 garbage\n`)
    expect(m.get(0)).toEqual({ hash: sha("a") })
    expect(m.get(1)).toEqual({ error: "dd: short read (got 0 bytes of 4194304)" })
    expect(m.get(2)?.error).toMatch(/unexpected output/)
    expect(m.has(3)).toBe(false)
  })

  it("reports matched, mismatched and unreadable regions", () => {
    const src = parseRegionHashes(hashes(["a", "b", "c", "d"]))
    const dst = parseRegionHashes(`R0 ${sha("a")}\nR1 ${sha("e")}\nR2 ERR boom`)
    const v = compareRegionHashes(regions, src, dst)
    expect(v.matched.map(r => r.index)).toEqual([0])
    expect(v.mismatched.map(m => m.region.index)).toEqual([1])
    expect(v.unreadable).toEqual([
      { region: regions[2], side: "target", reason: "boom" },
      { region: regions[3], side: "target", reason: "no hash printed" },
    ])
  })
})

describe("qemu-img helpers", () => {
  it("builds the check command with its exit code and parses the JSON report", () => {
    expect(buildQemuImgCheckCmd("/a/b.qcow2")).toBe(`qemu-img check -f qcow2 --output=json '/a/b.qcow2' 2>&1; echo "QEMU_IMG_CHECK_RC=$?"`)
    const ok = parseQemuImgCheck(`{\n "check-errors": 0,\n "leaks": 0,\n "corruptions": 0,\n "format": "qcow2"\n}\nQEMU_IMG_CHECK_RC=0`)
    expect(ok).toMatchObject({ rc: 0, corruptions: 0, leaks: 0, checkErrors: 0 })
    const bad = parseQemuImgCheck(`{"corruptions": 3, "leaks": 1, "check-errors": 0}\nQEMU_IMG_CHECK_RC=2`)
    expect(bad).toMatchObject({ rc: 2, corruptions: 3, leaks: 1 })
    const broken = parseQemuImgCheck(`qemu-img: Could not open '/x': No such file or directory\nQEMU_IMG_CHECK_RC=1`)
    expect(broken.rc).toBe(1)
    expect(broken.message).toContain("Could not open")
  })

  it("parses qemu-img info", () => {
    expect(parseQemuImgInfo(`{"virtual-size": 3221225472, "format": "qcow2", "filename": "x"}`)).toEqual({ format: "qcow2", virtualSize: 3221225472 })
    expect(parseQemuImgInfo("nope")).toBeNull()
  })
})

describe("fault injection hook", () => {
  it("is parsed from the env outside production only", () => {
    expect(faultInjectionFromEnv({ PROXCENTER_MIGRATION_FAULT: "integrity" } as any)).toEqual({ diskIndex: 0, regionIndex: 1 })
    expect(faultInjectionFromEnv({ PROXCENTER_MIGRATION_FAULT: "integrity:1:3" } as any)).toEqual({ diskIndex: 1, regionIndex: 3 })
    expect(faultInjectionFromEnv({ PROXCENTER_MIGRATION_FAULT: "integrity", NODE_ENV: "production" } as any)).toBeNull()
    expect(faultInjectionFromEnv({ PROXCENTER_MIGRATION_FAULT: "other" } as any)).toBeNull()
    expect(faultInjectionFromEnv({} as any)).toBeNull()
  })

  it("scribbles over a raw or qcow2 target, never over an HTTPS source", () => {
    const r = regions[1]
    expect(buildFaultInjectCmd({ kind: "raw", path: "/dev/rbd4" }, r)).toBe(`head -c ${4 * MIB} /dev/urandom | dd of='/dev/rbd4' bs=1M oflag=seek_bytes seek=${1024 * MIB} conv=notrunc status=none`)
    expect(buildFaultInjectCmd({ kind: "image", path: "/x.qcow2", format: "qcow2" }, r)).toBe(`qemu-io -f qcow2 -c 'write -P 0x5a ${1024 * MIB} ${4 * MIB}' '/x.qcow2' >/dev/null`)
    expect(buildFaultInjectCmd({ kind: "image", path: "/x.vmdk", format: "vmdk" }, r)).toBeNull()
    expect(buildFaultInjectCmd({ kind: "https", url: "u", cookie: "c" }, r)).toBeNull()
  })
})

describe("verifyDiskIntegrity", () => {
  const src: RegionSource = { kind: "raw", path: "/dev/nbd0" }
  const dst: RegionSource = { kind: "raw", path: "/dev/rbd4" }
  type Exec = (connectionId: string, nodeIp: string, cmd: string, timeoutMs?: number) => Promise<{ success: boolean; output?: string; error?: string }>

  function run(exec: Exec, extra: Partial<Parameters<typeof verifyDiskIntegrity>[0]> = {}) {
    const log = vi.fn(async () => {})
    const p = verifyDiskIntegrity({
      connectionId: "c", nodeIp: "10.0.0.1", diskIndex: 0, diskLabel: "Disk 1", capacityBytes: 3 * GIB,
      source: src, target: dst, settings, log, exec: exec as any, ...extra,
    })
    return { p, log }
  }

  it("passes when every region matches and logs the plan and the verdict", async () => {
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => ({ success: true, output: cmd.includes("/dev/nbd0") || cmd.includes("/dev/rbd4") ? hashes(["a", "b", "c", "d"]) : "" }))
    const { p, log } = run(exec)
    const result = await p
    expect(result).toMatchObject({ checked: true, regions: 4, matched: 4, qemuImgCheck: "not-run" })
    const msgs = log.mock.calls.map(c => c[0] as string)
    expect(msgs[0]).toContain("hashing 4 regions of 4 MiB: first, last and 2 spread (offsets 1024 MiB, 2048 MiB) on the source and on the target")
    expect(msgs[1]).toMatch(/Integrity check passed, Disk 1: 4\/4 sampled regions match \(16 MiB hashed/)
    expect(log.mock.calls[1][1]).toBe("success")
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it("fails the job on a mismatch, naming the offset, and never hands over", async () => {
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => ({ success: true, output: cmd.includes("/dev/rbd4") ? hashes(["a", "b", "e", "d"]) : hashes(["a", "b", "c", "d"]) }))
    const { p, log } = run(exec)
    await expect(p).rejects.toThrow(IntegrityError)
    await expect(p).rejects.toThrow(/1 of 4 sampled regions differ.*offset 2048 MiB.*VM was not handed over/)
    expect(log.mock.calls.some(c => c[1] === "error" && String(c[0]).includes("FAILED"))).toBe(true)
  })

  it("fails when a side cannot be read", async () => {
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => cmd.includes("/dev/nbd0")
      ? { success: true, output: hashes(["a", "b", "c", "d"]) }
      : { success: true, output: `R0 ${sha("a")}\nR1 ERR dd: error reading (got 0 bytes of 4194304)` })
    const { p } = run(exec)
    await expect(p).rejects.toThrow(/could not read the target region at offset 1024 MiB: dd: error reading/)
  })

  it("corrupts the requested target region first when the fault hook targets this disk", async () => {
    const cmds: string[] = []
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => { cmds.push(cmd); return { success: true, output: hashes(["a", "b", "c", "d"]) } })
    const { p, log } = run(exec, { fault: { diskIndex: 0, regionIndex: 2 } })
    await p
    expect(cmds[0]).toContain(`seek=${2048 * MIB} conv=notrunc`)
    expect(log.mock.calls[0][0]).toContain("TEST HOOK")
    const { p: other } = run(vi.fn(async () => ({ success: true, output: hashes(["a", "b", "c", "d"]) })), { fault: { diskIndex: 1, regionIndex: 2 } })
    await other
  })

  it("skips with a warning when the check is disabled", async () => {
    const exec = vi.fn()
    const { p, log } = run(exec, { settings: { ...settings, enabled: false } })
    expect(await p).toMatchObject({ checked: false })
    expect(exec).not.toHaveBeenCalled()
    expect(log.mock.calls[0][1]).toBe("warn")
    expect(log.mock.calls[0][0]).toContain("disabled on the target cluster")
  })

  it("without a comparable source, checks the qcow2 structure and the virtual size", async () => {
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => {
      if (cmd.startsWith("qemu-img check")) return { success: true, output: `{"corruptions": 0, "leaks": 2, "check-errors": 0}\nQEMU_IMG_CHECK_RC=3` }
      if (cmd.startsWith("qemu-img info")) return { success: true, output: `{"virtual-size": ${3 * GIB}, "format": "qcow2"}` }
      throw new Error(`unexpected ${cmd}`)
    })
    const { p, log } = run(exec, { source: null, checkImage: { path: "/out/disk-0", format: "qcow2" }, expectedVirtualSize: 3 * GIB })
    const result = await p
    expect(result).toMatchObject({ checked: true, regions: 0, qemuImgCheck: "leaks" })
    const msgs = log.mock.calls.map(c => c[0] as string)
    expect(msgs[0]).toContain("rewritten by virt-v2v")
    expect(msgs[1]).toContain("2 leaked cluster(s)")
    expect(msgs[2]).toContain("virtual size 3072 MiB matches the source disk")
  })

  it("fails on a corrupt qcow2 or a wrong virtual size", async () => {
    const corrupt = vi.fn(async () => ({ success: true, output: `{"corruptions": 1, "leaks": 0}\nQEMU_IMG_CHECK_RC=2` }))
    await expect(run(corrupt, { source: null, checkImage: { path: "/out/d", format: "qcow2" } }).p).rejects.toThrow(/1 corruption\(s\)/)
    const wrongSize = vi.fn(async (_c: string, _n: string, cmd: string) => cmd.startsWith("qemu-img check")
      ? { success: true, output: `{"corruptions": 0, "leaks": 0}\nQEMU_IMG_CHECK_RC=0` }
      : { success: true, output: `{"virtual-size": ${2 * GIB}, "format": "qcow2"}` })
    await expect(run(wrongSize, { source: null, checkImage: { path: "/out/d", format: "qcow2" }, expectedVirtualSize: 3 * GIB }).p).rejects.toThrow(/2048 MiB but the source disk is 3072 MiB/)
    const unreadable = vi.fn(async () => ({ success: false, output: `qemu-img: Could not open '/out/d'\nQEMU_IMG_CHECK_RC=1` }))
    await expect(run(unreadable, { source: null, checkImage: { path: "/out/d", format: "qcow2" } }).p).rejects.toThrow(/could not verify Disk 1/)
  })

  it("runs the region check and the qcow2 check together on a qcow2 target", async () => {
    const exec = vi.fn(async (_c: string, _n: string, cmd: string) => {
      if (cmd.startsWith("qemu-img check")) return { success: true, output: `{"corruptions": 0, "leaks": 0}\nQEMU_IMG_CHECK_RC=0` }
      return { success: true, output: hashes(["a", "b", "c", "d"]) }
    })
    const target: RegionSource = { kind: "image", path: "/s/images/120/vm-120-disk-1.qcow2", format: "qcow2" }
    const { p } = run(exec, { target, checkImage: { path: target.path, format: "qcow2" } })
    expect(await p).toMatchObject({ checked: true, matched: 4, qemuImgCheck: "ok" })
    expect(exec.mock.calls.some(c => String(c[2]).includes("qemu-nbd -r -f qcow2"))).toBe(true)
  })
})

describe("SampleRegion type is what the scripts index by", () => {
  it("indexes follow the plan order", () => {
    const r: SampleRegion[] = planSampleRegions(GIB, { regionCount: 3, regionSizeMiB: 1 })
    expect(r.map(x => x.index)).toEqual([0, 1, 2, 3, 4])
  })
})

describe("verifyConvertedImage (virt-v2v block path)", () => {
  const info = (format: string, size: number) => JSON.stringify({ format, "virtual-size": size })
  const exec = (fmt: string, size: number, targetHashes = ["a", "b", "c", "d"]) => vi.fn(async (_c: string, _n: string, cmd: string) => {
    if (cmd.startsWith("qemu-img info")) return { success: true, output: info(fmt, size) }
    return { success: true, output: cmd.includes("/dev/rbd4") ? hashes(targetHashes) : hashes(["a", "b", "c", "d"]) }
  })
  const run = (e: any, sourceCapacityBytes?: number) => {
    const log = vi.fn(async () => {})
    return { p: verifyConvertedImage({ connectionId: "c", nodeIp: "10.0.0.1", diskIndex: 0, imagePath: "/var/tmp/v2v/disk-sda", devicePath: "/dev/rbd4", fallbackSizeBytes: GIB, sourceCapacityBytes, settings, log, exec: e }), log }
  }

  it("samples the converted raw image against the device and checks the size against the source", async () => {
    const { p, log } = run(exec("raw", 3 * GIB), 3 * GIB)
    await p
    expect(log.mock.calls.map(c => c[0] as string).at(-1)).toContain("converted image size 3.00 GB matches the source disk")
  })

  it("refuses a converted image whose size is not the source's", async () => {
    await expect(run(exec("raw", 2 * GIB), 3 * GIB).p).rejects.toThrow("the converted image is 2147483648 bytes but the source disk is 3221225472 bytes")
  })

  it("fails on a sampled difference, before any size check", async () => {
    await expect(run(exec("raw", 3 * GIB, ["a", "x", "c", "d"]), 3 * GIB).p).rejects.toThrow(IntegrityError)
  })
})
