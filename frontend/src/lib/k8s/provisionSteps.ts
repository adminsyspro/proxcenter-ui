// deriveProvisionSteps turns a provisioning run's current state into an ordered
// deployment checklist, so ProvisionProgress can show discrete step markers
// (done / active / pending / failed) alongside the raw log stream. It is pure
// and framework-free so it can be unit-tested without rendering.
//
// The three run phases (init -> apply -> bootstrap) come from the orchestrator;
// register and ready are the frontend-side tail that follows the run reaching
// 'completed' (ProvisionProgress POSTs /register, then the cluster turns green).

export type ProvisionStepState = 'pending' | 'active' | 'done' | 'failed'

export interface ProvisionStep {
  key: string
  state: ProvisionStepState
}

// Ordered checklist keys. The first three line up 1:1 (by index) with RUN_PHASES.
export const PROVISION_STEP_KEYS = ['init', 'apply', 'bootstrap', 'register', 'ready'] as const

const RUN_PHASES = ['init', 'apply', 'bootstrap'] as const

export interface ProvisionStepInput {
  status: string
  phase: string
  registering?: boolean
  registered?: boolean
  registerError?: boolean
}

export function deriveProvisionSteps(input: ProvisionStepInput): ProvisionStep[] {
  const { status, phase, registered, registerError } = input
  const phaseIdx = RUN_PHASES.indexOf(phase as (typeof RUN_PHASES)[number])

  const stateOf = (key: string, idx: number): ProvisionStepState => {
    if (status === 'failed') {
      // Failed during its current run phase (default to the first if the phase
      // is unknown): mark that step failed, earlier ones done, the rest pending.
      const failedIdx = phaseIdx >= 0 ? phaseIdx : 0
      if (idx < failedIdx) return 'done'
      if (idx === failedIdx) return 'failed'
      return 'pending'
    }

    if (status === 'completed') {
      // All three run phases are done; register/ready are the tail.
      if (key === 'register') {
        if (registerError) return 'failed'
        if (registered) return 'done'
        return 'active' // registering, or completed but register not finished yet
      }
      if (key === 'ready') return registered ? 'done' : 'pending'
      return 'done'
    }

    if (status === 'running') {
      // register/ready never start until the run completes.
      if (key === 'register' || key === 'ready') return 'pending'
      // Running but the phase is not a recognized run phase: treat init active.
      if (phaseIdx < 0) return key === 'init' ? 'active' : 'pending'
      if (idx < phaseIdx) return 'done'
      if (idx === phaseIdx) return 'active'
      return 'pending'
    }

    // pending / queued / unknown: nothing has started.
    return 'pending'
  }

  return PROVISION_STEP_KEYS.map((key, idx) => ({ key, state: stateOf(key, idx) }))
}
