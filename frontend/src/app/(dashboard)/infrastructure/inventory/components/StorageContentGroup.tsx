import React from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material'

function StorageContentGroup({ group, formatBytes: fmt, onUpload, onDelete, onDownloadTemplate, vmNames }: {
  group: { label: string; icon: string; items: any[]; contentType?: string }
  formatBytes: (n: number) => string
  onUpload?: () => void
  onDelete?: (volid: string) => Promise<void>
  onDownloadTemplate?: () => void
  vmNames?: Record<string, string>
}) {
  const [search, setSearch] = React.useState('')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc' | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<any>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const canDelete = !!onDelete
  const isAttachedType = group.contentType === 'images' || group.contentType === 'rootdir'

  const handleDelete = async () => {
    if (!deleteTarget || !onDelete) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await onDelete(deleteTarget.volid)
      setDeleteTarget(null)
    } catch (e: any) {
      setDeleteError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  const filtered = React.useMemo(() => {
    let items = group.items
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((item: any) => {
        const volid = String(item.volid || '').toLowerCase()
        const vmid = item.vmid ? String(item.vmid) : ''
        const vmName = (item.vmid && vmNames?.[String(item.vmid)]) ? vmNames[String(item.vmid)].toLowerCase() : ''
        return volid.includes(q) || vmid.includes(q) || vmName.includes(q)
      })
    }
    if (sortDir) {
      items = [...items].sort((a: any, b: any) =>
        sortDir === 'asc' ? (a.size || 0) - (b.size || 0) : (b.size || 0) - (a.size || 0)
      )
    }
    return items
  }, [group.items, search, sortDir])

  const getFileName = (volid: string) => {
    const parts = String(volid || '').split(':')
    const volPath = parts.length > 1 ? parts.slice(1).join(':') : volid
    return volPath?.split('/')?.pop() || volPath
  }

  return (
    <>
    <Card variant="outlined" sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <i className={group.icon} style={{ fontSize: 18, opacity: 0.7 }} />
            {group.label} ({group.items.length})
          </Typography>
          {onDownloadTemplate && (
            <IconButton
              size="small"
              onClick={onDownloadTemplate}
              sx={{ p: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
              title="Download template from repository"
            >
              <i className="ri-download-cloud-2-line" style={{ fontSize: 16 }} />
            </IconButton>
          )}
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : prev === 'desc' ? null : 'asc')}
            sx={{ opacity: sortDir ? 1 : 0.4, p: 0.5 }}
            title="Sort by size"
          >
            <i className={sortDir === 'asc' ? 'ri-sort-asc' : sortDir === 'desc' ? 'ri-sort-desc' : 'ri-arrow-up-down-line'} style={{ fontSize: 16 }} />
          </IconButton>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 0.5,
            border: '1px solid', borderColor: 'divider', borderRadius: 1,
            px: 1, py: 0.25, maxWidth: 180,
          }}>
            <i className="ri-search-line" style={{ fontSize: 13, opacity: 0.4 }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 12, width: '100%', color: 'inherit',
                fontFamily: 'Inter, sans-serif',
              }}
            />
            {search && (
              <i className="ri-close-line" style={{ fontSize: 13, opacity: 0.4, cursor: 'pointer' }} onClick={() => setSearch('')} />
            )}
          </Box>
          {onUpload && (
            <IconButton
              size="small"
              onClick={onUpload}
              sx={{ p: 0.5, opacity: 0.6, '&:hover': { opacity: 1 } }}
              title="Upload"
            >
              <i className="ri-upload-2-line" style={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
        <Box sx={{ maxHeight: 600, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <Box sx={{ px: 2, py: 2, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.4 }}>No results</Typography>
            </Box>
          ) : filtered.map((item: any, idx: number) => {
            const fileName = getFileName(item.volid)

            return (
              <Box
                key={item.volid || idx}
                sx={{
                  px: 2, py: 0.5,
                  borderBottom: '1px solid', borderColor: 'divider',
                  '&:last-child': { borderBottom: 'none' },
                  '&:hover': { bgcolor: 'action.hover' },
                  display: 'flex', alignItems: 'center', gap: 1,
                }}
              >
                <i className={group.icon} style={{ fontSize: 12, opacity: 0.4, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {fileName}
                </Typography>
                {item.vmid && (
                  <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0, fontSize: 10 }}>
                    VM {item.vmid}{vmNames?.[String(item.vmid)] ? ` (${vmNames[String(item.vmid)]})` : ''}
                  </Typography>
                )}
                <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                  {item.format || ''}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.6, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  {item.size ? fmt(item.size) : ''}
                </Typography>
                {canDelete && (
                  <IconButton
                    size="small"
                    onClick={() => { setDeleteTarget(item); setDeleteError(null) }}
                    sx={{ opacity: 0.3, '&:hover': { opacity: 1, color: 'error.main' }, p: 0.25 }}
                    title="Delete"
                  >
                    <i className="ri-delete-bin-line" style={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            )
          })}
        </Box>
      </CardContent>
    </Card>

    {/* Delete confirmation dialog */}
    <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>Delete file</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Are you sure you want to delete{' '}
          <strong style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {deleteTarget ? getFileName(deleteTarget.volid) : ''}
          </strong>?
        </DialogContentText>
        {deleteTarget?.size && (
          <Typography variant="caption" sx={{ opacity: 0.6, mt: 1, display: 'block' }}>
            Size: {fmt(deleteTarget.size)}
          </Typography>
        )}
        {isAttachedType && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            This volume may be attached to a VM/CT{deleteTarget?.vmid ? ` (${deleteTarget.vmid})` : ''}. Deleting it could cause data loss.
          </Alert>
        )}
        {deleteError && (
          <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
        <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}
          startIcon={deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" />}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}

export default StorageContentGroup
