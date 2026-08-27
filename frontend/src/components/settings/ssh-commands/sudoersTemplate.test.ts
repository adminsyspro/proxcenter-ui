import { describe, expect, it } from 'vitest'

import { buildInstallCommand, buildSudoersTemplate, type AllowlistCategoryShape } from './sudoersTemplate'

const cmd = (prefix: string, executablePath?: string): AllowlistCategoryShape['commands'][number] => ({
  prefix,
  executablePath,
  category: 'x',
  description: '',
  usedBy: ''
})

const categories: AllowlistCategoryShape[] = [
  {
    id: 'node-management',
    label: 'Node management',
    description: '',
    commands: [
      cmd('ha-manager crm-command node-maintenance', '/usr/sbin/ha-manager'),
      cmd('apt-get ', '/usr/bin/apt-get'),
      cmd('ha-manager status', '/usr/sbin/ha-manager')
    ]
  },
  {
    id: 'network-flows',
    label: 'Network flows',
    description: '',
    commands: [cmd('for br in $(ovs-vsctl list-br)'), cmd('ovs-vsctl ', '/usr/bin/ovs-vsctl')]
  }
]

describe('buildSudoersTemplate', () => {
  it('emits one NOPASSWD rule per category with unique, sorted executable paths', () => {
    const { body } = buildSudoersTemplate(categories)
    expect(body).toContain('Defaults:proxcenter !requiretty')
    expect(body).toContain('# Node management\nproxcenter ALL=(ALL) NOPASSWD: /usr/bin/apt-get, /usr/sbin/ha-manager')
    expect(body).toContain('# Network flows\nproxcenter ALL=(ALL) NOPASSWD: /usr/bin/ovs-vsctl')
  })

  it('counts shell-wrapped prefixes and adds the scoped /bin/sh rule only when there are some', () => {
    const withShell = buildSudoersTemplate(categories)
    expect(withShell.shellWrappedCount).toBe(1)
    expect(withShell.body).toContain('proxcenter ALL=(ALL) NOPASSWD: /bin/sh -c *')

    const withoutShell = buildSudoersTemplate([categories[0]])
    expect(withoutShell.shellWrappedCount).toBe(0)
    expect(withoutShell.body).not.toContain('/bin/sh -c *')
  })

  it('skips a category whose commands are all shell-wrapped', () => {
    const { body } = buildSudoersTemplate([
      { id: 'only-shell', label: 'Only shell', description: '', commands: [cmd('for x in y')] }
    ])
    expect(body).not.toContain('# Only shell')
  })

  it('documents the rolling update requirement as a commented NOPASSWD: ALL line, never an active one', () => {
    const { body } = buildSudoersTemplate(categories)
    const lines = body.split('\n')
    expect(lines).toContain('# proxcenter ALL=(ALL) NOPASSWD: ALL')
    expect(lines).not.toContain('proxcenter ALL=(ALL) NOPASSWD: ALL')
    expect(body).toContain('Rolling updates are run by the orchestrator')
    expect(body).toContain('sudo -n sh -c')
    // The commented rule is the last line: a customer pasting the template
    // sees it right where they would add their own rules.
    expect(lines.at(-1)).toBe('# proxcenter ALL=(ALL) NOPASSWD: ALL')
  })

  it('sanitises newlines in category labels so a label cannot inject a sudoers rule', () => {
    const { body } = buildSudoersTemplate([
      {
        id: 'evil',
        label: 'Evil\nproxcenter ALL=(ALL) NOPASSWD: ALL',
        description: '',
        commands: [cmd('ls', '/bin/ls')]
      }
    ])
    expect(body.split('\n')).not.toContain('proxcenter ALL=(ALL) NOPASSWD: ALL')
    expect(body).toContain('# Evil proxcenter ALL=(ALL) NOPASSWD: ALL')
  })
})

describe('buildInstallCommand', () => {
  it('writes the body through a quoted heredoc, locks the mode and validates with visudo', () => {
    const out = buildInstallCommand('BODY')
    expect(out.startsWith("cat > /etc/sudoers.d/proxcenter <<'EOF'\nBODY\nEOF\n")).toBe(true)
    expect(out).toContain('chmod 440 /etc/sudoers.d/proxcenter')
    expect(out.endsWith('visudo -c -f /etc/sudoers.d/proxcenter')).toBe(true)
  })
})
