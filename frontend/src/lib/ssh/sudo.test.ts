import { describe, expect, it } from 'vitest'

import { okToStopCommand, groupFlagCommand } from '@/lib/ceph/nodeNoout'
import { buildSSHAuditCommand } from '@/lib/compliance/ssh-checks'
import { buildSFlowConfigureCommand, SFLOW_PROBE_COMMAND } from '@/lib/sflow/configure'
import { GUEST_MACS_COMMAND } from '@/lib/sflow/guestMacs'

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asRoot, buildSudoCheckCommand, FRONTEND_SUDO_RULES, hasSudoMark, matchSudoRule, parseSudoCheck,
  profileState, resolveSudo, sudoSegments, type SudoRule, verifySudo,
  pinSFlowCollector,
  SFLOW_MIN_SAMPLING,
  APT_DIST_UPGRADE,
} from './sudo'

describe('resolveSudo', () => {
  it('turns each mark into sudo -n for a sudo account and drops it for root', () => {
    const cmd = `${asRoot('qm unlock 100')} && ${asRoot('pct unlock 101')}`

    expect(resolveSudo(cmd, true)).toBe('sudo -n qm unlock 100 && sudo -n pct unlock 101')
    expect(resolveSudo(cmd, false)).toBe('qm unlock 100 && pct unlock 101')
    expect(hasSudoMark(cmd)).toBe(true)
    expect(hasSudoMark(resolveSudo(cmd, true))).toBe(false)
  })
})

describe('sudoSegments', () => {
  it('extracts every sudo -n invocation, inside quotes and command substitutions too', () => {
    expect(sudoSegments(`for br in $(sudo -n ovs-vsctl list-br); do sudo -n ovs-vsctl -- set Bridge $br x; done`))
      .toEqual([['ovs-vsctl', 'list-br'], ['ovs-vsctl', '--', 'set', 'Bridge', '$br', 'x']])
    expect(sudoSegments(`nohup bash -c 'sleep 1 && sudo -n reboot' > /dev/null 2>&1 &`)).toEqual([['reboot']])
    expect(sudoSegments(`echo X | sudo -n tee /var/log/proxcenter-upgrade.status > /dev/null`))
      .toEqual([['tee', '/var/log/proxcenter-upgrade.status']])
  })
})

// The expressions are run by sudo's POSIX regcomp and by JavaScript here:
// keep them in the syntax both read alike, anchored, and with no class
// admitting a space (an argument holding one would shift the others).
describe('FRONTEND_SUDO_RULES', () => {
  it('are well formed', () => {
    const ids = new Set<string>()

    for (const r of FRONTEND_SUDO_RULES) {
      expect(ids.has(r.id), r.id).toBe(false)
      ids.add(r.id)
      expect(r.path.startsWith('/usr/'), r.id).toBe(true)
      if (r.args === '') continue
      expect(r.args.startsWith('^') && r.args.endsWith('$'), r.id).toBe(true)
      for (const bad of ['\\d', '\\s', '\\w', '(?', '.*', '.+', '#']) expect(r.args.includes(bad), `${r.id} uses ${bad}`).toBe(false)
      expect(/\[[^\]]* [^\]]*\]/.test(r.args), `${r.id} admits a space`).toBe(false)
      // A backslash inside brackets is literal for POSIX (sudo) but an escape
      // for JavaScript: `[\]]` would mean two different things.
      expect(/\[[^\]]*\\/.test(r.args), `${r.id} escapes inside a bracket expression`).toBe(false)
      expect(() => new RegExp(r.args), r.id).not.toThrow()
    }
  })

  it('refuse what the commands never send', () => {
    const denied = [
      // A caller-chosen DEBIAN_FRONTEND reaches debconf, which evaluates it.
      'sudo -n DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade',
      "sudo -n env 'DEBIAN_FRONTEND=x; BEGIN { system(1) }' /usr/bin/apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold dist-upgrade",
      'sudo -n env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get -y install foo',
      'sudo -n env -i /bin/sh',
      'sudo -n env DEBIAN_FRONTEND=noninteractive /bin/sh',
      "sudo -n qm unlock '100;id'",
      'sudo -n qm destroy 100',
      'sudo -n reboot -f',
      'sudo -n sh -c id',
      "sudo -n pvesh create /nodes/localhost/qemu/100/monitor --command 'screendump /etc/shadow'",
      'sudo -n tee /etc/sudoers.d/x',
      'sudo -n rm -f /var/log/proxcenter-upgrade.log /etc/shadow',
      "sudo -n grep -H ^net /etc/shadow",
      'sudo -n apt-get install foo',
      'sudo -n LD_PRELOAD=/tmp/x.so apt-get update',
      "sudo -n ovs-vsctl -- --id=@s create sflow target='\"10.0.0.1:6343\"' header=128 sampling=1 polling=1 -- set Bridge vmbr0 sflow=@s -- del-br vmbr0",
    ]

    for (const cmd of denied) expect(verifySudo(cmd, FRONTEND_SUDO_RULES), cmd).not.toEqual([])
  })

  it('tell why a rule is root-equivalent or sensitive, and never both', () => {
    for (const r of FRONTEND_SUDO_RULES) {
      expect(r.rootEquivalent && r.sensitive, r.id).toBeFalsy()
      if (r.rootEquivalent || r.sensitive) expect(r.why?.length, r.id).toBeGreaterThan(0)
    }
    expect(FRONTEND_SUDO_RULES.find(r => r.id === 'ui-sflow-configure')?.sensitive).toBe(true)
  })
})

