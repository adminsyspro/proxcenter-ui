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

import { tagColor } from '../helpers'

const AddIcon = (props: any) => <i className="ri-add-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CloseIcon = (props: any) => <i className="ri-close-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

type TagManagerProps = {
  tags: string[]
  connId: string
  node: string
  type: string
  vmid: string
  onTagsChange: (newTags: string[]) => void
}

function TagManager({ tags, connId, node, type, vmid, onTagsChange }: TagManagerProps) {
  const t = useTranslations()
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [loadingTags, setLoadingTags] = useState(false)
  const [newTagInput, setNewTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const open = Boolean(anchorEl)

  // Charger les tags existants dans Proxmox quand on ouvre le popover
  const handleOpenAdd = async (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget)
    setLoadingTags(true)

    try {
      // Récupérer tous les guests pour extraire les tags uniques
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/guests`, { cache: 'no-store' })

      if (res.ok) {
        const json = await res.json()
        const guests = Array.isArray(json?.data) ? json.data : []
        const allTags = new Set<string>()

        guests.forEach((g: any) => {
          if (g.tags) {
            String(g.tags).split(/[;,]+/).forEach(t => {
              const trimmed = t.trim()

              if (trimmed) allTags.add(trimmed)
            })
          }
        })
        setAvailableTags(Array.from(allTags).sort())
      }
    } catch (e) {
      console.error('Failed to load tags', e)
    } finally {
      setLoadingTags(false)
    }
  }

  const handleClose = () => {
    setAnchorEl(null)
    setNewTagInput('')
  }

  // Ajouter un tag
  const handleAddTag = async (tagToAdd: string) => {
    if (!tagToAdd.trim() || tags.includes(tagToAdd.trim())) return
    
    setBusy(true)

    try {
      const newTags = [...tags, tagToAdd.trim()]
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

        alert(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Supprimer un tag
  const handleRemoveTag = async (tagToRemove: string) => {
    setBusy(true)

    try {
      const newTags = tags.filter(t => t !== tagToRemove)
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
      } else {
        const err = await res.json().catch(() => ({}))

        alert(`${t('common.error')}: ${err?.error || res.status}`)
      }
    } catch (e: any) {
      alert(`${t('common.error')}: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  // Tags disponibles mais pas encore sur cette VM
  const suggestedTags = availableTags.filter(t => !tags.includes(t))

  return (
    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Tags existants avec bouton × */}
      {tags.map(t => {
        const c = tagColor(t)

        
return (
          <Chip
            key={t}
            size="small"
            label={t}
            disabled={busy}
            onDelete={() => handleRemoveTag(t)}
            deleteIcon={
              <CloseIcon 
                sx={{ 
                  fontSize: '14px !important',
                  color: `${c} !important`,
                  '&:hover': { color: `${c} !important`, opacity: 0.7 }
                }} 
              />
            }
            sx={{
              height: 22,
              '& .MuiChip-label': { px: 1, fontSize: 12, fontWeight: 800 },
              '& .MuiChip-deleteIcon': { mr: 0.5 },
              bgcolor: `${c}22`,
              color: c,
              border: '1px solid',
              borderColor: `${c}66`,
            }}
          />
        )
      })}

      {/* Bouton + pour ajouter */}
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
          <AddIcon sx={{ fontSize: 14 }} />
        </IconButton>
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
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField
              size="small"
              placeholder={t('inventoryPage.newTag')}
              value={newTagInput}
              onChange={e => setNewTagInput(e.target.value)}
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
              {suggestedTags.map(t => {
                const c = tagColor(t)

                
return (
                  <Chip
                    key={t}
                    size="small"
                    label={t}
                    onClick={() => handleAddTag(t)}
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


export default TagManager
