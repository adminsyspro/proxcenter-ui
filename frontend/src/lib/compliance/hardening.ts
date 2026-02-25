// src/lib/compliance/hardening.ts
// Pure functions for hardening checks and scoring — no I/O

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type CheckStatus = 'pass' | 'fail' | 'warning' | 'skip'
export type CheckCategory = 'cluster' | 'node' | 'access' | 'vm'

export interface HardeningCheck {
  id: string
  name: string
  category: CheckCategory
  severity: Severity
  maxPoints: number
  status: CheckStatus
  earned: number
  entity?: string
  details?: string
}

export interface HardeningData {
  firewallOptions?: { enable?: number; policy_in?: string; policy_out?: string }
  version?: { version?: string; release?: string; repoid?: string }
  nodes?: Array<{ node: string; status?: string }>
  nodeDetails?: Record<string, {
    subscription?: { status?: string; level?: string }
    aptRepos?: { files?: Array<{ file_type?: string; enabled?: number; types?: string; uris?: string[]; suites?: string[]; components?: string[] }> }
      | { standard?: Array<any>; errors?: Array<any> }
    certificates?: Array<{ filename?: string; notafter?: number; notbefore?: number; fingerprint?: string; subject?: string; issuer?: string }>
    firewall?: { enable?: number; log_level_in?: string; log_level_out?: string }
  }>
  users?: Array<{ userid: string; enable?: number; realm?: string; tokens?: Array<{ tokenid: string }> }>
  tfa?: Array<{ userid: string; type?: string; enabled?: number }>
  resources?: Array<{ type: string; vmid?: number; node?: string; name?: string; id?: string }>
  vmFirewalls?: Record<string, { enable?: number }>
  vmSecurityGroups?: Record<string, boolean>
  backupJobs?: Array<{ id?: string; enabled?: number; schedule?: string; type?: string }>
  haResources?: Array<{ sid?: string; type?: string; state?: string }>
  replicationJobs?: Array<{ id?: string; target?: string; schedule?: string; disable?: number }>
  pools?: Array<{ poolid?: string; members?: Array<{ id: string; type: string }> }>
  vmConfigs?: Record<string, Record<string, any>>
}

const LATEST_PVE_MAJOR = 8

function checkClusterFirewall(data: HardeningData): HardeningCheck {
  const enabled = data.firewallOptions?.enable === 1
  return {
    id: 'cluster_fw_enabled',
    name: 'Cluster firewall enabled',
    category: 'cluster',
    severity: 'high',
    maxPoints: 15,
    status: enabled ? 'pass' : 'fail',
    earned: enabled ? 15 : 0,
    entity: 'Cluster',
    details: enabled ? 'Cluster firewall is enabled' : 'Cluster firewall is disabled — enable it in Datacenter > Firewall > Options',
  }
}

function checkPolicyIn(data: HardeningData): HardeningCheck {
  const policy = data.firewallOptions?.policy_in?.toUpperCase()
  const ok = policy === 'DROP' || policy === 'REJECT'
  return {
    id: 'cluster_policy_in',
    name: 'Inbound policy = DROP',
    category: 'cluster',
    severity: 'high',
    maxPoints: 15,
    status: ok ? 'pass' : 'fail',
    earned: ok ? 15 : 0,
    entity: 'Cluster',
    details: ok ? `Inbound policy is ${policy}` : `Inbound policy is ${policy || 'ACCEPT'} — set it to DROP`,
  }
}

function checkPolicyOut(data: HardeningData): HardeningCheck {
  const policy = data.firewallOptions?.policy_out?.toUpperCase()
  const ok = policy === 'DROP' || policy === 'REJECT'
  return {
    id: 'cluster_policy_out',
    name: 'Outbound policy = DROP',
    category: 'cluster',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 10 : 0,
    entity: 'Cluster',
    details: ok ? `Outbound policy is ${policy}` : `Outbound policy is ${policy || 'ACCEPT'} — consider setting it to DROP`,
  }
}

function checkPveVersion(data: HardeningData): HardeningCheck {
  const ver = data.version?.version || ''
  const major = parseInt(ver.split('.')[0], 10)
  const ok = !isNaN(major) && major >= LATEST_PVE_MAJOR
  return {
    id: 'pve_version',
    name: 'PVE version up to date',
    category: 'cluster',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 10 : 0,
    entity: `PVE ${ver || 'unknown'}`,
    details: ok ? `Running PVE ${ver} (current major)` : `Running PVE ${ver || 'unknown'} — consider upgrading to PVE ${LATEST_PVE_MAJOR}.x`,
  }
}

