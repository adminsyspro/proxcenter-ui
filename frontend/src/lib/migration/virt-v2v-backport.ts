/**
 * ProxCenter's build of the virt-v2v PVE 9 ships (Debian 13's 2.6.0-1) with
 * upstream's Windows Server 2025 support (libguestfs-common 2d42128e, first in
 * virt-v2v 2.7.2), published with its source on
 * https://github.com/adminsyspro/virt-v2v-pve. The node downloads it itself,
 * like the rest of the conversion packages, and installs it only when its
 * SHA-256 is the one below.
 *
 * Its version sorts above 2.6.0-1 and a binary rebuild of it (+b1), and below
 * a Debian stable update (2.6.0-1+deb13u1), which replaces it. A node is
 * offered it only on Debian 13 amd64, with a virt-v2v older than it whose
 * binary lacks the `2k25` marker (virt-v2v-windows.ts).
 */
export const VIRT_V2V_BACKPORT = {
  version: "2.6.0-1+deb13u1~proxcenter1",
  // GitHub stores release files with "." in place of "~".
  url: "https://github.com/adminsyspro/virt-v2v-pve/releases/download/v2.6.0-proxcenter1/virt-v2v_2.6.0-1%2Bdeb13u1.proxcenter1_amd64.deb",
  sha256: "ad36ad2c1403eef2cfbc559a0821e1a0088e4873706d6917e92958404d648bcd",
}

/** The Windows Server 2025 directory name the build adds to the binary. */
const MARKER = "2k25"

/** Shell condition: the node runs a virt-v2v the backport upgrades and fixes. */
function eligible(): string {
  return [
    `( . /etc/os-release && [ "$VERSION_CODENAME" = trixie ] )`,
    `[ "$(dpkg --print-architecture)" = amd64 ]`,
    "test -x /usr/bin/virt-v2v-in-place",
    `! grep -aqF ${MARKER} /usr/bin/virt-v2v-in-place`,
    `dpkg --compare-versions "$(dpkg-query -W -f='\${Version}' virt-v2v 2>/dev/null)" lt "${VIRT_V2V_BACKPORT.version}"`,
  ].join(" && ")
}

/** Probe fragment: prints `v2v-backport` when the backport can be installed on the node (read-only). */
export function virtV2vBackportProbe(): string {
  return `${eligible()} && echo v2v-backport`
}

/**
 * Install fragment, a no-op on a node it does not apply to. Never fails by
 * itself, so installV2vPackages can run it under `set -e` without failing the
 * whole install when GitHub cannot be reached: a failed download or checksum
 * prints a warning instead.
 */
export function virtV2vBackportInstallScript(): string {
  return `if ${eligible()}; then `
    + `T=$(mktemp -d); `
    + `if wget -q -O "$T/virt-v2v.deb" '${VIRT_V2V_BACKPORT.url}' `
    + `&& echo '${VIRT_V2V_BACKPORT.sha256}  '"$T/virt-v2v.deb" | sha256sum -c --quiet `
    + `&& apt-get install -y "$T/virt-v2v.deb"; `
    + `then echo "virt-v2v ${VIRT_V2V_BACKPORT.version} installed (Windows Server 2025 support)"; `
    + `else echo "WARNING: virt-v2v ${VIRT_V2V_BACKPORT.version} (Windows Server 2025 support) could not be installed from ${VIRT_V2V_BACKPORT.url}"; fi; `
    + `rm -rf "$T"; fi`
}

/** The dedicated install: the fragment, then whether the binary now knows Windows Server 2025. */
export function virtV2vBackportInstallCommand(): string {
  return `${virtV2vBackportInstallScript()}; grep -aqF ${MARKER} /usr/bin/virt-v2v-in-place`
}
