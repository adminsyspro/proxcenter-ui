'use client'

import { useEffect, useState, useMemo } from 'react'
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
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

interface CveEntry {
  cveId: string
  package: string
  installedVersion: string
  fixedVersion: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  description: string
  node: string
  publishedAt: string
}

interface CveTabProps {
  connectionId: string
  node?: string
  available: boolean
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#d32f2f',
  high: '#ed6c02',
  medium: '#fbc02d',
  low: '#9e9e9e',
}

export default function CveTab({ connectionId, node, available }: CveTabProps) {
  const t = useTranslations('cve')
  const theme = useTheme()
  const [cves, setCves] = useState<CveEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [lastScan, setLastScan] = useState<string | null>(null)
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(['critical', 'high', 'medium', 'low']))

  const fetchCves = async () => {
    setLoading(true)
    try {
      const url = node
        ? `/api/v1/cve/${connectionId}?node=${encodeURIComponent(node)}`
        : `/api/v1/cve/${connectionId}`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setCves(data.vulnerabilities || [])
        setLastScan(data.lastScan || null)
      }
    } catch (e) {
      console.error('Failed to fetch CVEs:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (available) {
      fetchCves()
    } else {
      setLoading(false)
    }
  }, [connectionId, node, available])

  const handleScan = async () => {
    setScanning(true)
    // Simulate scan delay
    await new Promise(r => setTimeout(r, 2000))
    await fetchCves()
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
  }

  const counts = useMemo(() => {
    const c = { critical: 0, high: 0, medium: 0, low: 0 }
    for (const cve of cves) {
      c[cve.severity]++
    }
    return c
  }, [cves])

  const filteredCves = useMemo(() => {
    return cves
      .filter(cve => activeFilters.has(cve.severity))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4))
  }, [cves, activeFilters])

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

  if (cves.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8 }}>
        <i className="ri-checkbox-circle-line" style={{ fontSize: 48, color: theme.palette.success.main, marginBottom: 16 }} />
        <Typography variant="body1" fontWeight={600}>
          {t('noVulnerabilities')}
        </Typography>
        {lastScan && (
          <Typography variant="caption" sx={{ mt: 1, opacity: 0.6 }}>
            {t('lastScan', { date: new Date(lastScan).toLocaleString() })}
          </Typography>
        )}
        <Button
          variant="outlined"
          size="small"
          startIcon={<i className="ri-radar-line" />}
          onClick={handleScan}
          disabled={scanning}
          sx={{ mt: 2 }}
        >
          {scanning ? t('scanning') : t('scanNow')}
        </Button>
      </Box>
    )
  }

  return (
    <Box>
      {/* Header: severity chips + scan button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
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
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {lastScan && (
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {t('lastScan', { date: new Date(lastScan).toLocaleString() })}
            </Typography>
          )}
          <Button
            variant="outlined"
            size="small"
            startIcon={<i className="ri-radar-line" />}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? t('scanning') : t('scanNow')}
          </Button>
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
              <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>{t('columns.published')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredCves.map(cve => (
              <TableRow
                key={cve.cveId}
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
                      fontFamily: 'monospace',
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
                  <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'monospace', opacity: 0.7 }}>
                    {cve.installedVersion}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'monospace', color: 'success.main', fontWeight: 600 }}>
                    {cve.fixedVersion}
                  </Typography>
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
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{cve.node}</Typography>
                  </TableCell>
                )}
                <TableCell>
                  <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>
                    {new Date(cve.publishedAt).toLocaleDateString()}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
