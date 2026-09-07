/**
 * Release everything the host stacked on top of an NBD device we own, so the
 * device can actually be detached (#535).
 *
 * When a guest disk is attached to /dev/nbdN, udev fires `pvscan --cache -aay`
 * and the host's LVM auto-activates the GUEST volume group it finds on the
 * device (whole-disk PV) or on one of its partitions (nbdNpM, when the nbd
 * module was loaded with max_part>0). The activated device-mapper LVs hold the
 * NBD device open: `nbd-client -d` / `qemu-nbd --disconnect` then return 0
 * without freeing it, /sys/block/nbdN/pid keeps a dead pid, and `rmmod nbd`
 * refuses, until the node is rebooted.
 *
 * Scoping is by CONSTRUCTION, never by name: we walk the kernel's own holder
 * links (/sys/class/block/<dev>/holders/*) starting from the device we own and
 * its partitions, release the leaves first (a thin LV before its pool, a pool
 * before its tdata/tmeta), and only ever touch a device-mapper (`dm-*`) or md
 * (`md*`) node reached that way. No `vgchange -an <name>` and no regex on VG
 * names: a guest VG may be called `pve` exactly like the host's, and a
 * mis-scoped deactivation would take the node down.
 *
 * POSIX sh only (the SSH layer may wrap commands in `sudo sh -c`, i.e. dash):
 * no `local`, no arrays, no `[[`. A for-list is expanded once before the loop
 * runs, so the recursive call reassigning `h` does not disturb the outer
 * iteration. Every step is best-effort (errors silenced) so a teardown never
 * aborts on an already-gone holder.
 */
export const NBD_RELEASE_HOLDERS_FN = [
  "nbd_release_tree() {",
  "  for h in /sys/class/block/$1/holders/*; do",
  '    [ -e "$h" ] || continue',
  '    nbd_release_tree "$(basename "$h")"',
  "  done",
  '  case "$1" in',
  '    dm-*) dmsetup remove --retry "/dev/$1" >/dev/null 2>&1 ;;',
  '    md*) mdadm --stop "/dev/$1" >/dev/null 2>&1 ;;',
  "  esac",
  "}",
  "nbd_release_holders() {",
  '  d=$(basename "$1")',
  '  for p in /sys/class/block/$d /sys/class/block/${d}p*; do',
  '    [ -e "$p" ] || continue',
  '    nbd_release_tree "$(basename "$p")"',
  "  done",
  "}",
].join("\n")

/**
 * The call line. `dev` is a literal device path (`/dev/nbd3`) or a shell
 * variable reference (`"$NBD"`); NBD_RELEASE_HOLDERS_FN must be defined earlier
 * in the same script.
 */
export function nbdReleaseHoldersCall(dev: string): string {
  return `nbd_release_holders ${dev}`
}
