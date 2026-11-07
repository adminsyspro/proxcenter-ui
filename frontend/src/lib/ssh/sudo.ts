// Per-program sudo for a dedicated SSH account.
//
// A command builder wraps each privileged program invocation with asRoot().
// executeSSH resolves the marks for the connection: `sudo -n <program>` for a
// non-root account with sudo enabled, the bare program otherwise. The rest of
// the command (pipes, tests, loops, redirections) runs as the SSH account, so
// a restricted sudoers file listing the marked programs, each pinned by an
// anchored expression over its arguments, is enough.
//
// The orchestrator follows the same scheme (internal/sudo); its rules and the
// ones below are both written into the sudoers template of
// /settings?tab=ssh-commands. A command without any mark keeps the historical
// `sudo sh -c '<command>'` wrapping (migrations), unless its caller declares it
// runs as the account (SSHExecOpts.asAccount).

// Never sent to a node: resolveSudo replaces every occurrence first. The NUL
// bytes make an unresolved mark fail on the node instead of running anything.
const MARK = '\u0000sudo\u0000'

/** Marks one program invocation, with its arguments, as needing root. */
export function asRoot(cmd: string): string {
  return MARK + cmd
}

export function hasSudoMark(cmd: string): boolean {
  return cmd.includes(MARK)
}

/** `sudo -n ` for each mark when useSudo, nothing otherwise. */
export function resolveSudo(cmd: string, useSudo: boolean): string {
  return cmd.split(MARK).join(useSudo ? 'sudo -n ' : '')
}

export const SUDO_PROFILES = ['node-ops', 'site-recovery', 'migrations'] as const
export type SudoProfile = (typeof SUDO_PROFILES)[number]

/** i18n key of each profile under settings.sshCommands.profiles. */
export const SUDO_PROFILE_I18N: Record<SudoProfile, string> = {
  'node-ops': 'nodeOps',
  'site-recovery': 'siteRecovery',
  migrations: 'migrations',
}

/**
 * One program allowed as root with arguments matching `args`: a POSIX
 * extended expression anchored with ^ and $, matched by sudo (1.9.10 or
 * later) against the arguments joined by one space. Same shape as the
 * orchestrator's rules (GET /api/v1/ssh/sudo-rules).
 */
export interface SudoRule {
  id: string
  profile: SudoProfile
  path: string
  args: string
  usedBy: string
  /**
   * The arguments of one concrete invocation the rule allows, joined by one
   * space. Test SSH asks `sudo -n -l` about it on each node to find the rules
   * the node's sudoers file lacks. Absent from an older orchestrator.
   */
  example?: string
  /**
   * An invocation the rule must refuse, words joined by one space: Test SSH
   * asks `sudo -n -l` about it too, and a node that allows it holds a sudoers
   * file older than the rule (a pinned argument still open there).
   */
  refused?: string
  rootEquivalent?: boolean
  /**
   * Does not amount to root, but a stolen key could still misuse it, for
   * instance to send guest traffic out of the cluster. `why` tells how.
   */
  sensitive?: boolean
  why?: string
}

const NODE = '[A-Za-z0-9][A-Za-z0-9.-]*'
const VMID = '[0-9]+'
const CONF = `/etc/pve/nodes/${NODE}/(qemu-server|lxc)/${VMID}\\.conf`

const APT_DIST_UPGRADE_ARGS = '-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade'

/**
 * The node upgrade, non-interactive. DEBIAN_FRONTEND is set by env inside the
 * command the sudoers rule pins, never kept from the caller's environment:
 * debconf evaluates its value as Perl code, so a sudoers file keeping it
 * (env_keep) would hand root to whoever holds the account's key.
 */
export const APT_DIST_UPGRADE = `env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get ${APT_DIST_UPGRADE_ARGS}`

/** The lowest sFlow sampling rate ProxCenter applies (1 packet in 64). */
export const SFLOW_MIN_SAMPLING = 64

// 64 and above, written for POSIX and JavaScript alike.
const SFLOW_SAMPLING = '(6[4-9]|[7-9][0-9]|[1-9][0-9]{2,9})'
const SFLOW_ANY_TARGET = '[A-Za-z0-9.:-]+:[0-9]+'
const SFLOW_EXAMPLE_TARGET = '10.0.0.1:6343'
// TEST-NET-3 (RFC 5737): never a real collector, what a pinned rule refuses.
const SFLOW_FOREIGN_TARGET = '203.0.113.1:6343'
const SFLOW_TARGET = /^[A-Za-z0-9._:[\]-]{1,255}$/

