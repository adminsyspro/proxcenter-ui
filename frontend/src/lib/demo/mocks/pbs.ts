/**
 * Demo mocks for the PBS tabs of /infrastructure/inventory (tabs/pbs/*).
 * Keys exist for both demo PBS servers: demo-pbs-001 (PBS Master, also serves
 * unknown ids through lookupMock) and demo-pbs-002 (PBS Replica).
 */

import { applyRrdWindow, presetRangeMeta, resolveRrdRequest, type RrdTimeframe } from '@/lib/metrics/rrdRange'

import MOCK_DATA from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'

const DAY = 86400

type PbsId = 'demo-pbs-001' | 'demo-pbs-002'

const PBS_IDS: PbsId[] = ['demo-pbs-001', 'demo-pbs-002']

const PBS_FACTS: Record<PbsId, { host: string; baseUrl: string; datastore: string; ip: string; key: string }> = {
  'demo-pbs-001': { host: 'pbs-master', baseUrl: 'https://10.10.10.50:8007', datastore: 'backup-main', ip: '10.10.10.50', key: 'pbsc-demo-0001' },
  'demo-pbs-002': { host: 'pbs-replica', baseUrl: 'https://10.10.10.51:8007', datastore: 'backup-replica', ip: '10.10.10.51', key: 'pbsc-demo-0002' },
}

// Fixed reference instant (2026-10-01 00:00 UTC) so dates stay stable between polls.
const REF = 1790812800

/** Builds `GET:/api/v1/pbs/<id><suffix>` for both servers. */
function perPbs(suffix: string, build: (id: PbsId) => any): DemoMockMap {
  const out: DemoMockMap = {}

  for (const id of PBS_IDS) out[`GET:/api/v1/pbs/${id}${suffix}`] = build(id)

  return out
}

// --- Access control (PbsAccessControlTab) ---

const accessUsers = (id: PbsId) => [
  { userid: 'root@pam', enable: true, expire: 0, firstname: 'Super', lastname: 'User', email: 'root@demo.local', comment: 'Superuser', tokens: [] },
  {
    userid: 'proxcenter@pbs', enable: true, expire: 0, comment: 'ProxCenter integration',
    tokens: [{ tokenid: 'proxcenter', expire: 0, comment: 'Read and backup access for ProxCenter' }],
  },
  {
    userid: 'pve-sync@pbs', enable: true, expire: 0, comment: 'PVE clusters backup user',
    tokens: [
      { tokenid: 'prod-cluster', expire: 0, comment: 'demo-pve-cluster-001' },
      { tokenid: 'dr-cluster', expire: REF + 365 * DAY, comment: 'demo-pve-dr-001' },
    ],
  },
  ...(id === 'demo-pbs-002'
    ? [{ userid: 'sync-pull@pbs', enable: true, expire: 0, comment: 'Pulls from pbs-master', tokens: [] }]
    : [
        { userid: 'auditor@pbs', enable: true, expire: REF + 90 * DAY, firstname: 'Claire', lastname: 'Martin', email: 'claire.martin@demo.local', comment: 'Quarterly audit', tokens: [] },
        { userid: 'old-admin@pbs', enable: false, expire: 0, firstname: 'Paul', lastname: 'Durand', comment: 'Left the company', tokens: [] },
      ]),
]

const ACCESS_ROLES = [
  { roleid: 'Admin', special: true, privs: ['Datastore.Allocate', 'Datastore.Audit', 'Datastore.Backup', 'Datastore.Modify', 'Datastore.Prune', 'Datastore.Read', 'Datastore.Verify', 'Permissions.Modify', 'Sys.Audit', 'Sys.Console', 'Sys.Modify', 'Sys.PowerManagement', 'Remote.Audit', 'Remote.Modify', 'Remote.Read', 'Tape.Audit', 'Tape.Modify', 'Tape.Read', 'Tape.Write'] },
  { roleid: 'Audit', special: true, privs: ['Datastore.Audit', 'Remote.Audit', 'Sys.Audit', 'Tape.Audit'] },
  { roleid: 'DatastoreAdmin', special: true, privs: ['Datastore.Allocate', 'Datastore.Audit', 'Datastore.Backup', 'Datastore.Modify', 'Datastore.Prune', 'Datastore.Read', 'Datastore.Verify'] },
  { roleid: 'DatastoreAudit', special: true, privs: ['Datastore.Audit'] },
  { roleid: 'DatastoreBackup', special: true, privs: ['Datastore.Backup'] },
  { roleid: 'DatastorePowerUser', special: true, privs: ['Datastore.Backup', 'Datastore.Prune'] },
  { roleid: 'DatastoreReader', special: true, privs: ['Datastore.Audit', 'Datastore.Read'] },
  { roleid: 'NoAccess', special: true, privs: [] },
  { roleid: 'RemoteAdmin', special: true, privs: ['Remote.Audit', 'Remote.Modify', 'Remote.Read'] },
  { roleid: 'RemoteSyncOperator', special: true, privs: ['Remote.Audit', 'Remote.Read'] },
  { roleid: 'TapeAdmin', special: true, privs: ['Tape.Audit', 'Tape.Modify', 'Tape.Read', 'Tape.Write'] },
  { roleid: 'TapeReader', special: true, privs: ['Tape.Audit', 'Tape.Read'] },
]

const accessAcl = (id: PbsId) => {
  const store = PBS_FACTS[id].datastore

  return [
    { path: '/', ugid: 'proxcenter@pbs!proxcenter', ugid_type: 'token', roleid: 'Audit', propagate: true },
    { path: `/datastore/${store}`, ugid: 'proxcenter@pbs!proxcenter', ugid_type: 'token', roleid: 'DatastoreReader', propagate: true },
    { path: `/datastore/${store}`, ugid: 'pve-sync@pbs!prod-cluster', ugid_type: 'token', roleid: 'DatastoreBackup', propagate: true },
    { path: `/datastore/${store}`, ugid: 'pve-sync@pbs!dr-cluster', ugid_type: 'token', roleid: 'DatastoreBackup', propagate: true },
    ...(id === 'demo-pbs-002'
      ? [{ path: '/remote/pbs-master', ugid: 'sync-pull@pbs', ugid_type: 'user', roleid: 'RemoteSyncOperator', propagate: true }]
      : [{ path: '/', ugid: 'auditor@pbs', ugid_type: 'user', roleid: 'Audit', propagate: false }]),
  ]
}

// --- Certificates (PbsCertificatesTab), notafter in unix seconds ---

