import { describe, expect, it } from 'vitest'

import { mapCreateVdcError } from './httpErrors'

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
})
