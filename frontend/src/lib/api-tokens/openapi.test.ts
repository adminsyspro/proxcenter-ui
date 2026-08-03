import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './openapi'
import { PUBLIC_API_ALLOWLIST } from './allowlist'

const doc = buildOpenApiDocument() as any

describe('buildOpenApiDocument', () => {
  it('declares OpenAPI 3.1 and the bearer security scheme', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('ProxCenter public read-only API')
    expect(doc.components.securitySchemes.bearerAuth).toEqual({
      type: 'http', scheme: 'bearer', description: expect.stringContaining('pxc_'),
    })
    expect(doc.security).toEqual([{ bearerAuth: [] }])
  })

  it('emits one GET operation per allowlist entry, keyed by the OpenAPI pattern', () => {
    expect(Object.keys(doc.paths).sort()).toEqual(PUBLIC_API_ALLOWLIST.map(e => e.pattern).sort())
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const op = doc.paths[entry.pattern].get
      expect(op.operationId).toBe(entry.id)
      expect(op.summary).toBe(entry.summary)
      expect(op['x-required-scopes']).toEqual(entry.requiredScopes)
      expect(Object.keys(op.responses).sort()).toEqual(['200', '401', '403', '405', '429'])
    }
  })

  it('declares the dynamic segment as a required path parameter', () => {
    const params = doc.paths['/api/v1/pbs/{id}/backups'].get.parameters
    expect(params).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'datastore', in: 'query', required: false }),
    ]))
  })

  it('carries the exact error bodies of the spec', () => {
    const responses = doc.paths['/api/v1/vms'].get.responses
    expect(responses['401'].content['application/json'].example).toEqual({
      error: 'Invalid or expired API token',
    })
    expect(responses['405'].content['application/json'].example).toEqual({
      error: 'API tokens are read-only', method: 'POST',
    })
    expect(responses['429'].content['application/json'].example).toEqual({
      error: 'Rate limit exceeded', retryAfter: 42,
    })
    expect(responses['403'].content['application/json'].example).toEqual({
      error: 'Route not available to API tokens', route: '/api/v1/vms',
    })
  })

  it('uses text/plain for the Prometheus exposition and JSON elsewhere', () => {
    expect(doc.paths['/api/v1/public/metrics'].get.responses['200'].content).toHaveProperty('text/plain')
    expect(doc.paths['/api/v1/public/backups'].get.responses['200'].content).toHaveProperty('application/json')
  })
})
