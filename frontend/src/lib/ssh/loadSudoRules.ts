import { orchestratorFetch } from '@/lib/orchestrator'
import { readDesiredSFlowConfig } from '@/lib/sflow/reconciler'
import { getCurrentTenantId } from '@/lib/tenant'

import { FRONTEND_SUDO_RULES, pinSFlowCollector, type SudoRule } from './sudo'

export interface LoadedSudoRules {
  rules: SudoRule[]
  orchestratorAvailable: boolean
  /** The sFlow collector the configure rule is pinned to, null when it is open. */
  sflowCollector: string | null
}

// The collector saved by the last Configure run of Network Flows, which pins
// the sFlow rule. A failure to read it leaves the rule open, never breaks the
// template or the check.
async function savedSFlowCollector(): Promise<string | null> {
  try {
    return (await readDesiredSFlowConfig(await getCurrentTenantId()))?.collectorTarget ?? null
  } catch {
    return null
  }
}

/**
 * Every rule of the restricted sudoers template: the orchestrator's (rolling
 * updates, host drain, Site Recovery) and the frontend's own (node actions,
 * Network Flows, compliance). Without the orchestrator only the frontend's
 * rules are known, which orchestratorAvailable tells.
 */
export async function loadSudoRules(): Promise<LoadedSudoRules> {
  const [loaded, collector] = await Promise.all([loadAllRules(), savedSFlowCollector()])
  const rules = pinSFlowCollector(loaded.rules, collector)

  return { ...loaded, rules, sflowCollector: rules === loaded.rules ? null : collector }
}

async function loadAllRules(): Promise<{ rules: SudoRule[], orchestratorAvailable: boolean }> {
  try {
    const data = await orchestratorFetch<{ rules?: SudoRule[] }>('/ssh/sudo-rules')
    const orchestratorRules = Array.isArray(data?.rules) ? data.rules : []

    return { rules: [...orchestratorRules, ...FRONTEND_SUDO_RULES], orchestratorAvailable: true }
  } catch (error: any) {
    if (error?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to fetch the orchestrator sudo rules:', String(error?.message || '').replace(/[\r\n]/g, ''))
    }

    return { rules: [...FRONTEND_SUDO_RULES], orchestratorAvailable: false }
  }
}
