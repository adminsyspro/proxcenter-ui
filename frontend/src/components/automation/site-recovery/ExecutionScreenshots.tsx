'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'

import { Box, Dialog, DialogContent, DialogTitle, Tooltip, Typography } from '@mui/material'

export interface ScreenshotMeta {
  vm_id: number
  target_vmid: number
  captured_at: string
}

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})

/** Boot screenshot metadata of one execution; empty while loading or on error. */
export function useExecutionScreenshots(executionId: string | null): ScreenshotMeta[] {
  const { data } = useSWR<ScreenshotMeta[]>(
    executionId ? `/api/v1/orchestrator/replication/executions/${executionId}/screenshots` : null,
    fetcher
  )

  return Array.isArray(data) ? data : []
}

const screenshotUrl = (executionId: string, vmId: number) =>
  `/api/v1/orchestrator/replication/executions/${executionId}/screenshots/${vmId}`

export function ScreenshotPreviewDialog({ executionId, shot, label, onClose }: {
  executionId: string
  shot: ScreenshotMeta | null
  label: string
  onClose: () => void
}) {
  const t = useTranslations()

  return (
    <Dialog open={!!shot} onClose={onClose} maxWidth='md' fullWidth>
      {shot && (
        <>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-computer-line' style={{ fontSize: 18, opacity: 0.7 }} />
            {label}
            <Typography variant='caption' sx={{ color: 'text.secondary', ml: 'auto' }}>
              {t('siteRecovery.screenshots.capturedAt')} {new Date(shot.captured_at).toLocaleString()}
            </Typography>
          </DialogTitle>
          <DialogContent>
            <Box
              component='img'
              src={screenshotUrl(executionId, shot.vm_id)}
              alt={label}
              sx={{ maxWidth: '100%', display: 'block', borderRadius: 1, mx: 'auto' }}
            />
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}

/** Thumbnails row for one execution's boot screenshots (test failovers). */
export default function ExecutionScreenshots({ executionId, vmNameMap }: {
  executionId: string
  vmNameMap?: Record<number, string>
}) {
  const t = useTranslations()
  const shots = useExecutionScreenshots(executionId)
  const [preview, setPreview] = useState<ScreenshotMeta | null>(null)

  if (shots.length === 0) return null

  const label = (s: ScreenshotMeta) => vmNameMap?.[s.vm_id] || `VM ${s.vm_id}`

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
      {shots.map(s => (
        <Tooltip
          key={s.vm_id}
          title={`${label(s)} · ${t('siteRecovery.screenshots.capturedAt')} ${new Date(s.captured_at).toLocaleString()}`}
          arrow
        >
          <Box
            component='img'
            src={screenshotUrl(executionId, s.vm_id)}
            alt={label(s)}
            onClick={() => setPreview(s)}
            sx={{
              height: 40,
              borderRadius: 0.5,
              border: '1px solid',
              borderColor: 'divider',
              cursor: 'pointer',
              display: 'block',
              '&:hover': { borderColor: 'primary.main' }
            }}
          />
        </Tooltip>
      ))}
      <ScreenshotPreviewDialog
        executionId={executionId}
        shot={preview}
        label={preview ? label(preview) : ''}
        onClose={() => setPreview(null)}
      />
    </Box>
  )
}
