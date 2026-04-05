/**
 * Parse libvirt domain XML (virt-v2v output) and map to Proxmox VE VM creation parameters
 */

export interface V2vVmConfig {
  name: string
  memory: number // MB
  cores: number
  sockets: number
  firmware: 'bios' | 'efi'
  ostype: string // l26, win10, win11, etc.
  machine: string // q35
  scsihw: string // virtio-scsi-single
  nics: { model: string; mac?: string }[]
  disks: { file: string; format: string; device: string }[]
}

/**
 * Sanitize VM name for Proxmox DNS compatibility:
 * - Replace non-alphanumeric (except . and -) with -
 * - Collapse consecutive dashes
 * - Trim leading/trailing dashes and dots
 * - Max 63 chars
 */
function sanitizeName(raw: string): string {
  let name = raw
    .replace(/[^a-zA-Z0-9.\-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .substring(0, 63)

  return name || 'vm'
}

/**
 * Convert memory value to MB based on unit attribute.
 * libvirt defaults to KiB if no unit is specified.
 */
function convertMemoryToMB(value: number, unit: string): number {
  switch (unit.toLowerCase()) {
    case 'bytes':
    case 'b':
      return Math.round(value / (1024 * 1024))
    case 'kb':
      return Math.round((value * 1000) / (1024 * 1024))
    case 'kib':
    case 'k':
      return Math.round(value / 1024)
    case 'mb':
      return Math.round((value * 1000 * 1000) / (1024 * 1024))
    case 'mib':
    case 'm':
      return value
    case 'gb':
      return Math.round((value * 1000 * 1000 * 1000) / (1024 * 1024))
    case 'gib':
    case 'g':
      return value * 1024
    case 'tb':
      return Math.round((value * 1000 * 1000 * 1000 * 1000) / (1024 * 1024))
    case 'tib':
    case 't':
      return value * 1024 * 1024
    default:
      // libvirt default is KiB
      return Math.round(value / 1024)
  }
}

/**
 * Detect OS type from XML content and VM name.
 * Returns a Proxmox ostype string.
 */
function detectOsType(xmlLower: string, nameLower: string): string {
  const text = xmlLower + ' ' + nameLower

  // Windows 11 / Server 2022 / Server 2025
  if (
    text.includes('win11') ||
    text.includes('windows 11') ||
    text.includes('windows server 2022') ||
    text.includes('windows server 2025')
  ) {
    return 'win11'
  }

  // Windows 10 / Server 2019 / Server 2016
  if (
    text.includes('win10') ||
    text.includes('windows 10') ||
    text.includes('windows server 2019') ||
    text.includes('windows server 2016')
  ) {
    return 'win10'
  }

  // Windows 8
  if (text.includes('win8') || text.includes('windows 8')) {
    return 'win8'
  }

  // Windows 7
  if (text.includes('win7') || text.includes('windows 7')) {
    return 'win7'
  }

  // Generic Windows
  if (text.includes('windows')) {
    return 'win10'
  }

  // FreeBSD
  if (text.includes('freebsd')) {
    return 'other'
  }

  // Default: Linux
  return 'l26'
}

/**
 * Parse a libvirt domain XML string (virt-v2v output) into a V2vVmConfig.
 * Uses regex/string matching - no XML library required.
 */
export function parseV2vXml(xmlString: string): V2vVmConfig {
  // --- Name ---
  const nameMatch = xmlString.match(/<name>([^<]+)<\/name>/)
  const rawName = nameMatch ? nameMatch[1].trim() : 'vm'

  // --- Memory ---
  const memMatch = xmlString.match(/<memory([^>]*)>(\d+)<\/memory>/)
  let memoryMB = 1024 // default fallback
  if (memMatch) {
    const unitAttr = memMatch[1].match(/unit\s*=\s*["']([^"']+)["']/)
    const unit = unitAttr ? unitAttr[1] : 'KiB'
    memoryMB = convertMemoryToMB(parseInt(memMatch[2], 10), unit)
  }

  // --- vCPU ---
  const vcpuMatch = xmlString.match(/<vcpu[^>]*>(\d+)<\/vcpu>/)
  const cores = vcpuMatch ? parseInt(vcpuMatch[1], 10) : 1

  // --- Firmware ---
  const isEfi =
    xmlString.includes('type="pflash"') ||
    xmlString.includes("type='pflash'") ||
    xmlString.includes('/OVMF_CODE')
  const firmware: 'bios' | 'efi' = isEfi ? 'efi' : 'bios'

  // --- OS type ---
  const xmlLower = xmlString.toLowerCase()
  const nameLower = rawName.toLowerCase()
  const ostype = detectOsType(xmlLower, nameLower)

  // --- NICs ---
  const nics: V2vVmConfig['nics'] = []
  const interfaceRegex = /<interface[^>]*>[\s\S]*?<\/interface>/g
  let ifMatch: RegExpExecArray | null
  while ((ifMatch = interfaceRegex.exec(xmlString)) !== null) {
    const block = ifMatch[0]
    const modelMatch = block.match(/<model\s+type\s*=\s*["']([^"']+)["']/)
    const macMatch = block.match(/<mac\s+address\s*=\s*["']([^"']+)["']/)
    const model = modelMatch ? modelMatch[1] : 'virtio'
    const nic: { model: string; mac?: string } = { model }
    if (macMatch) {
      nic.mac = macMatch[1]
    }
    nics.push(nic)
  }

  // --- Disks ---
  const disks: V2vVmConfig['disks'] = []
  const diskRegex = /<disk\s+type\s*=\s*["']file["'][^>]*>[\s\S]*?<\/disk>/g
  let diskMatch: RegExpExecArray | null
  while ((diskMatch = diskRegex.exec(xmlString)) !== null) {
    const block = diskMatch[0]
    const sourceMatch = block.match(/<source\s+file\s*=\s*["']([^"']+)["']/)
    const driverMatch = block.match(/<driver[^>]+type\s*=\s*["']([^"']+)["']/)
    const targetMatch = block.match(/<target\s+dev\s*=\s*["']([^"']+)["']/)

    if (sourceMatch) {
      disks.push({
        file: sourceMatch[1],
        format: driverMatch ? driverMatch[1] : 'raw',
        device: targetMatch ? targetMatch[1] : 'sda',
      })
    }
  }

  return {
    name: sanitizeName(rawName),
    memory: memoryMB,
    cores,
    sockets: 1,
    firmware,
    ostype,
    machine: 'q35',
    scsihw: 'virtio-scsi-single',
    nics,
    disks,
  }
}

/**
 * Build Proxmox VE VM creation parameters from a parsed V2vVmConfig.
 */
export function buildPveCreateParams(
  config: V2vVmConfig,
  vmid: number,
  networkBridge: string
): Record<string, any> {
  const params: Record<string, any> = {
    vmid,
    name: config.name,
    ostype: config.ostype,
    cores: config.cores,
    sockets: config.sockets,
    memory: config.memory,
    cpu: 'x86-64-v2-AES',
    scsihw: config.scsihw,
    bios: config.firmware === 'efi' ? 'ovmf' : 'seabios',
    machine: config.machine,
    boot: 'order=scsi0',
    agent: 'enabled=0',
  }

  // Network interfaces
  config.nics.forEach((nic, i) => {
    let netValue = `${nic.model},bridge=${networkBridge}`
    if (nic.mac) {
      netValue += `,macaddr=${nic.mac}`
    }
    params[`net${i}`] = netValue
  })

  // If no NICs were found, add a default virtio NIC
  if (config.nics.length === 0) {
    params.net0 = `virtio,bridge=${networkBridge}`
  }

  return params
}
