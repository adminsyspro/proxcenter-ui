/**
 * The NIC rights a tenant user needs for a migration (ui#1330, ui#1333): a
 * custom MAC needs vm.config.nic.mac, a VLAN tag from the bulk network table
 * vm.config.nic.vlan, as when set by hand. Real nicPermissions, unlike
 * authorize.test.ts.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(), getCurrentRbacInfraScope: vi.fn(), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_MANAGE: "connection.manage" } }))
vi.mock("@/lib/tenant/infraScope", () => ({ getTenantInfrastructureScope: async () => ({ kind: "provider" }), canMigrateConnections: () => true }))

import { migrationNicPermissions } from "./authorize"

const base = { tenantId: "t1", targetConnectionId: "tgt", targetNode: "pve1", targetVmid: undefined, networkBridge: "vmbr0", vlanTag: undefined }
const perms = (extra: Record<string, unknown>) => migrationNicPermissions({ ...base, ...extra } as any).map(n => n.permission).sort((a, b) => a.localeCompare(b))

describe("migrationNicPermissions", () => {
  it("needs nothing for plain bridges, a regenerated MAC included", () => {
    expect(perms({ nics: [{ index: 0, bridge: "vmbr1", macMode: "regenerate" }], networkMap: [{ source: "LAN", bridge: "vmbr2" }] })).toEqual([])
  })

  it("needs the MAC right for a custom MAC", () => {
    expect(perms({ nics: [{ index: 0, bridge: "vmbr1", macMode: "custom", mac: "BC:24:11:00:00:01" }] })).toEqual(["vm.config.nic.mac"])
  })

  it("needs the VLAN right for a tag in the network table", () => {
    expect(perms({ networkMap: [{ source: "DMZ", bridge: "vmbr2", vlanTag: 30 }] })).toEqual(["vm.config.nic.vlan"])
  })

  it("needs nothing in the provider tenant", () => {
    expect(migrationNicPermissions({ ...base, tenantId: "default", networkMap: [{ source: "DMZ", bridge: "vmbr2", vlanTag: 30 }] } as any)).toEqual([])
  })
})
