// The VDDK library the warm VMware path loads on the Proxmox node (roadmap#177).
//
// OpenVDDK (https://github.com/openvddk/openvddk, Apache 2.0) is THE library: a
// drop-in libvixDiskLib.so.8 that ProxCenter installs on its own, without the
// Enterprise package Broadcom's VDDK needs since its public download closed.
// ProxCenter installs the upstream release as published. It lives in its own
// directory: a Broadcom VDDK already on a node stays where it is, untouched,
// and nbdkit loads whichever library the `libdir=` it is given holds (an
// explicit `vddkLibdir` from the API can still point at one).
// Pure: no database, no SSH, so client components can import the constants.

/** Where ProxCenter installs OpenVDDK, and the directory every warm run hands to nbdkit. */
export const OPENVDDK_DEFAULT_LIBDIR = "/usr/lib/openvddk"
/** Where Broadcom's VDDK lives on nodes prepared before OpenVDDK: never written to. */
export const BROADCOM_DEFAULT_LIBDIR = "/usr/lib/vmware-vix-disklib"

/**
 * The OpenVDDK release ProxCenter installs, pinned. The kit's SHA-256 is checked
 * on the node before anything is extracted, whether it was downloaded or copied
 * onto the node by hand, then the kit's own SHA256SUMS is checked file by file.
 * Bumping the version means bumping all of it.
 */
export const OPENVDDK_KIT = {
  // 0.7.5 carries the fixes for ESXi 7.0.0 GA hosts (openvddk/openvddk#1) and
  // for a '+' in a datastore file path, e.g. a VM named "web+db" (openvddk/openvddk#4).
  version: "0.7.5",
  commit: "d7262efa169c",
  file: "openvddk-runtime-0.7.5-d7262efa169c.tar.gz",
  sha256: "69d835a52dd88ac89e5ab55140476e3f4b6b74292eb7a589cbe3214445aae59e",
  /** The library inside the kit (lib/), the file nbdkit ends up loading. */
  libFile: "libvixDiskLib.so.8.0.3",
  libSha256: "d8256c7a19712a27f53702402250c9c52c97a1231479b0b398f57be3f401443b",
  /** Download size, for the confirmation text. */
  sizeMB: 17,
  /** Size once extracted on the node. */
  installedMB: 43,
} as const

export const OPENVDDK_KIT_URL =
  `https://github.com/openvddk/openvddk/releases/download/v${OPENVDDK_KIT.version}/${OPENVDDK_KIT.file}`

// System directories a library directory must never be: the OpenVDDK install
// replaces its directory as a whole, so one of these would take the host down.
const SYSTEM_DIRS = new Set([
  "/", "/bin", "/boot", "/dev", "/etc", "/home", "/lib", "/lib64", "/opt", "/proc", "/root",
  "/run", "/sbin", "/srv", "/sys", "/tmp", "/usr", "/usr/bin", "/usr/lib", "/usr/lib64",
  "/usr/local", "/usr/local/lib", "/usr/sbin", "/usr/share", "/var", "/var/lib", "/var/tmp",
])

const LIBDIR_RE = /^\/[A-Za-z0-9._/-]+$/

/** Error code when a directory cannot receive OpenVDDK, or null when it can. */
export function libdirError(raw: string): string | null {
  // "/" (or "///") strips down to nothing, but it is the root, not an empty path.
  const dir = raw.replace(/\/+$/, "") || (/^\/+$/.test(raw) ? "/" : "")
  if (SYSTEM_DIRS.has(dir)) return "system_dir"
  if (!dir || dir.length > 200 || !LIBDIR_RE.test(dir)) return "invalid_path"
  if (dir.split("/").some(seg => seg === "." || seg === "..")) return "invalid_path"
  return null
}
