import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  resolveVddkArtifact,
  buildVddkInstallScript,
  buildVddkProvisionCommand,
  provisionWarmNode,
  isVddkPackageTokenConfigured,
} from "./vddk-provision"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

// provisionWarmNode resolves the node IP exactly like the warm engine does,
// so the script lands on the very node runWarmMigration will use.
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve.local:8006" })),
}))
vi.mock("../pve-tasks", () => ({
  getNodeIpForMigration: vi.fn(async () => "10.0.0.7"),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

// Tests mock HTTP — the real registry is NEVER hit.
const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

const TOKEN = "ghp_enterprise_package_token"
const BEARER = "djE6c2hvcnQtbGl2ZWQtcHVsbC1iZWFyZXI"
const DIGEST = "sha256:12c100ab21408dd43c45c5e10026a8a8bfff0bea94b933bf1dae947d66bc6495"
const SIZE = 32935592

const tokenOk = () => ({ ok: true, status: 200, json: async () => ({ token: BEARER }) })
const manifestOk = () => ({
  ok: true,
  status: 200,
  json: async () => ({ layers: [{ mediaType: "application/gzip", digest: DIGEST, size: SIZE }] }),
})

// Mirrors the probe output shape asserted in vddk-preflight.test.ts.
const ALL_PRESENT = [
  "nbdkit=/usr/sbin/nbdkit",
  "nbd-client=/usr/sbin/nbd-client",
  "vddk-plugin=/usr/lib/x86_64-linux-gnu/nbdkit/plugins/nbdkit-vddk-plugin.so",
  "vddk-lib=/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9",
].join("\n")

beforeEach(() => {
  fetchMock.mockReset()
  mockSSH.mockReset()
  vi.stubEnv("GHCR_TOKEN", TOKEN)
})
afterEach(() => vi.unstubAllEnvs())

describe("isVddkPackageTokenConfigured", () => {
  it("is true only when GHCR_TOKEN is set and non-blank", () => {
    expect(isVddkPackageTokenConfigured()).toBe(true)
    vi.stubEnv("GHCR_TOKEN", "   ")
    expect(isVddkPackageTokenConfigured()).toBe(false)
    vi.stubEnv("GHCR_TOKEN", "")
    expect(isVddkPackageTokenConfigured()).toBe(false)
  })
})

describe("resolveVddkArtifact", () => {
  it("exchanges the token for a pull bearer, reads layers[0] from the OCI manifest", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(manifestOk())

    const art = await resolveVddkArtifact(TOKEN)
    expect(art).toEqual({ bearer: BEARER, digest: DIGEST, size: SIZE })

    // Token exchange: pull scope on the package, HTTP Basic adminsyspro:<token>.
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]
    expect(tokenUrl).toBe("https://ghcr.io/token?scope=repository:adminsyspro/proxcenter-vddk:pull&service=ghcr.io")
    expect(tokenInit.headers.Authorization).toBe(
      `Basic ${Buffer.from(`adminsyspro:${TOKEN}`).toString("base64")}`,
    )

    // Manifest read: bearer auth + the OCI manifest Accept header.
    const [manifestUrl, manifestInit] = fetchMock.mock.calls[1]
    expect(manifestUrl).toBe("https://ghcr.io/v2/adminsyspro/proxcenter-vddk/manifests/9.1.0.0")
    expect(manifestInit.headers.Authorization).toBe(`Bearer ${BEARER}`)
    expect(manifestInit.headers.Accept).toBe("application/vnd.oci.image.manifest.v1+json")
  })

  it("honours PROXCENTER_VDDK_PACKAGE and PROXCENTER_VDDK_TAG overrides", async () => {
    vi.stubEnv("PROXCENTER_VDDK_PACKAGE", "adminsyspro/vddk-lab")
    vi.stubEnv("PROXCENTER_VDDK_TAG", "8.0.3")
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(manifestOk())

    await resolveVddkArtifact(TOKEN)
    expect(fetchMock.mock.calls[0][0]).toContain("scope=repository:adminsyspro/vddk-lab:pull")
    expect(fetchMock.mock.calls[1][0]).toBe("https://ghcr.io/v2/adminsyspro/vddk-lab/manifests/8.0.3")
  })

  it("fails actionably on a rejected token (401) without leaking the token", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })

    const err = await resolveVddkArtifact(TOKEN).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/GHCR_TOKEN/)
    expect((err as Error).message).toMatch(/401/)
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it("fails actionably when the manifest returns 404, naming the package and tag", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })

    const err = await resolveVddkArtifact(TOKEN).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("adminsyspro/proxcenter-vddk:9.1.0.0")
    expect((err as Error).message).toMatch(/404/)
    expect((err as Error).message).toMatch(/PROXCENTER_VDDK_TAG/)
    expect((err as Error).message).not.toContain(TOKEN)
    expect((err as Error).message).not.toContain(BEARER)
  })

  it("fails when the manifest has no layers[0]", async () => {
    fetchMock
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ layers: [] }) })

    await expect(resolveVddkArtifact(TOKEN)).rejects.toThrow(/no layers|malformed/i)
  })
})

