import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeSshEndpointForMigration } from "../pve-tasks"
import { prisma } from "@/lib/db/prisma"
import { checkVddkPreflight, type VddkPreflightResult } from "./vddk-preflight"
import { formatSshEndpoint } from "@/lib/ssh/node-endpoint-core"
import { BROADCOM_DEFAULT_LIBDIR, libdirError, OPENVDDK_DEFAULT_LIBDIR, OPENVDDK_KIT, OPENVDDK_KIT_URL } from "./vddk-library"

// Automated warm-migration node provisioning: installs the whole warm runtime
// (nbdkit, its VDDK plugin, nbd-client, OpenVDDK, the nbd kernel module) on a
// target Proxmox node over SSH, the same way the cold path auto-installs
// virt-v2v (installV2vPackages). Strictly additive to vddk-preflight.ts: it
// CALLS checkVddkPreflight to confirm the result, never replaces it.
//
// The library is OpenVDDK (roadmap#177): the public Apache 2.0 kit, pinned by
// version and SHA-256, installed in its own directory, so no Enterprise token
// is needed and a Broadcom VDDK already on the node is never touched.

/**
 * Local copies of the kit the script uses before trying GitHub, for nodes
 * without internet access: the operator drops the pinned file there. The
 * SHA-256 check applies to it exactly as to a download.
 */
export const OPENVDDK_LOCAL_KIT_PATHS = [`/root/${OPENVDDK_KIT.file}`, `/var/tmp/${OPENVDDK_KIT.file}`] as const

export interface OpenVddkInstallScriptOpts {
  /** OpenVDDK directory on the node. Default: /usr/lib/openvddk. */
  libdir?: string
}

/**
 * Build the idempotent provisioning script run as root on the Proxmox node
 * (roadmap#177). Every step is safe to re-run: apt installs are no-ops when
 * satisfied, config files are overwritten with identical content, and the
 * library step does nothing when the directory already holds this release.
 * Otherwise:
 *  - the kit comes from a local copy on the node when there is one
 *    (OPENVDDK_LOCAL_KIT_PATHS), else from the GitHub release;
 *  - its SHA-256 is checked against the pinned value BEFORE extraction, then
 *    every file of the kit against its own SHA256SUMS;
 *  - lib64 -> lib, because nbdkit looks for <libdir>/lib64/libvixDiskLib.so.8
 *    and the kit ships lib/;
 *  - the directory is swapped in whole, LICENSE, NOTICE and THIRD-PARTY-NOTICES
 *    included. It is only ever replaced when it is absent, empty or already an
 *    OpenVDDK install: anything else (a Broadcom VDDK, an unrelated directory)
 *    stops the script before a byte is written there.
 */
export function buildOpenVddkInstallScript(opts: OpenVddkInstallScriptOpts = {}): string {
  const libdir = (opts.libdir || OPENVDDK_DEFAULT_LIBDIR).replace(/\/+$/, "")
  if (libdirError(libdir) || libdir === BROADCOM_DEFAULT_LIBDIR) {
    throw new Error(`Invalid OpenVDDK directory: ${libdir}. Pick a dedicated directory, never a system directory or the Broadcom VDDK's (${BROADCOM_DEFAULT_LIBDIR}).`)
  }
  const k = OPENVDDK_KIT

  return [
    ...runtimeHeadSteps(),
    // 3. OpenVDDK, pinned release, verified on the node.
    `LIB=${shellEscape(libdir)}`,
    `KIT_URL=${shellEscape(OPENVDDK_KIT_URL)}`,
    `KIT_SHA=${k.sha256}`,
    `LIB_SHA=${k.libSha256}`,
    `if [ -e "$LIB/lib64/libvixDiskLib.so.8" ] && [ "$(sha256sum "$LIB/lib/${k.libFile}" 2>/dev/null | cut -d' ' -f1)" = "$LIB_SHA" ]; then`,
    `  echo "OpenVDDK ${k.version} is already installed in $LIB"`,
    "else",
    '  if [ -e "$LIB" ] && [ -n "$(ls -A "$LIB" 2>/dev/null)" ] && ! grep -qs OpenVDDK "$LIB/NOTICE"; then',
    '    echo "proxcenter: $LIB is not empty and does not hold OpenVDDK: refusing to replace it." >&2',
    "    exit 1",
    "  fi",
    '  PARENT="$(dirname "$LIB")"',
    '  mkdir -p "$PARENT"',
    // Staged next to the target so the final mv stays on one filesystem.
    '  STAGE="$(mktemp -d "$PARENT/.proxcenter-openvddk.XXXXXX")"',
    `  trap 'rm -rf "$STAGE"' EXIT`,
    '  KIT_SRC="$KIT_URL"',
    `  for f in ${OPENVDDK_LOCAL_KIT_PATHS.map(shellEscape).join(" ")}; do [ -f "$f" ] && { KIT_SRC="$f"; break; }; done`,
    '  if [ "$KIT_SRC" != "$KIT_URL" ]; then',
    '    cp "$KIT_SRC" "$STAGE/kit.tar.gz"',
    '  elif ! curl -fsSL --retry 3 -o "$STAGE/kit.tar.gz" "$KIT_URL"; then',
    `    echo "proxcenter: Could not download OpenVDDK ${k.version} from $KIT_URL. On a node without internet access, copy ${k.file} to /root/ on the node and prepare it again." >&2`,
    "    exit 1",
    "  fi",
    '  if ! echo "$KIT_SHA  $STAGE/kit.tar.gz" | sha256sum -c --quiet - >/dev/null 2>&1; then',
    `    echo "proxcenter: $KIT_SRC does not match the SHA-256 ProxCenter pins for ${k.file} ($KIT_SHA): nothing was installed." >&2`,
    "    exit 1",
    "  fi",
    '  mkdir "$STAGE/kit"',
    '  tar xzf "$STAGE/kit.tar.gz" -C "$STAGE/kit" --strip-components=1 --no-same-owner',
    '  if ! (cd "$STAGE/kit" && sha256sum -c --quiet SHA256SUMS); then',
    `    echo "proxcenter: A file of the OpenVDDK ${k.version} kit does not match the kit's own SHA256SUMS: nothing was installed." >&2`,
    "    exit 1",
    "  fi",
    '  ln -s lib "$STAGE/kit/lib64"',
    '  chmod 755 "$STAGE/kit"',
    '  if [ -e "$LIB" ]; then mv "$LIB" "$STAGE/previous"; fi',
    '  mv "$STAGE/kit" "$LIB"',
    "fi",
    ...runtimeTailSteps(),
  ].join("\n")
}

