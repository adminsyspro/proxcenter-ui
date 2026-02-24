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
    firewall?: { enable?: number }
  }>
  users?: Array<{ userid: string; enable?: number; realm?: string; tokens?: Array<{ tokenid: string }> }>
  tfa?: Array<{ userid: string; type?: string; enabled?: number }>
  resources?: Array<{ type: string; vmid?: number; node?: string; name?: string; id?: string }>
  vmFirewalls?: Record<string, { enable?: number }>
  vmSecurityGroups?: Record<string, boolean>
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
  ]
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
