export interface DiskWarmState {
  deviceKey: number
  prevChangeId: string | null
  currentChangeId: string | null
  passIndex: number
  bytesDone: number
}

export function initDiskState(deviceKey: number): DiskWarmState {
  return { deviceKey, prevChangeId: null, currentChangeId: null, passIndex: 0, bytesDone: 0 }
}

/**
 * Advance per-disk state after a pass completes. The current changeId becomes
 * the previous one (the baseline for the next QueryChangedDiskAreas), and the
 * pass's new changeId becomes current. This is the changeId chain.
 */
export function recordPass(s: DiskWarmState, p: { newChangeId: string; bytes: number }): DiskWarmState {
  return {
    ...s,
    prevChangeId: s.currentChangeId,
    currentChangeId: p.newChangeId,
    passIndex: s.passIndex + 1,
    bytesDone: s.bytesDone + p.bytes,
  }
}
