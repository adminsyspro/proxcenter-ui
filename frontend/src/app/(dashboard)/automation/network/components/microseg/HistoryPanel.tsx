'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, CircularProgress, IconButton, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegRevision } from '@/lib/microseg/types'
import { REVISIONS_LIMIT, useMicrosegRevisions, useMicrosegRuns } from '@/lib/microseg/useMicrosegLists'

import { isVersionConflict, useDialogAction } from './dialogParts'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PolicyPager, { usePaged } from './PolicyPager'
import RevisionRow from './RevisionRow'
import RunRow from './RunRow'

/** Runs per page. The request asks for one more, which tells whether a next page exists. */
export const RUNS_PAGE_SIZE = 10

function Loading({ text }: { text: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
      <CircularProgress size={18} />
      <Typography color='text.secondary'>{text}</Typography>
    </Box>
  )
}

function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 40, mb: 0.5 }}>
      <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{title}</Typography>
      {children}
    </Box>
  )
}

function Revisions({ connectionId, policy, reloadPolicy, startRun }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.history.revisions')
  const api = useMemo(() => microsegApi(connectionId), [connectionId])
  const { data, error, loading, reload } = useMicrosegRevisions(connectionId)
  const paged = usePaged(data ?? [])
  const [restoring, setRestoring] = useState<MicrosegRevision | null>(null)
  const restore = useDialogAction()
  const latestId = policy.last_revision?.id

  // The draft is re-read when a run ends (the tab does it); a new head there means a revision was recorded.
  const seenLatest = useRef(latestId)
  useEffect(() => {
    if (seenLatest.current === latestId) return
    seenLatest.current = latestId
    void reload()
  }, [latestId, reload])

  const confirm = async () => {
    if (!restoring) return
    const target = restoring
    const ok = await restore.run(async () => {
      try {
        // The current draft version: a restore replaces the draft, so it is refused if the draft moved.
        const started = await api.restoreRevision(target.id, policy.version)
        startRun({
          runId: started.run_id,
          kind: 'restore',
          label: t('restoreLabel', { version: target.version }),
          runningText: t('restoreRunning', { version: target.version }),
        })
      } catch (e) {
        if (isVersionConflict(e)) await reloadPolicy().catch(() => undefined)
        throw e
      }
    })
    if (ok) setRestoring(null)
  }

  return (
    <Box component='section' aria-label={t('title')} sx={{ mb: 3 }}>
      <SectionHeader title={t('title')} />
      {error && !data && <MicrosegErrorAlert error={error} onRetry={reload} />}
      {!data && !error && loading && <Loading text={t('loading')} />}
      {data && data.length === 0 && <Typography color='text.secondary' sx={{ py: 2 }}>{t('empty')}</Typography>}
      {data && data.length > 0 && (
        <>
          <Box role='list'>
            {paged.rows.map(revision => (
              <RevisionRow
                key={revision.id}
                revision={revision}
                latest={revision.id === latestId}
                onRestore={() => { restore.reset(); setRestoring(revision) }}
              />
            ))}
          </Box>
          <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
          {data.length >= REVISIONS_LIMIT && (
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('capped', { count: REVISIONS_LIMIT })}</Typography>
          )}
        </>
      )}
      <MicrosegConfirmDialog
        open={restoring !== null}
        title={t('restoreTitle', { version: restoring?.version ?? 0 })}
        body={t('restoreBody')}
        confirmLabel={t('restore')}
        color='warning'
        busy={restore.busy}
        error={restore.error}
        onConfirm={() => void confirm()}
        onCancel={() => setRestoring(null)}
      />
    </Box>
  )
}

function Runs({ connectionId }: Pick<MicrosegSubTabProps, 'connectionId'>) {
  const t = useTranslations('microsegPilot.history.runs')
  const tp = useTranslations('microsegPilot.policy.pager')
  const to = useTranslations('microsegPilot.observation')
  const [page, setPage] = useState(0)
  const { data, error, loading, reload } = useMicrosegRuns(connectionId, {
    limit: RUNS_PAGE_SIZE + 1,
    offset: page > 0 ? page * RUNS_PAGE_SIZE : undefined,
  })
  const rows = (data ?? []).slice(0, RUNS_PAGE_SIZE)
  const hasNext = (data?.length ?? 0) > RUNS_PAGE_SIZE

  return (
    <Box component='section' aria-label={t('title')}>
      <SectionHeader title={t('title')}>
        <Typography noWrap variant='body2' color='text.secondary'>{to('page', { page: page + 1 })}</Typography>
        <IconButton size='small' aria-label={tp('previous')} disabled={page === 0} onClick={() => setPage(page - 1)}>
          <i className='ri-arrow-left-s-line' />
        </IconButton>
        <IconButton size='small' aria-label={tp('next')} disabled={!hasNext} onClick={() => setPage(page + 1)}>
          <i className='ri-arrow-right-s-line' />
        </IconButton>
      </SectionHeader>
      {error && !data && <MicrosegErrorAlert error={error} onRetry={reload} />}
      {!data && !error && loading && <Loading text={t('loading')} />}
      {data && rows.length === 0 && <Typography color='text.secondary' sx={{ py: 2 }}>{t('empty')}</Typography>}
      {rows.length > 0 && (
        <Box role='list'>
          {rows.map(run => <RunRow key={run.id} connectionId={connectionId} run={run} />)}
        </Box>
      )}
    </Box>
  )
}

/** The History sub-tab: the revisions of the policy (restorable) and the runs of the engine. */
export default function HistoryPanel(props: MicrosegSubTabProps) {
  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <Revisions {...props} />
      <Runs connectionId={props.connectionId} />
    </Box>
  )
}
