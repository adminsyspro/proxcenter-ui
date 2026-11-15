'use client'

import { Box, CircularProgress } from '@mui/material'

import type { MicrosegRun } from '@/lib/microseg/types'

import MicrosegErrorAlert from './MicrosegErrorAlert'
import { OneLine } from './dialogParts'

type Props = {
  /** The run being followed (null before its first answer). */
  run: MicrosegRun | null
  /** A failed poll: the run is still followed, the error says why the answer is late. */
  error: unknown
  runningText: string
}

/** One line while a run is going on; nothing once it has ended (its outcome is drawn by the caller). */
export default function RunProgress({ run, error, runningText }: Props) {
  if (run && run.status !== 'running') return null
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, minHeight: 40 }}>
        <CircularProgress size={18} />
        <OneLine text={runningText} />
      </Box>
      {!!error && <MicrosegErrorAlert error={error} />}
    </Box>
  )
}
