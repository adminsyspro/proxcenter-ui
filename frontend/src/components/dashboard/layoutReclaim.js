// The widget grid uses free placement (no auto-compaction), so rows vacated by
// hidden widgets (collapsed sections, scope filtering) must be reclaimed
// manually at display time. Only rows no visible widget occupies are removed,
// which preserves the gaps the user left on purpose. Rows are expressed as
// [start, end) intervals in grid units.

export function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const merged = []

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]

    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  return merged
}

// Returns the row intervals covered by hidden widgets and by no visible one.
export function computeReclaimedRows(visibleItems, hiddenItems) {
  if (hiddenItems.length === 0) return []

  const occupied = mergeIntervals(visibleItems.map(w => [w.y, w.y + w.h]))
  const freed = []

  for (const [start, end] of mergeIntervals(hiddenItems.map(w => [w.y, w.y + w.h]))) {
    let cursor = start

    for (const [oStart, oEnd] of occupied) {
      if (oEnd <= cursor) continue
      if (oStart >= end) break
      if (oStart > cursor) freed.push([cursor, oStart])
      cursor = oEnd
      if (cursor >= end) break
    }

    if (cursor < end) freed.push([cursor, end])
  }

  return freed
}

// How far up a widget sitting at row y moves once the freed rows are removed.
export function yShiftFor(freedIntervals, y) {
  return freedIntervals.reduce((total, [start, end]) => total + Math.max(0, Math.min(end, y) - start), 0)
}
