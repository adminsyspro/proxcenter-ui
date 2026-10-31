import type { ClusterCapacity, NodeCapacity, StoppedAllocation, Thresholds } from './capacity'

/*
 * Optimisation plan of the resources page.
 *
 * The levers, their figures and the guests or nodes they concern are computed
 * here from the overview (no extra Proxmox call). The model only ranks them and
 * explains each one, quoting the lever's `ref`; it never produces a figure or a
 * VM name. Without a model the same levers come with rule-based text.
 */

export type PlanKind = 'rightsize' | 'dormant' | 'rebalance' | 'overcommit'
export type PlanPriority = 'high' | 'medium' | 'low'

export type PlanGuest = {
  type: 'guest'
  id: string
  name: string
  node: string
  cluster: string
  status: 'running' | 'stopped'
  vcpu: number
  ramBytes: number
  cpuPct?: number
  ramPct?: number
  targetVcpu?: number
  targetRamBytes?: number
}

export type PlanNode = {
  type: 'node'
  key: string
  name: string
  cluster: string
  online: boolean
  cpuPct: number
  ramPct: number
  vcpuRatio: number
}

export type PlanLever = {
  ref: string
  kind: PlanKind
  cluster: string | null
  /** What applying the lever frees, 0 when it frees nothing (a rebalance). */
  gain: { vcpu: number; ramBytes: number }
  /** Figures of the one-line finding, read by the page through i18n. */
  facts: Record<string, string | number>
  details: Array<PlanGuest | PlanNode>
  rulePriority: PlanPriority
}

export type PlanItem = PlanLever & {
  priority: PlanPriority
  explanation: string
  action: string
  /** Rule-based text: i18n keys under resources.optimization.*. */
  explanationKey?: string
  actionKey?: string
}

export type OptimizationPlan = {
  provider: 'basic' | 'ollama' | 'openai' | 'anthropic'
  model?: string
  generatedAt: string
  summary: string
  summaryKey?: string
  summaryParams?: Record<string, string | number>
  items: PlanItem[]
  aiFailed?: boolean
}

type Overprovisioned = {
  id?: string
  name: string
  node: string
  connName?: string
  cpuAllocated: number
  cpuUsedPct: number
  ramAllocatedGB: number
  ramUsedPct: number
  recommendedCpu: number
  recommendedRamGB: number
  potentialSavings: { cpu: number; ramGB: number }
}

type StoppedGuest = { id: string; name: string; node: string; connName: string; vcpu: number; ramBytes: number }

export type PlanInput = {
  overprovisioning: { cpu: { efficiency: number }; ram: { efficiency: number }; topOverprovisioned: Overprovisioned[] } | null
  stopped: StoppedAllocation | null
  largestStopped: StoppedGuest[]
  clusters: ClusterCapacity[]
  nodes: NodeCapacity[]
  thresholds: Thresholds
}

const GiB = 1024 ** 3
const IMBALANCE_POINTS = 15
const MAX_VCPU_RATIO = 4
const PRIORITY_ORDER: Record<PlanPriority, number> = { high: 0, medium: 1, low: 2 }

const round1 = (value: number) => Math.round(value * 10) / 10
const ratioOf = (n: NodeCapacity) => (n.cores > 0 ? round1(n.vcpuAllocated / n.cores) : 0)

function nodeDetail(n: NodeCapacity): PlanNode {
  return { type: 'node', key: n.key, name: n.node, cluster: n.connectionName, online: n.online, cpuPct: round1(n.cpuPct), ramPct: round1(n.ramPct), vcpuRatio: ratioOf(n) }
}

