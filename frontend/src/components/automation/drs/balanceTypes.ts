// Pure guard for the DRS "guest types to balance" chips. balance_types must
// always keep at least one entry: an empty list is rejected by the backend
// (HTTP 400) and is a meaningless state in the UI. So a click that would
// remove the last remaining type is ignored (the list is returned unchanged).
//
// balance_types only governs DRS LOAD REBALANCING. Maintenance evacuation and
// affinity rules move all guest types regardless of this knob.
export type BalanceType = 'vm' | 'ct'

export function toggleBalanceType(current: BalanceType[], type: BalanceType): BalanceType[] {
  if (current.includes(type)) {
    // Removing — but never below one selected type.
    if (current.length <= 1) {
      return current
    }
    return current.filter(t => t !== type)
  }
  // Adding — append to preserve the existing order.
  return [...current, type]
}