const certificates = (id: PbsId) => {
  const { host, ip } = PBS_FACTS[id]
  const seed = id === 'demo-pbs-001' ? 0 : 1

  return [
    {
      filename: 'proxy.pem',
      subject: `CN=${host}.demo.local`,
      issuer: "C=US, O=Let's Encrypt, CN=R11",
      notbefore: REF - (40 + seed * 20) * DAY,
      notafter: REF + (50 - seed * 20) * DAY,
      public_key_type: 'rsaEncryption',
      public_key_bits: 2048,
      san: [`${host}.demo.local`, ip],
      fingerprint: seed ? '7C:1E:93:AB:04:D2:5F:68:B1:3A:9C:E0:47:12:6D:F5:88:2B:C4:90:13:7E:A6:5D:F2:01:3C:B9:44:E8:6A:D7' : 'A3:5F:0C:91:7B:E2:44:D8:16:9A:C3:2E:70:B5:8F:1D:E6:42:09:CB:7A:53:F1:28:9E:0D:64:BA:31:C7:85:FE',
    },
  ]
}

// --- Disks (PbsDisksTab) ---

const TB = 1000 ** 4

const disks = (id: PbsId) => id === 'demo-pbs-001'
  ? [
      { name: 'nvme0n1', devpath: '/dev/nvme0n1', type: 'nvme', size: 512110190592, model: 'Samsung SSD 980 PRO 512GB', serial: 'S5GXNX0T418231K', vendor: 'Samsung', health: 'PASSED', wearout: 4, used: 'partitions', rpm: 0 },
      { name: 'sda', devpath: '/dev/sda', type: 'hdd', size: 4 * TB, model: 'ST4000NM0035-1V4107', serial: 'ZC14A2B7', vendor: 'Seagate', health: 'PASSED', used: 'zfs', rpm: 7200 },
      { name: 'sdb', devpath: '/dev/sdb', type: 'hdd', size: 4 * TB, model: 'ST4000NM0035-1V4107', serial: 'ZC14A3F1', vendor: 'Seagate', health: 'PASSED', used: 'zfs', rpm: 7200 },
      { name: 'sdc', devpath: '/dev/sdc', type: 'hdd', size: 4 * TB, model: 'ST4000NM0035-1V4107', serial: 'ZC14A9C4', vendor: 'Seagate', health: 'PASSED', used: 'zfs', rpm: 7200 },
      { name: 'sdd', devpath: '/dev/sdd', type: 'hdd', size: 4 * TB, model: 'ST4000NM0035-1V4107', serial: 'ZC14B0D8', vendor: 'Seagate', health: 'PASSED', used: 'zfs', rpm: 7200 },
      { name: 'sde', devpath: '/dev/sde', type: 'ssd', size: 480103981056, model: 'INTEL SSDSC2KB480G8', serial: 'PHYF8124013K480BGN', vendor: 'Intel', health: 'PASSED', wearout: 11, used: 'zfs', rpm: 0 },
      { name: 'sdf', devpath: '/dev/sdf', type: 'hdd', size: 4 * TB, model: 'ST4000NM0035-1V4107', serial: 'ZC14B7E2', vendor: 'Seagate', health: 'UNKNOWN', used: 'unused', rpm: 7200 },
    ]
  : [
      { name: 'sda', devpath: '/dev/sda', type: 'ssd', size: 240057409536, model: 'KINGSTON SEDC500M240G', serial: '50026B7784A1C2D3', vendor: 'Kingston', health: 'PASSED', wearout: 7, used: 'partitions', rpm: 0 },
      { name: 'sdb', devpath: '/dev/sdb', type: 'hdd', size: 6 * TB, model: 'WDC WD6003FFBX-68MU3N0', serial: 'V9H1K2LM', vendor: 'WDC', health: 'PASSED', used: 'filesystem', rpm: 7200 },
      { name: 'sdc', devpath: '/dev/sdc', type: 'hdd', size: 6 * TB, model: 'WDC WD6003FFBX-68MU3N0', serial: 'V9H1K8QR', vendor: 'WDC', health: 'PASSED', used: 'filesystem', rpm: 7200 },
    ]

const directories = (id: PbsId) => id === 'demo-pbs-001'
  ? []
  : [{ name: 'backup-replica', device: '/dev/md0', filesystem: 'xfs', path: '/mnt/datastore/backup-replica', unitfile: 'mnt-datastore-backup\\x2dreplica.mount' }]

const zfsPools = (id: PbsId) => id === 'demo-pbs-001'
  ? [{ name: 'backup-main', size: 15994458210304, alloc: 5497558138880, free: 10496900071424, dedup: 1, frag: 6, health: 'ONLINE' }]
  : []

const notes = (id: PbsId) => ({
  notes: id === 'demo-pbs-001'
    ? '# PBS Master\n\nPrimary backup target for the production cluster (demo-pve-cluster-001).\n\n- Datastore `backup-main` on ZFS raidz1 (4 x 4 TB) with SSD special device\n- Verify job weekly, GC daily at 04:00\n- Synced nightly to **PBS Replica**\n\nContact: infra-team@demo.local'
    : '# PBS Replica\n\nOff-site copy of `backup-main`, pulled nightly from pbs-master.\n\n- Datastore `backup-replica` on XFS (mdraid1)\n- Keeps 30 daily, 8 weekly, 12 monthly',
})

// --- Notifications (PbsNotificationsTab) ---

const NOTIF_ENDPOINTS = [
  { name: 'mail-to-root', type: 'sendmail', mailto: ['root@pam'], comment: 'Send mails to root@pam\'s email address', origin: 'builtin' },
  { name: 'smtp-infra', type: 'smtp', server: 'smtp.demo.local', port: 587, mode: 'starttls', 'from-address': 'pbs@demo.local', mailto: ['infra-team@demo.local'], comment: 'Infra team mailbox', origin: 'user-created' },
  { name: 'gotify-ops', type: 'gotify', server: 'https://gotify.demo.local', comment: 'On-call push notifications', origin: 'user-created' },
  { name: 'webhook-chatops', type: 'webhook', url: 'https://chat.demo.local/hooks/pbs', comment: 'Ops channel', disable: true, origin: 'user-created' },
]

const NOTIF_TARGETS = NOTIF_ENDPOINTS.map(({ name, type, comment, disable, origin }) => ({ name, type, comment, disable, origin }))

