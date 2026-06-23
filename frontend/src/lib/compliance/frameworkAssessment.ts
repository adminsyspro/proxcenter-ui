import type { HardeningCheck } from './hardening'
import type { Crosswalk, FrameworkDef } from './frameworks/types'

export type ControlStatus = 'satisfied' | 'partial' | 'failed' | 'not_assessed'

export interface AssessedControl {
  id: string; title: string; family: string; status: ControlStatus
  checks: { id: string; name: string; status: string; details?: string }[]
}
export interface FamilyBreakdown {
  family: string; satisfied: number; partial: number; failed: number; notAssessed: number
}
export interface FrameworkAssessment {
  frameworkId: string
  score: number | null
  satisfied: number; partial: number; failed: number; notAssessed: number
  assessedControls: number; totalControls: number; coverage: number
  families: FamilyBreakdown[]
  controls: AssessedControl[]
}

export function assessFramework(checks: HardeningCheck[], def: FrameworkDef, crosswalk: Crosswalk): FrameworkAssessment {
  const byId = new Map(checks.map(c => [c.id, c]))
  // control id -> contributing checks
  const controlChecks = new Map<string, HardeningCheck[]>()
  for (const [checkId, mapping] of Object.entries(crosswalk)) {
    const chk = byId.get(checkId)
    if (!chk) continue
    for (const controlId of mapping.controlIds) {
      const arr = controlChecks.get(controlId) ?? []
      arr.push(chk)
      controlChecks.set(controlId, arr)
    }
  }

  const controls: AssessedControl[] = def.controls.map(ctrl => {
    const mapped = controlChecks.get(ctrl.id) ?? []
    const applicable = mapped.filter(c => c.status !== 'skip')
    let status: ControlStatus
    if (applicable.length === 0) status = 'not_assessed'
    else if (applicable.every(c => c.status === 'pass')) status = 'satisfied'
    else if (applicable.every(c => c.status === 'fail')) status = 'failed'
    else status = 'partial'
    return { id: ctrl.id, title: ctrl.title, family: ctrl.family, status, checks: mapped.map(c => ({ id: c.id, name: c.name, status: c.status, details: c.details })) }
  })

  const count = (s: ControlStatus) => controls.filter(c => c.status === s).length
  const satisfied = count('satisfied'), partial = count('partial'), failed = count('failed'), notAssessed = count('not_assessed')
  const assessedControls = satisfied + partial + failed
  const totalControls = def.controls.length

  const famMap = new Map<string, FamilyBreakdown>()
  for (const c of controls) {
    const f = famMap.get(c.family) ?? { family: c.family, satisfied: 0, partial: 0, failed: 0, notAssessed: 0 }
    if (c.status === 'satisfied') f.satisfied++
    else if (c.status === 'partial') f.partial++
    else if (c.status === 'failed') f.failed++
    else f.notAssessed++
    famMap.set(c.family, f)
  }

  return {
    frameworkId: def.id,
    score: assessedControls === 0 ? null : Math.round((satisfied / assessedControls) * 100),
    satisfied, partial, failed, notAssessed,
    assessedControls, totalControls,
    coverage: totalControls === 0 ? 0 : assessedControls / totalControls,
    families: [...famMap.values()].sort((a, b) => a.family.localeCompare(b.family)),
    controls,
  }
}
