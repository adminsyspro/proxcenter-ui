'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'

interface Props {
  connId: string
}

export default function ClusterSdnVNetFirewallPanel({ connId }: Props) {
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="info">VNet Firewall panel (connId={connId}) — not implemented yet</Alert>
    </Box>
  )
}