function sflowConfigureArgs(target: string): string {
  return `^-- --id=@s create sflow target="${target}"( agent="[0-9A-Fa-f.:]+")? header=128 sampling=${SFLOW_SAMPLING} polling=[0-9]+ -- set Bridge [A-Za-z0-9_.-]+ sflow=@s$`
}

function sflowConfigureExample(target: string): string {
  return `-- --id=@s create sflow target="${target}" header=128 sampling=512 polling=30 -- set Bridge vmbr0 sflow=@s`
}

/**
 * The rules with the sFlow configure rule pinned to the collector saved in
 * Network Flows: a stolen key can then only point the nodes at ProxCenter.
 * Without a usable saved collector the rule stays open, and sensitive.
 */
export function pinSFlowCollector(rules: SudoRule[], target: string | null | undefined): SudoRule[] {
  if (!target || !SFLOW_TARGET.test(target)) return rules
  const literal = target.replace(/[.[\]]/g, m => `\\${m}`)

  return rules.map(r => (r.id === 'ui-sflow-configure'
    ? { ...r, args: sflowConfigureArgs(literal), example: sflowConfigureExample(target), refused: sflowConfigureExample(SFLOW_FOREIGN_TARGET), sensitive: false, why: undefined }
    : r))
}

/** The rules of the commands the frontend itself sends (profile node-ops). */
export const FRONTEND_SUDO_RULES: SudoRule[] = [
  { id: 'ui-guest-unlock', profile: 'node-ops', path: '/usr/sbin/qm', args: `^unlock ${VMID}$`, usedBy: 'Operations > VM > Unlock, cross-cluster migration > Unlock the source' , example: 'unlock 100' },
  { id: 'ui-ct-unlock', profile: 'node-ops', path: '/usr/sbin/pct', args: `^unlock ${VMID}$`, usedBy: 'Operations > Container > Unlock' , example: 'unlock 100' },
  { id: 'ui-console-thumbnail', profile: 'node-ops', path: '/usr/bin/pvesh', args: `^create /nodes/localhost/qemu/${VMID}/monitor --command screendump /tmp/pxc-screen-${VMID}\\.ppm$`, usedBy: 'Inventory > VM console thumbnail' , example: 'create /nodes/localhost/qemu/100/monitor --command screendump /tmp/pxc-screen-100.ppm' },
  { id: 'ui-console-thumbnail-read', profile: 'node-ops', path: '/usr/bin/base64', args: `^-w0 /tmp/pxc-screen-${VMID}\\.ppm$`, usedBy: 'Inventory > VM console thumbnail' , example: '-w0 /tmp/pxc-screen-100.ppm' },
  { id: 'ui-console-thumbnail-cleanup', profile: 'node-ops', path: '/usr/bin/rm', args: `^-f /tmp/pxc-screen-${VMID}\\.ppm$`, usedBy: 'Inventory > VM console thumbnail' , example: '-f /tmp/pxc-screen-100.ppm' },
  { id: 'ui-ha-node-maintenance', profile: 'node-ops', path: '/usr/sbin/ha-manager', args: `^crm-command node-maintenance (enable|disable) ${NODE}$`, usedBy: 'Infrastructure > Node > Maintenance' , example: 'crm-command node-maintenance enable probe' },
  { id: 'ui-ceph-host-flag', profile: 'node-ops', path: '/usr/bin/ceph', args: `^osd (set|unset)-group (noout|noin|nodown|noup) ${NODE}$`, usedBy: 'Ceph > Flags per host, Node > Maintenance > Ceph noout' , example: 'osd set-group noout probe' },
  { id: 'ui-ceph-ok-to-stop', profile: 'node-ops', path: '/usr/bin/ceph', args: '^osd ok-to-stop [0-9]+( [0-9]+)* -f json$', usedBy: 'Node > Maintenance > Ceph ok-to-stop precheck' , example: 'osd ok-to-stop 0 -f json' },
  { id: 'ui-node-reboot', profile: 'node-ops', path: '/usr/sbin/reboot', args: '', usedBy: 'Infrastructure > Node > Reboot, Upgrade with reboot' , example: '' },
  { id: 'ui-node-apt-update', profile: 'node-ops', path: '/usr/bin/apt-get', args: '^update$', usedBy: 'Infrastructure > Node > Upgrade' , example: 'update' },
  { id: 'ui-node-apt-upgrade', profile: 'node-ops', path: '/usr/bin/env', args: `^DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get ${APT_DIST_UPGRADE_ARGS}$`, usedBy: 'Infrastructure > Node > Upgrade' , example: `DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get ${APT_DIST_UPGRADE_ARGS}` },
  { id: 'ui-node-upgrade-files', profile: 'node-ops', path: '/usr/bin/tee', args: '^(-a )?/var/log/proxcenter-upgrade\\.(status|log)$', usedBy: 'Infrastructure > Node > Upgrade (status and log files)' , example: '-a /var/log/proxcenter-upgrade.log' },
  { id: 'ui-node-upgrade-log-reset', profile: 'node-ops', path: '/usr/bin/rm', args: '^-f /var/log/proxcenter-upgrade\\.log$', usedBy: 'Infrastructure > Node > Upgrade (status and log files)' , example: '-f /var/log/proxcenter-upgrade.log' },
  { id: 'ui-sflow-guest-macs', profile: 'node-ops', path: '/usr/bin/grep', args: `^-H \\^net( (${CONF}|/etc/pve/nodes/\\*/(qemu-server|lxc)/\\*\\.conf))+$`, usedBy: 'Network Flows > Agents > Guest MAC map' , example: '-H ^net /etc/pve/nodes/probe/qemu-server/100.conf' },
  { id: 'ui-sflow-read', profile: 'node-ops', path: '/usr/bin/ovs-vsctl', args: '^(list-br|--version|list sflow)$', usedBy: 'Network Flows > Agents, drift probe' , example: 'list-br' },
  { id: 'ui-sflow-configure', profile: 'node-ops', path: '/usr/bin/ovs-vsctl', args: sflowConfigureArgs(SFLOW_ANY_TARGET), usedBy: 'Network Flows > Configure sFlow' , example: sflowConfigureExample(SFLOW_EXAMPLE_TARGET), sensitive: true, why: 'No sFlow collector is saved in Network Flows yet, so the rule admits any address: the first 128 bytes of the sampled guest packets could leave the cluster. Configure sFlow once, then regenerate this file to pin the collector.' },
  { id: 'ui-cis-sshd', profile: 'node-ops', path: '/usr/sbin/sshd', args: '^-T$', usedBy: 'Compliance > CIS hardening (effective sshd configuration)' , example: '-T' },
  { id: 'ui-cis-apparmor', profile: 'node-ops', path: '/usr/sbin/aa-status', args: '^--json$', usedBy: 'Compliance > CIS hardening (AppArmor)' , example: '--json' },
  { id: 'ui-cis-fail2ban', profile: 'node-ops', path: '/usr/bin/fail2ban-client', args: '^status$', usedBy: 'Compliance > CIS hardening (fail2ban)' , example: 'status' },
  { id: 'ui-cis-find', profile: 'node-ops', path: '/usr/bin/find', args: '^/ -xdev -type f (\\( -perm -4000 -o -perm -2000 \\)|-perm -0002 ! -path /proc/\\* ! -path /sys/\\* ! -path /tmp/\\* ! -path /var/tmp/\\*) -print$', usedBy: 'Compliance > CIS hardening (SUID and world-writable files)' , example: '/ -xdev -type f ( -perm -4000 -o -perm -2000 ) -print' },
]

