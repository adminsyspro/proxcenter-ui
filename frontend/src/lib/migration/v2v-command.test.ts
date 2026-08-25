import { describe, it, expect } from "vitest"

import { __buildV2vCommandForTest as buildV2vCommand } from "./v2v-pipeline"

/**
 * The flags virt-v2v receives are a contract, and `--root` is the one that
 * decides whether the conversion can run unattended (#738): without it virt-v2v
 * falls back to its interactive default and dies on a closed stdin.
 */

const base = {
  sourceConnectionId: "src",
  sourceVmId: "vm-1",
  sourceVmName: "NginX",
  targetConnectionId: "tgt",
  targetNode: "pve1",
  targetStorage: "local",
  networkBridge: "vmbr0",
  startAfterMigration: false,
  tempStorage: "/var/lib/vz",
} as any

/** Same argument order as the pipeline uses. */
function build(config: any, opts: {
  supportsBlockDriver?: boolean
  disks?: string[]
  xml?: string
  root?: string
  outputDirOverride?: string
} = {}) {
  return buildV2vCommand(
    "job-1",
    config,
    "administrator@vsphere.local",
    "vc.example.test",
    opts.supportsBlockDriver ?? true,
    opts.disks,
    opts.xml,
    opts.root,
    opts.outputDirOverride,
  )
}

const vcenter = { ...base, sourceType: "vcenter", vcenterDatacenter: "DC", vcenterHost: "esxi1" }

describe("buildV2vCommand root handling", () => {
  it("omits --root entirely when no root is given", () => {
    // the nominal single-root guest must keep today's command, byte for byte
    const cmd = build(vcenter)
    expect(cmd).not.toContain("--root")
    expect(cmd).toContain("-o local -os")
  })

  it("puts --root first, before the other options", () => {
    const cmd = build(vcenter, { root: "/dev/system/root" })
    expect(cmd).toContain("--root '/dev/system/root' --block-driver virtio-scsi -o local")
  })

  it("shell-escapes the root value", () => {
    // parsed out of virt-v2v output, so quoting is not optional
    const cmd = build(vcenter, { root: "btrfsvol:/dev/system/root/@/.snapshots/328/snapshot" })
    expect(cmd).toContain("--root 'btrfsvol:/dev/system/root/@/.snapshots/328/snapshot'")
  })

  it("drops a root that does not look like a device name", () => {
    // defence in depth: the route allowlists, the builder still refuses junk
    const cmd = build(vcenter, { root: "/dev/sda1; reboot" })
    expect(cmd).not.toContain("--root")
    expect(cmd).not.toContain("reboot")
  })

  it("keeps --root when --block-driver is unsupported", () => {
    const cmd = build(vcenter, { root: "/dev/sda1", supportsBlockDriver: false })
    expect(cmd).toContain("--root '/dev/sda1' -o local")
    expect(cmd).not.toContain("--block-driver")
  })
})

