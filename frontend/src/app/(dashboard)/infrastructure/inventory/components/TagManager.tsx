'use client'

import React, { useCallback, useEffect, useState } from 'react'
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

import { useTagColors } from '@/contexts/TagColorContext'
import { useToast } from '@/contexts/ToastContext'

import { sanitizeTag, filterTagInput } from '../helpers'

const AddIcon = (props: any) => <i className="ri-add-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CloseIcon = ({ fontSize, sx, style, className, ...rest }: any) => <i className={`ri-close-line${className ? ` ${className}` : ''}`} style={{ fontSize: fontSize === 'small' ? 18 : 20, color: sx?.color, ...style }} {...rest} />

type TagManagerProps = {
  tags: string[]
  connId: string
  node: string
  type: string
  vmid: string
  onTagsChange: (newTags: string[]) => void
}

/** GET /api/v1/connections/{id}/tag-access: the datacenter User Tag Access as it applies to this user (#1208). */
type TagAccess = {
  userAllow: 'free' | 'list' | 'existing' | 'none'
  privileged: boolean
  freeform: boolean
  allowedTags: string[]
  lockedTags: string[]
}

function TagManager({ tags, connId, node, type, vmid, onTagsChange }: TagManagerProps) {
  const t = useTranslations()
  const toast = useToast()
  const { getColor } = useTagColors(connId)
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [access, setAccess] = useState<TagAccess | null>(null)
  const [loadingTags, setLoadingTags] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const open = Boolean(anchorEl)

  const loadAccess = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/tag-access`, { cache: 'no-store' })

      if (res.ok) setAccess((await res.json())?.data ?? null)
    } catch (e) {
      console.error('Failed to load tag access', e)
    }
  }, [connId])

  useEffect(() => { void loadAccess() }, [loadAccess])

  // Until the policy is known the editor stays open: the API enforces it anyway.
  const canChange = (tag: string) => {
    if (!access || access.privileged) return true
    if (access.lockedTags.includes(tag)) return false

    return access.freeform || access.allowedTags.includes(tag)
  }

  const canCreate = !access || access.privileged || access.freeform
  const readOnly = !!access && !access.privileged && !access.freeform && access.allowedTags.length === 0

  // Recharger les tags autorisés quand on ouvre le popover
  const handleOpenAdd = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget)
    setLoadingTags(true)
    await loadAccess()
    setLoadingTags(false)
  }

  const handleClose = () => {
    setAnchorEl(null)
    setNewTagInput('')
  }

  // Ajouter un tag
  const handleAddTag = async (tagToAdd: string) => {
    const sanitized = sanitizeTag(tagToAdd)

    if (!sanitized || tags.includes(sanitized) || !canChange(sanitized)) return
    
    setBusy(true)

    try {
      const newTags = [...tags, sanitized]
      const tagsString = newTags.join(';')
      
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: tagsString })
        }
      )
      
      if (res.ok) {
        onTagsChange(newTags)
        setNewTagInput('')
      } else {
        const err = await res.json().catch(() => ({}))

        toast.error(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      toast.error(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Supprimer un tag
  const handleRemoveTag = async (tagToRemove: string) => {
    setBusy(true)

    try {
      const newTags = tags.filter(t => t !== tagToRemove)
      // Si plus aucun tag, Proxmox requiert `delete=tags` plutôt que `tags=` (chaîne vide ignorée)
      const body = newTags.length > 0
        ? { tags: newTags.join(';') }
        : { delete: 'tags' }

      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/config`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      )
      
      if (res.ok) {
        onTagsChange(newTags)
      } else {
        const err = await res.json().catch(() => ({}))

        toast.error(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      toast.error(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Tags autorisés mais pas encore sur cette VM
  const suggestedTags = (access?.allowedTags ?? []).filter(t => !tags.includes(t))

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Tags existants avec bouton × */}
      {tags.map(tag => {
        // Solid PVE colours, as in the tree: a tag colour used as text on its
        // own 8 % tint vanished on the dark theme for dark tags.
        const { bg, fg } = getColor(tag)
        const removable = canChange(tag)
        const lockedHint = access?.lockedTags.includes(tag) ? t('inventory.tagAccessLocked') : t('inventory.tagAccessReadOnly')

        const chip = (
          <Chip
            key={tag}
            size="small"
            icon={<i className="ri-price-tag-3-fill" style={{ fontSize: 11, color: fg, marginLeft: 6 }} />}
            label={tag.toLowerCase()}
            disabled={busy}
            onDelete={removable ? () => handleRemoveTag(tag) : undefined}
            deleteIcon={
              <CloseIcon
                sx={{
                  fontSize: '12px !important',
                  color: `${fg}aa !important`,
                  '&:hover': { color: `${fg} !important` }
                }}
              />
            }
            sx={{
              height: 20,
              borderRadius: 10,
              '& .MuiChip-label': { pl: 0.5, pr: 0.5, fontSize: 11, fontWeight: 600, letterSpacing: 0.2 },
              '& .MuiChip-deleteIcon': { ml: 0, mr: 0.25, fontSize: 12 },
              '& .MuiChip-icon': { mr: -0.25 },
              bgcolor: bg,
              color: fg,
              border: 'none',
              transition: 'filter 0.15s',
              '&:hover': { bgcolor: bg, filter: 'brightness(1.12)' },
            }}
          />
        )

        return removable ? chip : <MuiTooltip key={tag} title={lockedHint}>{chip}</MuiTooltip>
      })}

      {/* Bouton + pour ajouter */}
      <MuiTooltip title={readOnly ? t('inventory.tagAccessReadOnly') : t('inventory.addTag')}>
        <span>
          <IconButton
            size="small"
            aria-label={t('inventory.addTag')}
            onClick={handleOpenAdd}
            disabled={busy || readOnly}
            sx={{
              width: 22,
              height: 22,
              border: '1px dashed',
              borderColor: 'divider',
              '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' }
            }}
          >
            <AddIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </span>
      </MuiTooltip>

      {/* Popover pour ajouter un tag */}
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

          {/* Input pour nouveau tag */}
          {canCreate ? (
            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                size="small"
                placeholder={t('inventoryPage.newTag')}
                value={newTagInput}
                onChange={e => setNewTagInput(filterTagInput(e.target.value))}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newTagInput.trim()) {
                    void handleAddTag(newTagInput)
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
          ) : (
            <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
              {t('inventory.tagAccessNoNewTags')}
            </Typography>
          )}

          <Divider sx={{ my: 1.5 }} />

          {/* Tags suggérés */}
          <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
            {t('inventoryPage.existingTagsProxmox')}
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
                const { bg, fg } = getColor(tag)

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
                      bgcolor: bg,
                      color: fg,
                      transition: 'filter 0.15s',
                      '&:hover': { bgcolor: bg, filter: 'brightness(1.12)' }
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


export default TagManager
