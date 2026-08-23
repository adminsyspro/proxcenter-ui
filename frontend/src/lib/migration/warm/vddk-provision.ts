import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeIpForMigration } from "../pve-tasks"
import { prisma } from "@/lib/db/prisma"
import { checkVddkPreflight, DEFAULT_VDDK_LIBDIR, type VddkPreflightResult } from "./vddk-preflight"

// Automated warm-migration node provisioning (issue: Broadcom closed the
// public VDDK download in August 2026). The VDDK now ships as a private GHCR
// package that only Enterprise customers can pull; this module resolves the
// package on the registry and installs the whole warm runtime (nbdkit, its
// VDDK plugin, nbd-client, the VDDK itself, the nbd kernel module) on a
// target Proxmox node over SSH — the same way the cold path auto-installs
// virt-v2v (installV2vPackages). Strictly additive to vddk-preflight.ts:
// it CALLS checkVddkPreflight to confirm the result, never replaces it.

const GHCR = "https://ghcr.io"
const DEFAULT_VDDK_PACKAGE = "adminsyspro/proxcenter-vddk"
const DEFAULT_VDDK_TAG = "9.1.0.0"
// GHCR token exchange authenticates as the package owner org.
const GHCR_USER = "adminsyspro"

/** GHCR package path (owner/name) holding the VDDK tarball layer. */
export function vddkPackage(): string {
  return process.env.PROXCENTER_VDDK_PACKAGE || DEFAULT_VDDK_PACKAGE
}

/** Package tag to install (tracks the VDDK version). */
export function vddkTag(): string {
  return process.env.PROXCENTER_VDDK_TAG || DEFAULT_VDDK_TAG
}

/**
 * Whether an Enterprise VDDK package token is configured on this server.
 * Boolean only — used by the preflight route to tell the dialog it can offer
 * the automated "Prepare this node" action. The token value never leaves the
 * server.
 */
export function isVddkPackageTokenConfigured(): boolean {
  return Boolean(process.env.GHCR_TOKEN?.trim())
}

export interface VddkArtifact {
  /** Short-lived registry pull bearer (NEVER log or echo this). */
  bearer: string
  /** Layer blob digest (sha256:<hex>) — the VDDK tarball. */
  digest: string
  /** Layer size in bytes (progress/UX hints). */
  size: number
}

/** Replace every occurrence of a secret in a message with a placeholder. */
function redactSecret(text: string, secret: string | undefined): string {
  if (!secret) return text
  return text.split(secret).join("[redacted]")
}

/**
 * Exchange the Enterprise GHCR token for a scoped pull bearer, then read the
 * package manifest to locate the VDDK tarball layer. Fails with an actionable
 * error (and never the token itself) when the token is rejected, the package
 * or tag does not exist, or the manifest is malformed.
 */