const NOTIF_MATCHERS = [
  { name: 'default-matcher', mode: 'all', target: ['mail-to-root'], comment: 'Route all notifications to mail-to-root', origin: 'builtin' },
  { name: 'errors-to-ops', mode: 'any', 'match-severity': ['error', 'warning'], target: ['smtp-infra', 'gotify-ops'], comment: 'Failed jobs page the on-call team', origin: 'user-created' },
  { name: 'nightly-sync', mode: 'all', 'match-field': ['exact:type=sync'], 'match-calendar': ['mon..fri 01:00-06:00'], target: ['webhook-chatops'], comment: 'Sync job reports', disable: true, origin: 'user-created' },
]

// --- Remotes (PbsRemotesTab) ---

const remotes = (id: PbsId) => id === 'demo-pbs-002'
  ? [{ name: 'pbs-master', host: '10.10.10.50', port: 8007, 'auth-id': 'sync-pull@pbs', fingerprint: certificates('demo-pbs-001')[0].fingerprint, comment: 'Source of the nightly pull sync' }]
  : [{ name: 'pbs-replica', host: '10.10.10.51', port: 8007, 'auth-id': 'restore@pbs', fingerprint: certificates('demo-pbs-002')[0].fingerprint, comment: 'Off-site replica, used for restore tests' }]

// --- APT repositories (PbsRepositoriesTab reads data.files / data['standard-repos'] / data.errors) ---

const repositories = (id: PbsId) => {
  const enterprise = id === 'demo-pbs-001'

  return {
    digest: enterprise ? '6f1c2b0e9a4d' : '0b7e5c13d8a2',
    errors: [],
    infos: [],
    files: [
      {
        path: '/etc/apt/sources.list',
        'file-type': 'list',
        repositories: [
          { Types: ['deb'], URIs: ['http://deb.debian.org/debian'], Suites: ['bookworm'], Components: ['main', 'contrib'], Enabled: true, FileType: 'list' },
          { Types: ['deb'], URIs: ['http://deb.debian.org/debian'], Suites: ['bookworm-updates'], Components: ['main', 'contrib'], Enabled: true, FileType: 'list' },
          { Types: ['deb'], URIs: ['http://security.debian.org/debian-security'], Suites: ['bookworm-security'], Components: ['main', 'contrib'], Enabled: true, FileType: 'list' },
          ...(enterprise ? [] : [{ Types: ['deb'], URIs: ['http://download.proxmox.com/debian/pbs'], Suites: ['bookworm'], Components: ['pbs-no-subscription'], Enabled: true, FileType: 'list' }]),
        ],
      },
      {
        path: '/etc/apt/sources.list.d/pbs-enterprise.list',
        'file-type': 'list',
        repositories: [
          { Types: ['deb'], URIs: ['https://enterprise.proxmox.com/debian/pbs'], Suites: ['bookworm'], Components: ['pbs-enterprise'], Enabled: enterprise, FileType: 'list' },
        ],
      },
    ],
    'standard-repos': [
      { handle: 'enterprise', name: 'Enterprise', status: enterprise ? 'configured' : 'not-configured' },
      { handle: 'no-subscription', name: 'No-Subscription', status: enterprise ? 'not-configured' : 'configured' },
      { handle: 'test', name: 'Test', status: 'not-configured' },
    ],
  }
}

// --- Services (PbsServicesTab) ---

const SERVICES = [
  { service: 'proxmox-backup', name: 'proxmox-backup', desc: 'Proxmox Backup API Server', state: 'running', 'unit-state': 'enabled' },
  { service: 'proxmox-backup-proxy', name: 'proxmox-backup-proxy', desc: 'Proxmox Backup API Proxy Server', state: 'running', 'unit-state': 'enabled' },
  { service: 'chrony', name: 'chrony', desc: 'chrony, an NTP client/server', state: 'running', 'unit-state': 'enabled' },
  { service: 'cron', name: 'cron', desc: 'Regular background program processing daemon', state: 'running', 'unit-state': 'enabled' },
  { service: 'postfix', name: 'postfix', desc: 'Postfix Mail Transport Agent', state: 'running', 'unit-state': 'enabled' },
  { service: 'smartmontools', name: 'smartmontools', desc: 'Self Monitoring and Reporting Technology (SMART) Daemon', state: 'running', 'unit-state': 'enabled' },
  { service: 'sshd', name: 'sshd', desc: 'OpenBSD Secure Shell server', state: 'running', 'unit-state': 'enabled' },
  { service: 'syslog', name: 'syslog', desc: 'System Logging Service', state: 'running', 'unit-state': 'enabled' },
  { service: 'systemd-journald', name: 'systemd-journald', desc: 'Journal Service', state: 'running', 'unit-state': 'static' },
  { service: 'systemd-timesyncd', name: 'systemd-timesyncd', desc: 'Network Time Synchronization', state: 'stopped', 'unit-state': 'masked' },
]

// --- Subscription (PbsSubscriptionTab) ---

const subscription = (id: PbsId) => id === 'demo-pbs-001'
  ? {
      status: 'active', key: 'pbsb-demo-0001', productname: 'Proxmox Backup Server Basic Subscription 1 CPU/year',
      level: 'b', serverid: 'B6E2F4A91C0D3E57A8F1B2C4D6E8F0A1', sockets: 1, checktime: REF + 20 * DAY,
      nextduedate: '2027-03-14', regdate: '2026-03-14 00:00:00', url: 'https://www.proxmox.com/en/proxmox-backup-server/pricing',
    }
  : { status: 'notfound', message: 'There is no subscription key', serverid: '3D9A7C15E0B2F48C6A1E9D3B5F7C2A08', url: 'https://www.proxmox.com/en/proxmox-backup-server/pricing' }

// --- Traffic control (PbsTrafficControlTab), rates in bytes/s ---

const MB = 1024 * 1024

const trafficControl = (id: PbsId) => id === 'demo-pbs-001'
  ? [
      { name: 'replica-business-hours', network: ['10.10.10.51/32'], 'rate-out': 100 * MB, 'burst-out': 200 * MB, timeframe: ['mon..fri 08:00-19:00'], comment: 'Keep the off-site sync from saturating the WAN by day' },
      { name: 'pve-backup-ingest', network: ['10.10.20.0/24'], 'rate-in': 800 * MB, 'burst-in': 1024 * MB, comment: 'Production cluster backup traffic' },
    ]
  : [{ name: 'pull-from-master', network: ['10.10.10.50/32'], 'rate-in': 150 * MB, 'burst-in': 300 * MB, timeframe: ['mon..fri 08:00-19:00'], comment: 'Daytime pull cap' }]

