// Which address the warm copy goes through (roadmap#53).
//
// The VDDK's NBD transport reads the source disks over NFC from the ESXi host.
// Two topologies:
//   - standalone ESXi source: the VDDK is given the host itself (`server=`), so
//     pointing it at the address of a given VMkernel adapter is enough to move
//     the whole exchange (API on 443, data on 902) onto that adapter;
//   - vCenter source: `server=` must stay the vCenter (the credentials are
//     vCenter's, and the VM is addressed by its vCenter moref). vCenter then
//     hands out an NFC ticket naming the host address to connect to, and that
//     address is the host's vSphereBackupNFC-tagged adapter when there is one,
//     the management adapter otherwise. The operator's choice is therefore
//     applied by tagging the adapter on the host (HostVirtualNicManager).
// In both cases the node must reach the resulting address on 902, which the
// pipeline probes before anything is allocated (nfc-reachability).

import type { SoapSession } from "@/lib/vmware/soap"
import {
  BACKUP_NFC_NIC_TYPE, planBackupNfcTag, soapDeselectVnicForNicType, soapGetHostCopyInterfaces, soapGetVmHostMor,
  soapSelectVnicForNicType, type HostCopyInterfaces, type HostVmkernelNic,
} from "@/lib/vmware/vmkernel"

export interface CopyPath {
  /** Value of the VDDK `server=` parameter. */
  server: string
  /** Host address the NFC data connection lands on; what the node must reach on 902. */
  nfcAddress: string
  /** Adapter the copy uses, when it could be resolved. */
  device?: string
  /** Operator-facing description, e.g. "vmk2 10.42.53.21 (vSphereBackupNFC) on 10.42.0.21". */
  label: string
  /** True when the VDDK talks to the host directly, so 443 must be reachable at nfcAddress too. */
  direct: boolean
  /** Tag changes applied on the host, for the job log. */
  hostChanges: string[]
}

export interface CopyPathDeps {
  getHostInterfaces: (session: SoapSession, vmid: string) => Promise<HostCopyInterfaces>
  selectVnic: (session: SoapSession, managerMor: string, nicType: string, device: string) => Promise<void>
  deselectVnic: (session: SoapSession, managerMor: string, nicType: string, device: string) => Promise<void>
}

const defaultDeps: CopyPathDeps = {
  getHostInterfaces: async (session, vmid) => soapGetHostCopyInterfaces(session, await soapGetVmHostMor(session, vmid)),
  selectVnic: soapSelectVnicForNicType,
  deselectVnic: soapDeselectVnicForNicType,
}

export function describeVnic(v: HostVmkernelNic, hostName: string): string {
  const tags = v.services.length ? ` (${v.services.join(", ")})` : ""
  return `${v.device} ${v.address || "no address"}${tags} on ${hostName}`
}

/**
 * Resolve the copy path of a warm job. `chosen` is the operator's adapter from
 * the job config; absent means the host default. Never changes the host unless
 * the operator chose an adapter explicitly. When the host's adapters cannot be
 * read and nothing was chosen, falls back to the connection's own address, the
 * behaviour before roadmap#53.
 */
export async function resolveCopyPath(a: {
  session: SoapSession
  vmid: string
  /** Address of the source connection: the ESXi host, or the vCenter. */
  connectionHost: string
  chosen?: { device: string; address?: string }
  log: (msg: string, level?: "info" | "warn") => Promise<void>
  deps?: Partial<CopyPathDeps>
}): Promise<CopyPath> {
  const deps = { ...defaultDeps, ...a.deps }
  const direct = !a.session.isVcenter
  let ifaces: HostCopyInterfaces
  try {
    ifaces = await deps.getHostInterfaces(a.session, a.vmid)
  } catch (e: any) {
    if (a.chosen) throw new Error(`Could not read the VMkernel adapters of the source host to use ${a.chosen.device}: ${e?.message || e}`)
    await a.log(`Could not read the VMkernel adapters of the source host (${e?.message || e}); the copy uses the connection address ${a.connectionHost}`, "warn")
    return { server: a.connectionHost, nfcAddress: a.connectionHost, label: a.connectionHost, direct, hostChanges: [] }
  }

  // A standalone ESXi reports "localhost.localdomain" unless it was named: say the address instead.
  if (/^localhost(\.localdomain)?$/i.test(ifaces.hostName)) ifaces = { ...ifaces, hostName: a.connectionHost }
  const device = a.chosen?.device ?? ifaces.defaultDevice
  const vnic = device ? ifaces.vnics.find(v => v.device === device) : undefined
  if (a.chosen && !vnic) {
    throw new Error(`VMkernel adapter ${a.chosen.device} no longer exists on ${ifaces.hostName}; pick another adapter for the copy`)
  }
  if (!vnic?.address) {
    if (a.chosen) throw new Error(`VMkernel adapter ${a.chosen.device} on ${ifaces.hostName} has no IPv4 address; pick another adapter for the copy`)
    await a.log(`The source host ${ifaces.hostName} reports no addressed VMkernel adapter; the copy uses the connection address ${a.connectionHost}`, "warn")
    return { server: a.connectionHost, nfcAddress: a.connectionHost, label: a.connectionHost, direct, hostChanges: [] }
  }
  if (a.chosen?.address && a.chosen.address !== vnic.address) {
    await a.log(`VMkernel adapter ${vnic.device} on ${ifaces.hostName} now has address ${vnic.address} (the job was configured with ${a.chosen.address}); using the live address`, "warn")
  }

  const hostChanges: string[] = []
  if (!direct && a.chosen) {
    // vCenter: the ticket follows the host's vSphereBackupNFC tag, so the choice
    // is applied there. Nothing to do when the adapter already carries it, or
    // when management was chosen and no other adapter is tagged.
    const plan = planBackupNfcTag(ifaces, vnic.device)
    for (const d of plan.deselect) {
      await deps.deselectVnic(a.session, ifaces.virtualNicManagerMor, BACKUP_NFC_NIC_TYPE, d)
      hostChanges.push(`removed the ${BACKUP_NFC_NIC_TYPE} tag from ${d}`)
    }
    if (plan.select) {
      await deps.selectVnic(a.session, ifaces.virtualNicManagerMor, BACKUP_NFC_NIC_TYPE, plan.select)
      hostChanges.push(`tagged ${plan.select} ${BACKUP_NFC_NIC_TYPE}`)
    }
  }
  const services = hostChanges.length
    ? [...new Set([...vnic.services.filter(s => s !== BACKUP_NFC_NIC_TYPE), ...(hostChanges.some(c => c.startsWith("tagged")) ? [BACKUP_NFC_NIC_TYPE] : [])])]
    : vnic.services
  return {
    server: direct ? vnic.address : a.connectionHost,
    nfcAddress: vnic.address,
    device: vnic.device,
    label: describeVnic({ ...vnic, services }, ifaces.hostName),
    direct,
    hostChanges,
  }
}