export async function resolveVddkArtifact(token: string): Promise<VddkArtifact> {
  const pkg = vddkPackage()
  const tag = vddkTag()

  // 1. Token exchange: HTTP Basic (username = package owner, password = the
  // Enterprise token) against the registry token service, asking for a
  // pull-scoped bearer on the package repository.
  const tokenRes = await fetch(
    `${GHCR}/token?scope=repository:${pkg}:pull&service=ghcr.io`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${GHCR_USER}:${token}`).toString("base64")}`,
      },
    },
  )
  if (!tokenRes.ok) {
    if (tokenRes.status === 401 || tokenRes.status === 403) {
      throw new Error(
        `GHCR refused the configured VDDK package token (HTTP ${tokenRes.status}) for ${pkg}. ` +
        `Verify GHCR_TOKEN holds the Enterprise package token, that it has not expired, and that it has read access to the package.`,
      )
    }
    throw new Error(`GHCR token exchange for ${pkg} failed (HTTP ${tokenRes.status}). Retry, or check the registry status.`)
  }
  const tokenJson = (await tokenRes.json().catch(() => null)) as { token?: string } | null
  const bearer = tokenJson?.token
  if (!bearer) {
    throw new Error(`GHCR token exchange for ${pkg} returned no bearer token. Retry, or check the registry status.`)
  }

  // 2. Manifest: the OCI image has a single layer whose blob IS the VDDK
  // tarball (mediaType application/gzip, root dir vmware-vix-disklib-distrib/).
  const manifestRes = await fetch(`${GHCR}/v2/${pkg}/manifests/${tag}`, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/vnd.oci.image.manifest.v1+json",
    },
  })
  if (!manifestRes.ok) {
    if (manifestRes.status === 404) {
      throw new Error(
        `VDDK package ${pkg}:${tag} was not found on GHCR (HTTP 404). ` +
        `Verify PROXCENTER_VDDK_PACKAGE / PROXCENTER_VDDK_TAG, and that the configured GHCR_TOKEN can pull this private package.`,
      )
    }
    throw new Error(`Could not read the VDDK package manifest ${pkg}:${tag} (HTTP ${manifestRes.status}).`)
  }
  const manifest = (await manifestRes.json().catch(() => null)) as {
    layers?: { digest?: string; size?: number }[]
  } | null
  const layer = manifest?.layers?.[0]
  if (!layer?.digest) {
    throw new Error(
      `The VDDK package manifest ${pkg}:${tag} has no layers — the package looks malformed. ` +
      `Pin a known-good tag via PROXCENTER_VDDK_TAG or re-publish the package.`,
    )
  }
  return { bearer, digest: layer.digest, size: layer.size ?? 0 }
}

export interface VddkInstallScriptOpts {
  /** GHCR package path (owner/name) the blob is pulled from. */
  pkg: string
  /** VDDK tarball layer digest (sha256:<hex>). */
  digest: string
  /** VDDK install dir on the node. Default: the warm engine's default libdir. */
  libdir?: string
}

/**
 * Build the idempotent provisioning script run as root on the Proxmox node.
 * Every step is safe to re-run on an already-provisioned node: apt installs
 * are no-ops when satisfied, config files are overwritten with identical
 * content, the VDDK download is skipped once the library is present, and the
 * .so.8 symlink is guarded exactly like the manual setup guide.
 *
 * SECURITY: the registry bearer NEVER appears in the returned script — the
 * script references the VDDK_BEARER environment variable, which
 * provisionWarmNode injects on the remote side (see buildVddkProvisionCommand).
 * The script text can therefore be logged or surfaced in errors safely.
 */
export function buildVddkInstallScript(opts: VddkInstallScriptOpts): string {
  const { pkg, digest } = opts
  // Both values are interpolated into the blob URL inside the script: refuse
  // anything that is not a plain GHCR package path / sha256 digest so a
  // misconfigured env var cannot smuggle shell metacharacters.
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i.test(pkg)) {
    throw new Error(`Invalid VDDK package path: ${pkg}. Expected owner/name (PROXCENTER_VDDK_PACKAGE).`)
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`Invalid VDDK layer digest: ${digest}. Expected sha256:<64 hex chars>.`)
  }
  const libdir = opts.libdir || DEFAULT_VDDK_LIBDIR
  const lib = shellEscape(libdir)
  const blobUrl = `${GHCR}/v2/${pkg}/blobs/${digest}`

  return [
    // pipefail so a failing curl cannot be masked by tar; -e for early exit.
    "set -eo pipefail",
    "export DEBIAN_FRONTEND=noninteractive",
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
    // 3. The VDDK itself, pulled from the private GHCR package. The blob is
    // the tarball (root dir vmware-vix-disklib-distrib/, hence
    // --strip-components=1). Skipped when the library is already installed,
    // so a re-run neither re-downloads 33 MB nor touches a working install.
    `mkdir -p ${lib}`,
    `if [ ! -e ${lib}/lib64/libvixDiskLib.so.9 ] && [ ! -e ${lib}/lib64/libvixDiskLib.so.8 ]; then`,
    `  curl -fsSL -H "Authorization: Bearer $VDDK_BEARER" "${blobUrl}" | tar xz -C ${lib} --strip-components=1`,
    "fi",
    // nbdkit 1.42 (Debian 13 / PVE 9) dlopens the libvixDiskLib.so.8 SONAME;
    // VDDK 9.x ships .so.9 (ABI compatible), so add the symlink — same logic
    // as step 3 of the manual node-setup guide. VDDK 8.0.x ships .so.8
    // directly and the guard leaves it alone.
    `if [ -e ${lib}/lib64/libvixDiskLib.so.9 ] && [ ! -e ${lib}/lib64/libvixDiskLib.so.8 ]; then`,
    `  ln -sf libvixDiskLib.so.9 ${lib}/lib64/libvixDiskLib.so.8`,
    "fi",
    "ldconfig",
    // 4. nbd kernel module, now and at boot.
    "modprobe nbd max_part=0",
    "echo nbd > /etc/modules-load.d/proxcenter-nbd.conf",
    "printf 'options nbd max_part=0\\n' > /etc/modprobe.d/proxcenter-nbd.conf",
  ].join("\n")
}

