export type ReportsTab = 'generate' | 'history' | 'schedules' | 'customization'

/** The tab actually shown: one the caller is not allowed to see falls back to the history. */
export function visibleReportsTab(tab: ReportsTab, can: { canManage: boolean; canCustomize: boolean }): ReportsTab {
  if (tab === 'generate' && !can.canManage) return 'history'
  if (tab === 'customization' && !can.canCustomize) return 'history'
  return tab
}