/** Steps 0 to 2: OS gate, NBD tools, nbdkit's VDDK plugin. */
function runtimeHeadSteps(): string[] {
  return [
    // pipefail so a failing step in a pipe cannot be masked; -e for early exit.
    "set -eo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
    // 0. Refuse Debian < 13 before touching anything: nbdkit-plugin-vddk is
    // only packaged from Debian 13 (PVE 9) on, so apt would dead-end after
    // installing half the stack. The preflight already keeps the UI action
    // hidden on such a node; this guard covers direct API calls. An
    // unreadable VERSION_ID falls through on purpose.
    ". /etc/os-release 2>/dev/null || true",
    'DEBIAN_MAJOR="$(echo "$VERSION_ID" | cut -d. -f1)"',
    'if [ -n "$DEBIAN_MAJOR" ] && [ "$DEBIAN_MAJOR" -lt 13 ] 2>/dev/null; then',
    '  echo "proxcenter: Warm migration needs Proxmox VE 9: this node runs Debian $DEBIAN_MAJOR (Proxmox VE $((DEBIAN_MAJOR - 4))), and nbdkit-plugin-vddk is only packaged from Debian 13 on." >&2',
    "  exit 1",
    "fi",
    // 1. NBD server + client (Debian main).
    // `|| true`: a node without a Proxmox subscription always fails
    // `apt-get update` with a 401 on enterprise.proxmox.com, which is benign
    // here since every package below comes from the Debian repositories. The
    // real gate stays `apt-get install`, which still fails loudly when a
    // package is genuinely unavailable.
    "apt-get update || true",
    "apt-get install -y nbdkit nbd-client",
    // 2. nbdkit-plugin-vddk lives in Debian non-free, which a stock PVE node
    // does not enable. Overwriting the same one-line file is idempotent.
    ". /etc/os-release",
    `echo "deb http://deb.debian.org/debian \${VERSION_CODENAME} contrib non-free non-free-firmware" > /etc/apt/sources.list.d/proxcenter-nonfree.list`,
    // Same tolerance as above: the enterprise-repo 401 must not mask the fact
    // that the non-free component itself refreshed correctly.
    "apt-get update || true",
    "apt-get install -y nbdkit-plugin-vddk",
  ]
}

