'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  Chip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

interface CveEntry {
  cveId: string
  package: string
  installedVersion: string
  fixedVersion: string
  // Absent when the orchestrator predates the ui#905 fix; a published fixed
  // version is then the only signal that the finding is actionable.
  fixAvailable?: boolean
  noDsaReason?: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  node: string
  publishedAt: string
}

interface NodeScan {
  node: string
  release: string
  source: 'ssh' | 'api' | ''
  packagesScanned: number
  packagesTracked: number
  fixable: number
  noFix: number
  error?: string
  warning?: string
  warningDetail?: string
}

interface CveTabProps {
  connectionId: string
  node?: string
  available: boolean
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

const hasFix = (cve: CveEntry) => cve.fixAvailable ?? Boolean(cve.fixedVersion)

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#d32f2f',
  high: '#ed6c02',
  medium: '#fbc02d',
  low: '#9e9e9e',
}

export default function CveTab({ connectionId, node, available }: CveTabProps) {
  const t = useTranslations('cve')
  const tCommon = useTranslations('common')
  const theme = useTheme()
  const [cves, setCves] = useState<CveEntry[]>([])
  const [nodes, setNodes] = useState<NodeScan[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(SEVERITIES))
  // CVEs Debian has not fixed yet are real findings but there is nothing to
  // act on today, and they outnumber the actionable ones by two orders of
  // magnitude. They stay one click away instead of burying the fixable list.
  const [showNoFix, setShowNoFix] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)

  const url = node
    ? `/api/v1/cve/${connectionId}?node=${encodeURIComponent(node)}`
    : `/api/v1/cve/${connectionId}`

  const load = useCallback(async (method: 'GET' | 'POST') => {
    try {
      const res = await fetch(url, { method })
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        // An empty table used to be shown for a failed scan too, so a
        // connection with no outbound access to the Debian tracker looked
        // exactly like a cluster with nothing to patch.
        setError(data?.error || `HTTP ${res.status}`)
        setCves([])
        setNodes([])
        return
      }

      setError(null)
      setCves(data?.vulnerabilities || [])
      setNodes(data?.nodes || [])
      setLastScan(data?.lastScan || null)
      setPage(0)
    } catch (e: any) {
      setError(e?.message || 'Network error')
      setCves([])
      setNodes([])
    }
  }, [url])

  useEffect(() => {
    if (!available) {
      setLoading(false)
      return
    }
    setLoading(true)
    load('GET').finally(() => setLoading(false))
  }, [available, load])

  const handleScan = async () => {
    setScanning(true)
    await load('POST')
    setScanning(false)
  }

  const toggleFilter = (severity: string) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(severity)) {
        next.delete(severity)
      } else {
        next.add(severity)
      }
      return next
    })
    setPage(0)
  }

  const visibleByFix = useMemo(
    () => cves.filter(cve => showNoFix || hasFix(cve)),
    [cves, showNoFix]
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const cve of visibleByFix) {
      c[cve.severity]++
    }
    return c
  }, [visibleByFix])

  const fixCounts = useMemo(() => {
    let fixable = 0
    for (const cve of cves) {
      if (hasFix(cve)) fixable++
    }
    return { fixable, noFix: cves.length - fixable }
  }, [cves])

  const filteredCves = useMemo(() => {
    return visibleByFix
      .filter(cve => activeFilters.has(cve.severity))
      .sort((a, b) => {
        // Actionable findings first, then by severity.
        if (hasFix(a) !== hasFix(b)) return hasFix(a) ? -1 : 1
        return (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4)
      })
  }, [visibleByFix, activeFilters])

  const pagedCves = useMemo(
    () => filteredCves.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredCves, page, rowsPerPage]
  )

  // Coverage tells a clean cluster apart from a scan that saw almost nothing.
  const coverage = useMemo(() => {
    const scanned = nodes.reduce((sum, n) => sum + (n.packagesScanned || 0), 0)
    const tracked = nodes.reduce((sum, n) => sum + (n.packagesTracked || 0), 0)
    const degraded = nodes.filter(n => n.warning || n.error)
    const release = nodes.find(n => n.release)?.release || ''
    const full = nodes.every(n => n.source === 'ssh' && !n.error)
    return { scanned, tracked, degraded, release, full, known: nodes.length > 0 }
  }, [nodes])

  const degradedNode = coverage.degraded[0]
  const degradedCode = degradedNode?.error || degradedNode?.warning || ''
  const degradedLabel = degradedCode
    ? t(`status.${degradedCode}`, { node: degradedNode.node, release: degradedNode.release || '?' })
    : ''

  if (!available) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, opacity: 0.5 }}>
        <i className="ri-shield-cross-line" style={{ fontSize: 48, marginBottom: 16 }} />
        <Typography variant="body1" fontWeight={600}>
          {t('title')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>
          Enterprise feature
        </Typography>
      </Box>
    )
  }

  if (loading) {
    return (
      <Box>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} variant="rounded" width={90} height={28} />
          ))}
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {[1, 2, 3, 4, 5, 6, 7].map(i => (
                  <TableCell key={i}><Skeleton width={80} /></TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {[1, 2, 3, 4, 5].map(row => (
                <TableRow key={row}>
                  {[1, 2, 3, 4, 5, 6, 7].map(i => (
                    <TableCell key={i}><Skeleton width={60 + Math.random() * 40} /></TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    )
  }

  const scanButton = (
    <Button
      variant="outlined"
      size="small"
      startIcon={<i className="ri-radar-line" />}
      onClick={handleScan}
      disabled={scanning}
    >
      {scanning ? t('scanning') : t('scanNow')}
    </Button>
  )

  if (error) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <Box sx={{ color: 'error.main', mb: 2, display: 'flex' }}>
          <i className="ri-error-warning-line" style={{ fontSize: 48 }} />
        </Box>
        <Typography variant="body1" fontWeight={600}>
          {t('scanFailed')}
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, opacity: 0.7, maxWidth: 560, textAlign: 'center' }}>
          {error}
        </Typography>
        <Box sx={{ mt: 2 }}>{scanButton}</Box>
      </Box>
    )
  }

  if (cves.length === 0) {
    const partial = coverage.known && !coverage.full
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <Box sx={{ color: partial ? 'warning.main' : 'success.main', mb: 2, display: 'flex' }}>
          <i className={partial ? 'ri-shield-keyhole-line' : 'ri-checkbox-circle-line'} style={{ fontSize: 48 }} />
        </Box>
        <Typography variant="body1" fontWeight={600}>
          {partial ? t('partialScan') : t('noVulnerabilities')}
        </Typography>
        {coverage.known && (
          <Typography variant="body2" sx={{ mt: 1, opacity: 0.7, maxWidth: 620, textAlign: 'center' }}>
            {t('coverage', { scanned: coverage.scanned, tracked: coverage.tracked })}
          </Typography>
        )}
        {degradedLabel && (
          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.7, maxWidth: 620, textAlign: 'center' }}>
            {degradedLabel}
          </Typography>
        )}
        {lastScan && (
          <Typography variant="caption" sx={{ mt: 1, opacity: 0.6 }}>
            {t('lastScan', { date: new Date(lastScan).toLocaleString() })}
          </Typography>
        )}
        <Box sx={{ mt: 2 }}>{scanButton}</Box>
      </Box>
    )
  }

  return (
    <Box>
      {/* Header: severity chips, fix filter, coverage and scan button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {SEVERITIES.map(sev => (
            <Chip
              key={sev}
              label={`${t(`severity.${sev}`)} (${counts[sev]})`}
              size="small"
              onClick={() => toggleFilter(sev)}
              sx={{
                height: 28,
                fontSize: 12,
                fontWeight: 600,
                bgcolor: activeFilters.has(sev) ? alpha(SEVERITY_COLORS[sev], 0.15) : 'action.hover',
                color: activeFilters.has(sev) ? SEVERITY_COLORS[sev] : 'text.disabled',
                border: '1px solid',
                borderColor: activeFilters.has(sev) ? alpha(SEVERITY_COLORS[sev], 0.4) : 'divider',
                cursor: 'pointer',
                '&:hover': { bgcolor: alpha(SEVERITY_COLORS[sev], 0.25) },
              }}
            />
          ))}
          {fixCounts.noFix > 0 && (
            <Chip
              label={t('noFixFilter', { count: fixCounts.noFix })}
              size="small"
              onClick={() => { setShowNoFix(v => !v); setPage(0) }}
              sx={{
                height: 28,
                fontSize: 12,
                fontWeight: 600,
                bgcolor: showNoFix ? 'action.selected' : 'action.hover',
                color: showNoFix ? 'text.primary' : 'text.disabled',
                border: '1px solid',
                borderColor: 'divider',
                cursor: 'pointer',
              }}
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {coverage.known && (
            <Tooltip title={degradedLabel || ''} disableHoverListener={!degradedLabel}>
              <Typography
                variant="caption"
                sx={{ opacity: degradedLabel ? 0.9 : 0.5, color: degradedLabel ? 'warning.main' : 'inherit', display: 'flex', alignItems: 'center', gap: 0.5 }}
              >
                {degradedLabel && <i className="ri-error-warning-line" style={{ fontSize: 14 }} />}
                {t('coverage', { scanned: coverage.scanned, tracked: coverage.tracked })}
              </Typography>
            </Tooltip>
          )}
          {lastScan && (
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {t('lastScan', { date: new Date(lastScan).toLocaleString() })}
            </Typography>
          )}
          {scanButton}
        </Box>
      </Box>

      {/* CVE Table */}
      <TableContainer sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.cveId')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.package')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.installed')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.fixed')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.severity')}</TableCell>
              {!node && <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.node')}</TableCell>}
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.description')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pagedCves.map(cve => (
              <TableRow
                key={`${cve.cveId}-${cve.package}-${cve.node}`}
                sx={{
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:last-child td': { borderBottom: 'none' },
                }}
              >
                <TableCell>
                  <Typography
                    component="a"
                    href={`https://nvd.nist.gov/vuln/detail/${cve.cveId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: 'primary.main',
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {cve.cveId}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontSize: 12 }}>{cve.package}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.7 }}>
                    {cve.installedVersion}
                  </Typography>
                </TableCell>
                <TableCell>
                  {hasFix(cve) ? (
                    <Typography variant="body2" sx={{ fontSize: 11, color: 'success.main', fontWeight: 600 }}>
                      {cve.fixedVersion}
                    </Typography>
                  ) : (
                    <Tooltip title={cve.noDsaReason || ''} disableHoverListener={!cve.noDsaReason}>
                      <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>
                        {t('noFix')}
                      </Typography>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`severity.${cve.severity}`)}
                    sx={{
                      height: 22,
                      fontSize: 11,
                      fontWeight: 600,
                      bgcolor: alpha(SEVERITY_COLORS[cve.severity], 0.15),
                      color: SEVERITY_COLORS[cve.severity],
                      border: '1px solid',
                      borderColor: alpha(SEVERITY_COLORS[cve.severity], 0.3),
                    }}
                  />
                </TableCell>
                {!node && (
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Box sx={{ position: 'relative', display: 'inline-flex', width: 14, height: 14, flexShrink: 0 }}>
                        <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} style={{ opacity: 0.8 }} />
                        <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: '#4caf50', border: '1.5px solid', borderColor: 'background.paper' }} />
                      </Box>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{cve.node}</Typography>
                    </Box>
                  </TableCell>
                )}
                <TableCell sx={{ maxWidth: 360 }}>
                  <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {cve.description || '—'}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        component="div"
        count={filteredCves.length}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[20, 50, 100]}
        labelRowsPerPage={tCommon('rowsPerPage')}
        onPageChange={(_, value) => setPage(value)}
        onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
      />
    </Box>
  )
}
