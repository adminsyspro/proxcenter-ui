// src/lib/connections/check/privilegeMap.ts
//
// The one place that says which Proxmox VE privileges ProxCenter needs and
// which of its features stop working without each of them. The privileges
// probe reads the token's effective permissions (`GET /access/permissions`)
// and reports every requirement below that is not met, naming the features.
//
// Built from the PVE endpoints the routes and libs call through `pveFetch`
// (`ENDPOINT_FEATURES` classifies every such path, and privilegeMap.test.ts
// scans the tree to keep that classification complete) and from the
// permission checks pve-manager declares on those endpoints.

/** A ProxCenter feature, as the dialog names it (`settings.connectionCheck.features.<id>`). */
export type FeatureId =
  | 'inventory'
  | 'nodes'
  | 'console'
  | 'nodeShell'
  | 'guestConfig'
  | 'guestPower'
  | 'guestCreate'
  | 'templates'
  | 'snapshots'
  | 'migrations'
  | 'migrationsTarget'
  | 'backups'
  | 'backupJobs'
  | 'storage'
  | 'replication'
  | 'sdn'
  | 'firewall'
  | 'ha'
  | 'ceph'
  | 'pools'
  | 'notifications'
  | 'nodeUpdates'
  | 'nodePower'
  | 'hardwareMappings'
  | 'compliance'
  // Version-gated features (see versionGates.ts); listed here so the feature
  // vocabulary, and its translations, live in one place.
  | 'warmMigration'
  | 'haAffinityRules'
  | 'sdnFabrics'
  | 'vnetFirewall'
  | 'nestedPools'

export const FEATURE_IDS: FeatureId[] = [
  'inventory',
  'nodes',
  'console',
  'nodeShell',
  'guestConfig',
  'guestPower',
  'guestCreate',
  'templates',
  'snapshots',
  'migrations',
  'migrationsTarget',
  'backups',
  'backupJobs',
  'storage',
  'replication',
  'sdn',
  'firewall',
  'ha',
  'ceph',
  'pools',
  'notifications',
  'nodeUpdates',
  'nodePower',
  'hardwareMappings',
  'compliance',
  'warmMigration',
  'haAffinityRules',
  'sdnFabrics',
  'vnetFirewall',
  'nestedPools',
]

export interface PrivilegeRequirement {
  /** Stable id, becomes the item id suffix (`privileges.<id>`). */
  id: string
  /** ACL path at which ProxCenter needs the privileges (propagation counts). */
  path: string
  /** Every privilege in the group is required; the item lists the missing ones. */
  privileges: string[]
  features: FeatureId[]
  /** `fail` when the feature is the core of the product, `warn` otherwise. */
  severity: 'fail' | 'warn'
}

/**
 * Audit privileges first: without them the inventory is empty, so they fail.
 * Everything else degrades one feature and warns.
 *
 * Paths follow the PVE ACL tree: `/` for cluster-wide endpoints
 * (/cluster/status, /cluster/ha, /cluster/firewall, /cluster/backup),
 * `/nodes` for node endpoints, `/vms` for guests, `/storage`, `/sdn`,
 * `/pool`, `/mapping`.
 */
