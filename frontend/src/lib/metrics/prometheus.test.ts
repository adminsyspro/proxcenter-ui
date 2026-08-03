import { describe, expect, it } from 'vitest'

import {
  escapeLabelValue, escapeHelpText, renderExposition, familyScope, isFamilyAllowed, METRIC_FAMILY_SCOPES,
} from './prometheus'

describe('escapeLabelValue', () => {
  it('escapes backslash, double quote and newline together', () => {
    expect(escapeLabelValue('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd')
  })

  it('escapes a lone backslash', () => {
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b')
  })

  it('escapes a lone double quote', () => {
    expect(escapeLabelValue('a"b')).toBe('a\\"b')
  })

  it('escapes a lone newline', () => {
    expect(escapeLabelValue('a\nb')).toBe('a\\nb')
  })

  it('leaves a plain value untouched', () => {
    expect(escapeLabelValue('pve-01')).toBe('pve-01')
  })

  it('cannot be used to inject a spurious label: the escaped value stays inside its own quotes', () => {
    // Hostile connection name trying to break out of the label value and
    // append a second, attacker-controlled label.
    const hostile = 'PVE-A" foo="injected'
    const out = renderExposition([
      {
        name: 'proxcenter_node_online',
        help: 'h',
        type: 'gauge',
        samples: [{ name: 'proxcenter_node_online', labels: { connection: hostile }, value: 1 }],
      },
    ])
    expect(out).toBe(
      '# HELP proxcenter_node_online h\n' +
      '# TYPE proxcenter_node_online gauge\n' +
      'proxcenter_node_online{connection="PVE-A\\" foo=\\"injected"} 1\n',
    )
    // Exactly one `{...}` label block: the hostile quote never closes it early.
    expect(out.match(/\{/g)).toHaveLength(1)
  })

  it('escapes backslash before quote/newline so the escaping itself cannot be forged', () => {
    // A value ending in a backslash immediately followed by what would
    // become an unescaped quote if backslash were escaped last.
    expect(escapeLabelValue('a\\"')).toBe('a\\\\\\"')
  })
})

describe('escapeHelpText', () => {
  it('escapes backslash and newline', () => {
    expect(escapeHelpText('a\\b\nc')).toBe('a\\\\b\\nc')
  })

  it('does NOT escape a double quote: HELP text is not quote-delimited, unlike a label value', () => {
    expect(escapeHelpText('says "hello"')).toBe('says "hello"')
  })

  it('leaves a plain value untouched', () => {
    expect(escapeHelpText('Node online state')).toBe('Node online state')
  })
})

describe('renderExposition', () => {
  it('escapes a newline in HELP text so it cannot forge an extra output line', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_node_online',
        help: 'Node online state\nDROP TABLE',
        type: 'gauge',
        samples: [{ name: 'proxcenter_node_online', labels: {}, value: 1 }],
      },
    ])
    const lines = out.split('\n')
    // A raw (unescaped) newline in HELP would split into two physical
    // lines, so the total line count would be 5 instead of 4 (3 real
    // lines + trailing empty from the final \n).
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('# HELP proxcenter_node_online Node online state\\nDROP TABLE')
  })

  it('leaves an unescaped double quote inside HELP text alone', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_up',
        help: 'says "hello"',
        type: 'gauge',
        samples: [{ name: 'proxcenter_up', labels: {}, value: 1 }],
      },
    ])
    expect(out).toContain('# HELP proxcenter_up says "hello"\n')
  })


  it('renders HELP, TYPE and samples, dropping null labels', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_node_online',
        help: 'Node online state (1 online, 0 otherwise)',
        type: 'gauge',
        samples: [
          { name: 'proxcenter_node_online', labels: { connection: 'PVE "A"', node: 'n1', pool: null }, value: 1 },
        ],
      },
    ])
    expect(out).toBe(
      '# HELP proxcenter_node_online Node online state (1 online, 0 otherwise)\n' +
      '# TYPE proxcenter_node_online gauge\n' +
      'proxcenter_node_online{connection="PVE \\"A\\"",node="n1"} 1\n',
    )
  })

  it('drops undefined and empty-string labels the same as null', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_vm_status',
        help: 'h',
        type: 'gauge',
        samples: [
          { name: 'proxcenter_vm_status', labels: { vmid: '100', pool: undefined, tag: '' }, value: 1 },
        ],
      },
    ])
    expect(out).toContain('proxcenter_vm_status{vmid="100"} 1\n')
    expect(out).not.toContain('pool')
    expect(out).not.toContain('tag')
  })

  it('renders a numeric label value as a quoted string', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_vm_status',
        help: 'h',
        type: 'gauge',
        samples: [{ name: 'proxcenter_vm_status', labels: { vmid: 100 }, value: 1 }],
      },
    ])
    expect(out).toContain('proxcenter_vm_status{vmid="100"} 1\n')
  })

  it('omits a family with no sample', () => {
    expect(renderExposition([{ name: 'x', help: 'h', type: 'gauge', samples: [] }])).toBe('')
  })

  it('renders a metric with no label at all', () => {
    const out = renderExposition([
      { name: 'proxcenter_up', help: 'h', type: 'gauge', samples: [{ name: 'proxcenter_up', labels: {}, value: 1 }] },
    ])
    expect(out).toContain('proxcenter_up 1\n')
  })

  it('renders multiple families each with exactly one HELP and one TYPE line, in order', () => {
    const out = renderExposition([
      {
        name: 'proxcenter_node_online',
        help: 'node help',
        type: 'gauge',
        samples: [{ name: 'proxcenter_node_online', labels: {}, value: 1 }],
      },
      {
        name: 'proxcenter_vm_status',
        help: 'vm help',
        type: 'gauge',
        samples: [
          { name: 'proxcenter_vm_status', labels: { vmid: '1' }, value: 1 },
          { name: 'proxcenter_vm_status', labels: { vmid: '2' }, value: 0 },
        ],
      },
    ])
    const helpLines = out.split('\n').filter(l => l.startsWith('# HELP'))
    const typeLines = out.split('\n').filter(l => l.startsWith('# TYPE'))
    expect(helpLines).toEqual(['# HELP proxcenter_node_online node help', '# HELP proxcenter_vm_status vm help'])
    expect(typeLines).toEqual(['# TYPE proxcenter_node_online gauge', '# TYPE proxcenter_vm_status gauge'])
    // node family's block comes entirely before vm family's block.
    expect(out.indexOf('proxcenter_node_online')).toBeLessThan(out.indexOf('proxcenter_vm_status'))
  })

  it('drops an empty family sandwiched between two non-empty families without breaking either', () => {
    const out = renderExposition([
      { name: 'proxcenter_node_online', help: 'h1', type: 'gauge', samples: [{ name: 'proxcenter_node_online', labels: {}, value: 1 }] },
      { name: 'proxcenter_empty', help: 'h2', type: 'gauge', samples: [] },
      { name: 'proxcenter_vm_status', help: 'h3', type: 'gauge', samples: [{ name: 'proxcenter_vm_status', labels: {}, value: 1 }] },
    ])
    expect(out).not.toContain('proxcenter_empty')
    expect(out).toContain('proxcenter_node_online')
    expect(out).toContain('proxcenter_vm_status')
  })

  it('ends non-empty output with exactly one trailing newline', () => {
    const out = renderExposition([
      { name: 'proxcenter_up', help: 'h', type: 'gauge', samples: [{ name: 'proxcenter_up', labels: {}, value: 1 }] },
    ])
    expect(out.endsWith('\n')).toBe(true)
    expect(out.endsWith('\n\n')).toBe(false)
  })
})

