import { NBD_RELEASE_HOLDERS_FN, nbdReleaseHoldersCall } from "./nbd-holders"

/**
 * Shell script run on the target node after a cold migration of an OVMF guest
 * on file-based storage: attach the copied boot disk with qemu-nbd, mount the
 * EFI System Partition and make sure the fallback loader \EFI\Boot\bootx64.efi
 * exists (Windows only stores bootmgfw.efi under \EFI\Microsoft\Boot\).
 * `partprobe` publishes the guest partitions, so the host's LVM can
 * auto-activate a Linux guest's volume group on them (#535): every
 * `qemu-nbd --disconnect` is preceded by the holder release, otherwise the
 * device stays pinned until reboot. Echoes `INJECT_RESULT=<code>` for the
 * caller; never fails the migration.
 */
export function buildUefiInjectScript(bootDiskPath: string): string {
  return [
    'set +e',
    NBD_RELEASE_HOLDERS_FN,
    'modprobe nbd max_part=16 2>/dev/null',
    // Find a free nbd device (no pid file means unused)
    'NBD=""',
    'for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do',
    '  if [ ! -s /sys/block/nbd$i/pid ] 2>/dev/null; then NBD=/dev/nbd$i; break; fi',
    'done',
    '[ -z "$NBD" ] && { echo "INJECT_RESULT=NO_FREE_NBD"; exit 0; }',
    `qemu-nbd --connect="$NBD" --format=raw "${bootDiskPath}" 2>/dev/null || { echo "INJECT_RESULT=NBD_FAIL"; exit 0; }`,
    'sleep 1',
    'partprobe "$NBD" 2>/dev/null',
    'sleep 1',
    // Find EFI System Partition by GUID
    `EFI_PART=$(lsblk -nr -o NAME,PARTTYPE "$NBD" 2>/dev/null | awk 'tolower($2)=="c12a7328-f81f-11d2-ba4b-00a0c93ec93b" {print "/dev/"$1; exit}')`,
    // Fallback: look for any FAT partition on the disk
    'if [ -z "$EFI_PART" ]; then',
    '  for p in ${NBD}p*; do',
    '    [ -e "$p" ] && blkid -s TYPE -o value "$p" 2>/dev/null | grep -qi vfat && EFI_PART="$p" && break',
    '  done',
    'fi',
    'if [ -z "$EFI_PART" ]; then',
    `  ${nbdReleaseHoldersCall('"$NBD"')}; qemu-nbd --disconnect "$NBD" >/dev/null 2>&1`,
    '  echo "INJECT_RESULT=NO_EFI_PART"; exit 0',
    'fi',
    'MNT=$(mktemp -d /tmp/efi-inject-XXXXXX)',
    'if ! mount -t vfat -o rw "$EFI_PART" "$MNT" 2>/dev/null; then',
    `  ${nbdReleaseHoldersCall('"$NBD"')}; qemu-nbd --disconnect "$NBD" >/dev/null 2>&1; rmdir "$MNT"`,
    '  echo "INJECT_RESULT=MOUNT_FAIL"; exit 0',
    'fi',
    'RESULT=NO_BOOTLOADER',
    // Windows: copy bootmgfw.efi to \EFI\Boot\bootx64.efi if missing
    'if [ -f "$MNT/EFI/Microsoft/Boot/bootmgfw.efi" ]; then',
    '  if [ -f "$MNT/EFI/Boot/bootx64.efi" ] || [ -f "$MNT/EFI/BOOT/BOOTX64.EFI" ]; then',
    '    RESULT=ALREADY_PRESENT',
    '  else',
    '    mkdir -p "$MNT/EFI/Boot" && cp "$MNT/EFI/Microsoft/Boot/bootmgfw.efi" "$MNT/EFI/Boot/bootx64.efi" && RESULT=WINDOWS_INJECTED',
    '  fi',
    'elif [ -f "$MNT/EFI/Boot/bootx64.efi" ] || [ -f "$MNT/EFI/BOOT/BOOTX64.EFI" ]; then',
    '  RESULT=ALREADY_PRESENT',
    'fi',
    'sync; umount "$MNT"; rmdir "$MNT"',
    `${nbdReleaseHoldersCall('"$NBD"')}; qemu-nbd --disconnect "$NBD" >/dev/null 2>&1`,
    'echo "INJECT_RESULT=$RESULT"',
  ].join('\n')
}
