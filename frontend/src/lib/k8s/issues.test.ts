import { describe, it, expect } from 'vitest'
import { detectIssues, RESTART_THRESHOLD } from './issues'
import type { ResourceListItem, K8sResourceKind } from './types'

const item = (kind: K8sResourceKind, name: string, summary: Record<string, string>, namespace?: string): ResourceListItem =>
  ({ kind, name, namespace, uid: name, createdAt: '', summary })

describe('detectIssues', () => {
  it('returns nothing for a healthy cluster', () => {
    expect(detectIssues({
      nodes: [item('node', 'n1', { ready: 'True', unschedulable: 'false' })],
      pods: [item('pod', 'web-1', { phase: 'Running', restarts: '0' }, 'shop'), item('pod', 'job-1', { phase: 'Succeeded' }, 'shop')],
      deployments: [item('deployment', 'web', { ready: '3/3' }, 'shop'), item('deployment', 'idle', { ready: '0/0' }, 'shop')],
    })).toEqual([])
  })

  it('flags node states: not ready (critical), pressure and cordon (warning)', () => {
    const issues = detectIssues({ nodes: [
      item('node', 'down', { ready: 'False', pressure: 'DiskPressure' }),
      item('node', 'full', { ready: 'True', pressure: 'MemoryPressure,DiskPressure', unschedulable: 'true' }),
    ] })
    expect(issues.map(i => [i.item.name, i.reason, i.severity, i.detail])).toEqual([
      ['down', 'nodeNotReady', 'critical', undefined],
      ['full', 'nodePressure', 'warning', 'MemoryPressure, DiskPressure'],
      ['full', 'nodeCordoned', 'warning', undefined],
    ])
  })

  it('maps pod reasons kubectl shows to problems', () => {
    const pods = [
      ['crash', { phase: 'Running', reason: 'CrashLoopBackOff' }, 'crashLoop'],
      ['pull', { phase: 'Pending', reason: 'ErrImagePull' }, 'imagePull'],
      ['oom', { phase: 'Running', reason: 'OOMKilled' }, 'oomKilled'],
      ['cfg', { phase: 'Pending', reason: 'CreateContainerConfigError' }, 'configError'],
      ['ev', { phase: 'Failed', reason: 'Evicted' }, 'evicted'],
      ['sched', { phase: 'Pending', reason: 'Unschedulable' }, 'unschedulable'],
      ['fail', { phase: 'Failed', reason: 'DeadlineExceeded' }, 'podFailed'],
      ['wait', { phase: 'Pending' }, 'pending'],
      ['flap', { phase: 'Running', restarts: String(RESTART_THRESHOLD) }, 'restarting'],
    ] as const
    const issues = detectIssues({ pods: pods.map(([n, s]) => item('pod', n, s as Record<string, string>, 'shop')) })
    const byName = Object.fromEntries(issues.map(i => [i.item.name, i.reason]))
    expect(byName).toEqual(Object.fromEntries(pods.map(([n, , r]) => [n, r])))
    expect(issues.find(i => i.item.name === 'fail')!.detail).toBe('DeadlineExceeded')
    expect(issues.find(i => i.item.name === 'flap')!.detail).toBe(String(RESTART_THRESHOLD))
  })

  it('reads an Error exit between two back-offs as a crash loop, not as restarts', () => {
    const [issue] = detectIssues({ pods: [item('pod', 'p', { phase: 'Running', reason: 'Error', restarts: '7' }, 'shop')] })
    expect([issue.reason, issue.severity]).toEqual(['crashLoop', 'critical'])
  })

  it('does not flag a pod under the restart threshold', () => {
    expect(detectIssues({ pods: [item('pod', 'p', { phase: 'Running', restarts: String(RESTART_THRESHOLD - 1) }, 'shop')] })).toEqual([])
  })

  it('flags workloads with no ready replica as down and partial ones as degraded', () => {
    const issues = detectIssues({
      deployments: [item('deployment', 'api', { ready: '0/2' }, 'shop'), item('deployment', 'web', { ready: '2/3' }, 'shop')],
      statefulsets: [item('statefulset', 'db', { ready: '0/1' }, 'shop')],
      daemonsets: [item('daemonset', 'agent', { ready: '1/2' }, 'kube-system')],
    })
    expect(issues.map(i => [i.kind, i.item.name, i.reason, i.detail])).toEqual([
      ['deployment', 'api', 'workloadDown', '0/2'],
      ['statefulset', 'db', 'workloadDown', '0/1'],
      ['daemonset', 'agent', 'workloadDegraded', '1/2'],
      ['deployment', 'web', 'workloadDegraded', '2/3'],
    ])
  })

  it('flags failed jobs and pending claims', () => {
    const issues = detectIssues({
      jobs: [item('job', 'ok', { status: 'Complete' }, 'a'), item('job', 'ko', { status: 'Failed' }, 'a')],
      pvcs: [item('pvc', 'data', { status: 'Pending' }, 'a'), item('pvc', 'bound', { status: 'Bound' }, 'a')],
    })
    expect(issues.map(i => [i.item.name, i.reason])).toEqual([['ko', 'jobFailed'], ['data', 'pvcPending']])
  })

  it('ranks critical before warning, nodes before workloads before pods', () => {
    const issues = detectIssues({
      pods: [item('pod', 'crash', { phase: 'Running', reason: 'CrashLoopBackOff' }, 'shop')],
      nodes: [item('node', 'n1', { ready: 'True', unschedulable: 'true' }), item('node', 'n2', { ready: 'False' })],
      deployments: [item('deployment', 'api', { ready: '0/1' }, 'shop')],
    })
    expect(issues.map(i => i.item.name)).toEqual(['n2', 'api', 'crash', 'n1'])
  })
})
