import { describe, expect, it } from 'vitest'

import { FRONTEND_SUDO_RULES, SUDO_PROFILES, SUDO_PROFILE_I18N, sudoProfilesFor, type SudoRule } from '@/lib/ssh/sudo'

import { buildInstallCommand, buildProfileSudoersTemplate, profileRules, SETUP_BASH } from './sudoersTemplate'

const orchestratorRules: SudoRule[] = [
  { id: 'apt-update', profile: 'node-ops', path: '/usr/bin/apt-get', args: '^update -qq$', usedBy: '' },
  { id: 'reboot', profile: 'node-ops', path: '/usr/sbin/reboot', args: '', usedBy: '' },
  { id: 'ha', profile: 'node-ops', path: '/usr/sbin/ha-manager', args: '^crm-command node-maintenance (enable|disable) [A-Za-z0-9][A-Za-z0-9.-]*$', usedBy: '' },
  { id: 'sr-zfs', profile: 'site-recovery', path: '/usr/sbin/zfs', args: '^snapshot [a-z/]+@[a-z0-9:-]+$', usedBy: '' },
]
const rules = [...orchestratorRules, ...FRONTEND_SUDO_RULES]

describe('buildProfileSudoersTemplate', () => {
  it('writes one Cmnd_Alias per restricted profile and a rule granting it', () => {
    const body = buildProfileSudoersTemplate(rules, ['node-ops', 'site-recovery'])

    expect(body).toContain('Defaults:proxcenter !requiretty')
    // debconf evaluates DEBIAN_FRONTEND as code: never kept from the caller.
    expect(body).not.toMatch(/env_keep/)
    expect(body).toContain('Cmnd_Alias PXC_NODE_OPS = /usr/bin/apt-get ^update -qq$, \\\n')
    expect(body).toContain('proxcenter ALL=(root) NOPASSWD: PXC_NODE_OPS')
    expect(body).toContain('proxcenter ALL=(root) NOPASSWD: PXC_SITE_RECOVERY')
    expect(body).not.toContain('NOPASSWD: ALL')
    expect(body).not.toContain('/bin/sh')
  })

  it('pins a program taking no argument with the empty-argument form', () => {
    expect(buildProfileSudoersTemplate(rules, ['node-ops'])).toContain('/usr/sbin/reboot ""')
  })

  it('escapes the sudoers separators of an expression but keeps its backslashes', () => {
    const body = buildProfileSudoersTemplate(rules, ['site-recovery'])

    expect(body).toContain('/usr/sbin/zfs ^snapshot [a-z/]+@[a-z0-9\\:-]+$')
    const nodeOps = buildProfileSudoersTemplate(rules, ['node-ops'])

    expect(nodeOps).toContain('Dpkg\\:\\:Options\\:\\:\\=--force-confdef')
    expect(nodeOps).toContain('/tmp/pxc-screen-[0-9]+\\.ppm$')
  })

  it('grants everything for the migrations profile, and says it is equivalent to root', () => {
    const body = buildProfileSudoersTemplate(rules, ['migrations'])

    expect(body).toContain('proxcenter ALL=(ALL) NOPASSWD: ALL')
    expect(body).toContain('equivalent to root')
    expect(body).not.toContain('Cmnd_Alias')
  })

  it('lists a rule shared by both sides once', () => {
    const dup = [...rules, { ...orchestratorRules[0], id: 'dup' }]

    expect(profileRules(dup, 'node-ops').filter(r => r.args === '^update -qq$')).toHaveLength(1)
  })
})

describe('buildInstallCommand', () => {
  it('wraps the body in a heredoc, fixes the mode and validates it', () => {
    const cmd = buildInstallCommand('X')

    expect(cmd).toContain("cat > /etc/sudoers.d/proxcenter <<'EOF'\nX\nEOF")
    expect(cmd).toContain('chmod 440 /etc/sudoers.d/proxcenter')
    expect(cmd).toContain('visudo -c -f /etc/sudoers.d/proxcenter')
  })
})

