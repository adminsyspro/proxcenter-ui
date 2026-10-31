import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildOpenVddkInstallScript, provisionWarmNode, provisionFailureDetail, OPENVDDK_LOCAL_KIT_PATHS } from "./vddk-provision"
import { OPENVDDK_KIT } from "./vddk-library"

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
  getNodeSshEndpointForMigration: vi.fn(async () => ({ host: "10.0.0.7", port: 2201, source: "override" })),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))


const ALL_PRESENT = [
  "nbdkit=/usr/sbin/nbdkit",
  "nbd-client=/usr/sbin/nbd-client",
  "vddk-plugin=/usr/lib/x86_64-linux-gnu/nbdkit/plugins/nbdkit-vddk-plugin.so",
  "vddk-lib=/usr/lib/openvddk/lib64/libvixDiskLib.so.8",
].join("\n")

beforeEach(() => {
  mockSSH.mockReset()
})

describe("buildOpenVddkInstallScript: runtime steps", () => {
  const script = () => buildOpenVddkInstallScript()

  it("refuses a Debian < 13 node before touching anything, and names PVE 9", () => {
    const lines = script().split("\n")
    const guard = lines.findIndex(l => l.includes('"$DEBIAN_MAJOR" -lt 13'))
    const firstInstall = lines.findIndex(l => l.includes("apt-get install"))
    expect(guard).toBeGreaterThan(-1)
    expect(firstInstall).toBeGreaterThan(guard)
    expect(script()).toContain("Proxmox VE 9")
    // an unreadable VERSION_ID must fall through, not refuse
    expect(script()).toContain('[ -n "$DEBIAN_MAJOR" ]')
  })

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

  it("loads the nbd module now and at boot with max_part=0", () => {
    const s = script()
    expect(s).toContain("modprobe nbd max_part=0")
    expect(s).toContain("echo nbd > /etc/modules-load.d/proxcenter-nbd.conf")
    expect(s).toContain("printf 'options nbd max_part=0\\n' > /etc/modprobe.d/proxcenter-nbd.conf")
  })

  it("guards the global_filter edit on an active filter without an nbd exclusion", () => {
    const s = script()
    expect(s).toContain("LVMCONF=/etc/lvm/lvm.conf")
    expect(s).toContain(
      `if grep -qE '^[[:space:]]*global_filter[[:space:]]*=[[:space:]]*\\[' "$LVMCONF" && ! grep -qE '^[[:space:]]*global_filter[[:space:]]*=.*nbd' "$LVMCONF"; then`,
    )
  })

  it("backs up the config, prepends the nbd exclusion, and validates the filter", () => {
    const s = script()
    expect(s).toContain('cp -a "$LVMCONF" "$LVMCONF.proxcenter-bak"')
    expect(s).toContain(
      `sed -i -E 's#^([[:space:]]*global_filter[[:space:]]*=[[:space:]]*\\[)#\\1 "r|/dev/nbd.*|",#' "$LVMCONF"`,
    )
    expect(s).toContain('if lvmconfig --validate >/dev/null 2>&1; then\n    rm -f "$LVMCONF.proxcenter-bak"')
  })

  it("restores the original config and warns if filter validation fails", () => {
    const s = script()
    expect(s).toContain('else\n    mv "$LVMCONF.proxcenter-bak" "$LVMCONF"')
    expect(s).toContain('echo "WARN: /etc/lvm/lvm.conf left unchanged (global_filter edit failed validation); add r|/dev/nbd.*| to devices/global_filter by hand" >&2')
  })

  it("edits the LVM filter after configuring the nbd kernel module", () => {
    const s = script()
    expect(s).toContain("modprobe nbd max_part=0")
    expect(s).toContain("LVMCONF=/etc/lvm/lvm.conf")
    expect(s.indexOf("LVMCONF=/etc/lvm/lvm.conf")).toBeGreaterThan(s.indexOf("modprobe nbd max_part=0"))
    expect(s.indexOf("LVMCONF=/etc/lvm/lvm.conf")).toBeGreaterThan(s.indexOf("/etc/modprobe.d/proxcenter-nbd.conf"))
  })
})

