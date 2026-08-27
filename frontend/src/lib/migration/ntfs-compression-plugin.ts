/**
 * ntfs-3g "system compression" plugin for the libguestfs appliance.
 *
 * Windows can store its system files with "Compact OS" (WOF system
 * compression, reparse tag 0x80000017). Windows decides this alone at install
 * time, so users have it without knowing. ntfs-3g only reads such files with
 * the ntfs-3g-system-compression plugin: without it every compressed file is
 * exposed as a dangling symlink ("unsupported reparse tag 0x80000017"),
 * libguestfs cannot find System32\cmd.exe, inspection returns no operating
 * system and virt-v2v fails with "No root device found". Fedora and RHEL ship
 * the plugin (libguestfs-winsupport); Debian, hence Proxmox VE, does not.
 *
 * Two steps are needed on the node, both idempotent:
 *   1. build the plugin from the pinned upstream release and install it in
 *      ntfs-3g's plugin directory (the directory ntfs-3g was built with);
 *   2. hand it to supermin through a tarball in libguestfs' supermin.d, since
 *      the appliance is assembled from installed *packages* and ignores a
 *      stray file, then drop the cached appliance so it is rebuilt.
 *
 * Verified on Proxmox VE 9 (Debian 13, libguestfs 1.54, ntfs-3g 2022.10.3):
 * a Compact OS Windows Server 2025 goes from "<operatingsystems/>" to a
 * clean inspection.
 */

export const NTFS_COMPRESSION_PLUGIN_VERSION = "1.1"
export const NTFS_COMPRESSION_PLUGIN_URL =
  `https://github.com/ebiggers/ntfs-3g-system-compression/archive/refs/tags/v${NTFS_COMPRESSION_PLUGIN_VERSION}.tar.gz`

/** Plugin file name, fixed by ntfs-3g: ntfs-plugin-<reparse tag>.so */
export const NTFS_COMPRESSION_PLUGIN_FILE = "ntfs-plugin-80000017.so"
export const NTFS_COMPRESSION_SUPERMIN_TARBALL = "zz-ntfs-3g-system-compression.tar.gz"

/**
 * Shell fragment that prints "yes" when both the plugin and its supermin.d
 * tarball are in place, "no" otherwise. Used by the preflight check.
 */
export function ntfsCompressionPluginCheckCommand(): string {
  return (
    `PLUGIN=$(ls /usr/lib/*/ntfs-3g/${NTFS_COMPRESSION_PLUGIN_FILE} 2>/dev/null | head -1); ` +
    `SD=$(ls -d /usr/lib/*/guestfs/supermin.d 2>/dev/null | head -1); ` +
    `if [ -n "$PLUGIN" ] && [ -n "$SD" ] && [ -f "$SD/${NTFS_COMPRESSION_SUPERMIN_TARBALL}" ]; then echo yes; else echo no; fi`
  )
}

/**
 * Bash script (to run under `bash -c`, with `set -e` semantics) that builds
 * and installs the plugin if missing, then registers it with supermin. Safe to
 * run again: every step checks for its result first.
 */
export function ntfsCompressionPluginInstallScript(): string {
  return (
    "set -eo pipefail; " +
    // Exploratory lookups run under `set -eo pipefail`: a no-match ls or grep
    // must not abort the script, it is the very case the script handles.
    `PLUGIN=$( (ls /usr/lib/*/ntfs-3g/${NTFS_COMPRESSION_PLUGIN_FILE} 2>/dev/null || true) | head -1); ` +
    'if [ -z "$PLUGIN" ]; then ' +
    "  apt-get install -y build-essential pkg-config ntfs-3g-dev autoconf automake libtool curl; " +
    // ntfs-3g looks for plugins in the directory compiled into its binary
    // (e.g. /usr/lib/x86_64-linux-gnu/ntfs-3g); the plugin's configure wants
    // the parent of that directory as --libdir.
    "  LIBDIR=$( (strings $(command -v ntfs-3g) | grep ntfs-plugin || true) | head -1 | sed 's@/ntfs-3g/.*@@'); " +
    '  [ -n "$LIBDIR" ] || LIBDIR=/usr/lib/x86_64-linux-gnu; ' +
    "  TMPDIR=$(mktemp -d); " +
    '  cd "$TMPDIR"; ' +
    `  curl -fsSL -o plugin.tar.gz ${NTFS_COMPRESSION_PLUGIN_URL}; ` +
    "  tar xzf plugin.tar.gz; " +
    "  cd ntfs-3g-system-compression-*; " +
    '  autoreconf -i && ./configure --libdir="$LIBDIR" && make && make install; ' +
    '  cd /; rm -rf "$TMPDIR"; ' +
    `  PLUGIN="$LIBDIR/ntfs-3g/${NTFS_COMPRESSION_PLUGIN_FILE}"; ` +
    "fi; " +
    `SD=$( (ls -d /usr/lib/*/guestfs/supermin.d 2>/dev/null || true) | head -1); ` +
    '[ -n "$SD" ] || { echo "libguestfs supermin.d not found (is guestfs-tools installed?)" >&2; exit 1; }; ' +
    `if [ ! -f "$SD/${NTFS_COMPRESSION_SUPERMIN_TARBALL}" ]; then ` +
    `  tar czf "$SD/${NTFS_COMPRESSION_SUPERMIN_TARBALL}" -C / "\${PLUGIN#/}"; ` +
    // libguestfs rebuilds the appliance when supermin.d changes; clearing the
    // cache makes that certain for the next run.
    "  rm -rf /var/tmp/.guestfs-*/appliance.d; " +
    "fi; " +
    "echo installed"
  )
}
