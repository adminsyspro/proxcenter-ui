'use client'

import { useEffect, useState } from 'react'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'

import { useTranslations } from 'next-intl'

interface NodeUpdateOutputProps {
  /** Raw apt output captured by the orchestrator for one node. */
  output?: string | null
  /** Open the panel on first render (a failed node). */
  defaultExpanded?: boolean
  nodeName: string
}

/**
 * Collapsible apt output of one node of a rolling update. The orchestrator
 * already persisted and served `update_output`; the wizard never read it, so a
 * run that died on `exit status 100` showed nothing while the 401 on the
 * enterprise repository was sitting in this field (ui#814).
 */
export default function NodeUpdateOutput({ output, defaultExpanded = false, nodeName }: NodeUpdateOutputProps) {
  const t = useTranslations()
  const [expanded, setExpanded] = useState(defaultExpanded)

  // A node that fails after the panel mounted must open too.
  useEffect(() => {
    if (defaultExpanded) setExpanded(true)
  }, [defaultExpanded])

  if (!output) return null

  const panelId = `rolling-update-output-${nodeName}`

  return (
    <Box sx={{ pl: 5, pr: 2, pb: 1 }}>
      <Button
        size='small'
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        startIcon={<i className={expanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 18 }} />}
      >
        {expanded ? t('updates.hideUpdateOutput') : t('updates.showUpdateOutput')}
      </Button>
      {expanded && (
        <Box
          id={panelId}
          component='pre'
          data-testid={panelId}
          sx={{
            m: 0,
            mt: 0.5,
            p: 1,
            maxHeight: 240,
            overflow: 'auto',
            bgcolor: 'background.default',
            borderRadius: 1,
            fontFamily: 'monospace',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all'
          }}
        >
          {output}
        </Box>
      )}
    </Box>
  )
}
