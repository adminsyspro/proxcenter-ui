/**
 * Tests for `invokeTool`, the single execution path every catalog consumer
 * shares: argument checking and the refusal / failure split.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

import { invokeTool } from './invoke'
import { AmbiguousTargetError, ToolArgumentError, ToolScopeError, type CatalogTool, type ToolContext } from './types'

const ctx: ToolContext = {
  snapshot: {
    clusters: [],
    nodes: [],
    guests: [],
    summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 0, onlineNodes: 0 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
}

function makeTool(execute: CatalogTool['execute'], properties: CatalogTool['parameters']['properties'] = {
  cluster: { type: 'string', description: 'Cluster name.' },
  limit: { type: 'integer', description: 'How many.' },
}): CatalogTool {
  return {
    name: 'list_ceph_osds',
    readOnly: true,
    description: 'List the OSDs.',
    parameters: { type: 'object', properties },
    execute,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('invokeTool', () => {
  it('returns the value of a tool that answers, with the arguments and context it was given', async () => {
    const execute = vi.fn(async () => ({ osds: 3 }))

    const outcome = await invokeTool(makeTool(execute), { cluster: 'prod' }, ctx)

    expect(outcome).toEqual({ ok: true, value: { osds: 3 } })
    expect(execute).toHaveBeenCalledWith({ cluster: 'prod' }, ctx)
  })

  it('refuses an undeclared argument without running the tool, naming the accepted ones', async () => {
    const execute = vi.fn(async () => ({ osds: 3 }))

    const outcome = await invokeTool(makeTool(execute), { clusterName: 'prod', zone: 'a' }, ctx)

    expect(outcome).toEqual({
      ok: false,
      error: 'bad-argument',
      message: 'Unknown arguments "clusterName", "zone" for list_ceph_osds. Accepted arguments: cluster, limit.',
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('tolerates the empty padding small models add for unused arguments', async () => {
    const outcome = await invokeTool(makeTool(async () => 'ok'), { cluster: 'prod', extra: '', other: null }, ctx)

    expect(outcome).toEqual({ ok: true, value: 'ok' })
  })

  it('does not check arguments against a schema that declares none', async () => {
    const outcome = await invokeTool(makeTool(async () => 'ok', {}), { anything: 1 }, ctx)

    expect(outcome).toEqual({ ok: true, value: 'ok' })
  })

  it('reports a scope refusal verbatim, as an answer the caller can act on', async () => {
    const outcome = await invokeTool(makeTool(async () => {
      throw new ToolScopeError('Unknown cluster "lab". Visible clusters: prod.')
    }), {}, ctx)

    expect(outcome).toEqual({ ok: false, error: 'out-of-scope', message: 'Unknown cluster "lab". Visible clusters: prod.' })
  })

  it('carries the choices of an ambiguous reference beside the refusal, and none on a plain one', async () => {
    const choice = { kind: 'cluster' as const, label: 'prod', reply: 'prod' }
    const outcome = await invokeTool(makeTool(async () => {
      throw new AmbiguousTargetError('Several clusters are visible.', [choice])
    }), {}, ctx)

    expect(outcome).toEqual({ ok: false, error: 'out-of-scope', message: 'Several clusters are visible.', choices: [choice] })

    const empty = await invokeTool(makeTool(async () => {
      throw new AmbiguousTargetError('Several clusters are visible.', [])
    }), {}, ctx)

    expect('choices' in empty).toBe(false)
  })

  it('reports a rejected value verbatim', async () => {
    const outcome = await invokeTool(makeTool(async () => {
      throw new ToolArgumentError('Invalid value "cpu" for "metric". Accepted values: vcpus, memory.')
    }), {}, ctx)

    expect(outcome).toEqual({
      ok: false,
      error: 'bad-argument',
      message: 'Invalid value "cpu" for "metric". Accepted values: vcpus, memory.',
    })
  })

  it('logs a real failure and reports it as one, with the message cut to 200 characters', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await invokeTool(makeTool(async () => {
      throw new Error('x'.repeat(500))
    }), {}, ctx)

    expect(outcome).toEqual({ ok: false, error: 'failed', message: `The "list_ceph_osds" lookup failed: ${'x'.repeat(200)}` })
    expect(log).toHaveBeenCalledOnce()
  })

  it('reports a thrown non-Error value as a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const outcome = await invokeTool(makeTool(async () => {
      throw 'pveproxy timeout' // NOSONAR: a tool may reject with anything, the point of the test
    }), {}, ctx)

    expect(outcome).toEqual({ ok: false, error: 'failed', message: 'The "list_ceph_osds" lookup failed: pveproxy timeout' })
  })
})