describe("buildVddkInstallScript", () => {
  const script = () => buildVddkInstallScript({ pkg: "adminsyspro/proxcenter-vddk", digest: DIGEST })

  it("installs nbdkit + nbd-client from Debian main first", () => {
    const s = script()
    expect(s).toContain("apt-get update")
    expect(s).toContain("apt-get install -y nbdkit nbd-client")
  })

  // Regression, found on a real PVE 9 node: a node without a Proxmox
  // subscription always fails `apt-get update` with a 401 on
  // enterprise.proxmox.com. Under `set -e` that aborted the whole
  // provisioning even though the Debian repositories had refreshed fine.
  it("tolerates the enterprise-repo 401 that every unsubscribed PVE node returns", () => {
    const lines = script().split("\n")
    const updates = lines.filter((l) => l.trim().startsWith("apt-get update"))
    expect(updates).toHaveLength(2)
    for (const line of updates) expect(line).toBe("apt-get update || true")
  })

  it("still fails loudly when a package is genuinely unavailable", () => {
    const lines = script().split("\n")
    const installs = lines.filter((l) => l.includes("apt-get install"))
    expect(installs).toHaveLength(2)
    for (const line of installs) expect(line).not.toContain("|| true")
  })

  it("enables Debian non-free (codename from os-release) and installs the vddk plugin", () => {
    const s = script()
    expect(s).toContain(". /etc/os-release")
    expect(s).toContain(
      'echo "deb http://deb.debian.org/debian ${VERSION_CODENAME} contrib non-free non-free-firmware" > /etc/apt/sources.list.d/proxcenter-nonfree.list',
    )
    expect(s).toContain("apt-get install -y nbdkit-plugin-vddk")
  })

  it("downloads the VDDK blob into the libdir, stripping the tarball root dir", () => {
    const s = script()
    expect(s).toContain("mkdir -p '/usr/lib/vmware-vix-disklib'")
    expect(s).toContain(`"https://ghcr.io/v2/adminsyspro/proxcenter-vddk/blobs/${DIGEST}"`)
    expect(s).toContain("curl -fsSL")
    expect(s).toContain("tar xz -C '/usr/lib/vmware-vix-disklib' --strip-components=1")
  })

  it("guards the download so a provisioned node never re-downloads 33 MB", () => {
    const s = script()
    expect(s).toContain(
      "if [ ! -e '/usr/lib/vmware-vix-disklib'/lib64/libvixDiskLib.so.9 ] && [ ! -e '/usr/lib/vmware-vix-disklib'/lib64/libvixDiskLib.so.8 ]; then",
    )
  })

  it("adds the .so.8 -> .so.9 symlink only when .so.9 exists and .so.8 does not, then ldconfig", () => {
    const s = script()
    expect(s).toContain(
      "if [ -e '/usr/lib/vmware-vix-disklib'/lib64/libvixDiskLib.so.9 ] && [ ! -e '/usr/lib/vmware-vix-disklib'/lib64/libvixDiskLib.so.8 ]; then",
    )
    expect(s).toContain("ln -sf libvixDiskLib.so.9 '/usr/lib/vmware-vix-disklib'/lib64/libvixDiskLib.so.8")
    expect(s).toContain("ldconfig")
  })

  it("loads the nbd module now and at boot with max_part=0", () => {
    const s = script()
    expect(s).toContain("modprobe nbd max_part=0")
    expect(s).toContain("echo nbd > /etc/modules-load.d/proxcenter-nbd.conf")
    expect(s).toContain("printf 'options nbd max_part=0\\n' > /etc/modprobe.d/proxcenter-nbd.conf")
  })

  it("fails fast and loud: set -eo pipefail so a broken curl cannot be masked by tar", () => {
    expect(script()).toContain("set -eo pipefail")
  })

  it("NEVER embeds the token or bearer — the script only references $VDDK_BEARER", () => {
    const s = script()
    expect(s).toContain('Authorization: Bearer $VDDK_BEARER')
    expect(s).not.toContain(TOKEN)
    expect(s).not.toContain(BEARER)
  })

  it("honours a custom libdir", () => {
    const s = buildVddkInstallScript({ pkg: "adminsyspro/proxcenter-vddk", digest: DIGEST, libdir: "/opt/vddk" })
    expect(s).toContain("mkdir -p '/opt/vddk'")
    expect(s).toContain("tar xz -C '/opt/vddk' --strip-components=1")
    expect(s).toContain("ln -sf libvixDiskLib.so.9 '/opt/vddk'/lib64/libvixDiskLib.so.8")
  })

  it("rejects a malformed digest or package path (nothing unvetted reaches the shell)", () => {
    expect(() => buildVddkInstallScript({ pkg: "adminsyspro/proxcenter-vddk", digest: "sha256:short" })).toThrow(/digest/i)
    expect(() => buildVddkInstallScript({ pkg: "bad path; rm -rf /", digest: DIGEST })).toThrow(/package/i)
  })
})