// --- Updates (PbsUpdatesTab) ---

const PKG = (Package: string, OldVersion: string, Version: string, Title: string, Section = 'admin', Origin = 'Proxmox') =>
  ({ Package, OldVersion, Version, Title, Description: Title, Section, Origin, Priority: 'optional' })

const updates = (id: PbsId) => [
  PKG('proxmox-backup-server', '3.2.7-1', '3.2.8-1', 'Proxmox Backup Server daemon with tools and GUI'),
  PKG('proxmox-backup-client', '3.2.7-1', '3.2.8-1', 'Proxmox Backup Client tools'),
  PKG('proxmox-widget-toolkit', '4.2.3', '4.2.4', 'Core Widgets and ExtJS Helper Classes for Proxmox', 'web'),
  ...(id === 'demo-pbs-001'
    ? [
        PKG('proxmox-kernel-6.8', '6.8.12-2', '6.8.12-4', 'Latest Proxmox Kernel Image', 'kernel'),
        PKG('zfsutils-linux', '2.2.6-pve1', '2.2.7-pve1', 'command-line tools to manage OpenZFS filesystems', 'contrib/admin'),
      ]
    : []),
  PKG('openssl', '3.0.14-1~deb12u2', '3.0.15-1~deb12u1', 'Secure Sockets Layer toolkit - cryptographic utility', 'utils', 'Debian'),
]

// --- Tape (PbsTapeBackupTab): an LTO-8 autoloader on PBS Master, none on the replica ---

const TAPE_MASTER = {
  drives: [
    { name: 'lto8-drive0', path: '/dev/tape/by-id/scsi-35000e111c4a2b3f0-sg', changer: 'autoloader0', 'changer-drivenum': 0 },
  ],
  changers: [
    { name: 'autoloader0', path: '/dev/tape/by-id/scsi-3500110a00104f1c2', 'export-slots': '15,16' },
  ],
  pools: [
    { name: 'weekly-offsite', allocation: 'sat 02:00', retention: '8 weeks', template: '%Y-W%V', encrypt: true, comment: 'Shipped to the vault every Monday' },
    { name: 'monthly-archive', allocation: 'monthly', retention: 'keep', template: '%Y-%m', encrypt: true, comment: 'Kept forever' },
  ],
  jobs: [
    { id: 'tape-weekly', store: 'backup-main', pool: 'weekly-offsite', drive: 'lto8-drive0', schedule: 'sat 03:00', comment: 'Latest snapshot of every guest' },
    { id: 'tape-monthly', store: 'backup-main', pool: 'monthly-archive', drive: 'lto8-drive0', schedule: 'monthly', comment: 'Month-end archive' },
  ],
  media: [
    { 'label-text': 'WK0001L8', pool: 'weekly-offsite', location: 'vault-offsite', status: 'full', 'expired-at': REF + 14 * DAY },
    { 'label-text': 'WK0002L8', pool: 'weekly-offsite', location: 'vault-offsite', status: 'full', 'expired-at': REF + 28 * DAY },
    { 'label-text': 'WK0003L8', pool: 'weekly-offsite', location: 'online-autoloader0', status: 'writable' },
    { 'label-text': 'WK0004L8', pool: 'weekly-offsite', location: 'online-autoloader0', status: 'writable' },
    { 'label-text': 'MA0001L8', pool: 'monthly-archive', location: 'vault-offsite', status: 'full' },
    { 'label-text': 'MA0002L8', pool: 'monthly-archive', location: 'online-autoloader0', status: 'writable' },
    { 'label-text': 'CLN001L1', pool: '', location: 'online-autoloader0', status: 'unknown' },
  ],
}

const tape = (id: PbsId, kind: keyof typeof TAPE_MASTER) => ({ data: id === 'demo-pbs-001' ? TAPE_MASTER[kind] : [] })

// --- PVE side of the PBS servers ---

const CONNECTIONS: any[] = (MOCK_DATA as any)['/api/v1/connections']?.data ?? []
const connName = (id: string) => CONNECTIONS.find(c => c.id === id)?.name ?? id

const PROD_NODES = Array.from({ length: 12 }, (_, i) => `pve-node-${String(i + 1).padStart(2, '0')}`)
const DR_NODES = ['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04']

// PBS storages the PVE clusters declare (GET /connections/demo-pve-cluster-001/storage has PBS_MASTER).
const PBS_STORAGES = ((MOCK_DATA as any)['/api/v1/connections/demo-pve-cluster-001/storage']?.data ?? [])
  .filter((s: any) => s.type === 'pbs')
  .map((s: any) => ({
    pveId: 'demo-pve-cluster-001',
    pveName: connName('demo-pve-cluster-001'),
    storageName: s.storage,
    pbsServer: s.server ?? null,
    pbsDatastore: s.datastore ?? null,
    pbsFingerprint: s.fingerprint ?? null,
    pbsUsername: 'pve-sync@pbs!prod-cluster',
    pbsId: CONNECTIONS.find(c => c.type === 'pbs' && String(c.baseUrl).includes(`//${s.server}:`))?.id ?? null,
    pbsName: CONNECTIONS.find(c => c.type === 'pbs' && String(c.baseUrl).includes(`//${s.server}:`))?.name ?? null,
    nodes: s.nodes ?? null,
    content: Array.isArray(s.content) ? s.content : ['backup'],
    enabled: s.enabled !== false,
  }))

// Restore pickers (backups page, DrillTargetPicker): clusters whose storage reaches the datastore.
const pveStorages = (id: PbsId) => id === 'demo-pbs-001'
  ? PBS_STORAGES.filter((s: any) => s.pbsId === id).map((s: any) => ({ connId: s.pveId, connName: s.pveName, storage: s.storageName, nodes: s.nodes ?? PROD_NODES }))
  : [{ connId: 'demo-pve-dr-001', connName: connName('demo-pve-dr-001'), storage: 'PBS_REPLICA', nodes: DR_NODES }]

// --- Deterministic series helpers ---

const hash = (n: number) => (((Math.imul(n | 0, 2654435761) >>> 0) % 10000) / 10000)
const wave = (t: number, period: number, phase: number) => 0.5 + 0.5 * Math.sin((2 * Math.PI * t) / period + phase)
const seedOf = (str: string) => [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)