// Every privileged command the frontend builds outside the migrations,
// resolved for a non-root account, must be allowed by a rule. A new marked
// program without a rule fails here.
describe('frontend privileged commands match the sudo rules', () => {
  const commands: Record<string, string> = {
    unlock: asRoot('qm unlock 100'),
    ctUnlock: asRoot('pct unlock 101'),
    maintenance: asRoot('ha-manager crm-command node-maintenance enable pve1'),
    groupFlag: asRoot(groupFlagCommand('noout', 'pve-2', true)),
    groupFlagOff: asRoot(groupFlagCommand('noin', 'pve3', false)),
    okToStop: okToStopCommand([0, 3, 7]),
    reboot: `nohup bash -c 'sleep 1 && ${asRoot('reboot')}' > /dev/null 2>&1 &`,
    upgrade: `${asRoot('apt-get update')} && ${asRoot(APT_DIST_UPGRADE)} 2>&1 | ${asRoot('tee -a /var/log/proxcenter-upgrade.log')} > /dev/null`,
    screenshot: `trap '${asRoot('rm -f /tmp/pxc-screen-100.ppm')}' EXIT; ${asRoot("pvesh create /nodes/localhost/qemu/100/monitor --command 'screendump /tmp/pxc-screen-100.ppm'")} > /dev/null 2>&1 && ${asRoot('base64 -w0 /tmp/pxc-screen-100.ppm')}`,
    sflowConfigure: buildSFlowConfigureCommand({ collectorTarget: '10.42.0.250:6343', samplingRate: 512, pollingInterval: 30 } as any, '10.42.0.101'),
    sflowProbe: SFLOW_PROBE_COMMAND,
    guestMacs: GUEST_MACS_COMMAND,
    cis: buildSSHAuditCommand(),
  }

  for (const [name, cmd] of Object.entries(commands)) {
    it(name, () => {
      // The loop variable stands for the bridge the shell expands it to.
      const resolved = resolveSudo(cmd, true).replaceAll('$br', 'vmbr0')

      expect(sudoSegments(resolved).length, 'runs something as root').toBeGreaterThan(0)
      expect(verifySudo(resolved, FRONTEND_SUDO_RULES)).toEqual([])
      expect(resolved).not.toMatch(/sudo (-n )?sh -c/)
    })
  }

  it('the guest MAC map passes concrete paths and unmatched globs alike', () => {
    expect(verifySudo('sudo -n grep -H ^net /etc/pve/nodes/pve1/qemu-server/100.conf /etc/pve/nodes/pve2/lxc/201.conf', FRONTEND_SUDO_RULES)).toEqual([])
    expect(verifySudo('sudo -n grep -H ^net /etc/pve/nodes/*/qemu-server/*.conf /etc/pve/nodes/*/lxc/*.conf', FRONTEND_SUDO_RULES)).toEqual([])
  })
})

