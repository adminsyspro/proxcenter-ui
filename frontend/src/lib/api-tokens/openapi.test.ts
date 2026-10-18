import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './openapi'
import { PUBLIC_API_ALLOWLIST, type AllowlistEntry } from './allowlist'
import { RESPONSE_SCHEMAS } from './openapiSchemas'

const doc = buildOpenApiDocument() as any

describe('buildOpenApiDocument', () => {
  it('declares OpenAPI 3.1 and the bearer security scheme', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('ProxCenter public API')
    expect(doc.components.securitySchemes.bearerAuth).toEqual({
      type: 'http', scheme: 'bearer', description: expect.stringContaining('pxc_'),
    })
    expect(doc.security).toEqual([{ bearerAuth: [] }])
  })

  it('emits one operation per allowlist entry, keyed by the OpenAPI pattern and the entry method', () => {
    expect(Object.keys(doc.paths).sort()).toEqual([...new Set(PUBLIC_API_ALLOWLIST.map(e => e.pattern))].sort())
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const op = doc.paths[entry.pattern][entry.method.toLowerCase()]
      expect(op.operationId).toBe(entry.id)
      expect(op.summary).toBe(entry.summary)
      expect(op['x-required-scopes']).toEqual(entry.requiredScopes)
      expect(Object.keys(op.responses).sort()).toEqual(['200', '401', '403', '405', '429'])
    }
  })

  // Scalar renders no custom extension, so x-required-scopes alone would stay
  // invisible in the reference: the description carries it too.
  it('ends every operation description with the scopes it requires', () => {
    for (const entry of PUBLIC_API_ALLOWLIST) {
      const op = doc.paths[entry.pattern][entry.method.toLowerCase()]
      const line = entry.requiredScopes.length
        ? `Required scope: ${entry.requiredScopes.map(scope => `\`${scope}\``).join(' or ')}`
        : 'Required scope: any valid token'
      expect(op.description, entry.id).toBe(entry.description ? `${entry.description}\n\n${line}` : line)
    }
    expect(doc.paths['/api/v1/public/health'].get.description).toMatch(/Required scope: any valid token$/)
  })

  it('declares the dynamic segment as a required path parameter', () => {
    const params = doc.paths['/api/v1/pbs/{id}/backups'].get.parameters
    expect(params).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
      expect.objectContaining({ name: 'datastore', in: 'query', required: false }),
    ]))
  })

  it('tells the HA sid is sent unencoded, an encoded colon being refused', () => {
    const op = doc.paths['/api/v1/connections/{id}/ha/{sid}'].post
    expect(op.description).toContain('sent unencoded (`vm:100`): a percent-encoded `:` (`vm%3A100`) is refused with 401')
    expect(op.parameters.find((p: any) => p.name === 'sid').description).toMatch(/unencoded.*refused \(401\)/)
  })

  it('carries the exact error bodies of the spec', () => {
    const responses = doc.paths['/api/v1/vms'].get.responses
    expect(responses['401'].content['application/json'].example).toEqual({
      error: 'Invalid or expired API token',
    })
    expect(responses['405'].content['application/json'].example).toEqual({
      error: 'Method not allowed for this API token route', method: 'POST',
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

  describe('write operations', () => {
    const base = {
      requiredScopes: ['vms:write'], routeFile: 'x', summary: 's', description: 'd',
      responseSchemaRef: 'TaskStartedResponse',
    } as const
    const post: AllowlistEntry = {
      ...base, id: 'vm-start', method: 'POST', tag: 'VMs',
      pattern: '/api/v1/connections/{connId}/vms/{vmKey}/start',
      connectionSegment: 'connId', vmKeySegment: 'vmKey',
      guestScope: { vmKey: 'vmKey' }, requestSchemaRef: 'VmStartRequest',
    }
    const get: AllowlistEntry = {
      ...base, id: 'vm-start-get', method: 'GET', tag: 'Snapshots', requiredScopes: ['vms:read'],
      pattern: post.pattern, responseSchemaRef: 'VmsResponse',
    }
    const startSchema = { type: 'object', properties: { force: { type: 'boolean' } } }
    const schemas = { request: { VmStartRequest: startSchema }, response: RESPONSE_SCHEMAS }
    const wdoc = buildOpenApiDocument([post], schemas) as any
    const mdoc = buildOpenApiDocument([post, get], schemas) as any

    it('keys operations by lowercase method and does not invent a get', () => {
      expect(wdoc.paths[post.pattern].post.operationId).toBe('vm-start')
      expect(wdoc.paths[post.pattern].get).toBeUndefined()
    })

    it('merges entries sharing a pattern', () => {
      expect(Object.keys(mdoc.paths[post.pattern]).sort()).toEqual(['get', 'post'])
      expect(mdoc.paths[post.pattern].get.operationId).toBe('vm-start-get')
    })

    it('tags operations and lists top-level tags in ApiTag order', () => {
      expect(wdoc.paths[post.pattern].post.tags).toEqual(['VMs'])
      expect(mdoc.paths[post.pattern].get.tags).toEqual(['Snapshots'])
      expect(wdoc.tags.map((t: any) => t.name)).toEqual([
        'Monitoring', 'VMs', 'Snapshots', 'Backups', 'Storage', 'HA', 'Pools', 'Network', 'Firewall', 'Tasks',
      ])
    })

    it('adds a request body only when requestSchemaRef is set', () => {
      const op = wdoc.paths[post.pattern].post
      expect(op.requestBody.required).toBe(true)
      expect(op.requestBody.content['application/json'].schema).toEqual(startSchema)
      expect(mdoc.paths[post.pattern].get.requestBody).toBeUndefined()
    })

    it('describes the shared task response and the 405 on every operation', () => {
      const op = wdoc.paths[post.pattern].post
      expect(op.responses['200'].content['application/json'].schema).toEqual(wdoc.components.schemas.TaskStartedResponse)
      expect(wdoc.components.schemas.TaskStartedResponse.properties.data.type).toBe('string')
      expect(wdoc.components.schemas.TaskStartedResponse.description).toContain('/api/v1/tasks/{connectionId}/{node}/{upid}')
      const e405 = op.responses['405'].content['application/json'].example
      expect(e405.error).toBe('Method not allowed for this API token route')
      expect(e405.method).not.toBe('POST')
    })

    it('documents the perimeter and guest refusals as named 403 examples', () => {
      const ex = wdoc.paths[post.pattern].post.responses['403'].content['application/json'].examples
      expect(ex.perimeter.value).toEqual({ error: 'Connection not in token scope', connection: 'conn-1' })
      expect(ex.guestScope.value).toEqual({ error: 'Guest outside your vDC scope' })
      expect(ex.scope.value).toEqual({ error: 'Route not available to API tokens', route: post.pattern })
      expect(ex.clusterObject).toBeUndefined()
    })

    it('throws on an unknown request or response schema ref', () => {
      expect(() => buildOpenApiDocument([post])).toThrow('Unknown requestSchemaRef VmStartRequest for vm-start')
      expect(() => buildOpenApiDocument([{ ...post, requestSchemaRef: undefined, responseSchemaRef: 'Nope' }]))
        .toThrow('Unknown responseSchemaRef Nope for vm-start')
    })

    it('documents cluster objects and segment enums', () => {
      const co: AllowlistEntry = {
        ...post, id: 'co', pattern: '/api/v1/connections/{connId}/x/{action}', vmKeySegment: undefined,
        guestScope: undefined, clusterObject: true, requestSchemaRef: undefined,
        segmentEnum: { action: ['start', 'stop'] },
      }
      const d = buildOpenApiDocument([co]) as any
      const op = d.paths[co.pattern].post
      expect(op.responses['403'].content['application/json'].examples.clusterObject.value).toEqual({
        error: 'Cluster-level object not available to a vDC tenant token',
      })
      expect(op.parameters.find((p: any) => p.name === 'action').schema.enum).toEqual(['start', 'stop'])
    })
  })

  // The in-product reference (#827) renders the committed file, not the
  // builder. `generate:openapi` is a manual step, so without this check a new
  // allowlist entry merged without regenerating ships a reference that silently
  // disagrees with the API while CI stays green.
  it('matches the committed public/openapi/proxcenter-public-api.json (run `npm run generate:openapi` to refresh it)', () => {
    const file = path.resolve(__dirname, '..', '..', '..', 'public', 'openapi', 'proxcenter-public-api.json')
    const committed = JSON.parse(readFileSync(file, 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)))
  })
})