const RRD_SHAPE: Record<RrdTimeframe, { step: number; points: number }> = {
  hour: { step: 60, points: 60 },
  day: { step: 60, points: 1440 },
  week: { step: 1800, points: 336 },
  month: { step: 1800, points: 1440 },
  year: { step: 21600, points: 1440 },
}

function rrdTimes(timeframe: RrdTimeframe, now: number): number[] {
  const { step, points } = RRD_SHAPE[timeframe]
  const last = now - (now % step)

  return Array.from({ length: points }, (_, i) => last - (points - 1 - i) * step)
}

const GIB = 1024 ** 3

function serverRrdRows(id: PbsId, timeframe: RrdTimeframe, now: number) {
  const phase = id === 'demo-pbs-001' ? 0 : 1.7
  const load = id === 'demo-pbs-001' ? 1 : 0.6
  const memtotal = (id === 'demo-pbs-001' ? 64 : 32) * GIB
  const roottotal = 100 * 1000 ** 3

  return rrdTimes(timeframe, now).map(time => {
    const n = hash(time + phase * 1000)
    const night = wave(time, DAY, phase) // backup window peaks once a day
    const cpu = Math.round((4 + 28 * night * load + 6 * n) * 100) / 100

    return {
      time,
      cpu,
      iowait: Math.round((0.5 + 9 * night * load * n) * 100) / 100,
      loadavg: Math.round((0.3 + 5 * night * load + n) * 100) / 100,
      memtotal,
      memused: Math.round(memtotal * (0.38 + 0.18 * night + 0.03 * n)),
      memUsedPercent: Math.round((38 + 18 * night + 3 * n) * 100) / 100,
      swaptotal: 8 * GIB,
      swapused: Math.round(0.2 * GIB * n),
      swapUsedPercent: Math.round(2.5 * n * 100) / 100,
      netin: Math.round((2 + 180 * night * load * (0.7 + 0.3 * n)) * MB),
      netout: Math.round((1 + 40 * night * (0.6 + 0.4 * n)) * MB),
      diskread: Math.round((3 + 60 * night * n) * MB),
      diskwrite: Math.round((5 + 170 * night * load * (0.7 + 0.3 * n)) * MB),
      roottotal,
      rootused: Math.round(roottotal * 0.21),
      rootUsedPercent: 21,
    }
  })
}

// Same totals as GET /pbs/<id>/datastores in EXTRA_MOCKS.
const DATASTORE_SIZE: Record<PbsId, { total: number; used: number }> = {
  'demo-pbs-001': { total: 10995116277760, used: 5497558138880 },
  'demo-pbs-002': { total: 10995116277760, used: 3298534883328 },
}

function datastoreRrdRows(id: PbsId, store: string, timeframe: RrdTimeframe, now: number) {
  const { total, used: usedNow } = DATASTORE_SIZE[id]
  const seed = seedOf(store)
  const growthPerSec = usedNow * 0.0008 / DAY // about 0.08 % a day

  return rrdTimes(timeframe, now).map(time => {
    const n = hash(time + seed)
    const night = wave(time, DAY, seed % 7)
    const used = Math.round(usedNow - (now - time) * growthPerSec)

    return {
      time,
      total,
      used,
      available: total - used,
      usedPercent: Math.round((used / total) * 10000) / 100,
      read: Math.round((2 + 55 * night * n) * MB),
      write: Math.round((4 + 160 * night * (0.6 + 0.4 * n)) * MB),
      readIops: Math.round(40 + 900 * night * n),
      writeIops: Math.round(80 + 2400 * night * (0.6 + 0.4 * n)),
    }
  })
}

function rrdBody(rowsFor: (tf: RrdTimeframe, now: number) => any[], url: URL) {
  const cf = url.searchParams.get('cf') || 'AVERAGE'
  const range = resolveRrdRequest(url.searchParams.get('timeframe') || 'hour', url.searchParams.get('from'), url.searchParams.get('to'))
  const rows = rowsFor(range.timeframe, Math.floor(Date.now() / 1000))

  if (!range.window) return { data: rows, timeframe: range.timeframe, cf, meta: presetRangeMeta(rows, range.timeframe) }

  const clipped = applyRrdWindow(rows, range.window, range.timeframe, range.truncated)

  return { data: clipped.rows, timeframe: range.timeframe, cf, meta: clipped.meta }
}

// --- Tasks (PbsTasksTab) ---

type DemoTask = {
  upid: string; node: string; pid: number; pstart: number; starttime: number; endtime?: number
  worker_type: string; worker_id: string; user: string; status?: string; type: string
}

function makeTask(id: PbsId, starttime: number, type: string, workerId: string, user: string, duration: number | null, status = 'OK'): DemoTask {
  const node = PBS_FACTS[id].host
  const pid = 1000 + Math.floor(hash(starttime + type.length) * 60000)
  const hex = (v: number, w: number) => v.toString(16).toUpperCase().padStart(w, '0')
  const upid = `UPID:${node}:${hex(pid, 8)}:${hex(pid * 37, 8)}:00000000:${hex(starttime, 8)}:${type}:${workerId.replace(/\//g, '\\x2f').replace(/:/g, '\\x3a')}:${user}:`
  const task: DemoTask = { upid, node, pid, pstart: pid * 37, starttime, worker_type: type, worker_id: workerId, type, user }

  if (duration !== null) {
    task.endtime = starttime + duration
    task.status = status
  }

  return task
}

const BACKUP_GUESTS = [
  { type: 'vm', vmid: 100 }, { type: 'vm', vmid: 101 }, { type: 'vm', vmid: 102 }, { type: 'vm', vmid: 103 },
  { type: 'vm', vmid: 104 }, { type: 'vm', vmid: 105 }, { type: 'ct', vmid: 106 }, { type: 'ct', vmid: 107 }, { type: 'vm', vmid: 108 },
]

