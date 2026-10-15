import { describe, expect, it } from 'vitest'

import { PveLicenseExcludedError } from '@/lib/license/exclusions'

import { licenseExcludedResponse } from './response'

describe('licenseExcludedResponse', () => {
  it('answers 403 with the code for a write refused on an excluded connection', async () => {
    const res = licenseExcludedResponse(new PveLicenseExcludedError('c-1'))!

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'This cluster is outside the license: ProxCenter refuses any change on it.',
      code: 'CONNECTION_LICENSE_EXCLUDED',
    })
  })

  it('leaves every other error to the route', () => {
    expect(licenseExcludedResponse(new Error('PVE 500 /nodes: boom'))).toBeNull()
    expect(licenseExcludedResponse(Object.assign(new Error('x'), { statusCode: 403, code: 'CONNECTION_LICENSE_EXCLUDED' }))).toBeNull()
    expect(licenseExcludedResponse(undefined)).toBeNull()
  })
})
