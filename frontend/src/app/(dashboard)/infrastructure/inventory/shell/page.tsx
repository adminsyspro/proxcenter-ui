'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Box, CircularProgress, Typography, Button } from '@mui/material'

import XTermShell from '@/components/xterm/XTermShell'

interface TerminalData {
  ticket: string
  port: number
  host: string
  nodePort: number
  apiToken?: string
  wsUrl: string
}

export default function NodeShellPage() {
  const searchParams = useSearchParams()
  const connId = searchParams.get('connId')
  const node = searchParams.get('node')

  const [termData, setTermData] = useState<TerminalData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!connId || !node) {
      setError('Missing connId or node parameter')
      setLoading(false)
      return
    }

    const initTerminal = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/terminal`, {
          method: 'POST'
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }

        const json = await res.json()
        setTermData(json.data)
      } catch (e: any) {
        setError(e.message || 'Failed to create terminal session')
      } finally {
        setLoading(false)
      }
    }

    initTerminal()
  }, [connId, node])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0c0c0c' }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={32} sx={{ color: '#22c55e' }} />
          <Typography sx={{ mt: 2, color: '#888', fontSize: 13 }}>
            Connecting to {node}...
          </Typography>
        </Box>
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', bgcolor: '#0c0c0c' }}>
        <Box sx={{ textAlign: 'center' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 48, color: '#ef4444' }} />
          <Typography sx={{ mt: 2, color: '#fecaca', fontSize: 14 }}>
            {error}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.close()}
            sx={{ mt: 2, color: '#888', borderColor: '#444', '&:hover': { borderColor: '#666', bgcolor: '#333' } }}
          >
            Close
          </Button>
        </Box>
      </Box>
    )
  }

  if (!termData) return null

  return (
    <Box sx={{ height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <XTermShell
        wsUrl={termData.wsUrl}
        host={termData.host}
        port={termData.port}
        ticket={termData.ticket}
        node={node!}
        pvePort={termData.nodePort}
        apiToken={termData.apiToken}
        onDisconnect={() => window.close()}
      />
    </Box>
  )
}
