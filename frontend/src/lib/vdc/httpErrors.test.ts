import { describe, expect, it } from 'vitest'

import { mapCreateVdcError, mapEvpnZoneError } from './httpErrors'

describe('mapCreateVdcError', () => {
  it('maps Prisma P2002 (lost race on a DB unique) to 409', () => {
    const e = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    expect(mapCreateVdcError(e)).toEqual({
      status: 409,
      message: 'A vDC already exists for this tenant on this cluster (or its slug is already taken).',
    })
  })

  it('maps the (tenant, connection) guard message to 409', () => {
    const e = new Error('Tenant already has a vDC on this cluster ("ACME — Paris"). One vDC per tenant per cluster.')
    expect(mapCreateVdcError(e)).toEqual({ status: 409, message: e.message })
  })

  it('maps slug conflicts to 409', () => {
    const e = new Error('A vDC with slug "acme-paris" already exists for this tenant')
    expect(mapCreateVdcError(e)).toEqual({ status: 409, message: e.message })
  })

  it('maps provider-tenant and tenant-not-found rejections to 400', () => {
    expect(mapCreateVdcError(new Error('vDCs cannot be created on the provider tenant (default)')).status).toBe(400)
    expect(mapCreateVdcError(new Error('Tenant not found: t9')).status).toBe(400)
  })

  it('falls back to 500 for anything else', () => {
    expect(mapCreateVdcError(new Error('ECONNREFUSED')).status).toBe(500)
  })

  it('maps the not-in-provider-pool guard message to 400', () => {
    const e = new Error(
      'Connection conn-9 is not in the provider pool — vDCs can only be created on provider-pool connections'
    )
    expect(mapCreateVdcError(e)).toEqual({ status: 400, message: e.message })
  })

  it('maps an invalid VLAN pool range to 400', () => {
    const e = new Error('VLAN pool range 0-100 is invalid (bounds 1-4094, start <= end)')
    expect(mapCreateVdcError(e)).toEqual({ status: 400, message: e.message })
  })

  it('maps a cross-vDC VLAN pool overlap to 400 (not the 409 "already exists" bucket)', () => {
    const e = new Error('VLAN pool 150-250 on bridge "vmbr0" overlaps vDC "Acme" (100-200)')
    expect(mapCreateVdcError(e)).toEqual({ status: 400, message: e.message })
  })

  it('maps a VLAN pool shrink-safety rejection to 409', () => {
    const e = new Error('Cannot shrink VLAN pools: VNet "prod-lan" uses tag 150 on bridge "vmbr0"')
    expect(mapCreateVdcError(e)).toEqual({ status: 409, message: e.message })
  })

  it('maps a storage-change-while-assigned rejection to 409, NOT the generic "Storage policy" 400 bucket (Finding I3)', () => {
    const e = new Error('Storage policy storage cannot be changed while assigned to vDCs: "Acme"')
    expect(mapCreateVdcError(e)).toEqual({ status: 409, message: e.message })
  })

  it('still maps a plain "Storage policy" validation message to 400 (ordering non-regression)', () => {
    const e = new Error('Storage policy name is required (1-64 characters)')
    expect(mapCreateVdcError(e)).toEqual({ status: 400, message: e.message })
  })
})

describe('mapEvpnZoneError (#1334)', () => {
  it('maps the module messages to 404, 409, 400, 502 and the lost race to 409', () => {
    expect(mapEvpnZoneError(Object.assign(new Error('unique'), { code: 'P2002' })).status).toBe(409)
    expect(mapEvpnZoneError(new Error('EVPN zone: not found.')).status).toBe(404)
    expect(mapEvpnZoneError(new Error('VNI collision: network not found.')).status).toBe(404)
    expect(mapEvpnZoneError(new Error('EVPN zone: a zone named "x" already exists.')).status).toBe(409)
    expect(mapEvpnZoneError(new Error('EVPN zone: zone "z" still holds 2 VNet(s) on cluster "c".')).status).toBe(409)
    expect(mapEvpnZoneError(new Error('EVPN zone: the VNI range overlaps the range 1-2 of vDC "v".')).status).toBe(409)
    expect(mapEvpnZoneError(new Error('EVPN zone: zone "z" differs on cluster "c" (MTU 1400): fix it in Proxmox.')).status).toBe(409)
    expect(mapEvpnZoneError(new Error('Failed to create SDN zone "z": 400')).status).toBe(502)
    expect(mapEvpnZoneError(new Error('EVPN zone: select at least one cluster.')).status).toBe(400)
    expect(mapEvpnZoneError(new Error('VNI collision: only a VXLAN network carries a VNI.')).status).toBe(400)
    expect(mapEvpnZoneError(Object.assign(new Error('No free VNI left'), { name: 'VniError', status: 409 }))).toEqual({ status: 409, message: 'No free VNI left' })
    expect(mapEvpnZoneError(new Error('ECONNREFUSED')).status).toBe(500)
    expect(mapEvpnZoneError('boom')).toEqual({ status: 500, message: 'boom' })
  })
})