describe("buildOpenVddkInstallScript (roadmap#177)", () => {
  const s = () => buildOpenVddkInstallScript()

  it("fails fast: set -eo pipefail first", () => {
    expect(s().startsWith("set -eo pipefail")).toBe(true)
  })

  it("installs OpenVDDK into /usr/lib/openvddk from the pinned GitHub release, no token involved", () => {
    const script = s()
    expect(script).toContain("LIB='/usr/lib/openvddk'")
    expect(script).toContain(`KIT_URL='https://github.com/openvddk/openvddk/releases/download/v0.7.4/${OPENVDDK_KIT.file}'`)
    expect(script).not.toContain("Bearer")
    expect(script).not.toContain("vmware-vix-disklib")
    // The library step sits between the plugin and the nbd module.
    expect(script.indexOf("KIT_URL=")).toBeGreaterThan(script.indexOf("apt-get install -y nbdkit-plugin-vddk"))
    expect(script.indexOf("KIT_URL=")).toBeLessThan(script.indexOf("modprobe nbd"))
  })

  it("uses a kit copied onto the node before trying GitHub, for nodes without internet access", () => {
    const script = s()
    expect(OPENVDDK_LOCAL_KIT_PATHS).toEqual([`/root/${OPENVDDK_KIT.file}`, `/var/tmp/${OPENVDDK_KIT.file}`])
    expect(script).toContain(`for f in '/root/${OPENVDDK_KIT.file}' '/var/tmp/${OPENVDDK_KIT.file}'; do`)
    expect(script.indexOf('cp "$KIT_SRC" "$STAGE/kit.tar.gz"')).toBeLessThan(script.indexOf("curl -fsSL"))
    expect(script).toContain(`copy ${OPENVDDK_KIT.file} to /root/ on the node`)
  })

  it("checks the pinned kit SHA-256 before extracting, whatever its source, then the kit's own SHA256SUMS", () => {
    const script = s()
    expect(script).toContain(`KIT_SHA=${OPENVDDK_KIT.sha256}`)
    const check = script.indexOf("sha256sum -c --quiet - ")
    const extract = script.indexOf("tar xzf")
    expect(check).toBeGreaterThan(script.indexOf('cp "$KIT_SRC"'))
    expect(check).toBeGreaterThan(script.indexOf("curl -fsSL"))
    expect(check).toBeLessThan(extract)
    expect(script.indexOf("sha256sum -c --quiet SHA256SUMS")).toBeGreaterThan(extract)
  })

  it("skips a node that already carries this exact release (idempotent)", () => {
    const script = s()
    expect(script).toContain(`LIB_SHA=${OPENVDDK_KIT.libSha256}`)
    expect(script).toContain(`sha256sum "$LIB/lib/${OPENVDDK_KIT.libFile}"`)
    expect(script).toContain("is already installed in $LIB")
  })

  it("never replaces a directory that holds something else than OpenVDDK", () => {
    const script = s()
    expect(script).toContain('! grep -qs OpenVDDK "$LIB/NOTICE"')
    expect(script.indexOf("refusing to replace it")).toBeLessThan(script.indexOf("curl -fsSL"))
  })

  it("links lib64 to lib, stages next to the target and swaps the directory whole", () => {
    const script = s()
    expect(script).toContain('ln -s lib "$STAGE/kit/lib64"')
    expect(script).toContain('STAGE="$(mktemp -d "$PARENT/.proxcenter-openvddk.XXXXXX")"')
    expect(script).toContain(`trap 'rm -rf "$STAGE"' EXIT`)
    expect(script).toContain('mv "$STAGE/kit" "$LIB"')
    expect(script).toContain('chmod 755 "$STAGE/kit"')
  })

  it("takes a custom directory, shell-quoted, and refuses Broadcom's or a system one", () => {
    expect(buildOpenVddkInstallScript({ libdir: "/opt/openvddk/" })).toContain("LIB='/opt/openvddk'")
    expect(() => buildOpenVddkInstallScript({ libdir: "/usr/lib/vmware-vix-disklib" })).toThrow(/Broadcom/)
    expect(() => buildOpenVddkInstallScript({ libdir: "/usr/lib" })).toThrow(/system directory/)
  })

  it("marks every fatal message so the operator reads the cause, not apt", () => {
    for (const line of s().split("\n").filter(l => l.includes(">&2") && !l.includes("WARN:"))) {
      expect(line).toContain('echo "proxcenter: ')
    }
  })
})

