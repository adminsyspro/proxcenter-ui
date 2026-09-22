'use client'

import Box from '@mui/material/Box'

/**
 * The Corosync column of the cluster nodes table: one line per link, in link
 * order, prefixed with Proxmox's own linkN naming once a node has several.
 * A dash when the node has no corosync at all (standalone) or its
 * configuration could not be read: never the management address in its place.
 */
export default function CorosyncLinksCell({ links }: { links?: string[] | null }) {
  const sx = { fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }

  if (!Array.isArray(links) || links.length === 0) {
    return <Box sx={sx}>—</Box>
  }

  return (
    <Box sx={sx}>
      {links.map((addr, idx) => (
        <Box key={`${addr}-${idx}`} component="div">
          {links.length > 1 && <Box component="span" sx={{ opacity: 0.6, mr: 0.75 }}>link{idx}</Box>}
          {addr}
        </Box>
      ))}
    </Box>
  )
}
