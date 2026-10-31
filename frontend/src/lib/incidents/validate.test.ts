import { describe, expect, it } from 'vitest'

import {
  parseActionBody,
  parseActionPatch,
  parseAlertIds,
  parseAttachBody,
  parseCommentBody,
  parseCreateBody,
  parseIncidentPatch,
  parseOutages,
} from './validate'

const bad = { ok: false, code: 'invalid_body' }
const outage = { connection_id: 'c1', kind: 'guest', node: '', vmid: 100, from: '2026-10-01T10:00:00Z', to: '2026-10-01T11:00:00Z' }

describe('parseCommentBody', () => {
  it('1 to 4000 characters, internal optional', () => {
    expect(parseCommentBody({ body: ' hi ', internal: true })).toEqual({ ok: true, value: { body: 'hi', internal: true } })
    expect(parseCommentBody({ body: 'x'.repeat(4000) }).ok).toBe(true)
    expect(parseCommentBody({ body: 'x'.repeat(4001) })).toEqual(bad)
    expect(parseCommentBody({ body: '  ' })).toEqual(bad)
    expect(parseCommentBody({ body: 'a', internal: 'yes' })).toEqual(bad)
    expect(parseCommentBody(null)).toEqual(bad)
  })

  it('keeps HTML as text, untouched', () => {
    expect(parseCommentBody({ body: '<script>alert(1)</script>' })).toMatchObject({ ok: true, value: { body: '<script>alert(1)</script>' } })
  })
})

describe('parseIncidentPatch', () => {
  it('title 1..200, root cause and impact 0..4000, at least one field', () => {
    expect(parseIncidentPatch({ title: 'T', root_cause: '', impact: 'i' })).toEqual({ ok: true, value: { title: 'T', root_cause: '', impact: 'i' } })
    expect(parseIncidentPatch({ title: 'x'.repeat(201) })).toEqual(bad)
    expect(parseIncidentPatch({ title: ' ' })).toEqual(bad)
    expect(parseIncidentPatch({ root_cause: 'x'.repeat(4001) })).toEqual(bad)
    expect(parseIncidentPatch({ impact: 4 })).toEqual(bad)
    expect(parseIncidentPatch({})).toEqual(bad)
  })
})

describe('actions', () => {
  it('text 1..500', () => {
    expect(parseActionBody({ text: 'Patch' })).toEqual({ ok: true, value: { text: 'Patch' } })
    expect(parseActionBody({ text: 'x'.repeat(501) })).toEqual(bad)
    expect(parseActionBody({})).toEqual(bad)
  })

  it('a patch carries text and/or done, and nothing else', () => {
    expect(parseActionPatch({ done: true, by: 'forged' })).toEqual({ ok: true, value: { done: true } })
    expect(parseActionPatch({ text: 'x', done: false })).toEqual({ ok: true, value: { text: 'x', done: false } })
    expect(parseActionPatch({ done: 'true' })).toEqual(bad)
    expect(parseActionPatch({})).toEqual(bad)
  })
})

describe('create and attach', () => {
  it('needs an alert id, the title is optional', () => {
    expect(parseCreateBody({ alert_id: 'a1' })).toEqual({ ok: true, value: { title: '', alert_id: 'a1' } })
    expect(parseCreateBody({ alert_id: 'a1', title: 'T', created_by: 'forged' })).toEqual({ ok: true, value: { title: 'T', alert_id: 'a1' } })
    expect(parseCreateBody({ title: 'T' })).toEqual(bad)
    expect(parseCreateBody({ alert_id: 'a1', title: 'x'.repeat(201) })).toEqual(bad)
    expect(parseAttachBody({ alert_id: 'a1', by: 'forged' })).toEqual({ ok: true, value: { alert_id: 'a1' } })
    expect(parseAttachBody({})).toEqual(bad)
  })
})

describe('parseOutages', () => {
  it('up to 200 outages', () => {
    expect(parseOutages({ outages: Array(200).fill(outage) }).ok).toBe(true)
    expect(parseOutages({ outages: Array(201).fill(outage) })).toEqual(bad)
  })

  it('fills node and vmid, refuses a bad kind, time or shape', () => {
    expect(parseOutages({ outages: [{ ...outage, node: undefined, vmid: undefined, kind: 'cluster' }] })).toMatchObject({
      ok: true, value: [{ kind: 'cluster', node: '', vmid: 0 }],
    })
    expect(parseOutages({ outages: [{ ...outage, kind: 'disk' }] })).toEqual(bad)
    expect(parseOutages({ outages: [{ ...outage, from: 'yesterday' }] })).toEqual(bad)
    expect(parseOutages({ outages: [{ ...outage, vmid: 1.5 }] })).toEqual(bad)
    expect(parseOutages({ outages: ['x'] })).toEqual(bad)
    expect(parseOutages({})).toEqual(bad)
  })
})

describe('parseAlertIds', () => {
  it('splits on commas, drops blanks, refuses more than 500', () => {
    expect(parseAlertIds('a, b,,c')).toEqual(['a', 'b', 'c'])
    expect(parseAlertIds(null)).toEqual([])
    expect(parseAlertIds(Array(501).fill('a').join(','))).toBeNull()
    expect(parseAlertIds(Array(500).fill('a').join(','))).toHaveLength(500)
  })
})
