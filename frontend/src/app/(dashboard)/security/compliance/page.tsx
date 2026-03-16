'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  Grid, IconButton, Slider, Switch, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'
import { usePVEConnections } from '@/hooks/useConnections'
import {
  useHardeningChecks, useSecurityPolicies,
  useComplianceProfiles,
} from '@/hooks/useHardeningChecks'

// Severity config
const severityColors: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
}

const statusColors: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  pass: 'success',
  fail: 'error',
  warning: 'warning',
  skip: 'default',
}

const categoryIcons: Record<string, string> = {
  cluster: 'ri-server-line',
  node: 'ri-computer-line',
  access: 'ri-shield-user-line',
  vm: 'ri-instance-line',
  os: 'ri-terminal-box-line',
  ssh: 'ri-key-2-line',
  network: 'ri-global-line',
  services: 'ri-settings-3-line',
  filesystem: 'ri-folder-shield-2-line',
  logging: 'ri-file-list-3-line',
}

const categoryColors: Record<string, string> = {
  cluster: '#6366f1', node: '#8b5cf6', access: '#ec4899',
  vm: '#06b6d4', os: '#f97316', ssh: '#eab308',
  network: '#10b981', services: '#14b8a6',
  filesystem: '#64748b', logging: '#a855f7',
}

// Proxmox Hardening Guide (PVE 9) base URL
const PVE_GUIDE_BASE = 'https://github.com/HomeSecExplorer/Proxmox-Hardening-Guide/blob/main/docs/pve9-hardening-guide.md'
// CIS Debian Linux Benchmark page
const CIS_BENCHMARK_URL = 'https://www.cisecurity.org/benchmark/debian_linux'

