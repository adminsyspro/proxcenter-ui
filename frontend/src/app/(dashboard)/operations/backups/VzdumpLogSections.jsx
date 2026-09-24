'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, FormControlLabel, Stack, Switch, Typography } from '@mui/material'

import { guestStatusChip, isProgressLine, logLineKind } from '@/lib/backups/runDisplay'
import { rawLines } from '@/lib/backups/vzdumpLog'

const LINE_COLOR = { error: 'error.main', warning: 'warning.main', info: 'text.primary' }

function LogLines({ lines, showProgress }) {
  const visible = showProgress ? lines : lines.filter(l => !isProgressLine(l.t))

  return (
    <Box component="pre" sx={{ m: 0, p: 1.5, fontSize: '0.75rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', bgcolor: 'action.hover', borderRadius: 1, maxHeight: 420, overflow: 'auto' }}>
      {visible.map(l => (
        <Box key={l.n} component="span" sx={{ display: 'block', color: LINE_COLOR[logLineKind(l.t)], fontWeight: logLineKind(l.t) === 'info' ? 400 : 600 }}>
          {l.t}
        </Box>
      ))}
    </Box>
  )
}

export default function VzdumpLogSections({ log, node }) {
  const t = useTranslations()
  const [raw, setRaw] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const all = useMemo(() => rawLines(log), [log])

  const copy = () => navigator.clipboard?.writeText(all.map(l => l.t).join('\n'))

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <FormControlLabel control={<Switch size="small" checked={raw} onChange={e => setRaw(e.target.checked)} />} label={t('backups.runs.rawLog')} />
        <FormControlLabel control={<Switch size="small" checked={showProgress} onChange={e => setShowProgress(e.target.checked)} />} label={t('backups.runs.showProgress')} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<i className="ri-file-copy-line" />} onClick={copy}>{t('backups.runs.copyLog')}</Button>
      </Stack>

      {raw ? (
        <LogLines lines={all} showProgress={showProgress} />
      ) : (
        <>
          {log.guests.map(g => {
            const chip = guestStatusChip(g)
            const open = g.status === 'failed' || g.status === 'post_step_failed'

            return (
              <Accordion key={`${node}-${g.vmid}-${g.lines[0]?.n ?? 0}`} defaultExpanded={open} disableGutters>
                <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" />}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.vmid}{g.name ? ` · ${g.name}` : ''}</Typography>
                    <Chip size="small" color={chip.color} label={t(chip.key)} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails><LogLines lines={g.lines} showProgress={showProgress} /></AccordionDetails>
              </Accordion>
            )
          })}
          <Accordion disableGutters defaultExpanded={log.guests.length === 0}>
            <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" />}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('backups.runs.jobSection')}</Typography>
            </AccordionSummary>
            <AccordionDetails><LogLines lines={log.jobLines} showProgress={showProgress} /></AccordionDetails>
          </Accordion>
        </>
      )}
    </Box>
  )
}