const SUB_LEVEL_NAMES: Record<string, string> = {
  c: 'Community', b: 'Basic', s: 'Standard', p: 'Premium',
}

function checkNodeSubscriptions(data: HardeningData): HardeningCheck {
  const nodes = data.nodes || []
  if (nodes.length === 0) {
    return { id: 'node_subscriptions', name: 'Valid subscriptions', category: 'node', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'Nodes', details: 'No nodes found' }
  }

  const failed: string[] = []
  const levels: string[] = []
  for (const n of nodes) {
    const sub = data.nodeDetails?.[n.node]?.subscription
    const active = sub?.status === 'Active' || sub?.status === 'active'
    if (!active) failed.push(n.node)
    else levels.push(SUB_LEVEL_NAMES[sub?.level?.toLowerCase() || ''] || sub?.level || 'Unknown')
  }

  const ok = failed.length === 0
  const levelSummary = [...new Set(levels)].join(', ')
  return {
    id: 'node_subscriptions',
    name: 'Valid subscriptions',
    category: 'node',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 10 : 0,
    entity: `${nodes.length} nodes`,
    details: ok
      ? `${nodes.length}/${nodes.length} nodes — ${levelSummary}`
      : `${failed.length}/${nodes.length} nodes without subscription: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '...' : ''}`,
  }
}

function checkNoEnterpriseRepoWithoutSub(data: HardeningData): HardeningCheck {
  const nodes = data.nodes || []
  if (nodes.length === 0) {
    return { id: 'apt_repo_consistency', name: 'APT repository consistency', category: 'node', severity: 'low', maxPoints: 5, status: 'skip', earned: 0, entity: 'Nodes', details: 'No nodes found' }
  }

  const problems: string[] = []
  for (const n of nodes) {
    const nd = data.nodeDetails?.[n.node]
    const sub = nd?.subscription
    const active = sub?.status === 'Active' || sub?.status === 'active'

    let hasEnterpriseRepo = false
    const repos = nd?.aptRepos
    if (repos) {
      const fileList = Array.isArray((repos as any).files) ? (repos as any).files : []
      for (const file of fileList) {
        if (file.enabled) {
          const uris = Array.isArray(file.uris) ? file.uris.join(' ') : ''
          if (uris.includes('enterprise.proxmox.com')) { hasEnterpriseRepo = true; break }
        }
      }
      const stdList = Array.isArray((repos as any).standard) ? (repos as any).standard : []
      for (const repo of stdList) {
        if (repo?.handle?.includes('enterprise') && repo?.status === 1) { hasEnterpriseRepo = true; break }
      }
    }
    if (hasEnterpriseRepo && !active) problems.push(n.node)
  }

  const ok = problems.length === 0
  return {
    id: 'apt_repo_consistency',
    name: 'APT repository consistency',
    category: 'node',
    severity: 'low',
    maxPoints: 5,
    status: ok ? 'pass' : 'fail',
    earned: ok ? 5 : 0,
    entity: `${nodes.length} nodes`,
    details: ok
      ? `${nodes.length}/${nodes.length} nodes — repositories consistent`
      : `${problems.length} node(s) with enterprise repo but no subscription: ${problems.slice(0, 3).join(', ')}${problems.length > 3 ? '...' : ''}`,
  }
}

function checkTlsCertificates(data: HardeningData): HardeningCheck {
  const nodes = data.nodes || []
  if (nodes.length === 0) {
    return { id: 'tls_certificates', name: 'Valid TLS certificates', category: 'node', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'Nodes', details: 'No nodes found' }
  }

  const now = Date.now() / 1000
  const thirtyDays = 30 * 86400
  const expired: string[] = []
  const expiringSoon: string[] = []
  const selfSigned: string[] = []

  for (const n of nodes) {
    const certs = data.nodeDetails?.[n.node]?.certificates
    if (!certs || certs.length === 0) continue
    const pveProxy = certs.find(c => c.filename === 'pveproxy-ssl.pem' || c.filename === '/etc/pve/local/pveproxy-ssl.pem')
    const cert = pveProxy || certs[0]
    const expiry = cert?.notafter || 0
    if (expiry < now) expired.push(n.node)
    else if (expiry < now + thirtyDays) expiringSoon.push(n.node)
    else if (cert?.issuer === cert?.subject) selfSigned.push(n.node)
  }

  const hasIssues = expired.length > 0
  const hasWarnings = expiringSoon.length > 0 || selfSigned.length > 0
  let status: CheckStatus = 'pass'
  let earned = 15
  const parts: string[] = []

  if (hasIssues) {
    status = 'fail'; earned = 0
    parts.push(`${expired.length} expired: ${expired.slice(0, 3).join(', ')}${expired.length > 3 ? '...' : ''}`)
  }
  if (expiringSoon.length > 0) {
    if (!hasIssues) { status = 'warning'; earned = 10 }
    parts.push(`${expiringSoon.length} expiring soon`)
  }
  if (selfSigned.length > 0) {
    if (!hasIssues && !hasWarnings) { status = 'warning'; earned = 10 }
    parts.push(`${selfSigned.length} self-signed`)
  }

  return {
    id: 'tls_certificates',
    name: 'Valid TLS certificates',
    category: 'node',
    severity: 'high',
    maxPoints: 15,
    status,
    earned,
    entity: `${nodes.length} nodes`,
    details: parts.length > 0 ? parts.join(', ') : `${nodes.length}/${nodes.length} nodes — certificates valid`,
  }
}