// -------- sudoers check (Test SSH) --------

/** The oldest sudo reading the regular expressions of the restricted template. */
export const SUDO_MIN_VERSION = [1, 9, 10] as const

// The migrations profile grants everything: any command stands for it.
const MIGRATIONS_ID = 'pxc-migrations'
// An older template kept DEBIAN_FRONTEND (env_keep), which debconf evaluates
// as code: with the apt-get rule, that is root for the account.
const ENV_KEEP_ID = 'pxc-env-keep'
const MIGRATIONS_PROBE = ['/bin/sh', '-c', 'true']

function shellWord(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`
}

/**
 * One script checking, for every rule with an example, whether the account
 * may run it: `sudo -n -l <path> <example>` answers without running anything.
 * A program missing from the node (no Ceph, no Open vSwitch) is reported as
 * not applicable rather than missing. The script stops early when sudo is not
 * installed or grants the account nothing, so a node without any sudoers
 * entry for it is asked once and not once per rule.
 */
export function buildSudoCheckCommand(rules: SudoRule[]): string {
  const checks = rules
    .filter(r => typeof r.example === 'string')
    .map(r => ['pxc_r', r.id, r.path, ...r.example!.split(' ').filter(Boolean)].map((w, i) => (i === 0 ? w : shellWord(w))).join(' '))
  const refusals = rules
    .filter(r => typeof r.refused === 'string')
    .map(r => ['pxc_n', r.id, r.path, ...r.refused!.split(' ').filter(Boolean)].map((w, i) => (i === 0 ? w : shellWord(w))).join(' '))

  return [
    'command -v sudo >/dev/null 2>&1 || { echo PXC_SUDO_VERSION:none; exit 0; }',
    'echo "PXC_SUDO_VERSION:$(sudo -V 2>/dev/null | head -n1)"',
    'sudo -n -l >/dev/null 2>&1 || { echo PXC_SUDO_NORIGHTS; exit 0; }',
    `sudo -n -l 2>/dev/null | grep -q 'env_keep.*DEBIAN_FRONTEND' && echo PXC_OPEN:${ENV_KEEP_ID}`,
    'pxc_r() { pxc_id=$1; shift; if [ ! -x "$1" ]; then echo "PXC_RULE:$pxc_id:na"; elif sudo -n -l "$@" >/dev/null 2>&1; then echo "PXC_RULE:$pxc_id:yes"; else echo "PXC_RULE:$pxc_id:no"; fi; }',
    'pxc_n() { pxc_id=$1; shift; if [ -x "$1" ] && sudo -n -l "$@" >/dev/null 2>&1; then echo "PXC_OPEN:$pxc_id"; fi; }',
    ...checks,
    ...refusals,
    ['pxc_r', MIGRATIONS_ID, ...MIGRATIONS_PROBE.map(shellWord)].join(' '),
  ].join('\n')
}

export interface SudoProfileCheck {
  /** Rules asked about on the node (programs it lacks are left out). */
  checked: number
  missing: { id: string, usedBy: string }[]
}

export interface SudoCheck {
  /** missing: sudo not installed; no-rights: no sudoers entry for the account. */
  status: 'ok' | 'missing' | 'no-rights' | 'too-old'
  version: string | null
  profiles: Partial<Record<SudoProfile, SudoProfileCheck>>
  /** Rules the node allows beyond what ProxCenter now needs: regenerate the file. */
  tooOpen?: { id: string, usedBy: string }[]
}

function versionTooOld(version: string): boolean {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(version)

  if (!m) return false
  const v = [Number(m[1]), Number(m[2]), Number(m[3])]

  for (let i = 0; i < 3; i++) {
    if (v[i] !== SUDO_MIN_VERSION[i]) return v[i] < SUDO_MIN_VERSION[i]
  }

  return false
}

/** Reads back the output of buildSudoCheckCommand for the same rules. */
export function parseSudoCheck(output: string, rules: SudoRule[]): SudoCheck {
  const versionLine = /PXC_SUDO_VERSION:(.*)/.exec(output)?.[1]?.trim() ?? ''

  if (versionLine === 'none') return { status: 'missing', version: null, profiles: {} }
  const version = versionLine || null

  if (output.includes('PXC_SUDO_NORIGHTS')) return { status: 'no-rights', version, profiles: {} }

  const answers = new Map<string, string>()

  for (const m of output.matchAll(/PXC_RULE:([a-z0-9-]+):(yes|no|na)/g)) answers.set(m[1], m[2])

  const profiles: Partial<Record<SudoProfile, SudoProfileCheck>> = {}
  const add = (profile: SudoProfile, id: string, usedBy: string, answer: string | undefined) => {
    if (answer !== 'yes' && answer !== 'no') return
    const p = (profiles[profile] ??= { checked: 0, missing: [] })

    p.checked++
    if (answer === 'no') p.missing.push({ id, usedBy })
  }

  for (const r of rules) add(r.profile, r.id, r.usedBy, answers.get(r.id))
  add('migrations', MIGRATIONS_ID, 'Migrations', answers.get(MIGRATIONS_ID))

  // The migrations profile grants everything: what it allows says nothing of
  // how old the restricted rules are.
  const open = answers.get(MIGRATIONS_ID) === 'yes' ? new Set<string>() : new Set([...output.matchAll(/PXC_OPEN:([a-z0-9-]+)/g)].map(m => m[1]))
  const tooOpen = rules.filter(r => open.has(r.id)).map(r => ({ id: r.id, usedBy: r.usedBy }))

  if (open.has(ENV_KEEP_ID)) tooOpen.push({ id: ENV_KEEP_ID, usedBy: 'env_keep DEBIAN_FRONTEND' })

  return { status: version && versionTooOld(version) ? 'too-old' : 'ok', version, profiles, ...(tooOpen.length > 0 && { tooOpen }) }
}

/** granted: every rule checked is allowed; partial: some are; none: none is. */
export function profileState(check: SudoProfileCheck | undefined): 'granted' | 'partial' | 'none' | 'unknown' {
  if (!check || check.checked === 0) return 'unknown'
  if (check.missing.length === 0) return 'granted'

  return check.missing.length === check.checked ? 'none' : 'partial'
}

// -------- Verification helpers (tests and Settings) --------

interface Token { text: string, op: boolean, quoted: boolean }

const OPERATOR_CHARS = '|&;()<>'

function tokenize(s: string): Token[] {
  const out: Token[] = []
  let cur = ''
  let inWord = false
  let quoted = false

  const flush = () => {
    if (inWord) out.push({ text: cur, op: false, quoted })
    cur = ''
    inWord = false
    quoted = false
  }

  for (let i = 0; i < s.length; i++) {
    const c = s[i]

    if (c === "'") {
      const j = s.indexOf("'", i + 1)
      const end = j < 0 ? s.length : j

      cur += s.slice(i + 1, end)
      inWord = true
      quoted = true
      i = end
    } else if (c === '"') {
      i++
      for (; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) i++
        cur += s[i]
      }
      inWord = true
      quoted = true
    } else if (c === '\\' && i + 1 < s.length) {
      i++
      cur += s[i]
      inWord = true
    } else if (c === ' ' || c === '\t' || c === '\n') {
      flush()
    } else if (c === '$' && s[i + 1] === '(') {
      flush()
      out.push({ text: '$(', op: true, quoted: false })
      i++
    } else if (OPERATOR_CHARS.includes(c)) {
      if ((c === '>' || c === '<') && inWord && !quoted && /^\d+$/.test(cur)) {
        cur = ''
        inWord = false
      }

      flush()
      let op = c

      while (i + 1 < s.length && '|&<>'.includes(s[i + 1])) op += s[++i]
      out.push({ text: op, op: true, quoted: false })

      if (/[<>]/.test(op)) {
        while (s[i + 1] === ' ') i++
        let j = i + 1

        while (j < s.length && !' \t\n|&;()<>'.includes(s[j])) j++
        if (j > i + 1) {
          out.push({ text: s.slice(i + 1, j), op: true, quoted: false })
          i = j - 1
        }
      }
    } else {
      cur += c
      inWord = true
    }
  }

  flush()

  return out
}

/** The argv of every `sudo -n` invocation of a resolved command line. */
export function sudoSegments(cmd: string): string[][] {
  const out: string[][] = []
  const tokens = tokenize(cmd)

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]

    if (t.op) continue
    if (t.quoted && t.text.includes('sudo -n ')) {
      out.push(...sudoSegments(t.text))
      continue
    }
    if (t.text !== 'sudo' || tokens[i + 1]?.op !== false || tokens[i + 1]?.text !== '-n') continue

    const argv: string[] = []
    let j = i + 2

    for (; j < tokens.length && !tokens[j].op; j++) argv.push(tokens[j].text)
    out.push(argv)
    i = j - 1
  }

  return out
}

/** The rule allowing argv (program by absolute path or base name), if any. */
export function matchSudoRule(argv: string[], rules: SudoRule[]): SudoRule | undefined {
  if (argv.length === 0) return undefined
  // No VAR=value before the program: the template keeps no variable
  // (env_keep), so sudo refuses one there.
  const [prog, ...rest] = argv
  const args = rest.join(' ')

  return rules.find(r => {
    if (prog !== r.path && prog !== r.path.split('/').pop()) return false
    if (r.args === '') return args === ''

    return new RegExp(r.args).test(args)
  })
}

/** One message per `sudo -n` invocation of a resolved command no rule allows. */
export function verifySudo(cmd: string, rules: SudoRule[]): string[] {
  return sudoSegments(cmd)
    .filter(argv => !matchSudoRule(argv, rules))
    .map(argv => `no sudo rule allows "${argv.join(' ')}"`)
}
