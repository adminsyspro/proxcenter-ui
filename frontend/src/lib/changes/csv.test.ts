import { describe, expect, it } from 'vitest'

import { buildChangesCsv, buildChangesCsvRows, formatFieldDiffs } from './csv'

const labels = {
  headers: ['Date', 'Type', 'ID', 'Name', 'Action', 'User', 'Node', 'Connection', 'Fields', 'Details'],
  resourceType: (type?: string) => (type === 'vm' ? 'VM' : (type ?? '')),
  action: (action?: string) => (action === 'config_changed' ? 'Configuration' : (action ?? '')),
}

const change = (over: Record<string, unknown> = {}) => ({
  timestamp: new Date(2026, 8, 11, 8, 5, 3).toISOString(),
  resourceType: 'vm',
  resourceId: 101,
  resourceName: 'web01',
  action: 'config_changed',
  user: 'root@pam',
  node: 'pve1',
  connectionName: 'PVE-PROD',
  fields: [{ field: 'cores', oldValue: '2', newValue: '4' }],
  ...over,
})

describe('formatFieldDiffs', () => {
  it('writes each diff as field, old and new', () => {
    expect(
      formatFieldDiffs([
        { field: 'cores', oldValue: '2', newValue: '4' },
        { field: 'memory', oldValue: '4096', newValue: '8192' },
      ])
    ).toBe('cores: 2 -> 4; memory: 4096 -> 8192')
  })

  it('writes nothing when a change carries no diff', () => {
    expect(formatFieldDiffs(undefined)).toBe('')
    expect(formatFieldDiffs([])).toBe('')
  })

  it('leaves the missing side empty for an added or removed value', () => {
    expect(formatFieldDiffs([{ field: 'net0', newValue: 'virtio' }])).toBe('net0:  -> virtio')
  })
})

describe('buildChangesCsvRows', () => {
  it('writes one row per change, with the localised labels', () => {
    const rows = buildChangesCsvRows([change()], labels)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([
      '2026-09-11 08:05:03',
      'VM',
      101,
      'web01',
      'Configuration',
      'root@pam',
      'pve1',
      'PVE-PROD',
      1,
      'cores: 2 -> 4',
    ])
  })

  it('falls back to the connection id when the name never came back', () => {
    const rows = buildChangesCsvRows(
      [change({ connectionName: undefined, connectionId: 'conn-a' })],
      labels
    )

    expect(rows[0][7]).toBe('conn-a')
  })

  it('keeps a change with no diff as a row, with a count of zero', () => {
    const rows = buildChangesCsvRows([change({ fields: undefined })], labels)

    expect(rows[0][8]).toBe(0)
    expect(rows[0][9]).toBe('')
  })
})

describe('buildChangesCsv', () => {
  it('quotes a diff holding the separator and a quote, so the row stays one row', () => {
    const csv = buildChangesCsv(
      [change({ fields: [{ field: 'description', oldValue: 'a,b', newValue: 'say "hi"' }] })],
      labels
    )
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('"description: a,b -> say ""hi"""')
  })

  it('emits the header alone when the filters select nothing', () => {
    expect(buildChangesCsv([], labels).split('\r\n')).toHaveLength(1)
  })
})