// CIS reference per check ID: { label, url }
const CIS_REFS: Record<string, { label: string; url: string }> = {
  os_kernel_modules: { label: 'CIS 1.1.1', url: `${PVE_GUIDE_BASE}#111-apply-debian-13-cis-level-1` },
  os_coredumps_disabled: { label: 'CIS 1.5.11', url: CIS_BENCHMARK_URL },
  os_mount_options: { label: 'CIS 1.6.1', url: CIS_BENCHMARK_URL },
  os_auto_updates: { label: 'CIS 1.1.3', url: `${PVE_GUIDE_BASE}#113-configure-automatic-security-updates` },
  os_cpu_microcode: { label: 'CIS 1.1.8', url: `${PVE_GUIDE_BASE}#118-install-cpu-microcode` },
  os_disk_encryption: { label: 'CIS 1.1.5', url: `${PVE_GUIDE_BASE}#115-enable-full-disk-encryption` },
  os_sysctl_hardening: { label: 'CIS 1.1.1', url: `${PVE_GUIDE_BASE}#111-apply-debian-13-cis-level-1` },
  access_pam_faillock: { label: 'CIS 5.3.3', url: CIS_BENCHMARK_URL },
  access_password_aging: { label: 'CIS 5.4.1', url: CIS_BENCHMARK_URL },
  access_pw_quality: { label: 'CIS 5.3.1', url: CIS_BENCHMARK_URL },
  access_shell_timeout: { label: 'CIS 5.4.3', url: CIS_BENCHMARK_URL },
  access_login_banner: { label: 'CIS 1.7.1', url: CIS_BENCHMARK_URL },
  ssh_strong_ciphers: { label: 'CIS 5.1.4', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_strong_kex: { label: 'CIS 5.1.5', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_strong_macs: { label: 'CIS 5.1.6', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_root_login: { label: 'CIS 5.1.21', url: `${PVE_GUIDE_BASE}#215-privileged-access-model-root-sudo-and-shell-access` },
  ssh_max_auth_tries: { label: 'CIS 5.1.12', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_empty_passwords: { label: 'CIS 5.1.17', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_idle_timeout: { label: 'CIS 5.1.20', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  ssh_file_perms: { label: 'CIS 5.1.1', url: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile` },
  net_ip_forward: { label: 'CIS 3.1.1', url: `${PVE_GUIDE_BASE}#122-network-separation` },
  net_icmp_redirects: { label: 'CIS 3.2.2', url: CIS_BENCHMARK_URL },
  net_source_routing: { label: 'CIS 3.2.1', url: CIS_BENCHMARK_URL },
  net_syn_cookies: { label: 'CIS 3.2.8', url: CIS_BENCHMARK_URL },
  net_rp_filter: { label: 'CIS 3.2.7', url: CIS_BENCHMARK_URL },
  svc_unnecessary_disabled: { label: 'CIS 2.1', url: CIS_BENCHMARK_URL },
  svc_apparmor: { label: 'CIS 1.4', url: CIS_BENCHMARK_URL },
  svc_auditd: { label: 'CIS 4.1.1', url: `${PVE_GUIDE_BASE}#512-auditd-for-etcpve` },
  svc_ntp_sync: { label: 'CIS 2.2.1', url: CIS_BENCHMARK_URL },
  svc_fail2ban: { label: 'CIS 2.3.3', url: `${PVE_GUIDE_BASE}#233-protect-the-gui-with-fail2ban` },
  fs_permissions: { label: 'CIS 6.1', url: CIS_BENCHMARK_URL },
  fs_suid_audit: { label: 'CIS 6.1.10', url: CIS_BENCHMARK_URL },
  fs_world_writable: { label: 'CIS 6.1.11', url: CIS_BENCHMARK_URL },
  fs_integrity: { label: 'CIS 1.3.1', url: `${PVE_GUIDE_BASE}#531-system-audits` },
  log_journald_persistent: { label: 'CIS 4.2.1', url: `${PVE_GUIDE_BASE}#511-centralized-logging` },
  log_syslog_forwarding: { label: 'CIS 4.2.3', url: `${PVE_GUIDE_BASE}#511-centralized-logging` },
  log_file_permissions: { label: 'CIS 4.2.4', url: CIS_BENCHMARK_URL },
}

// Recommendations for each check (shown in expanded details when check fails)
const CHECK_RECOMMENDATIONS: Record<string, string> = {
  cluster_fw_enabled: 'Enable the cluster firewall in Datacenter > Firewall > Options > Enable Firewall.',
  cluster_policy_in: 'Set Input Policy to DROP in Datacenter > Firewall > Options.',
  cluster_policy_out: 'Set Output Policy to DROP in Datacenter > Firewall > Options.',
  pve_version: 'Upgrade to the latest Proxmox VE version via apt update && apt dist-upgrade.',
  backup_schedule: 'Create a backup job in Datacenter > Backup with a regular schedule.',
  ha_enabled: 'Add critical VMs/CTs to HA in Datacenter > HA > Resources > Add.',
  storage_replication: 'Configure replication in VM > Replication > Add for cross-node data safety.',
  pool_isolation: 'Create resource pools in Datacenter > Permissions > Pools to separate workloads.',
  node_subscriptions: 'Purchase and apply a Proxmox subscription for enterprise repo access.',
  apt_repo_consistency: 'Disable the enterprise repository or add a valid subscription key.',
  tls_certificates: 'Replace self-signed certificates with valid ones (e.g., Let\'s Encrypt) via pvecm updatecerts.',
  node_firewalls: 'Enable the node firewall in Node > Firewall > Options > Enable Firewall.',
  node_firewall_logging: 'Enable log_level_in and log_level_out in Node > Firewall > Options.',
  root_tfa: 'Enable TOTP or WebAuthn for root@pam in Datacenter > Permissions > Two Factor.',
  admins_tfa: 'Require TFA for all user accounts in Datacenter > Permissions > Two Factor.',
  no_default_tokens: 'Remove or rename API tokens named "test", "default", or "tmp".',
  least_privilege_users: 'Migrate PAM users to PVE or LDAP realms for proper privilege separation.',
  vm_firewalls: 'Enable the firewall on each VM in VM > Firewall > Options > Enable Firewall.',
  vm_security_groups: 'Create security groups in Datacenter > Firewall > Security Group and assign them to VMs.',
  vm_vlan_isolation: 'Assign VLAN tags to VM network interfaces in VM > Hardware > Network Device.',
  vm_guest_agent: 'Enable the QEMU Guest Agent in VM > Options and install qemu-guest-agent in the guest OS.',
  vm_secure_boot: 'Change VM BIOS to OVMF (UEFI) in VM > Hardware > BIOS.',
  vm_no_usb_passthrough: 'Remove USB/PCI passthrough devices unless strictly required for the workload.',
  vm_cpu_isolation: 'Set CPU type to kvm64 or a specific model instead of "host" in VM > Hardware > Processor.',
  vm_ip_filter: 'Enable IP Filter in VM > Firewall > Options to prevent IP spoofing.',
  os_kernel_modules: 'Add modules to /etc/modprobe.d/blacklist.conf: install cramfs /bin/true, etc.',
  os_coredumps_disabled: 'Set Storage=none in /etc/systemd/coredump.conf and add "* hard core 0" to /etc/security/limits.conf.',
  os_mount_options: 'Add nodev,nosuid,noexec options for /dev/shm and /tmp in /etc/fstab.',
  os_auto_updates: 'Install and enable: apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades.',
  os_cpu_microcode: 'Install: apt install intel-microcode (Intel) or amd64-microcode (AMD).',
  os_disk_encryption: 'Use LUKS2 encryption during installation or ZFS native encryption for data-at-rest protection.',
  os_sysctl_hardening: 'Add to /etc/sysctl.d/99-hardening.conf: kernel.dmesg_restrict=1, kernel.kptr_restrict=2, kernel.randomize_va_space=2.',
  access_pam_faillock: 'Configure pam_faillock in /etc/pam.d/common-auth with deny=5 unlock_time=900.',
  access_password_aging: 'Set PASS_MAX_DAYS 365 and PASS_MIN_DAYS 1 in /etc/login.defs.',
  access_pw_quality: 'Install libpam-pwquality and configure minlen=14 in /etc/security/pwquality.conf.',
  access_shell_timeout: 'Add TMOUT=900 and readonly TMOUT to /etc/profile.d/timeout.sh.',
  access_login_banner: 'Configure authorized-use warning text in /etc/issue and /etc/issue.net.',
  ssh_strong_ciphers: 'Set Ciphers aes256-gcm@openssh.com,chacha20-poly1305@openssh.com,aes256-ctr in /etc/ssh/sshd_config.',
  ssh_strong_kex: 'Set KexAlgorithms curve25519-sha256,ecdh-sha2-nistp521 in /etc/ssh/sshd_config.',
  ssh_strong_macs: 'Set MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com in /etc/ssh/sshd_config.',
  ssh_root_login: 'Set PermitRootLogin prohibit-password (or no) in /etc/ssh/sshd_config.',
  ssh_max_auth_tries: 'Set MaxAuthTries 4 in /etc/ssh/sshd_config.',
  ssh_empty_passwords: 'Set PermitEmptyPasswords no in /etc/ssh/sshd_config.',
  ssh_idle_timeout: 'Set ClientAliveInterval 300 and ClientAliveCountMax 3 in /etc/ssh/sshd_config.',
  ssh_file_perms: 'Run: chmod 600 /etc/ssh/sshd_config && chmod 600 /etc/ssh/ssh_host_*_key.',
  net_ip_forward: 'Set net.ipv4.ip_forward=0 in /etc/sysctl.conf (note: Proxmox may need forwarding for VMs).',
  net_icmp_redirects: 'Set net.ipv4.conf.all.accept_redirects=0 and send_redirects=0 in /etc/sysctl.conf.',
  net_source_routing: 'Set net.ipv4.conf.all.accept_source_route=0 in /etc/sysctl.conf.',
  net_syn_cookies: 'Set net.ipv4.tcp_syncookies=1 in /etc/sysctl.conf.',
  net_rp_filter: 'Set net.ipv4.conf.all.rp_filter=1 in /etc/sysctl.conf.',
  svc_unnecessary_disabled: 'Disable unnecessary services: systemctl disable --now bluetooth cups avahi-daemon.',
  svc_apparmor: 'Install and enable: apt install apparmor apparmor-utils && aa-enforce /etc/apparmor.d/*.',
  svc_auditd: 'Install and enable: apt install auditd && systemctl enable --now auditd.',
  svc_ntp_sync: 'Ensure chrony or systemd-timesyncd is running: systemctl enable --now chrony.',
  svc_fail2ban: 'Install and enable: apt install fail2ban && systemctl enable --now fail2ban.',
  fs_permissions: 'Fix permissions: chmod 644 /etc/passwd /etc/group && chmod 640 /etc/shadow /etc/gshadow.',
  fs_suid_audit: 'Audit SUID/SGID files: find / -perm /6000 -type f and remove unnecessary setuid bits.',
  fs_world_writable: 'Find and fix: find / -xdev -type f -perm -0002 -exec chmod o-w {} \\;.',
  fs_integrity: 'Install AIDE: apt install aide && aideinit && systemctl enable aide-check.timer.',
  log_journald_persistent: 'Set Storage=persistent in /etc/systemd/journald.conf and restart systemd-journald.',
  log_syslog_forwarding: 'Configure rsyslog forwarding: add *.* @@remote-server:514 to /etc/rsyslog.d/50-remote.conf.',
  log_file_permissions: 'Restrict permissions: chmod -R g-wx,o-rwx /var/log/*.',
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

// All 25 check IDs with readable names and descriptions
const ALL_CHECKS = [
  { id: 'cluster_fw_enabled', name: 'Cluster firewall enabled', category: 'cluster', description: 'Verifies the datacenter-level firewall is active. Without it, no firewall rules are enforced across the cluster.' },
  { id: 'cluster_policy_in', name: 'Inbound policy = DROP', category: 'cluster', description: 'Checks that the default inbound policy is DROP or REJECT, blocking all unsolicited traffic unless explicitly allowed by rules.' },
  { id: 'cluster_policy_out', name: 'Outbound policy = DROP', category: 'cluster', description: 'Checks that the default outbound policy restricts egress traffic, preventing compromised VMs from freely communicating outbound.' },
  { id: 'pve_version', name: 'PVE version up to date', category: 'cluster', description: 'Ensures the Proxmox VE version is on the latest major release to benefit from security patches and new features.' },
  { id: 'backup_schedule', name: 'Backup jobs configured', category: 'cluster', description: 'Verifies that at least one backup job is enabled in Datacenter > Backup, ensuring data can be recovered after incidents.' },
  { id: 'ha_enabled', name: 'High availability configured', category: 'cluster', description: 'Checks whether critical VMs are added to the HA manager for automatic failover if a node goes down.' },
  { id: 'storage_replication', name: 'Storage replication configured', category: 'cluster', description: 'Verifies that storage replication jobs exist to keep VM data synchronized across nodes for disaster recovery.' },
  { id: 'pool_isolation', name: 'Resource pool isolation', category: 'cluster', description: 'Checks that resource pools are used to logically separate workloads and enforce access control boundaries.' },
  { id: 'node_subscriptions', name: 'Valid subscriptions', category: 'node', description: 'Verifies all nodes have an active Proxmox subscription, required for enterprise repository access and vendor support.' },
  { id: 'apt_repo_consistency', name: 'APT repository consistency', category: 'node', description: 'Detects nodes that have the enterprise repository enabled but lack a valid subscription, causing update failures.' },
  { id: 'tls_certificates', name: 'Valid TLS certificates', category: 'node', description: 'Checks that PVE web interface certificates are valid, not expired, and ideally not self-signed, to prevent MITM attacks.' },
  { id: 'node_firewalls', name: 'Node firewalls enabled', category: 'node', description: 'Verifies the host-level firewall is enabled on each node, protecting the hypervisor management interfaces.' },
  { id: 'node_firewall_logging', name: 'Firewall logging enabled', category: 'node', description: 'Checks that firewall logging is active on nodes for audit trails and incident investigation capabilities.' },
  { id: 'root_tfa', name: 'TFA for root@pam', category: 'access', description: 'Ensures the root@pam superuser account is protected with two-factor authentication (TOTP or WebAuthn).' },
  { id: 'admins_tfa', name: 'TFA for admin users', category: 'access', description: 'Verifies all enabled user accounts have two-factor authentication configured to prevent credential theft attacks.' },
  { id: 'no_default_tokens', name: 'No default API tokens', category: 'access', description: 'Detects API tokens with suspicious names (test, default, tmp) that may indicate leftover or insecure credentials.' },
  { id: 'least_privilege_users', name: 'Least privilege access', category: 'access', description: 'Checks that most users use PVE/LDAP realms instead of direct PAM access, enforcing proper privilege separation.' },
  { id: 'vm_firewalls', name: 'Firewall on all VMs', category: 'vm', description: 'Verifies that every VM and container has its individual firewall enabled for per-guest network filtering.' },
  { id: 'vm_security_groups', name: 'VMs have security groups', category: 'vm', description: 'Checks that VMs have security group rules applied, enabling centralized and reusable firewall rule management.' },
  { id: 'vm_vlan_isolation', name: 'VMs use VLAN isolation', category: 'vm', description: 'Verifies that VM network interfaces use VLAN tags to isolate traffic between different network segments.' },
  { id: 'vm_guest_agent', name: 'QEMU guest agent enabled', category: 'vm', description: 'Checks that the QEMU guest agent is enabled for proper shutdown, freeze/thaw snapshots, and IP reporting.' },
  { id: 'vm_secure_boot', name: 'UEFI boot enabled', category: 'vm', description: 'Verifies VMs use OVMF/UEFI firmware instead of legacy BIOS, enabling Secure Boot and modern security features.' },
  { id: 'vm_no_usb_passthrough', name: 'No USB/PCI passthrough', category: 'vm', description: 'Detects VMs with USB or PCI device passthrough, which bypasses the hypervisor isolation boundary.' },
  { id: 'vm_cpu_isolation', name: 'CPU type isolation', category: 'vm', description: 'Checks that VMs use emulated CPU types instead of host passthrough, maintaining migration compatibility and isolation.' },
  { id: 'vm_ip_filter', name: 'VM IP filter enabled', category: 'vm', description: 'Verifies that IP filtering is enabled on VM firewalls to prevent IP spoofing and unauthorized network access.' },
  // --- CIS Benchmark: OS Hardening (SSH-based) ---
  { id: 'os_kernel_modules', name: 'Dangerous kernel modules disabled', category: 'os', description: 'CIS 1.1.1 — Checks that unused filesystem and network kernel modules (cramfs, freevxfs, hfs, jffs2, usb-storage) are disabled or blacklisted.' },
  { id: 'os_coredumps_disabled', name: 'Core dumps disabled', category: 'os', description: 'CIS 1.5.11 — Verifies core dumps are disabled via systemd coredump.conf and limits.conf to prevent sensitive data leakage.' },
  { id: 'os_mount_options', name: 'Secure mount options on /dev/shm, /tmp', category: 'os', description: 'CIS 1.6.1 — Checks that /dev/shm and /tmp are mounted with nodev, nosuid, noexec to prevent privilege escalation.' },
  { id: 'os_auto_updates', name: 'Automatic security updates', category: 'os', description: 'CIS 1.1.3 — Verifies unattended-upgrades is installed and enabled for automatic security patch application.' },
  { id: 'os_cpu_microcode', name: 'CPU microcode installed', category: 'os', description: 'CIS 1.1.8 — Checks that CPU microcode (intel-microcode or amd64-microcode) is installed to mitigate hardware vulnerabilities.' },
  { id: 'os_disk_encryption', name: 'Disk encryption (LUKS/ZFS)', category: 'os', description: 'CIS 1.1.5 — Detects full-disk encryption via LUKS2 or ZFS native encryption for data-at-rest protection.' },
  { id: 'os_sysctl_hardening', name: 'Kernel security parameters', category: 'os', description: 'Checks kernel security params: dmesg_restrict, kptr_restrict, ASLR, protected_hardlinks/symlinks, sysrq disabled.' },
  { id: 'access_pam_faillock', name: 'Account lockout (PAM faillock)', category: 'os', description: 'CIS 5.3.3 — Verifies PAM faillock or pam_tally2 is configured to lock accounts after failed login attempts.' },
  { id: 'access_password_aging', name: 'Password aging policy', category: 'os', description: 'CIS 5.4.1 — Checks PASS_MAX_DAYS in /etc/login.defs is set to 365 days or less to enforce password rotation.' },
  { id: 'access_pw_quality', name: 'Password quality enforcement', category: 'os', description: 'CIS 5.3.1 — Verifies libpam-pwquality is installed and configured for minimum password complexity requirements.' },
  { id: 'access_shell_timeout', name: 'Shell idle timeout (TMOUT)', category: 'os', description: 'CIS 5.4.3 — Checks that TMOUT is set in shell profiles to automatically disconnect idle sessions.' },
  { id: 'access_login_banner', name: 'Login warning banner', category: 'os', description: 'CIS 1.7.1 — Verifies a legal warning banner is configured in /etc/issue and /etc/issue.net for authorized-use notices.' },
  // --- CIS Benchmark: SSH Hardening ---
  { id: 'ssh_strong_ciphers', name: 'SSH strong ciphers only', category: 'ssh', description: 'CIS 5.1.4 — Verifies sshd_config uses only strong ciphers (AES-GCM, ChaCha20) and no weak CBC ciphers.' },
  { id: 'ssh_strong_kex', name: 'SSH strong key exchange', category: 'ssh', description: 'CIS 5.1.5 — Checks that only secure key exchange algorithms (curve25519, ecdh-sha2) are configured.' },
  { id: 'ssh_strong_macs', name: 'SSH strong MACs', category: 'ssh', description: 'CIS 5.1.6 — Verifies only SHA-2 based MAC algorithms are used, with no MD5 or SHA-1 MACs.' },
  { id: 'ssh_root_login', name: 'SSH root login restricted', category: 'ssh', description: 'CIS 5.1.21 — Checks PermitRootLogin is set to "no" or "prohibit-password" to limit direct root access.' },
  { id: 'ssh_max_auth_tries', name: 'SSH MaxAuthTries <= 4', category: 'ssh', description: 'CIS 5.1.12 — Verifies MaxAuthTries is 4 or less to limit brute-force authentication attempts per connection.' },
  { id: 'ssh_empty_passwords', name: 'SSH empty passwords disabled', category: 'ssh', description: 'CIS 5.1.17 — Ensures PermitEmptyPasswords is "no" to prevent login without credentials.' },
  { id: 'ssh_idle_timeout', name: 'SSH idle timeout configured', category: 'ssh', description: 'CIS 5.1.20 — Checks ClientAliveInterval and ClientAliveCountMax are set for a maximum 15-minute idle timeout.' },
  { id: 'ssh_file_perms', name: 'SSH file permissions', category: 'ssh', description: 'CIS 5.1.1 — Verifies sshd_config (600) and host private keys (600) have restrictive file permissions.' },
  // --- CIS Benchmark: Network ---
  { id: 'net_ip_forward', name: 'IP forwarding disabled', category: 'network', description: 'CIS 3.1.1 — Checks net.ipv4.ip_forward is 0 to prevent the node from acting as a router (expected on Proxmox routers).' },
  { id: 'net_icmp_redirects', name: 'ICMP redirects disabled', category: 'network', description: 'CIS 3.2.2 — Verifies ICMP redirect acceptance and sending are disabled to prevent routing table manipulation.' },
  { id: 'net_source_routing', name: 'Source routing disabled', category: 'network', description: 'CIS 3.2.1 — Checks source-routed packets are rejected to prevent attackers from specifying packet routes.' },
  { id: 'net_syn_cookies', name: 'TCP SYN cookies enabled', category: 'network', description: 'CIS 3.2.8 — Verifies TCP SYN cookies are enabled to protect against SYN flood denial-of-service attacks.' },
  { id: 'net_rp_filter', name: 'Reverse path filtering enabled', category: 'network', description: 'CIS 3.2.7 — Checks reverse path filtering is active to drop packets with spoofed source addresses.' },
  // --- CIS Benchmark: Services ---
  { id: 'svc_unnecessary_disabled', name: 'Unnecessary services disabled', category: 'services', description: 'CIS 2.1 — Verifies non-essential services (bluetooth, cups, avahi-daemon) are not running on hypervisor nodes.' },
  { id: 'svc_apparmor', name: 'AppArmor enabled', category: 'services', description: 'CIS 1.4 — Checks that AppArmor mandatory access control is active and enforcing security profiles.' },
  { id: 'svc_auditd', name: 'Audit daemon installed and running', category: 'services', description: 'CIS 4.1.1 — Verifies auditd is installed and active for system call auditing and security event logging.' },
  { id: 'svc_ntp_sync', name: 'NTP time synchronization', category: 'services', description: 'CIS 2.2.1 — Checks that time synchronization (chrony/systemd-timesyncd/ntp) is active for accurate logging.' },
  { id: 'svc_fail2ban', name: 'Fail2Ban installed and running', category: 'services', description: 'CIS 2.3.3 — Verifies Fail2Ban is protecting against brute-force attacks on SSH and the PVE web interface.' },
  // --- CIS Benchmark: Filesystem ---
  { id: 'fs_permissions', name: 'Critical file permissions', category: 'filesystem', description: 'CIS 6.1 — Checks permissions on /etc/passwd (644), /etc/shadow (640), /etc/group (644), /etc/gshadow (640).' },
  { id: 'fs_suid_audit', name: 'SUID/SGID files audit', category: 'filesystem', description: 'CIS 6.1.10 — Counts SUID/SGID binaries on the system. Excessive count may indicate unauthorized privilege escalation tools.' },
  { id: 'fs_world_writable', name: 'No world-writable files', category: 'filesystem', description: 'CIS 6.1.11 — Detects world-writable files outside /tmp that could be modified by any user for privilege escalation.' },
  { id: 'fs_integrity', name: 'File integrity monitoring', category: 'filesystem', description: 'CIS 1.3.1 — Verifies AIDE or debsums is installed for detecting unauthorized file modifications on the system.' },
  // --- CIS Benchmark: Logging ---
  { id: 'log_journald_persistent', name: 'Journald persistent storage', category: 'logging', description: 'CIS 4.2.1 — Checks journald is configured with Storage=persistent for durable log retention across reboots.' },
  { id: 'log_syslog_forwarding', name: 'Syslog remote forwarding', category: 'logging', description: 'CIS 4.2.3 — Verifies rsyslog is configured to forward logs to a remote server for centralized logging and SIEM.' },
  { id: 'log_file_permissions', name: 'Log file permissions', category: 'logging', description: 'CIS 4.2.4 — Checks /var/log permissions are restrictive and log files are not world-readable.' },
]

// Map check ID -> description for quick lookup in table
const CHECK_DESCRIPTIONS: Record<string, string> = Object.fromEntries(ALL_CHECKS.map(c => [c.id, c.description]))

// ============================================================================
// Hardening Tab
// ============================================================================
function HardeningTab() {
  const t = useTranslations()
  const { data: connectionsData } = usePVEConnections()
  const connections = connectionsData?.data || []
  const { data: profilesData } = useComplianceProfiles()
  const profiles = profilesData?.data || []

  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [selectedProfile, setSelectedProfile] = useState<any>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const profileId = selectedProfile?.id || null
  const { data, isLoading, mutate } = useHardeningChecks(selectedConnection?.id, profileId)

  // Auto-select first connection
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0])
    }
  }, [connections, selectedConnection])

  // Sort checks: fail > warning > pass > skip
  const statusOrder: Record<string, number> = { fail: 0, warning: 1, pass: 2, skip: 3 }
  const checks = [...(data?.checks || [])].sort((a: any, b: any) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))
  const categories = [...new Set(checks.map((c: any) => c.category))]
  const filteredChecks = categoryFilter ? checks.filter((c: any) => c.category === categoryFilter) : checks
  const summary = data?.summary || { score: 0, total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical: 0 }
  const score = data?.score ?? 0
  const hasProfile = !!profileId || !!data?.profileId

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Profile options: "All checks" + all profiles
  const profileOptions = [
    { id: null, name: t('compliance.allChecks') },
    ...profiles,
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>
      {/* Connection selector + profile selector + scan button */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        <Autocomplete
          options={connections}
          getOptionLabel={(opt: any) => opt.name || opt.id}
          value={selectedConnection}
          onChange={(_, v) => setSelectedConnection(v)}
          renderInput={(params) => (
            <TextField {...params} label={t('compliance.selectConnection')} size="small" />
          )}
          sx={{ minWidth: 280 }}
        />
        <Autocomplete
          options={profileOptions}
          getOptionLabel={(opt: any) => opt.name || ''}
          value={selectedProfile ? profileOptions.find(p => p.id === selectedProfile.id) || profileOptions[0] : profileOptions[0]}
          onChange={(_, v) => setSelectedProfile(v?.id ? v : null)}
          renderInput={(params) => (
            <TextField {...params} label={t('compliance.selectProfile')} size="small" />
          )}
          sx={{ minWidth: 220 }}
        />
        <Button
          variant="contained"
          startIcon={<i className="ri-refresh-line" />}
          onClick={() => mutate()}
          disabled={!selectedConnection || isLoading}
        >
          {t('compliance.runScan')}
        </Button>
      </Box>

      {isLoading && (
        <>
          <CardsSkeleton count={4} columns={4} />
          <TableSkeleton />
        </>
      )}

      {!isLoading && data && (
        <>
          {/* Active profile badge + SSH status */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {hasProfile && (
              <Chip
                icon={<i className="ri-shield-check-line" />}
                label={`${t('compliance.activeProfile')}: ${
                  profiles.find((p: any) => p.id === (profileId || data?.profileId))?.name || profileId || data?.profileId
                }`}
                color="primary"
                variant="outlined"
              />
            )}
            {data?.sshStatus && (!data.sshStatus.enabled || data.sshStatus.available < data.sshStatus.total) && (
              <Chip
                icon={<i className="ri-terminal-box-line" />}
                label={
                  !data.sshStatus.enabled
                    ? t('compliance.sshNotConfigured')
                    : `SSH: ${data.sshStatus.available}/${data.sshStatus.total} ${t('compliance.nodesReachable')}`
                }
                color={
                  !data.sshStatus.enabled ? 'default'
                    : data.sshStatus.available > 0 ? 'warning' : 'error'
                }
                variant="outlined"
                size="small"
              />
            )}
          </Box>

          {/* Score gauge + stat cards */}
          <Grid container spacing={3} columns={5} sx={{ flexShrink: 0 }}>
            {/* Score gauge */}
            <Grid size={{ xs: 5, sm: 2.5, md: 1 }}>
              <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                    <CircularProgress
                      variant="determinate"
                      value={100}
                      size={90}
                      thickness={4}
                      sx={{ color: 'action.hover', position: 'absolute' }}
                    />
                    <CircularProgress
                      variant="determinate"
                      value={score}
                      size={90}
                      thickness={4}
                      sx={{ color: scoreColor(score) }}
                    />
                    <Box sx={{
                      top: 0, left: 0, bottom: 0, right: 0,
                      position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography variant="h4" fontWeight={700} color={scoreColor(score)}>
                        {score}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('compliance.hardeningScore')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            {/* Stat cards */}
            {[
              { label: t('compliance.totalChecks'), value: summary.total, icon: 'ri-list-check-2', color: '#6366f1' },
              { label: t('compliance.passed'), value: summary.passed, icon: 'ri-check-line', color: '#22c55e' },
              { label: t('compliance.failed'), value: summary.failed, icon: 'ri-close-line', color: '#ef4444' },
              { label: t('compliance.criticalIssues'), value: summary.critical, icon: 'ri-error-warning-line', color: '#dc2626' },
            ].map((stat) => (
              <Grid size={{ xs: 2.5, md: 1 }} key={stat.label}>
                <Card sx={{ height: '100%' }}>
                  <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, '&:last-child': { pb: 2 } }}>
                    <Box sx={{
                      width: 48, height: 48, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: `${stat.color}15`,
                    }}>
                      <i className={stat.icon} style={{ fontSize: 24, color: stat.color }} />
                    </Box>
                    <Typography variant="h4" fontWeight={700}>{stat.value}</Typography>
                    <Typography variant="body2" color="text.secondary" textAlign="center">{stat.label}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Category filter chips */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Chip
              label={t('common.all')}
              size="small"
              variant={categoryFilter === null ? 'filled' : 'outlined'}
              onClick={() => setCategoryFilter(null)}
            />
            {categories.map((cat: string) => (
              <Chip
                key={cat}
                icon={<i className={categoryIcons[cat] || 'ri-question-line'} style={{ fontSize: 14 }} />}
                label={t(`compliance.categories.${cat}`)}
                size="small"
                variant={categoryFilter === cat ? 'filled' : 'outlined'}
                onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                sx={categoryFilter === cat ? {
                  bgcolor: `${categoryColors[cat]}20`,
                  borderColor: categoryColors[cat],
                  color: categoryColors[cat],
                  '& .MuiChip-icon': { color: categoryColors[cat] },
                } : undefined}
              />
            ))}
          </Box>

          {/* Results Table */}
          <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t('compliance.checkName')}</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>{t('compliance.description')}</TableCell>
                    <TableCell>{t('compliance.category')}</TableCell>
                    <TableCell>{t('compliance.severity')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('compliance.points')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredChecks.map((check: any) => {
                    const isExpanded = expandedRows.has(check.id)
                    const catColor = categoryColors[check.category] || '#6366f1'
                    return (
                      <Fragment key={check.id}>
                        <TableRow
                          hover
                          onClick={() => toggleRow(check.id)}
                          sx={{ cursor: 'pointer', '& > td': { borderBottom: isExpanded ? 'none' : undefined } }}
                        >
                          <TableCell padding="checkbox">
                            <IconButton size="small">
                              <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={500}>{check.name}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                              {CHECK_DESCRIPTIONS[check.id] || '-'}
                            </Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              icon={<i className={categoryIcons[check.category] || 'ri-question-line'} />}
                              label={t(`compliance.categories.${check.category}`)}
                              size="small"
                              variant="outlined"
                              sx={{
                                borderColor: `${catColor}60`,
                                bgcolor: `${catColor}10`,
                                color: catColor,
                                '& .MuiChip-icon': { color: catColor },
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t(`compliance.severities.${check.severity}`)}
                              size="small"
                              color={severityColors[check.severity] || 'default'}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t(`compliance.statuses.${check.status}`)}
                              size="small"
                              color={statusColors[check.status] || 'default'}
                              variant={check.status === 'pass' ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color={check.earned === check.maxPoints ? 'success.main' : 'text.secondary'}>
                              {hasProfile ? `${check.weightedEarned ?? check.earned}/${check.weightedMaxPoints ?? check.maxPoints}` : `${check.earned}/${check.maxPoints}`}
                            </Typography>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={7} sx={{ py: 0, px: 0 }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 2, px: 4, pl: 8, bgcolor: 'action.hover' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                                  {CIS_REFS[check.id] && (
                                    <Chip
                                      component="a"
                                      href={CIS_REFS[check.id].url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      clickable
                                      icon={<i className="ri-external-link-line" style={{ fontSize: 14 }} />}
                                      label={CIS_REFS[check.id].label}
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                                    />
                                  )}
                                  {check.entity && (
                                    <Chip
                                      icon={<i className="ri-focus-3-line" style={{ fontSize: 14 }} />}
                                      label={check.entity}
                                      size="small"
                                      variant="outlined"
                                      sx={{ fontSize: '0.75rem' }}
                                    />
                                  )}
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                  <i className="ri-information-line" style={{ fontSize: 16, color: '#6366f1', marginTop: 2, flexShrink: 0 }} />
                                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                    {check.details || '—'}
                                  </Typography>
                                </Box>
                                {check.status !== 'pass' && check.status !== 'skip' && CHECK_RECOMMENDATIONS[check.id] && (
                                  <>
                                    <Divider sx={{ my: 1.5 }} />
                                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                      <i className="ri-lightbulb-line" style={{ fontSize: 16, color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
                                      <Box>
                                        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                                          {t('compliance.recommendation')}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                                          {CHECK_RECOMMENDATIONS[check.id]}
                                        </Typography>
                                      </Box>
                                    </Box>
                                  </>
                                )}
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          {data.scannedAt && (
            <Typography variant="caption" color="text.secondary" textAlign="right">
              {t('compliance.lastScan')}: {new Date(data.scannedAt).toLocaleString()}
            </Typography>
          )}
        </>
      )}

      {!isLoading && !data && selectedConnection && (
        <Alert severity="info">{t('compliance.clickScan')}</Alert>
      )}
    </Box>
  )
}

// ============================================================================
// Profiles Tab
// ============================================================================
function ProfilesTab() {
  const t = useTranslations()
  const { data: profilesData, mutate: mutateProfiles } = useComplianceProfiles()
  const profiles = profilesData?.data || []

  const [editDialog, setEditDialog] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleCreateBlank = () => {
    setEditDialog({
      isNew: true,
      name: '',
      description: '',
      checks: ALL_CHECKS.map(c => ({
        check_id: c.id,
        enabled: true,
        weight: 1.0,
        control_ref: '',
        category: c.category,
      })),
    })
  }

  const handleEditProfile = async (profileId: string) => {
    try {
      const res = await fetch(`/api/v1/compliance/profiles/${profileId}`)
      if (!res.ok) throw new Error('Failed to load profile')
      const { data: profile } = await res.json()

      // Merge with ALL_CHECKS to ensure all 25 checks are represented
      const mergedChecks = ALL_CHECKS.map(ac => {
        const existing = profile.checks.find((c: any) => c.check_id === ac.id)
        if (existing) {
          return {
            check_id: existing.check_id,
            enabled: existing.enabled === 1,
            weight: existing.weight,
            control_ref: existing.control_ref || '',
            category: existing.category || ac.category,
          }
        }
        return { check_id: ac.id, enabled: false, weight: 1.0, control_ref: '', category: ac.category }
      })

      setEditDialog({
        isNew: false,
        id: profile.id,
        name: profile.name,
        description: profile.description || '',
        checks: mergedChecks,
      })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleSaveProfile = async () => {
    if (!editDialog || !editDialog.name) return
    setCreating(true)

    try {
      if (editDialog.isNew) {
        // Create new profile
        const res = await fetch('/api/v1/compliance/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editDialog.name,
            description: editDialog.description,
          }),
        })
        if (!res.ok) throw new Error('Failed to create profile')
        const { data: profile } = await res.json()

        // Update checks
        await fetch(`/api/v1/compliance/profiles/${profile.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checks: editDialog.checks }),
        })
      } else {
        // Update existing
        await fetch(`/api/v1/compliance/profiles/${editDialog.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editDialog.name,
            description: editDialog.description,
            checks: editDialog.checks,
          }),
        })
      }

      mutateProfiles()
      setEditDialog(null)
      setToast({ type: 'success', message: t('compliance.profileSaved') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm(t('compliance.confirmDeleteProfile'))) return
    try {
      await fetch(`/api/v1/compliance/profiles/${profileId}`, { method: 'DELETE' })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profileDeleted') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleActivateProfile = async (profileId: string) => {
    try {
      await fetch(`/api/v1/compliance/profiles/${profileId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profileActivated') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleDeactivateAll = async () => {
    try {
      await fetch('/api/v1/compliance/profiles/none/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profilesDeactivated') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>
      {toast && (
        <Alert severity={toast.type} onClose={() => setToast(null)} sx={{ flexShrink: 0 }}>
          {toast.message}
        </Alert>
      )}

      {/* Description */}
      <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
        {t('compliance.profilesDescription')}
      </Typography>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<i className="ri-add-line" />}
          onClick={handleCreateBlank}
        >
          {t('compliance.createProfile')}
        </Button>
        {profiles.some((p: any) => p.is_active) && (
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<i className="ri-close-circle-line" />}
            onClick={handleDeactivateAll}
          >
            {t('compliance.deactivateAll')}
          </Button>
        )}
      </Box>

      {profiles.length === 0 && (
        <Alert severity="info">{t('compliance.noProfiles')}</Alert>
      )}

      {profiles.length > 0 && (
        <Card sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <TableContainer sx={{ flex: 1, overflow: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('compliance.profileName')}</TableCell>
                  <TableCell>{t('compliance.profileDescription')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell>{t('common.created')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((p: any) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={p.is_active ? 600 : 400}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {p.description || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {p.is_active ? (
                        <Chip label={t('compliance.active')} size="small" color="success" />
                      ) : (
                        <Chip label={t('compliance.inactive')} size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(p.created_at).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('compliance.activate')}>
                        <IconButton size="small" onClick={() => handleActivateProfile(p.id)} disabled={p.is_active}>
                          <i className="ri-check-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => handleEditProfile(p.id)}>
                          <i className="ri-edit-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" color="error" onClick={() => handleDeleteProfile(p.id)}>
                          <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* Profile Editor Dialog */}
      <Dialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editDialog?.isNew ? t('compliance.createProfile') : t('compliance.editProfile')}
        </DialogTitle>
        <DialogContent>
          {editDialog && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                label={t('compliance.profileName')}
                value={editDialog.name}
                onChange={(e) => setEditDialog((prev: any) => ({ ...prev, name: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label={t('compliance.profileDescription')}
                value={editDialog.description}
                onChange={(e) => setEditDialog((prev: any) => ({ ...prev, description: e.target.value }))}
                size="small"
                fullWidth
                multiline
                rows={2}
              />
              <Divider />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">{t('compliance.checks')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {editDialog.checks.filter((c: any) => c.enabled).length}/{ALL_CHECKS.length} {t('compliance.enabled').toLowerCase()}
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">{t('compliance.enabled')}</TableCell>
                    <TableCell>{t('compliance.checkName')}</TableCell>
                    <TableCell>{t('compliance.category')}</TableCell>
                    <TableCell>{t('compliance.weight')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {editDialog.checks.map((check: any, idx: number) => {
                    const checkDef = ALL_CHECKS.find(c => c.id === check.check_id)
                    return (
                      <TableRow key={check.check_id}>
                        <TableCell padding="checkbox">
                          <Switch
                            size="small"
                            checked={check.enabled}
                            onChange={(e) => {
                              setEditDialog((prev: any) => {
                                const checks = [...prev.checks]
                                checks[idx] = { ...checks[idx], enabled: e.target.checked }
                                return { ...prev, checks }
                              })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color={check.enabled ? 'text.primary' : 'text.disabled'}>
                            {checkDef?.name || check.check_id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            icon={<i className={categoryIcons[checkDef?.category || ''] || 'ri-question-line'} />}
                            label={checkDef?.category || '-'}
                            size="small"
                            variant="outlined"
                            sx={{ opacity: check.enabled ? 1 : 0.5 }}
                          />
                        </TableCell>
                        <TableCell sx={{ width: 140 }}>
                          <Slider
                            value={check.weight}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                            size="small"
                            disabled={!check.enabled}
                            valueLabelDisplay="auto"
                            onChange={(_, val) => {
                              setEditDialog((prev: any) => {
                                const checks = [...prev.checks]
                                checks[idx] = { ...checks[idx], weight: val as number }
                                return { ...prev, checks }
                              })
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSaveProfile}
            disabled={creating || !editDialog?.name}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ============================================================================
// Policies Tab
// ============================================================================
function PoliciesTab() {
  const t = useTranslations()
  const { data, isLoading, mutate } = useSecurityPolicies()
  const policies = data?.data

  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (policies && !form) {
      setForm({ ...policies })
    }
  }, [policies, form])

  const handleChange = useCallback((field: string, value: any) => {
    setForm((prev: any) => prev ? { ...prev, [field]: value } : prev)
  }, [])

  const handleSave = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/v1/compliance/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }
      mutate()
      setToast({ type: 'success', message: t('compliance.policiesSaved') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }, [form, mutate, t])

  if (isLoading || !form) return <CardsSkeleton count={4} columns={2} />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {toast && (
        <Alert severity={toast.type} onClose={() => setToast(null)}>
          {toast.message}
        </Alert>
      )}

      <Grid container spacing={3} sx={{ alignItems: 'stretch' }}>
        {/* Password Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-lock-password-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.passwordPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.minLength')}
                  value={form.password_min_length}
                  onChange={(e) => handleChange('password_min_length', parseInt(e.target.value) || 0)}
                  size="small"
                  inputProps={{ min: 1, max: 128 }}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_uppercase} onChange={(e) => handleChange('password_require_uppercase', e.target.checked)} />}
                  label={t('compliance.requireUppercase')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_lowercase} onChange={(e) => handleChange('password_require_lowercase', e.target.checked)} />}
                  label={t('compliance.requireLowercase')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_numbers} onChange={(e) => handleChange('password_require_numbers', e.target.checked)} />}
                  label={t('compliance.requireNumbers')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_special} onChange={(e) => handleChange('password_require_special', e.target.checked)} />}
                  label={t('compliance.requireSpecial')}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Session Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-time-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.sessionPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.sessionTimeout')}
                  value={form.session_timeout_minutes}
                  onChange={(e) => handleChange('session_timeout_minutes', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.sessionTimeoutHelper')}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  type="number"
                  label={t('compliance.maxConcurrentSessions')}
                  value={form.session_max_concurrent}
                  onChange={(e) => handleChange('session_max_concurrent', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.maxConcurrentHelper')}
                  inputProps={{ min: 0 }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Login Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-login-box-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.loginPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.maxFailedAttempts')}
                  value={form.login_max_failed_attempts}
                  onChange={(e) => handleChange('login_max_failed_attempts', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.maxFailedHelper')}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  type="number"
                  label={t('compliance.lockoutDuration')}
                  value={form.login_lockout_duration_minutes}
                  onChange={(e) => handleChange('login_lockout_duration_minutes', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.lockoutHelper')}
                  inputProps={{ min: 0 }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Audit Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-file-list-3-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.auditPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.retentionDays')}
                  value={form.audit_retention_days}
                  onChange={(e) => handleChange('audit_retention_days', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.retentionHelper')}
                  inputProps={{ min: 1 }}
                />
                <FormControlLabel
                  control={<Switch checked={form.audit_auto_cleanup} onChange={(e) => handleChange('audit_auto_cleanup', e.target.checked)} />}
                  label={t('compliance.autoCleanup')}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Save button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <i className="ri-save-line" />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </Box>
    </Box>
  )
}

// ============================================================================
// Main Page
// ============================================================================
export default function CompliancePage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const [tab, setTab] = useState(0)

  useEffect(() => {
    setPageInfo(t('compliance.title'), '', 'ri-shield-check-line')
  }, [setPageInfo, t])

  return (
    <EnterpriseGuard requiredFeature={Features.COMPLIANCE}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minHeight: 0 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ flexShrink: 0 }}>
          <Tab
            icon={<i className="ri-shield-check-line" />}
            iconPosition="start"
            label={t('compliance.hardening')}
          />
          <Tab
            icon={<i className="ri-profile-line" />}
            iconPosition="start"
            label={t('compliance.profiles')}
          />
          <Tab
            icon={<i className="ri-file-shield-2-line" />}
            iconPosition="start"
            label={t('compliance.policies')}
          />
        </Tabs>

        {tab === 0 && <HardeningTab />}
        {tab === 1 && <ProfilesTab />}
        {tab === 2 && <PoliciesTab />}
      </Box>
    </EnterpriseGuard>
  )
}
