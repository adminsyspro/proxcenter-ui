import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ id: "c1", baseUrl: "https://10.42.0.101:8006" })) }))
vi.mock("@/lib/ssh/node-endpoint", () => ({ resolveNodeSshEndpoint: vi.fn(async () => "10.42.0.103") }))

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { installV2vPackages, installVirtV2vBackport, runV2vPreflight } from "./v2v-preflight"
import { virtV2vBackportInstallCommand, virtV2vBackportInstallScript } from "./virt-v2v-backport"
import { virtV2vSupportCommand } from "./warm/guest-conversion"

const ssh = vi.mocked(executeSSH)

/** A node with virt-v2v 2.6.0 from Debian: everything installed, Windows Server 2025 unknown, the backport applies. */
function stockNode(support = "v2v-version=2.6.0\nv2v-probed\nv2v-backport\n") {
  ssh.mockImplementation(async (_conn: string, _ip: string, cmd: string) => {
    if (cmd === `${virtV2vSupportCommand()}; true`) return { success: true, output: support }
    if (cmd.startsWith("df -B1 /tmp")) return { success: true, output: "50000000000" }
    if (cmd.startsWith("df -B1 --output")) return { success: true, output: "" }
    if (cmd.startsWith("which")) return { success: true, output: "/usr/bin/x" }
    return { success: true, output: "yes" }
  })
}

describe("runV2vPreflight: virt-v2v support (#1173)", () => {
  beforeEach(() => { ssh.mockReset() })

  it("reports what the node's virt-v2v knows and whether the backport applies, read-only", async () => {
    stockNode()
    const r = await runV2vPreflight("c1", "pve3", 1)
    expect(r.virtV2v).toEqual({ version: "2.6.0", knows: [], backport: true })
    const call = ssh.mock.calls.find(c => c[2] === `${virtV2vSupportCommand()}; true`)
    expect(call?.[4]).toEqual({ readOnly: true })
  })

  it("leaves it out when virt-v2v is missing: the checklist installs it first", async () => {
    stockNode()
    const base = ssh.getMockImplementation()!
    ssh.mockImplementation(async (conn: string, ip: string, cmd: string, ...rest: any[]) => cmd === "which virt-v2v" ? { success: true, output: "" } : base(conn, ip, cmd, ...rest))
    const r = await runV2vPreflight("c1", "pve3", 1)
    expect(r.virtV2vInstalled).toBe(false)
    expect(r).not.toHaveProperty("virtV2v")
    expect(ssh.mock.calls.some(c => c[2] === `${virtV2vSupportCommand()}; true`)).toBe(false)
  })

  it("probes after the other checks, not alongside them: a twelfth connection at once is dropped by sshd's MaxStartups (lab)", async () => {
    let running = 0
    let peak = 0
    stockNode()
    const base = ssh.getMockImplementation()!
    ssh.mockImplementation(async (...args: any[]) => {
      running++
      peak = Math.max(peak, running)
      await new Promise(r => setTimeout(r, 5))
      try { return await (base as any)(...args) } finally { running-- }
    })
    const r = await runV2vPreflight("c1", "pve3", 1)
    expect(r.virtV2v).toEqual({ version: "2.6.0", knows: [], backport: true })
    expect(peak).toBe(11)
  })
})

describe("installing the backport", () => {
  beforeEach(() => {
    ssh.mockReset()
    ssh.mockResolvedValue({ success: true, output: "" })
  })

  it("comes with the package bundle, after everything else and as a warning only", async () => {
    await installV2vPackages("c1", "pve3")
    const cmd = String(ssh.mock.calls[0][2])
    expect(cmd.startsWith("bash -c ")).toBe(true)
    expect(cmd.endsWith(`echo installed; ${virtV2vBackportInstallScript()}`.replaceAll("'", String.raw`'\''`) + "'")).toBe(true)
  })

  it("runs on its own from the dialog, with a budget for the download", async () => {
    await installVirtV2vBackport("c1", "pve3")
    expect(ssh).toHaveBeenCalledWith("c1", "10.42.0.103", `bash -c ${shellEscape(virtV2vBackportInstallCommand())}`, 10 * 60 * 1000)
  })
})
