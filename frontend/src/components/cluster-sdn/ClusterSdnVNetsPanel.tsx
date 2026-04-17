'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

interface Props {
  connId: string
}

export default function ClusterSdnVNetsPanel({ connId }: Props) {
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="info">VNets panel (connId={connId}) — not implemented yet</Alert>
    </Box>
  )
}
