'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material'
import PbsStatusChip from './PbsStatusChip'

interface PbsTapeBackupTabProps {
  pbsId: string
}

type TapeDrive = {
  name?: string
  path?: string
  changer?: string
  'changer-drivenum'?: number | string
}

type TapeChanger = {
  name?: string
  path?: string
  'export-slots'?: string
}

type MediaPool = {
  name?: string
  allocation?: string
  retention?: string
  template?: string
  encrypt?: boolean | number | string
  comment?: string
}

type TapeJob = {
  id?: string
  store?: string
  pool?: string
  drive?: string
  schedule?: string
  comment?: string
}

type TapeMedia = {
  'label-text'?: string
  label?: string
  pool?: string
  location?: string
  status?: string
  'expired-at'?: number | string
  'expire-date'?: number | string
  expires?: number | string
}

type FetchResult<T> = {
  data: T[]
  notSupported: boolean
}

function formatDate(value: number | string | undefined): string {
  if (value === undefined || value === null || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n) || (n as number) <= 0) return String(value)
  try {
    return new Date((n as number) * 1000).toLocaleString()
  } catch {
    return String(value)
  }
}

function isEnabled(value: boolean | number | string | undefined): boolean {
  if (value === true) return true
  if (value === 1) return true
  if (typeof value === 'string' && (value === '1' || value.toLowerCase() === 'true')) return true
  return false
}

