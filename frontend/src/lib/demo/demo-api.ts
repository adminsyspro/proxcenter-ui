/**
 * ProxCenter Demo Mode - API Interceptor
 *
 * Edge-compatible module that intercepts API requests in demo mode and returns
 * mock responses. Designed to be called from Next.js middleware so that NO
 * actual route handler files need modification.
 *
 * No `fs` or `path` imports — uses a static JSON import so it works in both
 * Node.js and Edge runtimes.
 */

import { NextResponse } from 'next/server'

import mockDataJson from './mock-data.json'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MockDataMap = Record<string, any>

// ---------------------------------------------------------------------------
// In-memory cache (JSON import is already cached by the bundler, but we keep
// a typed reference for clarity)
// ---------------------------------------------------------------------------

const MOCK_DATA: MockDataMap = mockDataJson as MockDataMap

// ---------------------------------------------------------------------------
// Known demo identifiers
// ---------------------------------------------------------------------------

const DEMO_CONNECTION_ID = 'demo-pve-cluster-001'
const DEMO_NODE_NAME = 'pve-node-01'

// ---------------------------------------------------------------------------
// Dynamic RRD data generator
// ---------------------------------------------------------------------------

function generateRrdData(timeframe: string = 'hour', baseValues?: { cpu?: number, mem?: number, memTotal?: number }): any[] {
  const now = Math.floor(Date.now() / 1000)
  const cpu = baseValues?.cpu ?? 0.03 + Math.random() * 0.05
  const memTotal = baseValues?.memTotal ?? 270138527744
  const memBase = baseValues?.mem ?? memTotal * 0.66

  const config: Record<string, { points: number, interval: number }> = {
    hour: { points: 70, interval: 60 },
    day: { points: 70, interval: 1200 },
    week: { points: 70, interval: 8640 },
    month: { points: 70, interval: 43200 },
    year: { points: 70, interval: 432000 },
  }
  const { points, interval } = config[timeframe] || config.hour

  return Array.from({ length: points }, (_, i) => {
    const time = now - (points - 1 - i) * interval
    const t = i / points
    const wave = Math.sin(t * Math.PI * 4) * 0.3 + Math.sin(t * Math.PI * 7) * 0.15
    const noise = () => (Math.random() - 0.5) * 0.02

    const cpuVal = Math.max(0, Math.min(1, cpu + wave * cpu + noise()))
    const memVal = Math.max(0, memBase + (wave * memBase * 0.05) + (noise() * memBase * 0.02))

    return {
      time,
      cpu: cpuVal,
      maxcpu: 64,
      memused: memVal,
      memtotal: memTotal,
      netin: Math.max(0, 50000000 + wave * 30000000 + Math.random() * 10000000),
      netout: Math.max(0, 30000000 + wave * 20000000 + Math.random() * 8000000),
      diskread: Math.max(0, 5000000 + Math.random() * 3000000),
      diskwrite: Math.max(0, 3000000 + Math.random() * 2000000),
      rootused: 8500000000 + Math.random() * 500000000,
      roottotal: 20939620352,
      swapused: 100000000 + Math.random() * 50000000,
      swaptotal: 8589934592,
      iowait: Math.random() * 0.02,
      loadavg: 0.5 + wave * 0.3 + Math.random() * 0.2,
    }
  })
}

// ---------------------------------------------------------------------------
// Helper: generate demo backup entries
// ---------------------------------------------------------------------------

function formatBytesUtil(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function generateBackupEntries(count: number, prefix: string, datastore: string): any[] {
  const now = Date.now()
  const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','dns-primary','ldap-auth','ci-runner','vault-prod']
  const backupTypes = ['vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'ct', 'ct']
  return Array.from({ length: count }, (_, i) => {
    const vmid = 100 + (i % 45)
    const name = vmNames[i % vmNames.length]
    const ageMs = Math.random() * 7 * 24 * 3600 * 1000
    const backupTime = Math.floor((now - ageMs) / 1000)
    const backupDate = new Date(backupTime * 1000)
    const size = 1073741824 + Math.floor(Math.random() * 10737418240)
    const bType = backupTypes[i % backupTypes.length]
    const verified = i < count - 2
    return {
      id: `${datastore}/${bType}/${vmid}/${backupTime}`,
      datastore,
      namespace: '',
      backupType: bType,
      backupId: String(vmid),
      vmName: name,
      backupTime,
      backupTimeFormatted: backupDate.toLocaleString('en-US'),
      backupTimeIso: backupDate.toISOString(),
      size,
      sizeFormatted: formatBytesUtil(size),
      files: [],
      fileCount: 0,
      verification: verified ? { state: 'ok', upid: null } : null,
      verified,
      verifiedAt: null,
      protected: i === 0,
      owner: 'root@pam',
      comment: name,
    }
  })
}

// ---------------------------------------------------------------------------
// Helper: generate change entries
// ---------------------------------------------------------------------------

function generateChangeEntries(): any[] {
  const now = Date.now()
  const actions: { action: string, field: string, oldValue: string, newValue: string }[] = [
    { action: 'config_change', field: 'memory', oldValue: '4096', newValue: '8192' },
    { action: 'config_change', field: 'cores', oldValue: '2', newValue: '4' },
    { action: 'config_change', field: 'description', oldValue: '', newValue: 'Production web server' },
    { action: 'status_change', field: 'status', oldValue: 'stopped', newValue: 'running' },
    { action: 'status_change', field: 'status', oldValue: 'running', newValue: 'stopped' },
    { action: 'migration', field: 'node', oldValue: 'pve-node-01', newValue: 'pve-node-03' },
    { action: 'migration', field: 'node', oldValue: 'pve-node-05', newValue: 'pve-node-02' },
    { action: 'config_change', field: 'net0', oldValue: 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0', newValue: 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr1' },
    { action: 'snapshot', field: 'snapshot', oldValue: '', newValue: 'pre-upgrade-2026-03' },
    { action: 'config_change', field: 'boot', oldValue: 'order=scsi0', newValue: 'order=scsi0;net0' },
    { action: 'config_change', field: 'balloon', oldValue: '0', newValue: '2048' },
    { action: 'status_change', field: 'status', oldValue: 'paused', newValue: 'running' },
    { action: 'config_change', field: 'tags', oldValue: 'prod', newValue: 'prod;critical' },
    { action: 'config_change', field: 'onboot', oldValue: '0', newValue: '1' },
    { action: 'config_change', field: 'scsihw', oldValue: 'lsi', newValue: 'virtio-scsi-single' },
  ]
  const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','dns-primary','ldap-auth','ci-runner','vault-prod','web-prod-02','web-prod-03','db-replica-01','proxy-lb','elastic-node-01']
  const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06']

  return actions.map((a, i) => ({
    id: `chg-${String(i + 1).padStart(3, '0')}`,
    resourceType: 'vm',
    resourceId: String(100 + i),
    resourceName: vmNames[i % vmNames.length],
    action: a.action,
    field: a.field,
    oldValue: a.oldValue,
    newValue: a.newValue,
    connectionId: 'demo-pve-cluster-001',
    connectionName: 'Production Cluster',
    node: nodes[i % nodes.length],
    timestamp: new Date(now - i * 3600 * 1000).toISOString(),
    detectedBy: 'polling',
  }))
}

// ---------------------------------------------------------------------------
// Helper: health score history (30 days)
// ---------------------------------------------------------------------------

function generateHealthHistory(): { date: string, score: number }[] {
  const now = new Date()
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (29 - i))
    const score = 88 + Math.round(Math.random() * 8)
    return { date: d.toISOString().slice(0, 10), score: Math.min(96, score) }
  })
}

// ---------------------------------------------------------------------------
// Hardcoded mock responses for endpoints not in mock-data.json
// ---------------------------------------------------------------------------