export const PRIVILEGE_REQUIREMENTS: PrivilegeRequirement[] = [
  {
    id: 'cluster-audit',
    path: '/',
    privileges: ['Sys.Audit'],
    features: ['inventory', 'nodes', 'ha', 'firewall', 'backupJobs', 'ceph', 'compliance'],
    severity: 'fail',
  },
  {
    id: 'guest-audit',
    path: '/vms',
    privileges: ['VM.Audit'],
    features: ['inventory', 'guestConfig', 'snapshots', 'replication', 'firewall'],
    severity: 'fail',
  },
  {
    id: 'storage-audit',
    path: '/storage',
    privileges: ['Datastore.Audit'],
    features: ['inventory', 'storage', 'ceph'],
    severity: 'fail',
  },
  {
    id: 'guest-console',
    path: '/vms',
    privileges: ['VM.Console'],
    features: ['console'],
    severity: 'warn',
  },
  {
    id: 'cluster-console',
    path: '/',
    privileges: ['Sys.Console'],
    features: ['nodeShell', 'ha'],
    severity: 'warn',
  },
  {
    id: 'guest-power',
    path: '/vms',
    privileges: ['VM.PowerMgmt'],
    features: ['guestPower'],
    severity: 'warn',
  },
  {
    id: 'guest-config',
    path: '/vms',
    privileges: [
      'VM.Config.Disk',
      'VM.Config.CPU',
      'VM.Config.Memory',
      'VM.Config.Network',
      'VM.Config.Options',
      'VM.Config.HWType',
      'VM.Config.CDROM',
      'VM.Config.Cloudinit',
    ],
    features: ['guestConfig', 'firewall'],
    severity: 'warn',
  },
  {
    id: 'guest-create',
    path: '/vms',
    privileges: ['VM.Allocate', 'VM.Clone'],
    features: ['guestCreate', 'templates', 'migrationsTarget'],
    severity: 'warn',
  },
  {
    id: 'guest-snapshot',
    path: '/vms',
    privileges: ['VM.Snapshot', 'VM.Snapshot.Rollback'],
    features: ['snapshots'],
    severity: 'warn',
  },
  {
    id: 'guest-migrate',
    path: '/vms',
    privileges: ['VM.Migrate'],
    features: ['migrations'],
    severity: 'warn',
  },
  {
    id: 'guest-backup',
    path: '/vms',
    privileges: ['VM.Backup'],
    features: ['backups'],
    severity: 'warn',
  },
  {
    id: 'storage-allocate-space',
    path: '/storage',
    privileges: ['Datastore.AllocateSpace'],
    features: ['guestCreate', 'backups', 'migrations', 'migrationsTarget', 'templates'],
    severity: 'warn',
  },
  {
    id: 'storage-allocate',
    path: '/storage',
    privileges: ['Datastore.Allocate'],
    features: ['storage', 'replication'],
    severity: 'warn',
  },
  {
    id: 'storage-template',
    path: '/storage',
    privileges: ['Datastore.AllocateTemplate'],
    features: ['templates'],
    severity: 'warn',
  },
  {
    id: 'cluster-modify',
    path: '/',
    privileges: ['Sys.Modify'],
    features: ['backupJobs', 'firewall', 'ceph', 'nodeUpdates', 'nodes'],
    severity: 'warn',
  },
  {
    id: 'cluster-incoming',
    path: '/',
    privileges: ['Sys.Incoming'],
    features: ['migrationsTarget'],
    severity: 'warn',
  },
  {
    id: 'node-power',
    path: '/nodes',
    privileges: ['Sys.PowerMgmt'],
    features: ['nodePower'],
    severity: 'warn',
  },
  {
    id: 'sdn-audit',
    path: '/sdn',
    privileges: ['SDN.Audit'],
    features: ['sdn'],
    severity: 'warn',
  },
  {
    id: 'sdn-allocate',
    path: '/sdn',
    privileges: ['SDN.Allocate'],
    features: ['sdn'],
    severity: 'warn',
  },
  {
    id: 'pool-audit',
    path: '/pool',
    privileges: ['Pool.Audit'],
    features: ['pools'],
    severity: 'warn',
  },
  {
    id: 'pool-allocate',
    path: '/pool',
    privileges: ['Pool.Allocate'],
    features: ['pools'],
    severity: 'warn',
  },
  {
    id: 'mapping-audit',
    path: '/mapping',
    privileges: ['Mapping.Audit'],
    features: ['hardwareMappings', 'notifications'],
    severity: 'warn',
  },
  {
    id: 'mapping-modify',
    path: '/mapping',
    privileges: ['Mapping.Modify'],
    features: ['notifications'],
    severity: 'warn',
  },
]

/**
 * Privileges the built-in PVEAdmin role does not carry. A missing one of
 * these needs a custom role, the way the connection dialog documents it.
 */
const NOT_IN_PVEADMIN = new Set(['Sys.PowerMgmt', 'Sys.AccessNetwork', 'Sys.Incoming', 'Permissions.Modify', 'Realm.Allocate'])