function checkNodeFirewall(data: HardeningData): HardeningCheck {
  const nodes = data.nodes || []
  if (nodes.length === 0) {
    return { id: 'node_firewalls', name: 'Node firewalls enabled', category: 'node', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'Nodes', details: 'No nodes found' }
  }

  const disabled: string[] = []
  for (const n of nodes) {
    const fw = data.nodeDetails?.[n.node]?.firewall
    if (fw?.enable !== 1) disabled.push(n.node)
  }

  const ok = disabled.length === 0
  return {
    id: 'node_firewalls',
    name: 'Node firewalls enabled',
    category: 'node',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'fail',
    earned: ok ? 10 : 0,
    entity: `${nodes.length} nodes`,
    details: ok
      ? `${nodes.length}/${nodes.length} nodes — firewall enabled`
      : `${disabled.length}/${nodes.length} nodes without firewall: ${disabled.slice(0, 3).join(', ')}${disabled.length > 3 ? '...' : ''}`,
  }
}

function checkRootTfa(data: HardeningData): HardeningCheck {
  const rootUser = data.tfa?.find(u => u.userid === 'root@pam')
  const hasTfa = rootUser && rootUser.type && rootUser.type !== 'none'
  return {
    id: 'root_tfa',
    name: 'TFA for root@pam',
    category: 'access',
    severity: 'critical',
    maxPoints: 20,
    status: hasTfa ? 'pass' : 'fail',
    earned: hasTfa ? 20 : 0,
    entity: 'root@pam',
    details: hasTfa ? `root@pam has TFA (${rootUser?.type})` : 'root@pam has no TFA — enable TOTP or WebAuthn',
  }
}

function checkAdminsTfa(data: HardeningData): HardeningCheck {
  // Admins = users that are enabled and not in @pve realm typically, but we check all enabled users
  const enabledUsers = (data.users || []).filter(u => u.enable !== 0 && u.userid !== 'root@pam')
  if (enabledUsers.length === 0) {
    return {
      id: 'admins_tfa',
      name: 'TFA for admin users',
      category: 'access',
      severity: 'high',
      maxPoints: 15,
      status: 'skip',
      earned: 0,
      entity: 'Users',
      details: 'No additional users found',
    }
  }

  const tfaMap = new Map((data.tfa || []).map(t => [t.userid, t]))
  const withoutTfa = enabledUsers.filter(u => {
    const t = tfaMap.get(u.userid)
    return !t || !t.type || t.type === 'none'
  })

  const allHaveTfa = withoutTfa.length === 0
  return {
    id: 'admins_tfa',
    name: 'TFA for admin users',
    category: 'access',
    severity: 'high',
    maxPoints: 15,
    status: allHaveTfa ? 'pass' : 'fail',
    earned: allHaveTfa ? 15 : 0,
    entity: `${enabledUsers.length} users`,
    details: allHaveTfa
      ? `All ${enabledUsers.length} users have TFA`
      : `${withoutTfa.length}/${enabledUsers.length} users without TFA: ${withoutTfa.slice(0, 3).map(u => u.userid).join(', ')}${withoutTfa.length > 3 ? '...' : ''}`,
  }
}

function checkDefaultApiTokens(data: HardeningData): HardeningCheck {
  const users = data.users || []
  const tokensCount = users.reduce((acc, u) => acc + (u.tokens?.length || 0), 0)
  // "default" tokens = tokens with common insecure names
  const suspectNames = ['test', 'default', 'tmp', 'temp']
  const defaultTokens = users.flatMap(u =>
    (u.tokens || []).filter(t => suspectNames.some(s => t.tokenid.toLowerCase().includes(s)))
  )
  const ok = defaultTokens.length === 0
  return {
    id: 'no_default_tokens',
    name: 'No default API tokens',
    category: 'access',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 10 : 0,
    entity: `${tokensCount} tokens`,
    details: ok
      ? `${tokensCount} API tokens, none with suspicious names`
      : `Found ${defaultTokens.length} token(s) with suspicious names (test, default, tmp)`,
  }
}

