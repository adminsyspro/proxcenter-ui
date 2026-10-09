// src/lib/connections/check/runConnectionCheck.ts
//
// Runs the probes in three waves and concatenates their items in the order
// the dialog shows them. A probe that throws or overruns its budget becomes a
// single failed item; it never hides the others.

import { probeApi, probeClock, probePrivileges, probeQuorum, probeSsh, probeTls, probeVersion, READ_TIMEOUT_MS, type NodeList } from './probes'
import { buildCheckDeps } from './transport'
import type { CheckContext, CheckDeps, CheckItem, CheckProbe, PveNode } from './types'

/** Per-probe wall-clock budgets, each above the sum of the calls inside. */
export const PROBE_BUDGET_MS: Record<CheckProbe, number> = {
  api: 10_000,
  tls: 8_000,
  privileges: 10_000,
  version: 12_000,
  clock: 12_000,
  quorum: 10_000,
  ssh: 15_000,
}

/** Bounds and shields one probe: a throw or a timeout is one failed item. */
export async function guardProbe(probe: CheckProbe, fn: () => Promise<CheckItem[]>, budgetMs = PROBE_BUDGET_MS[probe]): Promise<CheckItem[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<CheckItem[]>(resolve => {
        timer = setTimeout(
          () => resolve([{ id: probe, probe, status: 'fail', hint: 'probe.timeout', params: { probe, timeoutMs: budgetMs } }]),
          budgetMs,
        )
      }),
    ])
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return [{ id: probe, probe, status: 'fail', hint: 'probe.crashed', params: { probe, error } }]
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function loadNodes(deps: CheckDeps): Promise<NodeList> {
  try {
    const raw = await deps.pveGet<unknown>('/nodes', READ_TIMEOUT_MS)
    const nodes = (Array.isArray(raw) ? raw : [])
      .map(n => ({ node: String((n as PveNode)?.node ?? ''), status: (n as PveNode)?.status }))
      .filter(n => n.node)
    return { nodes }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

export async function runConnectionCheck(ctx: CheckContext, deps: CheckDeps = buildCheckDeps(ctx)): Promise<CheckItem[]> {
  const [api, tls, nodes] = await Promise.all([
    guardProbe('api', () => probeApi(ctx, deps)),
    guardProbe('tls', () => probeTls(ctx, deps)),
    loadNodes(deps),
  ])

  const [privileges, version, clock, quorum] = await Promise.all([
    guardProbe('privileges', () => probePrivileges(ctx, deps)),
    guardProbe('version', () => probeVersion(ctx, deps, nodes)),
    guardProbe('clock', () => probeClock(ctx, deps, nodes)),
    guardProbe('quorum', () => probeQuorum(ctx, deps)),
  ])

  // SSH only once the API answered and the certificate is not broken: a dead
  // host or a rotated certificate is the finding, and every SSH attempt on a
  // misconfigured node is one more line for fail2ban.
  const primaryOk = api.some(i => i.id === 'api.primary' && i.status === 'ok')
  const certBroken = tls.some(i => i.id === 'tls.certificate' && i.status === 'fail')
  const ssh = await guardProbe('ssh', () => probeSsh(ctx, deps, nodes, primaryOk && !certBroken))

  return [...api, ...tls, ...privileges, ...version, ...clock, ...quorum, ...ssh]
}
