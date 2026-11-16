/**
 * Layout of the host summary: the usage bars and the system info sit side by
 * side once the summary is wide enough, and stack below that width. A
 * container query, so the layout follows the width the tree panel leaves,
 * not the screen.
 */

/** Width of the summary from which the bars and the system info sit side by side. */
export const HOST_SUMMARY_TWO_COLUMNS_MIN_WIDTH = 760

export function hostSummaryRowSx() {
  return {
    display: 'flex',
    gap: 2,
    flexDirection: 'column',
    [`@container (min-width: ${HOST_SUMMARY_TWO_COLUMNS_MIN_WIDTH}px)`]: { flexDirection: 'row' },
  }
}
