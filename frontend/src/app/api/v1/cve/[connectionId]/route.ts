import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface CveEntry {
  cveId: string
  package: string
  installedVersion: string
  fixedVersion: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  node: string
  publishedAt: string
}

const MOCK_CVES: CveEntry[] = [
  {
    cveId: 'CVE-2025-32820',
    package: 'pve-manager',
    installedVersion: '8.1.4',
    fixedVersion: '8.1.5',
    severity: 'critical',
    description: 'Remote code execution in pve-manager API endpoint allows authenticated users to execute arbitrary commands.',
    node: 'pve-node-01',
    publishedAt: '2025-11-15',
  },
  {
    cveId: 'CVE-2025-31105',
    package: 'qemu-server',
    installedVersion: '8.0.10',
    fixedVersion: '8.0.11',
    severity: 'high',
    description: 'VM escape vulnerability in QEMU virtio-net device emulation.',
    node: 'pve-node-01',
    publishedAt: '2025-10-22',
  },
  {
    cveId: 'CVE-2025-28974',
    package: 'openssl',
    installedVersion: '3.0.13',
    fixedVersion: '3.0.14',
    severity: 'high',
    description: 'Buffer overflow in X.509 certificate verification could lead to denial of service.',
    node: 'pve-node-02',
    publishedAt: '2025-09-18',
  },
  {
    cveId: 'CVE-2025-27631',
    package: 'libproxmox-rs',
    installedVersion: '0.3.1',
    fixedVersion: '0.3.2',
    severity: 'high',
    description: 'Improper input validation in REST API parser allows privilege escalation.',
    node: 'pve-node-03',
    publishedAt: '2025-08-30',
  },
  {
    cveId: 'CVE-2025-26448',
    package: 'pve-kernel-6.8',
    installedVersion: '6.8.12-1',
    fixedVersion: '6.8.12-2',
    severity: 'medium',
    description: 'Local privilege escalation via eBPF verifier bypass in kernel.',
    node: 'pve-node-01',
    publishedAt: '2025-08-12',
  },
  {
    cveId: 'CVE-2025-25190',
    package: 'pve-firewall',
    installedVersion: '5.0.5',
    fixedVersion: '5.0.6',
    severity: 'medium',
    description: 'Firewall rules bypass when using IPv6 mapped addresses.',
    node: 'pve-node-02',
    publishedAt: '2025-07-25',
  },
  {
    cveId: 'CVE-2025-24012',
    package: 'corosync',
    installedVersion: '3.1.8',
    fixedVersion: '3.1.9',
    severity: 'medium',
    description: 'Cluster communication can be disrupted via malformed totem messages.',
    node: 'pve-node-03',
    publishedAt: '2025-07-03',
  },
  {
    cveId: 'CVE-2025-22876',
    package: 'libgnutls30',
    installedVersion: '3.8.4',
    fixedVersion: '3.8.5',
    severity: 'low',
    description: 'Timing side-channel in RSA-PKCS#1 v1.5 signature verification.',
    node: 'pve-node-02',
    publishedAt: '2025-06-14',
  },
]

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const { connectionId } = await params
  const { searchParams } = new URL(request.url)
  const node = searchParams.get('node')

  // Simulate a small delay
  await new Promise(resolve => setTimeout(resolve, 300))

  let results = MOCK_CVES
  if (node) {
    // Map real node name to mock nodes for demo purposes
    // In production, the backend would filter by actual node
    results = MOCK_CVES.filter(cve => cve.node === node || node.includes('node'))
  }

  return NextResponse.json({
    connectionId,
    lastScan: new Date(Date.now() - 3600000).toISOString(),
    vulnerabilities: results,
  })
}
