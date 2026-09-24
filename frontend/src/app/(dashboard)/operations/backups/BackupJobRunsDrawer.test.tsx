import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import pruneFailed from '@/lib/backups/__fixtures__/vzdump/scheduled-pbs-prune-failed.json'
import { parseVzdumpLog } from '@/lib/backups/vzdumpLog'

import BackupJobRunsDrawer from './BackupJobRunsDrawer'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

const UPID = 'UPID:pve1:001C9B56:09EE7859:6AB525DA:vzdump:9882:root@pam:'
const OK_UPID = 'UPID:pve1:00000001:00000001:6AB00000:vzdump:9882:root@pam:'
const detail = {
  task: { node: 'pve1', upid: UPID, status: 'job errors', start: 1790256602, end: 1790256604, user: 'root@pam' },
  log: parseVzdumpLog(pruneFailed as any, { taskStart: 1790256602 }),
  totalLines: pruneFailed.length,
}

const swrMock = vi.fn((url: string | null) => ({ data: url ? { data: detail } : undefined, error: undefined, isLoading: false }))
vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: (url: string | null) => swrMock(url) }))

const RUNS = [
  {
    id: UPID, start: 1790256602, end: 1790256604, durationSec: 2, origin: 'scheduled', status: 'post_step_failed',
    statusDetail: { failed: 1, total: 1, step: 'prune' },
    tasks: [{ node: 'pve1', upid: UPID, status: 'job errors', start: 1790256602, end: 1790256604, vmids: [9882], logUnavailable: false }],
  },
  {
    id: OK_UPID, start: 1790170202, end: 1790170230, durationSec: 28, origin: 'manual', status: 'ok',
    statusDetail: { failed: 0, total: 1 },
    tasks: [{ node: 'pve1', upid: OK_UPID, status: 'OK', start: 1790170202, end: 1790170230, vmids: [9882], logUnavailable: false }],
  },
]

afterEach(() => {
  cleanup()
  swrMock.mockClear()
})

function renderDrawer(props: Record<string, any> = {}) {
  return render(
    <BackupJobRunsDrawer open onClose={() => {}} connectionId="conn-1" title="e2e-1003-probe" subtitle="15:28 · pbs" runs={RUNS} days={30} {...props} />,
  )
}

describe('BackupJobRunsDrawer', () => {
  it('lists the runs with their derived status and selects the newest', () => {
    renderDrawer()
    expect(screen.getAllByText('backups.runs.status.post.prune').length).toBeGreaterThan(0)
    expect(screen.getByText('backups.runs.status.ok')).toBeInTheDocument()
    expect(swrMock).toHaveBeenCalledWith(`/api/v1/connections/conn-1/backup-jobs/runs/pve1/${encodeURIComponent(UPID)}`)
  })

  it('opens the failed guest section and shows the prune error line', () => {
    renderDrawer()
    expect(screen.getByText(/missing Datastore\.Modify\|Datastore\.Prune/)).toBeVisible()
  })

  it('selects the run of the focused UPID (after Run now)', () => {
    renderDrawer({ focusUpid: OK_UPID })
    expect(swrMock).toHaveBeenCalledWith(`/api/v1/connections/conn-1/backup-jobs/runs/pve1/${encodeURIComponent(OK_UPID)}`)
  })

  it('switches run on click', async () => {
    renderDrawer()
    await userEvent.click(screen.getByText('backups.runs.status.ok'))
    expect(swrMock).toHaveBeenLastCalledWith(`/api/v1/connections/conn-1/backup-jobs/runs/pve1/${encodeURIComponent(OK_UPID)}`)
  })

  it('shows the empty state', () => {
    renderDrawer({ runs: [] })
    expect(screen.getByText('backups.runs.noRuns')).toBeInTheDocument()
  })
})