/** Newest first; one verify job is always running on PBS Master. */
export function demoPbsTasks(id: PbsId, now = Math.floor(Date.now() / 1000)): DemoTask[] {
  const store = PBS_FACTS[id].datastore
  const today = now - (now % DAY)
  const out: DemoTask[] = []

  for (let d = 0; d < 7; d++) {
    const day = today - d * DAY
    const weekday = new Date(day * 1000).getUTCDay()

    if (id === 'demo-pbs-001') {
      BACKUP_GUESTS.forEach((g, i) => {
        const start = day + 2 * 3600 + i * 420
        const failed = hash(start) < 0.04
        out.push(makeTask(id, start, 'backup', `${store}:${g.type}/${g.vmid}`, 'pve-sync@pbs!prod-cluster', 180 + Math.floor(hash(start + 1) * 220), failed ? 'connection error: connection reset' : 'OK'))
      })
      out.push(makeTask(id, day + 3 * 3600 + 1800, 'prunejob', `${store}:p-daily`, 'root@pam', 42))
      if (weekday === 6) out.push(makeTask(id, day + 3 * 3600, 'tape-backup-job', `${store}:weekly-offsite:lto8-drive0:tape-weekly`, 'root@pam', 5400))
    } else {
      out.push(makeTask(id, day + 3600, 'syncjob', `pbs-master:backup-main:${store}:s-nightly`, 'root@pam', 1500 + Math.floor(hash(day) * 900)))
      out.push(makeTask(id, day + 3 * 3600 + 1800, 'prunejob', `${store}:p-retention`, 'root@pam', 35))
    }
    out.push(makeTask(id, day + 4 * 3600, 'garbage_collection', store, 'root@pam', 900 + Math.floor(hash(day + 3) * 600)))
    out.push(makeTask(id, day + 6 * 3600 + 25 * 60, 'logrotate', '', 'root@pam', 2))
    if (weekday === 0) out.push(makeTask(id, day + 5 * 3600, 'verificationjob', `${store}:v-weekly`, 'root@pam', 7200))
    out.push(makeTask(id, day + 22 * 3600, 'aptupdate', '', 'root@pam', 9, d === 3 ? 'WARNINGS: 1' : 'OK'))
  }

  if (id === 'demo-pbs-001') {
    const bucket = now - (now % 900)
    out.push(makeTask(id, bucket - 300, 'verify', `${store}:vm/104`, 'root@pam', null))
  }

  return out.filter(t => t.starttime <= now).sort((a, b) => b.starttime - a.starttime)
}

function tasksBody(id: PbsId, url: URL) {
  const sp = url.searchParams
  const limit = Math.max(1, Math.min(500, Number.parseInt(sp.get('limit') || '50', 10) || 50))
  const start = Math.max(0, Number.parseInt(sp.get('start') || '0', 10) || 0)
  const typeFilter = (sp.get('typefilter') || '').toLowerCase()
  const userFilter = (sp.get('userfilter') || '').toLowerCase()
  let tasks = demoPbsTasks(id)

  // Same flags the route forwards to PBS: running=1 lists running tasks only.
  if ((sp.get('running') ?? '1') === '1') tasks = tasks.filter(t => !t.endtime)
  if (sp.get('errors') === '1') tasks = tasks.filter(t => t.endtime && t.status !== 'OK')
  if (typeFilter) tasks = tasks.filter(t => t.worker_type.toLowerCase().includes(typeFilter))
  if (userFilter) tasks = tasks.filter(t => t.user.toLowerCase().includes(userFilter))

  const data = tasks.slice(start, start + limit)

  return { data, total: data.length }
}

const iso = (sec: number) => new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 19)

function taskLogLines(task: DemoTask): string[] {
  const store = PBS_FACTS[task.node === 'pbs-master' ? 'demo-pbs-001' : 'demo-pbs-002'].datastore
  const head = `${iso(task.starttime)}`

  switch (task.worker_type) {
    case 'backup':
      return [
        `starting new backup on datastore '${store}' from ::ffff:10.10.20.11: "${task.worker_id.split(':')[1]}/${iso(task.starttime).replace(' ', 'T')}Z"`,
        'download \'index.json.blob\' from previous backup.',
        'register chunks in \'drive-scsi0.img.fidx\' from previous backup.',
        'download \'drive-scsi0.img.fidx\' from previous backup.',
        'created new fixed index 1 ("drive-scsi0.img.fidx")',
        'add blob "qemu-server.conf.blob" (420 bytes, comp: 420)',
        'Upload statistics for \'drive-scsi0.img.fidx\'',
        'UUID: 3f6e1c0b9a2d4e7f8b1c2d3e4f5a6b7c',
        'Checksum: 9d1c7f0e3b2a4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5',
        'Size: 34359738368',
        'Chunk count: 8192',
        'Upload size: 2147483648 (6%)',
        'Duplicates: 7680+12 (93%)',
        'Compression: 41%',
        'successfully closed fixed index 1',
        ...(task.status && task.status !== 'OK' ? [`backup failed: ${task.status}`, `TASK ERROR: ${task.status}`] : ['add blob "index.json.blob" (393 bytes, comp: 393)', 'successfully finished backup', 'backup finished successfully', 'TASK OK']),
      ]
    case 'garbage_collection':
      return [
        `starting garbage collection on store ${store}`,
        'Start GC phase1 (mark used chunks)',
        'marked 25% (112 of 448 index files)', 'marked 50% (224 of 448 index files)', 'marked 75% (336 of 448 index files)', 'marked 100% (448 of 448 index files)',
        'Start GC phase2 (sweep unused chunks)',
        'processed 50% (412233 chunks)', 'processed 100% (824466 chunks)',
        'Removed garbage: 18.42 GiB', 'Removed chunks: 9311',
        'Original data usage: 41.7 TiB', 'On-Disk usage: 5.0 TiB (12.0%)', 'On-Disk chunks: 815155',
        'Deduplication factor: 8.34',
        'TASK OK',
      ]
    case 'syncjob':
      return [
        `Starting datastore sync job 'pbs-master:backup-main:${store}:s-nightly'`,
        `sync datastore '${store}' from 'pbs-master/backup-main'`,
        'found 45 groups to sync',
        'sync group vm/100', 're-sync snapshot vm/100/latest', 'percentage done: 25.00% (11/45 groups)',
        'percentage done: 50.00% (22/45 groups)', 'percentage done: 75.00% (34/45 groups)', 'percentage done: 100.00% (45/45 groups)',
        'Finished syncing namespace , current progress: 45 groups, 0 snapshots',
        'sync job finished successfully',
        'TASK OK',
      ]
    case 'verify':
    case 'verificationjob':
      return [
        `verify datastore ${store}`,
        `verify group ${store}:vm/104 (3 snapshots)`,
        'check qemu-server.conf.blob', 'check drive-scsi0.img.fidx',
        'verified 1832.41/4096.00 MiB in 41.22 seconds, speed 44.45/99.37 MiB/s (0 errors)',
        ...(task.endtime ? ['percentage done: 100.00% (3/3 snapshots)', 'TASK OK'] : []),
      ]
    case 'tape-backup-job':
      return [
        `Starting tape backup job '${task.worker_id}'`,
        'update media online status', 'media set uuid: 71a2c3d4-e5f6-4789-90ab-cdef01234567',
        'found 45 groups', 'backup snapshot "vm/100/latest"', 'end backup backup-main:vm/108', 'append media catalog',
        'TASK OK',
      ]
    default:
      return [`${head} ${task.worker_type} started`, task.status && task.status !== 'OK' ? `TASK ${task.status}` : 'TASK OK']
  }
}

