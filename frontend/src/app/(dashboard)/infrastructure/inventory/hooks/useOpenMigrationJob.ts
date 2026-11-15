import { useCallback, useEffect, useRef } from 'react'

import { migrationDialogVm, OPEN_MIGRATION_JOB_EVENT, type MigrationDialogVm, type OpenMigrationJobDetail } from '@/lib/migration/migrationJobOpen'

const ADDRESS_PARAM = 'openMigration'

/**
 * The Inventory side of lib/migration/migrationJobOpen: reopen the migrate
 * dialog of a run asked for from the task bar or the running-tasks menu, either
 * through the DOM event (this page is mounted) or through ?openMigration= (the
 * caller navigated here, or the page was reloaded). The dialog is rebuilt from
 * the run's record, so it does not depend on the tab that started the run.
 *
 * `ready`: the page has applied the selection of the address (the source host).
 * Opened before, the dialog was gone once the page settled on that host.
 * `askedInAddress()`: a run is named in the address, so the page does not open
 * the batch in flight on that host instead.
 */
export function useOpenMigrationJob({ onOpen, onError, ready }: {
  onOpen: (vm: MigrationDialogVm) => void
  onError: (message: string) => void
  ready: boolean
}): { askedInAddress: () => boolean } {
  // The latest callbacks, read when the record arrives: the listeners stay put.
  const handlers = useRef({ onOpen, onError })
  handlers.current = { onOpen, onError }
  const tookFromAddress = useRef(false)
  const alive = useRef(true)

  const open = async (jobId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/migrations/${encodeURIComponent(jobId)}`)
      const body = await res.json().catch(() => ({}))
      if (!alive.current) return false
      if (!res.ok || !body?.data) { handlers.current.onError(body?.error || `HTTP ${res.status}`); return true }
      handlers.current.onOpen(migrationDialogVm(body.data))
      return true
    } catch (e) {
      if (alive.current) handlers.current.onError(e instanceof Error ? e.message : String(e))
      return alive.current
    }
  }

  useEffect(() => {
    alive.current = true
    const onRequest = (e: Event) => {
      const detail = (e as CustomEvent<OpenMigrationJobDetail>).detail
      if (!detail?.jobId) return
      detail.handled = true
      void open(detail.jobId)
    }
    window.addEventListener(OPEN_MIGRATION_JOB_EVENT, onRequest)
    return () => {
      alive.current = false
      window.removeEventListener(OPEN_MIGRATION_JOB_EVENT, onRequest)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const wanted = new URLSearchParams(window.location.search).get(ADDRESS_PARAM)
    if (!wanted) return
    tookFromAddress.current = true
    void open(wanted).then(done => {
      if (!done) return
      // Dropped once handled: a reload or a back must not reopen a dialog the
      // operator closed. Kept while not handled, for the page that takes over.
      const url = new URL(window.location.href)
      url.searchParams.delete(ADDRESS_PARAM)
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    })
  }, [ready])

  // Read when the page decides, not frozen at mount: after a navigation the
  // address can still be the previous page's when this panel mounts.
  const askedInAddress = useCallback(
    () => tookFromAddress.current || new URLSearchParams(window.location.search).has(ADDRESS_PARAM),
    [],
  )

  return { askedInAddress }
}