describe("buildV2vCommand carries --root on every input path", () => {
  it("single pre-downloaded disk (-i disk)", () => {
    const cmd = build(vcenter, { disks: ["/var/lib/vz/v2v-job-1/disk-0.vmdk"], root: "/dev/sda" })
    expect(cmd).toContain("virt-v2v -i disk '/var/lib/vz/v2v-job-1/disk-0.vmdk'")
    expect(cmd).toContain("--root '/dev/sda'")
  })

  it("multi-disk NFC path (-i libvirtxml)", () => {
    const cmd = build(vcenter, {
      disks: ["/tmp/a.vmdk", "/tmp/b.vmdk"],
      xml: "/var/lib/vz/v2v-job-1/vm.xml",
      root: "/dev/sdb",
    })
    expect(cmd).toContain("virt-v2v -i libvirtxml '/var/lib/vz/v2v-job-1/vm.xml'")
    expect(cmd).toContain("--root '/dev/sdb'")
  })

  it("rejects the multi-disk path without a written domain XML", () => {
    expect(() => build(vcenter, { disks: ["/tmp/a.vmdk", "/tmp/b.vmdk"] }))
      .toThrow(/libvirt domain XML/i)
  })

  it("vCenter over vpx://", () => {
    const cmd = build(vcenter, { root: "/dev/system/root" })
    expect(cmd).toContain("virt-v2v -ic 'vpx://administrator%40vsphere.local@vc.example.test/DC/host/esxi1?no_verify=1'")
    expect(cmd).toContain("--root '/dev/system/root'")
  })

  it("vCenter inside a cluster keeps the cluster segment", () => {
    const cmd = build({ ...vcenter, vcenterCluster: "CL 1" }, { root: "/dev/sda2" })
    expect(cmd).toContain("/DC/host/CL%201/esxi1")
  })

  it("reports which vCenter field is missing", () => {
    expect(() => build({ ...vcenter, vcenterHost: undefined })).toThrow(/vcenterHost/)
  })

  it("Hyper-V in disk mode", () => {
    const cmd = build({ ...base, sourceType: "hyperv", diskPaths: ["/mnt/hyperv/vm.vhdx"] }, { root: "/dev/sda1" })
    expect(cmd).toContain("virt-v2v -i disk '/mnt/hyperv/vm.vhdx'")
    expect(cmd).toContain("--root '/dev/sda1'")
  })

  it("Hyper-V over the network", () => {
    const cmd = build({ ...base, sourceType: "hyperv" }, { root: "/dev/sda1" })
    expect(cmd).toContain("virt-v2v -ic 'hyperv://")
    expect(cmd).toContain("--root '/dev/sda1'")
  })

  it("Nutanix requires disk paths", () => {
    expect(() => build({ ...base, sourceType: "nutanix" })).toThrow(/diskPaths/)
  })

  it("Nutanix in disk mode", () => {
    const cmd = build({ ...base, sourceType: "nutanix", diskPaths: ["/tmp/ntx-1.qcow2"] }, { root: "/dev/vda1" })
    expect(cmd).toContain("--root '/dev/vda1'")
  })

  it("direct ESXi over ssh keeps its env prefix and gets --root", () => {
    const cmd = build(
      { ...base, sourceType: "esxi-direct", vmxPath: "/vmfs/volumes/Datastore (1)/VM/VM.vmx", esxiHost: "esxi.example.test" },
      { root: "/dev/sda1" },
    )
    expect(cmd).toMatch(/^env HOME=.*SSH_AUTH_SOCK=.*virt-v2v -v -x -i vmx -it ssh /)
    expect(cmd).toContain("Datastore%20(1)")
    expect(cmd).toContain("--root '/dev/sda1'")
  })

  it("refuses an unknown source type", () => {
    expect(() => build({ ...base, sourceType: "kvm" })).toThrow(/Unsupported source type/)
  })
})

/**
 * Direct storage write (#292): with the override the conversion lands as qcow2
 * in a staging dir on the target storage, so Phase 6 can adopt it by rename.
 * Without it the command must stay byte for byte the legacy one — the
 * block-storage path feeds that raw output to `qemu-img convert -n`.
 */
describe("buildV2vCommand direct storage write (#292)", () => {
  const stagingDir = "/mnt/pve/nfs-vmstore/proxcenter-v2v/job-1"

  it("converts to qcow2 straight into the staging dir when the override is set", () => {
    const cmd = build(vcenter, { outputDirOverride: stagingDir })
    expect(cmd).toContain(`-of qcow2 -o local -os '${stagingDir}' --machine-readable`)
    // and the temp-storage output dir is nowhere on the command line
    expect(cmd).not.toContain("/var/lib/vz/v2v-job-1")
  })

  it("keeps the option order stable around --root and --block-driver", () => {
    const cmd = build(vcenter, { root: "/dev/system/root", outputDirOverride: stagingDir })
    expect(cmd).toContain("--root '/dev/system/root' --block-driver virtio-scsi -of qcow2 -o local")
  })

  it("applies the override on the pre-downloaded disk path too", () => {
    const cmd = build(vcenter, { disks: ["/var/lib/vz/v2v-job-1/disk-0.vmdk"], outputDirOverride: stagingDir })
    // the source VMDK stays on the temp storage, only the output moves
    expect(cmd).toContain("virt-v2v -i disk '/var/lib/vz/v2v-job-1/disk-0.vmdk'")
    expect(cmd).toContain(`-of qcow2 -o local -os '${stagingDir}'`)
  })

  it("keeps today's raw command, byte for byte, without the override", () => {
    const cmd = build(vcenter)
    // no -of: the block-storage path expects virt-v2v's raw output
    expect(cmd).not.toContain("-of ")
    expect(cmd).not.toContain("proxcenter-v2v")
    expect(cmd).toContain("--block-driver virtio-scsi -o local -os '/var/lib/vz/v2v-job-1' --machine-readable")
  })
})
