import { describe, it, expect } from "vitest"
import { parseVmConfig } from "./soap"

/** A property collector answer reduced to what parseVmConfig reads for disks. */
function answer(devices: string): string {
  return `<propSet><name>name</name><val>ipva</val></propSet>` +
    `<propSet><name>config.hardware.device</name><val>${devices}</val></propSet>`
}
const ctrl = (type: string, key: number, bus: number) => `<VirtualDevice xsi:type="${type}"><key>${key}</key><busNumber>${bus}</busNumber></VirtualDevice>`
const disk = (key: number, ctrlKey: number, unit: number, label: string) =>
  `<VirtualDevice xsi:type="VirtualDisk"><key>${key}</key><deviceInfo><label>${label}</label></deviceInfo>` +
  `<backing><fileName>[ds] ipva/${label}.vmdk</fileName></backing><controllerKey>${ctrlKey}</controllerKey><unitNumber>${unit}</unitNumber>` +
  `<capacityInBytes>1073741824</capacityInBytes></VirtualDevice>`

describe("parseVmConfig disk bus position", () => {
  it("keeps the controller key and unit number of an IDE disk", () => {
    // The four-disk appliance of the field case: ide0:0, ide0:1, ide1:0, ide1:1.
    const xml = answer(
      ctrl("VirtualIDEController", 200, 0) + ctrl("VirtualIDEController", 201, 1) +
      disk(3000, 200, 0, "hd-boot") + disk(3001, 200, 1, "hd-cf") + disk(3002, 201, 0, "hd-flash") + disk(3003, 201, 1, "hd-dump"),
    )
    const cfg = parseVmConfig(xml)
    expect(cfg.disks.map(d => [d.controllerType, d.controllerKey, d.unitNumber])).toEqual([
      ["ide", 200, 0], ["ide", 200, 1], ["ide", 201, 0], ["ide", 201, 1],
    ])
  })

  it("leaves the position undefined when the answer carries none", () => {
    const xml = answer(ctrl("VirtualLsiLogicController", 1000, 0) +
      `<VirtualDevice xsi:type="VirtualDisk"><key>2000</key><backing><fileName>[ds] vm/vm.vmdk</fileName></backing><capacityInBytes>1</capacityInBytes></VirtualDevice>`)
    const [d] = parseVmConfig(xml).disks
    expect(d.controllerKey).toBeUndefined()
    expect(d.unitNumber).toBeUndefined()
  })
})

describe("parseVmConfig CBT state", () => {
  const withCbt = (val: string) => answer("") + `<propSet><name>config.changeTrackingEnabled</name><val xsi:type="xsd:boolean">${val}</val></propSet>`

  it("reports CBT the customer already enabled, so a warm job leaves it on (roadmap#57)", () => {
    expect(parseVmConfig(withCbt("true")).changeTrackingEnabled).toBe(true)
  })

  it("reports CBT off, so a warm job that enables it switches it back off", () => {
    expect(parseVmConfig(withCbt("false")).changeTrackingEnabled).toBe(false)
  })

  it("leaves the state unknown when vSphere does not return it", () => {
    expect(parseVmConfig(answer("")).changeTrackingEnabled).toBeUndefined()
  })
})

describe("parseVmConfig NICs (#317)", () => {
  const nic = (type: string, label: string, mac: string, net: string) =>
    `<VirtualDevice xsi:type="Virtual${type}"><key>4000</key><deviceInfo><label>${label}</label><summary>${net}</summary></deviceInfo><macAddress>${mac}</macAddress></VirtualDevice>`

  it("keeps the adapters in device order whatever their model", () => {
    const cfg = parseVmConfig(answer(
      nic("E1000", "Network adapter 1", "00:50:56:aa:00:01", "VM Network") +
      nic("Vmxnet3", "Network adapter 2", "00:50:56:aa:00:02", "dmz") +
      nic("E1000e", "Network adapter 3", "00:50:56:aa:00:03", "backup"),
    ))
    expect(cfg.nics).toEqual([
      { label: "Network adapter 1", type: "E1000", macAddress: "00:50:56:aa:00:01", network: "VM Network" },
      { label: "Network adapter 2", type: "Vmxnet3", macAddress: "00:50:56:aa:00:02", network: "dmz" },
      { label: "Network adapter 3", type: "E1000e", macAddress: "00:50:56:aa:00:03", network: "backup" },
    ])
  })
})

describe("parseVmConfig vTPM (roadmap#1)", () => {
  it("flags a source that carries a VirtualTPM device", () => {
    const tpm = `<VirtualDevice xsi:type="VirtualTPM"><key>11000</key><deviceInfo><label>Trusted Platform Module</label></deviceInfo></VirtualDevice>`
    expect(parseVmConfig(answer(ctrl("VirtualLsiLogicController", 1000, 0) + tpm)).hasVtpm).toBe(true)
    expect(parseVmConfig(answer(ctrl("VirtualLsiLogicController", 1000, 0))).hasVtpm).toBe(false)
  })
})