function taskLogBody(id: PbsId, upid: string, url: URL) {
  const sp = url.searchParams
  const start = Math.max(0, Number.parseInt(sp.get('start') || '0', 10) || 0)
  const limit = Math.max(1, Math.min(5000, Number.parseInt(sp.get('limit') || '500', 10) || 500))
  const task = demoPbsTasks(id).find(t => t.upid === upid)

  if (!task) return { data: { log: [], status: null } }

  const lines = taskLogLines(task)
  const log = lines.map((t, i) => ({ n: i + 1, t })).slice(start, start + limit)
  const status = {
    upid: task.upid, node: task.node, type: task.type, user: task.user, worker_id: task.worker_id,
    starttime: task.starttime, pid: task.pid, pstart: task.pstart,
    ...(task.endtime ? { status: 'stopped', exitstatus: task.status, endtime: task.endtime } : { status: 'running' }),
  }

  return { data: { log, status } }
}

// --- Syslog (PbsSyslogTab), one journal line every 30 s ---

const SYSLOG_MESSAGES: Array<(id: PbsId, t: number) => string> = [
  () => 'proxmox-backup-proxy[812]: rrd journal successfully committed (25 files in 0.021 seconds)',
  id => `proxmox-backup-proxy[812]: GET /api2/json/admin/datastore/${PBS_FACTS[id].datastore}/status: 200`,
  () => 'proxmox-backup-proxy[812]: GET /api2/json/nodes/localhost/status: 200',
  () => 'sshd[24871]: Connection closed by 10.10.10.5 port 51022 [preauth]',
  () => 'systemd[1]: Starting proxmox-backup-daily-update.service - Daily Proxmox Backup Server update and maintenance activities...',
  () => 'chronyd[702]: Selected source 10.10.10.2 (ntp.demo.local)',
  () => 'smartd[688]: Device: /dev/sda [SAT], SMART Usage Attribute: 194 Temperature_Celsius changed from 64 to 63',
  () => 'postfix/qmgr[1021]: 4F2A91C0D3: removed',
  () => `proxmox-backup-proxy[812]: authentication failure; rhost=[::ffff:10.10.30.77]:41822 user=admin@pbs msg=user account disabled or expired.`,
  () => 'CRON[30112]: (root) CMD (command -v debian-sa1 > /dev/null && debian-sa1 1 1)',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function syslogLine(id: PbsId, t: number): string {
  const d = new Date(t * 1000)
  const stamp = `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, ' ')} ${d.toISOString().slice(11, 19)}`
  const r = hash(t + (id === 'demo-pbs-001' ? 0 : 99991))
  // The auth failure line stays rare.
  const idx = r < 0.02 ? 8 : Math.floor(r * 8)

  return `${stamp} ${PBS_FACTS[id].host} ${SYSLOG_MESSAGES[idx](id, t)}`
}

function syslogBody(id: PbsId, url: URL) {
  const sp = url.searchParams
  const lastentries = Math.max(1, Math.min(5000, Number.parseInt(sp.get('lastentries') || '500', 10) || 500))
  const since = Number.parseInt(sp.get('since') || '', 10)
  const until = Number.parseInt(sp.get('until') || '', 10)
  const service = (sp.get('service') || '').trim().toLowerCase()
  const now = Math.floor(Date.now() / 1000)
  const last = Math.min(Number.isNaN(until) ? now : until, now)
  const end = last - (last % 30)
  const times: number[] = []

  for (let i = lastentries - 1; i >= 0; i--) {
    const t = end - i * 30

    if (Number.isNaN(since) || t >= since) times.push(t)
  }

  let lines = times.map(t => syslogLine(id, t))

  if (service) lines = lines.filter(l => l.toLowerCase().includes(service))

  return { data: { lines, source: 'journal' } }
}

// --- Changelog of an upgradable package (PbsUpdatesTab dialog) ---

function changelogBody(url: URL) {
  const name = (url.searchParams.get('name') || '').trim()
  const version = (url.searchParams.get('version') || '').trim()

  if (!name || !version) return null

  const changelog = [
    `${name} (${version}) bookworm; urgency=medium`,
    '',
    '  * fix a rare race in the chunk store when a garbage collection overlaps a',
    '    running backup',
    '  * ui: show the datastore maintenance mode in the summary panel',
    '  * update translations',
    '',
    ` -- Proxmox Support Team <support@proxmox.com>  ${new Date(REF * 1000).toUTCString().replace('GMT', '+0000')}`,
    '',
  ].join('\n')

  return { data: { changelog } }
}

// --- File browser of a backup snapshot (backups page, useHardwareHandlers) ---

const PXAR_TREE: Record<string, Array<[string, 'd' | 'f' | 'l', number]>> = {
  '/': [['bin', 'l', 7], ['boot', 'd', 0], ['etc', 'd', 0], ['home', 'd', 0], ['opt', 'd', 0], ['root', 'd', 0], ['srv', 'd', 0], ['usr', 'd', 0], ['var', 'd', 0]],
  '/etc': [['hostname', 'f', 12], ['hosts', 'f', 214], ['fstab', 'f', 612], ['nginx', 'd', 0], ['ssh', 'd', 0], ['systemd', 'd', 0], ['passwd', 'f', 1843], ['resolv.conf', 'f', 98]],
  '/etc/nginx': [['nginx.conf', 'f', 1482], ['sites-enabled', 'd', 0], ['conf.d', 'd', 0]],
  '/home': [['deploy', 'd', 0], ['admin', 'd', 0]],
  '/home/deploy': [['.bashrc', 'f', 3526], ['.ssh', 'd', 0], ['app', 'd', 0], ['release.tar.gz', 'f', 48211034]],
  '/root': [['.bash_history', 'f', 18233], ['.ssh', 'd', 0], ['backup.sh', 'f', 1290]],
  '/srv': [['www', 'd', 0], ['data', 'd', 0]],
  '/var': [['lib', 'd', 0], ['log', 'd', 0], ['www', 'd', 0]],
  '/var/log': [['syslog', 'f', 2384112], ['auth.log', 'f', 412882], ['nginx', 'd', 0], ['dpkg.log', 'f', 98123]],
}

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let v = b / 1024
  let u = 0

  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }

  return `${v.toFixed(2)} ${units[u]}`
}

