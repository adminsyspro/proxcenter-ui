import { describe, expect, it } from 'vitest'

import {
  DASHBOARD_FILE_KIND,
  DASHBOARD_FILE_VERSION,
  clampToGrid,
  parseDashboardFile,
  portSettings,
  resolveImportName,
  serializeDashboards,
} from './layoutTransfer'

const allowAll = () => true

let seq = 0

const generateId = () => `gen-${++seq}`

const options = (over: Partial<Parameters<typeof parseDashboardFile>[1]> = {}) => ({
  isWidgetAllowed: allowAll,
  knownConnectionIds: new Set<string>(['conn-a']),
  generateId,
  ...over,
})

const file = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    kind: DASHBOARD_FILE_KIND,
    version: DASHBOARD_FILE_VERSION,
    exportedAt: '2026-09-11T06:00:00.000Z',
    dashboards: [{ name: 'Site A', widgets: [{ id: 'w1', type: 'kpi-vms', x: 0, y: 0, w: 2, h: 3 }] }],
    ...over,
  })

describe('serializeDashboards', () => {
  it('stamps the envelope readers check before importing', () => {
    const out = serializeDashboards(
      [{ name: 'Site A', widgets: [{ type: 'kpi-vms' }] }],
      new Date('2026-09-11T06:00:00Z')
    )

    expect(out.kind).toBe(DASHBOARD_FILE_KIND)
    expect(out.version).toBe(DASHBOARD_FILE_VERSION)
    expect(out.exportedAt).toBe('2026-09-11T06:00:00.000Z')
  })

  it('carries every dashboard in one file, in order', () => {
    const out = serializeDashboards([
      { name: 'Site A', widgets: [{ type: 'kpi-vms' }] },
      { name: 'Ops', widgets: [{ type: 'kpi-lxc' }, { type: 'kpi-alerts' }] },
    ])

    expect(out.dashboards.map(d => d.name)).toEqual(['Site A', 'Ops'])
    expect(out.dashboards[1].widgets).toHaveLength(2)
  })

  it('copies the widgets so a later edit cannot reach the exported file', () => {
    const widget = { type: 'kpi-vms', settings: { a: 1 } }
    const out = serializeDashboards([{ name: 'D', widgets: [widget] }])

    widget.type = 'mutated'
    expect(out.dashboards[0].widgets[0].type).toBe('kpi-vms')
  })

  it('survives a dashboard whose widgets never loaded', () => {
    const out = serializeDashboards([{ name: 'D', widgets: undefined as never }])

    expect(out.dashboards[0].widgets).toEqual([])
  })
})

describe('parseDashboardFile rejections', () => {
  it.each([
    ['not JSON at all', 'this is not json', 'invalid-json'],
    ['a JSON array', '[]', 'not-a-dashboard'],
    ['someone else’s JSON', '{"foo":1}', 'not-a-dashboard'],
    ['a dashboards field that is not a list', file({ dashboards: 'nope' }), 'not-a-dashboard'],
    ['a future schema', file({ version: 99 }), 'unsupported-version'],
  ])('refuses %s', (_label, raw, reason) => {
    const result = parseDashboardFile(raw as string, options())

    expect(result).toEqual({ ok: false, reason })
  })

  it('refuses a file whose every widget was dropped rather than creating empty dashboards', () => {
    const result = parseDashboardFile(file(), options({ isWidgetAllowed: () => false }))

    expect(result).toEqual({ ok: false, reason: 'no-widgets' })
  })
})

