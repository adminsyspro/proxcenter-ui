import { describe, expect, it } from 'vitest'

import { CEPH_PROVISIONING_SUDO_PROFILE, FRONTEND_SUDO_RULES, matchSudoRule, PVE_SUDO_PROFILES, sudoProfilesFor } from '@/lib/ssh/sudo'
import { installArgv, osdCreateArgv, osdDestroyArgv, parseCephInstall, parseOsdCreate } from './pvecephCommands'

/*
   ui#1450: the pveceph commands ProxCenter runs over SSH (PVE refuses OSD
   creation and destruction to an API token; there is no API to install the
   packages). Every argv is allowed by exactly one pinned rule of the
   ceph-provisioning profile, and the rules refuse what the dialogs never send.
*/

const rule = (argv: string[]) => matchSudoRule(argv, FRONTEND_SUDO_RULES)?.id

describe('osd create', () => {
  it('builds the bare command and every option, in the order the rule pins', () => {
    expect(osdCreateArgv({ dev: '/dev/sdb' })).toEqual(['/usr/bin/pveceph', 'osd', 'create', '/dev/sdb'])
    const full = osdCreateArgv({ dev: '/dev/sdb', dbDev: '/dev/nvme0n1', dbSizeGiB: 60, walDev: '/dev/nvme1n1', walSizeGiB: 4, encrypted: true, deviceClass: 'ssd' })
    expect(full).toEqual([
      '/usr/bin/pveceph', 'osd', 'create', '/dev/sdb', '--db_dev', '/dev/nvme0n1', '--db_dev_size', '60',
      '--wal_dev', '/dev/nvme1n1', '--wal_dev_size', '4', '--encrypted', '1', '--crush-device-class', 'ssd',
    ])
    expect(rule(osdCreateArgv({ dev: '/dev/sdb' }))).toBe('ui-ceph-osd-create')
    expect(rule(full)).toBe('ui-ceph-osd-create')
    expect(rule(osdCreateArgv({ dev: '/dev/sdc', dbDev: '/dev/sdd' }))).toBe('ui-ceph-osd-create')
  })

  it('refuses a device outside /dev, with dots, spaces or shell characters', () => {
    for (const dev of ['/dev/../etc/shadow', '/dev/sdb;reboot', '/dev/sd b', 'sdb', '/etc/passwd', '/dev/', '/dev/$(id)']) {
      expect(parseOsdCreate({ dev }).ok, dev).toBe(false)
    }
    expect(parseOsdCreate({ dev: '/dev/sdb', dbDev: '/dev/sdb' }).ok).toBe(false)
  })

  it('checks the sizes, the class and that a size comes with its device', () => {
    expect(parseOsdCreate({ dev: '/dev/sdb', dbSizeGiB: 10 }).ok).toBe(false)
    expect(parseOsdCreate({ dev: '/dev/sdb', dbDev: '/dev/sdc', dbSizeGiB: 0 }).ok).toBe(false)
    expect(parseOsdCreate({ dev: '/dev/sdb', dbDev: '/dev/sdc', dbSizeGiB: 70000 }).ok).toBe(false)
    expect(parseOsdCreate({ dev: '/dev/sdb', deviceClass: 'SSD!' }).ok).toBe(false)
    expect(parseOsdCreate({ dev: '/dev/sdb', dbDev: '/dev/sdc', dbSizeGiB: 60, encrypted: true, deviceClass: 'nvme' }))
      .toEqual({ ok: true, params: { dev: '/dev/sdb', dbDev: '/dev/sdc', dbSizeGiB: 60, encrypted: true, deviceClass: 'nvme' } })
  })
})

describe('osd destroy and install', () => {
  it('builds the commands their rules allow', () => {
    expect(osdDestroyArgv(3, true)).toEqual(['/usr/bin/pveceph', 'osd', 'destroy', '3', '--cleanup', '1'])
    expect(osdDestroyArgv(12, false)).toEqual(['/usr/bin/pveceph', 'osd', 'destroy', '12'])
    expect(rule(osdDestroyArgv(3, true))).toBe('ui-ceph-osd-destroy')
    expect(rule(osdDestroyArgv(12, false))).toBe('ui-ceph-osd-destroy')
    expect(installArgv('tentacle', 'no-subscription')).toEqual(['/usr/bin/pveceph', 'install', '--version', 'tentacle', '--repository', 'no-subscription'])
    expect(rule(installArgv('squid', 'enterprise'))).toBe('ui-ceph-install')
    expect(rule(installArgv('tentacle', 'manual'))).toBe('ui-ceph-install')
  })

  it('parses the install choice', () => {
    expect(parseCephInstall({ version: 'tentacle', repository: 'no-subscription' })).toEqual({ ok: true, params: { version: 'tentacle', repository: 'no-subscription' } })
    expect(parseCephInstall({ version: 'reef', repository: 'no-subscription' }).ok).toBe(false)
    expect(parseCephInstall({ version: 'tentacle', repository: 'test' }).ok).toBe(false)
  })

  it('refuses what the dialogs never send', () => {
    for (const argv of [
      ['/usr/bin/pveceph', 'install', '--version', 'tentacle', '--repository', 'test'],
      ['/usr/bin/pveceph', 'install', '--version', 'tentacle', '--repository', 'no-subscription', '--allow-experimental', '1'],
      ['/usr/bin/pveceph', 'osd', 'create', '/dev/sdb', '--osds-per-device', '4'],
      ['/usr/bin/pveceph', 'osd', 'create', '/dev/sdb;reboot'],
      ['/usr/bin/pveceph', 'osd', 'destroy', '1', '--cleanup', '1', '--force', '1'],
      ['/usr/bin/pveceph', 'pool', 'destroy', 'vm-pool'],
      ['/usr/bin/pveceph', 'purge'],
    ]) expect(rule(argv), argv.join(' ')).toBeUndefined()
  })
})

describe('the ceph-provisioning profile', () => {
  it('holds the three rules, sensitive and explained', () => {
    const rules = FRONTEND_SUDO_RULES.filter(r => r.profile === CEPH_PROVISIONING_SUDO_PROFILE)
    expect(rules.map(r => r.id).sort()).toEqual(['ui-ceph-install', 'ui-ceph-osd-create', 'ui-ceph-osd-destroy'])
    for (const r of rules) {
      expect(r.sensitive, r.id).toBe(true)
      expect(r.why?.length, r.id).toBeGreaterThan(0)
      expect(typeof r.example, r.id).toBe('string')
    }
  })

  it('is granted on purpose: Test SSH does not ask for it', () => {
    expect(PVE_SUDO_PROFILES).not.toContain('ceph-provisioning')
    expect(sudoProfilesFor('pve')).toEqual(['node-ops', 'site-recovery', 'migrations'])
  })
})
