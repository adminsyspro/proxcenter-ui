import { describe, expect, it } from "vitest"

import {
  NTFS_COMPRESSION_PLUGIN_FILE,
  NTFS_COMPRESSION_PLUGIN_URL,
  NTFS_COMPRESSION_SUPERMIN_TARBALL,
  ntfsCompressionPluginCheckCommand,
  ntfsCompressionPluginInstallScript,
} from "./ntfs-compression-plugin"

describe("ntfs-3g system-compression plugin scripts", () => {
  it("checks both the plugin file and the supermin.d tarball", () => {
    const cmd = ntfsCompressionPluginCheckCommand()
    expect(cmd).toContain(`/usr/lib/*/ntfs-3g/${NTFS_COMPRESSION_PLUGIN_FILE}`)
    expect(cmd).toContain("/usr/lib/*/guestfs/supermin.d")
    expect(cmd).toContain(NTFS_COMPRESSION_SUPERMIN_TARBALL)
    expect(cmd).toMatch(/echo yes; else echo no/)
  })

  it("pins the upstream release and builds against ntfs-3g's own plugin directory", () => {
    const script = ntfsCompressionPluginInstallScript()
    expect(NTFS_COMPRESSION_PLUGIN_URL).toMatch(/^https:\/\/github\.com\/ebiggers\/ntfs-3g-system-compression\/archive\/refs\/tags\/v\d+\.\d+\.tar\.gz$/)
    expect(script).toContain(NTFS_COMPRESSION_PLUGIN_URL)
    expect(script).toContain("ntfs-3g-dev")
    expect(script).toContain("strings $(command -v ntfs-3g) | grep ntfs-plugin || true")
    expect(script).toContain('./configure --libdir="$LIBDIR"')
  })

  it("is idempotent: skips the build when the plugin exists and the tarball when registered", () => {
    const script = ntfsCompressionPluginInstallScript()
    expect(script).toMatch(/^set -eo pipefail; /)
    // Under pipefail a no-match `ls` would abort the script on the very case it
    // handles (plugin absent): every exploratory lookup is guarded.
    expect(script).toContain(`PLUGIN=$( (ls /usr/lib/*/ntfs-3g/${NTFS_COMPRESSION_PLUGIN_FILE} 2>/dev/null || true) | head -1)`)
    expect(script).toContain("SD=$( (ls -d /usr/lib/*/guestfs/supermin.d 2>/dev/null || true) | head -1)")
    expect(script).toContain('if [ -z "$PLUGIN" ]; then')
    expect(script).toContain(`if [ ! -f "$SD/${NTFS_COMPRESSION_SUPERMIN_TARBALL}" ]; then`)
  })

  it("registers the plugin with supermin and drops the cached appliance", () => {
    const script = ntfsCompressionPluginInstallScript()
    expect(script).toContain(`tar czf "$SD/${NTFS_COMPRESSION_SUPERMIN_TARBALL}" -C / "\${PLUGIN#/}"`)
    expect(script).toContain("rm -rf /var/tmp/.guestfs-*/appliance.d")
    expect(script).toContain("supermin.d not found")
    expect(script.trim().endsWith("echo installed")).toBe(true)
  })
})
