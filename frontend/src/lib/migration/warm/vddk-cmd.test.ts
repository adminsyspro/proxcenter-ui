import { describe, it, expect } from "vitest"
import { buildNbdkitVddkCmd } from "./vddk-cmd"

describe("buildNbdkitVddkCmd", () => {
  // Every interpolated value goes through shellEscape (single-quoting): the
  // values originate from DB/SOAP data, and diskPath in particular carries a
  // space + brackets ("[ds] vm/vm.vmdk") that the shell would otherwise split.
  it("builds the validated nbdkit-vddk command with all fields shell-escaped", () => {
    const cmd = buildNbdkitVddkCmd({
      sock: "/tmp/v.sock",
      libdir: "/opt/vddk",
      server: "10.0.0.9",
      user: "root",
      passwordFile: "/tmp/pw",
      thumbprint: "AB:CD",
      moref: "vm-9",
      diskPath: "[ds] vm/vm.vmdk",
    })
    expect(cmd).toContain("nbdkit -r -U '/tmp/v.sock' vddk") // -r: read-only (source disk)
    expect(cmd).toContain("libdir='/opt/vddk'")
    expect(cmd).toContain("server='10.0.0.9'")
    expect(cmd).toContain("user='root'")
    // nbdkit reads the password from a file via the `+FILE` syntax; the `+`
    // stays outside the quotes so the shell hands nbdkit `password=+/tmp/pw`.
    expect(cmd).toContain("password=+'/tmp/pw'")
    expect(cmd).toContain("thumbprint='AB:CD'")
    expect(cmd).toContain("vm=moref='vm-9'")
    // The single quotes keep the space-bearing disk path as one argument.
    expect(cmd).toContain("file='[ds] vm/vm.vmdk'")
  })

  it("appends the snapshot moref when reading a snapshot's logical view (CBT delta read)", () => {
    const cmd = buildNbdkitVddkCmd({
      sock: "/tmp/v.sock", libdir: "/opt/vddk", server: "10.0.0.9", user: "root",
      passwordFile: "/tmp/pw", thumbprint: "AB:CD", moref: "vm-9", diskPath: "[ds] vm/vm.vmdk",
      snapshot: "snapshot-42",
    })
    expect(cmd).toContain("snapshot='snapshot-42'")
    // snapshot= comes before file= (VDDK needs it to resolve the chain)
    expect(cmd.indexOf("snapshot=")).toBeLessThan(cmd.indexOf("file="))
  })

  it("omits the snapshot parameter for a static current-disk read", () => {
    const cmd = buildNbdkitVddkCmd({
      sock: "/tmp/v.sock", libdir: "/opt/vddk", server: "10.0.0.9", user: "root",
      passwordFile: "/tmp/pw", thumbprint: "AB:CD", moref: "vm-9", diskPath: "[ds] vm/vm.vmdk",
    })
    expect(cmd).not.toContain("snapshot=")
  })

  it("quotes a disk path containing single quotes safely", () => {
    const cmd = buildNbdkitVddkCmd({
      sock: "/tmp/v.sock",
      libdir: "/opt/vddk",
      server: "10.0.0.9",
      user: "root",
      passwordFile: "/tmp/pw",
      thumbprint: "AB:CD",
      moref: "vm-9",
      diskPath: "[ds] o'brien/vm.vmdk",
    })
    expect(cmd).toContain("file='[ds] o'\\''brien/vm.vmdk'")
  })
})
