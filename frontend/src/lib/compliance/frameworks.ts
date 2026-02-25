// src/lib/compliance/frameworks.ts
// Static definitions for compliance frameworks

export interface FrameworkCheckMapping {
  checkId: string
  weight: number        // 0.5 - 2.0 multiplier
  controlRef: string    // e.g. "A.9.4.1"
  category: string      // Framework-specific category
}

export interface ComplianceFramework {
  id: string
  name: string
  description: string
  version: string
  icon: string          // RemixIcon class
  color: string         // Hex color
  checks: FrameworkCheckMapping[]
}

// All 13 check IDs for reference
const ALL_CHECK_IDS = [
  'cluster_fw_enabled',
  'cluster_policy_in',
  'cluster_policy_out',
  'pve_version',
  'node_subscriptions',
  'apt_repo_consistency',
  'tls_certificates',
  'node_firewalls',
  'root_tfa',
  'admins_tfa',
  'no_default_tokens',
  'vm_firewalls',
  'vm_security_groups',
] as const

export const FRAMEWORKS: ComplianceFramework[] = [
  // ──────────────────────────────────────────────
  // ISO 27001:2022
  // ──────────────────────────────────────────────
  {
    id: 'iso27001',
    name: 'ISO 27001:2022',
    description: 'International standard for information security management systems (ISMS)',
    version: '2022',
    icon: 'ri-shield-check-line',
    color: '#3b82f6',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 1.5, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'cluster_policy_in',   weight: 1.5, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'cluster_policy_out',  weight: 1.0, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'pve_version',         weight: 1.0, controlRef: 'A.12.6.1', category: 'Operations Security' },
      { checkId: 'node_subscriptions',  weight: 0.5, controlRef: 'A.12.6.1', category: 'Operations Security' },
      { checkId: 'apt_repo_consistency', weight: 0.5, controlRef: 'A.12.6.1', category: 'Operations Security' },
      { checkId: 'tls_certificates',    weight: 1.5, controlRef: 'A.10.1.1', category: 'Cryptography' },
      { checkId: 'node_firewalls',      weight: 1.0, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'root_tfa',            weight: 2.0, controlRef: 'A.9.4.1',  category: 'Access Control' },
      { checkId: 'admins_tfa',          weight: 1.5, controlRef: 'A.9.4.2',  category: 'Access Control' },
      { checkId: 'no_default_tokens',   weight: 1.0, controlRef: 'A.9.2.3',  category: 'Access Control' },
      { checkId: 'vm_firewalls',        weight: 1.5, controlRef: 'A.13.1.3', category: 'Network Security' },
      { checkId: 'vm_security_groups',  weight: 1.0, controlRef: 'A.13.1.3', category: 'Network Security' },
    ],
  },

  // ──────────────────────────────────────────────
  // CIS Proxmox Benchmark
  // ──────────────────────────────────────────────
  {
    id: 'cis_proxmox',
    name: 'CIS Proxmox',
    description: 'Center for Internet Security benchmark for Proxmox VE hardening',
    version: '1.0',
    icon: 'ri-lock-line',
    color: '#10b981',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 1.0, controlRef: '3.1',  category: 'Network Configuration' },
      { checkId: 'cluster_policy_in',   weight: 1.0, controlRef: '3.2',  category: 'Network Configuration' },
      { checkId: 'cluster_policy_out',  weight: 1.0, controlRef: '3.3',  category: 'Network Configuration' },
      { checkId: 'pve_version',         weight: 1.0, controlRef: '1.1',  category: 'Initial Setup' },
      { checkId: 'node_subscriptions',  weight: 1.0, controlRef: '1.2',  category: 'Initial Setup' },
      { checkId: 'apt_repo_consistency', weight: 1.0, controlRef: '1.3',  category: 'Initial Setup' },
      { checkId: 'tls_certificates',    weight: 1.0, controlRef: '2.1',  category: 'Services' },
      { checkId: 'node_firewalls',      weight: 1.0, controlRef: '3.4',  category: 'Network Configuration' },
      { checkId: 'root_tfa',            weight: 1.0, controlRef: '4.1',  category: 'Authentication' },
      { checkId: 'admins_tfa',          weight: 1.0, controlRef: '4.2',  category: 'Authentication' },
      { checkId: 'no_default_tokens',   weight: 1.0, controlRef: '4.3',  category: 'Authentication' },
      { checkId: 'vm_firewalls',        weight: 1.0, controlRef: '5.1',  category: 'VM Security' },
      { checkId: 'vm_security_groups',  weight: 1.0, controlRef: '5.2',  category: 'VM Security' },
    ],
  },

  // ──────────────────────────────────────────────
  // PCI-DSS v4.0
  // ──────────────────────────────────────────────
  {
    id: 'pci_dss',
    name: 'PCI-DSS v4.0',
    description: 'Payment Card Industry Data Security Standard for cardholder data protection',
    version: '4.0',
    icon: 'ri-bank-card-line',
    color: '#8b5cf6',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 2.0, controlRef: 'Req 1.2.1', category: 'Network Security Controls' },
      { checkId: 'cluster_policy_in',   weight: 2.0, controlRef: 'Req 1.3.1', category: 'Network Security Controls' },
      { checkId: 'cluster_policy_out',  weight: 1.5, controlRef: 'Req 1.3.2', category: 'Network Security Controls' },
      { checkId: 'pve_version',         weight: 1.0, controlRef: 'Req 6.3.3', category: 'Secure Systems' },
      { checkId: 'node_subscriptions',  weight: 1.0, controlRef: 'Req 6.3.3', category: 'Secure Systems' },
      // apt_repo_consistency excluded from PCI-DSS
      { checkId: 'tls_certificates',    weight: 2.0, controlRef: 'Req 4.2.1', category: 'Strong Cryptography' },
      { checkId: 'node_firewalls',      weight: 1.5, controlRef: 'Req 1.2.1', category: 'Network Security Controls' },
      { checkId: 'root_tfa',            weight: 2.0, controlRef: 'Req 8.4.2', category: 'Access Control' },
      { checkId: 'admins_tfa',          weight: 2.0, controlRef: 'Req 8.4.2', category: 'Access Control' },
      { checkId: 'no_default_tokens',   weight: 1.5, controlRef: 'Req 8.6.1', category: 'Access Control' },
      { checkId: 'vm_firewalls',        weight: 1.5, controlRef: 'Req 1.2.5', category: 'Network Security Controls' },
      { checkId: 'vm_security_groups',  weight: 1.0, controlRef: 'Req 1.2.5', category: 'Network Security Controls' },
    ],
  },

  // ──────────────────────────────────────────────
  // SOC 2
  // ──────────────────────────────────────────────
  {
    id: 'soc2',
    name: 'SOC 2',
    description: 'Service Organization Control 2 for trust services criteria',
    version: '2017',
    icon: 'ri-verified-badge-line',
    color: '#f59e0b',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'cluster_policy_in',   weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'cluster_policy_out',  weight: 1.0, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'tls_certificates',    weight: 1.5, controlRef: 'CC6.7', category: 'Logical & Physical Access' },
      { checkId: 'node_firewalls',      weight: 1.0, controlRef: 'CC6.6', category: 'Logical & Physical Access' },
      { checkId: 'root_tfa',            weight: 2.0, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'admins_tfa',          weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'no_default_tokens',   weight: 1.0, controlRef: 'CC6.3', category: 'Logical & Physical Access' },
      { checkId: 'vm_firewalls',        weight: 1.0, controlRef: 'CC7.1', category: 'System Operations' },
      { checkId: 'vm_security_groups',  weight: 0.5, controlRef: 'CC7.1', category: 'System Operations' },
    ],
  },

  // ──────────────────────────────────────────────
  // HIPAA
  // ──────────────────────────────────────────────
  {
    id: 'hipaa',
    name: 'HIPAA',
    description: 'Health Insurance Portability and Accountability Act security requirements',
    version: '2013',
    icon: 'ri-heart-pulse-line',
    color: '#ef4444',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'cluster_policy_in',   weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'tls_certificates',    weight: 2.0, controlRef: '164.312(e)(2)', category: 'Technical Safeguards' },
      { checkId: 'node_firewalls',      weight: 1.0, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'root_tfa',            weight: 2.0, controlRef: '164.312(d)',     category: 'Technical Safeguards' },
      { checkId: 'admins_tfa',          weight: 2.0, controlRef: '164.312(d)',     category: 'Technical Safeguards' },
      { checkId: 'no_default_tokens',   weight: 1.0, controlRef: '164.312(a)(1)', category: 'Technical Safeguards' },
      { checkId: 'vm_firewalls',        weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'pve_version',         weight: 1.0, controlRef: '164.308(a)(5)', category: 'Administrative Safeguards' },
    ],
  },

  // ──────────────────────────────────────────────
  // NIST 800-53
  // ──────────────────────────────────────────────
  {
    id: 'nist_800_53',
    name: 'NIST 800-53',
    description: 'Security and privacy controls for information systems (Rev. 5)',
    version: 'Rev. 5',
    icon: 'ri-government-line',
    color: '#0ea5e9',
    checks: [
      { checkId: 'cluster_fw_enabled',  weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'cluster_policy_in',   weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'cluster_policy_out',  weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'pve_version',         weight: 1.0, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'node_subscriptions',  weight: 0.5, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'apt_repo_consistency', weight: 0.5, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'tls_certificates',    weight: 1.5, controlRef: 'SC-8',  category: 'System & Communications Protection' },
      { checkId: 'node_firewalls',      weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'root_tfa',            weight: 2.0, controlRef: 'AC-2',  category: 'Access Control' },
      { checkId: 'admins_tfa',          weight: 1.5, controlRef: 'AC-2',  category: 'Access Control' },
      { checkId: 'no_default_tokens',   weight: 1.0, controlRef: 'AC-6',  category: 'Access Control' },
      { checkId: 'vm_firewalls',        weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'vm_security_groups',  weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
    ],
  },
]

export function getFrameworkById(id: string): ComplianceFramework | undefined {
  return FRAMEWORKS.find(f => f.id === id)
}

export function getFrameworkCheckIds(frameworkId: string): string[] {
  const fw = getFrameworkById(frameworkId)
  if (!fw) return []
  return fw.checks.map(c => c.checkId)
}