function checkVmFirewalls(data: HardeningData): HardeningCheck {
  const vms = (data.resources || []).filter(r => r.type === 'qemu' || r.type === 'lxc')
  if (vms.length === 0) {
    return {
      id: 'vm_firewalls',
      name: 'Firewall on all VMs',
      category: 'vm',
      severity: 'high',
      maxPoints: 15,
      status: 'skip',
      earned: 0,
      entity: 'VMs',
      details: 'No VMs found',
    }
  }

  const vmFws = data.vmFirewalls || {}
  const checked = vms.filter(v => {
    const key = `${v.node}/${v.type}/${v.vmid}`
    return vmFws[key] !== undefined
  })
  const withFw = checked.filter(v => {
    const key = `${v.node}/${v.type}/${v.vmid}`
    return vmFws[key]?.enable === 1
  })
  const withoutFw = checked.length - withFw.length
  const allEnabled = withoutFw === 0 && checked.length > 0

  return {
    id: 'vm_firewalls',
    name: 'Firewall on all VMs',
    category: 'vm',
    severity: 'high',
    maxPoints: 15,
    status: allEnabled ? 'pass' : 'fail',
    earned: allEnabled ? 15 : 0,
    entity: `${checked.length}/${vms.length} VMs checked`,
    details: allEnabled
      ? `All ${withFw.length} checked VMs have firewall enabled`
      : `${withoutFw} VM(s) without firewall enabled`,
  }
}

function checkVmSecurityGroups(data: HardeningData): HardeningCheck {
  const vms = (data.resources || []).filter(r => r.type === 'qemu' || r.type === 'lxc')
  if (vms.length === 0) {
    return {
      id: 'vm_security_groups',
      name: 'VMs have security groups',
      category: 'vm',
      severity: 'medium',
      maxPoints: 10,
      status: 'skip',
      earned: 0,
      entity: 'VMs',
      details: 'No VMs found',
    }
  }

  const sgMap = data.vmSecurityGroups || {}
  const checked = vms.filter(v => {
    const key = `${v.node}/${v.type}/${v.vmid}`
    return sgMap[key] !== undefined
  })
  const withSg = checked.filter(v => {
    const key = `${v.node}/${v.type}/${v.vmid}`
    return sgMap[key] === true
  })
  const withoutSg = checked.length - withSg.length
  const allHaveSg = withoutSg === 0 && checked.length > 0

  return {
    id: 'vm_security_groups',
    name: 'VMs have security groups',
    category: 'vm',
    severity: 'medium',
    maxPoints: 10,
    status: allHaveSg ? 'pass' : 'warning',
    earned: allHaveSg ? 10 : 0,
    entity: `${checked.length}/${vms.length} VMs checked`,
    details: allHaveSg
      ? `All ${withSg.length} checked VMs have security group rules`
      : `${withoutSg} VM(s) without security group rules`,
  }
}

function checkBackupSchedule(data: HardeningData): HardeningCheck {
  const jobs = data.backupJobs || []
  const enabledJobs = jobs.filter(j => j.enabled !== 0)
  const hasJobs = enabledJobs.length > 0
  return {
    id: 'backup_schedule',
    name: 'Backup jobs configured',
    category: 'cluster',
    severity: 'high',
    maxPoints: 15,
    status: hasJobs ? 'pass' : 'fail',
    earned: hasJobs ? 15 : 0,
    entity: `${enabledJobs.length} jobs`,
    details: hasJobs
      ? `${enabledJobs.length} backup job(s) configured and enabled`
      : 'No backup jobs configured — create scheduled backups in Datacenter > Backup',
  }
}

function checkHaEnabled(data: HardeningData): HardeningCheck {
  const resources = data.haResources || []
  const hasHA = resources.length > 0
  return {
    id: 'ha_enabled',
    name: 'High availability configured',
    category: 'cluster',
    severity: 'medium',
    maxPoints: 10,
    status: hasHA ? 'pass' : 'warning',
    earned: hasHA ? 10 : 0,
    entity: `${resources.length} HA resources`,
    details: hasHA
      ? `${resources.length} HA resource(s) configured`
      : 'No HA resources configured — consider adding critical VMs to HA',
  }
}