const EXTRA_MOCKS: MockDataMap = {
  // --- Auth ---
  'GET:/api/v1/auth/session': {
    user: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
      image: null,
    },
  },

  'GET:/api/v1/auth/providers': {
    credentials: {
      id: 'credentials',
      name: 'Credentials',
      type: 'credentials',
    },
  },

  'POST:/api/v1/auth/callback/credentials': {
    ok: true,
    url: '/home',
  },

  // --- App / Settings ---
  'GET:/api/v1/app/status': {
    data: {
      configured: true,
      hasAdmin: true,
      version: '1.0.0-demo',
    },
    connectionsConfigured: true,
    hasConnections: true,
  },

  'GET:/api/v1/settings/branding/public': {
    enabled: false,
    appName: 'ProxCenter',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    browserTitle: '',
    poweredByVisible: true,
  },

  'GET:/api/v1/settings/branding': {
    enabled: false,
    appName: 'ProxCenter',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    browserTitle: '',
    poweredByVisible: true,
  },

  'GET:/api/v1/version': {
    data: { version: '1.0.0-demo', edition: 'Enterprise' },
  },

  'GET:/api/v1/license/features': {
    data: {
      edition: 'enterprise',
      features: [
        'white_label',
        'sso',
        'ldap',
        'compliance',
        'api_access',
        'priority_support',
        'custom_roles',
        'advanced_monitoring',
        'migration',
        'drs',
        'ceph_replication',
        'cve_scanning',
        'change_tracking',
      ],
    },
  },

  // --- License ---
  'GET:/api/v1/license/status': {
    licensed: true,
    expired: false,
    edition: 'enterprise',
    plan: 'enterprise',
    expiresAt: '2027-12-31T23:59:59.000Z',
  },

  // --- User / RBAC ---
  'GET:/api/v1/rbac/me': {
    data: {
      userId: 'demo-user',
      roles: ['super_admin'],
      permissions: ['*'],
    },
  },

  'GET:/api/v1/rbac/effective': {
    data: {
      permissions: ['*'],
      roles: ['super_admin'],
      is_super_admin: true,
    },
  },

  'GET:/api/v1/rbac/roles': {
    data: [
      {
        id: 'super_admin',
        name: 'Super Admin',
        description: 'Full access to all features',
        permissions: ['*'],
        isSystem: true,
      },
    ],
  },

  'GET:/api/v1/users': {
    data: [
      {
        id: 'demo-user',
        name: 'Admin Demo',
        email: 'admin@demo.proxcenter.io',
        role: 'super_admin',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },

  'GET:/api/v1/users/me': {
    data: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
    },
  },

  // --- RBAC Assignments ---
  'GET:/api/v1/rbac/assignments': {
    data: [
      {
        id: 'assign-001',
        userId: 'demo-user',
        roleId: 'super_admin',
        scope: 'global',
        connectionId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  },

  // --- RBAC Permissions ---
  'GET:/api/v1/rbac/permissions': {
    data: [
      { id: 'perm-infra-view', name: 'infrastructure.view', category: 'Infrastructure', description: 'View infrastructure connections and overview' },
      { id: 'perm-infra-manage', name: 'infrastructure.manage', category: 'Infrastructure', description: 'Add, edit and remove infrastructure connections' },
      { id: 'perm-infra-nodes', name: 'infrastructure.nodes.view', category: 'Infrastructure', description: 'View node details and metrics' },
      { id: 'perm-vm-view', name: 'vms.view', category: 'VMs', description: 'View virtual machines list and details' },
      { id: 'perm-vm-start', name: 'vms.start', category: 'VMs', description: 'Start virtual machines' },
      { id: 'perm-vm-stop', name: 'vms.stop', category: 'VMs', description: 'Stop virtual machines' },
      { id: 'perm-vm-migrate', name: 'vms.migrate', category: 'VMs', description: 'Migrate virtual machines between nodes' },
      { id: 'perm-vm-snapshot', name: 'vms.snapshot', category: 'VMs', description: 'Create and manage VM snapshots' },
      { id: 'perm-vm-console', name: 'vms.console', category: 'VMs', description: 'Access VM console (noVNC / xterm)' },
      { id: 'perm-storage-view', name: 'storage.view', category: 'Storage', description: 'View storage pools and usage' },
      { id: 'perm-storage-manage', name: 'storage.manage', category: 'Storage', description: 'Create and configure storage pools' },
      { id: 'perm-storage-ceph', name: 'storage.ceph.manage', category: 'Storage', description: 'Manage Ceph cluster and replication' },
      { id: 'perm-backup-view', name: 'backups.view', category: 'Backups', description: 'View backup jobs and history' },
      { id: 'perm-backup-create', name: 'backups.create', category: 'Backups', description: 'Create backup jobs' },
      { id: 'perm-backup-restore', name: 'backups.restore', category: 'Backups', description: 'Restore from backups' },
      { id: 'perm-backup-pbs', name: 'backups.pbs.manage', category: 'Backups', description: 'Manage PBS connections and settings' },
      { id: 'perm-auto-playbooks', name: 'automation.playbooks', category: 'Automation', description: 'Create and run automation playbooks' },
      { id: 'perm-auto-schedules', name: 'automation.schedules', category: 'Automation', description: 'Manage scheduled tasks' },
      { id: 'perm-auto-drs', name: 'automation.drs', category: 'Automation', description: 'Configure Dynamic Resource Scheduling' },
      { id: 'perm-sec-audit', name: 'security.audit', category: 'Security', description: 'View audit logs' },
      { id: 'perm-sec-compliance', name: 'security.compliance', category: 'Security', description: 'Run compliance scans and view reports' },
      { id: 'perm-sec-cve', name: 'security.cve', category: 'Security', description: 'View CVE scanning results' },
      { id: 'perm-settings-general', name: 'settings.general', category: 'Settings', description: 'Manage general application settings' },
      { id: 'perm-settings-users', name: 'settings.users', category: 'Settings', description: 'Manage users and roles' },
      { id: 'perm-settings-branding', name: 'settings.branding', category: 'Settings', description: 'Configure white-label branding' },
      { id: 'perm-settings-auth', name: 'settings.auth', category: 'Settings', description: 'Configure SSO, LDAP and OIDC providers' },
      { id: 'perm-settings-notifications', name: 'settings.notifications', category: 'Settings', description: 'Configure notification channels and templates' },
    ],
  },

  // --- Compliance ---
  'GET:/api/v1/compliance/hardening/demo-pve-cluster-001': {
    data: {
      connectionId: 'demo-pve-cluster-001',
      connectionName: 'Production Cluster',
      scannedAt: '2026-03-10T14:30:00.000Z',
      score: 78,
      totalChecks: 25,
      passed: 19,
      failed: 4,
      warnings: 2,
      checks: [
        { id: 'chk-auth-01', category: 'Authentication', name: 'Two-factor authentication', description: 'TFA is enabled for all admin accounts', severity: 'critical', status: 'passed', details: 'All 3 admin accounts have TFA enabled' },
        { id: 'chk-auth-02', category: 'Authentication', name: 'Root login disabled', description: 'Direct root SSH login is disabled', severity: 'critical', status: 'passed', details: 'PermitRootLogin set to no in sshd_config' },
        { id: 'chk-auth-03', category: 'Authentication', name: 'Password complexity', description: 'Password complexity requirements enforced', severity: 'high', status: 'passed', details: 'PAM password complexity module active' },
        { id: 'chk-auth-04', category: 'Authentication', name: 'Session timeout', description: 'Idle session timeout configured', severity: 'medium', status: 'warning', details: 'Session timeout set to 4 hours, recommended: 1 hour' },
        { id: 'chk-auth-05', category: 'Authentication', name: 'API token expiration', description: 'API tokens have expiration dates', severity: 'high', status: 'failed', details: '2 of 5 API tokens have no expiration set' },
        { id: 'chk-net-01', category: 'Network', name: 'Firewall enabled', description: 'Cluster firewall is enabled', severity: 'critical', status: 'passed', details: 'Datacenter firewall enabled on all nodes' },
        { id: 'chk-net-02', category: 'Network', name: 'Unused open ports', description: 'No unnecessary ports are open', severity: 'high', status: 'passed', details: 'Only required ports (8006, 22, 111, 3128) are open' },
        { id: 'chk-net-03', category: 'Network', name: 'VLAN segmentation', description: 'VMs are segmented with VLANs', severity: 'medium', status: 'passed', details: 'All production VMs use VLAN-tagged interfaces' },
        { id: 'chk-net-04', category: 'Network', name: 'Management network isolation', description: 'Management network is isolated from VM traffic', severity: 'high', status: 'failed', details: 'Management and VM traffic share vmbr0 on pve-node-04' },
        { id: 'chk-net-05', category: 'Network', name: 'NTP synchronization', description: 'All nodes are NTP synchronized', severity: 'medium', status: 'passed', details: 'chrony active, max drift < 10ms' },
        { id: 'chk-stor-01', category: 'Storage', name: 'Storage replication', description: 'Critical data has replication enabled', severity: 'high', status: 'passed', details: 'ZFS replication active for local-zfs' },
        { id: 'chk-stor-02', category: 'Storage', name: 'Backup retention policy', description: 'Backup retention policies are configured', severity: 'high', status: 'passed', details: 'PBS retention: keep-last=7, keep-weekly=4, keep-monthly=6' },
        { id: 'chk-stor-03', category: 'Storage', name: 'Storage encryption', description: 'Sensitive storage pools are encrypted', severity: 'high', status: 'failed', details: 'local-zfs pool is not encrypted' },
        { id: 'chk-stor-04', category: 'Storage', name: 'Storage space monitoring', description: 'Storage usage alerts are configured', severity: 'medium', status: 'passed', details: 'Alerts trigger at 80% and 90% usage' },
        { id: 'chk-stor-05', category: 'Storage', name: 'Shared storage availability', description: 'Shared storage is accessible from all nodes', severity: 'critical', status: 'passed', details: 'Ceph and NFS storage available on all 6 nodes' },
        { id: 'chk-clus-01', category: 'Cluster', name: 'Quorum status', description: 'Cluster has proper quorum', severity: 'critical', status: 'passed', details: '6 nodes, quorum requires 4 votes' },
        { id: 'chk-clus-02', category: 'Cluster', name: 'Corosync encryption', description: 'Corosync communication is encrypted', severity: 'high', status: 'passed', details: 'Corosync crypto_cipher: aes256, crypto_hash: sha256' },
        { id: 'chk-clus-03', category: 'Cluster', name: 'HA configuration', description: 'Critical VMs have HA enabled', severity: 'high', status: 'warning', details: '3 of 8 critical VMs do not have HA configured' },
        { id: 'chk-clus-04', category: 'Cluster', name: 'Fencing configuration', description: 'Node fencing is properly configured', severity: 'critical', status: 'passed', details: 'IPMI fencing configured for all nodes' },
        { id: 'chk-clus-05', category: 'Cluster', name: 'PVE version consistency', description: 'All nodes run the same PVE version', severity: 'high', status: 'passed', details: 'All nodes on PVE 8.3.2' },
        { id: 'chk-enc-01', category: 'Encryption', name: 'TLS certificates', description: 'Valid TLS certificates on all nodes', severity: 'critical', status: 'passed', details: 'All certificates valid, nearest expiry in 247 days' },
        { id: 'chk-enc-02', category: 'Encryption', name: 'Backup encryption', description: 'PBS backups are encrypted', severity: 'high', status: 'passed', details: 'AES-256-GCM encryption enabled on PBS' },
        { id: 'chk-enc-03', category: 'Encryption', name: 'SSH key strength', description: 'SSH keys use strong algorithms', severity: 'high', status: 'failed', details: 'pve-node-02 uses RSA-2048, recommended: ED25519 or RSA-4096' },
        { id: 'chk-enc-04', category: 'Encryption', name: 'LUKS disk encryption', description: 'OS disks use LUKS encryption', severity: 'medium', status: 'passed', details: 'All node OS disks encrypted with LUKS2' },
        { id: 'chk-enc-05', category: 'Encryption', name: 'Migration encryption', description: 'Live migration traffic is encrypted', severity: 'high', status: 'passed', details: 'Migration encryption set to secure mode' },
      ],
    },
  },

  'GET:/api/v1/compliance/policies': {
    data: [
      {
        id: 'pol-001',
        name: 'Production Security',
        description: 'Security policy for production clusters',
        enabled: true,
        rules: 12,
        lastEvaluation: '2026-03-10T14:30:00.000Z',
        score: 78,
      },
    ],
  },

  'GET:/api/v1/compliance/profiles': {
    data: [
      {
        id: 'prof-001',
        name: 'CIS Proxmox Benchmark',
        description: 'CIS compliance profile',
        type: 'cis',
        enabled: true,
        checkCount: 25,
        lastScan: '2026-03-10T14:30:00.000Z',
      },
    ],
  },

  // --- Settings AI ---
  'GET:/api/v1/settings/ai': {
    data: { enabled: false, provider: '', model: '', apiKey: '' },
  },

  // --- Settings Green IT ---
  'GET:/api/v1/settings/green': {
    data: { enabled: false },
  },

  // --- Notification settings & templates ---
  'GET:/api/v1/orchestrator/notifications/settings': {
    data: {
      enabled: false,
      smtp: { host: '', port: 587, secure: true },
      slack: { webhookUrl: '' },
      discord: { webhookUrl: '' },
    },
  },

  'GET:/api/v1/orchestrator/notifications/templates': {
    data: [],
  },

  // --- Auth providers (LDAP / OIDC) ---
  'GET:/api/v1/auth/ldap': {
    data: { enabled: false, url: '', baseDn: '', bindDn: '' },
  },

  'GET:/api/v1/auth/oidc': {
    data: { enabled: false, issuer: '', clientId: '', clientSecret: '' },
  },

  // --- Data endpoints ---
  'GET:/api/v1/alerts': { data: [] },
  'GET:/api/v1/alert-rules': { data: [] },

  // --- Orchestrator Alerts (for /operations/alerts page) ---
  get 'GET:/api/v1/orchestrator/alerts'() {
    const now = Date.now()
    const severities = ['critical', 'warning', 'warning', 'info', 'critical', 'warning', 'info', 'warning']
    const messages = [
      'Node pve-node-03: RAM usage critical (94%)',
      'Node pve-node-07: CPU usage high (82%)',
      'VM db-master: Disk I/O latency > 50ms',
      'Backup job vzdump-weekly completed with warnings',
      'Ceph OSD.7 is down on pve-dr-02',
      'Node pve-node-11: Storage pool local-zfs usage 87%',
      'PBS datastore backup-main: GC completed',
      'VM web-prod-01: High network packet loss detected',
    ]
    const sources = ['pve-node-03','pve-node-07','pve-node-01','pve-node-05','pve-dr-02','pve-node-11','PBS-MASTER','pve-node-01']
    return {
      data: messages.map((msg, i) => ({
        id: `alert-demo-${i}`,
        fingerprint: `fp-${i}`,
        severity: severities[i],
        message: msg,
        source: sources[i],
        sourceType: 'pve',
        entityType: i < 2 ? 'node' : i === 4 ? 'osd' : 'vm',
        entityName: sources[i],
        metric: i === 0 ? 'ram' : i === 1 ? 'cpu' : i === 2 ? 'disk_io' : null,
        currentValue: i === 0 ? 94 : i === 1 ? 82 : i === 5 ? 87 : null,
        threshold: i === 0 ? 90 : i === 1 ? 80 : i === 5 ? 85 : null,
        status: i < 5 ? 'active' : 'resolved',
        occurrences: 1 + Math.floor(Math.random() * 10),
        firstSeenAt: new Date(now - (i + 1) * 3600000).toISOString(),
        lastSeenAt: new Date(now - i * 600000).toISOString(),
        acknowledgedAt: i === 2 ? new Date(now - 1800000).toISOString() : null,
        acknowledgedBy: i === 2 ? 'admin' : null,
        resolvedAt: i >= 5 ? new Date(now - i * 300000).toISOString() : null,
      })),
      total: messages.length,
    }
  },
  'GET:/api/v1/orchestrator/alerts/summary': {
    data: { total: 8, active: 5, acknowledged: 1, resolved: 3, critical: 2, warning: 4, info: 2 },
  },
  get 'GET:/api/v1/orchestrator/alerts/rules'() {
    return {
      data: [
        { id: 'rule-1', name: 'High CPU Usage', metric: 'cpu', operator: '>', threshold: 80, severity: 'warning', duration: 300, enabled: true, cooldown: 600 },
        { id: 'rule-2', name: 'Critical RAM Usage', metric: 'ram', operator: '>', threshold: 90, severity: 'critical', duration: 120, enabled: true, cooldown: 300 },
        { id: 'rule-3', name: 'Storage Almost Full', metric: 'storage', operator: '>', threshold: 85, severity: 'warning', duration: 600, enabled: true, cooldown: 1800 },
        { id: 'rule-4', name: 'Node Offline', metric: 'status', operator: '==', threshold: 0, severity: 'critical', duration: 60, enabled: true, cooldown: 120 },
        { id: 'rule-5', name: 'Backup Failed', metric: 'backup_status', operator: '==', threshold: 0, severity: 'warning', duration: 0, enabled: false, cooldown: 3600 },
      ],
    }
  },
  'GET:/api/v1/orchestrator/alerts/thresholds': {
    data: { cpu: 80, ram: 90, storage: 85, iowait: 30 },
  },
  get 'GET:/api/v1/audit'() {
    const actions = [
      'user.login', 'user.login', 'user.logout',
      'vm.start', 'vm.stop', 'vm.migrate', 'vm.snapshot.create',
      'settings.branding.update', 'settings.general.update',
      'connection.create', 'connection.test',
      'backup.job.create', 'backup.restore',
      'user.create', 'rbac.role.assign',
    ]
    const details = [
      'User logged in via credentials', 'User logged in via SSO', 'User session ended',
      'Started VM 101 (web-prod-01)', 'Stopped VM 105 (monitoring)', 'Migrated VM 103 (api-gateway) from pve-node-01 to pve-node-03', 'Created snapshot "pre-update" on VM 102 (db-master)',
      'Updated branding settings: app name changed', 'Updated general settings: timezone changed to Europe/Paris',
      'Added connection "Production Cluster"', 'Connection test successful for "Production Cluster"',
      'Created backup job for VMs 101,102,103', 'Restored VM 105 from backup vzdump-qemu-105-2026_03_08',
      'Created user operator@proxcenter.io', 'Assigned role "operator" to user operator@proxcenter.io',
    ]
    const resourceTypes = [
      'user', 'user', 'user',
      'vm', 'vm', 'vm', 'vm',
      'settings', 'settings',
      'connection', 'connection',
      'backup', 'backup',
      'user', 'rbac',
    ]
    const resourceIds = [
      'demo-user', 'demo-user', 'demo-user',
      '101', '105', '103', '102',
      'branding', 'general',
      'demo-pve-cluster-001', 'demo-pve-cluster-001',
      'job-001', 'vzdump-105',
      'user-002', 'assign-002',
    ]
    const now = Date.now()
    return {
      data: Array.from({ length: 15 }, (_, i) => ({
        id: `audit-${String(i + 1).padStart(3, '0')}`,
        action: actions[i],
        userId: 'demo-user',
        userName: 'Admin Demo',
        userEmail: 'admin@demo.proxcenter.io',
        ip: i % 3 === 0 ? '192.168.1.100' : i % 3 === 1 ? '10.0.0.42' : '172.16.0.15',
        details: details[i],
        createdAt: new Date(now - i * 3600 * 1000).toISOString(),
        resourceType: resourceTypes[i],
        resourceId: resourceIds[i],
      })),
      total: 15,
    }
  },
  get 'GET:/api/v1/events'() {
    const now = Math.floor(Date.now() / 1000)
    const types = ['qmstart','qmstop','vzdump','qmmigrate','qmreboot','vzstart','pull','verify','garbage_collection']
    const labels = ['VM Start','VM Stop','Backup','Migration','VM Reboot','CT Start','Sync Pull','Verify','GC']
    const entities = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','ci-runner','vault-prod','proxy-lb','elastic-node-01']
    const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06']
    return {
      data: Array.from({ length: 20 }, (_, i) => {
        const startTs = now - i * 1800
        const endTs = i === 3 ? null : startTs + 30 + Math.floor(Math.random() * 120)
        const dur = endTs ? endTs - startTs : 0
        return {
          id: `UPID:${nodes[i % nodes.length]}:0000${String(i).padStart(4,'0')}:00000000:00000000:${types[i % types.length]}:${100 + i}:root@pam:`,
          type: types[i % types.length],
          status: i === 3 ? 'running' : (i === 7 ? 'WARNINGS' : 'OK'),
          level: i === 7 ? 'warning' : 'info',
          starttime: startTs,
          ts: new Date(startTs * 1000).toISOString(),
          endTs: endTs ? new Date(endTs * 1000).toISOString() : null,
          duration: dur > 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`,
          node: nodes[i % nodes.length],
          user: 'root@pam',
          entity: String(100 + i),
          entityName: entities[i % entities.length],
          typeLabel: labels[i % labels.length],
          message: labels[i % labels.length],
          connectionId: 'demo-pve-cluster-001',
          connectionName: 'Production Cluster',
        }
      }),
    }
  },
  'GET:/api/v1/favorites': { data: [] },
  'GET:/api/v1/tasks': { data: [] },

  // --- Changes (populated) ---
  get 'GET:/api/v1/changes'() {
    const entries = generateChangeEntries()
    return { data: entries, pagination: { total: entries.length, page: 1, limit: 50 } }
  },

  // --- Dashboard ---
  'GET:/api/v1/dashboard/metrics': {
    data: {
      totalVMs: 171,
      runningVMs: 161,
      stoppedVMs: 10,
      totalNodes: 12,
      onlineNodes: 12,
      totalClusters: 1,
      totalCPUCores: 768,
      avgCPUUsage: 3.4,
      avgRAMUsage: 66.7,
      healthScore: 94,
      totalStorageGB: 51200,
      usedStorageGB: 28160,
      storageUsagePercent: 55.0,
      totalMemoryGB: 3072,
      usedMemoryGB: 2049,
      uptimePercent: 99.97,
      vmsByStatus: {
        running: 161,
        stopped: 8,
        paused: 2,
      },
      topNodesByCPU: [
        { node: 'pve-node-03', cpu: 8.2 },
        { node: 'pve-node-07', cpu: 6.1 },
        { node: 'pve-node-01', cpu: 5.4 },
        { node: 'pve-node-11', cpu: 4.8 },
        { node: 'pve-node-05', cpu: 3.9 },
      ],
      topNodesByRAM: [
        { node: 'pve-node-02', ram: 82.3 },
        { node: 'pve-node-09', ram: 78.1 },
        { node: 'pve-node-06', ram: 74.5 },
        { node: 'pve-node-12', ram: 71.2 },
        { node: 'pve-node-04', ram: 68.9 },
      ],
    },
  },

  get 'GET:/api/v1/dashboard'() {
    const resources = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/resources'] as any)?.data || []
    const nodesData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/nodes'] as any)?.data || []

    const vms = resources.filter((r: any) => r.type === 'qemu')
    const lxcs = resources.filter((r: any) => r.type === 'lxc')
    const runningVms = vms.filter((v: any) => v.status === 'running')
    const runningLxc = lxcs.filter((v: any) => v.status === 'running')

    // Top CPU consumers
    const topCpu = [...resources].filter((r: any) => r.status === 'running' && r.cpu > 0)
      .sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 10)
      .map((v: any) => ({ name: v.name || `VM ${v.vmid}`, value: Math.round((v.cpu || 0) * 100 * 10) / 10 }))

    // Top RAM consumers
    const topRam = [...resources].filter((r: any) => r.status === 'running' && r.mem > 0)
      .sort((a: any, b: any) => (b.mem || 0) - (a.mem || 0))
      .slice(0, 10)
      .map((v: any) => ({ name: v.name || `VM ${v.vmid}`, value: Math.round(((v.mem || 0) / (v.maxmem || 1)) * 100 * 10) / 10 }))

    // Node list
    const nodesList = nodesData.map((n: any) => ({
      name: n.node,
      node: n.node,
      connId: 'demo-pve-cluster-001',
      connectionId: 'demo-pve-cluster-001',
      connection: 'Production Cluster',
      status: n.status || 'online',
      cpuPct: Math.round((n.cpu || 0) * 100 * 10) / 10,
      memPct: Math.round(((n.mem || 0) / (n.maxmem || 1)) * 100 * 10) / 10,
      uptime: 86400 * (7 + Math.floor(Math.random() * 30)),
      _cpuCores: n.maxcpu || 4,
      _storageUsed: 50 * 1073741824,
      _storageMax: 200 * 1073741824,
    }))

    // DR Cluster nodes (4 nodes)
    const drNodes = ['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04'].map(name => ({
      name, node: name,
      connId: 'demo-pve-cluster-002',
      connectionId: 'demo-pve-cluster-002',
      connection: 'DR Cluster (GRA)',
      status: 'online',
      cpuPct: Math.round((5 + Math.random() * 20) * 10) / 10,
      memPct: Math.round((40 + Math.random() * 30) * 10) / 10,
      uptime: 86400 * (10 + Math.floor(Math.random() * 20)),
      _cpuCores: 8,
      _storageUsed: 30 * 1073741824,
      _storageMax: 100 * 1073741824,
    }))

    nodesList.push(...drNodes)

    // Total provisioned vCPUs and memory
    const totalProvCpu = resources.reduce((s: number, r: any) => s + (r.maxcpu || 0), 0)
    const totalProvMem = resources.reduce((s: number, r: any) => s + (r.maxmem || 0), 0)
    const totalPhysCpu = nodesData.reduce((s: number, n: any) => s + (n.maxcpu || 0), 0)
    const totalPhysMem = nodesData.reduce((s: number, n: any) => s + (n.maxmem || 0), 0)
    const totalUsedMem = nodesData.reduce((s: number, n: any) => s + (n.mem || 0), 0)
    const avgCpu = nodesData.length > 0 ? nodesData.reduce((s: number, n: any) => s + (n.cpu || 0), 0) / nodesData.length * 100 : 0

    const formatBytes = (b: number) => {
      if (b >= 1099511627776) return `${(b / 1099511627776).toFixed(1)} TB`
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(0)} GB`
      return `${(b / 1048576).toFixed(0)} MB`
    }

    // VM list
    const vmList = vms.map((v: any, idx: number) => {
      // Override some VMs to show varied states in heatmap
      let status = v.status
      let cpuOverride = v.cpu || 0
      let memOverride = v.mem || 0
      const maxmem = v.maxmem || 1

      if (idx === 5 || idx === 12) { status = 'paused'; cpuOverride = 0 }
      else if (idx === 8 || idx === 22) { status = 'stopped'; cpuOverride = 0; memOverride = 0 }
      else if (idx === 3) { cpuOverride = 0.92 } // CPU critical
      else if (idx === 7) { cpuOverride = 0.78 } // CPU high
      else if (idx === 15) { memOverride = maxmem * 0.95 } // RAM critical
      else if (idx === 19) { cpuOverride = 0.65; memOverride = maxmem * 0.88 } // both high
      else if (idx === 25) { cpuOverride = 0.85 } // CPU high
      else if (idx === 30) { memOverride = maxmem * 0.92 } // RAM critical

      return {
        vmid: v.vmid, name: v.name, node: v.node, type: 'qemu',
        status, template: v.template || false,
        connId: 'demo-pve-cluster-001',
        cpu: cpuOverride, cpuPct: Math.round(cpuOverride * 100 * 10) / 10,
        mem: memOverride, maxmem,
        ramPct: maxmem ? Math.round((memOverride / maxmem) * 100 * 10) / 10 : 0,
        connection: 'Production Cluster',
      }
    })

    const lxcList = lxcs.map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, type: 'lxc',
      status: v.status, template: v.template || false,
      connId: 'demo-pve-cluster-001',
      cpu: v.cpu || 0, cpuPct: Math.round((v.cpu || 0) * 100 * 10) / 10,
      mem: v.mem || 0, maxmem: v.maxmem || 0,
      ramPct: v.maxmem ? Math.round((v.mem / v.maxmem) * 100 * 10) / 10 : 0,
      connection: 'Production Cluster',
    }))

    return {
      data: {
        summary: {
          clusters: 1,
          nodes: nodesData.length,
          nodesOnline: nodesData.filter((n: any) => n.status === 'online').length,
          nodesOffline: 0,
          vmsRunning: runningVms.length,
          vmsTotal: vms.length,
          lxcRunning: runningLxc.length,
          lxcTotal: lxcs.length,
          cpuPct: Math.round(avgCpu * 10) / 10,
          ramPct: Math.round((totalUsedMem / totalPhysMem) * 100 * 10) / 10,
        },
        resources: {
          cpuPct: Math.round(avgCpu * 10) / 10,
          cpuCores: totalPhysCpu,
          provCpuPct: Math.round((totalProvCpu / totalPhysCpu) * 100 * 10) / 10,
          provCpu: totalProvCpu,
          ramPct: Math.round((totalUsedMem / totalPhysMem) * 100 * 10) / 10,
          memUsedFormatted: formatBytes(totalUsedMem),
          memMaxFormatted: formatBytes(totalPhysMem),
          provMemPct: Math.round((totalProvMem / totalPhysMem) * 100 * 10) / 10,
          provMemFormatted: formatBytes(totalProvMem),
          storagePct: 55,
          storageUsedFormatted: '27.5 TB',
          storageMaxFormatted: '50.0 TB',
        },
        topCpu,
        topRam,
        nodes: nodesList,
        guests: {
          vms: {
            running: runningVms.length,
            stopped: vms.length - runningVms.length,
            templates: vms.filter((v: any) => v.template).length,
          },
          lxc: {
            running: runningLxc.length,
            stopped: lxcs.length - runningLxc.length,
          },
        },
        clusters: [
          {
            id: 'demo-pve-cluster-001',
            name: 'Production Cluster',
            nodes: nodesData.length,
            onlineNodes: nodesData.filter((n: any) => n.status === 'online').length,
            isCluster: true,
            quorum: { quorate: true, votes: nodesData.length, expected_votes: nodesData.length },
            cephHealth: 'HEALTH_OK',
          },
          {
            id: 'demo-pve-cluster-002',
            name: 'DR Cluster (GRA)',
            nodes: 4,
            onlineNodes: 4,
            isCluster: true,
            quorum: { quorate: true, votes: 4, expected_votes: 4 },
            cephHealth: 'HEALTH_OK',
          },
        ],
        ceph: {
          available: true,
          health: 'HEALTH_OK',
          usedPct: 42,
          osdsUp: 36,
          osdsTotal: 36,
          pgsTotal: 256,
          readBps: 52428800,
          writeBps: 31457280,
        },
        cephClusters: [
          {
            connId: 'demo-pve-cluster-001',
            name: 'Production Cluster',
            health: 'HEALTH_OK',
            osdsTotal: 36, osdsUp: 36, osdsIn: 36,
            pgsTotal: 256,
            bytesTotal: 21474836480000, bytesUsed: 9019431321600,
            usedPct: 42,
            readBps: 52428800, writeBps: 31457280,
          },
          {
            connId: 'demo-pve-cluster-002',
            name: 'DR Cluster (GRA)',
            health: 'HEALTH_ERR',
            osdsTotal: 12, osdsUp: 10, osdsIn: 10,
            pgsTotal: 128,
            bytesTotal: 8589934592000, bytesUsed: 6442450944000,
            usedPct: 75,
            readBps: 10485760, writeBps: 5242880,
          },
        ],
        pbs: {
          servers: 2,
          usagePct: 40,
          totalUsedFormatted: '8.0 TB',
          totalSizeFormatted: '20.0 TB',
          backups24h: { total: 45, ok: 44, error: 1 },
          verify24h: { ok: 38 },
          serverDetails: [
            { name: 'PBS Master', datastores: 1, usagePct: 50 },
            { name: 'PBS Replica', datastores: 1, usagePct: 30 },
          ],
          recentErrors: [],
        },
        alertsSummary: { crit: 0, warn: 2 },
        alerts: [
          { severity: 'warn', message: 'High memory usage on pve-node-02 (82.3%)', time: new Date(Date.now() - 1800000).toISOString(), source: 'pve-node-02' },
          { severity: 'warn', message: 'Backup job delayed on PBS Master', time: new Date(Date.now() - 3600000).toISOString(), source: 'PBS Master' },
        ],
        vmList,
        lxcList,
      },
    }
  },

  'GET:/api/v1/dashboard/layout': { data: { id: 'demo-layout', name: 'Default', isActive: true, widgets: [
    { id: 'sec-1', type: 'section-header', x: 0, y: 0, w: 12, h: 1, settings: { title: 'General' } },
    { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 1, w: 1, h: 7 },
    { id: 'kpi-2', type: 'kpi-vms', x: 1, y: 4, w: 1, h: 4 },
    { id: 'kpi-3', type: 'kpi-lxc', x: 1, y: 1, w: 1, h: 3 },
    { id: 'kpi-4', type: 'kpi-alerts', x: 11, y: 1, w: 1, h: 7 },
    { id: 'clusters-g', type: 'clusters-gauges', x: 2, y: 1, w: 5, h: 7 },
    { id: 'resources-1', type: 'resources-gauges', x: 7, y: 1, w: 2, h: 7 },
    { id: 'drs-1', type: 'drs-status', x: 9, y: 1, w: 2, h: 7 },
    { id: 'sec-2', type: 'section-header', x: 0, y: 18, w: 12, h: 1, settings: { title: 'Cluster / Ceph' } },
    { id: 'ceph-1', type: 'ceph-status', x: 0, y: 8, w: 3, h: 10 },
    { id: 'infra-1', type: 'infra-global-chart', x: 3, y: 8, w: 6, h: 10 },
    { id: 'heatmap-1', type: 'vm-heatmap', x: 9, y: 8, w: 3, h: 10 },
  ] } },

  // --- Inventory (non-stream) ---
  get 'GET:/api/v1/inventory'() {
    const connections = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
    const nodesData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/nodes'] as any)?.data || []
    const resources = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/resources'] as any)?.data || []
    const pveConns = connections.filter((c: any) => c.type === 'pve')
    const pbsConns = connections.filter((c: any) => c.type === 'pbs')

    const clusters = pveConns.map((c: any) => ({
      id: c.id, name: c.name, type: 'pve', status: 'online',
      nodes: nodesData.map((n: any) => ({
        ...n,
        guests: resources.filter((r: any) => r.node === n.node),
      })),
    }))

    const pbs = pbsConns.map((c: any) => ({
      id: c.id, name: c.name, type: 'pbs', status: 'online',
    }))

    return { data: { clusters, pbs } }
  },

  // --- VMs list ---
  get 'GET:/api/v1/vms'() {
    const resources = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/resources'] as any)?.data || []
    const vms = resources.map((r: any) => ({
      ...r,
      connId: 'demo-pve-cluster-001',
      connName: 'Production Cluster',
    }))
    return { data: { vms } }
  },

  // --- Storage overview ---
  get 'GET:/api/v1/storage'() {
    const storageData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/storage'] as any)?.data || []
    const seen = new Set<string>()
    const deduplicated = storageData.filter((s: any) => {
      if (seen.has(s.storage)) return false
      seen.add(s.storage)
      return true
    })
    return {
      data: {
        connections: [{
          id: 'demo-pve-cluster-001',
          name: 'Production Cluster',
          storages: deduplicated,
        }],
      },
    }
  },

  // --- Resources overview ---
  get 'GET:/api/v1/resources/overview'() {
    const resources = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/resources'] as any)?.data || []
    const storageData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/storage'] as any)?.data || []

    const topCpuVms = [...resources].sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 5).map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, cpu: v.cpu, maxcpu: v.maxcpu || 4,
    }))
    const topRamVms = [...resources].sort((a: any, b: any) => (b.mem || 0) - (a.mem || 0)).slice(0, 5).map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, mem: v.mem, maxmem: v.maxmem,
    }))

    const seen = new Set<string>()
    const storagePools = storageData.filter((s: any) => {
      if (seen.has(s.storage)) return false
      seen.add(s.storage)
      return true
    })

    return {
      data: {
        kpis: {
          cpu: { used: 3.4, allocated: 45.2, total: 100, trend: -0.2 },
          ram: { used: 66.7, allocated: 78.5, total: 100, trend: 0.5 },
          storage: { used: 28160000000000, total: 51200000000000, trend: 1.2 },
          vms: { total: 171, running: 161, stopped: 10 },
          efficiency: 82,
        },
        trends: generateRrdData('day').map(p => {
          const d = new Date(p.time * 1000)
          return {
            t: d.toISOString().slice(0, 10),
            cpu: Math.round(p.cpu * 1000) / 10,
            ram: Math.round((p.memused / p.memtotal) * 1000) / 10,
            storage: 55 + Math.round(Math.random() * 30) / 10,
          }
        }),
        topCpuVms,
        topRamVms,
        storagePools,
        overprovisioning: {
          cpu: {
            allocated: 684,
            used: 26,
            physical: 768,
            ratio: 0.89,
            efficiency: 3.8,
          },
          ram: {
            allocated: 2560,
            used: 2049,
            physical: 3072,
            ratio: 0.83,
            efficiency: 79.6,
          },
          perNode: [
            { name: 'pve-node-01', cpuRatio: 0.92, ramRatio: 0.85, cpuAllocated: 59, cpuPhysical: 64, ramAllocated: 218, ramPhysical: 256 },
            { name: 'pve-node-02', cpuRatio: 0.88, ramRatio: 0.91, cpuAllocated: 56, cpuPhysical: 64, ramAllocated: 233, ramPhysical: 256 },
            { name: 'pve-node-03', cpuRatio: 0.95, ramRatio: 0.78, cpuAllocated: 61, cpuPhysical: 64, ramAllocated: 200, ramPhysical: 256 },
            { name: 'pve-node-04', cpuRatio: 0.84, ramRatio: 0.82, cpuAllocated: 54, cpuPhysical: 64, ramAllocated: 210, ramPhysical: 256 },
            { name: 'pve-node-05', cpuRatio: 0.91, ramRatio: 0.87, cpuAllocated: 58, cpuPhysical: 64, ramAllocated: 223, ramPhysical: 256 },
            { name: 'pve-node-06', cpuRatio: 0.86, ramRatio: 0.80, cpuAllocated: 55, cpuPhysical: 64, ramAllocated: 205, ramPhysical: 256 },
          ],
          topOverprovisioned: [
            { vmid: '112', name: 'ci-runner', node: 'pve-node-03', cpuAllocated: 8, cpuUsedPct: 5.2, ramAllocatedGB: 16, ramUsedPct: 12.1, recommendedCpu: 2, recommendedRamGB: 4, potentialSavings: { cpu: 6, ramGB: 12 } },
            { vmid: '118', name: 'dev-staging', node: 'pve-node-05', cpuAllocated: 4, cpuUsedPct: 3.8, ramAllocatedGB: 8, ramUsedPct: 15.4, recommendedCpu: 1, recommendedRamGB: 2, potentialSavings: { cpu: 3, ramGB: 6 } },
            { vmid: '125', name: 'test-env-02', node: 'pve-node-01', cpuAllocated: 4, cpuUsedPct: 8.1, ramAllocatedGB: 8, ramUsedPct: 22.3, recommendedCpu: 2, recommendedRamGB: 4, potentialSavings: { cpu: 2, ramGB: 4 } },
          ],
        },
        healthScoreHistory: generateHealthHistory(),
        connections: [{ id: 'demo-pve-cluster-001', name: 'Production Cluster' }],
      },
    }
  },

  // --- PBS Status ---
  'GET:/api/v1/pbs/demo-pbs-001/status': {
    data: { totalSize: 10995116277760, usedSize: 5497558138880, usagePercent: 50, uptime: 864000, version: '3.2-1' },
  },
  'GET:/api/v1/pbs/demo-pbs-002/status': {
    data: { totalSize: 10995116277760, usedSize: 3298534883328, usagePercent: 30, uptime: 432000, version: '3.2-1' },
  },

  // --- PBS Datastores ---
  'GET:/api/v1/pbs/demo-pbs-001/datastores': {
    data: [{
      name: 'backup-main', path: '/mnt/datastore/backup-main', comment: 'Main backup store',
      total: 10995116277760, used: 5497558138880, available: 5497558138880, usagePercent: 50,
      backupCount: 342, vmCount: 45, ctCount: 0, hostCount: 3,
    }],
  },
  'GET:/api/v1/pbs/demo-pbs-002/datastores': {
    data: [{
      name: 'backup-replica', path: '/mnt/datastore/backup-replica', comment: 'Replica store',
      total: 10995116277760, used: 3298534883328, available: 7696581394432, usagePercent: 30,
      backupCount: 285, vmCount: 40, ctCount: 0, hostCount: 3,
    }],
  },

  // --- PBS Backups ---
  get 'GET:/api/v1/pbs/demo-pbs-001/backups'() {
    const backups = generateBackupEntries(20, 'pbs1', 'backup-main')
    const verifiedCount = backups.filter((b: any) => b.verified).length
    return {
      data: {
        backups,
        stats: { total: 342, vmCount: 300, ctCount: 42, hostCount: 0, totalSize: 1099511627776, totalSizeFormatted: '1.00 TB', verifiedCount, protectedCount: 1 },
        pagination: { page: 1, pageSize: 50, totalPages: 7, totalItems: 342, hasNext: true, hasPrev: false },
        warnings: [],
      },
    }
  },
  get 'GET:/api/v1/pbs/demo-pbs-002/backups'() {
    const backups = generateBackupEntries(15, 'pbs2', 'backup-replica')
    const verifiedCount = backups.filter((b: any) => b.verified).length
    return {
      data: {
        backups,
        stats: { total: 285, vmCount: 250, ctCount: 35, hostCount: 0, totalSize: 879609302221, totalSizeFormatted: '819.20 GB', verifiedCount, protectedCount: 1 },
        pagination: { page: 1, pageSize: 50, totalPages: 6, totalItems: 285, hasNext: true, hasPrev: false },
        warnings: [],
      },
    }
  },

  // --- PBS Jobs ---
  'GET:/api/v1/pbs/demo-pbs-001/jobs': {
    data: { jobs: [], datastores: ['backup-main'], stats: { total: 2, running: 0, scheduled: 2 } },
  },
  'GET:/api/v1/pbs/demo-pbs-002/jobs': {
    data: { jobs: [], datastores: ['backup-replica'], stats: { total: 1, running: 0, scheduled: 1 } },
  },

  // --- Backup Jobs per connection ---
  get 'GET:/api/v1/connections/demo-pve-cluster-001/backup-jobs'() {
    const now = Math.floor(Date.now() / 1000)
    const dayInSec = 86400
    const nextRun2am = now - (now % dayInSec) + dayInSec + 7200
    const lastRun2am = nextRun2am - dayInSec
    const dayOfWeek = new Date().getDay()
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek
    const nextSunday3am = now - (now % dayInSec) + daysUntilSunday * dayInSec + 10800
    const lastSunday3am = nextSunday3am - 7 * dayInSec
    return {
      data: {
        jobs: [
          {
            id: 'backup-daily-001', type: 'vzdump', enabled: true, schedule: '0 2 * * *',
            mode: 'snapshot', compress: 'zstd', storage: 'PBS_MASTER_RBX', mailnotification: 'always',
            vmid: 'all', node: null, comment: 'Daily backup - all VMs',
            next_run: nextRun2am, last_run: lastRun2am, last_status: 'ok',
          },
          {
            id: 'backup-weekly-001', type: 'vzdump', enabled: true, schedule: '0 3 * * 0',
            mode: 'snapshot', compress: 'zstd', storage: 'PBS_MASTER_RBX',
            vmid: '100,101,102,104', node: null, comment: 'Weekly backup - critical VMs',
            next_run: nextSunday3am, last_run: lastSunday3am, last_status: 'ok',
          },
        ],
        allBackupStorages: ['PBS_MASTER_RBX', 'local'],
        nodes: ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06','pve-node-07','pve-node-08','pve-node-09','pve-node-10','pve-node-11','pve-node-12'],
      },
    }
  },

  // --- Orchestrator / Task Center ---
  'GET:/api/v1/orchestrator/jobs': {
    data: [], stats: { total: 0, running: 0, pending: 0, failed: 0, completed: 0 },
  },

  // --- DRS ---
  // Note: DRS API routes return data directly (no { data: ... } wrapper)
  get 'GET:/api/v1/orchestrator/drs/status'() {
    return {
      enabled: true, mode: 'manual',
      recommendations: 5,
      active_migrations: 0,
      pending_count: 5,
      approved_count: 0,
      clusters: {
        'demo-pve-cluster-001': {
          score: 92, status: 'balanced',
          lastEvaluation: new Date(Date.now() - 300000).toISOString(),
          recommendations: 5,
        },
      },
    }
  },
  get 'GET:/api/v1/orchestrator/drs/recommendations'() {
    const now = Date.now()
    const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06','pve-node-07','pve-node-08','pve-node-09','pve-node-10','pve-node-11','pve-node-12']
    const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','ci-runner','vault-prod','elastic-node-01','proxy-lb']
    const reasons = [
      'Memory imbalance: pve-node-02 at 82.3% vs pve-node-08 at 45.1%',
      'CPU imbalance: pve-node-03 at 8.2% vs pve-node-10 at 1.1%',
      'Memory pressure on pve-node-09 (78.1%) — moving VM to pve-node-04 (52.3%)',
      'Homogenization: spreading VMs more evenly across nodes',
      'Storage I/O contention on pve-node-07 — relocate to pve-node-11',
    ]
    return Array.from({ length: 5 }, (_, i) => {
      const src = nodes[i * 2 % nodes.length]
      const tgt = nodes[(i * 2 + 5) % nodes.length]
      return {
        id: `rec-${String(i + 1).padStart(3, '0')}`,
        connection_id: 'demo-pve-cluster-001',
        vmid: 100 + i * 3,
        vm_name: vmNames[i],
        guest_type: 'qemu',
        source_node: src,
        target_node: tgt,
        reason: reasons[i],
        priority: ['medium','high','medium','low','high'][i],
        score: [78, 85, 72, 65, 81][i],
        created_at: new Date(now - (i + 1) * 600000).toISOString(),
        status: 'pending',
        confirmation_count: 3,
        last_seen_at: new Date(now - i * 60000).toISOString(),
        maintenance_evacuation: false,
      }
    })
  },
  get 'GET:/api/v1/orchestrator/drs/migrations'() {
    const now = Date.now()
    return [
      {
        id: 'mig-001',
        recommendation_id: 'rec-prev-001',
        connection_id: 'demo-pve-cluster-001',
        vmid: 115,
        vm_name: 'web-prod-02',
        guest_type: 'qemu',
        source_node: 'pve-node-06',
        target_node: 'pve-node-01',
        task_id: 'UPID:pve-node-01:000ABCDE:12345678:67890ABC:qmigrate:115:root@pam:',
        started_at: new Date(now - 3600000).toISOString(),
        completed_at: new Date(now - 3300000).toISOString(),
        status: 'completed',
      },
      {
        id: 'mig-002',
        recommendation_id: 'rec-prev-002',
        connection_id: 'demo-pve-cluster-001',
        vmid: 128,
        vm_name: 'db-replica-01',
        guest_type: 'qemu',
        source_node: 'pve-node-09',
        target_node: 'pve-node-04',
        task_id: 'UPID:pve-node-04:000ABCDF:12345679:67890ABD:qmigrate:128:root@pam:',
        started_at: new Date(now - 7200000).toISOString(),
        completed_at: new Date(now - 6900000).toISOString(),
        status: 'completed',
      },
    ]
  },
  'GET:/api/v1/orchestrator/drs/settings': {
    enabled: true,
    mode: 'manual',
    balancing_method: 'memory',
    balancing_mode: 'used',
    balance_types: ['vm', 'ct'],
    maintenance_nodes: [],
    excluded_clusters: [],
    excluded_nodes: {},
    cluster_modes: { 'demo-pve-cluster-001': 'manual' },
    cpu_high_threshold: 80,
    cpu_low_threshold: 20,
    memory_high_threshold: 85,
    memory_low_threshold: 25,
    storage_high_threshold: 90,
    imbalance_threshold: 5,
    homogenization_enabled: true,
    max_load_spread: 10,
    cpu_weight: 1.0,
    memory_weight: 1.0,
    storage_weight: 0.5,
    max_concurrent_migrations: 2,
    migration_cooldown: '5m',
    balance_larger_first: false,
    prevent_overprovisioning: true,
    enable_affinity_rules: true,
    enforce_affinity: false,
    rebalance_schedule: 'interval',
    rebalance_interval: '15m',
    rebalance_time: '10:00',
  },
  'GET:/api/v1/orchestrator/drs/rules': [],
  get 'GET:/api/v1/orchestrator/metrics'() {
    const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06','pve-node-07','pve-node-08','pve-node-09','pve-node-10','pve-node-11','pve-node-12']
    const vmCounts = [18, 16, 15, 14, 12, 15, 13, 14, 16, 11, 14, 13]
    return {
      'demo-pve-cluster-001': {
        connection_id: 'demo-pve-cluster-001',
        connection_name: 'Production Cluster',
        collected_at: new Date().toISOString(),
        nodes: nodes.map((n, i) => ({
          node: n,
          status: 'online',
          cpu_usage: Number.parseFloat((2 + Math.random() * 6).toFixed(1)),
          memory_usage: Number.parseFloat((55 + Math.random() * 25).toFixed(1)),
          vm_count: vmCounts[i],
          ct_count: Math.floor(Math.random() * 3),
          running_vms: vmCounts[i] - Math.floor(Math.random() * 2),
          in_maintenance: false,
        })),
        summary: {
          total_nodes: 12,
          online_nodes: 12,
          total_vms: 171,
          running_vms: 161,
          avg_cpu_usage: 3.4,
          avg_memory_usage: 66.7,
          imbalance: 4.2,
        },
        pve_version: 8,
      },
    }
  },

  // --- Replication / Site Recovery ---
  // Note: these API routes return data directly (no { data: ... } wrapper)
  get 'GET:/api/v1/orchestrator/replication/status'() {
    const now = Date.now()
    return {
      sites: [
        {
          id: 'demo-pve-cluster-001',
          name: 'Production Cluster (RBX)',
          type: 'primary',
          status: 'online',
          nodes: 12,
          vms: 171,
        },
        {
          id: 'demo-pve-dr-001',
          name: 'DR Cluster (GRA)',
          type: 'secondary',
          status: 'online',
          nodes: 4,
          vms: 24,
        },
      ],
      connectivity: 'connected',
      latency_ms: 8.4,
      kpis: {
        protected_vms: 24,
        unprotected_vms: 147,
        avg_rpo_seconds: 900,
        last_sync: new Date(now - 420000).toISOString(),
        replicated_bytes: 536870912000,
        error_count: 0,
        total_jobs: 3,
        rpo_compliance: 96,
      },
      recent_activity: [
        { type: 'sync_completed', job_id: 'repl-001', message: 'Sync completed for job "Critical VMs"', timestamp: new Date(now - 420000).toISOString() },
        { type: 'sync_completed', job_id: 'repl-002', message: 'Sync completed for job "Database Servers"', timestamp: new Date(now - 900000).toISOString() },
        { type: 'sync_started', job_id: 'repl-003', message: 'Sync started for job "Web Frontends"', timestamp: new Date(now - 1200000).toISOString() },
        { type: 'sync_completed', job_id: 'repl-003', message: 'Sync completed for job "Web Frontends"', timestamp: new Date(now - 1080000).toISOString() },
        { type: 'rpo_met', job_id: 'repl-001', message: 'RPO target met for all jobs', timestamp: new Date(now - 1800000).toISOString() },
      ],
      job_summary: {
        synced: 3,
        syncing: 0,
        pending: 0,
        error: 0,
        paused: 0,
      },
    }
  },
  get 'GET:/api/v1/orchestrator/replication/jobs'() {
    const now = Date.now()
    return [
      {
        id: 'repl-001',
        vm_ids: [100, 101, 102, 104],
        vm_names: ['web-prod-01', 'db-master', 'api-gateway', 'redis-cache'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '*/15 * * * *',
        rpo_target: 900,
        last_sync: new Date(now - 420000).toISOString(),
        next_sync: new Date(now + 480000).toISOString(),
        throughput_bps: 125829120,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0', 'vmbr1': 'vmbr1' },
        progress_percent: 100,
        created_at: new Date(now - 30 * 86400000).toISOString(),
        updated_at: new Date(now - 420000).toISOString(),
      },
      {
        id: 'repl-002',
        vm_ids: [103, 110, 111],
        vm_names: ['db-replica-01', 'postgres-main', 'mysql-analytics'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '*/15 * * * *',
        rpo_target: 900,
        last_sync: new Date(now - 900000).toISOString(),
        next_sync: new Date(now + 300000).toISOString(),
        throughput_bps: 83886080,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0' },
        progress_percent: 100,
        created_at: new Date(now - 25 * 86400000).toISOString(),
        updated_at: new Date(now - 900000).toISOString(),
      },
      {
        id: 'repl-003',
        vm_ids: [105, 106, 107, 108, 109, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123],
        vm_names: ['monitoring', 'mail-server', 'dns-primary', 'ldap-auth', 'ci-runner', 'vault-prod', 'elastic-node-01', 'proxy-lb', 'web-prod-02', 'web-prod-03', 'grafana', 'dev-staging', 'test-env-01', 'test-env-02', 'jenkins', 'sonarqube', 'nexus'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '0 */2 * * *',
        rpo_target: 7200,
        last_sync: new Date(now - 1080000).toISOString(),
        next_sync: new Date(now + 5400000).toISOString(),
        throughput_bps: 209715200,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0', 'vmbr1': 'vmbr1' },
        progress_percent: 100,
        created_at: new Date(now - 20 * 86400000).toISOString(),
        updated_at: new Date(now - 1080000).toISOString(),
      },
    ]
  },
  'GET:/api/v1/orchestrator/replication/plans': [
    {
      id: 'plan-001',
      name: 'Critical Infrastructure DR',
      description: 'Failover plan for critical production VMs (web, db, api, cache)',
      status: 'ready',
      source_cluster: 'demo-pve-cluster-001',
      target_cluster: 'demo-pve-dr-001',
      vms: [
        { vm_id: 100, vm_name: 'web-prod-01', replication_job_id: 'repl-001', tier: 1, boot_order: 1 },
        { vm_id: 101, vm_name: 'db-master', replication_job_id: 'repl-001', tier: 1, boot_order: 2 },
        { vm_id: 102, vm_name: 'api-gateway', replication_job_id: 'repl-001', tier: 1, boot_order: 3 },
        { vm_id: 104, vm_name: 'redis-cache', replication_job_id: 'repl-001', tier: 2, boot_order: 4 },
      ],
      last_test: new Date(Date.now() - 7 * 86400000).toISOString(),
      last_failover: null,
      created_at: new Date(Date.now() - 28 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
  ],

  // --- DR Cluster ---
  'GET:/api/v1/connections/demo-pve-dr-001/nodes': {
    data: [
      { node: 'pve-dr-01', status: 'online', cpu: 0.02, maxcpu: 32, mem: 34359738368, maxmem: 68719476736, disk: 5368709120, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-02', status: 'online', cpu: 0.03, maxcpu: 32, mem: 30064771072, maxmem: 68719476736, disk: 4294967296, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-03', status: 'online', cpu: 0.01, maxcpu: 32, mem: 27917287424, maxmem: 68719476736, disk: 3221225472, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-04', status: 'online', cpu: 0.02, maxcpu: 32, mem: 25769803776, maxmem: 68719476736, disk: 4294967296, maxdisk: 20939620352, uptime: 864000 },
    ],
  },
  'GET:/api/v1/connections/demo-pve-dr-001/resources': { data: [] },
  'GET:/api/v1/connections/demo-pve-dr-001/storage': { data: [] },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph/status': {
    data: { health: { status: 'HEALTH_OK' }, osdmap: { num_osds: 12, num_up_osds: 12, num_in_osds: 12 } },
  },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph': {
    data: {
      hasCeph: true,
      health: { status: 'HEALTH_ERR', checks: { OSD_DOWN: { severity: 'HEALTH_ERR', summary: { message: '2 osds down' } } } },
      osdmap: { num_osds: 12, num_up_osds: 10, num_in_osds: 10 },
      pgmap: { num_pgs: 128, bytes_total: 8589934592000, bytes_used: 6442450944000, read_bytes_sec: 10485760, write_bytes_sec: 5242880 },
      pools: {
        total: 1,
        list: [
          { id: 0, name: 'rbd-dr', size: 3, min_size: 2, pg_num: 128, type: 'replicated', crush_rule: 0, application: 'rbd', bytes_used: 6000000000000, max_avail: 2000000000000, percent_used: 75 },
        ],
      },
      osds: {
        total: 12, up: 10, in: 10,
        list: Array.from({ length: 12 }, (_, i) => ({ id: i, name: `osd.${i}`, status: i >= 10 ? 'down' : 'up', in: i < 10 ? 1 : 0, host: `pve-dr-${String((i % 4) + 1).padStart(2, '0')}`, deviceClass: 'ssd', crushWeight: 3.64, reweight: i < 10 ? 1 : 0, pgs: i < 10 ? 12 : 0, kbUsed: 500000000, kb: 3906250000, utilization: i < 10 ? 75 + Math.random() * 5 : 0, commitLatencyMs: 1 + Math.random() * 5, applyLatencyMs: 0.8 + Math.random() * 3 })),
      },
      monitors: {
        total: 3,
        list: [
          { name: 'pve-dr-01', host: 'pve-dr-01', addr: '10.20.10.1:6789/0', rank: 0, status: 'leader' },
          { name: 'pve-dr-02', host: 'pve-dr-02', addr: '10.20.10.2:6789/0', rank: 1, status: 'peon' },
          { name: 'pve-dr-03', host: 'pve-dr-03', addr: '10.20.10.3:6789/0', rank: 2, status: 'peon' },
        ],
      },
    },
  },
  'GET:/api/v1/connections/demo-pve-cluster-001/ceph-vms': {
    data: Array.from({ length: 24 }, (_, i) => ({ vmid: 100 + i, cephDiskGb: 50 + Math.floor(Math.random() * 200) })),
  },
  'GET:/api/v1/connections/demo-pve-cluster-001/ceph': {
    data: {
      hasCeph: true,
      health: { status: 'HEALTH_OK', checks: {} },
      osdmap: { num_osds: 36, num_up_osds: 36, num_in_osds: 36 },
      pgmap: { num_pgs: 256, bytes_total: 21474836480000, bytes_used: 9019431321600, read_bytes_sec: 52428800, write_bytes_sec: 31457280 },
      pools: {
        total: 3,
        list: [
          { id: 0, name: 'rbd-pool', size: 3, min_size: 2, pg_num: 128, type: 'replicated', crush_rule: 0, application: 'rbd', bytes_used: 5000000000000, max_avail: 8000000000000, percent_used: 38 },
          { id: 1, name: 'cephfs-data', size: 3, min_size: 2, pg_num: 64, type: 'replicated', crush_rule: 0, application: 'cephfs', bytes_used: 3000000000000, max_avail: 5000000000000, percent_used: 37 },
          { id: 2, name: 'rgw-pool', size: 3, min_size: 2, pg_num: 64, type: 'replicated', crush_rule: 0, application: 'rgw', bytes_used: 1000000000000, max_avail: 3000000000000, percent_used: 25 },
        ],
      },
      osds: {
        total: 36, up: 36, in: 36,
        list: Array.from({ length: 36 }, (_, i) => ({ id: i, name: `osd.${i}`, status: 'up', in: 1, host: `pve-node-${String((i % 12) + 1).padStart(2, '0')}`, deviceClass: i < 24 ? 'ssd' : 'hdd', crushWeight: 3.64, reweight: 1, pgs: 7 + Math.floor(Math.random() * 3), kbUsed: 250000000 + Math.floor(Math.random() * 50000000), kb: 3906250000, utilization: 6 + Math.random() * 2, commitLatencyMs: 0.5 + Math.random() * 2, applyLatencyMs: 0.3 + Math.random() * 1.5 })),
      },
      monitors: {
        total: 3,
        list: [
          { name: 'pve-node-01', host: 'pve-node-01', addr: '10.10.10.1:6789/0', rank: 0, status: 'leader' },
          { name: 'pve-node-02', host: 'pve-node-02', addr: '10.10.10.2:6789/0', rank: 1, status: 'peon' },
          { name: 'pve-node-03', host: 'pve-node-03', addr: '10.10.10.3:6789/0', rank: 2, status: 'peon' },
        ],
      },
    },
  },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph-vms': { data: [] },
  'GET:/api/v1/connections/demo-pve-dr-001/ha': {
    data: { groups: [], resources: [], rules: [], majorVersion: 8 },
  },

  // --- Firewall ---
  'GET:/api/v1/firewall/cluster/demo-pve-cluster-001': {
    enable: 1,
    policy_in: 'DROP',
    policy_out: 'ACCEPT',
    connectionId: 'demo-pve-cluster-001',
    connectionName: 'Production Cluster',
  },
  'GET:/api/v1/firewall/groups/demo-pve-cluster-001': [
    { group: 'web-servers' },
    { group: 'db-servers' },
    { group: 'monitoring' },
    { group: 'management' },
    { group: 'dmz' },
  ],

  // --- HA ---
  'GET:/api/v1/connections/demo-pve-cluster-001/ha': {
    data: { groups: [], resources: [], rules: [], majorVersion: 8 },
  },

  // --- VMs networks (POST) ---
  'POST:/api/v1/vms/networks': {
    data: {
      'vmbr0': { name: 'vmbr0', type: 'bridge', vms: 171, nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03', 'pve-node-04', 'pve-node-05', 'pve-node-06'] },
      'vmbr1': { name: 'vmbr1', type: 'bridge', vms: 45, nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03'] },
    },
  },
}

// ---------------------------------------------------------------------------
// URL matching helpers
// ---------------------------------------------------------------------------

/** Strip query string from a URL path */
function stripQuery(urlPath: string): string {
  const idx = urlPath.indexOf('?')
  return idx === -1 ? urlPath : urlPath.substring(0, idx)
}

/** Replace any connection ID segment with the demo connection ID */
const CONNECTION_ID_RE = /\/connections\/([^/]+)/
function normaliseConnectionId(urlPath: string): string {
  return urlPath.replace(CONNECTION_ID_RE, `/connections/${DEMO_CONNECTION_ID}`)
}

/** Known demo PBS IDs */
const DEMO_PBS_IDS = ['demo-pbs-001', 'demo-pbs-002']

/** Replace any PBS ID segment with the first matching demo PBS ID */
const PBS_ID_RE = /\/pbs\/([^/]+)/
function normalisePbsId(urlPath: string): string {
  const match = urlPath.match(PBS_ID_RE)
  if (!match) return urlPath
  const requestedId = decodeURIComponent(match[1])
  // If the ID is already a known demo PBS ID, keep it
  if (DEMO_PBS_IDS.includes(requestedId)) return urlPath
  // Otherwise, map to the first demo PBS ID
  return urlPath.replace(PBS_ID_RE, `/pbs/${DEMO_PBS_IDS[0]}`)
}

/** Replace any node name segment with the first demo node name */
const NODE_NAME_RE = /\/nodes\/([^/]+)/
function normaliseNodeName(urlPath: string): string {
  return urlPath.replace(NODE_NAME_RE, `/nodes/${DEMO_NODE_NAME}`)
}

// ---------------------------------------------------------------------------
// Lookup logic
// ---------------------------------------------------------------------------

/**
 * Try to find a mock response for the given method + path combination.
 *
 * Matching strategy (in order):
 *  1. Method-specific exact match in EXTRA_MOCKS  (e.g. "GET:/api/v1/auth/session")
 *  2. Exact path match in MOCK_DATA               (GET only, since JSON has no method prefix)
 *  3. Replace connection ID → retry 1 & 2
 *  4. Replace node name → retry 1 & 2
 *  5. Prefix match for /monitoring/* wildcard
 *  6. Fallback: unmatched GET → { data: [] }
 *  7. Otherwise null
 */
function lookupMock(method: string, urlPath: string): any | null {
  const cleanPath = stripQuery(urlPath)
  const methodKey = `${method}:${cleanPath}`

  // --- 1. Exact match (method-prefixed) in EXTRA_MOCKS ---
  if (EXTRA_MOCKS[methodKey] !== undefined) return EXTRA_MOCKS[methodKey]

  // --- 2. Exact match in MOCK_DATA (GET only — JSON keys have no method prefix) ---
  if (method === 'GET' && MOCK_DATA[cleanPath] !== undefined) return MOCK_DATA[cleanPath]

  // --- 3. Normalise connection ID and retry ---
  const withDemoConn = normaliseConnectionId(cleanPath)
  if (withDemoConn !== cleanPath) {
    const connMethodKey = `${method}:${withDemoConn}`
    if (EXTRA_MOCKS[connMethodKey] !== undefined) return EXTRA_MOCKS[connMethodKey]
    if (method === 'GET' && MOCK_DATA[withDemoConn] !== undefined) return MOCK_DATA[withDemoConn]
  }

  // --- 4. Normalise node name and retry ---
  const withDemoNode = normaliseNodeName(withDemoConn)
  if (withDemoNode !== withDemoConn) {
    const nodeMethodKey = `${method}:${withDemoNode}`
    if (EXTRA_MOCKS[nodeMethodKey] !== undefined) return EXTRA_MOCKS[nodeMethodKey]
    if (method === 'GET' && MOCK_DATA[withDemoNode] !== undefined) return MOCK_DATA[withDemoNode]
  }

  // --- 4b. Normalise PBS ID and retry ---
  if (cleanPath.includes('/pbs/')) {
    const withDemoPbs = normalisePbsId(cleanPath)
    if (withDemoPbs !== cleanPath) {
      const pbsMethodKey = `${method}:${withDemoPbs}`
      if (EXTRA_MOCKS[pbsMethodKey] !== undefined) return EXTRA_MOCKS[pbsMethodKey]
      if (method === 'GET' && MOCK_DATA[withDemoPbs] !== undefined) return MOCK_DATA[withDemoPbs]
    }
  }

  // --- 5. Wildcard: /api/v1/monitoring/* ---
  if (method === 'GET' && cleanPath.startsWith('/api/v1/monitoring')) {
    return { data: {} }
  }

  // --- 6. Safe fallback for any unmatched GET ---
  if (method === 'GET' && cleanPath.startsWith('/api/v1/')) {
    return { data: [] }
  }

  return null
}

// ---------------------------------------------------------------------------
// SSE stream builder for /api/v1/inventory/stream
// ---------------------------------------------------------------------------

function buildInventorySSE(): Response {
  const connections = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
  const pveConns = connections.filter((c: any) => c.type === 'pve')
  const pbsConns = connections.filter((c: any) => c.type === 'pbs')
  const extConns = connections.filter((c: any) => c.type === 'vmware' || c.type === 'xcpng')

  // Build cluster data from mock nodes + resources
  const nodesData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/nodes'] as any)?.data || []
  const resources = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/resources'] as any)?.data || []
  const storageData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/storage'] as any)?.data || []
  const cephStatus = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/ceph/status'] as any)?.data

  // Build nodes with their guests
  const nodesWithGuests = nodesData.map((n: any) => {
    const nodeGuests = resources.filter((r: any) => r.node === n.node)
    return {
      node: n.node,
      status: n.status || 'online',
      cpu: n.cpu,
      mem: n.mem,
      maxmem: n.maxmem,
      disk: n.disk,
      maxdisk: n.maxdisk,
      uptime: n.uptime,
      maxcpu: n.maxcpu,
      ip: n.ip,
      hastate: n.hastate || 'online',
      guests: nodeGuests.map((g: any) => ({
        vmid: g.vmid,
        name: g.name,
        type: g.type || 'qemu',
        status: g.status,
        node: g.node,
        cpu: g.cpu,
        mem: g.mem,
        maxmem: g.maxmem,
        disk: g.disk,
        maxdisk: g.maxdisk,
        uptime: g.uptime,
        tags: Array.isArray(g.tags) ? g.tags.join(';') : (g.tags || ''),
        template: g.template,
        hastate: g.hastate,
      })),
    }
  })

  // Ceph health
  let cephHealth: string | undefined
  if (cephStatus?.health?.status) {
    cephHealth = cephStatus.health.status
  }

  const mainConn = pveConns.find((c: any) => c.id === 'demo-pve-cluster-001') || pveConns[0]

  const clusterEvent = {
    id: mainConn?.id || 'demo-pve-cluster-001',
    name: mainConn?.name || 'Production Cluster',
    type: 'pve',
    isCluster: true,
    status: 'online',
    cephHealth,
    latitude: mainConn?.latitude || null,
    longitude: mainConn?.longitude || null,
    locationLabel: mainConn?.locationLabel || null,
    sshEnabled: mainConn?.sshEnabled || false,
    nodes: nodesWithGuests,
  }

  // Build storage data per cluster
  const sharedStorages = storageData.filter((s: any, i: number, arr: any[]) =>
    s.shared && arr.findIndex((x: any) => x.storage === s.storage) === i
  )
  const storageEvent = {
    connId: mainConn?.id || 'demo-pve-cluster-001',
    connName: mainConn?.name || 'Production Cluster',
    isCluster: true,
    nodes: nodesData.map((n: any) => ({
      node: n.node,
      status: n.status || 'online',
      storages: storageData.filter((s: any) => s.node === n.node).map((s: any) => ({
        storage: s.storage,
        node: s.node,
        type: s.type,
        shared: s.shared ? 1 : 0,
        content: s.content,
        used: s.used || 0,
        total: s.maxdisk || s.total || 0,
        usedPct: s.maxdisk ? Math.round((s.used / s.maxdisk) * 100) : 0,
        status: s.status || 'available',
        enabled: s.enabled !== false,
      })),
    })),
    sharedStorages: sharedStorages.map((s: any) => ({
      storage: s.storage,
      node: s.node,
      type: s.type,
      shared: 1,
      content: s.content,
      used: s.used || 0,
      total: s.maxdisk || s.total || 0,
      usedPct: s.maxdisk ? Math.round((s.used / s.maxdisk) * 100) : 0,
      status: s.status || 'available',
      enabled: s.enabled !== false,
    })),
  }

  // Build PBS mock data
  const pbsEvents = pbsConns.map((pbs: any) => ({
    id: pbs.id,
    name: pbs.name,
    type: 'pbs',
    status: 'online',
    version: '3.2-1',
    uptime: 864000,
    datastores: [
      {
        name: 'backup-main',
        total: 10995116277760,
        used: 5497558138880,
        available: 5497558138880,
        usagePercent: 50,
        backupCount: 342,
        vmCount: 45,
        ctCount: 12,
        hostCount: 3,
      },
    ],
    stats: {
      totalSize: 10995116277760,
      totalUsed: 5497558138880,
      datastoreCount: 1,
      backupCount: 342,
    },
  }))

  // Build external hypervisors
  const externalEvent = extConns.map((ext: any) => ({
    id: ext.id,
    name: ext.name,
    type: ext.type,
    status: 'online',
    baseUrl: ext.baseUrl,
  }))

  // Build SSE body
  const events: string[] = []
  const sse = (event: string, data: any) =>
    events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  sse('init', {
    totalPve: pveConns.length,
    totalPbs: pbsConns.length,
    totalExt: extConns.length,
  })

  sse('cluster', clusterEvent)

  for (const pbs of pbsEvents) {
    sse('pbs', pbs)
  }

  if (externalEvent.length > 0) {
    sse('external', externalEvent)
  }

  sse('storage', storageEvent)

  sse('done', { stats: { clusters: pveConns.length, pbs: pbsConns.length, external: extConns.length } })

  const body = events.join('')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'x-demo-mode': 'true',
    },
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Intercept an incoming request and return a mock NextResponse if demo mode
 * is active. Returns `null` if demo mode is off or if the request is not an
 * API route.
 *
 * Designed to be called from Next.js middleware:
 *
 * ```ts
 * const demo = demoResponse(req)
 * if (demo) return demo
 * ```
 */
export function demoResponse(req: Request): NextResponse | Response | null {
  // 1. Check demo mode
  if (process.env.DEMO_MODE !== 'true') return null

  // 2. Extract URL path
  let pathname: string
  try {
    pathname = new URL(req.url).pathname
  } catch {
    return null
  }

  // Only intercept /api/v1/* routes
  if (!pathname.startsWith('/api/v1/')) return null

  const method = req.method?.toUpperCase() || 'GET'

  const demoHeaders = { 'x-demo-mode': 'true' }
  const urlObj = new URL(req.url)
  const cleanPath = stripQuery(pathname)

  // 3. For any mutating request (POST/PUT/PATCH/DELETE), return a generic
  //    "action disabled" response — UNLESS we have a specific mock for it
  //    (e.g. POST /api/v1/auth/callback/credentials)
  if (method !== 'GET') {
    // --- POST: node/guest trends ---
    if (method === 'POST' && cleanPath.match(/\/api\/v1\/connections\/[^/]+\/(nodes|guests)\/trends/)) {
      // Widget expects { data: { "node-name": [{ t: "HH:MM", cpu, ram }, ...] } }
      const nodesData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/nodes'] as any)?.data || []
      const nodeNames = nodesData.map((n: any) => n.node)
      const result: Record<string, any[]> = {}

      // Generate distinct realistic patterns per node
      const nodeProfiles = [
        { cpu: 0.08, mem: 0.72, spike: 0.4 },  // busy web server
        { cpu: 0.03, mem: 0.85, spike: 0.1 },  // memory-heavy DB
        { cpu: 0.15, mem: 0.55, spike: 0.6 },  // compute bursts
        { cpu: 0.05, mem: 0.60, spike: 0.2 },  // light workload
        { cpu: 0.12, mem: 0.78, spike: 0.3 },  // medium load
        { cpu: 0.02, mem: 0.45, spike: 0.15 }, // idle standby
        { cpu: 0.20, mem: 0.68, spike: 0.5 },  // CI runner
        { cpu: 0.07, mem: 0.90, spike: 0.1 },  // near-full RAM
        { cpu: 0.04, mem: 0.50, spike: 0.25 }, // balanced
        { cpu: 0.10, mem: 0.62, spike: 0.35 }, // moderate
        { cpu: 0.06, mem: 0.75, spike: 0.2 },  // storage node
        { cpu: 0.18, mem: 0.58, spike: 0.45 }, // batch processing
      ]

      const now = Math.floor(Date.now() / 1000)

      for (let idx = 0; idx < nodeNames.length; idx++) {
        const nodeName = nodeNames[idx]
        const profile = nodeProfiles[idx % nodeProfiles.length]
        const phase = idx * 1.7 // phase offset per node
        const points = 70
        const interval = 1200

        result[`node:${nodeName}`] = Array.from({ length: points }, (_, i) => {
          const time = now - (points - 1 - i) * interval
          const d = new Date(time * 1000)
          const hour = d.getHours()

          // Day/night cycle: extreme contrast
          const dayFactor = hour >= 9 && hour <= 17
            ? 1.0 + 0.2 * Math.sin((hour - 9) / 8 * Math.PI) // peak: full load
            : hour === 8
              ? 0.6 // morning wake-up
              : hour === 18
                ? 0.7 // just after work
                : hour >= 19 && hour <= 22
                  ? 0.15 - 0.05 * ((hour - 19) / 3) // evening drop
                  : 0.02 + 0.02 * Math.random() // night: almost zero

          const t2 = i / points
          const microWave = Math.sin(t2 * Math.PI * 8 + phase * 2) * 0.08
          const noise = (Math.random() - 0.5) * 0.02
          const cpuVal = Math.max(0.5, Math.min(95, (profile.cpu * 100) * dayFactor + microWave * 15 + noise * 10))
          const ramVal = Math.max(10, Math.min(98, profile.mem * 100 * (0.85 + dayFactor * 0.15) + microWave * 5 + (Math.random() - 0.5) * 2))

          return {
            ts: time,
            t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            cpu: Math.round(cpuVal * 10) / 10,
            ram: Math.round(ramVal * 10) / 10,
          }
        })
      }

      return NextResponse.json({ data: result }, { headers: demoHeaders })
    }

    const specificMock = lookupMock(method, pathname)
    if (specificMock !== null) {
      return NextResponse.json(specificMock, { headers: demoHeaders })
    }

    return NextResponse.json(
      { success: true, demo: true, message: 'Action disabled in demo mode' },
      { headers: demoHeaders }
    )
  }

  // 4. SSE stream for inventory
  if (cleanPath === '/api/v1/inventory/stream') {
    return buildInventorySSE()
  }

  // --- sFlow mock data ---
  if (cleanPath === '/api/v1/orchestrator/sflow') {
    const endpoint = urlObj.searchParams.get('endpoint') || 'status'
    const now = Math.floor(Date.now() / 1000)
    const demoNodes = ['pve-node-01', 'pve-node-02', 'pve-node-03']
    const demoIPs = ['10.10.10.1', '10.10.10.2', '10.10.10.3', '10.10.10.10', '10.10.10.20', '10.10.10.30', '192.168.1.100', '192.168.1.200']

    if (endpoint === 'status') {
      return NextResponse.json({
        enabled: true, listen_address: '0.0.0.0:6343',
        agents: demoNodes.map((node, i) => ({
          agent_ip: `10.10.10.${i + 1}`, node, last_seen: new Date().toISOString(),
          flow_rate: 50 + Math.random() * 200, sample_count: 10000 + Math.floor(Math.random() * 50000), active: true,
        })),
        total_flows: 150000, flow_rate: 180 + Math.random() * 100, active_vms: 12, uptime_seconds: 345600,
      }, { headers: demoHeaders })
    }

    if (endpoint === 'top-talkers') {
      const vms = [
        { vmid: 100, vm_name: 'web-prod-01', node: 'pve-node-01' },
        { vmid: 101, vm_name: 'api-gateway', node: 'pve-node-01' },
        { vmid: 200, vm_name: 'db-primary', node: 'pve-node-02' },
        { vmid: 201, vm_name: 'db-replica', node: 'pve-node-02' },
        { vmid: 300, vm_name: 'monitoring', node: 'pve-node-03' },
        { vmid: 301, vm_name: 'backup-srv', node: 'pve-node-03' },
        { vmid: 102, vm_name: 'web-prod-02', node: 'pve-node-01' },
        { vmid: 302, vm_name: 'ci-runner', node: 'pve-node-03' },
      ]
      return NextResponse.json(vms.map(vm => ({
        ...vm, bytes_in: Math.floor(Math.random() * 5e9 + 1e8), bytes_out: Math.floor(Math.random() * 1e9 + 1e7), packets: Math.floor(Math.random() * 1e6),
      })), { headers: demoHeaders })
    }

    if (endpoint === 'top-ports') {
      const portList = [
        { port: 443, protocol: 'TCP', service: 'HTTPS' },
        { port: 80, protocol: 'TCP', service: 'HTTP' },
        { port: 22, protocol: 'TCP', service: 'SSH' },
        { port: 5432, protocol: 'TCP', service: 'PostgreSQL' },
        { port: 8006, protocol: 'TCP', service: 'PVE API' },
        { port: 53, protocol: 'UDP', service: 'DNS' },
        { port: 3306, protocol: 'TCP', service: 'MySQL' },
        { port: 9090, protocol: 'TCP', service: 'Prometheus' },
      ]
      const total = portList.length
      return NextResponse.json(portList.map((p, i) => {
        const bytes = Math.floor((total - i) * 1e9 * Math.random() + 5e7)
        return { ...p, bytes, packets: Math.floor(bytes / 1000), percent: (total - i) * 10 + Math.random() * 5 }
      }), { headers: demoHeaders })
    }

    if (endpoint === 'ip-pairs') {
      // Deterministic pairs with one dominant flow (web-prod-01 → db-primary via PostgreSQL)
      const pairs = [
        // Dominant flow: web server hammering database
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.20', bytes: 18_500_000_000, packets: 12_000_000, protocol: 'TCP', dst_port: 5432 },
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.30', bytes: 8_200_000_000, packets: 5_500_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.10', dst_ip: '192.168.1.100', bytes: 4_100_000_000, packets: 2_800_000, protocol: 'TCP', dst_port: 443 },
        // Secondary flows
        { src_ip: '10.10.10.20', dst_ip: '10.10.10.30', bytes: 2_500_000_000, packets: 1_600_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.3', dst_ip: '10.10.10.10', bytes: 1_800_000_000, packets: 1_200_000, protocol: 'TCP', dst_port: 8006 },
        { src_ip: '192.168.1.100', dst_ip: '10.10.10.10', bytes: 1_500_000_000, packets: 980_000, protocol: 'TCP', dst_port: 80 },
        { src_ip: '10.10.10.2', dst_ip: '10.10.10.20', bytes: 1_200_000_000, packets: 750_000, protocol: 'TCP', dst_port: 5432 },
        { src_ip: '10.10.10.30', dst_ip: '10.10.10.1', bytes: 950_000_000, packets: 620_000, protocol: 'TCP', dst_port: 22 },
        { src_ip: '192.168.1.200', dst_ip: '10.10.10.10', bytes: 800_000_000, packets: 520_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.1', dst_ip: '10.10.10.2', bytes: 650_000_000, packets: 430_000, protocol: 'UDP', dst_port: 53 },
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.1', bytes: 500_000_000, packets: 320_000, protocol: 'TCP', dst_port: 9090 },
        { src_ip: '10.10.10.3', dst_ip: '10.10.10.20', bytes: 380_000_000, packets: 250_000, protocol: 'TCP', dst_port: 3306 },
        { src_ip: '10.10.10.2', dst_ip: '10.10.10.3', bytes: 280_000_000, packets: 180_000, protocol: 'TCP', dst_port: 22 },
        { src_ip: '192.168.1.100', dst_ip: '10.10.10.30', bytes: 220_000_000, packets: 140_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.20', dst_ip: '10.10.10.1', bytes: 180_000_000, packets: 115_000, protocol: 'UDP', dst_port: 53 },
      ]
      return NextResponse.json(pairs, { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/vm') {
      const points = Array.from({ length: 60 }, (_, i) => ({
        time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 5e7 + 1e6), bytes_out: Math.floor(Math.random() * 1e7 + 5e5), packets: Math.floor(Math.random() * 50000),
      }))
      return NextResponse.json(points, { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/all-vms') {
      return NextResponse.json([
        { vmid: 100, vm_name: 'web-prod-01', points: Array.from({ length: 60 }, (_, i) => ({ time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 3e7), bytes_out: Math.floor(Math.random() * 5e6) })) },
        { vmid: 200, vm_name: 'db-primary', points: Array.from({ length: 60 }, (_, i) => ({ time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 8e7), bytes_out: Math.floor(Math.random() * 2e7) })) },
      ], { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/ip') {
      const points = Array.from({ length: 60 }, (_, i) => ({
        time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 2e7 + 5e5),
      }))
      return NextResponse.json(points, { headers: demoHeaders })
    }

    if (endpoint === 'agents') {
      return NextResponse.json(demoNodes.map((node, i) => ({
        agent_ip: `10.10.10.${i + 1}`, node, last_seen: new Date().toISOString(),
        flow_rate: 50 + Math.random() * 200, sample_count: 10000 + Math.floor(Math.random() * 50000), active: true,
      })), { headers: demoHeaders })
    }

    // Default: empty array
    return NextResponse.json([], { headers: demoHeaders })
  }

  // sFlow agents (SSH-based)
  if (cleanPath === '/api/v1/orchestrator/sflow/agents') {
    return NextResponse.json({
      data: [
        { node: 'pve-node-01', ip: '10.10.10.1', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
        { node: 'pve-node-02', ip: '10.10.10.2', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
        { node: 'pve-node-03', ip: '10.10.10.3', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
      ],
    }, { headers: demoHeaders })
  }

  // --- Dashboard layout list ---
  if (cleanPath === '/api/v1/dashboard/layout' && urlObj.searchParams.get('list') === 'true') {
    return NextResponse.json({ data: [
      { id: 'demo-layout', name: 'Default', isActive: true, updatedAt: new Date().toISOString() },
    ] }, { headers: demoHeaders })
  }

  // --- PBS backups/trends ---
  if (cleanPath.match(/\/api\/v1\/pbs\/[^/]+\/backups\/trends/)) {
    const days = Number(urlObj.searchParams.get('days') || 30)
    const now = new Date()
    const data = Array.from({ length: days }, (_, i) => {
      const date = new Date(now.getTime() - (days - 1 - i) * 86400000)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6
      const baseCount = isWeekend ? 2 + Math.floor(Math.random() * 3) : 8 + Math.floor(Math.random() * 6)
      const errors = Math.random() < 0.08 ? 1 : 0
      return {
        date: date.toISOString().split('T')[0],
        count: baseCount,
        ok: baseCount - errors,
        error: errors,
        verified: Math.random() < 0.7 ? baseCount - errors : 0,
      }
    })

    return NextResponse.json({ data }, { headers: demoHeaders })
  }

  // --- Dynamic RRD endpoints ---
  if (cleanPath.match(/\/api\/v1\/connections\/[^/]+\/rrd/) || cleanPath.match(/\/api\/v1\/connections\/[^/]+\/ceph\/rrd/)) {
    const timeframe = urlObj.searchParams.get('timeframe') || 'hour'
    if (cleanPath.includes('/ceph/rrd')) {
      const pts = generateRrdData(timeframe)
      return NextResponse.json({
        data: {
          iops_read: pts.map(p => ({ time: p.time, value: Math.floor(Math.random() * 5000 + 1000) })),
          iops_write: pts.map(p => ({ time: p.time, value: Math.floor(Math.random() * 3000 + 500) })),
          bandwidth_read: pts.map(p => ({ time: p.time, value: Math.floor(p.diskread * 2) })),
          bandwidth_write: pts.map(p => ({ time: p.time, value: Math.floor(p.diskwrite * 2) })),
        },
      }, { headers: demoHeaders })
    }
    return NextResponse.json({ data: generateRrdData(timeframe) }, { headers: demoHeaders })
  }

  // --- Connection filtering by type ---
  if (cleanPath === '/api/v1/connections') {
    const typeFilter = urlObj.searchParams.get('type')
    const allConns = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
    if (typeFilter) {
      return NextResponse.json({ data: allConns.filter((c: any) => c.type === typeFilter) }, { headers: demoHeaders })
    }
  }

  // 5. GET request — look up mock data
  const data = lookupMock(method, pathname)

  if (data !== null) {
    return NextResponse.json(data, { headers: demoHeaders })
  }

  // Should not reach here (lookupMock returns { data: [] } for unmatched GETs)
  // but just in case:
  return NextResponse.json({ data: [] }, { headers: demoHeaders })
}