/** `user@realm!name` out of `user@realm!name=secret`. */
export function tokenIdOf(apiToken: string): string {
  const eq = apiToken.indexOf('=')
  return eq === -1 ? apiToken : apiToken.slice(0, eq)
}

/** `user@realm!name` into its user and token name; `name` is null for a plain user id. */
export function splitTokenId(tokenId: string): { user: string; name: string | null } {
  const bang = tokenId.indexOf('!')
  return bang === -1 ? { user: tokenId, name: null } : { user: tokenId.slice(0, bang), name: tokenId.slice(bang + 1) }
}

/**
 * The pveum commands that grant `missing` at `path`. A token's effective
 * privileges are the intersection of its user's and, with privilege
 * separation on (the default), of its own ACL: the user always needs the
 * grant, the token too unless separation is known to be off. `privsep` null
 * (not readable) writes both, the hint explains when the second applies.
 */
export function aclCommand(path: string, tokenId: string, missing: string[], privsep: boolean | null): string {
  const custom = missing.filter(p => NOT_IN_PVEADMIN.has(p))
  const role = custom.length === 0 ? 'PVEAdmin' : 'ProxCenter'
  const { user, name } = splitTokenId(tokenId)
  const steps: string[] = []
  if (custom.length > 0) steps.push(`pveum role add ProxCenter -privs "${custom.join(',')}"`)
  steps.push(`pveum aclmod ${path} -user ${user} -role ${role}`)
  if (name !== null && privsep !== false) steps.push(`pveum aclmod ${path} -token '${tokenId}' -role ${role}`)
  return steps.join(' ; ')
}

/** What `GET /access/permissions` returns: path -> privilege -> propagate flag. */
export type PvePermissions = Record<string, Record<string, number>>

function parentPath(path: string): string | null {
  if (path === '/' || !path.startsWith('/')) return null
  const idx = path.lastIndexOf('/')
  return idx <= 0 ? '/' : path.slice(0, idx)
}

/**
 * Whether the token holds `privilege` at `path`. PVE lists effective
 * privileges per path with the value telling whether they propagate: on the
 * exact path any value counts, on the nearest listed ancestor only a
 * propagating (1) grant reaches `path`. The nearest ancestor is authoritative
 * because PVE already folded its own ancestors into it.
 */
export function hasPrivilegeAt(permissions: PvePermissions, path: string, privilege: string): boolean {
  let current: string | null = path
  while (current !== null) {
    const entry = permissions?.[current]
    if (entry && typeof entry === 'object') {
      if (!Object.hasOwn(entry, privilege)) return false
      const value = entry[privilege]
      return current === path ? value === 0 || value === 1 : value === 1
    }
    current = parentPath(current)
  }
  return false
}

/**
 * The PVE endpoints the app calls, grouped into families, each family naming
 * the features it serves. A family with no feature is `user => 'all'` in
 * pve-manager (no privilege needed). privilegeMap.test.ts scans every
 * `pveFetch` call in the tree and fails when a path has no family here, so a
 * new endpoint cannot land without its privileges being thought about.
 */
export const ENDPOINT_FEATURES: Record<string, FeatureId[]> = {
  'version': [],
  'access/permissions': [],
  'cluster/nextid': [],
  'node/capabilities': [],
  'dynamic': [],
  'access': ['compliance'],
  'cluster/resources': ['inventory'],
  'cluster/status': ['inventory', 'nodes'],
  'cluster/metrics': ['nodes'],
  'cluster/log': ['inventory'],
  'cluster/ha': ['ha'],
  'cluster/sdn': ['sdn'],
  'cluster/firewall': ['firewall'],
  'cluster/backup': ['backupJobs'],
  'cluster/replication': ['replication'],
  'cluster/notifications': ['notifications'],
  'cluster/mapping': ['hardwareMappings'],
  'ceph': ['ceph'],
  'nodes': ['inventory'],
  'node': ['nodes', 'compliance'],
  'node/shell': ['nodeShell'],
  'node/firewall': ['firewall'],
  'node/apt': ['nodeUpdates'],
  'node/power': ['nodePower'],
  'guest': ['inventory', 'guestConfig'],
  'guest/console': ['console'],
  'guest/power': ['guestPower'],
  'guest/migrate': ['migrations', 'migrationsTarget'],
  'guest/snapshot': ['snapshots'],
  'guest/create': ['guestCreate', 'templates'],
  'guest/firewall': ['firewall'],
  'backup/vzdump': ['backups'],
  'storage': ['storage'],
  'storage/download': ['templates'],
  'pools': ['pools'],
}

