// The browser tab title has two owners: the white-label browser title written
// by BrandingContext, and the decoration TasksDropdown adds while Proxmox jobs
// are running. Both shapes are built here so a title can be taken apart by the
// same rules that assembled it.

export const TAB_TITLE_SEPARATOR = ' · '
export const TAB_TITLE_MARKERS = ['⏳', '🔔']

export interface TabTitleTask {
  typeLabel: string
  entity: string | null
}

/**
 * A browser tab shows about twenty characters, and PVE keeps a shell task open
 * for as long as its console is, so joining every running task turned the tab
 * into "vncshell • vncshell • vncshell". Name the job only when there is
 * exactly one of them, and count beyond that.
 */
export function buildTabTitle(tasks: TabTitleTask[], baseTitle: string, runningLabel: string): string {
  if (tasks.length === 0) return baseTitle

  if (tasks.length === 1) {
    const [task] = tasks
    const label = task.entity ? `${task.typeLabel} (${task.entity})` : task.typeLabel

    return `⏳ ${label}${TAB_TITLE_SEPARATOR}${baseTitle}`
  }

  return `⏳ ${tasks.length} ${runningLabel}${TAB_TITLE_SEPARATOR}${baseTitle}`
}

/** The blinking alert shares the decorated shape so it can be stripped too. */
export function buildTabAlertTitle(message: string, baseTitle: string): string {
  return `🔔 ${message}${TAB_TITLE_SEPARATOR}${baseTitle}`
}

/**
 * Recover the undecorated title. A remount while jobs are running otherwise
 * reads back our own decorated title, which would then serve as the base and
 * stack a marker on every mount.
 */
export function undecorateTabTitle(title: string): string {
  const separator = title.indexOf(TAB_TITLE_SEPARATOR)

  if (separator === -1) return title
  if (!TAB_TITLE_MARKERS.some(marker => title.startsWith(marker))) return title

  return title.slice(separator + TAB_TITLE_SEPARATOR.length)
}
