'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

interface Props {
  connId: string
}

export default function ClusterSdnIpamPanel({ connId }: Props) {
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="info">IPAM panel (connId={connId}) — not implemented yet</Alert>
    </Box>
  )
}
