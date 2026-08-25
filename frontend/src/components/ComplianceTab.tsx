'use client'

import { Fragment, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Card, CardContent, Chip, CircularProgress,
  Collapse, Divider, IconButton, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tooltip, Typography, Grid
} from '@mui/material'

import { useHardeningChecks } from '@/hooks/useHardeningChecks'

const severityColors: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error', high: 'error', medium: 'warning', low: 'info',
}

const statusColors: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  pass: 'success', fail: 'error', warning: 'warning', skip: 'default',
}

const categoryIcons: Record<string, string> = {
  cluster: 'ri-server-line', node: 'ri-computer-line', access: 'ri-shield-user-line',
  vm: 'ri-instance-line', os: 'ri-terminal-box-line', ssh: 'ri-key-2-line',
  network: 'ri-global-line', services: 'ri-settings-3-line',
  filesystem: 'ri-folder-shield-2-line', logging: 'ri-file-list-3-line',
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

// Descriptions, recommendations & CIS references for each check
const CHECK_INFO: Record<string, { description: string; recommendation: string; cisRef?: string; cisUrl?: string }> = {
  cluster_fw_enabled: { description: 'Verifies the datacenter-level firewall is active.', recommendation: 'Enable the cluster firewall in Datacenter > Firewall > Options > Enable Firewall.' },
  cluster_policy_in: { description: 'Checks that the default inbound policy is DROP or REJECT.', recommendation: 'Set Input Policy to DROP in Datacenter > Firewall > Options.' },
  cluster_policy_out: { description: 'Checks that the default outbound policy restricts egress.', recommendation: 'Set Output Policy to DROP in Datacenter > Firewall > Options.' },
  pve_version: { description: 'Ensures PVE is on the latest major release.', recommendation: 'Upgrade to the latest Proxmox VE version via apt update && apt dist-upgrade.' },
  backup_schedule: { description: 'Verifies backup jobs are configured.', recommendation: 'Create a backup job in Datacenter > Backup with a regular schedule.' },
  ha_enabled: { description: 'Checks if HA is configured for critical VMs.', recommendation: 'Add critical VMs/CTs to HA in Datacenter > HA > Resources > Add.' },
  storage_replication: { description: 'Verifies storage replication jobs exist.', recommendation: 'Configure replication in VM > Replication > Add for cross-node data safety.' },
  pool_isolation: { description: 'Checks that resource pools are used for isolation.', recommendation: 'Create resource pools in Datacenter > Permissions > Pools to separate workloads.' },
  node_subscriptions: { description: 'Verifies all nodes have active subscriptions.', recommendation: 'Purchase and apply a Proxmox subscription for enterprise repo access.' },
  apt_repo_consistency: { description: 'Detects enterprise repo enabled without subscription.', recommendation: 'Disable the enterprise repository or add a valid subscription key.' },
  tls_certificates: { description: 'Checks TLS certificates validity.', recommendation: 'Replace self-signed certificates with valid ones (e.g., Let\'s Encrypt) via pvecm updatecerts.' },
  node_firewalls: { description: 'Verifies host-level firewall is enabled.', recommendation: 'Enable the node firewall in Node > Firewall > Options > Enable Firewall.' },
  node_firewall_logging: { description: 'Checks firewall logging is active.', recommendation: 'Enable log_level_in and log_level_out in Node > Firewall > Options.' },
  root_tfa: { description: 'Ensures root@pam has two-factor authentication.', recommendation: 'Enable TOTP or WebAuthn for root@pam in Datacenter > Permissions > Two Factor.' },
  admins_tfa: { description: 'Verifies all admin users have TFA.', recommendation: 'Require TFA for all user accounts in Datacenter > Permissions > Two Factor.' },
  no_default_tokens: { description: 'Detects API tokens with suspicious names.', recommendation: 'Remove or rename API tokens named "test", "default", or "tmp".' },
  least_privilege_users: { description: 'Checks most users use PVE/LDAP instead of PAM.', recommendation: 'Migrate PAM users to PVE or LDAP realms for proper privilege separation.' },
  vm_firewalls: { description: 'Verifies per-VM firewall is enabled.', recommendation: 'Enable the firewall on each VM in VM > Firewall > Options > Enable Firewall.' },
  vm_security_groups: { description: 'Checks VMs have security group rules.', recommendation: 'Create security groups in Datacenter > Firewall > Security Group and assign them to VMs.' },
  vm_vlan_isolation: { description: 'Verifies VM NICs use VLAN tags.', recommendation: 'Assign VLAN tags to VM network interfaces in VM > Hardware > Network Device.' },
  vm_guest_agent: { description: 'Checks QEMU guest agent is enabled.', recommendation: 'Enable the QEMU Guest Agent in VM > Options and install qemu-guest-agent in the guest OS.' },
  vm_secure_boot: { description: 'Verifies VMs use UEFI firmware.', recommendation: 'Change VM BIOS to OVMF (UEFI) in VM > Hardware > BIOS.' },
  vm_no_usb_passthrough: { description: 'Detects USB/PCI passthrough.', recommendation: 'Remove USB/PCI passthrough devices unless strictly required for the workload.' },
  vm_cpu_isolation: { description: 'Checks VMs use emulated CPU types.', recommendation: 'Set CPU type to kvm64 or a specific model instead of "host" in VM > Hardware > Processor.' },
  vm_ip_filter: { description: 'Verifies IP filtering on VM firewalls.', recommendation: 'Enable IP Filter in VM > Firewall > Options to prevent IP spoofing.' },
  // CIS Benchmark: OS Hardening
  os_kernel_modules: { cisRef: 'CIS 1.1.1', cisUrl: `${PVE_GUIDE_BASE}#111-apply-debian-13-cis-level-1`, description: 'Checks dangerous kernel modules are disabled or blacklisted.', recommendation: 'Add modules to /etc/modprobe.d/blacklist.conf: install cramfs /bin/true, etc.' },
  os_coredumps_disabled: { cisRef: 'CIS 1.5.11', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies core dumps are disabled via systemd and limits.conf.', recommendation: 'Set Storage=none in /etc/systemd/coredump.conf and add "* hard core 0" to /etc/security/limits.conf.' },
  os_mount_options: { cisRef: 'CIS 1.6.1', cisUrl: CIS_BENCHMARK_URL, description: 'Checks /dev/shm and /tmp have nodev, nosuid, noexec options.', recommendation: 'Add nodev,nosuid,noexec options for /dev/shm and /tmp in /etc/fstab.' },
  os_auto_updates: { cisRef: 'CIS 1.1.3', cisUrl: `${PVE_GUIDE_BASE}#113-configure-automatic-security-updates`, description: 'Verifies unattended-upgrades is installed and enabled.', recommendation: 'Install and enable: apt install unattended-upgrades && dpkg-reconfigure -plow unattended-upgrades.' },
  os_cpu_microcode: { cisRef: 'CIS 1.1.8', cisUrl: `${PVE_GUIDE_BASE}#118-install-cpu-microcode`, description: 'Checks CPU microcode (intel/amd) is installed.', recommendation: 'Install: apt install intel-microcode (Intel) or amd64-microcode (AMD).' },
  os_disk_encryption: { cisRef: 'CIS 1.1.5', cisUrl: `${PVE_GUIDE_BASE}#115-enable-full-disk-encryption`, description: 'Detects full-disk encryption via LUKS2 or ZFS native encryption.', recommendation: 'Use LUKS2 encryption during installation or ZFS native encryption for data-at-rest protection.' },
  os_sysctl_hardening: { cisRef: 'CIS 1.1.1', cisUrl: `${PVE_GUIDE_BASE}#111-apply-debian-13-cis-level-1`, description: 'Checks kernel security parameters (dmesg_restrict, kptr_restrict, ASLR, etc.).', recommendation: 'Add to /etc/sysctl.d/99-hardening.conf: kernel.dmesg_restrict=1, kernel.kptr_restrict=2, kernel.randomize_va_space=2.' },
  access_pam_faillock: { cisRef: 'CIS 5.3.3', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies PAM faillock or pam_tally2 is configured.', recommendation: 'Configure pam_faillock in /etc/pam.d/common-auth with deny=5 unlock_time=900.' },
  access_password_aging: { cisRef: 'CIS 5.4.1', cisUrl: CIS_BENCHMARK_URL, description: 'Checks PASS_MAX_DAYS in /etc/login.defs is 365 or less.', recommendation: 'Set PASS_MAX_DAYS 365 and PASS_MIN_DAYS 1 in /etc/login.defs.' },
  access_pw_quality: { cisRef: 'CIS 5.3.1', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies libpam-pwquality is installed and configured.', recommendation: 'Install libpam-pwquality and configure minlen=14 in /etc/security/pwquality.conf.' },
  access_shell_timeout: { cisRef: 'CIS 5.4.3', cisUrl: CIS_BENCHMARK_URL, description: 'Checks TMOUT is set in shell profiles for idle timeout.', recommendation: 'Add TMOUT=900 and readonly TMOUT to /etc/profile.d/timeout.sh.' },
  access_login_banner: { cisRef: 'CIS 1.7.1', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies a legal warning banner is configured.', recommendation: 'Configure authorized-use warning text in /etc/issue and /etc/issue.net.' },
  // CIS Benchmark: SSH Hardening
  ssh_strong_ciphers: { cisRef: 'CIS 5.1.4', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Verifies only strong ciphers (AES-GCM, ChaCha20) are configured.', recommendation: 'Set Ciphers aes256-gcm@openssh.com,chacha20-poly1305@openssh.com,aes256-ctr in /etc/ssh/sshd_config.' },
  ssh_strong_kex: { cisRef: 'CIS 5.1.5', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Checks only secure key exchange algorithms are used.', recommendation: 'Set KexAlgorithms curve25519-sha256,ecdh-sha2-nistp521 in /etc/ssh/sshd_config.' },
  ssh_strong_macs: { cisRef: 'CIS 5.1.6', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Verifies only SHA-2 based MAC algorithms are configured.', recommendation: 'Set MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com in /etc/ssh/sshd_config.' },
  ssh_root_login: { cisRef: 'CIS 5.1.21', cisUrl: `${PVE_GUIDE_BASE}#215-privileged-access-model-root-sudo-and-shell-access`, description: 'Checks PermitRootLogin is "no" or "prohibit-password".', recommendation: 'Set PermitRootLogin prohibit-password (or no) in /etc/ssh/sshd_config.' },
  ssh_max_auth_tries: { cisRef: 'CIS 5.1.12', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Verifies MaxAuthTries is 4 or less.', recommendation: 'Set MaxAuthTries 4 in /etc/ssh/sshd_config.' },
  ssh_empty_passwords: { cisRef: 'CIS 5.1.17', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Ensures PermitEmptyPasswords is "no".', recommendation: 'Set PermitEmptyPasswords no in /etc/ssh/sshd_config.' },
  ssh_idle_timeout: { cisRef: 'CIS 5.1.20', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Checks ClientAliveInterval and ClientAliveCountMax for idle timeout.', recommendation: 'Set ClientAliveInterval 300 and ClientAliveCountMax 3 in /etc/ssh/sshd_config.' },
  ssh_file_perms: { cisRef: 'CIS 5.1.1', cisUrl: `${PVE_GUIDE_BASE}#114-apply-ssh-audit-hardening-profile`, description: 'Verifies sshd_config and host key file permissions.', recommendation: 'Run: chmod 600 /etc/ssh/sshd_config && chmod 600 /etc/ssh/ssh_host_*_key.' },
  // CIS Benchmark: Network
  net_ip_forward: { cisRef: 'CIS 3.1.1', cisUrl: `${PVE_GUIDE_BASE}#122-network-separation`, description: 'Checks net.ipv4.ip_forward is 0.', recommendation: 'Set net.ipv4.ip_forward=0 in /etc/sysctl.conf (note: Proxmox may need forwarding for VMs).' },
  net_icmp_redirects: { cisRef: 'CIS 3.2.2', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies ICMP redirect acceptance and sending are disabled.', recommendation: 'Set net.ipv4.conf.all.accept_redirects=0 and send_redirects=0 in /etc/sysctl.conf.' },
  net_source_routing: { cisRef: 'CIS 3.2.1', cisUrl: CIS_BENCHMARK_URL, description: 'Checks source-routed packets are rejected.', recommendation: 'Set net.ipv4.conf.all.accept_source_route=0 in /etc/sysctl.conf.' },
  net_syn_cookies: { cisRef: 'CIS 3.2.8', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies TCP SYN cookies are enabled.', recommendation: 'Set net.ipv4.tcp_syncookies=1 in /etc/sysctl.conf.' },
  net_rp_filter: { cisRef: 'CIS 3.2.7', cisUrl: CIS_BENCHMARK_URL, description: 'Checks reverse path filtering is active.', recommendation: 'Set net.ipv4.conf.all.rp_filter=1 in /etc/sysctl.conf.' },
  // CIS Benchmark: Services
  svc_unnecessary_disabled: { cisRef: 'CIS 2.1', cisUrl: CIS_BENCHMARK_URL, description: 'Verifies non-essential services are not running.', recommendation: 'Disable unnecessary services: systemctl disable --now bluetooth cups avahi-daemon.' },
  svc_apparmor: { cisRef: 'CIS 1.4', cisUrl: CIS_BENCHMARK_URL, description: 'Checks AppArmor mandatory access control is active.', recommendation: 'Install and enable: apt install apparmor apparmor-utils && aa-enforce /etc/apparmor.d/*.' },
  svc_auditd: { cisRef: 'CIS 4.1.1', cisUrl: `${PVE_GUIDE_BASE}#512-auditd-for-etcpve`, description: 'Verifies auditd is installed and active.', recommendation: 'Install and enable: apt install auditd && systemctl enable --now auditd.' },
  svc_ntp_sync: { cisRef: 'CIS 2.2.1', cisUrl: CIS_BENCHMARK_URL, description: 'Checks time synchronization is active.', recommendation: 'Ensure chrony or systemd-timesyncd is running: systemctl enable --now chrony.' },
  svc_fail2ban: { cisRef: 'CIS 2.3.3', cisUrl: `${PVE_GUIDE_BASE}#233-protect-the-gui-with-fail2ban`, description: 'Verifies Fail2Ban is protecting against brute-force.', recommendation: 'Install and enable: apt install fail2ban && systemctl enable --now fail2ban.' },
  // CIS Benchmark: Filesystem
  fs_permissions: { cisRef: 'CIS 6.1', cisUrl: CIS_BENCHMARK_URL, description: 'Checks permissions on /etc/passwd, /etc/shadow, /etc/group.', recommendation: 'Fix permissions: chmod 644 /etc/passwd /etc/group && chmod 640 /etc/shadow /etc/gshadow.' },
  fs_suid_audit: { cisRef: 'CIS 6.1.10', cisUrl: CIS_BENCHMARK_URL, description: 'Counts SUID/SGID binaries on the system.', recommendation: 'Audit SUID/SGID files: find / -perm /6000 -type f and remove unnecessary setuid bits.' },
  fs_world_writable: { cisRef: 'CIS 6.1.11', cisUrl: CIS_BENCHMARK_URL, description: 'Detects world-writable files outside /tmp.', recommendation: 'Find and fix: find / -xdev -type f -perm -0002 -exec chmod o-w {} \\;.' },
  fs_integrity: { cisRef: 'CIS 1.3.1', cisUrl: `${PVE_GUIDE_BASE}#531-system-audits`, description: 'Verifies AIDE or debsums is installed for integrity monitoring.', recommendation: 'Install AIDE: apt install aide && aideinit && systemctl enable aide-check.timer.' },
  // CIS Benchmark: Logging
  log_journald_persistent: { cisRef: 'CIS 4.2.1', cisUrl: `${PVE_GUIDE_BASE}#511-centralized-logging`, description: 'Checks journald is configured with Storage=persistent.', recommendation: 'Set Storage=persistent in /etc/systemd/journald.conf and restart systemd-journald.' },
  log_syslog_forwarding: { cisRef: 'CIS 4.2.3', cisUrl: `${PVE_GUIDE_BASE}#511-centralized-logging`, description: 'Verifies rsyslog forwards logs to a remote server.', recommendation: 'Configure rsyslog forwarding: add *.* @@remote-server:514 to /etc/rsyslog.d/50-remote.conf.' },
  log_file_permissions: { cisRef: 'CIS 4.2.4', cisUrl: CIS_BENCHMARK_URL, description: 'Checks /var/log permissions are restrictive.', recommendation: 'Restrict permissions: chmod -R g-wx,o-rwx /var/log/*.' },
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

interface ComplianceTabProps {
  connectionId: string
  node?: string // If provided, shows node-specific context
}

export default function ComplianceTab({ connectionId, node }: ComplianceTabProps) {
  const t = useTranslations()
  const { data, isLoading, mutate } = useHardeningChecks(connectionId || undefined, null, node || null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)

  const statusOrder: Record<string, number> = { fail: 0, warning: 1, pass: 2, skip: 3 }
  const allChecks = [...(data?.checks || [])].sort(
    (a: any, b: any) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4)
  )

  // When node param is set, the API already filters to node-relevant checks only
  const checks = allChecks

  const filteredChecks = categoryFilter
    ? checks.filter((c: any) => c.category === categoryFilter)
    : checks

  const summary = data?.summary || { score: 0, total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical: 0 }
  const score = data?.score ?? 0

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Unique categories present in results
  const categories = [...new Set(checks.map((c: any) => c.category))]

  if (!connectionId) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="info">{t('compliance.clickScan')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {!isLoading && data && (
        <>
          {/* Score + stats in compact row */}
          <Grid container spacing={2} columns={5}>
            <Grid size={{ xs: 5, sm: 1 }}>
              <Card variant="outlined" sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                <Tooltip title={t('compliance.runScan')}>
                  <span>
                    <IconButton
                      aria-label={t('compliance.runScan')}
                      size="small"
                      onClick={() => mutate()}
                      disabled={isLoading}
                      sx={{ position: 'absolute', top: 4, left: 4 }}
                    >
                      {isLoading ? <CircularProgress size={16} /> : <i className="ri-refresh-line" style={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
                <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex', mb: 0.5 }}>
                    <CircularProgress variant="determinate" value={100} size={64} thickness={4} sx={{ color: 'action.hover', position: 'absolute' }} />
                    <CircularProgress variant="determinate" value={score} size={64} thickness={4} sx={{ color: scoreColor(score) }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="h5" fontWeight={700} color={scoreColor(score)}>{score}</Typography>
                    </Box>
                  </Box>
                  <Typography variant="caption" color="text.secondary">{t('compliance.hardeningScore')}</Typography>
                </CardContent>
              </Card>
            </Grid>
            {[
              { label: t('compliance.totalChecks'), value: summary.total, icon: 'ri-list-check-2', color: '#6366f1' },
              { label: t('compliance.passed'), value: summary.passed, icon: 'ri-check-line', color: '#22c55e' },
              { label: t('compliance.failed'), value: summary.failed, icon: 'ri-close-line', color: '#ef4444' },
              { label: t('compliance.criticalIssues'), value: summary.critical, icon: 'ri-error-warning-line', color: '#dc2626' },
            ].map((stat) => (
              <Grid size={{ xs: 2.5, sm: 1 }} key={stat.label}>
                <Card variant="outlined" sx={{ height: '100%', display: 'flex' }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, flex: 1, py: 0, '&:last-child': { pb: 0 } }}>
                    <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: `${stat.color}15`, flexShrink: 0 }}>
                      <i className={stat.icon} style={{ fontSize: 22, color: stat.color }} />
                    </Box>
                    <Box>
                      <Typography variant="h4" fontWeight={700}>{stat.value}</Typography>
                      <Typography variant="body2" color="text.secondary">{stat.label}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* SSH warning + category filter chips */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
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
                sx={{ mr: 1 }}
              />
            )}
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

          {/* Checks table */}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>{t('compliance.checkName')}</TableCell>
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
                  const info = CHECK_INFO[check.id]
                  return (
                    <Fragment key={check.id}>
                      <TableRow
                        hover
                        onClick={() => toggleRow(check.id)}
                        sx={{ cursor: 'pointer', '& > td': { borderBottom: isExpanded ? 'none' : undefined } }}
                      >
                        <TableCell padding="checkbox">
                          <IconButton size="small">
                            <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 16 }} />
                          </IconButton>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500} fontSize={13}>{check.name}</Typography>
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
                            variant={check.status === 'skip' ? 'outlined' : 'filled'}
                          />
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="body2"
                            fontWeight={600}
                            fontSize={13}
                            color={check.status === 'pass' ? 'success.main' : check.status === 'fail' ? 'error.main' : 'text.secondary'}
                          >
                            {check.weightedEarned ?? check.earned}/{check.weightedMaxPoints ?? check.maxPoints}
                          </Typography>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={6} sx={{ py: 0, px: 0 }}>
                          <Collapse in={isExpanded}>
                            <Box sx={{ px: 3, py: 2, bgcolor: 'action.hover' }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                                {info?.cisRef && (
                                  <Chip
                                    component="a"
                                    href={info.cisUrl || CIS_BENCHMARK_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    clickable
                                    icon={<i className="ri-external-link-line" style={{ fontSize: 14 }} />}
                                    label={info.cisRef}
                                    size="small"
                                    color="primary"
                                    variant="outlined"
                                    sx={{ fontWeight: 600, fontSize: '0.75rem' }}
                                  />
                                )}
                                {info?.description && (
                                  <Typography variant="body2" color="text.secondary">
                                    {info.description}
                                  </Typography>
                                )}
                              </Box>
                              {check.entity && !node && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                  <Chip
                                    icon={<i className="ri-focus-3-line" style={{ fontSize: 14 }} />}
                                    label={check.entity}
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: '0.75rem' }}
                                  />
                                </Box>
                              )}
                              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                                <i className="ri-information-line" style={{ fontSize: 16, color: '#6366f1', marginTop: 2, flexShrink: 0 }} />
                                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                  {check.details || '—'}
                                </Typography>
                              </Box>
                              {check.status !== 'pass' && check.status !== 'skip' && info?.recommendation && (
                                <>
                                  <Divider sx={{ my: 1.5 }} />
                                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                    <i className="ri-lightbulb-line" style={{ fontSize: 16, color: '#f59e0b', marginTop: 2, flexShrink: 0 }} />
                                    <Box>
                                      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                                        {t('compliance.recommendation')}
                                      </Typography>
                                      <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                                        {info.recommendation}
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
        </>
      )}
    </Box>
  )
}
