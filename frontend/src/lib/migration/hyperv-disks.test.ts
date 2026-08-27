import { describe, expect, it, vi } from "vitest"

import { resolveHypervDiskPaths } from "./hyperv-disks"

function fakeExec(handler: (command: string) => string | undefined) {
  return vi.fn(async (command: string) => ({ success: true, output: handler(command) }))
}

describe("resolveHypervDiskPaths", () => {
  it("keeps an existing path verbatim without searching", async () => {
    const requested = "/mnt/hyperv/vm/disk.vhdx"
    const exec = fakeExec(command => command.startsWith("test -f ") ? "yes\n" : undefined)

    await expect(resolveHypervDiskPaths([requested], exec)).resolves.toEqual({ paths: [requested], notes: [] })
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls.some(([command]) => command.startsWith("find "))).toBe(false)
  })

  it("replaces a missing path when exactly one matching file is found", async () => {
    const requested = "/mnt/hyperv/old/disk.vhdx"
    const replacement = "/mnt/hyperv/new/disk.vhdx"
    const exec = fakeExec(command => {
      if (command.startsWith("test -f ")) return "no"
      if (command.includes("-iname 'disk.vhdx'")) return `${replacement}\n`
    })

    const result = await resolveHypervDiskPaths([requested], exec)
    expect(result.paths).toEqual([replacement])
    expect(result.notes).toHaveLength(1)
    expect(result.notes[0]).toContain(requested)
    expect(result.notes[0]).toContain(replacement)
  })

  it("rejects when several files have the requested basename", async () => {
    const exec = fakeExec(command => {
      if (command.startsWith("test -f ")) return "no"
      if (command.includes("-iname 'disk.vhdx'")) return "/mnt/hyperv/a/disk.vhdx\n/mnt/hyperv/b/disk.vhdx\n"
    })

    await expect(resolveHypervDiskPaths(["/mnt/hyperv/missing/disk.vhdx"], exec)).rejects.toThrow("Several files named")
  })

  it("lists visible inventory when the requested disk cannot be found", async () => {
    const exec = fakeExec(command => {
      if (command.startsWith("test -f ")) return "no"
      if (command.includes("-iname 'missing.vhdx'")) return ""
      if (command.includes("head -40")) return "/mnt/hyperv/a.vhdx\n/mnt/hyperv/b.vhd\n"
    })

    await expect(resolveHypervDiskPaths(["/mnt/hyperv/missing.vhdx"], exec)).rejects.toThrow(
      /Disk file not found[\s\S]*\/mnt\/hyperv\/a\.vhdx[\s\S]*\/mnt\/hyperv\/b\.vhd/,
    )
  })

  it("reports when no VHDX or VHD file is visible anywhere", async () => {
    const exec = fakeExec(command => command.startsWith("test -f ") ? "no" : "")
    await expect(resolveHypervDiskPaths(["/mnt/hyperv/missing.vhdx"], exec)).rejects.toThrow("No VHDX/VHD file is visible")
  })

  it("quotes the basename and searches the supplied mount root", async () => {
    const exec = fakeExec(command => command.startsWith("test -f ") ? "no" : "")
    await expect(resolveHypervDiskPaths(["/old/a disk.vhdx"], exec, "/mnt/x")).rejects.toThrow()

    const basenameFind = exec.mock.calls.map(([command]) => command).find(command => command.includes("-iname"))
    // Bare root, not quoted: the orchestrator allowlist matches `find /mnt/hyperv ` by prefix.
    expect(basenameFind).toContain("find /mnt/x ")
    expect(basenameFind).toContain("-iname 'a disk.vhdx'")
  })
})