/** Ordered rules: the first match wins. Paths are normalized by endpointFamily. */
const FAMILY_RULES: Array<[RegExp, string]> = [
  [/^\/version$/, 'version'],
  [/^\/access\/permissions$/, 'access/permissions'],
  [/^\/access(\/|$)/, 'access'],
  [/^\/cluster\/nextid$/, 'cluster/nextid'],
  [/^\/cluster\/resources$/, 'cluster/resources'],
  [/^\/cluster\/(status|config|options)(\/|$)/, 'cluster/status'],
  [/^\/cluster\/metrics(\/|$)/, 'cluster/metrics'],
  [/^\/cluster\/(tasks|log)$/, 'cluster/log'],
  [/^\/cluster\/ha(\/|$)/, 'cluster/ha'],
  [/^\/cluster\/sdn(\/|$)/, 'cluster/sdn'],
  [/^\/cluster\/firewall(\/|$)/, 'cluster/firewall'],
  [/^\/cluster\/backup(\/|$)/, 'cluster/backup'],
  [/^\/cluster\/replication(\/|$)/, 'cluster/replication'],
  [/^\/cluster\/notifications(\/|$)/, 'cluster/notifications'],
  [/^\/cluster\/mapping(\/|$)/, 'cluster/mapping'],
  [/^\/cluster\/ceph(\/|$)/, 'ceph'],
  [/^\/nodes$/, 'nodes'],
  [/^\/nodes\/[^/]+\/ceph(\/|$)/, 'ceph'],
  [/^\/nodes\/[^/]+\/(termproxy|vncshell|spiceshell)$/, 'node/shell'],
  [/^\/nodes\/[^/]+\/firewall(\/|$)/, 'node/firewall'],
  [/^\/nodes\/[^/]+\/apt(\/|$)/, 'node/apt'],
  [/^\/nodes\/[^/]+\/status$/, 'node'],
  [/^\/nodes\/[^/]+\/(vzdump|vzdump\/.*)$/, 'backup/vzdump'],
  [/^\/nodes\/[^/]+\/storage\/[^/]+\/download-url$/, 'storage/download'],
  [/^\/nodes\/[^/]+\/storage(\/|$)/, 'storage'],
  [/^\/nodes\/[^/]+\/capabilities(\/|$)/, 'node/capabilities'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(vncproxy|termproxy|spiceproxy|vncwebsocket)$/, 'guest/console'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/status(\/|$)/, 'guest/power'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(migrate|remote_migrate|mtunnel)$/, 'guest/migrate'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/snapshot(\/|$)/, 'guest/snapshot'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(clone|template)$/, 'guest/create'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/firewall(\/|$)/, 'guest/firewall'],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+(\/|$)/, 'guest'],
  [/^\/nodes\/[^/]+\/(qemu|lxc)$/, 'guest'],
  [/^\/nodes\/[^/]+(\/|$)/, 'node'],
  [/^\/storage(\/|$)/, 'storage'],
  [/^\/pools(\/|$)/, 'pools'],
  // Paths assembled entirely at runtime (`${path}`): nothing to classify.
  [/^\{x\}(\/\{x\})*(\/|$)/, 'dynamic'],
]

/**
 * The family of one `pveFetch` path. Template holes (`${...}`) are already
 * reduced to `{x}` and the query string dropped by the caller; a literal node
 * name or vmid matches the same rules.
 */
export function endpointFamily(path: string): string | undefined {
  for (const [rule, family] of FAMILY_RULES) {
    if (rule.test(path)) return family
  }
  return undefined
}