describe("buildVddkProvisionCommand", () => {
  it("hands the bearer to the remote shell as an environment variable, outside the script text", () => {
    const s = buildVddkInstallScript({ pkg: "adminsyspro/proxcenter-vddk", digest: DIGEST })
    const cmd = buildVddkProvisionCommand(s, BEARER)
    expect(cmd.startsWith(`env VDDK_BEARER='${BEARER}' bash -c `)).toBe(true)
    // The bash -c payload (everything after the env assignment) must not
    // carry the literal bearer — it references $VDDK_BEARER instead.
    const payload = cmd.slice(cmd.indexOf("bash -c"))
    expect(payload).not.toContain(BEARER)
  })
})

describe("provisionWarmNode", () => {
  it("resolves the artifact, runs the script on the engine-resolved node IP, then re-runs the preflight", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(manifestOk())
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "" }) // install script
      .mockResolvedValueOnce({ success: true, output: ALL_PRESENT }) // preflight probe

    const r = await provisionWarmNode("conn", "pve1")
    expect(r.ok).toBe(true)
    expect(r.missing).toEqual([])

    // Install run: bearer via env, generous timeout for apt + the download.
    const [connId, nodeIp, cmd, timeoutMs] = mockSSH.mock.calls[0]
    expect(connId).toBe("conn")
    expect(nodeIp).toBe("10.0.0.7")
    expect(cmd).toContain("env VDDK_BEARER=")
    expect(cmd).toContain("nbdkit-plugin-vddk")
    expect(timeoutMs).toBeGreaterThan(60_000)

    // Verdict comes from the existing preflight probe, on the same node.
    expect(mockSSH.mock.calls[1][1]).toBe("10.0.0.7")
    expect(mockSSH.mock.calls[1][2]).toContain("vmware-vix-disklib")
  })

  it("fails with an actionable error when GHCR_TOKEN is not configured", async () => {
    vi.stubEnv("GHCR_TOKEN", "")
    await expect(provisionWarmNode("conn", "pve1")).rejects.toThrow(/GHCR_TOKEN/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockSSH).not.toHaveBeenCalled()
  })

  it("redacts the bearer and token from a failed script's output before throwing", async () => {
    fetchMock.mockResolvedValueOnce(tokenOk()).mockResolvedValueOnce(manifestOk())
    mockSSH.mockResolvedValueOnce({
      success: false,
      output: `curl -fsSL -H "Authorization: Bearer ${BEARER}" failed`,
      error: `curl: (22) The requested URL returned error: 403 (token ${TOKEN})`,
    })

    const err = await provisionWarmNode("conn", "pve1").catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain("pve1")
    expect((err as Error).message).toContain("[redacted]")
    expect((err as Error).message).not.toContain(BEARER)
    expect((err as Error).message).not.toContain(TOKEN)
    // The preflight is not consulted after a failed install.
    expect(mockSSH).toHaveBeenCalledTimes(1)
  })
})
