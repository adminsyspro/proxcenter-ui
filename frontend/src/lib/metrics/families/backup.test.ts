import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildBackupFamilies } from './backup'

const view = {
  guests: [
    { connId: 'a', connectionName: 'Alpha', node: 'n1', vmid: '100', name: 'web', type: 'qemu' },
    { connId: 'a', connectionName: 'Alpha', node: 'n2', vmid: '101', name: 'db', type: 'lxc' },
    { connId: 'a', connectionName: 'Alpha', node: 'n2', vmid: '102', name: 'orphan', type: 'qemu' },
  ],
} as any

const freshness = {
  guests: [
    { connId: 'a', connectionName: 'Alpha', vmid: '100', backupType: 'vm', ageSeconds: 3600, datastore: 'S3manu' },
    { connId: 'a', connectionName: 'Alpha', vmid: '101', backupType: 'ct', ageSeconds: 200000, datastore: 'S3manu' },
    { connId: 'a', connectionName: 'Alpha', vmid: '102', backupType: 'vm', ageSeconds: null, datastore: null },
  ],
  warnings: [],
} as any

describe('buildBackupFamilies', () => {
  it('labels the age series with the node, name and guest type recovered from the fleet view', () => {
    const text = renderExposition(buildBackupFamilies(view, freshness))
    expect(text).toContain('proxcenter_backup_age_seconds{connection="Alpha",node="n1",vmid="100",name="web",type="qemu",datastore="S3manu"} 3600')
  })

  it('uses the guest type, not the PBS backup type, so the label means the same thing everywhere', () => {
    const text = renderExposition(buildBackupFamilies(view, freshness))
    expect(text).toContain('vmid="101",name="db",type="lxc"')
    expect(text).not.toContain('vmid="101",name="db",type="ct"')
  })

  it('still omits an age sample for a guest that has never been backed up', () => {
    const text = renderExposition(buildBackupFamilies(view, freshness))
    const ageLines = text.split(String.fromCharCode(10)).filter(line => line.startsWith('proxcenter_backup_age_seconds{'))
    expect(ageLines).toHaveLength(2)
  })

  /**
   * THE point of this task. A guest with no backup is absent from the age
   * family by design, so before this series existed it could not be counted
   * in PromQL at all, and a compliance dashboard could not answer the only
   * question it exists to answer.
   */
  it('publishes a zero for a guest with no backup, so it can be counted', () => {
    const text = renderExposition(buildBackupFamilies(view, freshness))
    expect(text).toContain('proxcenter_backup_protected{connection="Alpha",node="n2",vmid="102",name="orphan",type="qemu"} 0')
    expect(text).toContain('proxcenter_backup_protected{connection="Alpha",node="n1",vmid="100",name="web",type="qemu"} 1')
  })

  it('covers every guest in the fleet view, protected or not', () => {
    const text = renderExposition(buildBackupFamilies(view, freshness))
    const lines = text.split(String.fromCharCode(10)).filter(line => line.startsWith('proxcenter_backup_protected{'))
    expect(lines).toHaveLength(3)
  })

  /**
   * A freshness entry for a guest the fleet view does not contain means the
   * two caches disagree, which happens while one of them is warming. Such an
   * entry must be dropped rather than emitted with empty node and name
   * labels, which would render as a nameless row on the offenders table.
   */
  it('drops a freshness entry with no matching guest in the fleet view', () => {
    const stale = { guests: [...freshness.guests, { connId: 'a', connectionName: 'Alpha', vmid: '999', backupType: 'vm', ageSeconds: 10, datastore: 'S3manu' }], warnings: [] } as any
    const text = renderExposition(buildBackupFamilies(view, stale))
    expect(text).not.toContain('vmid="999"')
  })
})
