import type { Crosswalk, FrameworkId } from './types'

// First-pass ISO 27001:2022 crosswalk mapping — conservative, pending GRC review.
interface Entry { c80053: string[]; c800171: string[]; c27001: string[]; rationale: string }

// Single source of truth. 800-53 uses base control ids present in the Moderate
// baseline; 800-171 uses 3.x.x ids. CMMC L2 is derived from 800-171.
const CHECK_CROSSWALK: Record<string, Entry> = {
  cluster_fw_enabled:      { c80053: ['SC-7'], c800171: ['3.13.1', '3.13.5'], c27001: ['A.8.20', 'A.8.22'],   rationale: 'Cluster firewall enforces boundary protection.' },
  cluster_policy_in:       { c80053: ['SC-7'], c800171: ['3.13.6'],           c27001: ['A.8.20'],              rationale: 'Default-deny inbound policy (deny by default).' },
  cluster_policy_out:      { c80053: ['SC-7'], c800171: ['3.13.6'],           c27001: ['A.8.20'],              rationale: 'Default-deny outbound policy (deny by default).' },
  pve_version:             { c80053: ['SI-2'], c800171: ['3.14.1'],           c27001: ['A.8.8'],               rationale: 'Up-to-date platform supports flaw remediation.' },
  node_subscriptions:      { c80053: ['SI-2'], c800171: ['3.14.1'],           c27001: ['A.8.8'],               rationale: 'Subscription enables timely security updates.' },
  apt_repo_consistency:    { c80053: ['SI-2'], c800171: ['3.14.1'],           c27001: ['A.8.8'],               rationale: 'Consistent patch sources for flaw remediation.' },
  tls_certificates:        { c80053: ['SC-8', 'SC-13'], c800171: ['3.13.8'], c27001: ['A.8.24', 'A.5.14'],   rationale: 'Valid TLS protects management traffic in transit.' },
  node_firewalls:          { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'Per-node boundary protection.' },
  root_tfa:                { c80053: ['IA-2'], c800171: ['3.5.3'],            c27001: ['A.8.5', 'A.8.2'],     rationale: 'Multi-factor authentication for the privileged account.' },
  admins_tfa:              { c80053: ['IA-2'], c800171: ['3.5.3'],            c27001: ['A.8.5'],               rationale: 'Multi-factor authentication for administrative accounts.' },
  no_default_tokens:       { c80053: ['IA-5'], c800171: ['3.5.2'],            c27001: ['A.5.17'],              rationale: 'No default/guessable authenticator names.' },
  vm_firewalls:            { c80053: ['SC-7'], c800171: ['3.13.1', '3.13.5'], c27001: ['A.8.20', 'A.8.22'],  rationale: 'Per-VM boundary protection.' },
  vm_security_groups:      { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'VM firewall rule sets enforce communication policy.' },
  backup_schedule:         { c80053: ['CP-9'], c800171: ['3.8.9'],            c27001: ['A.8.13'],              rationale: 'Scheduled backup of CUI.' },
  storage_replication:     { c80053: ['CP-9'], c800171: ['3.8.9'],            c27001: ['A.8.13'],              rationale: 'Replication provides data redundancy.' },
  pool_isolation:          { c80053: ['AC-4'], c800171: ['3.1.3'],            c27001: ['A.5.15', 'A.8.22'],   rationale: 'Resource pools separate workloads / control flow.' },
  vm_vlan_isolation:       { c80053: ['SC-7', 'AC-4'], c800171: ['3.13.1', '3.1.3'], c27001: ['A.8.22'],     rationale: 'VLAN tags segment VM traffic.' },
  vm_no_usb_passthrough:   { c80053: ['MP-7'], c800171: ['3.8.7'],            c27001: ['A.7.10'],              rationale: 'Restrict removable media / device passthrough.' },
  vm_ip_filter:            { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'IP filter prevents address spoofing at the VM boundary.' },
  least_privilege_users:   { c80053: ['AC-6'], c800171: ['3.1.5'],            c27001: ['A.5.15', 'A.8.2'],    rationale: 'Least-privilege access model.' },
  node_firewall_logging:   { c80053: ['AU-2', 'AU-12'], c800171: ['3.3.1'],  c27001: ['A.8.15', 'A.8.16'],   rationale: 'Firewall logging feeds audit records.' },
  os_kernel_modules:       { c80053: ['CM-7'], c800171: ['3.4.6'],            c27001: ['A.8.9'],               rationale: 'Disable unneeded kernel modules (least functionality).' },
  os_coredumps_disabled:   { c80053: ['CM-7'], c800171: ['3.4.6'],            c27001: ['A.8.9'],               rationale: 'Disable core dumps (least functionality).' },
  os_mount_options:        { c80053: ['CM-7'], c800171: ['3.4.6'],            c27001: ['A.8.9'],               rationale: 'Restrictive mount options on shared filesystems.' },
  os_auto_updates:         { c80053: ['SI-2'], c800171: ['3.14.1'],           c27001: ['A.8.8'],               rationale: 'Automatic security updates.' },
  os_cpu_microcode:        { c80053: ['SI-2'], c800171: ['3.14.1'],           c27001: ['A.8.8'],               rationale: 'CPU microcode updates remediate hardware flaws.' },
  os_disk_encryption:      { c80053: ['SC-28'], c800171: ['3.13.16'],         c27001: ['A.8.24'],              rationale: 'Protect CUI at rest.' },
  os_sysctl_hardening:     { c80053: ['CM-6'], c800171: ['3.4.2'],            c27001: ['A.8.9'],               rationale: 'Enforced kernel security configuration settings.' },
  access_pam_faillock:     { c80053: ['AC-7'], c800171: ['3.1.8'],            c27001: ['A.8.5'],               rationale: 'Lock accounts after unsuccessful logon attempts.' },
  access_password_aging:   { c80053: ['IA-5'], c800171: ['3.5.7'],            c27001: ['A.5.17'],              rationale: 'Password lifetime policy.' },
  access_pw_quality:       { c80053: ['IA-5'], c800171: ['3.5.7'],            c27001: ['A.5.17'],              rationale: 'Password complexity enforcement.' },
  access_shell_timeout:    { c80053: ['AC-12'], c800171: ['3.1.11'],          c27001: ['A.8.5'],               rationale: 'Terminate idle local sessions.' },
  access_login_banner:     { c80053: ['AC-8'], c800171: ['3.1.9'],            c27001: [],                      rationale: 'System-use notification banner.' },
  ssh_strong_ciphers:      { c80053: ['SC-8', 'SC-13'], c800171: ['3.13.8', '3.13.11'], c27001: ['A.8.24'],  rationale: 'Strong transport ciphers.' },
  ssh_strong_kex:          { c80053: ['SC-8', 'SC-13'], c800171: ['3.13.8', '3.13.11'], c27001: ['A.8.24'],  rationale: 'Strong key-exchange algorithms.' },
  ssh_strong_macs:         { c80053: ['SC-8', 'SC-13'], c800171: ['3.13.8', '3.13.11'], c27001: ['A.8.24'],  rationale: 'Strong message authentication codes.' },
  ssh_root_login:          { c80053: ['AC-3', 'AC-6'], c800171: ['3.1.1', '3.1.5'],    c27001: ['A.8.2', 'A.5.15'], rationale: 'Restrict privileged remote login.' },
  ssh_max_auth_tries:      { c80053: ['AC-7'], c800171: ['3.1.8'],            c27001: ['A.8.5'],               rationale: 'Limit unsuccessful authentication attempts.' },
  ssh_empty_passwords:     { c80053: ['IA-5'], c800171: ['3.5.7'],            c27001: ['A.5.17'],              rationale: 'Reject empty passwords.' },
  ssh_idle_timeout:        { c80053: ['AC-12'], c800171: ['3.1.11'],          c27001: ['A.8.5'],               rationale: 'Terminate idle SSH sessions.' },
  ssh_file_perms:          { c80053: ['AC-3'], c800171: ['3.1.1'],            c27001: ['A.8.3'],               rationale: 'Restrict access to SSH key/config files.' },
  net_ip_forward:          { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'Disable IP forwarding at the boundary.' },
  net_icmp_redirects:      { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'Reject ICMP redirects.' },
  net_source_routing:      { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'Disable source routing.' },
  net_syn_cookies:         { c80053: ['SC-5'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'SYN cookies mitigate denial of service.' },
  net_rp_filter:           { c80053: ['SC-7'], c800171: ['3.13.1'],           c27001: ['A.8.20'],              rationale: 'Reverse-path filtering prevents spoofing.' },
  svc_unnecessary_disabled:{ c80053: ['CM-7'], c800171: ['3.4.6', '3.4.7'],  c27001: ['A.8.9'],               rationale: 'Disable unnecessary services (least functionality).' },
  svc_apparmor:            { c80053: ['CM-7'], c800171: ['3.4.6'],            c27001: ['A.8.9'],               rationale: 'Mandatory access control confinement.' },
  svc_auditd:              { c80053: ['AU-2', 'AU-3', 'AU-12'], c800171: ['3.3.1', '3.3.2'], c27001: ['A.8.15', 'A.8.16'], rationale: 'Audit daemon records security events.' },
  svc_ntp_sync:            { c80053: ['AU-8'], c800171: ['3.3.7'],            c27001: ['A.8.17'],              rationale: 'Time synchronization for audit timestamps.' },
  svc_fail2ban:            { c80053: ['SI-4', 'AC-7'], c800171: ['3.14.6'],  c27001: ['A.8.7', 'A.8.16'],    rationale: 'Detect and block brute-force attempts.' },
  fs_permissions:          { c80053: ['AC-3'], c800171: ['3.1.1'],            c27001: ['A.8.3'],               rationale: 'Access enforcement on critical system files.' },
  fs_suid_audit:           { c80053: ['CM-7'], c800171: ['3.4.6'],            c27001: ['A.8.9'],               rationale: 'Audit SUID/SGID binaries (least functionality).' },
  fs_world_writable:       { c80053: ['AC-3'], c800171: ['3.1.1'],            c27001: ['A.8.3'],               rationale: 'No world-writable files.' },
  fs_integrity:            { c80053: ['SI-7'], c800171: ['3.14.6'],           c27001: ['A.8.7', 'A.8.16'],    rationale: 'File integrity monitoring.' },
  log_journald_persistent: { c80053: ['AU-4', 'AU-11'], c800171: ['3.3.1'],  c27001: ['A.8.15'],              rationale: 'Persistent audit-log storage and retention.' },
  log_syslog_forwarding:   { c80053: ['AU-6', 'AU-9'], c800171: ['3.3.1', '3.3.8'], c27001: ['A.8.15', 'A.8.16'], rationale: 'Centralized logging and protection.' },
  log_file_permissions:    { c80053: ['AU-9'], c800171: ['3.3.8'],            c27001: ['A.8.15'],              rationale: 'Protect audit information from unauthorized access.' },
}

const CMMC_DOMAIN: Record<string, string> = {
  '3.1': 'AC', '3.2': 'AT', '3.3': 'AU', '3.4': 'CM', '3.5': 'IA', '3.6': 'IR', '3.7': 'MA',
  '3.8': 'MP', '3.9': 'PS', '3.10': 'PE', '3.11': 'RA', '3.12': 'CA', '3.13': 'SC', '3.14': 'SI',
}
const toCmmc = (id: string) => {
  const domain = CMMC_DOMAIN[id.split('.').slice(0, 2).join('.')]
  if (domain === undefined) throw new Error('toCmmc: unknown 800-171 family prefix for ' + id)
  return `${domain}.L2-${id}`
}

export function getCrosswalk(id: FrameworkId): Crosswalk {
  const out: Crosswalk = {}
  for (const [checkId, e] of Object.entries(CHECK_CROSSWALK)) {
    if (id === 'nist-800-53-r5')    out[checkId] = { controlIds: e.c80053,                  rationale: e.rationale }
    else if (id === 'nist-800-171-r2') out[checkId] = { controlIds: e.c800171,              rationale: e.rationale }
    else if (id === 'iso-27001-2022')  out[checkId] = { controlIds: e.c27001,               rationale: e.rationale }
    else                               out[checkId] = { controlIds: e.c800171.map(toCmmc),  rationale: e.rationale }
  }
  return out
}