function checkStorageReplication(data: HardeningData): HardeningCheck {
  const jobs = data.replicationJobs || []
  const activeJobs = jobs.filter(j => !j.disable)
  const hasReplication = activeJobs.length > 0
  return {
    id: 'storage_replication',
    name: 'Storage replication configured',
    category: 'cluster',
    severity: 'medium',
    maxPoints: 10,
    status: hasReplication ? 'pass' : 'warning',
    earned: hasReplication ? 10 : 0,
    entity: `${activeJobs.length} jobs`,
    details: hasReplication
      ? `${activeJobs.length} active replication job(s) configured`
      : 'No storage replication configured — consider replicating critical data',
  }
}

function checkPoolIsolation(data: HardeningData): HardeningCheck {
  const pools = data.pools || []
  const nonEmptyPools = pools.filter(p => (p.members?.length || 0) > 0)
  const hasPools = nonEmptyPools.length > 0
  return {
    id: 'pool_isolation',
    name: 'Resource pool isolation',
    category: 'cluster',
    severity: 'medium',
    maxPoints: 10,
    status: hasPools ? 'pass' : 'warning',
    earned: hasPools ? 10 : 0,
    entity: `${nonEmptyPools.length} pools`,
    details: hasPools
      ? `${nonEmptyPools.length} resource pool(s) with assigned VMs`
      : 'No resource pools configured — use pools to isolate workloads',
  }
}

