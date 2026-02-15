'use client'

import React, { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Chip, CircularProgress, LinearProgress, Typography } from '@mui/material'

import { formatBytes } from '@/utils/format'

function StoragePoolsWidget({ data, loading, config }) {
  const t = useTranslations()
  const [storages, setStorages] = useState([])
  const [loadingStorages, setLoadingStorages] = useState(true)

  useEffect(() => {
    const fetchStorages = async () => {
      try {
        // Récupérer les storages de toutes les connexions
        const connRes = await fetch('/api/v1/connections?type=pve')

        if (!connRes.ok) return
        const connJson = await connRes.json()
        const connections = connJson?.data || []

        const allStorages = []
        
        await Promise.all(connections.map(async (conn) => {
          try {
            const res = await fetch(`/api/v1/connections/${encodeURIComponent(conn.id)}/storage`)

            if (res.ok) {
              const json = await res.json()
              const storageList = Array.isArray(json?.data) ? json.data : []

              storageList.forEach(s => {
                if (s.total && s.total > 0) {
                  allStorages.push({
                    ...s,
                    connectionName: conn.name,
                    connectionId: conn.id,
                  })
                }
              })
            }
          } catch (e) {
            console.error(`Failed to fetch storage for ${conn.id}:`, e)
          }
        }))

        // Trier par utilisation décroissante
        allStorages.sort((a, b) => {
          const aUsage = a.total ? (a.used / a.total) : 0
          const bUsage = b.total ? (b.used / b.total) : 0

          
return bUsage - aUsage
        })

        setStorages(allStorages)
      } catch (e) {
        console.error('Failed to fetch storages:', e)
      } finally {
        setLoadingStorages(false)
      }
    }

    fetchStorages()
  }, [])

  if (loadingStorages) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (storages.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 0.5 }}>
      {storages.slice(0, 8).map((storage, idx) => {
        const usagePct = storage.total ? Math.round((storage.used / storage.total) * 100) : 0
        const color = usagePct > 90 ? '#f44336' : usagePct > 75 ? '#ff9800' : '#4caf50'

        return (
          <Box 
            key={idx} 
            sx={{ 
              py: 0.75, 
              borderBottom: idx < storages.length - 1 ? '1px solid' : 'none',
              borderColor: 'divider'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <i className='ri-hard-drive-2-line' style={{ fontSize: 14, opacity: 0.6 }} />
                <Typography variant='caption' sx={{ fontWeight: 700, fontSize: 11 }}>
                  {storage.storage}
                </Typography>
                <Chip
                  size='small'
                  label={storage.type || 'dir'}
                  sx={{ height: 16, fontSize: 9, opacity: 0.7 }}
                />
              </Box>
            </Box>
            <Box sx={{ position: 'relative' }}>
              <LinearProgress
                variant='determinate'
                value={usagePct}
                sx={{
                  height: 14, borderRadius: 0, bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
                  '& .MuiLinearProgress-bar': { borderRadius: 0, background: 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)', backgroundSize: usagePct > 0 ? `${(100 / usagePct) * 100}% 100%` : '100% 100%' }
                }}
              />
              <Typography variant='caption' sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>{usagePct}%</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
              <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
                {storage.connectionName}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>
                {formatBytes(storage.used)} / {formatBytes(storage.total)}
              </Typography>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default React.memo(StoragePoolsWidget)
