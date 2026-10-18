/**
 * Detail line of a rolling update in the Task Center.
 *
 * The jobs route used to build it in French ("En cours: pve01 (0/3 nœuds)")
 * whatever the operator's language, and kept "En cours" on a run that had
 * already failed. The route now sends a neutral line (rollingUpdateNeutralDetail)
 * for search and the taskbar; the page renders this localized one.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string

const OPEN_STATUSES = new Set(['pending', 'running', 'paused'])

interface RollingProgress {
  node: string
  done: number
  total: number
  open: boolean
}

function progressOf(status: unknown, currentNode: unknown, completed: unknown, total: unknown): RollingProgress {
  return {
    node: typeof currentNode === 'string' ? currentNode : '',
    done: Number(completed) || 0,
    total: Number(total) || 0,
    open: OPEN_STATUSES.has(String(status))
  }
}

/** Route side: the orchestrator's rolling update record, no word of any language. */
export function rollingUpdateNeutralDetail(ru: any): string {
  const p = progressOf(ru?.status, ru?.current_node, ru?.completed_nodes, ru?.total_nodes)

  return p.open && p.node ? `${p.node} (${p.done}/${p.total})` : `${p.done}/${p.total}`
}

/** Page side: the job row built by the route, in the operator's language. */
export function rollingUpdateDetail(job: any, t: Translate): string {
  const m = job?.metadata || {}
  const p = progressOf(job?.status, m.currentNode, m.completedNodes, m.totalNodes)

  return p.open && p.node
    ? t('jobsPage.rollingDetailCurrent', { node: p.node, done: p.done, total: p.total })
    : t('jobsPage.rollingDetailNodes', { done: p.done, total: p.total })
}
