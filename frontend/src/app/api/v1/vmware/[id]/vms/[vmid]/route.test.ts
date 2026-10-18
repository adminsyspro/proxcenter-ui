/**
 * Tests for GET /api/v1/vmware/[id]/vms/[vmid] — the per-VM detail the migrate
 * dialog reads. Focused on the VirtualDisk parse loop: diskMode and sharing
 * feed the client-side CBT-eligibility check (warm-migration fallback warning),
 * so their extraction must survive refactors. The SOAP transport is mocked; the
 * pure XML parsers (extractProp) stay real so the fixture exercises the actual
 * parsing path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  soapText: "",
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "root:pass") }))
vi.mock("@/lib/vmware/soap", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/vmware/soap")>()
  return {
    ...actual,
    soapLogin: vi.fn(async () => ({
      baseUrl: "https://esxi/sdk", cookie: "c", insecureTLS: true,
      propertyCollector: "ha-property-collector", isVcenter: false,
    })),
    soapLogout: vi.fn(async () => {}),
    soapRequest: vi.fn(async () => ({ text: h.soapText })),
    soapResolveHostInventoryPaths: vi.fn(async () => new Map()),
  }
})

import { GET } from "./route"
import { parseVmConfig, soapLogin } from "@/lib/vmware/soap"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const prop = (name: string, val: string) => `<propSet><name>${name}</name><val xsi:type="x">${val}</val></propSet>`

/** RetrievePropertiesEx response with three disks covering the diskMode/sharing matrix. */
function vmXml(): string {
  const devices =
    `<VirtualDevice xsi:type="VirtualDisk"><label>Hard disk 1</label><capacityInBytes>10737418240</capacityInBytes>` +
    `<fileName>[ds1] web/web.vmdk</fileName><thinProvisioned>true</thinProvisioned>` +
    `<diskMode>persistent</diskMode><sharing>sharingNone</sharing></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualDisk"><label>Hard disk 2</label><capacityInBytes>2147483648</capacityInBytes>` +
    `<fileName>[ds1] web/web_1.vmdk</fileName>` +
    `<diskMode>independent_persistent</diskMode><sharing>sharingMultiWriter</sharing></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualDisk"><label>Hard disk 3</label><capacityInKB>1024</capacityInKB>` +
    `<fileName>[ds1] web/web_2.vmdk</fileName></VirtualDevice>`
  return [
    prop("name", "web-01"),
    prop("config.version", "vmx-13"),
    prop("config.hardware.numCPU", "2"),
    prop("config.hardware.memoryMB", "4096"),
    prop("runtime.powerState", "poweredOn"),
    prop("snapshot", `<currentSnapshot type="VirtualMachineSnapshot">snap-1</currentSnapshot><rootSnapshotList><snapshot type="VirtualMachineSnapshot">snap-1</snapshot></rootSnapshotList>`),
    prop("config.hardware.device", devices),
  ].join("")
}

beforeEach(() => {
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({
    id: "conn-1", name: "esxi-lab", baseUrl: "https://esxi", apiTokenEnc: "enc",
    insecureTLS: true, type: "vmware", subType: null, vmwareDatacenter: null,
  })
  h.soapText = vmXml()
})

describe("GET /api/v1/vmware/[id]/vms/[vmid] — disk parsing", () => {
  it("extracts diskMode and sharing for each VirtualDisk", async () => {
    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "42" } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body?.data?.disks).toEqual([
      {
        label: "Hard disk 1", capacityBytes: 10737418240, fileName: "[ds1] web/web.vmdk",
        thinProvisioned: true, diskMode: "persistent", sharing: "sharingNone",
      },
      {
        label: "Hard disk 2", capacityBytes: 2147483648, fileName: "[ds1] web/web_1.vmdk",
        thinProvisioned: false, diskMode: "independent_persistent", sharing: "sharingMultiWriter",
      },
      // disks whose XML carries no diskMode/sharing degrade to empty strings
      {
        label: "Hard disk 3", capacityBytes: 1024 * 1024, fileName: "[ds1] web/web_2.vmdk",
        thinProvisioned: false, diskMode: "", sharing: "",
      },
    ])
  })

  it("surfaces vmxVersion and snapshotCount alongside the disks (fallback-warning inputs)", async () => {
    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "42" } })
    const body = await readJson<any>(res)
    expect(body?.data?.vmxVersion).toBe("vmx-13")
    expect(body?.data?.snapshotCount).toBe(1)
  })

  it("404s on a non-VMware connection", async () => {
    h.prisma.connection.findUnique.mockResolvedValue({ id: "conn-1", type: "pve" })
    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "42" } })
    expect(res.status).toBe(404)
  })
})

