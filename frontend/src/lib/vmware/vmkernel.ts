// VMkernel adapters of the ESXi host a VM runs on, and the service tags they
// carry (roadmap#53). The warm engine reads the source disks over NFC (VDDK NBD
// transport), and that traffic normally lands on the host's management adapter.
// A host can carry a VMkernel adapter tagged `vSphereBackupNFC`: vSphere then
// hands out NFC tickets on that adapter instead, which is how backup vendors
// keep their copies off the management network. This module lists the adapters
// and their tags so the operator can see, and choose, which one the copy uses.

import type { SoapSession } from "./soap"
import { soapRequest, extractProp, describeSoapFault } from "./soap"

/** The vSphere NIC type that pins NBD backup traffic to an adapter. */
export const BACKUP_NFC_NIC_TYPE = "vSphereBackupNFC"
export const MANAGEMENT_NIC_TYPE = "management"

export interface HostVmkernelNic {
  /** Adapter device name, e.g. "vmk0". */
  device: string
  /** vSphere key of the adapter, e.g. "key-vim.host.VirtualNic-vmk0". */
  key: string
  /** IPv4 address; empty when the adapter has none (IPv6-only or unconfigured). */
  address: string
  subnetMask?: string
  /** Port group (standard switch) or DVS port label the adapter sits on. */
  portgroup?: string
  mac?: string
  mtu?: number
  /** Service tags selected on this adapter: management, vmotion, vsan, vSphereBackupNFC, ... */
  services: string[]
}

export interface HostCopyInterfaces {
  hostMor: string
  hostName: string
  /** HostVirtualNicManager of the host, needed to change the tags. */
  virtualNicManagerMor: string
  vnics: HostVmkernelNic[]
  /**
   * Device the copy will use by default: the adapter tagged vSphereBackupNFC
   * when one exists, otherwise the management adapter, otherwise the first one.
   * Undefined when the host has no adapter with an address.
   */
  defaultDevice?: string
}

const ENV = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`

const text = (xml: string, tag: string): string | undefined => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]

/**
 * Parse the `config.network.vnic` value (an ArrayOfHostVirtualNic) into the
 * adapters, without service tags yet. Each HostVirtualNic carries its device,
 * key, portgroup and an IP spec. A DVS-backed adapter has no `portgroup`; its
 * `distributedVirtualPort` is reported as the port group label instead.
 */
export function parseHostVnics(vnicXml: string): Array<Omit<HostVmkernelNic, "services">> {
  const out: Array<Omit<HostVmkernelNic, "services">> = []
  const parts = vnicXml.split(/<HostVirtualNic[\s>]/).slice(1)
  for (const p of parts) {
    const device = text(p, "device")
    if (!device) continue
    const ip = /<ip>([\s\S]*?)<\/ip>/.exec(p)?.[1] ?? ""
    const mtu = Number(text(p, "mtu"))
    out.push({
      device,
      key: text(p, "key") ?? `key-vim.host.VirtualNic-${device}`,
      address: text(ip, "ipAddress") ?? "",
      subnetMask: text(ip, "subnetMask") || undefined,
      portgroup: text(p, "portgroup") || (p.includes("<distributedVirtualPort>") ? "distributed port" : undefined),
      mac: text(p, "mac") || undefined,
      mtu: Number.isFinite(mtu) && mtu > 0 ? mtu : undefined,
    })
  }
  return out
}

/**
 * Parse the `config.virtualNicManagerInfo.netConfig` value: one entry per NIC
 * type, each naming the adapters selected for it by key. Returns the selected
 * keys per NIC type. The candidate adapters embedded in each entry are ignored;
 * only `<selectedVnic>` lines are read, which the candidates never contain.
 * vSphere writes the selection as `<nicType>.<adapter key>` (observed on
 * vCenter 8: `management.key-vim.host.VirtualNic-vmk0`); the prefix is
 * stripped so the keys compare with the adapters' own.
 */
export function parseNetConfigSelection(netConfigXml: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const parts = netConfigXml.split(/<VirtualNicManagerNetConfig[\s>]/).slice(1)
  for (const p of parts) {
    const nicType = text(p, "nicType")
    if (!nicType) continue
    const prefix = `${nicType}.`
    const selected = [...p.matchAll(/<selectedVnic>([^<]+)<\/selectedVnic>/g)]
      .map(m => m[1].trim())
      .map(k => (k.startsWith(prefix) ? k.slice(prefix.length) : k))
    out.set(nicType, selected)
  }
  return out
}

/** Attach the service tags to each adapter and pick the default copy adapter. */
export function buildCopyInterfaces(a: {
  hostMor: string; hostName: string; virtualNicManagerMor: string
  vnics: Array<Omit<HostVmkernelNic, "services">>; selection: Map<string, string[]>
}): HostCopyInterfaces {
  const vnics: HostVmkernelNic[] = a.vnics.map(v => ({
    ...v,
    services: [...a.selection.entries()].filter(([, keys]) => keys.includes(v.key) || keys.includes(v.device)).map(([type]) => type).sort((x, y) => x.localeCompare(y)),
  }))
  return { hostMor: a.hostMor, hostName: a.hostName, virtualNicManagerMor: a.virtualNicManagerMor, vnics, defaultDevice: pickDefaultCopyDevice(vnics) }
}

/** The adapter the copy uses unless the operator says otherwise: backup NFC tag, else management, else the first addressed one. */
export function pickDefaultCopyDevice(vnics: HostVmkernelNic[]): string | undefined {
  const addressed = vnics.filter(v => v.address)
  return (
    addressed.find(v => v.services.includes(BACKUP_NFC_NIC_TYPE))
    ?? addressed.find(v => v.services.includes(MANAGEMENT_NIC_TYPE))
    ?? addressed[0]
  )?.device
}

/** Resolve the host a VM runs on (`runtime.host`); "ha-host" on a standalone ESXi. */
export async function soapGetVmHostMor(session: SoapSession, vmid: string): Promise<string> {
  const body = ENV(`<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
    `<urn:specSet><urn:propSet><urn:type>VirtualMachine</urn:type><urn:pathSet>runtime.host</urn:pathSet></urn:propSet>` +
    `<urn:objectSet><urn:obj type="VirtualMachine">${vmid}</urn:obj><urn:skip>false</urn:skip></urn:objectSet></urn:specSet><urn:options/></urn:RetrievePropertiesEx>`)
  const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (res.text.includes("ManagedObjectNotFound")) throw new Error("VM not found on the VMware source")
  const host = extractProp(res.text, "runtime.host").trim()
  if (!host) throw new Error("vSphere did not report the host this VM runs on")
  return host
}

