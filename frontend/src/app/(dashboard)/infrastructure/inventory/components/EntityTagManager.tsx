'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Popover,
  TextField,
  Tooltip as MuiTooltip,
  Typography,
} from '@mui/material'

import { tagColorFallback } from '@/contexts/TagColorContext'

/**
 * Tag manager for ProxCenter entities (clusters / nodes).
 * Unlike TagManager.tsx (Proxmox VM tags via PVE API), this writes tags
 * to the ProxCenter DB via the connections / hosts PATCH endpoints.
 */

type EntityTagManagerProps = {
  tags: string[]
  entityType: 'connection' | 'host'
  entityId: string // connectionId for connections, hostId for hosts
  /** For host entities: connectionId + nodeName to find/create the ManagedHost */
  connectionId?: string
  nodeName?: string
  onTagsChange: (newTags: string[]) => void
}

function EntityTagManager({ tags, entityType, entityId, connectionId, nodeName, onTagsChange }: EntityTagManagerProps) {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const open = Boolean(anchorEl)

  const handleOpenAdd = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget)
    setLoadingTags(true)
    try {
      const res = await fetch('/api/v1/tags', { cache: 'no-store' })
      if (res.ok) {
        const json = await res.json()
        setAvailableTags(Array.isArray(json?.data) ? json.data : [])
      }
    } catch (e) {
      console.error('Failed to load tags', e)
    } finally {
      setLoadingTags(false)
    }
  }

  const handleClose = () => { setAnchorEl(null); setNewTagInput('') }

  const sanitizeTag = (raw: string): string =>
    raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')

  const saveTagsToApi = async (newTags: string[]) => {
    const tagsString = newTags.length > 0 ? newTags.join(';') : null

    if (entityType === 'connection') {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(entityId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagsString })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || String(res.status))
      }
    } else {
      // Host: use connectionId + nodeName
      const res = await fetch('/api/v1/hosts/tags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId, node: nodeName, tags: tagsString })
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || String(res.status))
      }
    }
  }

  const handleAddTag = async (tagToAdd: string) => {
    const sanitized = sanitizeTag(tagToAdd)
    if (!sanitized || tags.includes(sanitized)) return
    setBusy(true)
    try {
      const newTags = [...tags, sanitized]
      await saveTagsToApi(newTags)
      onTagsChange(newTags)
      setNewTagInput('')
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    setBusy(true)
    try {
      const newTags = tags.filter(t => t !== tagToRemove)
      await saveTagsToApi(newTags)
      onTagsChange(newTags)
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  const suggestedTags = availableTags.filter(t => !tags.includes(t))

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      {tags.map(tag => {
        const c = tagColorFallback(tag)
        return (
          <Chip
            key={tag}
            size="small"
            icon={<i className="ri-price-tag-3-fill" style={{ fontSize: 11, color: c, marginLeft: 6 }} />}
            label={tag.toLowerCase()}
            disabled={busy}
            onDelete={() => handleRemoveTag(tag)}
            deleteIcon={
              <i className="ri-close-line" style={{ fontSize: 12, color: `${c}88` }} />
            }
            sx={{
              height: 20,
              borderRadius: 10,
              '& .MuiChip-label': { pl: 0.5, pr: 0.5, fontSize: 11, fontWeight: 600, letterSpacing: 0.2 },
              '& .MuiChip-deleteIcon': { ml: 0, mr: 0.25, fontSize: 12 },
              '& .MuiChip-icon': { mr: -0.25 },
              bgcolor: `${c}18`,
              color: c,
              border: 'none',
              transition: 'background 0.15s',
              '&:hover': { bgcolor: `${c}30` },
            }}
          />
        )
      })}

      <MuiTooltip title={t('inventory.addTag')}>
        <IconButton
          size="small"
          onClick={handleOpenAdd}
          disabled={busy}
          sx={{
            width: 22,
            height: 22,
            border: '1px dashed',
            borderColor: 'divider',
            '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
          }}
        >
          <i className="ri-add-line" style={{ fontSize: 14 }} />
        </IconButton>
      </MuiTooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, minWidth: 280 }}>
          <Typography variant="subtitle2" fontWeight={900} sx={{ mb: 1.5 }}>
            {t('inventory.addTag')}
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              placeholder={t('inventoryPage.newTag')}
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value.toLowerCase().replace(/[^a-z0-9_\s-]/g, ''))}
              onKeyDown={e => {
                if (e.key === 'Enter' && newTagInput.trim()) {
                  handleAddTag(newTagInput)
                }
              }}
              disabled={busy}
              sx={{ flex: 1 }}
            />
            <Button
              size="small"
              variant="contained"
              disabled={!newTagInput.trim() || busy}
              onClick={() => handleAddTag(newTagInput)}
            >
              {t('common.add')}
            </Button>
          </Box>

          <Divider sx={{ my: 1.5 }} />

          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
            {t('inventoryPage.existingTags', { defaultMessage: 'Existing tags' })}
          </Typography>

          {loadingTags ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption">{t('common.loading')}</Typography>
            </Box>
          ) : suggestedTags.length === 0 ? (
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {t('common.noResults')}
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', maxHeight: 150, overflow: 'auto' }}>
              {suggestedTags.map(tag => {
                const c = tagColorFallback(tag)
                return (
                  <Chip
                    key={tag}
                    size="small"
                    label={tag}
                    onClick={() => handleAddTag(tag)}
                    disabled={busy}
                    sx={{
                      height: 22,
                      cursor: 'pointer',
                      '& .MuiChip-label': { px: 1, fontSize: 11, fontWeight: 700 },
                      bgcolor: `${c}15`,
                      color: c,
                      border: '1px solid',
                      borderColor: `${c}44`,
                      '&:hover': { bgcolor: `${c}30` }
                    }}
                  />
                )
              })}
            </Box>
          )}
        </Box>
      </Popover>
    </Box>
  )
}

export default EntityTagManager
