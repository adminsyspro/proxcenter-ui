import { describe, it, expect } from 'vitest'
import { actionsFor, parseWorkloadAction, isValidName, isValidNamespace, MAX_REPLICAS } from './workloadActions'

describe('actionsFor', () => {
  it('offers restart, scale and rollback on a Deployment', () => {
    expect(actionsFor('deployment')).toEqual(['restart', 'scale', 'rollback'])
  })
  it('offers restart and scale on a StatefulSet, restart on a DaemonSet, delete on a pod', () => {
    expect(actionsFor('statefulset')).toEqual(['restart', 'scale'])
    expect(actionsFor('daemonset')).toEqual(['restart'])
    expect(actionsFor('pod')).toEqual(['delete'])
  })
  it('offers nothing on the other kinds', () => {
    expect(actionsFor('service')).toEqual([])
    expect(actionsFor('node')).toEqual([])
  })
})

describe('name validation', () => {
  it('accepts RFC 1123 names and rejects the rest', () => {
    expect(isValidName('web-6bd469df5c.x')).toBe(true)
    expect(isValidName('Bad_Name')).toBe(false)
    expect(isValidName('a'.repeat(254))).toBe(false)
    expect(isValidName(undefined)).toBe(false)
  })
  it('accepts namespaces without dots, up to 63 characters', () => {
    expect(isValidNamespace('kube-system')).toBe(true)
    expect(isValidNamespace('a.b')).toBe(false)
    expect(isValidNamespace('a'.repeat(64))).toBe(false)
  })
})

describe('parseWorkloadAction', () => {
  const base = { namespace: 'shop', name: 'web' }
  it('parses a restart', () => {
    expect(parseWorkloadAction({ action: 'restart', kind: 'daemonset', ...base })).toEqual({ ok: true, value: { action: 'restart', kind: 'daemonset', ...base } })
  })
  it('parses a scale and bounds the replica count', () => {
    expect(parseWorkloadAction({ action: 'scale', kind: 'statefulset', ...base, replicas: 0 }).ok).toBe(true)
    expect(parseWorkloadAction({ action: 'scale', kind: 'deployment', ...base, replicas: MAX_REPLICAS + 1 }).ok).toBe(false)
    expect(parseWorkloadAction({ action: 'scale', kind: 'deployment', ...base, replicas: 1.5 }).ok).toBe(false)
    expect(parseWorkloadAction({ action: 'scale', kind: 'deployment', ...base, replicas: '3' }).ok).toBe(false)
  })
  it('parses a rollback with a positive revision, Deployments only', () => {
    expect(parseWorkloadAction({ action: 'rollback', kind: 'deployment', ...base, revision: 2 })).toEqual({ ok: true, value: { action: 'rollback', kind: 'deployment', ...base, revision: 2 } })
    expect(parseWorkloadAction({ action: 'rollback', kind: 'deployment', ...base, revision: 0 }).ok).toBe(false)
    expect(parseWorkloadAction({ action: 'rollback', kind: 'statefulset', ...base, revision: 2 }).ok).toBe(false)
  })
  it('parses a pod delete and refuses delete on a workload', () => {
    expect(parseWorkloadAction({ action: 'delete', kind: 'pod', ...base }).ok).toBe(true)
    expect(parseWorkloadAction({ action: 'delete', kind: 'deployment', ...base }).ok).toBe(false)
  })
  it('refuses a missing body, a bad namespace or a bad name', () => {
    expect(parseWorkloadAction(null).ok).toBe(false)
    expect(parseWorkloadAction({ action: 'restart', kind: 'deployment', namespace: 'Shop', name: 'web' })).toEqual({ ok: false, error: 'invalid namespace' })
    expect(parseWorkloadAction({ action: 'restart', kind: 'deployment', namespace: 'shop', name: '../x' })).toEqual({ ok: false, error: 'invalid name' })
  })
})