/** Steps 4 and 5: nbd kernel module, LVM kept off NBD devices. */
function runtimeTailSteps(): string[] {
  return [
    // 4. nbd kernel module, now and at boot.
    "modprobe nbd max_part=0",
    "echo nbd > /etc/modules-load.d/proxcenter-nbd.conf",
    "printf 'options nbd max_part=0\\n' > /etc/modprobe.d/proxcenter-nbd.conf",
    // 5. Keep the host's LVM off the transient NBD devices (#535). Without
    // this, udev's `pvscan --cache -aay` auto-activates the GUEST volume group
    // it finds on /dev/nbdN(pM): the dm LVs pin the device until reboot, and a
    // guest VG named like the host's (`pve`) breaks PVE's own lvcreate for as
    // long as the copy runs ("Multiple VGs found with the same name"). PVE
    // already ships an active global_filter line (r|/dev/zd.*|, r|/dev/rbd.*|):
    // prepend the nbd exclusion to that line, validate, and roll back on any
    // parse error so the host's LVM can never be left broken. A conf without an
    // active global_filter line is left alone: the teardown-side release in
    // nbd-holders.ts still frees the device, only the prevention is skipped.
    "LVMCONF=/etc/lvm/lvm.conf",
    `if grep -qE '^[[:space:]]*global_filter[[:space:]]*=[[:space:]]*\\[' "$LVMCONF" && ! grep -qE '^[[:space:]]*global_filter[[:space:]]*=.*nbd' "$LVMCONF"; then`,
    '  cp -a "$LVMCONF" "$LVMCONF.proxcenter-bak"',
    `  sed -i -E 's#^([[:space:]]*global_filter[[:space:]]*=[[:space:]]*\\[)#\\1 "r|/dev/nbd.*|",#' "$LVMCONF"`,
    "  if lvmconfig --validate >/dev/null 2>&1; then",
    '    rm -f "$LVMCONF.proxcenter-bak"',
    "  else",
    '    mv "$LVMCONF.proxcenter-bak" "$LVMCONF"',
    `    echo "WARN: /etc/lvm/lvm.conf left unchanged (global_filter edit failed validation); add r|/dev/nbd.*| to devices/global_filter by hand" >&2`,
    "  fi",
    "fi",
  ]
}

/** Marker of the provisioning scripts' own failure messages (see the `echo "proxcenter: ..." >&2` lines). */
const SCRIPT_REASON = /^proxcenter: (.+)$/

/**
 * What the operator reads when the script fails. apt prints dozens of lines
 * (warnings included) on every run, which buried the one line that mattered,
 * e.g. a kit refused for its checksum (roadmap#177): the script's own reasons
 * when it gave one, else the tail of what it printed, bounded.
 */
export function provisionFailureDetail(error: string | undefined, output: string | undefined): string {
  const all = [error, output].filter(Boolean).join("\n")
  const reasons = all.split("\n").map(l => SCRIPT_REASON.exec(l.trim())?.[1]).filter((r): r is string => !!r)
  if (reasons.length > 0) return [...new Set(reasons)].join(" ")
  const lines = all.split("\n").map(l => l.trimEnd()).filter(l => l && !/^W: /.test(l))
  const tail = lines.slice(-12).join("\n")
  return (tail.length > 1500 ? tail.slice(-1500) : tail) || "no output"
}

// apt update + installs + a 17 MB download: minutes on a slow node, far beyond
// executeSSH's 30 s default.
const PROVISION_TIMEOUT_MS = 15 * 60_000

/**
 * Provision a Proxmox node for warm migration end-to-end: run the idempotent
 * OpenVDDK install script on the node as root (over the same executeSSH path
 * the pipelines use), then re-run the existing checkVddkPreflight and return
 * its verdict so the caller gets the same go/no-go shape the dialog already
 * understands. Throws with an actionable message when the directory is refused
 * or the script fails on the node.
 */
export async function provisionWarmNode(
  connectionId: string,
  node: string,
  vddkLibdir?: string,
): Promise<VddkPreflightResult> {
  // Installed as root and swapping its directory whole: only ever into
  // OpenVDDK's own directory, whatever the request names. An explicit
  // vddkLibdir still points the preflight and the engine at another library.
  const requested = vddkLibdir?.replace(/\/+$/, "")
  if (requested && requested !== OPENVDDK_DEFAULT_LIBDIR) {
    throw new Error(`"Prepare this node" installs OpenVDDK in ${OPENVDDK_DEFAULT_LIBDIR} only, not in ${requested}.`)
  }
  const libdir = OPENVDDK_DEFAULT_LIBDIR

  // Resolve the node IP exactly as runWarmMigration / runWarmNodePreflight do,
  // so we provision the very node the engine will use.
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeSshEndpointForMigration(prisma, connectionId, node, conn.baseUrl)

  const command = `bash -c ${shellEscape(buildOpenVddkInstallScript({ libdir }))}`
  const res = await executeSSH(connectionId, nodeIp, command, PROVISION_TIMEOUT_MS)
  if (!res.success) {
    throw new Error(
      `Warm-migration node provisioning failed on ${node} (${formatSshEndpoint(nodeIp)}): ${provisionFailureDetail(res.error, res.output)}`,
    )
  }

  // Confirm with the existing preflight — the single source of truth for
  // "this node is ready" — and hand its structured verdict back verbatim.
  return checkVddkPreflight(connectionId, nodeIp, libdir)
}
