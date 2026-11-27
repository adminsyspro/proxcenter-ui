/**
 * Greedy masonry packing: places boxes left-to-right, wrapping to a new row
 * when the next box would exceed maxRowWidth. Deterministic for a given input
 * order (no reordering / bin-packing heuristics).
 */

export interface PackBox {
  id: string
  width: number
  height: number
}

export interface PackedBox {
  id: string
  x: number
  y: number
}

export interface PackBoxesOpts {
  /** Maximum total row width before wrapping (default: 1200) */
  maxRowWidth?: number
  /** Gap between boxes in both axes (default: 40) */
  gap?: number
}

export function packBoxes(boxes: PackBox[], opts: PackBoxesOpts = {}): PackedBox[] {
  if (boxes.length === 0) return []

  const maxRowWidth = opts.maxRowWidth ?? 1200
  const gap = opts.gap ?? 40

  const result: PackedBox[] = []
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const box of boxes) {
    // Wrap to next row if adding this box would exceed maxRowWidth
    // (except when it's the first box in the row: always place it)
    if (cursorX > 0 && cursorX + box.width > maxRowWidth) {
      cursorY += rowHeight + gap
      cursorX = 0
      rowHeight = 0
    }

    result.push({ id: box.id, x: cursorX, y: cursorY })

    cursorX += box.width + gap
    rowHeight = Math.max(rowHeight, box.height)
  }

  return result
}