describe('SETUP_BASH', () => {
  it('creates the account with a home directory and no longer touches the openvswitch group', () => {
    expect(SETUP_BASH).toContain('adduser --system --home /home/proxcenter')
    expect(SETUP_BASH).not.toContain('openvswitch')
  })
})

describe('backup server profile', () => {
  const pbsRules: SudoRule[] = [
    { id: 'pbs-apt-update', profile: 'pbs-ops', path: '/usr/bin/apt-get', args: '^update -qq$', usedBy: 'Backup server > Updates', example: 'update -qq' },
    { id: 'pbs-manager-read', profile: 'pbs-ops', path: '/usr/sbin/proxmox-backup-manager', args: '^(versions|task list|datastore list) --output-format json$', usedBy: 'Backup server > Updates', example: 'task list --output-format json' },
    { id: 'apt-update', profile: 'node-ops', path: '/usr/bin/apt-get', args: '^update -qq$', usedBy: 'Rolling updates', example: 'update -qq' },
  ]

  it('gets its own alias, holding only its rules', () => {
    const template = buildProfileSudoersTemplate(pbsRules, ['pbs-ops'])

    expect(template).toContain('Cmnd_Alias PXC_PBS_OPS = ')
    expect(template).toContain('/usr/sbin/proxmox-backup-manager ^(versions|task list|datastore list) --output-format json$')
    expect(template).toContain('proxcenter ALL=(root) NOPASSWD: PXC_PBS_OPS')
    expect(template).not.toContain('PXC_NODE_OPS')
  })

  it('is what a backup server is checked against, and a cluster never is', () => {
    expect(sudoProfilesFor('pbs')).toEqual(['pbs-ops'])
    expect(sudoProfilesFor('pve')).toEqual(['node-ops', 'site-recovery', 'migrations'])
    expect(sudoProfilesFor(undefined)).not.toContain('pbs-ops')
    expect(profileRules(pbsRules, 'pbs-ops').map(r => r.id)).toEqual(['pbs-apt-update', 'pbs-manager-read'])
  })
})

// The firewall log forwarder (micro-segmentation, forwarder mode) is
// installed by a dedicated profile an administrator grants on purpose.
describe('the log forwarder profile', () => {
  const forwarderRules: SudoRule[] = [
    { id: 'logfwd-install', profile: 'log-forwarder', path: '/usr/bin/install', args: '^-D -m (0755|0644|0600) -o root -g root /dev/stdin (/usr/local/lib/proxcenter/pxc-logfwd|/etc/proxcenter/logfwd\\.conf)$', usedBy: 'Connection > Logs', example: '-D -m 0600 -o root -g root /dev/stdin /etc/proxcenter/logfwd.conf' },
    { id: 'logfwd-systemctl', profile: 'log-forwarder', path: '/usr/bin/systemctl', args: '^(daemon-reload|(enable|restart|disable --now) proxcenter-logfwd\\.service)$', usedBy: 'Connection > Logs', example: 'restart proxcenter-logfwd.service' },
    { id: 'apt-update', profile: 'node-ops', path: '/usr/bin/apt-get', args: '^update -qq$', usedBy: 'Rolling updates', example: 'update -qq' },
  ]

  it('gets its own alias, holding only its rules', () => {
    const template = buildProfileSudoersTemplate(forwarderRules, ['log-forwarder'])

    expect(template).toContain('Cmnd_Alias PXC_LOG_FORWARDER = ')
    expect(template).toContain('/usr/bin/systemctl ^(daemon-reload|(enable|restart|disable --now) proxcenter-logfwd\\.service)$')
    expect(template).toContain('proxcenter ALL=(root) NOPASSWD: PXC_LOG_FORWARDER')
    expect(template).not.toContain('PXC_NODE_OPS')
  })

  it('is never part of what Test SSH checks: a cluster that reads its logs through the API does not need it', () => {
    expect(sudoProfilesFor('pve')).toEqual(['node-ops', 'site-recovery', 'migrations'])
    expect(sudoProfilesFor('pbs')).toEqual(['pbs-ops'])
    expect(SUDO_PROFILES).toContain('log-forwarder')
    expect(SUDO_PROFILE_I18N['log-forwarder']).toBe('logForwarder')
  })
})
