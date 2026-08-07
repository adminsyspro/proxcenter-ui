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
