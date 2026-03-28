// src/lib/compliance/ssh-checks.ts
// Read-only SSH-based CIS Benchmark checks — no writes, no remediation

import type { HardeningCheck, CheckStatus, Severity } from './hardening'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SSHNodeData {
  node: string
  available: boolean
  sections: Record<string, string>
  error?: string
}

export interface SSHHardeningData {
  nodes: SSHNodeData[]
}

/* ------------------------------------------------------------------ */
/*  Batched SSH command builder                                        */
/* ------------------------------------------------------------------ */

const SECTION_DELIM = '###CIS_SECTION:'

/**
 * Returns a single shell script that runs all read-only audit checks.
 * Output is delimited by `###CIS_SECTION:<key>###` markers.
 */
export function buildSSHAuditCommand(): string {
  const sections: Array<{ key: string; cmd: string }> = [
    // --- OS Hardening ---
    {
      key: 'kernel_modules',
      cmd: `for m in cramfs freevxfs hfs hfsplus jffs2 usb_storage; do
  lsmod 2>/dev/null | grep -q "^$m " && echo "LOADED:$m" || echo "OK:$m"
done
for m in cramfs freevxfs hfs hfsplus jffs2 usb-storage; do
  [ -f "/etc/modprobe.d/$m.conf" ] && grep -q "install $m /bin/true\\|install $m /bin/false\\|blacklist $m" "/etc/modprobe.d/$m.conf" 2>/dev/null && echo "BLACKLISTED:$m" || echo "NOT_BLACKLISTED:$m"
done`,
    },
    {
      key: 'coredumps',
      cmd: `grep -E "^Storage=" /etc/systemd/coredump.conf 2>/dev/null || echo "COREDUMP_CONF_MISSING"
grep -E "^\\*.*hard.*core.*0" /etc/security/limits.conf /etc/security/limits.d/*.conf 2>/dev/null || echo "LIMITS_CORE_NOT_SET"
sysctl -n fs.suid_dumpable 2>/dev/null || echo "UNKNOWN"`,
    },
    {
      key: 'mount_options',
      cmd: `findmnt -n -o OPTIONS /dev/shm 2>/dev/null || echo "NOT_MOUNTED"
findmnt -n -o OPTIONS /tmp 2>/dev/null || echo "NOT_MOUNTED"`,
    },
    {
      key: 'auto_updates',
      cmd: `dpkg -l unattended-upgrades 2>/dev/null | grep -q "^ii" && echo "INSTALLED" || echo "NOT_INSTALLED"
systemctl is-enabled unattended-upgrades 2>/dev/null || echo "UNKNOWN"
[ -f /etc/apt/apt.conf.d/20auto-upgrades ] && cat /etc/apt/apt.conf.d/20auto-upgrades 2>/dev/null || echo "NO_CONFIG"`,
    },
    {
      key: 'cpu_microcode',
      cmd: `dpkg -l intel-microcode 2>/dev/null | grep -q "^ii" && echo "INTEL_INSTALLED" || echo "INTEL_MISSING"
dpkg -l amd64-microcode 2>/dev/null | grep -q "^ii" && echo "AMD_INSTALLED" || echo "AMD_MISSING"
grep -m1 "model name" /proc/cpuinfo 2>/dev/null || echo "UNKNOWN_CPU"`,
    },
    {
      key: 'disk_encryption',
      cmd: `lsblk -o NAME,FSTYPE,TYPE 2>/dev/null | grep -iE "crypt|luks" || echo "NO_LUKS"
zpool list -o name,feature@encryption 2>/dev/null | grep -v "^NAME" || echo "NO_ZFS_POOL"
zfs get encryption -t filesystem -H 2>/dev/null | grep -v "off" | head -5 || echo "NO_ZFS_ENC"`,
    },
    // --- SSH Hardening ---
    {
      key: 'sshd_config',
      cmd: `sshd -T 2>/dev/null || cat /etc/ssh/sshd_config 2>/dev/null || echo "SSHD_NOT_FOUND"`,
    },
    // --- Network ---
    {
      key: 'sysctl_net',
      cmd: `sysctl -n net.ipv4.ip_forward 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.all.accept_redirects 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.default.accept_redirects 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv6.conf.all.accept_redirects 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.all.accept_source_route 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.default.accept_source_route 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.tcp_syncookies 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.all.rp_filter 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.default.rp_filter 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.all.send_redirects 2>/dev/null || echo "UNKNOWN"
sysctl -n net.ipv4.conf.default.send_redirects 2>/dev/null || echo "UNKNOWN"`,
    },
    // --- Sysctl security ---
    {
      key: 'sysctl_security',
      cmd: `sysctl -n kernel.dmesg_restrict 2>/dev/null || echo "UNKNOWN"
sysctl -n kernel.kptr_restrict 2>/dev/null || echo "UNKNOWN"
sysctl -n kernel.sysrq 2>/dev/null || echo "UNKNOWN"
sysctl -n kernel.yama.ptrace_scope 2>/dev/null || echo "UNKNOWN"
sysctl -n kernel.randomize_va_space 2>/dev/null || echo "UNKNOWN"
sysctl -n fs.suid_dumpable 2>/dev/null || echo "UNKNOWN"
sysctl -n fs.protected_hardlinks 2>/dev/null || echo "UNKNOWN"
sysctl -n fs.protected_symlinks 2>/dev/null || echo "UNKNOWN"`,
    },
    // --- Services ---
    {
      key: 'services',
      cmd: `for svc in bluetooth cups avahi-daemon; do
  systemctl is-active "$svc" 2>/dev/null || echo "inactive"
  echo "---$svc---"
done`,
    },
    {
      key: 'apparmor',
      cmd: `systemctl is-active apparmor 2>/dev/null || echo "inactive"
aa-status --json 2>/dev/null || aa-status 2>/dev/null || echo "AA_NOT_AVAILABLE"`,
    },
    {
      key: 'auditd',
      cmd: `dpkg -l auditd 2>/dev/null | grep -q "^ii" && echo "INSTALLED" || echo "NOT_INSTALLED"
systemctl is-active auditd 2>/dev/null || echo "inactive"`,
    },
    {
      key: 'ntp',
      cmd: `timedatectl show --property=NTPSynchronized 2>/dev/null || echo "UNKNOWN"
systemctl is-active chrony 2>/dev/null; systemctl is-active systemd-timesyncd 2>/dev/null; systemctl is-active ntp 2>/dev/null`,
    },
    {
      key: 'fail2ban',
      cmd: `dpkg -l fail2ban 2>/dev/null | grep -q "^ii" && echo "INSTALLED" || echo "NOT_INSTALLED"
systemctl is-active fail2ban 2>/dev/null || echo "inactive"
fail2ban-client status 2>/dev/null | head -5 || echo "NO_STATUS"`,
    },
    // --- Filesystem ---
    {
      key: 'file_perms',
      cmd: `stat -c "%a %U %G" /etc/passwd 2>/dev/null || echo "UNKNOWN"
stat -c "%a %U %G" /etc/shadow 2>/dev/null || echo "UNKNOWN"
stat -c "%a %U %G" /etc/group 2>/dev/null || echo "UNKNOWN"
stat -c "%a %U %G" /etc/gshadow 2>/dev/null || echo "UNKNOWN"`,
    },
    {
      key: 'suid_files',
      cmd: `find / -xdev -type f \\( -perm -4000 -o -perm -2000 \\) -print 2>/dev/null | head -100 | wc -l; echo "---"; find / -xdev -type f \\( -perm -4000 -o -perm -2000 \\) -print 2>/dev/null | head -10`,
    },
    {
      key: 'world_writable',
      cmd: `find / -xdev -type f -perm -0002 ! -path "/proc/*" ! -path "/sys/*" ! -path "/tmp/*" ! -path "/var/tmp/*" -print 2>/dev/null | head -50 | wc -l; echo "---"; find / -xdev -type f -perm -0002 ! -path "/proc/*" ! -path "/sys/*" ! -path "/tmp/*" ! -path "/var/tmp/*" -print 2>/dev/null | head -5`,
    },
    {
      key: 'integrity',
      cmd: `dpkg -l aide 2>/dev/null | grep -q "^ii" && echo "AIDE_INSTALLED" || echo "AIDE_MISSING"
dpkg -l debsums 2>/dev/null | grep -q "^ii" && echo "DEBSUMS_INSTALLED" || echo "DEBSUMS_MISSING"`,
    },
    // --- Logging ---
    {
      key: 'journald',
      cmd: `grep -E "^Storage=" /etc/systemd/journald.conf 2>/dev/null || echo "NOT_SET"
grep -E "^Compress=" /etc/systemd/journald.conf 2>/dev/null || echo "NOT_SET"`,
    },
    {
      key: 'syslog_forwarding',
      cmd: `grep -E "^[^#]*@@?" /etc/rsyslog.conf /etc/rsyslog.d/*.conf 2>/dev/null | head -5 || echo "NO_FORWARDING"`,
    },
    {
      key: 'log_perms',
      cmd: `stat -c "%a" /var/log 2>/dev/null || echo "UNKNOWN"
find /var/log -maxdepth 1 -type f -perm -o+r 2>/dev/null | head -10 | wc -l`,
    },
    // --- Access ---
    {
      key: 'pam_faillock',
      cmd: `grep -rE "pam_faillock|pam_tally2" /etc/pam.d/ 2>/dev/null | head -5 || echo "NOT_CONFIGURED"`,
    },
    {
      key: 'password_aging',
      cmd: `grep -E "^PASS_MAX_DAYS" /etc/login.defs 2>/dev/null || echo "NOT_SET"
grep -E "^PASS_MIN_DAYS" /etc/login.defs 2>/dev/null || echo "NOT_SET"
grep -E "^PASS_MIN_LEN" /etc/login.defs 2>/dev/null || echo "NOT_SET"
grep -E "^PASS_WARN_AGE" /etc/login.defs 2>/dev/null || echo "NOT_SET"`,
    },
    {
      key: 'pw_quality',
      cmd: `dpkg -l libpam-pwquality 2>/dev/null | grep -q "^ii" && echo "INSTALLED" || echo "NOT_INSTALLED"
grep -rE "pam_pwquality|pam_cracklib" /etc/pam.d/ 2>/dev/null | head -3 || echo "NOT_CONFIGURED"`,
    },
    {
      key: 'shell_timeout',
      cmd: `grep -rE "^(readonly )?TMOUT=" /etc/profile /etc/profile.d/*.sh /etc/bash.bashrc 2>/dev/null | head -3 || echo "NOT_SET"`,
    },
    {
      key: 'login_banner',
      cmd: `cat /etc/issue 2>/dev/null || echo "EMPTY"
cat /etc/issue.net 2>/dev/null || echo "EMPTY"`,
    },
    // --- SSH file perms ---
    {
      key: 'ssh_perms',
      cmd: `stat -c "%a" /etc/ssh/sshd_config 2>/dev/null || echo "UNKNOWN"
find /etc/ssh -name "ssh_host_*_key" -exec stat -c "%a %n" {} \\; 2>/dev/null || echo "NO_KEYS"`,
    },
  ]

  const lines = sections.map(
    (s) => `echo "${SECTION_DELIM}${s.key}###"\n${s.cmd}`
  )
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/*  Output parser                                                      */
/* ------------------------------------------------------------------ */

export function parseSSHAuditOutput(raw: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const parts = raw.split(SECTION_DELIM)
  for (const part of parts) {
    if (!part.trim()) continue
    const endOfKey = part.indexOf('###')
    if (endOfKey === -1) continue
    const key = part.substring(0, endOfKey).trim()
    const content = part.substring(endOfKey + 3).trim()
    sections[key] = content
  }
  return sections
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type CISCategory = 'os' | 'ssh' | 'network' | 'services' | 'filesystem' | 'logging'

function makeCheck(
  id: string,
  name: string,
  category: CISCategory,
  severity: Severity,
  maxPoints: number,
  status: CheckStatus,
  earned: number,
  entity: string,
  details: string,
): HardeningCheck {
  return { id, name, category: category as any, severity, maxPoints, status, earned, entity, details }
}

function skipSSH(id: string, name: string, category: CISCategory, severity: Severity, maxPoints: number): HardeningCheck {
  return makeCheck(id, name, category, severity, maxPoints, 'skip', 0, 'SSH', 'SSH not available')
}

/** Count how many nodes have a section available */
function nodesWithSection(data: SSHHardeningData, key: string): SSHNodeData[] {
  return data.nodes.filter(n => n.available && n.sections[key] !== undefined)
}

/* ------------------------------------------------------------------ */
/*  OS Hardening checks                                                */
/* ------------------------------------------------------------------ */

function checkKernelModules(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'kernel_modules')
  if (nodes.length === 0) return skipSSH('os_kernel_modules', 'Dangerous kernel modules disabled', 'os', 'medium', 10)

  const dangerousModules = ['cramfs', 'freevxfs', 'hfs', 'hfsplus', 'jffs2', 'usb_storage', 'usb-storage']
  const problems: string[] = []

  for (const n of nodes) {
    const out = n.sections.kernel_modules
    const loaded = dangerousModules.filter(m => out.includes(`LOADED:${m}`))
    const notBlacklisted = dangerousModules.filter(m => out.includes(`NOT_BLACKLISTED:${m}`))
    if (loaded.length > 0) problems.push(`${n.node}: ${loaded.join(', ')} loaded`)
    else if (notBlacklisted.length > 0) problems.push(`${n.node}: ${notBlacklisted.length} not blacklisted`)
  }

  const ok = problems.length === 0
  return makeCheck('os_kernel_modules', 'Dangerous kernel modules disabled', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'All dangerous kernel modules disabled or blacklisted' : problems.slice(0, 3).join('; '))
}

function checkCoreDumps(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'coredumps')
  if (nodes.length === 0) return skipSSH('os_coredumps_disabled', 'Core dumps disabled', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.coredumps
    const lines = out.split('\n').map(l => l.trim())
    const storageNone = lines.some(l => l === 'Storage=none')
    const limitsSet = !out.includes('LIMITS_CORE_NOT_SET')
    const suidDumpable = lines[lines.length - 1]
    if (!storageNone) problems.push(`${n.node}: systemd coredump not disabled`)
    else if (!limitsSet) problems.push(`${n.node}: limits.conf core not set to 0`)
    else if (suidDumpable !== '0') problems.push(`${n.node}: suid_dumpable=${suidDumpable}`)
  }

  const ok = problems.length === 0
  return makeCheck('os_coredumps_disabled', 'Core dumps disabled', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Core dumps properly disabled on all nodes' : problems.slice(0, 3).join('; '))
}

function checkMountOptions(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'mount_options')
  if (nodes.length === 0) return skipSSH('os_mount_options', 'Secure mount options on /dev/shm, /tmp', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = n.sections.mount_options.split('\n').map(l => l.trim())
    const shmOpts = lines[0] || 'NOT_MOUNTED'
    const tmpOpts = lines[1] || 'NOT_MOUNTED'

    if (shmOpts !== 'NOT_MOUNTED') {
      const missing = ['nodev', 'nosuid', 'noexec'].filter(o => !shmOpts.includes(o))
      if (missing.length > 0) problems.push(`${n.node}: /dev/shm missing ${missing.join(',')}`)
    }
    if (tmpOpts !== 'NOT_MOUNTED') {
      const missing = ['nodev', 'nosuid'].filter(o => !tmpOpts.includes(o))
      if (missing.length > 0) problems.push(`${n.node}: /tmp missing ${missing.join(',')}`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('os_mount_options', 'Secure mount options on /dev/shm, /tmp', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Mount options properly configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkAutoUpdates(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'auto_updates')
  if (nodes.length === 0) return skipSSH('os_auto_updates', 'Automatic security updates', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.auto_updates
    if (out.includes('NOT_INSTALLED')) {
      problems.push(`${n.node}: unattended-upgrades not installed`)
    } else if (out.includes('disabled') || out.includes('UNKNOWN')) {
      problems.push(`${n.node}: unattended-upgrades not enabled`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('os_auto_updates', 'Automatic security updates', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Automatic security updates enabled on all nodes' : problems.slice(0, 3).join('; '))
}

function checkCpuMicrocode(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'cpu_microcode')
  if (nodes.length === 0) return skipSSH('os_cpu_microcode', 'CPU microcode installed', 'os', 'low', 5)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.cpu_microcode
    const isIntel = out.toLowerCase().includes('intel')
    const isAmd = out.toLowerCase().includes('amd')
    const intelInstalled = out.includes('INTEL_INSTALLED')
    const amdInstalled = out.includes('AMD_INSTALLED')

    if (isIntel && !intelInstalled) problems.push(`${n.node}: Intel CPU, intel-microcode missing`)
    else if (isAmd && !amdInstalled) problems.push(`${n.node}: AMD CPU, amd64-microcode missing`)
    else if (!isIntel && !isAmd && !intelInstalled && !amdInstalled) {
      problems.push(`${n.node}: no microcode package detected`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('os_cpu_microcode', 'CPU microcode installed', 'os', 'low', 5,
    ok ? 'pass' : 'warning', ok ? 5 : 0, `${nodes.length} nodes`,
    ok ? 'CPU microcode package installed on all nodes' : problems.slice(0, 3).join('; '))
}

function checkDiskEncryption(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'disk_encryption')
  if (nodes.length === 0) return skipSSH('os_disk_encryption', 'Disk encryption (LUKS/ZFS)', 'os', 'low', 5)

  let withEncryption = 0
  for (const n of nodes) {
    const out = n.sections.disk_encryption
    const hasLuks = !out.includes('NO_LUKS') && out.match(/crypt|luks/i)
    const hasZfs = !out.includes('NO_ZFS_ENC') && out.match(/encryption/i) && !out.includes('off')
    if (hasLuks || hasZfs) withEncryption++
  }

  const ratio = withEncryption / nodes.length
  const status: CheckStatus = ratio >= 0.8 ? 'pass' : ratio > 0 ? 'warning' : 'fail'
  const earned = status === 'pass' ? 5 : 0
  return makeCheck('os_disk_encryption', 'Disk encryption (LUKS/ZFS)', 'os', 'low', 5,
    status, earned, `${nodes.length} nodes`,
    `${withEncryption}/${nodes.length} nodes with disk encryption detected`)
}

/* ------------------------------------------------------------------ */
/*  SSH Hardening checks                                               */
/* ------------------------------------------------------------------ */

const WEAK_CIPHERS = ['3des-cbc', 'aes128-cbc', 'aes192-cbc', 'aes256-cbc', 'blowfish-cbc', 'cast128-cbc', 'arcfour']
const WEAK_KEXS = ['diffie-hellman-group1-sha1', 'diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1']
const WEAK_MACS = ['hmac-md5', 'hmac-sha1', 'umac-64', 'hmac-md5-96', 'hmac-sha1-96']

function getSSHConfigValue(sshdOut: string, key: string): string | null {
  const lower = key.toLowerCase()
  for (const line of sshdOut.split('\n')) {
    const trimmed = line.trim().toLowerCase()
    if (trimmed.startsWith(lower + ' ')) {
      return line.trim().substring(key.length).trim()
    }
  }
  return null
}

function checkSSHCiphers(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_strong_ciphers', 'SSH strong ciphers only', 'ssh', 'high', 15)

  const problems: string[] = []
  for (const n of nodes) {
    const ciphers = getSSHConfigValue(n.sections.sshd_config, 'ciphers')
    if (ciphers) {
      const weak = WEAK_CIPHERS.filter(c => ciphers.toLowerCase().includes(c))
      if (weak.length > 0) problems.push(`${n.node}: weak ciphers ${weak.join(', ')}`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_strong_ciphers', 'SSH strong ciphers only', 'ssh', 'high', 15,
    ok ? 'pass' : 'fail', ok ? 15 : 0, `${nodes.length} nodes`,
    ok ? 'No weak SSH ciphers detected' : problems.slice(0, 3).join('; '))
}

function checkSSHKex(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_strong_kex', 'SSH strong key exchange', 'ssh', 'high', 15)

  const problems: string[] = []
  for (const n of nodes) {
    const kex = getSSHConfigValue(n.sections.sshd_config, 'kexalgorithms')
    if (kex) {
      const weak = WEAK_KEXS.filter(k => kex.toLowerCase().includes(k))
      if (weak.length > 0) problems.push(`${n.node}: weak KEX ${weak.join(', ')}`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_strong_kex', 'SSH strong key exchange', 'ssh', 'high', 15,
    ok ? 'pass' : 'fail', ok ? 15 : 0, `${nodes.length} nodes`,
    ok ? 'No weak key exchange algorithms detected' : problems.slice(0, 3).join('; '))
}

function checkSSHMacs(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_strong_macs', 'SSH strong MACs', 'ssh', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const macs = getSSHConfigValue(n.sections.sshd_config, 'macs')
    if (macs) {
      const weak = WEAK_MACS.filter(m => macs.toLowerCase().includes(m))
      if (weak.length > 0) problems.push(`${n.node}: weak MACs ${weak.join(', ')}`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_strong_macs', 'SSH strong MACs', 'ssh', 'medium', 10,
    ok ? 'pass' : 'fail', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'No weak MAC algorithms detected' : problems.slice(0, 3).join('; '))
}

function checkSSHRootLogin(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_root_login', 'SSH root login restricted', 'ssh', 'high', 15)

  const problems: string[] = []
  for (const n of nodes) {
    const val = getSSHConfigValue(n.sections.sshd_config, 'permitrootlogin')
    if (val && val.toLowerCase() === 'yes') {
      problems.push(`${n.node}: PermitRootLogin=yes`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_root_login', 'SSH root login restricted', 'ssh', 'high', 15,
    ok ? 'pass' : 'warning', ok ? 15 : 0, `${nodes.length} nodes`,
    ok ? 'Root login restricted (no/prohibit-password) on all nodes' : problems.slice(0, 3).join('; ') + ' — consider prohibit-password or no')
}

function checkSSHMaxAuthTries(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_max_auth_tries', 'SSH MaxAuthTries <= 4', 'ssh', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const val = getSSHConfigValue(n.sections.sshd_config, 'maxauthtries')
    const num = val ? Number.parseInt(val, 10) : 6 // SSH default is 6
    if (num > 4) problems.push(`${n.node}: MaxAuthTries=${num}`)
  }

  const ok = problems.length === 0
  return makeCheck('ssh_max_auth_tries', 'SSH MaxAuthTries <= 4', 'ssh', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'MaxAuthTries <= 4 on all nodes' : problems.slice(0, 3).join('; '))
}

function checkSSHEmptyPasswords(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_empty_passwords', 'SSH empty passwords disabled', 'ssh', 'critical', 20)

  const problems: string[] = []
  for (const n of nodes) {
    const val = getSSHConfigValue(n.sections.sshd_config, 'permitemptypasswords')
    if (val && val.toLowerCase() === 'yes') {
      problems.push(`${n.node}: PermitEmptyPasswords=yes`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_empty_passwords', 'SSH empty passwords disabled', 'ssh', 'critical', 20,
    ok ? 'pass' : 'fail', ok ? 20 : 0, `${nodes.length} nodes`,
    ok ? 'Empty passwords disabled on all nodes' : problems.slice(0, 3).join('; '))
}

function checkSSHIdleTimeout(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sshd_config')
  if (nodes.length === 0) return skipSSH('ssh_idle_timeout', 'SSH idle timeout configured', 'ssh', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const interval = getSSHConfigValue(n.sections.sshd_config, 'clientaliveinterval')
    const countMax = getSSHConfigValue(n.sections.sshd_config, 'clientalivecountmax')
    const intervalNum = interval ? Number.parseInt(interval, 10) : 0
    const countMaxNum = countMax ? Number.parseInt(countMax, 10) : 3
    if (intervalNum === 0) {
      problems.push(`${n.node}: ClientAliveInterval not set`)
    } else if (intervalNum * countMaxNum > 900) {
      problems.push(`${n.node}: idle timeout > 15min (${intervalNum}×${countMaxNum}s)`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_idle_timeout', 'SSH idle timeout configured', 'ssh', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'SSH idle timeout properly configured on all nodes' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Network checks                                                     */
/* ------------------------------------------------------------------ */

function parseSysctlLines(out: string): string[] {
  return out.split('\n').map(l => l.trim())
}

function checkIPForwarding(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_net')
  if (nodes.length === 0) return skipSSH('net_ip_forward', 'IP forwarding disabled', 'network', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_net)
    // First line = net.ipv4.ip_forward
    if (lines[0] === '1') problems.push(`${n.node}: ip_forward=1`)
  }

  const ok = problems.length === 0
  return makeCheck('net_ip_forward', 'IP forwarding disabled', 'network', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 5, `${nodes.length} nodes`,
    ok ? 'IP forwarding disabled on all nodes' : problems.slice(0, 3).join('; ') + ' — expected if node routes traffic')
}

function checkICMPRedirects(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_net')
  if (nodes.length === 0) return skipSSH('net_icmp_redirects', 'ICMP redirects disabled', 'network', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_net)
    // lines[1]=accept_redirects all, [2]=accept_redirects default, [3]=ipv6
    if (lines[1] !== '0') problems.push(`${n.node}: accept_redirects.all=${lines[1]}`)
    if (lines[9] !== '0') problems.push(`${n.node}: send_redirects.all=${lines[9]}`)
  }

  const ok = problems.length === 0
  return makeCheck('net_icmp_redirects', 'ICMP redirects disabled', 'network', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'ICMP redirects properly disabled' : problems.slice(0, 3).join('; '))
}

function checkSourceRouting(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_net')
  if (nodes.length === 0) return skipSSH('net_source_routing', 'Source routing disabled', 'network', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_net)
    // lines[4]=accept_source_route.all, [5]=accept_source_route.default
    if (lines[4] !== '0') problems.push(`${n.node}: source_route.all=${lines[4]}`)
  }

  const ok = problems.length === 0
  return makeCheck('net_source_routing', 'Source routing disabled', 'network', 'medium', 10,
    ok ? 'pass' : 'fail', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Source routing disabled on all nodes' : problems.slice(0, 3).join('; '))
}

function checkSynCookies(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_net')
  if (nodes.length === 0) return skipSSH('net_syn_cookies', 'TCP SYN cookies enabled', 'network', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_net)
    // lines[6]=tcp_syncookies
    if (lines[6] !== '1') problems.push(`${n.node}: tcp_syncookies=${lines[6]}`)
  }

  const ok = problems.length === 0
  return makeCheck('net_syn_cookies', 'TCP SYN cookies enabled', 'network', 'medium', 10,
    ok ? 'pass' : 'fail', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'SYN cookies enabled on all nodes' : problems.slice(0, 3).join('; '))
}

function checkRPFilter(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_net')
  if (nodes.length === 0) return skipSSH('net_rp_filter', 'Reverse path filtering enabled', 'network', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_net)
    // lines[7]=rp_filter.all, [8]=rp_filter.default
    if (lines[7] !== '1' && lines[7] !== '2') problems.push(`${n.node}: rp_filter.all=${lines[7]}`)
  }

  const ok = problems.length === 0
  return makeCheck('net_rp_filter', 'Reverse path filtering enabled', 'network', 'medium', 10,
    ok ? 'pass' : 'fail', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Reverse path filtering enabled on all nodes' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Sysctl security (OS category)                                      */
/* ------------------------------------------------------------------ */

function checkSysctlHardening(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'sysctl_security')
  if (nodes.length === 0) return skipSSH('os_sysctl_hardening', 'Kernel security parameters', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = parseSysctlLines(n.sections.sysctl_security)
    // [0]=dmesg_restrict, [1]=kptr_restrict, [2]=sysrq, [3]=ptrace_scope,
    // [4]=randomize_va_space, [5]=suid_dumpable, [6]=protected_hardlinks, [7]=protected_symlinks
    const issues: string[] = []
    if (lines[0] !== '1') issues.push('dmesg_restrict')
    if (lines[1] !== '1' && lines[1] !== '2') issues.push('kptr_restrict')
    if (lines[2] !== '0') issues.push(`sysrq=${lines[2]}`)
    if (lines[4] !== '2') issues.push(`ASLR=${lines[4]}`)
    if (lines[6] !== '1') issues.push('hardlinks')
    if (lines[7] !== '1') issues.push('symlinks')
    if (issues.length > 0) problems.push(`${n.node}: ${issues.join(', ')}`)
  }

  const ok = problems.length === 0
  return makeCheck('os_sysctl_hardening', 'Kernel security parameters', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Kernel security parameters properly configured' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Services checks                                                    */
/* ------------------------------------------------------------------ */

function checkUnnecessaryServices(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'services')
  if (nodes.length === 0) return skipSSH('svc_unnecessary_disabled', 'Unnecessary services disabled', 'services', 'low', 5)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.services
    const running: string[] = []
    for (const svc of ['bluetooth', 'cups', 'avahi-daemon']) {
      const idx = out.indexOf(`---${svc}---`)
      if (idx === -1) continue
      const before = out.substring(0, idx).split('\n').pop()?.trim()
      if (before === 'active') running.push(svc)
    }
    if (running.length > 0) problems.push(`${n.node}: ${running.join(', ')} running`)
  }

  const ok = problems.length === 0
  return makeCheck('svc_unnecessary_disabled', 'Unnecessary services disabled', 'services', 'low', 5,
    ok ? 'pass' : 'warning', ok ? 5 : 0, `${nodes.length} nodes`,
    ok ? 'No unnecessary services running (bluetooth, cups, avahi)' : problems.slice(0, 3).join('; '))
}

function checkAppArmor(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'apparmor')
  if (nodes.length === 0) return skipSSH('svc_apparmor', 'AppArmor enabled', 'services', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.apparmor
    const firstLine = out.split('\n')[0]?.trim()
    if (firstLine !== 'active') problems.push(`${n.node}: AppArmor ${firstLine || 'not active'}`)
  }

  const ok = problems.length === 0
  return makeCheck('svc_apparmor', 'AppArmor enabled', 'services', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'AppArmor active on all nodes' : problems.slice(0, 3).join('; '))
}

function checkAuditd(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'auditd')
  if (nodes.length === 0) return skipSSH('svc_auditd', 'Audit daemon installed and running', 'services', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.auditd
    if (out.includes('NOT_INSTALLED')) problems.push(`${n.node}: auditd not installed`)
    else if (out.includes('inactive')) problems.push(`${n.node}: auditd not running`)
  }

  const ok = problems.length === 0
  return makeCheck('svc_auditd', 'Audit daemon installed and running', 'services', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'auditd installed and running on all nodes' : problems.slice(0, 3).join('; '))
}

function checkNTP(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'ntp')
  if (nodes.length === 0) return skipSSH('svc_ntp_sync', 'NTP time synchronization', 'services', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.ntp
    const synced = out.includes('NTPSynchronized=yes')
    const hasService = out.includes('active')
    if (!synced && !hasService) problems.push(`${n.node}: NTP not synchronized`)
  }

  const ok = problems.length === 0
  return makeCheck('svc_ntp_sync', 'NTP time synchronization', 'services', 'medium', 10,
    ok ? 'pass' : 'fail', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Time synchronization active on all nodes' : problems.slice(0, 3).join('; '))
}

function checkFail2Ban(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'fail2ban')
  if (nodes.length === 0) return skipSSH('svc_fail2ban', 'Fail2Ban installed and running', 'services', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.fail2ban
    if (out.includes('NOT_INSTALLED')) problems.push(`${n.node}: fail2ban not installed`)
    else if (out.includes('inactive')) problems.push(`${n.node}: fail2ban not running`)
  }

  const ok = problems.length === 0
  return makeCheck('svc_fail2ban', 'Fail2Ban installed and running', 'services', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Fail2Ban active on all nodes' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Filesystem checks                                                  */
/* ------------------------------------------------------------------ */

function checkFilePermissions(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'file_perms')
  if (nodes.length === 0) return skipSSH('fs_permissions', 'Critical file permissions', 'filesystem', 'high', 15)

  const expected: Array<{ file: string; maxPerm: number; owner: string; group: string }> = [
    { file: '/etc/passwd', maxPerm: 0o644, owner: 'root', group: 'root' },
    { file: '/etc/shadow', maxPerm: 0o640, owner: 'root', group: 'shadow' },
    { file: '/etc/group', maxPerm: 0o644, owner: 'root', group: 'root' },
    { file: '/etc/gshadow', maxPerm: 0o640, owner: 'root', group: 'shadow' },
  ]

  const problems: string[] = []
  for (const n of nodes) {
    const lines = n.sections.file_perms.split('\n').map(l => l.trim())
    for (let i = 0; i < expected.length && i < lines.length; i++) {
      if (lines[i] === 'UNKNOWN') continue
      const parts = lines[i].split(' ')
      const perm = Number.parseInt(parts[0], 8)
      const owner = parts[1]
      if (perm > expected[i].maxPerm) {
        problems.push(`${n.node}: ${expected[i].file} perm ${parts[0]} (expected <= ${expected[i].maxPerm.toString(8)})`)
      }
      if (owner !== expected[i].owner) {
        problems.push(`${n.node}: ${expected[i].file} owner ${owner} (expected ${expected[i].owner})`)
      }
    }
  }

  const ok = problems.length === 0
  return makeCheck('fs_permissions', 'Critical file permissions', 'filesystem', 'high', 15,
    ok ? 'pass' : 'fail', ok ? 15 : 0, `${nodes.length} nodes`,
    ok ? 'File permissions correct on /etc/passwd, shadow, group, gshadow' : problems.slice(0, 3).join('; '))
}

function checkSuidFiles(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'suid_files')
  if (nodes.length === 0) return skipSSH('fs_suid_audit', 'SUID/SGID files audit', 'filesystem', 'medium', 10)

  const details: string[] = []
  let totalCount = 0
  for (const n of nodes) {
    const parts = n.sections.suid_files.split('---')
    const count = Number.parseInt(parts[0]?.trim() || '0', 10)
    totalCount += count
    details.push(`${n.node}: ${count} SUID/SGID files`)
  }

  // Typical Debian has ~20-40 SUID files. >60 is suspicious
  const perNode = nodes.length > 0 ? totalCount / nodes.length : 0
  const status: CheckStatus = perNode <= 40 ? 'pass' : perNode <= 60 ? 'warning' : 'fail'
  const earned = status === 'pass' ? 10 : status === 'warning' ? 5 : 0

  return makeCheck('fs_suid_audit', 'SUID/SGID files audit', 'filesystem', 'medium', 10,
    status, earned, `${nodes.length} nodes`,
    details.slice(0, 3).join('; ') + (perNode > 40 ? ' — review and remove unnecessary SUID binaries' : ''))
}

function checkWorldWritable(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'world_writable')
  if (nodes.length === 0) return skipSSH('fs_world_writable', 'No world-writable files', 'filesystem', 'medium', 10)

  const details: string[] = []
  let totalCount = 0
  for (const n of nodes) {
    const parts = n.sections.world_writable.split('---')
    const count = Number.parseInt(parts[0]?.trim() || '0', 10)
    totalCount += count
    if (count > 0) details.push(`${n.node}: ${count} world-writable files`)
  }

  const ok = totalCount === 0
  return makeCheck('fs_world_writable', 'No world-writable files', 'filesystem', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'No world-writable files found outside /tmp' : details.slice(0, 3).join('; '))
}

function checkIntegrity(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'integrity')
  if (nodes.length === 0) return skipSSH('fs_integrity', 'File integrity monitoring', 'filesystem', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.integrity
    const hasAide = out.includes('AIDE_INSTALLED')
    const hasDebsums = out.includes('DEBSUMS_INSTALLED')
    if (!hasAide && !hasDebsums) problems.push(`${n.node}: no integrity tool (AIDE/debsums)`)
  }

  const ok = problems.length === 0
  return makeCheck('fs_integrity', 'File integrity monitoring', 'filesystem', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'File integrity monitoring installed on all nodes' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Logging checks                                                     */
/* ------------------------------------------------------------------ */

function checkJournaldPersistent(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'journald')
  if (nodes.length === 0) return skipSSH('log_journald_persistent', 'Journald persistent storage', 'logging', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.journald
    if (!out.includes('Storage=persistent')) {
      const storageLine = out.split('\n').find(l => l.startsWith('Storage='))
      problems.push(`${n.node}: ${storageLine || 'Storage not set (default: auto)'}`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('log_journald_persistent', 'Journald persistent storage', 'logging', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Journald configured for persistent storage on all nodes' : problems.slice(0, 3).join('; '))
}

function checkSyslogForwarding(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'syslog_forwarding')
  if (nodes.length === 0) return skipSSH('log_syslog_forwarding', 'Syslog remote forwarding', 'logging', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.syslog_forwarding
    if (out.includes('NO_FORWARDING')) problems.push(`${n.node}: no remote syslog`)
  }

  const ok = problems.length === 0
  return makeCheck('log_syslog_forwarding', 'Syslog remote forwarding', 'logging', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Remote syslog forwarding configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkLogPermissions(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'log_perms')
  if (nodes.length === 0) return skipSSH('log_file_permissions', 'Log file permissions', 'logging', 'low', 5)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = n.sections.log_perms.split('\n').map(l => l.trim())
    const dirPerm = Number.parseInt(lines[0], 8)
    const worldReadable = Number.parseInt(lines[1] || '0', 10)
    if (dirPerm > 0o755) problems.push(`${n.node}: /var/log perm ${lines[0]}`)
    if (worldReadable > 5) problems.push(`${n.node}: ${worldReadable} world-readable log files`)
  }

  const ok = problems.length === 0
  return makeCheck('log_file_permissions', 'Log file permissions', 'logging', 'low', 5,
    ok ? 'pass' : 'warning', ok ? 5 : 0, `${nodes.length} nodes`,
    ok ? 'Log file permissions properly restricted' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Access checks (SSH-based)                                          */
/* ------------------------------------------------------------------ */

function checkPamFaillock(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'pam_faillock')
  if (nodes.length === 0) return skipSSH('access_pam_faillock', 'Account lockout (PAM faillock)', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.pam_faillock
    if (out.includes('NOT_CONFIGURED')) problems.push(`${n.node}: no PAM faillock/tally`)
  }

  const ok = problems.length === 0
  return makeCheck('access_pam_faillock', 'Account lockout (PAM faillock)', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'PAM account lockout configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkPasswordAging(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'password_aging')
  if (nodes.length === 0) return skipSSH('access_password_aging', 'Password aging policy', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.password_aging
    const maxDaysMatch = out.match(/PASS_MAX_DAYS\s+(\d+)/)
    const maxDays = maxDaysMatch ? Number.parseInt(maxDaysMatch[1], 10) : 99999
    if (maxDays > 365) problems.push(`${n.node}: PASS_MAX_DAYS=${maxDays}`)
  }

  const ok = problems.length === 0
  return makeCheck('access_password_aging', 'Password aging policy', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Password aging policy configured (<= 365 days) on all nodes' : problems.slice(0, 3).join('; '))
}

function checkPasswordQuality(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'pw_quality')
  if (nodes.length === 0) return skipSSH('access_pw_quality', 'Password quality enforcement', 'os', 'medium', 10)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.pw_quality
    if (out.includes('NOT_INSTALLED')) problems.push(`${n.node}: libpam-pwquality not installed`)
    else if (out.includes('NOT_CONFIGURED')) problems.push(`${n.node}: PAM pwquality not configured`)
  }

  const ok = problems.length === 0
  return makeCheck('access_pw_quality', 'Password quality enforcement', 'os', 'medium', 10,
    ok ? 'pass' : 'warning', ok ? 10 : 0, `${nodes.length} nodes`,
    ok ? 'Password quality enforcement configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkShellTimeout(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'shell_timeout')
  if (nodes.length === 0) return skipSSH('access_shell_timeout', 'Shell idle timeout (TMOUT)', 'os', 'low', 5)

  const problems: string[] = []
  for (const n of nodes) {
    if (n.sections.shell_timeout.includes('NOT_SET')) {
      problems.push(`${n.node}: TMOUT not set`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('access_shell_timeout', 'Shell idle timeout (TMOUT)', 'os', 'low', 5,
    ok ? 'pass' : 'warning', ok ? 5 : 0, `${nodes.length} nodes`,
    ok ? 'Shell timeout configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkLoginBanner(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'login_banner')
  if (nodes.length === 0) return skipSSH('access_login_banner', 'Login warning banner', 'os', 'low', 5)

  const problems: string[] = []
  for (const n of nodes) {
    const out = n.sections.login_banner
    // Default Debian /etc/issue contains just the OS name. A proper banner has legal warning text
    if (out.includes('EMPTY') || out.trim().split('\n').length <= 2) {
      problems.push(`${n.node}: default or empty login banner`)
    }
  }

  const ok = problems.length === 0
  return makeCheck('access_login_banner', 'Login warning banner', 'os', 'low', 5,
    ok ? 'pass' : 'warning', ok ? 5 : 0, `${nodes.length} nodes`,
    ok ? 'Custom login banner configured on all nodes' : problems.slice(0, 3).join('; '))
}

function checkSSHFilePerms(data: SSHHardeningData): HardeningCheck {
  const nodes = nodesWithSection(data, 'ssh_perms')
  if (nodes.length === 0) return skipSSH('ssh_file_perms', 'SSH file permissions', 'ssh', 'high', 15)

  const problems: string[] = []
  for (const n of nodes) {
    const lines = n.sections.ssh_perms.split('\n').map(l => l.trim())
    const configPerm = Number.parseInt(lines[0], 8)
    if (!isNaN(configPerm) && configPerm > 0o600) {
      problems.push(`${n.node}: sshd_config perm ${lines[0]} (expected 600)`)
    }
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === 'NO_KEYS' || !lines[i]) continue
      const parts = lines[i].split(' ')
      const perm = Number.parseInt(parts[0], 8)
      if (!isNaN(perm) && perm > 0o600) {
        const keyName = parts[1]?.split('/').pop() || 'host key'
        problems.push(`${n.node}: ${keyName} perm ${parts[0]}`)
      }
    }
  }

  const ok = problems.length === 0
  return makeCheck('ssh_file_perms', 'SSH file permissions', 'ssh', 'high', 15,
    ok ? 'pass' : 'fail', ok ? 15 : 0, `${nodes.length} nodes`,
    ok ? 'SSH config and host key permissions correct' : problems.slice(0, 3).join('; '))
}

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

export const SSH_CHECK_FUNCTIONS: Record<string, (data: SSHHardeningData) => HardeningCheck> = {
  // OS
  os_kernel_modules: checkKernelModules,
  os_coredumps_disabled: checkCoreDumps,
  os_mount_options: checkMountOptions,
  os_auto_updates: checkAutoUpdates,
  os_cpu_microcode: checkCpuMicrocode,
  os_disk_encryption: checkDiskEncryption,
  os_sysctl_hardening: checkSysctlHardening,
  access_pam_faillock: checkPamFaillock,
  access_password_aging: checkPasswordAging,
  access_pw_quality: checkPasswordQuality,
  access_shell_timeout: checkShellTimeout,
  access_login_banner: checkLoginBanner,
  // SSH
  ssh_strong_ciphers: checkSSHCiphers,
  ssh_strong_kex: checkSSHKex,
  ssh_strong_macs: checkSSHMacs,
  ssh_root_login: checkSSHRootLogin,
  ssh_max_auth_tries: checkSSHMaxAuthTries,
  ssh_empty_passwords: checkSSHEmptyPasswords,
  ssh_idle_timeout: checkSSHIdleTimeout,
  ssh_file_perms: checkSSHFilePerms,
  // Network
  net_ip_forward: checkIPForwarding,
  net_icmp_redirects: checkICMPRedirects,
  net_source_routing: checkSourceRouting,
  net_syn_cookies: checkSynCookies,
  net_rp_filter: checkRPFilter,
  // Services
  svc_unnecessary_disabled: checkUnnecessaryServices,
  svc_apparmor: checkAppArmor,
  svc_auditd: checkAuditd,
  svc_ntp_sync: checkNTP,
  svc_fail2ban: checkFail2Ban,
  // Filesystem
  fs_permissions: checkFilePermissions,
  fs_suid_audit: checkSuidFiles,
  fs_world_writable: checkWorldWritable,
  fs_integrity: checkIntegrity,
  // Logging
  log_journald_persistent: checkJournaldPersistent,
  log_syslog_forwarding: checkSyslogForwarding,
  log_file_permissions: checkLogPermissions,
}

export function runAllSSHChecks(data: SSHHardeningData): HardeningCheck[] {
  return Object.values(SSH_CHECK_FUNCTIONS).map(fn => fn(data))
}