describe("provisionWarmNode", () => {
  it("installs OpenVDDK on the engine-resolved node, then re-runs the preflight on its directory", async () => {
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: ALL_PRESENT })

    const r = await provisionWarmNode("conn", "pve1")
    expect(r.ok).toBe(true)
    expect(r.libdir).toBe("/usr/lib/openvddk")

    const [connId, nodeIp, cmd, timeoutMs] = mockSSH.mock.calls[0]
    expect(connId).toBe("conn")
    expect(nodeIp).toEqual({ host: "10.0.0.7", port: 2201, source: "override" })
    expect(cmd.startsWith("bash -c ")).toBe(true)
    expect(cmd).toContain("nbdkit-plugin-vddk")
    expect(timeoutMs).toBeGreaterThan(60_000)
    expect(mockSSH.mock.calls[1][1]).toEqual({ host: "10.0.0.7", port: 2201, source: "override" })
    expect(mockSSH.mock.calls[1][2]).toContain("'/usr/lib/openvddk'/lib64/libvixDiskLib.so")
  })

  it("installs only into OpenVDDK's own directory, whatever the request names, before any SSH", async () => {
    await expect(provisionWarmNode("conn", "pve1", "/usr/lib/vmware-vix-disklib")).rejects.toThrow(/installs OpenVDDK in \/usr\/lib\/openvddk only/)
    await expect(provisionWarmNode("conn", "pve1", "/usr/local/bin")).rejects.toThrow(/only/)
    expect(mockSSH).not.toHaveBeenCalled()
  })

  it("accepts the default directory named explicitly, trailing slash included", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: "" }).mockResolvedValueOnce({ success: true, output: ALL_PRESENT })
    await provisionWarmNode("conn", "pve1", "/usr/lib/openvddk/")
    expect(mockSSH.mock.calls[0][2]).toContain("/usr/lib/openvddk")
  })

  it("throws the script's own reason when it fails, not the apt noise", async () => {
    const apt = Array.from({ length: 40 }, (_, i) => `W: Target Packages (contrib) is configured multiple times ${i}`).join("\n")
    mockSSH.mockResolvedValueOnce({ success: false, error: `${apt}\nproxcenter: /root/kit.tar.gz does not match the SHA-256 ProxCenter pins: nothing was installed.` })
    const err = await provisionWarmNode("conn", "pve1").catch((e: Error) => e)
    expect((err as Error).message).toBe(
      "Warm-migration node provisioning failed on pve1 (10.0.0.7:2201): /root/kit.tar.gz does not match the SHA-256 ProxCenter pins: nothing was installed.",
    )
    expect(mockSSH).toHaveBeenCalledTimes(1)
  })
})

// Found in the lab (roadmap#177): a kit refused for its checksum came back as
// 4,351 characters of apt output with the reason buried in the middle.
describe("provisionFailureDetail", () => {
  const apt = Array.from({ length: 40 }, (_, i) => `W: Target Packages (contrib) is configured multiple times ${i}`).join("\n")

  it("keeps only the script's own reasons when it gave one", () => {
    expect(provisionFailureDetail(`${apt}\nproxcenter: Bad kit: nothing was installed.\n`, "Reading package lists...")).toBe("Bad kit: nothing was installed.")
  })

  it("falls back to the bounded tail of the output, apt warnings left out", () => {
    const out = `${apt}\n${Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")}\nE: Unable to locate package nbdkit-plugin-vddk`
    const d = provisionFailureDetail(undefined, out)
    expect(d).toContain("E: Unable to locate package nbdkit-plugin-vddk")
    expect(d).not.toContain("W: Target Packages")
    expect(d.split("\n").length).toBeLessThanOrEqual(12)
  })

  it("says so when the script printed nothing", () => {
    expect(provisionFailureDetail("", "")).toBe("no output")
  })
})
