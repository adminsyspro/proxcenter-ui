'use client'

import React, { useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

type AplTemplate = {
  template: string
  type: string
  package: string
  headline: string
  os: string
  section: string
  version: string
  description?: string
  infopage?: string
  sha512sum?: string
  architecture?: string
  source?: string
}

type TemplateDownloadDialogProps = {
  open: boolean
  onClose: () => void
  connId: string
  node: string
  storage: string
  onDownloaded: () => void
}

const osIcon = (os: string) => {
  const l = (os || '').toLowerCase()
  if (l.includes('debian') || l.includes('devuan')) return '/images/os/debian.svg'
  if (l.includes('ubuntu')) return '/images/os/ubuntu.svg'
  if (l.includes('alpine')) return '/images/os/alpine.svg'
  if (l.includes('centos') || l.includes('rocky') || l.includes('alma')) return '/images/os/centos.svg'
  if (l.includes('fedora')) return '/images/os/fedora.svg'
  if (l.includes('arch')) return '/images/os/arch.svg'
  if (l.includes('gentoo')) return '/images/os/linux.svg'
  if (l.includes('opensuse') || l.includes('suse')) return '/images/os/suse.svg'
  if (l.includes('redhat') || l.includes('rhel')) return '/images/os/redhat.svg'
  if (l.includes('freebsd')) return '/images/os/freebsd.svg'
  return null
}

export default function TemplateDownloadDialog({ open, onClose, connId, node, storage, onDownloaded }: TemplateDownloadDialogProps) {
  const [templates, setTemplates] = useState<AplTemplate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sectionFilter, setSectionFilter] = useState<string>('all')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/aplinfo`)
      .then(r => r.json())
      .then(json => {
        if (json.error) throw new Error(json.error)
        setTemplates((json.data || []).sort((a: AplTemplate, b: AplTemplate) => a.package.localeCompare(b.package)))
      })
      .catch(e => setError(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [open, connId, node])

  const sections = useMemo(() => {
    const s = new Set(templates.map(t => t.section).filter(Boolean))
    return Array.from(s).sort((a, b) => a.localeCompare(b))
  }, [templates])

  const filtered = useMemo(() => {
    let items = templates
    if (sectionFilter !== 'all') {
      items = items.filter(t => t.section === sectionFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(t =>
        t.package.toLowerCase().includes(q) ||
        t.headline?.toLowerCase().includes(q) ||
        t.os?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      )
    }
    return items
  }, [templates, search, sectionFilter])

  const handleDownload = async (tpl: AplTemplate) => {
    setDownloading(tpl.template)
    setDownloadError(null)
    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/aplinfo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storage, template: tpl.template }),
        }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onDownloaded()
      onClose()
    } catch (e: any) {
      setDownloadError(e?.message || String(e))
    } finally {
      setDownloading(null)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <i className="ri-download-cloud-2-line" style={{ fontSize: 22, opacity: 0.7 }} />{' '}
        CT Templates Repository
      </DialogTitle>
      <DialogContent sx={{ p: 0 }}>
        {/* Filters bar */}
        <Box sx={{ px: 2, py: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, flex: 1,
            border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1.5, py: 0.5,
          }}>
            <i className="ri-search-line" style={{ fontSize: 14, opacity: 0.4 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search templates..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 13, width: '100%', color: 'inherit',
                fontFamily: 'Inter, sans-serif',
              }}
            />
            {search && (
              <i className="ri-close-line" style={{ fontSize: 14, opacity: 0.4, cursor: 'pointer' }} onClick={() => setSearch('')} />
            )}
          </Box>
          <Select
            size="small"
            value={sectionFilter}
            onChange={e => setSectionFilter(e.target.value)}
            sx={{ minWidth: 140, fontSize: 13 }}
          >
            <MenuItem value="all">All sections</MenuItem>
            {sections.map(s => (
              <MenuItem key={s} value={s}>{s}</MenuItem>
            ))}
          </Select>
          <Typography variant="caption" sx={{ opacity: 0.5, flexShrink: 0 }}>
            {filtered.length} / {templates.length}
          </Typography>
        </Box>

        {/* Content */}
        {loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" sx={{ ml: 2, opacity: 0.6 }}>Loading templates...</Typography>
          </Box>
        ) : error ? (
          <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>
        ) : (
          <TableContainer sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700, width: 40 }}></TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Package</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 90 }}>Version</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 80 }} align="right"></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filtered.map(tpl => {
                  const icon = osIcon(tpl.os)
                  const isDownloading = downloading === tpl.template
                  return (
                    <TableRow key={tpl.template} hover sx={{ '&:last-child td': { border: 0 } }}>
                      <TableCell sx={{ pr: 0 }}>
                        {icon
                          ? <img src={icon} alt="" width={20} height={20} style={{ display: 'block' }} />
                          : <i className="ri-terminal-box-line" style={{ fontSize: 18, opacity: 0.4 }} />
                        }
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{tpl.package}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.5, fontSize: 10 }}>{tpl.os}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>
                          {tpl.headline || tpl.description?.slice(0, 100) || '\u2014'}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                          {tpl.version}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={isDownloading ? 'outlined' : 'contained'}
                          disabled={!!downloading}
                          onClick={() => handleDownload(tpl)}
                          sx={{ minWidth: 0, px: 1.5, py: 0.25, fontSize: 11, textTransform: 'none' }}
                          startIcon={isDownloading ? <CircularProgress size={12} /> : <i className="ri-download-line" style={{ fontSize: 14 }} />}
                        >
                          {isDownloading ? '' : 'Download'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {downloadError && (
          <Alert severity="error" sx={{ mx: 2, mb: 1 }}>{downloadError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
