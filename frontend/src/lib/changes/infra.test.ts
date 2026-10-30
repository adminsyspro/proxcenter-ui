import { describe, expect, it } from 'vitest'

import { infraSummary } from './infra'

const words = {
  pending: 'pending',
  disabled: 'disabled',
  from: (host: string) => `from ${host}`,
  times: (count: number) => `×${count}`
}

const added = (values: Record<string, string>) => Object.entries(values).map(([field, newValue]) => ({ field, oldValue: '', newValue }))
const removed = (values: Record<string, string>) => Object.entries(values).map(([field, oldValue]) => ({ field, oldValue, newValue: '' }))

describe('infraSummary', () => {
  it('reads a firewall rule like Proxmox lists it', () => {
    expect(infraSummary('firewall_rule_added', added({ pos: '0', type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', source: '0.0.0.0/0', comment: 'ssh' }), words))
      .toBe('IN ACCEPT tcp 22 · from 0.0.0.0/0 · (ssh)')
    expect(infraSummary('firewall_rule_removed', removed({ type: 'out', macro: 'DNS', enable: '0' }), words)).toBe('OUT DNS · disabled')
  })

  it('lists what changed, the rule position aside', () => {
    const fields = [{ field: 'pos', oldValue: '0', newValue: '0' }, { field: 'dport', oldValue: '22', newValue: '2222' }, { field: 'comment', oldValue: '', newValue: 'ssh' }]

    expect(infraSummary('firewall_rule_changed', fields, words)).toBe('dport 22 → 2222 · comment - → ssh')
    expect(infraSummary('firewall_rules_reordered', [{ field: 'rules', oldValue: '3', newValue: '3' }], words)).toBe('')
  })

  it('reads the other objects by their own fields', () => {
    expect(infraSummary('firewall_ipset_changed', [{ field: 'cidr', oldValue: '', newValue: '!198.51.100.7' }, { field: 'cidr', oldValue: '203.0.113.0/24', newValue: '' }], words))
      .toBe('+!198.51.100.7 · −203.0.113.0/24')
    expect(infraSummary('firewall_alias_added', added({ name: 'lan', cidr: '10.0.0.0/8' }), words)).toBe('10.0.0.0/8')
    expect(infraSummary('acl_added', added({ path: '/', ugid: 'alice@pve', roleid: 'Administrator' }), words)).toBe('alice@pve · Administrator')
    expect(infraSummary('token_added', added({ tokenid: 'backup', privsep: '1', comment: 'nightly' }), words)).toBe('privsep · nightly')
    expect(infraSummary('storage_removed', removed({ type: 'dir', content: 'iso' }), words)).toBe('dir · iso')
    expect(infraSummary('iface_added', added({ type: 'bridge', cidr: '10.0.0.1/24', pending: '1' }), words)).toBe('bridge · 10.0.0.1/24 · pending')
    expect(infraSummary('user_added', added({ userid: 'alice@pve', email: 'alice@example.com' }), words)).toBe('alice@example.com')
  })

  it('counts a burst of failed logins and names where they came from', () => {
    expect(infraSummary('login_failed', added({ user: 'root@pam', rhost: '203.0.113.7', count: '12' }), words)).toBe('×12 · from 203.0.113.7')
    expect(infraSummary(undefined, undefined, words)).toBe('')
  })
})