export default function PbsTapeBackupTab({ pbsId }: PbsTapeBackupTabProps) {
  const t = useTranslations()

  const [subTab, setSubTab] = useState<number>(0)

  const [drives, setDrives] = useState<FetchResult<TapeDrive>>({ data: [], notSupported: false })
  const [changers, setChangers] = useState<FetchResult<TapeChanger>>({ data: [], notSupported: false })
  const [pools, setPools] = useState<FetchResult<MediaPool>>({ data: [], notSupported: false })
  const [jobs, setJobs] = useState<FetchResult<TapeJob>>({ data: [], notSupported: false })
  const [media, setMedia] = useState<FetchResult<TapeMedia>>({ data: [], notSupported: false })

  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [dRes, cRes, pRes, jRes, mRes] = await Promise.all([
        fetch(`/api/v1/pbs/${pbsId}/tape/drives`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/tape/changers`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/tape/media-pools`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/tape/jobs`, { cache: 'no-store' }),
        fetch(`/api/v1/pbs/${pbsId}/tape/media`, { cache: 'no-store' }),
      ])

      for (const r of [dRes, cRes, pRes, jRes, mRes]) {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body?.error || `HTTP ${r.status}`)
        }
      }

      const [dBody, cBody, pBody, jBody, mBody] = await Promise.all([
        dRes.json(),
        cRes.json(),
        pRes.json(),
        jRes.json(),
        mRes.json(),
      ])

      setDrives({ data: Array.isArray(dBody?.data) ? dBody.data : [], notSupported: Boolean(dBody?.notSupported) })
      setChangers({ data: Array.isArray(cBody?.data) ? cBody.data : [], notSupported: Boolean(cBody?.notSupported) })
      setPools({ data: Array.isArray(pBody?.data) ? pBody.data : [], notSupported: Boolean(pBody?.notSupported) })
      setJobs({ data: Array.isArray(jBody?.data) ? jBody.data : [], notSupported: Boolean(jBody?.notSupported) })
      setMedia({ data: Array.isArray(mBody?.data) ? mBody.data : [], notSupported: Boolean(mBody?.notSupported) })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [pbsId])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const allNotSupported =
    drives.notSupported &&
    changers.notSupported &&
    pools.notSupported &&
    jobs.notSupported &&
    media.notSupported

  const emptyState = (icon: string, title: string, hint?: string) => (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        py: 6,
        opacity: 0.7,
        gap: 1.5,
      }}
    >
      <i className={icon} style={{ fontSize: 64 }} />
      <Typography variant="h6" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {hint && (
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {hint}
        </Typography>
      )}
    </Box>
  )

  const encryptionChip = (encrypt: boolean | number | string | undefined) =>
    isEnabled(encrypt) ? (
      <PbsStatusChip color="success" label={t('inventory.pbsTapeEncYes')} sx={{ fontSize: 11 }} />
    ) : (
      <Chip size="small" label={t('inventory.pbsTapeEncNo')} variant="outlined" sx={{ fontSize: 11 }} />
    )

  // If initial load failed, show error
  if (error) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={fetchAll}>
              {t('inventory.pbsTapeRefresh')}
            </Button>
          }
        >
          {t('inventory.pbsTapeLoadError')}: {error}
        </Alert>
      </Box>
    )
  }

  // If still loading initially
  if (
    loading &&
    drives.data.length === 0 &&
    changers.data.length === 0 &&
    pools.data.length === 0 &&
    jobs.data.length === 0 &&
    media.data.length === 0 &&
    !drives.notSupported &&
    !changers.notSupported &&
    !pools.notSupported &&
    !jobs.notSupported &&
    !media.notSupported
  ) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, py: 6 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  // If all 5 endpoints return notSupported, show friendly info
  if (allNotSupported) {
    return (
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 2,
          }}
        >
          <Button
            variant="outlined"
            size="small"
            onClick={fetchAll}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsTapeRefresh')}
          </Button>
        </Box>
        <Card variant="outlined" sx={{ mx: 'auto', maxWidth: 640 }}>
          <CardContent sx={{ textAlign: 'center', py: 5 }}>
            <i className="ri-hard-drive-3-line" style={{ fontSize: 56, opacity: 0.6 }} />
            <Typography variant="h6" sx={{ fontWeight: 700, mt: 2 }}>
              {t('inventory.pbsTapeNotSupported')}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, mt: 1 }}>
              {t('inventory.pbsTapeEmptyHint')}
            </Typography>
          </CardContent>
        </Card>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={fetchAll}
            disabled={loading}
            startIcon={<i className="ri-refresh-line" style={{ fontSize: 16 }} />}
          >
            {t('inventory.pbsTapeRefresh')}
          </Button>
        </Stack>
      </Box>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_e, v) => setSubTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none' },
        }}
      >
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-hard-drive-3-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsTapeDrives')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-swap-box-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsTapeChangers')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-stack-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsTapeMediaPools')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-calendar-todo-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsTapeJobs')}
            </Box>
          }
        />
        <Tab
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <i className="ri-disc-line" style={{ fontSize: 15 }} />
              {t('inventory.pbsTapeMedia')}
            </Box>
          }
        />
      </Tabs>

      {/* Drives */}
      {subTab === 0 && (
        drives.data.length === 0 ? (
          emptyState(
            'ri-hard-drive-3-line',
            t('inventory.pbsTapeEmptyDrives'),
            t('inventory.pbsTapeEmptyHint')
          )
        ) : (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsTapeDrivesCol.name')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeDrivesCol.path')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeDrivesCol.changer')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeDrivesCol.driveNumber')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {drives.data.map((d, idx) => (
                  <TableRow key={d.name || `drv-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {d.name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{d.path || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{d.changer || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">
                        {d['changer-drivenum'] !== undefined && d['changer-drivenum'] !== ''
                          ? String(d['changer-drivenum'])
                          : '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Changers */}
      {subTab === 1 && (
        changers.data.length === 0 ? (
          emptyState(
            'ri-swap-box-line',
            t('inventory.pbsTapeEmptyChangers'),
            t('inventory.pbsTapeEmptyHint')
          )
        ) : (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsTapeChangersCol.name')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeChangersCol.path')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeChangersCol.exportSlots')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {changers.data.map((c, idx) => (
                  <TableRow key={c.name || `chg-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {c.name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{c.path || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{c['export-slots'] || '—'}</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Media pools */}
      {subTab === 2 && (
        pools.data.length === 0 ? (
          emptyState(
            'ri-stack-line',
            t('inventory.pbsTapeEmptyPools'),
            t('inventory.pbsTapeEmptyHint')
          )
        ) : (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsTapePoolsCol.name')}</TableCell>
                  <TableCell>{t('inventory.pbsTapePoolsCol.allocation')}</TableCell>
                  <TableCell>{t('inventory.pbsTapePoolsCol.retention')}</TableCell>
                  <TableCell>{t('inventory.pbsTapePoolsCol.template')}</TableCell>
                  <TableCell>{t('inventory.pbsTapePoolsCol.encryption')}</TableCell>
                  <TableCell>{t('inventory.pbsTapePoolsCol.comment')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {pools.data.map((p, idx) => (
                  <TableRow key={p.name || `pool-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {p.name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{p.allocation || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{p.retention || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{p.template || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{encryptionChip(p.encrypt)}</TableCell>
                    <TableCell sx={{ fontSize: 12, maxWidth: 260 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.comment || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Backup jobs */}
      {subTab === 3 && (
        jobs.data.length === 0 ? (
          emptyState(
            'ri-calendar-todo-line',
            t('inventory.pbsTapeEmptyJobs'),
            t('inventory.pbsTapeEmptyHint')
          )
        ) : (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsTapeJobsCol.id')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeJobsCol.store')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeJobsCol.pool')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeJobsCol.drive')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeJobsCol.schedule')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeJobsCol.comment')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.data.map((j, idx) => (
                  <TableRow key={j.id || `job-${idx}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption" sx={{ fontWeight: 600 }}>
                        {j.id || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{j.store || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{j.pool || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{j.drive || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12 }}>
                      <Typography variant="caption">{j.schedule || '—'}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, maxWidth: 260 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {j.comment || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* Media */}
      {subTab === 4 && (
        media.data.length === 0 ? (
          emptyState(
            'ri-disc-line',
            t('inventory.pbsTapeEmptyMedia'),
            t('inventory.pbsTapeEmptyHint')
          )
        ) : (
          <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('inventory.pbsTapeMediaCol.label')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeMediaCol.pool')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeMediaCol.location')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeMediaCol.status')}</TableCell>
                  <TableCell>{t('inventory.pbsTapeMediaCol.expire')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {media.data.map((m, idx) => {
                  const label = m['label-text'] || m.label || '—'
                  const expire = m['expire-date'] || m['expired-at'] || m.expires
                  return (
                    <TableRow key={`${label}-${idx}`} hover>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                          {label}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{m.pool || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{m.location || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{m.status || '—'}</Typography>
                      </TableCell>
                      <TableCell sx={{ fontSize: 12 }}>
                        <Typography variant="caption">{formatDate(expire)}</Typography>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}
    </Box>
  )
}