function backupContentBody(rawId: string, url: URL) {
  const parts = decodeURIComponent(rawId).split('/')

  if (parts.length < 4) return { error: 'Invalid backupId format. Expected: datastore/[namespace/]type/vmid/timestamp' }

  const time = Number(parts[parts.length - 1])
  const snapshot = {
    datastore: parts[0],
    namespace: url.searchParams.get('ns') || parts.slice(1, parts.length - 3).join('/'),
    backupType: parts[parts.length - 3],
    backupId: parts[parts.length - 2],
    backupTime: parts[parts.length - 1],
  }
  const archive = url.searchParams.get('archive')

  if (!archive) {
    const isCt = snapshot.backupType === 'ct'
    const disk = 8 * GIB + Math.floor(hash(Number(snapshot.backupId)) * 56) * GIB
    const archives: Array<[string, number]> = isCt
      ? [['pct.conf.blob', 362], ['catalog.pcat1.didx', 1843211], ['root.pxar.didx', disk], ['index.json.blob', 512], ['client.log.blob', 2210]]
      : [['qemu-server.conf.blob', 486], ['fw.conf.blob', 128], ['drive-scsi0.img.fidx', disk], ['index.json.blob', 512], ['client.log.blob', 1820]]

    return {
      data: {
        path: '/',
        snapshot,
        files: archives.map(([name, size]) => {
          const isArchive = name.endsWith('.pxar.didx') || name.endsWith('.img.fidx')

          return { name, type: isArchive ? 'archive' : 'file', browsable: name.endsWith('.pxar.didx'), size, sizeFormatted: fmtBytes(size) }
        }),
      },
    }
  }

  const filepath = url.searchParams.get('filepath') || '/'
  const entries = (PXAR_TREE[filepath] ?? []).map(([name, kind, size]) => {
    const mtime = (Number.isFinite(time) ? time : REF) - Math.floor(hash(seedOf(filepath + name)) * 200) * DAY

    return {
      name,
      type: kind === 'd' ? 'directory' : kind === 'l' ? 'symlink' : 'file',
      size,
      sizeFormatted: fmtBytes(size),
      mtime,
      mtimeFormatted: new Date(mtime * 1000).toLocaleString('en-US'),
      leaf: kind !== 'd',
    }
  })

  entries.sort((a, b) => (a.type === 'directory') === (b.type === 'directory') ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)

  return { data: { path: filepath, archive, files: entries, snapshot } }
}

export const PBS_MOCKS: DemoMockMap = {
  ...perPbs('/access/users', id => ({ data: accessUsers(id) })),
  ...perPbs('/access/roles', () => ({ data: ACCESS_ROLES })),
  ...perPbs('/access/acl', id => ({ data: accessAcl(id) })),
  ...perPbs('/certificates', id => ({ data: certificates(id) })),
  ...perPbs('/disks', id => ({ data: disks(id) })),
  ...perPbs('/disks/directory', id => ({ data: directories(id) })),
  ...perPbs('/disks/zfs', id => ({ data: zfsPools(id) })),
  ...perPbs('/info', id => ({ data: { baseUrl: PBS_FACTS[id].baseUrl } })),
  ...perPbs('/notes', id => ({ data: notes(id) })),
  ...perPbs('/notifications/endpoints', () => ({ data: NOTIF_ENDPOINTS })),
  ...perPbs('/notifications/targets', () => ({ data: NOTIF_TARGETS })),
  ...perPbs('/notifications/matchers', () => ({ data: NOTIF_MATCHERS })),
  ...perPbs('/remotes', id => ({ data: remotes(id) })),
  ...perPbs('/repositories', id => ({ data: repositories(id) })),
  // PBS 3.2 has no S3 endpoints: the route answers notSupported on a 404.
  ...perPbs('/s3-endpoints', () => ({ data: [], notSupported: true })),
  ...perPbs('/services', () => ({ data: SERVICES })),
  ...perPbs('/subscription', id => ({ data: subscription(id) })),
  ...perPbs('/traffic-control', id => ({ data: trafficControl(id) })),
  ...perPbs('/updates', id => ({ data: updates(id) })),
  ...perPbs('/tape/drives', id => tape(id, 'drives')),
  ...perPbs('/tape/changers', id => tape(id, 'changers')),
  ...perPbs('/tape/media-pools', id => tape(id, 'pools')),
  ...perPbs('/tape/jobs', id => tape(id, 'jobs')),
  ...perPbs('/tape/media', id => tape(id, 'media')),
  ...perPbs('/pve-storages', id => ({ data: pveStorages(id) })),
  // Admin PBS picker (vDC bindings): datastore names only.
  'GET:/api/v1/admin/pbs-connections/demo-pbs-001/datastores': { data: [PBS_FACTS['demo-pbs-001'].datastore] },
  'GET:/api/v1/admin/pbs-connections/demo-pbs-002/datastores': { data: [PBS_FACTS['demo-pbs-002'].datastore] },
  'GET:/api/v1/pbs-storages': { data: PBS_STORAGES },
}

const asPbsId = (raw: string): PbsId => (decodeURIComponent(raw) === 'demo-pbs-002' ? 'demo-pbs-002' : 'demo-pbs-001')

export const resolvePbsMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method !== 'GET') return null

  const m = cleanPath.match(/^\/api\/v1\/pbs\/([^/]+)\/(.+)$/)

  if (!m) return null

  const id = asPbsId(m[1])
  const rest = m[2]

  if (rest === 'rrd') return rrdBody((tf, now) => serverRrdRows(id, tf, now), url)
  if (rest === 'tasks') return tasksBody(id, url)
  if (rest === 'syslog') return syslogBody(id, url)
  if (rest === 'updates/changelog') return changelogBody(url)

  const dsRrd = rest.match(/^datastores\/([^/]+)\/rrd$/)

  if (dsRrd) return rrdBody((tf, now) => datastoreRrdRows(id, decodeURIComponent(dsRrd[1]), tf, now), url)

  const taskLog = rest.match(/^tasks\/([^/]+)\/log$/)

  if (taskLog) return taskLogBody(id, decodeURIComponent(taskLog[1]), url)

  const content = rest.match(/^backups\/(.+)\/content$/)

  if (content) return backupContentBody(content[1], url)

  return null
}