/** Read the VMkernel adapters and the NIC type selection of a host in one property call. */
export async function soapGetHostCopyInterfaces(session: SoapSession, hostMor: string): Promise<HostCopyInterfaces> {
  const body = ENV(`<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
    `<urn:specSet><urn:propSet><urn:type>HostSystem</urn:type><urn:pathSet>name</urn:pathSet><urn:pathSet>config.network.vnic</urn:pathSet>` +
    `<urn:pathSet>config.virtualNicManagerInfo.netConfig</urn:pathSet><urn:pathSet>configManager.virtualNicManager</urn:pathSet></urn:propSet>` +
    `<urn:objectSet><urn:obj type="HostSystem">${hostMor}</urn:obj><urn:skip>false</urn:skip></urn:objectSet></urn:specSet><urn:options/></urn:RetrievePropertiesEx>`)
  const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (res.text.includes("ManagedObjectNotFound")) throw new Error(`Host ${hostMor} not found on the VMware source`)
  return buildCopyInterfaces({
    hostMor,
    hostName: extractProp(res.text, "name").trim() || hostMor,
    virtualNicManagerMor: extractProp(res.text, "configManager.virtualNicManager").trim(),
    vnics: parseHostVnics(extractProp(res.text, "config.network.vnic")),
    selection: parseNetConfigSelection(extractProp(res.text, "config.virtualNicManagerInfo.netConfig")),
  })
}

/**
 * Adapters of the host a VM runs on. A standalone ESXi calls itself
 * "localhost.localdomain" unless someone named it, which tells the operator
 * nothing; `fallbackHostName` (the connection address) replaces that.
 */
export async function soapGetVmCopyInterfaces(session: SoapSession, vmid: string, fallbackHostName?: string): Promise<HostCopyInterfaces> {
  const ifaces = await soapGetHostCopyInterfaces(session, await soapGetVmHostMor(session, vmid))
  return fallbackHostName && /^localhost(\.localdomain)?$/i.test(ifaces.hostName) ? { ...ifaces, hostName: fallbackHostName } : ifaces
}

async function changeNicType(session: SoapSession, managerMor: string, op: "SelectVnicForNicType" | "DeselectVnicForNicType", nicType: string, device: string): Promise<void> {
  if (!/^vmk\d{1,3}$/.test(device)) throw new Error(`Invalid VMkernel device "${device}"`)
  if (!managerMor) throw new Error("The host did not expose its HostVirtualNicManager")
  const body = ENV(`<urn:${op}><urn:_this type="HostVirtualNicManager">${managerMor}</urn:_this><urn:nicType>${nicType}</urn:nicType><urn:device>${device}</urn:device></urn:${op}>`)
  const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  const fault = describeSoapFault(res.text)
  if (fault) throw new Error(`${op} (${nicType}, ${device}) failed: ${fault}`)
}

/** Tag an adapter for a NIC type (HostVirtualNicManager.SelectVnicForNicType). Host.Config.Network privilege. */
export const soapSelectVnicForNicType = (s: SoapSession, managerMor: string, nicType: string, device: string) => changeNicType(s, managerMor, "SelectVnicForNicType", nicType, device)
/** Remove a NIC type tag from an adapter (HostVirtualNicManager.DeselectVnicForNicType). */
export const soapDeselectVnicForNicType = (s: SoapSession, managerMor: string, nicType: string, device: string) => changeNicType(s, managerMor, "DeselectVnicForNicType", nicType, device)

/**
 * Which tag changes make `device` the adapter vSphere hands NFC tickets on.
 * Pure: the engine applies the plan and logs each step. Nothing to do when the
 * device already carries the tag, or when it is the management adapter and no
 * other adapter is tagged (management is where the traffic goes by default).
 * Choosing the management adapter while another one is tagged removes that
 * tag: the operator asked for management explicitly.
 */
export function planBackupNfcTag(ifaces: HostCopyInterfaces, device: string): { select?: string; deselect: string[] } {
  const target = ifaces.vnics.find(v => v.device === device)
  if (!target) throw new Error(`VMkernel adapter ${device} does not exist on ${ifaces.hostName}`)
  const tagged = ifaces.vnics.filter(v => v.services.includes(BACKUP_NFC_NIC_TYPE)).map(v => v.device)
  if (tagged.includes(device)) return { deselect: [] }
  const wantsManagementDefault = target.services.includes(MANAGEMENT_NIC_TYPE)
  return { ...(wantsManagementDefault ? {} : { select: device }), deselect: tagged }
}
