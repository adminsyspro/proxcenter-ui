import type { GridRowSelectionModel } from '@mui/x-data-grid'

/**
 * Resolve a DataGrid selection model into the concrete list of selected row ids.
 *
 * The header "select all" checkbox does not emit the selected rows: it emits
 * `{ type: 'exclude', ids: <deselected rows> }`, i.e. "every row except these".
 * Reading `model.ids` directly therefore yields an EMPTY list on select-all,
 * which silently disables any batch action gated on that list (#568).
 *
 * `rows` must be the very array handed to the grid's `rows` prop, so that
 * "every row" means the same thing here as it does inside the grid (filters
 * included).
 */
export function resolveSelectedRowIds<T extends { id: string }>(
  model: GridRowSelectionModel,
  rows: readonly T[]
): string[] {
  if (model.type === 'exclude') {
    return rows.filter(row => !model.ids.has(row.id)).map(row => row.id)
  }

  return Array.from(model.ids).map(String)
}