export function buildPlanLevers(input: PlanInput): PlanLever[] {
  const levers: Omit<PlanLever, 'ref'>[] = []
  const over = input.overprovisioning

  const rightsized = (over?.topOverprovisioned ?? []).filter(vm => vm.id)
  if (rightsized.length > 0) {
    const vcpu = rightsized.reduce((s, vm) => s + vm.potentialSavings.cpu, 0)
    const ramBytes = Math.round(rightsized.reduce((s, vm) => s + vm.potentialSavings.ramGB, 0) * GiB)

    levers.push({
      kind: 'rightsize',
      cluster: null,
      gain: { vcpu, ramBytes },
      facts: { count: rightsized.length, cpuEfficiency: round1(over?.cpu.efficiency ?? 0), ramEfficiency: round1(over?.ram.efficiency ?? 0) },
      details: rightsized.map(vm => ({
        type: 'guest', id: vm.id!, name: vm.name, node: vm.node, cluster: vm.connName ?? '', status: 'running',
        vcpu: vm.cpuAllocated, ramBytes: Math.round(vm.ramAllocatedGB * GiB), cpuPct: vm.cpuUsedPct, ramPct: vm.ramUsedPct,
        // A plan of savings never proposes more than the VM has (the sizing rule
        // floors RAM at 1 GB and keeps a margin above a busy VM's usage).
        targetVcpu: Math.min(vm.cpuAllocated, vm.recommendedCpu),
        targetRamBytes: Math.min(Math.round(vm.ramAllocatedGB * GiB), vm.recommendedRamGB * GiB),
      })),
      rulePriority: vcpu >= 16 || ramBytes >= 64 * GiB ? 'high' : 'medium',
    })
  }

  const stopped = input.stopped
  if (stopped && stopped.count > 0) {
    levers.push({
      kind: 'dormant',
      cluster: null,
      gain: { vcpu: stopped.vcpu, ramBytes: stopped.ramBytes },
      facts: { count: stopped.count },
      details: input.largestStopped.map(vm => ({ type: 'guest', id: vm.id, name: vm.name, node: vm.node, cluster: vm.connName, status: 'stopped', vcpu: vm.vcpu, ramBytes: vm.ramBytes })),
      rulePriority: stopped.ramBytes >= 64 * GiB ? 'medium' : 'low',
    })
  }

  for (const cluster of input.clusters) {
    const clusterNodes = input.nodes.filter(n => n.connectionId === cluster.id && n.online)

    if (cluster.imbalance.ram >= IMBALANCE_POINTS && clusterNodes.length >= 2) {
      const byRam = [...clusterNodes].sort((a, b) => b.ramPct - a.ramPct)
      const top = byRam[0]
      const bottom = byRam.at(-1)!

      levers.push({
        kind: 'rebalance',
        cluster: cluster.name,
        gain: { vcpu: 0, ramBytes: 0 },
        facts: { points: round1(cluster.imbalance.ram), top: top.node, topPct: Math.round(top.ramPct), bottom: bottom.node, bottomPct: Math.round(bottom.ramPct) },
        details: byRam.map(nodeDetail),
        rulePriority: top.ramPct >= input.thresholds.ram.warning ? 'high' : 'medium',
      })
    }

    const overcommitted = clusterNodes.filter(n => ratioOf(n) > MAX_VCPU_RATIO).sort((a, b) => ratioOf(b) - ratioOf(a))
    if (overcommitted.length > 0) {
      levers.push({
        kind: 'overcommit',
        cluster: cluster.name,
        gain: { vcpu: 0, ramBytes: 0 },
        facts: { count: overcommitted.length, max: MAX_VCPU_RATIO, worst: overcommitted[0].node, worstRatio: ratioOf(overcommitted[0]) },
        details: overcommitted.map(nodeDetail),
        rulePriority: overcommitted.some(n => n.cpuPct >= input.thresholds.cpu.warning) ? 'high' : 'low',
      })
    }
  }

  return levers
    .sort((a, b) => PRIORITY_ORDER[a.rulePriority] - PRIORITY_ORDER[b.rulePriority])
    .map((lever, i) => ({ ...lever, ref: `l${i + 1}` }))
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const PLAN_SYSTEM_PROMPT = `You are a Proxmox VE capacity and cost analyst. The platform lists optimisation levers it computed from live data; you rank them and explain each one to the infrastructure manager.

Rules:
- Use only the figures given. Never compute, round or invent a number, a VM name or a node name that is not in the data.
- Refer to a lever only through its ref (l1, l2 ...) in the "ref" field. In every sentence, name the cluster, node or VMs as written in the data, never the ref.
- Weigh each lever: what it frees, how risky it is (resizing a VM needs a reboot and a check of its peak load; removing a stopped guest may lose data; moving guests between nodes is live), and what to do first.
- Recommend concrete Proxmox actions: lower vCPU or RAM in the VM hardware, back up then remove or archive a stopped guest, live-migrate guests from the busiest node, lower the vCPU allocation of a node.
- Reply with JSON only, no markdown.`

const gib = (bytes: number) => Math.round(bytes / GiB)

function leverText(lever: PlanLever): string {
  const f = lever.facts
  const lines: string[] = []

  switch (lever.kind) {
    case 'rightsize':
      lines.push(`[${lever.ref}] Rightsize running VMs that use far less than allocated (fleet CPU efficiency ${f.cpuEfficiency}%, RAM efficiency ${f.ramEfficiency}%). Would free ${lever.gain.vcpu} vCPU and ${gib(lever.gain.ramBytes)} GiB RAM.`)
      for (const d of lever.details) {
        if (d.type !== 'guest') continue
        lines.push(`  - VM "${d.name}" on ${d.node}: ${d.vcpu} vCPU at ${d.cpuPct}% CPU -> ${d.targetVcpu} vCPU; ${gib(d.ramBytes)} GiB at ${d.ramPct}% RAM -> ${gib(d.targetRamBytes ?? 0)} GiB`)
      }
      break
    case 'dormant':
      lines.push(`[${lever.ref}] ${f.count} stopped guests still hold ${lever.gain.vcpu} vCPU and ${gib(lever.gain.ramBytes)} GiB RAM of allocation. Largest:`)
      for (const d of lever.details) {
        if (d.type === 'guest') lines.push(`  - "${d.name}" on ${d.node} (${d.cluster}): ${d.vcpu} vCPU, ${gib(d.ramBytes)} GiB RAM`)
      }
      break
    case 'rebalance':
      lines.push(`[${lever.ref}] Cluster "${lever.cluster}": RAM unevenly spread, ${f.points} points standard deviation; busiest ${f.top} at ${f.topPct}%, least busy ${f.bottom} at ${f.bottomPct}%.`)
      for (const d of lever.details) {
        if (d.type === 'node') lines.push(`  - node ${d.name}: RAM ${d.ramPct}%, CPU ${d.cpuPct}%`)
      }
      break
    case 'overcommit':
      lines.push(`[${lever.ref}] Cluster "${lever.cluster}": ${f.count} nodes allocate more than ${f.max} vCPU per core.`)
      for (const d of lever.details) {
        if (d.type === 'node') lines.push(`  - node ${d.name}: ${d.vcpuRatio}:1 vCPU per core, CPU at ${d.cpuPct}%`)
      }
      break
  }

  return lines.join('\n')
}

export function buildPlanPrompt(scope: string, levers: PlanLever[], languageLine: string): string {
  return [
    `Scope: ${scope}.`,
    '',
    'Optimisation levers:',
    ...levers.map(leverText),
    '',
    `Answer with this JSON structure:
{
  "summary": "2 sentences: where the waste or the imbalance is, and which lever to start with",
  "plan": [
    { "ref": "l1", "priority": "high|medium|low", "explanation": "why this lever matters and its risk, 1 to 2 sentences", "action": "what to do in Proxmox, 1 sentence" }
  ]
}
One entry per lever, most worthwhile first. "ref" and "priority" are codes read by software: copy them exactly as listed.`,
    languageLine,
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Reply and rule-based text
// ---------------------------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

function ruleItem(lever: PlanLever): PlanItem {
  return { ...lever, priority: lever.rulePriority, explanation: '', action: '', explanationKey: `explain.${lever.kind}`, actionKey: `action.${lever.kind}` }
}

/**
 * The model's ranking and text, kept only where it points at a lever. Every lever
 * stays in the plan: one the model left out keeps its rule-based text, after the
 * ones it ranked. Null when nothing usable came back.
 */
export function sanitizePlanReply(raw: unknown, levers: PlanLever[]): Pick<OptimizationPlan, 'summary' | 'items'> | null {
  if (!raw || typeof raw !== 'object') return null
  const reply = raw as { summary?: unknown; plan?: unknown }
  const byRef = new Map(levers.map(l => [l.ref, l]))
  const items: PlanItem[] = []

  for (const entry of Array.isArray(reply.plan) ? reply.plan : []) {
    if (!entry || typeof entry !== 'object') continue
    const ref = text((entry as any).ref, 8).replace(/^\[|\]$/g, '')
    const lever = byRef.get(ref)
    const priority = (entry as any).priority as PlanPriority
    const explanation = text((entry as any).explanation, 600)
    const action = text((entry as any).action, 400)

    if (!lever || items.some(i => i.ref === ref) || (!explanation && !action)) continue
    const item: PlanItem = { ...lever, priority: priority in PRIORITY_ORDER ? priority : lever.rulePriority, explanation, action }
    // Which node to move guests off and onto is a computed fact: a small model was
    // seen sending them to the busiest node, so that action stays the rule's.
    if (lever.kind === 'rebalance') Object.assign(item, { action: '', actionKey: 'action.rebalance' })
    items.push(item)
  }

  const summary = text(reply.summary, 1000)
  if (!summary && items.length === 0) return null

  for (const lever of levers) {
    if (!items.some(i => i.ref === lever.ref)) items.push(ruleItem(lever))
  }

  return { summary, items }
}

export function basicPlan(levers: PlanLever[]): Pick<OptimizationPlan, 'summary' | 'summaryKey' | 'summaryParams' | 'items'> {
  const items = levers.map(ruleItem)
  if (items.length === 0) return { summary: '', summaryKey: 'summaryNone', items }

  const vcpu = levers.reduce((s, l) => s + l.gain.vcpu, 0)
  const ramGiB = gib(levers.reduce((s, l) => s + l.gain.ramBytes, 0))

  return { summary: '', summaryKey: 'summary', summaryParams: { count: items.length, vcpu, ram: ramGiB }, items }
}
