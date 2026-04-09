'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import { useProxCenterTasks } from '@/contexts/ProxCenterTasksContext'
import TemplateDownloadDialog from '@/components/storage/TemplateDownloadDialog'

// ---------- Types ----------

type ContentItem = {
  volid: string
  content?: string
  format?: string
  size?: number
  ctime?: number
  vmid?: number | string
  [key: string]: any
}

type ContentGroup = {
  label: string
  icon: string
  contentType: string
  items: ContentItem[]
}

type StorageContentBrowserProps = {
  connId: string
  node: string
  storage: string
  contentTypes?: string[]  // e.g. ['iso', 'backup', 'vztmpl', 'snippets', 'images', 'rootdir']
  onDelete?: () => void    // callback after successful delete to refresh data
  readOnly?: boolean       // hide delete/upload buttons
}

// ---------- Content label / icon mapping ----------

const CONTENT_MAP: Record<string, { label: string; icon: string; uploadable: boolean }> = {
  images:   { label: 'VM Disks',      icon: 'ri-hard-drive-3-line', uploadable: false },
  rootdir:  { label: 'CT Volumes',    icon: 'ri-archive-line',      uploadable: false },
  iso:      { label: 'ISO Images',    icon: 'ri-disc-line',         uploadable: true },
  backup:   { label: 'Backups',       icon: 'ri-shield-check-line', uploadable: false },
  snippets: { label: 'Snippets',      icon: 'ri-code-s-slash-line', uploadable: true },
  vztmpl:   { label: 'CT Templates',  icon: 'ri-file-copy-line',    uploadable: true },
  import:   { label: 'Import',        icon: 'ri-import-line',       uploadable: true },
}

// ---------- Single content group ----------