describe('sFlow collector pinning', () => {
  const configure = (target: string, sampling = 512) =>
    `sudo -n ovs-vsctl -- --id=@s create sflow target='"${target}"' header=128 sampling=${sampling} polling=30 -- set Bridge vmbr0 sflow=@s`

  it('admits any collector while none is saved, and says so', () => {
    const open = FRONTEND_SUDO_RULES.find(r => r.id === 'ui-sflow-configure')!

    expect(open.sensitive).toBe(true)
    expect(verifySudo(configure('203.0.113.9:6343'), FRONTEND_SUDO_RULES)).toEqual([])
    expect(pinSFlowCollector(FRONTEND_SUDO_RULES, null)).toBe(FRONTEND_SUDO_RULES)
    expect(pinSFlowCollector(FRONTEND_SUDO_RULES, "10.0.0.1:6343'; id")).toBe(FRONTEND_SUDO_RULES)
  })

  it('refuses a sampling rate under 1 in 64, pinned or not', () => {
    for (const rules of [FRONTEND_SUDO_RULES, pinSFlowCollector(FRONTEND_SUDO_RULES, '10.42.0.2:6343')]) {
      for (const rate of [1, 8, 32, 63]) expect(verifySudo(configure('10.42.0.2:6343', rate), rules), `rate ${rate}`).not.toEqual([])
      for (const rate of [SFLOW_MIN_SAMPLING, 99, 100, 512, 4096, 1_000_000_000]) expect(verifySudo(configure('10.42.0.2:6343', rate), rules), `rate ${rate}`).toEqual([])
    }
  })

  it('admits only the saved collector once pinned, and is no longer sensitive', () => {
    const pinned = pinSFlowCollector(FRONTEND_SUDO_RULES, '10.42.0.2:6343')
    const rule = pinned.find(r => r.id === 'ui-sflow-configure')!

    expect(rule.sensitive).toBe(false)
    expect(rule.why).toBeUndefined()
    expect(verifySudo(configure('10.42.0.2:6343'), pinned)).toEqual([])
    for (const other of ['203.0.113.9:6343', '10.42.0.2:6344', '10x42.0.2:6343', '10.42.0.2:63430'])
      expect(verifySudo(configure(other), pinned), other).not.toEqual([])
    expect(new RegExp(rule.args).test(rule.example!)).toBe(true)
    expect(pinned.filter(r => r.id !== 'ui-sflow-configure')).toEqual(FRONTEND_SUDO_RULES.filter(r => r.id !== 'ui-sflow-configure'))
  })

  it('pins a bracketed IPv6 or named collector literally', () => {
    for (const target of ['[fd00::2]:6343', 'collector.lab:6343']) {
      const pinned = pinSFlowCollector(FRONTEND_SUDO_RULES, target)

      expect(verifySudo(configure(target), pinned), target).toEqual([])
      expect(new RegExp(pinned.find(r => r.id === 'ui-sflow-configure')!.args).test(pinned.find(r => r.id === 'ui-sflow-configure')!.example!)).toBe(true)
    }
    expect(verifySudo(configure('collectorXlab:6343'), pinSFlowCollector(FRONTEND_SUDO_RULES, 'collector.lab:6343'))).not.toEqual([])
  })
})

describe('rule examples', () => {
  it('each example is allowed by its own rule, and only by rules of its profile', () => {
    for (const r of FRONTEND_SUDO_RULES) {
      expect(typeof r.example, r.id).toBe('string')
      expect(r.example!.includes("'") || r.example!.includes('  ') || r.example!.trim() !== r.example, r.id).toBe(false)
      if (r.args === '') {
        expect(r.example, r.id).toBe('')
        continue
      }
      expect(new RegExp(r.args).test(r.example!), `${r.id}: ${r.example}`).toBe(true)
      expect(matchSudoRule([r.path, ...r.example!.split(' ')], FRONTEND_SUDO_RULES)?.profile, r.id).toBe(r.profile)
    }
  })
})

