import { execFileSync } from "node:child_process"
import { describe, it, expect } from "vitest"
import { VIRT_V2V_BACKPORT, virtV2vBackportInstallCommand, virtV2vBackportInstallScript, virtV2vBackportProbe } from "./virt-v2v-backport"

describe("virt-v2v backport (Windows Server 2025 on PVE 9, #1173)", () => {
  it("pins the published package by version and SHA-256", () => {
    expect(VIRT_V2V_BACKPORT.version).toBe("2.6.0-1+deb13u1~proxcenter1")
    expect(VIRT_V2V_BACKPORT.url).toBe("https://github.com/adminsyspro/virt-v2v-pve/releases/download/v2.6.0-proxcenter1/virt-v2v_2.6.0-1%2Bdeb13u1.proxcenter1_amd64.deb")
    expect(VIRT_V2V_BACKPORT.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("offers it only to a Debian 13 amd64 node whose older virt-v2v lacks Windows Server 2025", () => {
    const probe = virtV2vBackportProbe()
    expect(probe).toContain(`( . /etc/os-release && [ "$VERSION_CODENAME" = trixie ] )`)
    expect(probe).toContain(`[ "$(dpkg --print-architecture)" = amd64 ]`)
    expect(probe).toContain("! grep -aqF 2k25 /usr/bin/virt-v2v-in-place")
    // Never over a Debian stable update, which sorts above it.
    expect(probe).toContain(`dpkg --compare-versions "$(dpkg-query -W -f='\${Version}' virt-v2v 2>/dev/null)" lt "2.6.0-1+deb13u1~proxcenter1"`)
    expect(probe.endsWith("&& echo v2v-backport")).toBe(true)
  })

  it("installs only a download whose checksum matches, and warns instead of failing the whole install", () => {
    const script = virtV2vBackportInstallScript()
    const download = script.indexOf("wget -q -O")
    const check = script.indexOf(`echo '${VIRT_V2V_BACKPORT.sha256}  '"$T/virt-v2v.deb" | sha256sum -c --quiet`)
    const install = script.indexOf(`apt-get install -y "$T/virt-v2v.deb"`)
    expect(download).toBeGreaterThan(0)
    expect(check).toBeGreaterThan(download)
    expect(install).toBeGreaterThan(check)
    expect(script.startsWith(`if ${virtV2vBackportProbe().replace(" && echo v2v-backport", "")}; then `)).toBe(true)
    expect(script).toContain(`else echo "WARNING: virt-v2v 2.6.0-1+deb13u1~proxcenter1 (Windows Server 2025 support) could not be installed from ${VIRT_V2V_BACKPORT.url}"; fi`)
    expect(script).not.toMatch(/\bexit\b/)
  })

  it("has the dedicated install fail unless the binary then knows Windows Server 2025", () => {
    expect(virtV2vBackportInstallCommand()).toBe(`${virtV2vBackportInstallScript()}; grep -aqF 2k25 /usr/bin/virt-v2v-in-place`)
  })

  it("is valid bash, also under set -e as installV2vPackages runs it", () => {
    for (const script of [virtV2vBackportProbe(), virtV2vBackportInstallCommand(), `set -eo pipefail; ${virtV2vBackportInstallScript()}; echo done`]) {
      expect(() => execFileSync("bash", ["-n", "-c", script])).not.toThrow()
    }
  })
})
