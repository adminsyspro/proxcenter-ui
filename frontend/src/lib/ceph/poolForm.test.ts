import { describe, expect, it } from 'vitest'

import { parsePoolCreate, parsePoolUpdate, POOL_DEFAULTS } from './poolForm'

/*
   ui#1450: the parameters of a replicated pool, checked on the server before
   any PVE call. pg_num starts at 32: PVE's default (128) failed in the task
   on the lab's 3 OSDs (mon_max_pg_per_osd 250), measured on 28/11/2026.
*/

const base = { name: 'vm-pool', size: 3, minSize: 2, autoscale: 'on', application: 'rbd', addStorage: true }

describe('parsePoolCreate', () => {
  it('maps a valid body to the PVE parameters, with pg_num 32', () => {
    expect(parsePoolCreate(base)).toEqual({
      ok: true,
      params: {
        name: 'vm-pool', size: '3', min_size: '2', pg_num: '32', pg_autoscale_mode: 'on', application: 'rbd', add_storages: '1',
      },
    })
  })

  it('passes the CRUSH rule and an add_storages of 0', () => {
    const r = parsePoolCreate({ ...base, crushRule: 'replicated_ssd', addStorage: false })
    expect(r).toMatchObject({ ok: true, params: { crush_rule: 'replicated_ssd', add_storages: '0' } })
  })

  it('refuses min_size 1 unless single-copy writes are accepted', () => {
    expect(parsePoolCreate({ ...base, minSize: 1 }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, minSize: 1, allowSingleCopy: true })).toMatchObject({ ok: true, params: { min_size: '1' } })
  })

  it('refuses a min_size above the size, a size above 7 and a bad name', () => {
    expect(parsePoolCreate({ ...base, minSize: 4 }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, size: 8 }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, name: '../x' }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, name: '' }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, name: 'a'.repeat(65) }).ok).toBe(false)
  })

  it('refuses an unknown autoscale mode or application', () => {
    expect(parsePoolCreate({ ...base, autoscale: 'auto' }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, application: 'nfs' }).ok).toBe(false)
  })

  it('takes a target ratio or a target size, never both', () => {
    expect(parsePoolCreate({ ...base, targetRatio: 0.2, targetSizeGiB: 10 }).ok).toBe(false)
    expect(parsePoolCreate({ ...base, targetRatio: 0.2 })).toMatchObject({ ok: true, params: { target_size_ratio: '0.2' } })
    expect(parsePoolCreate({ ...base, targetSizeGiB: 100 })).toMatchObject({ ok: true, params: { target_size: '107374182400' } })
    expect(parsePoolCreate({ ...base, targetRatio: 1.5 }).ok).toBe(false)
  })

  it('refuses a CRUSH rule name with shell or path characters', () => {
    expect(parsePoolCreate({ ...base, crushRule: 'rule;reboot' }).ok).toBe(false)
  })

  it('accepts the defaults as they are', () => {
    expect(parsePoolCreate({ ...POOL_DEFAULTS, name: 'p1' }).ok).toBe(true)
    expect(POOL_DEFAULTS).toMatchObject({ size: 3, minSize: 2, autoscale: 'on', application: 'rbd', addStorage: true })
  })
})

describe('parsePoolUpdate', () => {
  it('keeps the editable fields only', () => {
    const r = parsePoolUpdate({ ...base, size: 2, minSize: 2, crushRule: 'replicated_rule', targetRatio: 0.1 })
    expect(r).toEqual({
      ok: true,
      params: { size: '2', min_size: '2', pg_autoscale_mode: 'on', crush_rule: 'replicated_rule', target_size_ratio: '0.1' },
    })
  })

  it('applies the same guards as the creation', () => {
    expect(parsePoolUpdate({ ...base, minSize: 1 }).ok).toBe(false)
    expect(parsePoolUpdate({ ...base, minSize: 3, size: 2 }).ok).toBe(false)
  })
})