describe('family scoping (spec section 8)', () => {
  it('maps each family prefix to its scope', () => {
    expect(METRIC_FAMILY_SCOPES).toEqual({
      proxcenter_node_: 'nodes:read',
      proxcenter_vm_: 'vms:read',
      proxcenter_backup_: 'backups:read',
    })
    expect(familyScope('proxcenter_vm_cpu_usage_ratio')).toBe('vms:read')
    expect(familyScope('proxcenter_backup_age_seconds')).toBe('backups:read')
    expect(familyScope('proxcenter_node_online')).toBe('nodes:read')
    expect(familyScope('proxcenter_unknown_metric')).toBeNull()
  })

  it('a vms:read-only token gets the VM family and not the others', () => {
    expect(isFamilyAllowed('proxcenter_vm_status', ['vms:read'])).toBe(true)
    expect(isFamilyAllowed('proxcenter_node_online', ['vms:read'])).toBe(false)
    expect(isFamilyAllowed('proxcenter_backup_age_seconds', ['vms:read'])).toBe(false)
  })

  it('a token with all three scopes sees all three families, never a 403 signal from this helper', () => {
    const scopes = ['nodes:read', 'vms:read', 'backups:read']
    expect(isFamilyAllowed('proxcenter_node_online', scopes)).toBe(true)
    expect(isFamilyAllowed('proxcenter_vm_status', scopes)).toBe(true)
    expect(isFamilyAllowed('proxcenter_backup_age_seconds', scopes)).toBe(true)
  })

  it('a token with zero relevant scopes is filtered out of every scoped family, still 200-shaped data (no exception thrown)', () => {
    expect(isFamilyAllowed('proxcenter_node_online', [])).toBe(false)
    expect(isFamilyAllowed('proxcenter_vm_status', [])).toBe(false)
    expect(isFamilyAllowed('proxcenter_backup_age_seconds', [])).toBe(false)
  })

  it('an unscoped family is always allowed regardless of the token scopes (no scope requirement)', () => {
    expect(isFamilyAllowed('proxcenter_up', [])).toBe(true)
    expect(isFamilyAllowed('proxcenter_up', ['vms:read'])).toBe(true)
  })
})