/**
 * Wrap the install script for remote execution, passing the registry bearer
 * through an environment variable (`env VDDK_BEARER=... bash -c ...`) so the
 * script text itself — the part surfaced in logs and error messages — never
 * contains the secret.
 */
export function buildVddkProvisionCommand(script: string, bearer: string): string {
  return `env VDDK_BEARER=${shellEscape(bearer)} bash -c ${shellEscape(script)}`
}

// apt update + installs + a 33 MB registry download: minutes on a slow node,
// far beyond executeSSH's 30 s default.
const PROVISION_TIMEOUT_MS = 15 * 60_000

/**
 * Provision a Proxmox node for warm migration end-to-end: resolve the VDDK
 * package on GHCR with the Enterprise token, run the idempotent install
 * script on the node as root (over the same executeSSH path the pipelines
 * use), then re-run the existing checkVddkPreflight and return its verdict so
 * the caller gets the same go/no-go shape the dialog already understands.
 *
 * Throws with an actionable message when the token is missing, the registry
 * rejects it, the package/tag is absent, or the script fails on the node.
 * Any text that could carry the bearer is redacted before it is thrown.
 */
export async function provisionWarmNode(
  connectionId: string,
  node: string,
  vddkLibdir?: string,
): Promise<VddkPreflightResult> {
  const token = process.env.GHCR_TOKEN?.trim()
  if (!token) {
    throw new Error(
      "Automated VDDK setup is not configured: set GHCR_TOKEN to the Enterprise VDDK package token on the ProxCenter server, " +
      "or prepare the node manually per the warm-migration node setup guide.",
    )
  }

  const libdir = vddkLibdir || DEFAULT_VDDK_LIBDIR
  // Resolve the node IP exactly as runWarmMigration / runWarmNodePreflight do,
  // so we provision the very node the engine will use.
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeIpForMigration(prisma, connectionId, node, conn.baseUrl)

  const { bearer, digest } = await resolveVddkArtifact(token)
  const script = buildVddkInstallScript({ pkg: vddkPackage(), digest, libdir })

  const res = await executeSSH(connectionId, nodeIp, buildVddkProvisionCommand(script, bearer), PROVISION_TIMEOUT_MS)
  if (!res.success) {
    const detail = [res.error, res.output].filter(Boolean).join("\n").trim() || "no output"
    throw new Error(
      `Warm-migration node provisioning failed on ${node} (${nodeIp}): ` +
      redactSecret(redactSecret(detail, bearer), token),
    )
  }

  // Confirm with the existing preflight — the single source of truth for
  // "this node is ready" — and hand its structured verdict back verbatim.
  return checkVddkPreflight(connectionId, nodeIp, libdir)
}