function checkVmVlanIsolation(data: HardeningData): HardeningCheck {
  const vms = (data.resources || []).filter(r => r.type === 'qemu' || r.type === 'lxc')
  if (vms.length === 0) {
    return { id: 'vm_vlan_isolation', name: 'VMs use VLAN isolation', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VMs found' }
  }

  const configs = data.vmConfigs || {}
  let checked = 0, withVlan = 0
  for (const vm of vms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const cfg = configs[key]
    if (!cfg) continue
    checked++
    let hasVlan = false
    for (const [k, v] of Object.entries(cfg)) {
      if (k.startsWith('net') && typeof v === 'string' && v.includes('tag=')) {
        hasVlan = true
        break
      }
    }
    if (hasVlan) withVlan++
  }

  if (checked === 0) {
    return { id: 'vm_vlan_isolation', name: 'VMs use VLAN isolation', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM configs available' }
  }

  const ratio = withVlan / checked
  const status: CheckStatus = ratio >= 0.8 ? 'pass' : ratio >= 0.5 ? 'warning' : 'fail'
  const earned = status === 'pass' ? 15 : status === 'warning' ? 8 : 0

  return {
    id: 'vm_vlan_isolation',
    name: 'VMs use VLAN isolation',
    category: 'vm',
    severity: 'high',
    maxPoints: 15,
    status,
    earned,
    entity: `${checked}/${vms.length} VMs checked`,
    details: `${withVlan}/${checked} VMs use VLAN tags for network isolation`,
  }
}

function checkVmGuestAgent(data: HardeningData): HardeningCheck {
  const qemuVms = (data.resources || []).filter(r => r.type === 'qemu')
  if (qemuVms.length === 0) {
    return { id: 'vm_guest_agent', name: 'QEMU guest agent enabled', category: 'vm', severity: 'low', maxPoints: 5, status: 'skip', earned: 0, entity: 'VMs', details: 'No QEMU VMs found' }
  }

  const configs = data.vmConfigs || {}
  let checked = 0, withAgent = 0
  for (const vm of qemuVms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const cfg = configs[key]
    if (!cfg) continue
    checked++
    const agent = cfg.agent
    if (agent && (agent === 1 || String(agent).startsWith('1'))) withAgent++
  }

  if (checked === 0) {
    return { id: 'vm_guest_agent', name: 'QEMU guest agent enabled', category: 'vm', severity: 'low', maxPoints: 5, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM configs available' }
  }

  const allEnabled = withAgent / checked >= 0.8
  return {
    id: 'vm_guest_agent',
    name: 'QEMU guest agent enabled',
    category: 'vm',
    severity: 'low',
    maxPoints: 5,
    status: allEnabled ? 'pass' : 'warning',
    earned: allEnabled ? 5 : 0,
    entity: `${checked}/${qemuVms.length} VMs checked`,
    details: `${withAgent}/${checked} QEMU VMs have guest agent enabled`,
  }
}

function checkVmSecureBoot(data: HardeningData): HardeningCheck {
  const qemuVms = (data.resources || []).filter(r => r.type === 'qemu')
  if (qemuVms.length === 0) {
    return { id: 'vm_secure_boot', name: 'UEFI boot enabled', category: 'vm', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'VMs', details: 'No QEMU VMs found' }
  }

  const configs = data.vmConfigs || {}
  let checked = 0, withUefi = 0
  for (const vm of qemuVms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const cfg = configs[key]
    if (!cfg) continue
    checked++
    if (cfg.bios === 'ovmf' || cfg.efidisk0) withUefi++
  }

  if (checked === 0) {
    return { id: 'vm_secure_boot', name: 'UEFI boot enabled', category: 'vm', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM configs available' }
  }

  const ratio = withUefi / checked
  const status: CheckStatus = ratio >= 0.7 ? 'pass' : ratio >= 0.3 ? 'warning' : 'fail'
  const earned = status === 'pass' ? 10 : status === 'warning' ? 5 : 0

  return {
    id: 'vm_secure_boot',
    name: 'UEFI boot enabled',
    category: 'vm',
    severity: 'medium',
    maxPoints: 10,
    status,
    earned,
    entity: `${checked}/${qemuVms.length} VMs checked`,
    details: `${withUefi}/${checked} QEMU VMs use UEFI/secure boot`,
  }
}

function checkVmNoUsbPassthrough(data: HardeningData): HardeningCheck {
  const vms = (data.resources || []).filter(r => r.type === 'qemu' || r.type === 'lxc')
  if (vms.length === 0) {
    return { id: 'vm_no_usb_passthrough', name: 'No USB/PCI passthrough', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VMs found' }
  }

  const configs = data.vmConfigs || {}
  let checked = 0
  const withUsb: string[] = []
  for (const vm of vms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const cfg = configs[key]
    if (!cfg) continue
    checked++
    for (const k of Object.keys(cfg)) {
      if (/^(usb|hostpci)\d+$/.test(k)) {
        withUsb.push(vm.name || String(vm.vmid))
        break
      }
    }
  }

  if (checked === 0) {
    return { id: 'vm_no_usb_passthrough', name: 'No USB/PCI passthrough', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM configs available' }
  }

  const ok = withUsb.length === 0
  return {
    id: 'vm_no_usb_passthrough',
    name: 'No USB/PCI passthrough',
    category: 'vm',
    severity: 'high',
    maxPoints: 15,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 15 : 0,
    entity: `${checked}/${vms.length} VMs checked`,
    details: ok
      ? 'No VMs have USB/PCI passthrough devices'
      : `${withUsb.length} VM(s) with USB/PCI passthrough: ${withUsb.slice(0, 3).join(', ')}${withUsb.length > 3 ? '...' : ''}`,
  }
}

function checkVmCpuIsolation(data: HardeningData): HardeningCheck {
  const qemuVms = (data.resources || []).filter(r => r.type === 'qemu')
  if (qemuVms.length === 0) {
    return { id: 'vm_cpu_isolation', name: 'CPU type isolation', category: 'vm', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'VMs', details: 'No QEMU VMs found' }
  }

  const configs = data.vmConfigs || {}
  let checked = 0
  const withHostCpu: string[] = []
  for (const vm of qemuVms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const cfg = configs[key]
    if (!cfg) continue
    checked++
    if (cfg.cpu === 'host') {
      withHostCpu.push(vm.name || String(vm.vmid))
    }
  }

  if (checked === 0) {
    return { id: 'vm_cpu_isolation', name: 'CPU type isolation', category: 'vm', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM configs available' }
  }

  const ok = withHostCpu.length === 0
  return {
    id: 'vm_cpu_isolation',
    name: 'CPU type isolation',
    category: 'vm',
    severity: 'medium',
    maxPoints: 10,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 10 : 5,
    entity: `${checked}/${qemuVms.length} VMs checked`,
    details: ok
      ? `All ${checked} QEMU VMs use isolated CPU types`
      : `${withHostCpu.length} VM(s) use host CPU type (less isolation): ${withHostCpu.slice(0, 3).join(', ')}${withHostCpu.length > 3 ? '...' : ''}`,
  }
}

function checkVmIpFilter(data: HardeningData): HardeningCheck {
  const vms = (data.resources || []).filter(r => r.type === 'qemu' || r.type === 'lxc')
  if (vms.length === 0) {
    return { id: 'vm_ip_filter', name: 'VM IP filter enabled', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VMs found' }
  }

  const vmFws = data.vmFirewalls || {}
  let checked = 0, withFilter = 0
  for (const vm of vms) {
    const key = `${vm.node}/${vm.type}/${vm.vmid}`
    const fw = vmFws[key] as any
    if (!fw) continue
    checked++
    if (fw.ipfilter === 1 || fw.ipfilter === true) withFilter++
  }

  if (checked === 0) {
    return { id: 'vm_ip_filter', name: 'VM IP filter enabled', category: 'vm', severity: 'high', maxPoints: 15, status: 'skip', earned: 0, entity: 'VMs', details: 'No VM firewall data available' }
  }

  const ratio = withFilter / checked
  const status: CheckStatus = ratio >= 0.8 ? 'pass' : ratio >= 0.5 ? 'warning' : 'fail'
  const earned = status === 'pass' ? 15 : status === 'warning' ? 8 : 0

  return {
    id: 'vm_ip_filter',
    name: 'VM IP filter enabled',
    category: 'vm',
    severity: 'high',
    maxPoints: 15,
    status,
    earned,
    entity: `${checked}/${vms.length} VMs checked`,
    details: `${withFilter}/${checked} VMs have IP filter enabled`,
  }
}

function checkLeastPrivilegeUsers(data: HardeningData): HardeningCheck {
  const users = data.users || []
  const enabledUsers = users.filter(u => u.enable !== 0)
  if (enabledUsers.length === 0) {
    return { id: 'least_privilege_users', name: 'Least privilege access', category: 'access', severity: 'medium', maxPoints: 10, status: 'skip', earned: 0, entity: 'Users', details: 'No users found' }
  }

  const pamUsers = enabledUsers.filter(u => u.userid?.endsWith('@pam'))
  const tooManyPam = pamUsers.length > 3 || (enabledUsers.length > 5 && pamUsers.length / enabledUsers.length > 0.5)

  return {
    id: 'least_privilege_users',
    name: 'Least privilege access',
    category: 'access',
    severity: 'medium',
    maxPoints: 10,
    status: tooManyPam ? 'warning' : 'pass',
    earned: tooManyPam ? 0 : 10,
    entity: `${enabledUsers.length} users`,
    details: tooManyPam
      ? `${pamUsers.length}/${enabledUsers.length} users have direct PAM access — consider using PVE or LDAP realms`
      : `${pamUsers.length} PAM user(s) out of ${enabledUsers.length} total — access is properly segmented`,
  }
}

function checkNodeFirewallLogging(data: HardeningData): HardeningCheck {
  const nodes = data.nodes || []
  if (nodes.length === 0) {
    return { id: 'node_firewall_logging', name: 'Firewall logging enabled', category: 'node', severity: 'low', maxPoints: 5, status: 'skip', earned: 0, entity: 'Nodes', details: 'No nodes found' }
  }

  const withoutLogging: string[] = []
  for (const n of nodes) {
    const fw = data.nodeDetails?.[n.node]?.firewall as any
    const logIn = fw?.log_level_in
    const logOut = fw?.log_level_out
    if ((!logIn || logIn === 'nolog') && (!logOut || logOut === 'nolog')) {
      withoutLogging.push(n.node)
    }
  }

  const ok = withoutLogging.length === 0
  return {
    id: 'node_firewall_logging',
    name: 'Firewall logging enabled',
    category: 'node',
    severity: 'low',
    maxPoints: 5,
    status: ok ? 'pass' : 'warning',
    earned: ok ? 5 : 0,
    entity: `${nodes.length} nodes`,
    details: ok
      ? `All ${nodes.length} nodes have firewall logging enabled`
      : `${withoutLogging.length}/${nodes.length} nodes without firewall logging: ${withoutLogging.slice(0, 3).join(', ')}${withoutLogging.length > 3 ? '...' : ''}`,
  }
}

// Map of check ID -> check function for dynamic lookup
const CHECK_FUNCTIONS: Record<string, (data: HardeningData) => HardeningCheck> = {
  cluster_fw_enabled: checkClusterFirewall,
  cluster_policy_in: checkPolicyIn,
  cluster_policy_out: checkPolicyOut,
  pve_version: checkPveVersion,
  node_subscriptions: checkNodeSubscriptions,
  apt_repo_consistency: checkNoEnterpriseRepoWithoutSub,
  tls_certificates: checkTlsCertificates,
  node_firewalls: checkNodeFirewall,
  root_tfa: checkRootTfa,
  admins_tfa: checkAdminsTfa,
  no_default_tokens: checkDefaultApiTokens,
  vm_firewalls: checkVmFirewalls,
  vm_security_groups: checkVmSecurityGroups,
  backup_schedule: checkBackupSchedule,
  ha_enabled: checkHaEnabled,
  storage_replication: checkStorageReplication,
  pool_isolation: checkPoolIsolation,
  vm_vlan_isolation: checkVmVlanIsolation,
  vm_guest_agent: checkVmGuestAgent,
  vm_secure_boot: checkVmSecureBoot,
  vm_no_usb_passthrough: checkVmNoUsbPassthrough,
  vm_cpu_isolation: checkVmCpuIsolation,
  vm_ip_filter: checkVmIpFilter,
  least_privilege_users: checkLeastPrivilegeUsers,
  node_firewall_logging: checkNodeFirewallLogging,
}

export function runAllChecks(data: HardeningData): HardeningCheck[] {
  return [
    checkClusterFirewall(data),
    checkPolicyIn(data),
    checkPolicyOut(data),
    checkPveVersion(data),
    checkNodeSubscriptions(data),
    checkNoEnterpriseRepoWithoutSub(data),
    checkTlsCertificates(data),
    checkNodeFirewall(data),
    checkRootTfa(data),
    checkAdminsTfa(data),
    checkDefaultApiTokens(data),
    checkVmFirewalls(data),
    checkVmSecurityGroups(data),
    checkBackupSchedule(data),
    checkHaEnabled(data),
    checkStorageReplication(data),
    checkPoolIsolation(data),
    checkVmVlanIsolation(data),
    checkVmGuestAgent(data),
    checkVmSecureBoot(data),
    checkVmNoUsbPassthrough(data),
    checkVmCpuIsolation(data),
    checkVmIpFilter(data),
    checkLeastPrivilegeUsers(data),
    checkNodeFirewallLogging(data),
  ]
}

export interface CheckConfig {
  checkId: string
  enabled: boolean
  weight: number
  controlRef?: string
  category?: string
}

export interface WeightedHardeningCheck extends HardeningCheck {
  weight: number
  weightedMaxPoints: number
  weightedEarned: number
  controlRef?: string
  frameworkCategory?: string
}

export function runChecksWithProfile(
  data: HardeningData,
  checkConfigs: CheckConfig[]
): WeightedHardeningCheck[] {
  const results: WeightedHardeningCheck[] = []

  for (const config of checkConfigs) {
    if (!config.enabled) continue

    const checkFn = CHECK_FUNCTIONS[config.checkId]
    if (!checkFn) continue

    const check = checkFn(data)
    const weight = Math.max(0.5, Math.min(2.0, config.weight))

    results.push({
      ...check,
      weight,
      weightedMaxPoints: Math.round(check.maxPoints * weight),
      weightedEarned: Math.round(check.earned * weight),
      controlRef: config.controlRef,
      frameworkCategory: config.category,
    })
  }

  return results
}

export function computeWeightedScore(checks: WeightedHardeningCheck[]): HardeningScore {
  const applicable = checks.filter(c => c.status !== 'skip')
  const earned = applicable.reduce((sum, c) => sum + c.weightedEarned, 0)
  const maxApplicable = applicable.reduce((sum, c) => sum + c.weightedMaxPoints, 0)
  const score = maxApplicable > 0 ? Math.round((earned / maxApplicable) * 100) : 0

  const passed = checks.filter(c => c.status === 'pass').length
  const failed = checks.filter(c => c.status === 'fail').length
  const warnings = checks.filter(c => c.status === 'warning').length
  const skipped = checks.filter(c => c.status === 'skip').length
  const critical = checks.filter(c => c.status === 'fail' && c.severity === 'critical').length

  return {
    score,
    earned,
    maxApplicable,
    total: checks.length,
    passed,
    failed,
    warnings,
    skipped,
    critical,
    color: score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error',
  }
}

export interface HardeningScore {
  score: number
  earned: number
  maxApplicable: number
  total: number
  passed: number
  failed: number
  warnings: number
  skipped: number
  critical: number
  color: 'success' | 'warning' | 'error'
}

export function computeScore(checks: HardeningCheck[]): HardeningScore {
  const applicable = checks.filter(c => c.status !== 'skip')
  const earned = applicable.reduce((sum, c) => sum + c.earned, 0)
  const maxApplicable = applicable.reduce((sum, c) => sum + c.maxPoints, 0)
  const score = maxApplicable > 0 ? Math.round((earned / maxApplicable) * 100) : 0

  const passed = checks.filter(c => c.status === 'pass').length
  const failed = checks.filter(c => c.status === 'fail').length
  const warnings = checks.filter(c => c.status === 'warning').length
  const skipped = checks.filter(c => c.status === 'skip').length
  const critical = checks.filter(c => c.status === 'fail' && c.severity === 'critical').length

  return {
    score,
    earned,
    maxApplicable,
    total: checks.length,
    passed,
    failed,
    warnings,
    skipped,
    critical,
    color: score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error',
  }
}