function ContentGroupCard({ group, connId, node, storage, readOnly, onDeleted, onUploadClick, onDownloadTemplate }: {
  group: ContentGroup
  connId: string
  node: string
  storage: string
  readOnly?: boolean
  onDeleted?: () => void
  onUploadClick?: () => void
  onDownloadTemplate?: () => void
}) {
  const [search, setSearch] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ContentItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const canDelete = !readOnly
  const isAttachedType = group.contentType === 'images' || group.contentType === 'rootdir'

  const filtered = useMemo(() => {
    let items = group.items
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter((item) => {
        const volid = String(item.volid || '').toLowerCase()
        const vmid = item.vmid ? String(item.vmid) : ''
        return volid.includes(q) || vmid.includes(q)
      })
    }
    if (sortDir) {
      items = [...items].sort((a, b) =>
        sortDir === 'asc' ? (a.size || 0) - (b.size || 0) : (b.size || 0) - (a.size || 0)
      )
    }
    return items
  }, [group.items, search, sortDir])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)

    try {
      const volid = encodeURIComponent(deleteTarget.volid)
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${volid}`,
        { method: 'DELETE' }
      )

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${res.status}`)
      }

      setDeleteTarget(null)
      onDeleted?.()
    } catch (e: any) {
      setDeleteError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

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
            {onUploadClick && (
              <IconButton
                size="small"
                onClick={onUploadClick}
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
            ) : filtered.map((item, idx) => {
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
                      VM {item.vmid}
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ opacity: 0.4, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                    {item.format || ''}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.6, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                    {item.size ? formatBytes(item.size) : ''}
                  </Typography>
                  {canDelete && (
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget(item)}
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
            </strong>
            ?
          </DialogContentText>
          {deleteTarget?.size && (
            <Typography variant="caption" sx={{ opacity: 0.6, mt: 1, display: 'block' }}>
              Size: {formatBytes(deleteTarget.size)}
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

// ---------- Upload dialog ----------

export function UploadDialog({ open, onClose, onOpen, connId, node, storage, contentTypes, onUploaded }: {
  open: boolean
  onClose: () => void
  onOpen: () => void
  connId: string
  node: string
  storage: string
  contentTypes: string[]
  onUploaded: () => void
}) {
  const { addTask, updateTask, registerOnRestore, unregisterOnRestore } = useProxCenterTasks()
  const [mode, setMode] = useState<'file' | 'url'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [contentType, setContentType] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // URL mode
  const [downloadUrl, setDownloadUrl] = useState('')
  const [urlFilename, setUrlFilename] = useState('')

  const [minimized, setMinimized] = useState(false)

  const uploadableTypes = contentTypes.filter(ct => CONTENT_MAP[ct]?.uploadable)

  useEffect(() => {
    if (open && !minimized && !uploading) {
      setMode('file')
      setFile(null)
      setContentType(uploadableTypes[0] || '')
      setUploading(false)
      setProgress(0)
      setError(null)
      setSuccess(false)
      setDownloadUrl('')
      setUrlFilename('')
      setPhase('idle')
      setTransferProgress(0)
    }
  }, [open])

  // Auto-detect filename from URL
  useEffect(() => {
    if (mode === 'url' && downloadUrl) {
      try {
        const urlObj = new URL(downloadUrl)
        const path = urlObj.pathname
        const name = path.split('/').pop() || ''
        if (name && (name.endsWith('.iso') || name.endsWith('.img') || name.endsWith('.tar.gz') || name.endsWith('.tar.xz') || name.endsWith('.tar.zst'))) {
          setUrlFilename(name)
        }
      } catch { /* invalid URL, ignore */ }
    }
  }, [downloadUrl, mode])

  // 'uploading' = browser→server, 'transferring' = server→Proxmox
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'transferring'>('idle')
  const [transferProgress, setTransferProgress] = useState(0)
  const uploadIdRef = React.useRef<string>('')

  const handleUploadFile = async () => {
    if (!file || !contentType) return
    setUploading(true)
    setError(null)
    setProgress(0)
    setTransferProgress(0)
    setPhase('uploading')

    // Generate upload ID with fallback for non-secure contexts (HTTP)
    const uploadId = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    uploadIdRef.current = uploadId

    let pollInterval: ReturnType<typeof setInterval> | null = null

    try {
      // Register in ProxCenter tasks
      addTask({
        id: uploadId,
        type: 'upload',
        label: `Upload ${file.name}`,
        detail: `${formatBytes(file.size)} → ${storage} (${node})`,
        progress: 0,
        status: 'running',
        createdAt: Date.now(),
      })

      // Allow reopening the dialog from the taskbar
      registerOnRestore(uploadId, () => {
        setMinimized(false)
        onOpen()
      })

      const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MB
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
      const uploadUrl = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/upload`

      // Phase 1: Send file in chunks (PUT requests)
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE
        const end = Math.min(start + CHUNK_SIZE, file.size)
        const chunk = file.slice(start, end)

        const res = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'X-Upload-Id': uploadId,
            'X-Chunk-Index': String(i),
            'X-Total-Chunks': String(totalChunks),
            'X-Total-Size': String(file.size),
            'X-File-Name': file.name,
            'X-Content-Type': contentType,
            'X-Mime-Type': file.type || 'application/octet-stream',
          },
          body: chunk,
        })

        if (!res.ok) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error || `Chunk ${i} failed: HTTP ${res.status}`)
        }

        const pct = Math.round(((i + 1) / totalChunks) * 100)
        setProgress(pct)
        updateTask(uploadId, { progress: Math.round(pct / 2) })
      }

      // Phase 2: Finalize - server sends assembled file to Proxmox
      setPhase('transferring')

      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/upload-progress/${uploadId}`)
          if (res.ok) {
            const data = await res.json()
            if (data.totalBytes > 0) {
              const pct = Math.round((data.bytesSent / data.totalBytes) * 100)
              setTransferProgress(pct)
              updateTask(uploadId, { progress: 50 + Math.round(pct / 2) })
            }
          }
        } catch { /* ignore polling errors */ }
      }, 1500)

      const finalRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'X-Upload-Id': uploadId, 'X-Finalize': '1' },
      })

      if (!finalRes.ok) {
        const json = await finalRes.json().catch(() => ({}))
        throw new Error(json.error || `Finalize failed: HTTP ${finalRes.status}`)
      }

      updateTask(uploadId, { progress: 100, status: 'done' })
      setSuccess(true)
      setTimeout(() => {
        onUploaded()
        onClose()
      }, 1500)
    } catch (e: any) {
      updateTask(uploadId, { status: 'error', error: e?.message || String(e) })
      setError(e?.message || String(e))
    } finally {
      if (pollInterval) clearInterval(pollInterval)
      setUploading(false)
    }
  }

  const handleDownloadUrl = async () => {
    if (!downloadUrl || !contentType || !urlFilename) return
    setUploading(true)
    setError(null)
    setProgress(0)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/download-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: downloadUrl, content: contentType, filename: urlFilename }),
        }
      )

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error || `HTTP ${res.status}`)
      }

      setSuccess(true)
      setTimeout(() => {
        onUploaded()
        onClose()
      }, 1500)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    if (mode === 'file') handleUploadFile()
    else handleDownloadUrl()
  }

  // No accept filter — let Proxmox validate server-side to avoid browser quirks hiding valid files
  const acceptMap: Record<string, string> = {}

  const canSubmit = mode === 'file'
    ? !!(file && contentType && !uploading && !success)
    : !!(downloadUrl && urlFilename && contentType && !uploading && !success)

  const handleMinimize = () => {
    setMinimized(true)
    onClose()
  }

  const handleRestore = () => {
    setMinimized(false)
    onOpen()
  }

  if (uploadableTypes.length === 0) return null

  return (
    <>
    <Dialog open={open && !minimized} onClose={() => uploading ? handleMinimize() : onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={mode === 'file' ? 'ri-upload-2-line' : 'ri-links-line'} style={{ fontSize: 22 }} />
        {mode === 'file' ? 'Upload file' : 'Download from URL'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {/* Mode toggle */}
          <ToggleButtonGroup
            value={mode}
            exclusive
            onChange={(_e, v) => { if (v) { setMode(v); setError(null); setSuccess(false) } }}
            size="small"
            fullWidth
            disabled={uploading}
          >
            <ToggleButton value="file" sx={{ textTransform: 'none', fontWeight: 600, gap: 0.75 }}>
              <i className="ri-upload-2-line" style={{ fontSize: 16 }} />
              Upload file
            </ToggleButton>
            <ToggleButton value="url" sx={{ textTransform: 'none', fontWeight: 600, gap: 0.75 }}>
              <i className="ri-links-line" style={{ fontSize: 16 }} />
              Download from URL
            </ToggleButton>
          </ToggleButtonGroup>

          {/* Content type selector */}
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7, mb: 1, display: 'block' }}>
              File type
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {uploadableTypes.map(ct => (
                <Chip
                  key={ct}
                  label={CONTENT_MAP[ct]?.label || ct}
                  icon={<i className={CONTENT_MAP[ct]?.icon || 'ri-file-line'} style={{ fontSize: 16 }} />}
                  onClick={() => { setContentType(ct); setFile(null) }}
                  variant={contentType === ct ? 'filled' : 'outlined'}
                  color={contentType === ct ? 'primary' : 'default'}
                  sx={{ fontWeight: 600 }}
                />
              ))}
            </Box>
          </Box>

          {mode === 'file' ? (
            /* File picker */
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, opacity: 0.7, mb: 1, display: 'block' }}>
                File
              </Typography>
              <Button
                component="label"
                variant="outlined"
                fullWidth
                sx={{
                  py: 3, borderStyle: 'dashed', borderWidth: 2,
                  display: 'flex', flexDirection: 'column', gap: 1,
                }}
                disabled={uploading}
              >
                <i className="ri-upload-cloud-2-line" style={{ fontSize: 32, opacity: 0.5 }} />
                {file ? (
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                      {file.name}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>
                      {formatBytes(file.size)}
                    </Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" sx={{ opacity: 0.6 }}>
                    Click to select a file
                  </Typography>
                )}
                <input
                  type="file"
                  hidden
                  accept={acceptMap[contentType] || '*'}
                  onChange={e => setFile(e.target.files?.[0] || null)}
                />
              </Button>
            </Box>
          ) : (
            /* URL input */
            <Stack spacing={2}>
              <TextField
                label="URL"
                placeholder="https://example.com/image.iso"
                value={downloadUrl}
                onChange={e => setDownloadUrl(e.target.value)}
                disabled={uploading}
                size="small"
                fullWidth
                slotProps={{ input: { sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
              />
              <TextField
                label="Filename"
                placeholder="image.iso"
                value={urlFilename}
                onChange={e => setUrlFilename(e.target.value)}
                disabled={uploading}
                size="small"
                fullWidth
                helperText="Filename to save as on the storage"
                slotProps={{ input: { sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
              />
            </Stack>
          )}

          {/* Progress */}
          {uploading && (
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {mode === 'url'
                    ? 'Download started on Proxmox...'
                    : phase === 'transferring'
                      ? 'Sending to Proxmox...'
                      : 'Uploading...'}
                </Typography>
                {mode === 'file' && phase === 'uploading' && (
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{progress}%</Typography>
                )}
                {mode === 'file' && phase === 'transferring' && transferProgress > 0 && (
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{transferProgress}%</Typography>
                )}
              </Box>
              <LinearProgress
                variant={
                  mode === 'file' && phase === 'uploading'
                    ? 'determinate'
                    : mode === 'file' && phase === 'transferring' && transferProgress > 0
                      ? 'determinate'
                      : 'indeterminate'
                }
                value={
                  mode === 'file' && phase === 'uploading'
                    ? progress
                    : mode === 'file' && phase === 'transferring' && transferProgress > 0
                      ? transferProgress
                      : undefined
                }
                sx={{ height: 8, borderRadius: 1 }}
              />
              {phase === 'transferring' && (
                <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.5, display: 'block' }}>
                  File received, transferring to Proxmox storage...
                </Typography>
              )}
            </Box>
          )}

          {/* Success */}
          {success && (
            <Alert severity="success">
              {mode === 'file' ? 'Upload successful!' : 'Download task started on Proxmox. The file will appear once the download completes.'}
            </Alert>
          )}

          {/* Error */}
          {error && (
            <Alert severity="error">{error}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {uploading ? (
          <Button
            onClick={handleMinimize}
            startIcon={<i className="ri-subtract-line" style={{ fontSize: 16 }} />}
          >
            Minimize
          </Button>
        ) : (
          <Button onClick={onClose}>Cancel</Button>
        )}
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={!canSubmit}
          startIcon={uploading ? <CircularProgress size={16} /> : <i className={mode === 'file' ? 'ri-upload-2-line' : 'ri-download-2-line'} />}
        >
          {uploading
            ? (mode === 'file'
              ? (phase === 'transferring'
                ? `Sending to Proxmox...${transferProgress > 0 ? ` ${transferProgress}%` : ''}`
                : `Uploading... ${progress}%`)
              : 'Starting...')
            : (mode === 'file' ? 'Upload' : 'Download')
          }
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}

// ---------- Main component ----------

export default function StorageContentBrowser({
  connId,
  node,
  storage,
  contentTypes = [],
  onDelete,
  readOnly = false,
}: StorageContentBrowserProps) {
  const [items, setItems] = useState<ContentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)

  const hasUploadableContent = !readOnly && contentTypes.some(ct => CONTENT_MAP[ct]?.uploadable)
  const hasVztmpl = !readOnly && contentTypes.includes('vztmpl')

  const loadContent = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
        { cache: 'no-store' }
      )

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setItems(json?.data || [])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [connId, node, storage])

  useEffect(() => {
    if (connId && node && storage) {
      loadContent()
    }
  }, [connId, node, storage, loadContent])

  // Group items by content type
  const groups = useMemo(() => {
    const g: Record<string, ContentGroup> = {}
    for (const item of items) {
      const ct = item.content || 'other'
      if (!g[ct]) {
        const cfg = CONTENT_MAP[ct] || { label: ct, icon: 'ri-file-line', uploadable: false }
        g[ct] = { label: cfg.label, icon: cfg.icon, contentType: ct, items: [] }
      }
      g[ct].items.push(item)
    }
    // Sort items in each group by creation time (newest first)
    for (const group of Object.values(g)) {
      group.items.sort((a, b) => (b.ctime || 0) - (a.ctime || 0))
    }
    return g
  }, [items])

  const handleDeleted = () => {
    loadContent()
    onDelete?.()
  }

  const handleUploaded = () => {
    loadContent()
    onDelete?.() // trigger parent refresh too
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
        <Typography variant="body2" sx={{ ml: 1.5, opacity: 0.6 }}>Loading content...</Typography>
      </Box>
    )
  }

  if (error) {
    return <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
  }

  return (
    <Stack spacing={2}>
      {/* Content groups */}
      {Object.keys(groups).length > 0 ? (
        Object.entries(groups).map(([ct, group]) => (
          <ContentGroupCard
            key={ct}
            group={group}
            connId={connId}
            node={node}
            storage={storage}
            readOnly={readOnly}
            onDeleted={handleDeleted}
            onUploadClick={hasUploadableContent && CONTENT_MAP[ct]?.uploadable ? () => setUploadOpen(true) : undefined}
            onDownloadTemplate={ct === 'vztmpl' && hasVztmpl ? () => setTemplateDialogOpen(true) : undefined}
          />
        ))
      ) : (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 3, textAlign: 'center' }}>
            <i className="ri-folder-open-line" style={{ fontSize: 36, opacity: 0.2 }} />
            <Typography variant="body2" sx={{ opacity: 0.5, mt: 1 }}>
              Storage is empty
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* Upload dialog */}
      {hasUploadableContent && (
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onOpen={() => setUploadOpen(true)}
          connId={connId}
          node={node}
          storage={storage}
          contentTypes={contentTypes}
          onUploaded={handleUploaded}
        />
      )}

      {/* Template download dialog */}
      {hasVztmpl && (
        <TemplateDownloadDialog
          open={templateDialogOpen}
          onClose={() => setTemplateDialogOpen(false)}
          connId={connId}
          node={node}
          storage={storage}
          onDownloaded={handleUploaded}
        />
      )}
    </Stack>
  )
}