const RULES: SudoRule[] = [
  { id: 'a', profile: 'node-ops', path: '/usr/sbin/qm', args: '^unlock [0-9]+$', usedBy: 'Unlock', example: 'unlock 100' },
  { id: 'b', profile: 'node-ops', path: '/usr/bin/ceph', args: '^osd set noout$', usedBy: 'Ceph noout', example: 'osd set noout' },
  { id: 'c', profile: 'site-recovery', path: '/usr/sbin/zfs', args: '^snapshot [a-z/@]+$', usedBy: 'ZFS', example: 'snapshot a/b@c' },
  { id: 'old', profile: 'site-recovery', path: '/usr/sbin/zfs', args: '^list$', usedBy: 'Older orchestrator' },
]

describe('sudoers check', () => {
  it('asks sudo -l about each example, word by word, and about migrations', () => {
    const cmd = buildSudoCheckCommand(RULES)

    expect(cmd).toContain("pxc_r 'a' '/usr/sbin/qm' 'unlock' '100'")
    expect(cmd).toContain("pxc_r 'c' '/usr/sbin/zfs' 'snapshot' 'a/b@c'")
    expect(cmd).toContain("pxc_r pxc-migrations '/bin/sh' '-c' 'true'")
    expect(cmd).not.toContain("pxc_r 'old'")
    expect(cmd).toContain('sudo -n -l "$@"')
  })

  it('quotes a word holding a quote', () => {
    const cmd = buildSudoCheckCommand([{ ...RULES[0], id: 'q', example: `target="x" it's` }])

    expect(cmd).toContain(`'target="x"' 'it'\\''s'`)
  })

  it('reads sudo missing, no rights and a version too old', () => {
    expect(parseSudoCheck('PXC_SUDO_VERSION:none', RULES).status).toBe('missing')
    expect(parseSudoCheck('PXC_SUDO_VERSION:Sudo version 1.9.16p2\nPXC_SUDO_NORIGHTS', RULES)).toEqual({ status: 'no-rights', version: 'Sudo version 1.9.16p2', profiles: {} })
    expect(parseSudoCheck('PXC_SUDO_VERSION:Sudo version 1.9.5p2\nPXC_RULE:a:no', RULES).status).toBe('too-old')
    expect(parseSudoCheck('PXC_SUDO_VERSION:Sudo version 1.9.10\nPXC_RULE:a:yes', RULES).status).toBe('ok')
    expect(parseSudoCheck('PXC_SUDO_VERSION:Sudo version 1.10.0\nPXC_RULE:a:yes', RULES).status).toBe('ok')
  })

  it('counts the rules per profile, leaving out programs the node lacks', () => {
    const check = parseSudoCheck([
      'PXC_SUDO_VERSION:Sudo version 1.9.16p2',
      'PXC_RULE:a:yes', 'PXC_RULE:b:na', 'PXC_RULE:c:no', 'PXC_RULE:pxc-migrations:no',
    ].join('\n'), RULES)

    expect(check.profiles['node-ops']).toEqual({ checked: 1, missing: [] })
    expect(check.profiles['site-recovery']).toEqual({ checked: 1, missing: [{ id: 'c', usedBy: 'ZFS' }] })
    expect(profileState(check.profiles['node-ops'])).toBe('granted')
    expect(profileState(check.profiles['site-recovery'])).toBe('none')
    expect(profileState(check.profiles.migrations)).toBe('none')
    expect(profileState({ checked: 3, missing: [{ id: 'x', usedBy: '' }] })).toBe('partial')
    expect(profileState(undefined)).toBe('unknown')
  })

  // The script itself, run by a real shell against a fake sudo that allows
  // only `qm unlock 100`: what reaches sudo must be the path and the example
  // words, unchanged.
  it('runs in a POSIX shell and reports what sudo answers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxc-sudo-'))
    const sudo = join(dir, 'sudo')
    const qm = join(dir, 'qm')

    writeFileSync(sudo, '#!/bin/sh\n[ "$1" = "-V" ] && { echo "Sudo version 1.9.16p2"; exit 0; }\n[ "$#" -eq 2 ] && exit 0\nshift 2\n[ "$*" = "' + qm + ' unlock 100" ]\n')
    writeFileSync(qm, '#!/bin/sh\n')
    chmodSync(sudo, 0o755)
    chmodSync(qm, 0o755)
    const rules: SudoRule[] = [
      { ...RULES[0], path: qm },
      { ...RULES[0], id: 'a2', path: qm, example: 'unlock 101' },
      { ...RULES[1], path: join(dir, 'absent') },
    ]
    const out = execFileSync('/bin/sh', ['-c', buildSudoCheckCommand(rules)], { env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` } }).toString()
    const check = parseSudoCheck(out, rules)

    expect(check.status).toBe('ok')
    expect(check.profiles['node-ops']).toEqual({ checked: 2, missing: [{ id: 'a2', usedBy: 'Unlock' }] })
    expect(out).toContain('PXC_RULE:b:na')
  })

  // A rule pinned since the file was written: the node still allows the
  // refused invocation, which the check reports as a file to regenerate.
  it('reports a rule the node allows beyond its pinned arguments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pxc-sudo-'))
    const sudo = join(dir, 'sudo')
    const ovs = join(dir, 'ovs-vsctl')

    // Allows any ovs-vsctl invocation: an old, open sFlow rule.
    writeFileSync(sudo, '#!/bin/sh\n[ "$1" = "-V" ] && { echo "Sudo version 1.9.16p2"; exit 0; }\n[ "$#" -eq 2 ] && exit 0\n[ "$3" = "' + ovs + '" ]\n')
    writeFileSync(ovs, '#!/bin/sh\n')
    chmodSync(sudo, 0o755)
    chmodSync(ovs, 0o755)
    const rules = pinSFlowCollector(FRONTEND_SUDO_RULES, '10.42.0.2:6343')
      .filter(r => r.id === 'ui-sflow-configure')
      .map(r => ({ ...r, path: ovs }))
    const command = buildSudoCheckCommand(rules)

    expect(command).toContain(`pxc_n 'ui-sflow-configure' '${ovs}' '--' '--id=@s' 'create' 'sflow' 'target="203.0.113.1:6343"'`)
    const out = execFileSync('/bin/sh', ['-c', command], { env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` } }).toString()
    const check = parseSudoCheck(out, rules)

    expect(check.profiles['node-ops']).toEqual({ checked: 1, missing: [] })
    expect(check.tooOpen).toEqual([{ id: 'ui-sflow-configure', usedBy: 'Network Flows > Configure sFlow' }])
  })

  it('flags a sudoers file that keeps DEBIAN_FRONTEND', () => {
    const command = buildSudoCheckCommand(FRONTEND_SUDO_RULES)

    expect(command).toContain("grep -q 'env_keep.*DEBIAN_FRONTEND' && echo PXC_OPEN:pxc-env-keep")
    const base = 'PXC_SUDO_VERSION:Sudo version 1.9.16p2\nPXC_OPEN:pxc-env-keep\n'

    expect(parseSudoCheck(`${base}PXC_RULE:pxc-migrations:no`, FRONTEND_SUDO_RULES).tooOpen).toEqual([{ id: 'pxc-env-keep', usedBy: 'env_keep DEBIAN_FRONTEND' }])
    expect(parseSudoCheck(`${base}PXC_RULE:pxc-migrations:yes`, FRONTEND_SUDO_RULES).tooOpen).toBeUndefined()
  })

  it('reports nothing too open for a pinned file, or under the migrations profile', () => {
    const rules = pinSFlowCollector(FRONTEND_SUDO_RULES, '10.42.0.2:6343')
    const base = 'PXC_SUDO_VERSION:Sudo version 1.9.16p2\nPXC_RULE:ui-sflow-configure:yes\n'

    expect(parseSudoCheck(`${base}PXC_RULE:pxc-migrations:no`, rules).tooOpen).toBeUndefined()
    expect(parseSudoCheck(`${base}PXC_OPEN:ui-sflow-configure\nPXC_RULE:pxc-migrations:yes`, rules).tooOpen).toBeUndefined()
    expect(parseSudoCheck(`${base}PXC_OPEN:ui-sflow-configure\nPXC_RULE:pxc-migrations:no`, rules).tooOpen).toHaveLength(1)
    expect(buildSudoCheckCommand(FRONTEND_SUDO_RULES)).not.toContain("pxc_n '")
  })
})
