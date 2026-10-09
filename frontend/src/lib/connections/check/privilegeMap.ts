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

const requirement = (severity: PrivilegeRequirement['severity']) =>
  (id: string, path: string, privileges: string[], features: FeatureId[]): PrivilegeRequirement => ({ id, path, privileges, features, severity })
const fail = requirement('fail')
const warn = requirement('warn')

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
  fail('cluster-audit', '/', ['Sys.Audit'], ['inventory', 'nodes', 'ha', 'firewall', 'backupJobs', 'ceph', 'compliance']),
  fail('guest-audit', '/vms', ['VM.Audit'], ['inventory', 'guestConfig', 'snapshots', 'replication', 'firewall']),
  fail('storage-audit', '/storage', ['Datastore.Audit'], ['inventory', 'storage', 'ceph']),
  warn('guest-console', '/vms', ['VM.Console'], ['console']),
  warn('cluster-console', '/', ['Sys.Console'], ['nodeShell', 'ha']),
  warn('guest-power', '/vms', ['VM.PowerMgmt'], ['guestPower']),
  warn('guest-config', '/vms', [
    'VM.Config.Disk',
    'VM.Config.CPU',
    'VM.Config.Memory',
    'VM.Config.Network',
    'VM.Config.Options',
    'VM.Config.HWType',
    'VM.Config.CDROM',
    'VM.Config.Cloudinit',
  ], ['guestConfig', 'firewall']),
  warn('guest-create', '/vms', ['VM.Allocate', 'VM.Clone'], ['guestCreate', 'templates', 'migrationsTarget']),
  warn('guest-snapshot', '/vms', ['VM.Snapshot', 'VM.Snapshot.Rollback'], ['snapshots']),
  warn('guest-migrate', '/vms', ['VM.Migrate'], ['migrations']),
  warn('guest-backup', '/vms', ['VM.Backup'], ['backups']),
  warn('storage-allocate-space', '/storage', ['Datastore.AllocateSpace'], ['guestCreate', 'backups', 'migrations', 'migrationsTarget', 'templates']),
  warn('storage-allocate', '/storage', ['Datastore.Allocate'], ['storage', 'replication']),
  warn('storage-template', '/storage', ['Datastore.AllocateTemplate'], ['templates']),
  warn('cluster-modify', '/', ['Sys.Modify'], ['backupJobs', 'firewall', 'ceph', 'nodeUpdates', 'nodes']),
  warn('cluster-incoming', '/', ['Sys.Incoming'], ['migrationsTarget']),
  warn('node-power', '/nodes', ['Sys.PowerMgmt'], ['nodePower']),
  warn('sdn-audit', '/sdn', ['SDN.Audit'], ['sdn']),
  warn('sdn-allocate', '/sdn', ['SDN.Allocate'], ['sdn']),
  warn('pool-audit', '/pool', ['Pool.Audit'], ['pools']),
  warn('pool-allocate', '/pool', ['Pool.Allocate'], ['pools']),
  warn('mapping-audit', '/mapping', ['Mapping.Audit'], ['hardwareMappings', 'notifications']),
  warn('mapping-modify', '/mapping', ['Mapping.Modify'], ['notifications']),
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
 * Ordered rules, the first match wins: path pattern, family, and the features
 * the family serves. Paths are normalized by endpointFamily.
 */
const FAMILY_RULES: Array<[RegExp, string, FeatureId[]]> = [
  [/^\/version$/, 'version', []],
  [/^\/access\/permissions$/, 'access/permissions', []],
  [/^\/access(\/|$)/, 'access', ['compliance']],
  [/^\/cluster\/nextid$/, 'cluster/nextid', []],
  [/^\/cluster\/resources$/, 'cluster/resources', ['inventory']],
  [/^\/cluster\/(status|config|options)(\/|$)/, 'cluster/status', ['inventory', 'nodes']],
  [/^\/cluster\/metrics(\/|$)/, 'cluster/metrics', ['nodes']],
  [/^\/cluster\/(tasks|log)$/, 'cluster/log', ['inventory']],
  [/^\/cluster\/ha(\/|$)/, 'cluster/ha', ['ha']],
  [/^\/cluster\/sdn(\/|$)/, 'cluster/sdn', ['sdn']],
  [/^\/cluster\/firewall(\/|$)/, 'cluster/firewall', ['firewall']],
  [/^\/cluster\/backup(\/|$)/, 'cluster/backup', ['backupJobs']],
  [/^\/cluster\/replication(\/|$)/, 'cluster/replication', ['replication']],
  [/^\/cluster\/notifications(\/|$)/, 'cluster/notifications', ['notifications']],
  [/^\/cluster\/mapping(\/|$)/, 'cluster/mapping', ['hardwareMappings']],
  [/^\/cluster\/ceph(\/|$)/, 'ceph', ['ceph']],
  [/^\/nodes$/, 'nodes', ['inventory']],
  [/^\/nodes\/[^/]+\/ceph(\/|$)/, 'ceph', ['ceph']],
  [/^\/nodes\/[^/]+\/(termproxy|vncshell|spiceshell)$/, 'node/shell', ['nodeShell']],
  [/^\/nodes\/[^/]+\/firewall(\/|$)/, 'node/firewall', ['firewall']],
  [/^\/nodes\/[^/]+\/apt(\/|$)/, 'node/apt', ['nodeUpdates']],
  [/^\/nodes\/[^/]+\/status$/, 'node', ['nodes', 'compliance']],
  [/^\/nodes\/[^/]+\/(vzdump|vzdump\/.*)$/, 'backup/vzdump', ['backups']],
  [/^\/nodes\/[^/]+\/storage\/[^/]+\/download-url$/, 'storage/download', ['templates']],
  [/^\/nodes\/[^/]+\/storage(\/|$)/, 'storage', ['storage']],
  [/^\/nodes\/[^/]+\/capabilities(\/|$)/, 'node/capabilities', []],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(vncproxy|termproxy|spiceproxy|vncwebsocket)$/, 'guest/console', ['console']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/status(\/|$)/, 'guest/power', ['guestPower']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(migrate|remote_migrate|mtunnel)$/, 'guest/migrate', ['migrations', 'migrationsTarget']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/snapshot(\/|$)/, 'guest/snapshot', ['snapshots']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/(clone|template)$/, 'guest/create', ['guestCreate', 'templates']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+\/firewall(\/|$)/, 'guest/firewall', ['firewall']],
  [/^\/nodes\/[^/]+\/(qemu|lxc|\{x\})\/[^/]+(\/|$)/, 'guest', ['inventory', 'guestConfig']],
  [/^\/nodes\/[^/]+\/(qemu|lxc)$/, 'guest', ['inventory', 'guestConfig']],
  [/^\/nodes\/[^/]+(\/|$)/, 'node', ['nodes', 'compliance']],
  [/^\/storage(\/|$)/, 'storage', ['storage']],
  [/^\/pools(\/|$)/, 'pools', ['pools']],
  // Paths assembled entirely at runtime (`${path}`): nothing to classify.
  [/^\{x\}(\/\{x\})*(\/|$)/, 'dynamic', []],
]

/**
 * The PVE endpoints the app calls, grouped into families, each family naming
 * the features it serves. A family with no feature is `user => 'all'` in
 * pve-manager (no privilege needed). privilegeMap.test.ts scans every
 * `pveFetch` call in the tree and fails when a path has no family here, so a
 * new endpoint cannot land without its privileges being thought about.
 */
export const ENDPOINT_FEATURES: Record<string, FeatureId[]> = Object.fromEntries(
  FAMILY_RULES.map(([, family, features]) => [family, features]),
)

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
