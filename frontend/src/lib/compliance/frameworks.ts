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

// All 25 check IDs for reference
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
  'backup_schedule',
  'ha_enabled',
  'storage_replication',
  'pool_isolation',
  'vm_vlan_isolation',
  'vm_guest_agent',
  'vm_secure_boot',
  'vm_no_usb_passthrough',
  'vm_cpu_isolation',
  'vm_ip_filter',
  'least_privilege_users',
  'node_firewall_logging',
] as const

export const FRAMEWORKS: ComplianceFramework[] = [
  // ──────────────────────────────────────────────
  // ISO 27001:2022 — ISMS focused (17/25)
  // Access control, cryptography, network security, operations
  // ──────────────────────────────────────────────
  {
    id: 'iso27001',
    name: 'ISO 27001:2022',
    description: 'International standard for information security management systems (ISMS)',
    version: '2022',
    icon: 'ri-shield-check-line',
    color: '#3b82f6',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 1.5, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'cluster_policy_in',     weight: 1.5, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'cluster_policy_out',    weight: 1.0, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'pve_version',           weight: 1.0, controlRef: 'A.12.6.1', category: 'Operations Security' },
      { checkId: 'node_subscriptions',    weight: 0.5, controlRef: 'A.12.6.1', category: 'Operations Security' },
      { checkId: 'tls_certificates',      weight: 1.5, controlRef: 'A.10.1.1', category: 'Cryptography' },
      { checkId: 'node_firewalls',        weight: 1.0, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'root_tfa',              weight: 2.0, controlRef: 'A.9.4.1',  category: 'Access Control' },
      { checkId: 'admins_tfa',            weight: 1.5, controlRef: 'A.9.4.2',  category: 'Access Control' },
      { checkId: 'no_default_tokens',     weight: 1.0, controlRef: 'A.9.2.3',  category: 'Access Control' },
      { checkId: 'vm_firewalls',          weight: 1.5, controlRef: 'A.13.1.3', category: 'Network Security' },
      { checkId: 'vm_security_groups',    weight: 1.0, controlRef: 'A.13.1.3', category: 'Network Security' },
      { checkId: 'backup_schedule',       weight: 1.0, controlRef: 'A.12.3.1', category: 'Operations Security' },
      { checkId: 'pool_isolation',        weight: 1.0, controlRef: 'A.9.1.1',  category: 'Access Control' },
      { checkId: 'vm_vlan_isolation',     weight: 1.5, controlRef: 'A.13.1.3', category: 'Network Security' },
      { checkId: 'vm_ip_filter',          weight: 1.0, controlRef: 'A.13.1.1', category: 'Network Security' },
      { checkId: 'least_privilege_users', weight: 1.5, controlRef: 'A.9.2.3',  category: 'Access Control' },
    ],
  },

  // ──────────────────────────────────────────────
  // CIS Proxmox Benchmark — All checks (25/25)
  // Comprehensive security hardening benchmark
  // ──────────────────────────────────────────────
  {
    id: 'cis_proxmox',
    name: 'CIS Proxmox',
    description: 'Center for Internet Security benchmark for Proxmox VE hardening',
    version: '1.0',
    icon: 'ri-lock-line',
    color: '#10b981',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 1.0, controlRef: '3.1',  category: 'Network Configuration' },
      { checkId: 'cluster_policy_in',     weight: 1.0, controlRef: '3.2',  category: 'Network Configuration' },
      { checkId: 'cluster_policy_out',    weight: 1.0, controlRef: '3.3',  category: 'Network Configuration' },
      { checkId: 'pve_version',           weight: 1.0, controlRef: '1.1',  category: 'Initial Setup' },
      { checkId: 'node_subscriptions',    weight: 1.0, controlRef: '1.2',  category: 'Initial Setup' },
      { checkId: 'apt_repo_consistency',  weight: 1.0, controlRef: '1.3',  category: 'Initial Setup' },
      { checkId: 'tls_certificates',      weight: 1.0, controlRef: '2.1',  category: 'Services' },
      { checkId: 'node_firewalls',        weight: 1.0, controlRef: '3.4',  category: 'Network Configuration' },
      { checkId: 'root_tfa',              weight: 1.0, controlRef: '4.1',  category: 'Authentication' },
      { checkId: 'admins_tfa',            weight: 1.0, controlRef: '4.2',  category: 'Authentication' },
      { checkId: 'no_default_tokens',     weight: 1.0, controlRef: '4.3',  category: 'Authentication' },
      { checkId: 'vm_firewalls',          weight: 1.0, controlRef: '5.1',  category: 'VM Security' },
      { checkId: 'vm_security_groups',    weight: 1.0, controlRef: '5.2',  category: 'VM Security' },
      { checkId: 'backup_schedule',       weight: 1.0, controlRef: '6.1',  category: 'Data Protection' },
      { checkId: 'ha_enabled',            weight: 1.0, controlRef: '6.2',  category: 'Data Protection' },
      { checkId: 'storage_replication',   weight: 1.0, controlRef: '6.3',  category: 'Data Protection' },
      { checkId: 'pool_isolation',        weight: 1.0, controlRef: '4.4',  category: 'Authentication' },
      { checkId: 'vm_vlan_isolation',     weight: 1.0, controlRef: '3.5',  category: 'Network Configuration' },
      { checkId: 'vm_guest_agent',        weight: 1.0, controlRef: '5.3',  category: 'VM Security' },
      { checkId: 'vm_secure_boot',        weight: 1.0, controlRef: '5.4',  category: 'VM Security' },
      { checkId: 'vm_no_usb_passthrough', weight: 1.0, controlRef: '5.5',  category: 'VM Security' },
      { checkId: 'vm_cpu_isolation',      weight: 1.0, controlRef: '5.6',  category: 'VM Security' },
      { checkId: 'vm_ip_filter',          weight: 1.0, controlRef: '3.6',  category: 'Network Configuration' },
      { checkId: 'least_privilege_users', weight: 1.0, controlRef: '4.5',  category: 'Authentication' },
      { checkId: 'node_firewall_logging', weight: 1.0, controlRef: '3.7',  category: 'Network Configuration' },
    ],
  },

  // ──────────────────────────────────────────────
  // PCI-DSS v4.0 — Network & data focus (19/25)
  // Firewall, encryption, access, network segmentation
  // ──────────────────────────────────────────────
  {
    id: 'pci_dss',
    name: 'PCI-DSS v4.0',
    description: 'Payment Card Industry Data Security Standard for cardholder data protection',
    version: '4.0',
    icon: 'ri-bank-card-line',
    color: '#8b5cf6',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 2.0, controlRef: 'Req 1.2.1', category: 'Network Security Controls' },
      { checkId: 'cluster_policy_in',     weight: 2.0, controlRef: 'Req 1.3.1', category: 'Network Security Controls' },
      { checkId: 'cluster_policy_out',    weight: 1.5, controlRef: 'Req 1.3.2', category: 'Network Security Controls' },
      { checkId: 'pve_version',           weight: 1.0, controlRef: 'Req 6.3.3', category: 'Secure Systems' },
      { checkId: 'node_subscriptions',    weight: 1.0, controlRef: 'Req 6.3.3', category: 'Secure Systems' },
      { checkId: 'tls_certificates',      weight: 2.0, controlRef: 'Req 4.2.1', category: 'Strong Cryptography' },
      { checkId: 'node_firewalls',        weight: 1.5, controlRef: 'Req 1.2.1', category: 'Network Security Controls' },
      { checkId: 'root_tfa',              weight: 2.0, controlRef: 'Req 8.4.2', category: 'Access Control' },
      { checkId: 'admins_tfa',            weight: 2.0, controlRef: 'Req 8.4.2', category: 'Access Control' },
      { checkId: 'no_default_tokens',     weight: 1.5, controlRef: 'Req 8.6.1', category: 'Access Control' },
      { checkId: 'vm_firewalls',          weight: 1.5, controlRef: 'Req 1.2.5', category: 'Network Security Controls' },
      { checkId: 'vm_security_groups',    weight: 1.0, controlRef: 'Req 1.2.5', category: 'Network Security Controls' },
      { checkId: 'pool_isolation',        weight: 1.5, controlRef: 'Req 1.4.1', category: 'Network Security Controls' },
      { checkId: 'vm_vlan_isolation',     weight: 2.0, controlRef: 'Req 1.4.2', category: 'Network Security Controls' },
      { checkId: 'vm_secure_boot',        weight: 1.0, controlRef: 'Req 6.5.1', category: 'Secure Systems' },
      { checkId: 'vm_no_usb_passthrough', weight: 1.5, controlRef: 'Req 9.5.1', category: 'Physical Access' },
      { checkId: 'vm_ip_filter',          weight: 1.5, controlRef: 'Req 1.3.3', category: 'Network Security Controls' },
      { checkId: 'least_privilege_users', weight: 1.5, controlRef: 'Req 7.2.1', category: 'Access Control' },
      { checkId: 'node_firewall_logging', weight: 1.5, controlRef: 'Req 10.2.1', category: 'Logging & Monitoring' },
    ],
  },

  // ──────────────────────────────────────────────
  // SOC 2 — Availability & operations focus (14/25)
  // Backup, HA, replication, monitoring, access
  // ──────────────────────────────────────────────
  {
    id: 'soc2',
    name: 'SOC 2',
    description: 'Service Organization Control 2 for trust services criteria',
    version: '2017',
    icon: 'ri-verified-badge-line',
    color: '#f59e0b',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'cluster_policy_in',     weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'cluster_policy_out',    weight: 1.0, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'tls_certificates',      weight: 1.5, controlRef: 'CC6.7', category: 'Logical & Physical Access' },
      { checkId: 'node_firewalls',        weight: 1.0, controlRef: 'CC6.6', category: 'Logical & Physical Access' },
      { checkId: 'root_tfa',              weight: 2.0, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'admins_tfa',            weight: 1.5, controlRef: 'CC6.1', category: 'Logical & Physical Access' },
      { checkId: 'no_default_tokens',     weight: 1.0, controlRef: 'CC6.3', category: 'Logical & Physical Access' },
      { checkId: 'vm_firewalls',          weight: 1.0, controlRef: 'CC7.1', category: 'System Operations' },
      { checkId: 'backup_schedule',       weight: 2.0, controlRef: 'A1.2',  category: 'Availability' },
      { checkId: 'ha_enabled',            weight: 2.0, controlRef: 'A1.2',  category: 'Availability' },
      { checkId: 'storage_replication',   weight: 1.5, controlRef: 'A1.2',  category: 'Availability' },
      { checkId: 'vm_guest_agent',        weight: 1.0, controlRef: 'CC7.1', category: 'System Operations' },
      { checkId: 'least_privilege_users', weight: 1.5, controlRef: 'CC6.3', category: 'Logical & Physical Access' },
      { checkId: 'node_firewall_logging', weight: 1.0, controlRef: 'CC7.2', category: 'System Operations' },
    ],
  },

  // ──────────────────────────────────────────────
  // HIPAA — Data protection focus (15/25)
  // Encryption, access control, backup, audit
  // ──────────────────────────────────────────────
  {
    id: 'hipaa',
    name: 'HIPAA',
    description: 'Health Insurance Portability and Accountability Act security requirements',
    version: '2013',
    icon: 'ri-heart-pulse-line',
    color: '#ef4444',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'cluster_policy_in',     weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'tls_certificates',      weight: 2.0, controlRef: '164.312(e)(2)', category: 'Technical Safeguards' },
      { checkId: 'node_firewalls',        weight: 1.0, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'root_tfa',              weight: 2.0, controlRef: '164.312(d)',     category: 'Technical Safeguards' },
      { checkId: 'admins_tfa',            weight: 2.0, controlRef: '164.312(d)',     category: 'Technical Safeguards' },
      { checkId: 'no_default_tokens',     weight: 1.0, controlRef: '164.312(a)(1)', category: 'Technical Safeguards' },
      { checkId: 'vm_firewalls',          weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'pve_version',           weight: 1.0, controlRef: '164.308(a)(5)', category: 'Administrative Safeguards' },
      { checkId: 'backup_schedule',       weight: 2.0, controlRef: '164.308(a)(7)', category: 'Administrative Safeguards' },
      { checkId: 'ha_enabled',            weight: 1.5, controlRef: '164.308(a)(7)', category: 'Administrative Safeguards' },
      { checkId: 'storage_replication',   weight: 1.5, controlRef: '164.308(a)(7)', category: 'Administrative Safeguards' },
      { checkId: 'vm_ip_filter',          weight: 1.5, controlRef: '164.312(e)(1)', category: 'Technical Safeguards' },
      { checkId: 'vm_secure_boot',        weight: 1.0, controlRef: '164.312(c)(1)', category: 'Technical Safeguards' },
      { checkId: 'vm_no_usb_passthrough', weight: 1.5, controlRef: '164.310(d)(1)', category: 'Physical Safeguards' },
      { checkId: 'least_privilege_users', weight: 1.5, controlRef: '164.312(a)(1)', category: 'Technical Safeguards' },
    ],
  },

  // ──────────────────────────────────────────────
  // NIST 800-53 — Comprehensive government (23/25)
  // Almost all checks, government-grade
  // ──────────────────────────────────────────────
  {
    id: 'nist_800_53',
    name: 'NIST 800-53',
    description: 'Security and privacy controls for information systems (Rev. 5)',
    version: 'Rev. 5',
    icon: 'ri-government-line',
    color: '#0ea5e9',
    checks: [
      { checkId: 'cluster_fw_enabled',    weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'cluster_policy_in',     weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'cluster_policy_out',    weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'pve_version',           weight: 1.0, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'node_subscriptions',    weight: 0.5, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'apt_repo_consistency',  weight: 0.5, controlRef: 'SI-2',  category: 'System & Information Integrity' },
      { checkId: 'tls_certificates',      weight: 1.5, controlRef: 'SC-8',  category: 'System & Communications Protection' },
      { checkId: 'node_firewalls',        weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'root_tfa',              weight: 2.0, controlRef: 'AC-2',  category: 'Access Control' },
      { checkId: 'admins_tfa',            weight: 1.5, controlRef: 'AC-2',  category: 'Access Control' },
      { checkId: 'no_default_tokens',     weight: 1.0, controlRef: 'AC-6',  category: 'Access Control' },
      { checkId: 'vm_firewalls',          weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'vm_security_groups',    weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'backup_schedule',       weight: 1.0, controlRef: 'CP-9',  category: 'Contingency Planning' },
      { checkId: 'ha_enabled',            weight: 1.0, controlRef: 'CP-10', category: 'Contingency Planning' },
      { checkId: 'pool_isolation',        weight: 1.0, controlRef: 'AC-4',  category: 'Access Control' },
      { checkId: 'vm_vlan_isolation',     weight: 1.5, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'vm_guest_agent',        weight: 0.5, controlRef: 'CM-8',  category: 'Configuration Management' },
      { checkId: 'vm_secure_boot',        weight: 1.0, controlRef: 'SI-7',  category: 'System & Information Integrity' },
      { checkId: 'vm_no_usb_passthrough', weight: 1.0, controlRef: 'SC-41', category: 'System & Communications Protection' },
      { checkId: 'vm_cpu_isolation',      weight: 1.0, controlRef: 'SC-39', category: 'System & Communications Protection' },
      { checkId: 'vm_ip_filter',          weight: 1.0, controlRef: 'SC-7',  category: 'System & Communications Protection' },
      { checkId: 'least_privilege_users', weight: 1.5, controlRef: 'AC-6',  category: 'Access Control' },
      { checkId: 'node_firewall_logging', weight: 1.0, controlRef: 'AU-3',  category: 'Audit & Accountability' },
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