describe("GET /api/v1/vmware/[id]/vms/[vmid]: source disks for the review step (#317 lot 2)", () => {
  // The pipelines map the review step's per-disk choices by position in
  // parseVmConfig(...).disks, so this route must list the same disks in the
  // same order. Disks interleaved with other devices and labelled against
  // document order, so a sort by label or key would show.
  const devices =
    `<VirtualDevice xsi:type="VirtualLsiLogicController"><key>1000</key><deviceInfo><label>SCSI controller 0</label></deviceInfo></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualDisk"><key>2001</key><deviceInfo><label>Hard disk 2</label></deviceInfo><backing><fileName>[ds1] web/web_1.vmdk</fileName><diskMode>persistent</diskMode></backing><controllerKey>1000</controllerKey><unitNumber>1</unitNumber><capacityInBytes>2147483648</capacityInBytes></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualVmxnet3"><key>4000</key><deviceInfo><label>Network adapter 1</label><summary>VM Network</summary></deviceInfo><macAddress>00:50:56:aa:00:01</macAddress></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualDisk"><key>2000</key><deviceInfo><label>Hard disk 1</label></deviceInfo><backing><fileName>[ds1] web/web.vmdk</fileName><diskMode>persistent</diskMode></backing><controllerKey>1000</controllerKey><unitNumber>0</unitNumber><capacityInBytes>10737418240</capacityInBytes></VirtualDevice>` +
    `<VirtualDevice xsi:type="VirtualCdrom"><key>3002</key><deviceInfo><label>CD/DVD drive 1</label></deviceInfo></VirtualDevice>`
  const xml = [prop("name", "web-01"), prop("config.hardware.numCPU", "2"), prop("config.hardware.device", devices)].join("")
  const shape = (d: { label: string; capacityBytes: number; fileName: string }) => ({ label: d.label, capacityBytes: d.capacityBytes, fileName: d.fileName })

  it.each([["ESXi", false], ["vCenter", true]])("lists the disks in the order parseVmConfig indexes them (%s session)", async (_name, isVcenter) => {
    h.soapText = xml
    vi.mocked(soapLogin).mockResolvedValueOnce({ baseUrl: "https://vc/sdk", cookie: "c", insecureTLS: true, propertyCollector: "propertyCollector", isVcenter } as any)
    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-42" } })
    expect(res.status).toBe(200)
    const data = (await readJson<any>(res)).data
    const expected = parseVmConfig(xml).disks.map(shape)
    expect(expected.map(d => d.label)).toEqual(["Hard disk 2", "Hard disk 1"])
    expect(data.disks.map(shape)).toEqual(expected)
  })
})

describe("GET /api/v1/vmware/[id]/vms/[vmid]: source NICs for the review step (#317)", () => {
  it("returns nics in device order with label, type, MAC and vSphere network", async () => {
    const devices =
      `<VirtualDevice xsi:type="VirtualE1000"><deviceInfo><label>Network adapter 1</label><summary>VM Network</summary></deviceInfo><macAddress>00:50:56:aa:00:01</macAddress></VirtualDevice>` +
      `<VirtualDevice xsi:type="VirtualDisk"><label>Hard disk 1</label><capacityInBytes>1</capacityInBytes><fileName>[ds1] a/a.vmdk</fileName></VirtualDevice>` +
      `<VirtualDevice xsi:type="VirtualVmxnet3"><deviceInfo><label>Network adapter 2</label><summary>i317-net</summary></deviceInfo><macAddress>00:50:56:aa:00:02</macAddress></VirtualDevice>`
    h.soapText = [prop("name", "web-01"), prop("config.hardware.numCPU", "2"), prop("config.hardware.device", devices)].join("")
    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "42" } })
    expect(res.status).toBe(200)
    const data = (await readJson<any>(res)).data
    expect(data.nics).toEqual([
      { label: "Network adapter 1", type: "E1000", macAddress: "00:50:56:aa:00:01", network: "VM Network" },
      { label: "Network adapter 2", type: "Vmxnet3", macAddress: "00:50:56:aa:00:02", network: "i317-net" },
    ])
  })
})
