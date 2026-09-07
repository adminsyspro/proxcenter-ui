import { describe, it, expect } from "vitest"
import { NBD_RELEASE_HOLDERS_FN, nbdReleaseHoldersCall } from "./nbd-holders"

describe("NBD_RELEASE_HOLDERS_FN", () => {
  it("defines the recursive walker and holder release entry point", () => {
    expect(NBD_RELEASE_HOLDERS_FN).toContain("nbd_release_tree() {")
    expect(NBD_RELEASE_HOLDERS_FN).toContain("nbd_release_holders() {")
  })

  it("walks kernel holder links and releases children before acting on the node", () => {
    expect(NBD_RELEASE_HOLDERS_FN).toContain("for h in /sys/class/block/$1/holders/*; do")
    expect(NBD_RELEASE_HOLDERS_FN).toContain('nbd_release_tree "$(basename "$h")"')
    expect(NBD_RELEASE_HOLDERS_FN).toContain('case "$1" in')
    expect(NBD_RELEASE_HOLDERS_FN.indexOf('nbd_release_tree "$(basename "$h")"'))
      .toBeLessThan(NBD_RELEASE_HOLDERS_FN.indexOf('case "$1" in'))
  })

  it("removes device-mapper holders and stops md holders by device path", () => {
    expect(NBD_RELEASE_HOLDERS_FN).toContain('dm-*) dmsetup remove --retry "/dev/$1" >/dev/null 2>&1 ;;')
    expect(NBD_RELEASE_HOLDERS_FN).toContain('md*) mdadm --stop "/dev/$1" >/dev/null 2>&1 ;;')
  })

  it("starts from the whole device and each of its partitions", () => {
    expect(NBD_RELEASE_HOLDERS_FN).toContain('/sys/class/block/$d /sys/class/block/${d}p*')
  })

  it("never selects or changes LVM volumes by name", () => {
    for (const command of ["vgchange", "lvchange", "lvremove", "pvscan", "vgremove"]) {
      expect(NBD_RELEASE_HOLDERS_FN).not.toContain(command)
    }
  })

  it("uses POSIX sh syntax", () => {
    for (const syntax of ["local ", "[[", "function "]) {
      expect(NBD_RELEASE_HOLDERS_FN).not.toContain(syntax)
    }
  })
})

describe("nbdReleaseHoldersCall", () => {
  it("accepts a literal device path", () => {
    expect(nbdReleaseHoldersCall("/dev/nbd3")).toBe("nbd_release_holders /dev/nbd3")
  })

  it("preserves a quoted shell variable reference", () => {
    expect(nbdReleaseHoldersCall('"$NBD"')).toBe('nbd_release_holders "$NBD"')
  })
})
