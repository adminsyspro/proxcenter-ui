import { shellEscape } from "@/lib/ssh/exec"

const VDDK_LIBDIR = "/usr/lib/vmware-vix-disklib"
const VERSION_MARKER = `${VDDK_LIBDIR}/.proxcenter-version`

/** Re-push the VDDK only when the node has none or a different version. */
export function needsVddkPush(uploadedVersion: string, deployedVersion: string | null): boolean {
  return deployedVersion !== uploadedVersion
}

/**
 * Build the node provisioning script for warm migration:
 *   - apt-install nbdkit + nbd-client from Debian main. `apt-get update` is
 *     tolerated-failing (`|| true`) because a PVE node without a subscription
 *     401s on the enterprise repo, which would otherwise abort under `set -e`
 *     even though the packages we need live in the (refreshed) Debian repos.
 *     nbdkit-plugin-vddk is NOT installed here — it is non-free (absent from a
 *     stock node's components) and is an admin prerequisite the preflight flags.
 *   - if the on-node version marker doesn't already match, extract the delivered
 *     (SSH-pushed) VDDK tarball into the default libdir, write the marker, ensure
 *     the so.8->so.9 symlink VDDK 9.x needs, ldconfig, and load nbd persistently.
 * `set -e` aborts on a real failure so a half-install never reads as success.
 */
export function buildWarmInstallScript(version: string, remoteTarball: string): string {
  const v = shellEscape(version)
  const tb = shellEscape(remoteTarball)
  return [
    "set -e",
    "apt-get update -qq || true",
    "apt-get install -y nbdkit nbd-client",
    `if [ "$(cat ${shellEscape(VERSION_MARKER)} 2>/dev/null)" != ${v} ]; then`,
    `  rm -rf ${VDDK_LIBDIR}; mkdir -p ${VDDK_LIBDIR} /tmp/proxcenter-vddk-x`,
    `  tar -xzf ${tb} -C /tmp/proxcenter-vddk-x`,
    `  cp -a /tmp/proxcenter-vddk-x/vmware-vix-disklib-distrib/. ${VDDK_LIBDIR}/`,
    `  rm -rf /tmp/proxcenter-vddk-x`,
    `  printf '%s' ${v} > ${shellEscape(VERSION_MARKER)}`,
    "fi",
    // VDDK 9.x ships libvixDiskLib.so.9; nbdkit 1.42 dlopens the so.8 SONAME.
    `if [ -e ${VDDK_LIBDIR}/lib64/libvixDiskLib.so.9 ] && [ ! -e ${VDDK_LIBDIR}/lib64/libvixDiskLib.so.8 ]; then ln -sf libvixDiskLib.so.9 ${VDDK_LIBDIR}/lib64/libvixDiskLib.so.8; fi`,
    "ldconfig || true",
    "modprobe nbd max_part=0 || true",
    "echo nbd > /etc/modules-load.d/proxcenter-nbd.conf",
    "printf 'options nbd max_part=0\\n' > /etc/modprobe.d/proxcenter-nbd.conf",
    `rm -f ${tb}`,
  ].join("\n")
}
