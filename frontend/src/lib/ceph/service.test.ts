import { describe, expect, it } from 'vitest'

import {
  isCephServiceAction,
  isDaemonId,
  osdIdOf,
  parseCephService,
  parseCreateMonBody,
} from './service'

/*
   ui#1164: the grammar of the Ceph service routes, against the PVE 9.2 API
   schema (`pvesh usage`) measured on the lab.
*/

describe('parseCephService', () => {
  it('accepts the names PVE accepts and splits type and id', () => {
    expect(parseCephService('osd.2')).toEqual({ type: 'osd', id: '2' })
    expect(parseCephService('mon.pve1')).toEqual({ type: 'mon', id: 'pve1' })
    expect(parseCephService('mgr.pve-1')).toEqual({ type: 'mgr', id: 'pve-1' })
    expect(parseCephService('mds.a')).toEqual({ type: 'mds', id: 'a' })
  })

  it('refuses what PVE refuses, the whole-node targets (bare osd, ceph), and anything that is not a string', () => {
    for (const bad of ['osd', 'ceph', 'mon', 'ceph.pve1', 'osd.', 'osd.-1', 'osd.2-', 'osd.2;id', 'rgw.a', 'mon.pve1.lab', 'OSD.2', '', 'osd.' + 'a'.repeat(200)]) {
      expect(parseCephService(bad), bad).toBeNull()
    }
    expect(parseCephService(undefined)).toBeNull()
    expect(parseCephService(2)).toBeNull()
    expect(parseCephService({ service: 'osd.2' })).toBeNull()
  })

  it('osdIdOf reads the number of an osd.N and nothing else', () => {
    expect(osdIdOf(parseCephService('osd.12'))).toBe(12)
    expect(osdIdOf(parseCephService('mon.pve1'))).toBeNull()
    expect(osdIdOf(parseCephService('osd.abc'))).toBeNull()
    expect(osdIdOf(null)).toBeNull()
  })

  it('isCephServiceAction and isDaemonId', () => {
    expect(isCephServiceAction('start')).toBe(true)
    expect(isCephServiceAction('restart')).toBe(true)
    expect(isCephServiceAction('reload')).toBe(false)
    expect(isCephServiceAction(undefined)).toBe(false)
    expect(isDaemonId('pve1')).toBe(true)
    expect(isDaemonId('pve-1')).toBe(true)
    expect(isDaemonId('pve1.lab')).toBe(false)
    expect(isDaemonId('-pve')).toBe(false)
    expect(isDaemonId(1)).toBe(false)
  })
})

describe('parseCreateMonBody', () => {
  it('accepts no address, one or several IPs, and refuses anything else', () => {
    expect(parseCreateMonBody(undefined)).toEqual({ ok: true, params: {} })
    expect(parseCreateMonBody({ 'mon-address': '' })).toEqual({ ok: true, params: {} })
    expect(parseCreateMonBody({ 'mon-address': ' , ' })).toEqual({ ok: true, params: {} })
    expect(parseCreateMonBody({ monAddress: '10.42.0.101' })).toEqual({ ok: true, params: { 'mon-address': '10.42.0.101' } })
    expect(parseCreateMonBody({ 'mon-address': '10.42.0.101, fd00::1' })).toEqual({ ok: true, params: { 'mon-address': '10.42.0.101,fd00::1' } })
    expect(parseCreateMonBody({ 'mon-address': 'pve1' }).ok).toBe(false)
    expect(parseCreateMonBody({ 'mon-address': '10.42.0.300' }).ok).toBe(false)
    expect(parseCreateMonBody({ 'mon-address': ['10.42.0.101'] }).ok).toBe(false)
  })
})
