/**
 * Contract tests for the tool catalog.
 *
 * The catalog is consumed by the assistant and, later, by external MCP
 * clients, which list it as is. Every entry must therefore be self-describing
 * and well formed on its own, whatever the consumer.
 */

import { describe, it, expect } from 'vitest'

import { READ_ONLY_TOOLS, TOOL_CATALOG, buildToolContext } from './catalog'

describe('tool catalog', () => {
  it('has unique snake_case names', () => {
    const names = TOOL_CATALOG.map(t => t.name)

    expect(new Set(names).size).toBe(names.length)

    for (const name of names) expect(name).toMatch(/^[a-z]+(?:_[a-z]+)+$/)
  })

  it('describes every tool and every argument', () => {
    for (const tool of TOOL_CATALOG) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20)
      expect(tool.parameters.type).toBe('object')

      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        expect(prop.description.length, `${tool.name}.${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('only requires arguments it declares', () => {
    for (const tool of TOOL_CATALOG) {
      const declared = Object.keys(tool.parameters.properties)

      for (const key of tool.parameters.required ?? []) expect(declared, tool.name).toContain(key)
    }
  })

  it('declares an enum default among the accepted values', () => {
    for (const tool of TOOL_CATALOG) {
      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        if (prop.enum && prop.default !== undefined) expect(prop.enum, `${tool.name}.${key}`).toContain(prop.default)
      }
    }
  })

  it('hands the assistant only read-only tools, and every tool is read-only today', () => {
    expect(READ_ONLY_TOOLS.every(t => t.readOnly)).toBe(true)
    expect(READ_ONLY_TOOLS.map(t => t.name)).toEqual(TOOL_CATALOG.map(t => t.name))
  })

  it('keeps the snapshot-only tools at the head of the list', () => {
    expect(TOOL_CATALOG.slice(0, 3).map(t => t.name)).toEqual(['list_hosts', 'list_guests', 'rank_guest_hardware'])
  })

  it('builds a context from the snapshot, tenant and locale', () => {
    const snapshot = {
      clusters: [],
      nodes: [],
      guests: [],
      summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 0, onlineNodes: 0 },
      cached: true,
    }

    expect(buildToolContext(snapshot, 'tenant-1', 'fr')).toEqual({ snapshot, tenantId: 'tenant-1', locale: 'fr' })
  })
})