describe('parseDashboardFile across several dashboards', () => {
  it('imports every dashboard the file carries', () => {
    const raw = file({
      dashboards: [
        { name: 'Site A', widgets: [{ type: 'kpi-vms' }] },
        { name: 'Ops', widgets: [{ type: 'kpi-lxc' }] },
      ],
    })

    const result = parseDashboardFile(raw, options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards.map(d => d.name)).toEqual(['Site A', 'Ops'])
  })

  it('skips a dashboard left with no widget but keeps the others', () => {
    const raw = file({
      dashboards: [
        { name: 'Site A', widgets: [{ type: 'kpi-vms' }] },
        { name: 'Ceph only', widgets: [{ type: 'ceph-status' }] },
      ],
    })

    const result = parseDashboardFile(raw, options({ isWidgetAllowed: t => t !== 'ceph-status' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards.map(d => d.name)).toEqual(['Site A'])
    expect(result.skipped).toBe(1)
    expect(result.dropped).toBe(1)
  })

  it('totals what was left behind across the whole file', () => {
    const raw = file({
      dashboards: [
        { name: 'A', widgets: [{ type: 'kpi-vms' }, { type: 'unknown-1' }] },
        { name: 'B', widgets: [{ type: 'kpi-lxc', settings: { selectedConnections: ['gone'] } }] },
      ],
    })

    const result = parseDashboardFile(raw, options({ isWidgetAllowed: t => !t.startsWith('unknown') }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dropped).toBe(1)
    expect(result.reset).toBe(1)
  })

  it('keeps two dashboards of the same name apart instead of colliding', () => {
    const raw = file({
      dashboards: [
        { name: 'Site A', widgets: [{ type: 'kpi-vms' }] },
        { name: 'Site A', widgets: [{ type: 'kpi-lxc' }] },
      ],
    })

    const result = parseDashboardFile(raw, options({ takenNames: ['Site A'] }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards.map(d => d.name)).toEqual(['Site A (imported)', 'Site A (imported 2)'])
  })

  it('skips a malformed entry without losing the rest of the file', () => {
    const raw = file({ dashboards: [null, { name: 'Ops', widgets: [{ type: 'kpi-vms' }] }] })
    const result = parseDashboardFile(raw, options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards.map(d => d.name)).toEqual(['Ops'])
    expect(result.skipped).toBe(1)
  })
})

describe('parseDashboardFile widget filtering', () => {
  it('drops a widget type this install does not know and counts it', () => {
    const raw = file({
      dashboards: [{ name: 'A', widgets: [{ type: 'kpi-vms' }, { type: 'widget-from-the-future' }] }],
    })

    const result = parseDashboardFile(raw, options({ isWidgetAllowed: t => t === 'kpi-vms' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards[0].widgets).toHaveLength(1)
    expect(result.dashboards[0].dropped).toBe(1)
  })

  it('drops a widget RBAC hides from this user, so an import is not a way around the overrides', () => {
    const raw = file({
      dashboards: [{ name: 'A', widgets: [{ type: 'kpi-vms' }, { type: 'ceph-status' }] }],
    })

    const result = parseDashboardFile(raw, options({ isWidgetAllowed: t => t !== 'ceph-status' }))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards[0].widgets.map(w => w.type)).toEqual(['kpi-vms'])
  })

  it('drops a malformed widget instead of importing one with no type', () => {
    const raw = file({ dashboards: [{ name: 'A', widgets: [null, { x: 1 }, { type: 'kpi-vms' }] }] })
    const result = parseDashboardFile(raw, options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards[0].widgets).toHaveLength(1)
    expect(result.dashboards[0].dropped).toBe(2)
  })

  it('gives every imported widget a fresh id, so it cannot collide with a live one', () => {
    const raw = file({
      dashboards: [{ name: 'A', widgets: [{ id: 'w1', type: 'kpi-vms' }, { id: 'w1', type: 'kpi-lxc' }] }],
    })

    const result = parseDashboardFile(raw, options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const ids = result.dashboards[0].widgets.map(w => w.id)

    expect(new Set(ids).size).toBe(2)
    expect(ids).not.toContain('w1')
  })
})

describe('portSettings', () => {
  const known = new Set(['conn-a', 'conn-b'])

  it('keeps the connections the target install has', () => {
    const { settings, changed } = portSettings({ selectedConnections: ['conn-a'] }, known)

    expect(settings).toEqual({ selectedConnections: ['conn-a'] })
    expect(changed).toBe(false)
  })

  it('keeps the half of a selection that resolves and reports the loss', () => {
    const { settings, changed } = portSettings({ selectedConnections: ['conn-a', 'conn-gone'] }, known)

    expect(settings).toEqual({ selectedConnections: ['conn-a'] })
    expect(changed).toBe(true)
  })

  it('removes a selector nothing resolves, which is how a widget falls back to all', () => {
    const { settings, changed } = portSettings({ selectedConnections: ['conn-gone'] }, known)

    expect(settings).toBeUndefined()
    expect(changed).toBe(true)
  })

  it('reads a node selector by its connection half', () => {
    const { settings } = portSettings({ selectedNodes: ['conn-a:pve1', 'conn-gone:pve1'] }, known)

    expect(settings).toEqual({ selectedNodes: ['conn-a:pve1'] })
  })

  it('treats selectedClusters as connection ids too', () => {
    const { settings } = portSettings({ selectedClusters: ['conn-b', 'conn-gone'] }, known)

    expect(settings).toEqual({ selectedClusters: ['conn-b'] })
  })

  it('drops the unfolded-rows state, which describes a tree the target does not have', () => {
    const { settings } = portSettings({ expanded: ['conn-a:pve1'], title: 'General' }, known)

    expect(settings).toEqual({ title: 'General' })
  })

  it('leaves a setting that names nothing in the environment alone', () => {
    const { settings, changed } = portSettings({ title: 'Cluster / Ceph' }, known)

    expect(settings).toEqual({ title: 'Cluster / Ceph' })
    expect(changed).toBe(false)
  })
})

describe('parseDashboardFile settings porting', () => {
  it('counts the widgets whose selectors named a connection this install lacks', () => {
    const raw = file({
      dashboards: [
        {
          name: 'A',
          widgets: [
            { type: 'zfs-arc', settings: { selectedConnections: ['conn-from-site-b'] } },
            { type: 'kpi-vms', settings: { selectedConnections: ['conn-a'] } },
          ],
        },
      ],
    })

    const result = parseDashboardFile(raw, options())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.dashboards[0].reset).toBe(1)
    expect(result.dashboards[0].widgets[0].settings).toBeUndefined()
    expect(result.dashboards[0].widgets[1].settings).toEqual({ selectedConnections: ['conn-a'] })
  })
})

describe('clampToGrid', () => {
  it('pulls a widget wider than the grid back inside it', () => {
    expect(clampToGrid({ type: 'x', x: 0, y: 0, w: 40, h: 2 })).toMatchObject({ w: 12, x: 0 })
  })

  it('slides a widget starting past the last column back into view', () => {
    expect(clampToGrid({ type: 'x', x: 30, y: 0, w: 3, h: 2 })).toMatchObject({ x: 9, w: 3 })
  })

  it('replaces a missing or absurd geometry with a usable one', () => {
    expect(clampToGrid({ type: 'x' })).toMatchObject({ x: 0, y: 0, w: 1, h: 1 })
    expect(clampToGrid({ type: 'x', x: -5, y: -5, w: 0, h: 0 })).toMatchObject({
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    })
  })
})

describe('resolveImportName', () => {
  it('keeps the exported name when nothing holds it', () => {
    expect(resolveImportName('Site A', ['Default'])).toBe('Site A')
  })

  it('never overwrites an existing dashboard', () => {
    expect(resolveImportName('Site A', ['Site A'])).toBe('Site A (imported)')
    expect(resolveImportName('Site A', ['Site A', 'Site A (imported)'])).toBe('Site A (imported 2)')
  })

  it('names a file that carries no name', () => {
    expect(resolveImportName('   ', [])).toBe('imported')
  })

  it('uses the caller’s word, so the name is not English in a French UI', () => {
    expect(resolveImportName('Site A', ['Site A'], 'importé')).toBe('Site A (importé)')
    expect(resolveImportName('Site A', ['Site A', 'Site A (importé)'], 'importé')).toBe('Site A (importé 2)')
  })
})
