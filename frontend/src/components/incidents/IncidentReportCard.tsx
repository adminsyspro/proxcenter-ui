'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'

import { dateStamp } from '@/lib/export/download'
import type { IncidentView } from '@/lib/incidents/types'

import IncidentSection from './IncidentSection'

/** The file name the route gives, else a dated one. */
function fileName(res: Response): string {
  const match = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')

  return match?.[1] ?? `incident-${dateStamp()}.pdf`
}

/** The card that downloads the incident as a PDF to share. */
export default function IncidentReportCard({ view }: Readonly<{ view: IncidentView }>) {
  const t = useTranslations('incidents.report')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const download = async () => {
    setBusy(true)
    setFailed(false)

    try {
      const res = await fetch(`/api/v1/incidents/${encodeURIComponent(view.id)}/report`)

      if (!res.ok) throw new Error(String(res.status))

      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')

      a.href = url
      a.download = fileName(res)
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <IncidentSection icon='ri-file-pdf-2-line' title={t('title')} description={t('description')}>
      {view.status !== 'closed' && (
        <Typography variant='caption' color='text.secondary' sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-draft-line' aria-hidden='true' />
          {t('draftHint')}
        </Typography>
      )}
      {failed && <Alert severity='error' onClose={() => setFailed(false)}>{t('failed')}</Alert>}
      <Box>
        <Button
          variant='outlined'
          disabled={busy}
          onClick={download}
          startIcon={busy ? <CircularProgress size={16} /> : <i className='ri-download-2-line' aria-hidden='true' />}
        >
          {t('download')}
        </Button>
      </Box>
    </IncidentSection>
  )
}
