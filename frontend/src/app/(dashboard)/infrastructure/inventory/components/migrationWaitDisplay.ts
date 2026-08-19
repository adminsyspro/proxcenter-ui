/**
 * Display rules for a migration job parked on an operator decision.
 *
 * A run can wait on three different humans-in-the-loop: the warm cutover
 * (#443), the forced power off (#614) and the choice of root filesystem
 * (#738). The status chip, the operator-block icon and the block title all
 * rank those waits the same way, and that ranking used to live as ternary
 * chains inline in two JSX files. It is a real decision, so it lives here,
 * once, where it can be asserted without rendering a 4000-line component.
 *
 * The wait predicates stay owned by their action buttons and are reused here:
 * that is what keeps a chip that says "waiting" and the button that resolves
 * the wait keyed on the exact same state.
 */
import { isAwaitingOperator } from './WarmCutoverButton'
import { isAwaitingPowerOff } from './ForcePowerOffButton'
import { isAwaitingRootChoice } from './RootChoiceButton'

export type WaitKind = 'cutover' | 'powerOff' | 'rootChoice' | null

/**
 * The two surfaces that render the status chip. They agree on every known
 * state but kept different fallbacks for an anonymous step (see
 * statusChipLabelKey), so the surface is part of the contract.
 */
export type ChipSurface = 'panel' | 'dialog'

/** Label key for each wait; also the operator block title for that wait. */
const WAIT_LABEL_KEYS: Record<NonNullable<WaitKind>, string> = {
  powerOff: 'inventoryPage.esxiMigration.awaitingPowerOff',
  rootChoice: 'inventoryPage.esxiMigration.awaitingRootChoice',
  cutover: 'inventoryPage.esxiMigration.awaitingCutover',
}

/** Every i18n key this module can return; anything else is raw step text. */
const DISPLAY_KEYS = new Set<string>([
  ...Object.values(WAIT_LABEL_KEYS),
  'inventoryPage.esxiMigration.completed',
  'inventoryPage.esxiMigration.failed',
  'inventoryPage.esxiMigration.cancelled',
  'inventoryPage.esxiMigration.preparingDisks',
])

/**
 * Which operator decision, if any, this job is waiting on.
 *
 * The precedence is a decision, not an accident of the old ternary order: a
 * refused shutdown blocks the final delta mid-cutover, so it outranks
 * everything; the root choice parks the conversion and comes next; the warm
 * hold is the steady state a manual run sits in for hours and comes last.
 * A job can satisfy two predicates at once (a hold whose guest then refuses
 * to shut down) and must be named after the wait to resolve first.
 */
export function waitKind(job: any): WaitKind {
  if (isAwaitingPowerOff(job)) return 'powerOff'
  if (isAwaitingRootChoice(job)) return 'rootChoice'
  if (isAwaitingOperator(job)) return 'cutover'
  return null
}

/** Raw, untranslated fallback: the step (or the status) with underscores replaced. */
function rawStepText(job: any): string {
  return String(job?.currentStep || job?.status || '').replaceAll('_', ' ')
}

/**
 * Label for the migration status chip.
 *
 * Returns an i18n key for every recognised state; when none applies it
 * returns RAW step text that the caller must render untranslated. Use
 * isWaitDisplayKey to tell the two apart. Waiting states win over
 * currentStep/status, terminal statuses win over everything (the wait
 * predicates all exclude them anyway).
 *
 * The 'dialog' surface skips the terminal branches (its chip only renders for
 * live jobs, the guard sits in the JSX) and keeps two historical quirks of
 * the migrate dialog verbatim: preparing_disks has no dedicated label there,
 * and a bare status is not underscore-formatted.
 */
export function statusChipLabelKey(job: any, surface: ChipSurface = 'panel'): string {
  if (surface === 'panel') {
    if (job?.status === 'completed') return 'inventoryPage.esxiMigration.completed'
    if (job?.status === 'failed') return 'inventoryPage.esxiMigration.failed'
    if (job?.status === 'cancelled') return 'inventoryPage.esxiMigration.cancelled'
  }
  const kind = waitKind(job)
  if (kind) return WAIT_LABEL_KEYS[kind]
  if (surface === 'panel' && job?.status === 'preparing_disks') return 'inventoryPage.esxiMigration.preparingDisks'
  return surface === 'panel' ? rawStepText(job) : (job?.currentStep?.replaceAll('_', ' ') || job?.status || '')
}

/** Remix icon class for the operator block: the wait's own icon, a spinner otherwise. */
export function waitIconClass(job: any): string {
  switch (waitKind(job)) {
    case 'powerOff': return 'ri-shut-down-line'
    case 'rootChoice': return 'ri-list-check-2'
    case 'cutover': return 'ri-pause-circle-line'
    default: return 'ri-loader-4-line'
  }
}

/**
 * Operator block title: the wait's label key or, while the job is simply
 * running, RAW step text (same key-or-raw contract as statusChipLabelKey).
 */
export function waitTitleKey(job: any): string {
  const kind = waitKind(job)
  return kind ? WAIT_LABEL_KEYS[kind] : rawStepText(job)
}

/**
 * True when a value returned by statusChipLabelKey or waitTitleKey is an i18n
 * key to translate rather than raw step text to render as is.
 */
export function isWaitDisplayKey(label: string): boolean {
  return DISPLAY_KEYS.has(label)
}
