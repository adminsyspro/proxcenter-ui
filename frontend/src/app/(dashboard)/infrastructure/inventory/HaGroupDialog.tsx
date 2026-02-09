'use client'

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  FormControlLabel,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

type HaGroupDialogProps = {
  open: boolean
  onClose: () => void
  group: any | null // null = création, sinon = édition
  connId: string
  availableNodes: string[]
  onSaved: () => void
}

function HaGroupDialog({ open, onClose, group, connId, availableNodes, onSaved }: HaGroupDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [restricted, setRestricted] = useState(false)
  const [nofailback, setNofailback] = useState(false)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialiser les valeurs quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      if (group) {
        // Mode édition
        setName(group.group || '')

        // Parser les nodes (format: "node1:1,node2:2" ou "node1,node2")
        const nodesStr = group.nodes || ''
        const nodesList = nodesStr.split(',').map((n: string) => n.split(':')[0].trim()).filter(Boolean)

        setSelectedNodes(nodesList)
        setRestricted(!!group.restricted)
        setNofailback(!!group.nofailback)
        setComment(group.comment || '')
      } else {
        // Mode création
        setName('')
        setSelectedNodes([])
        setRestricted(false)
        setNofailback(false)
        setComment('')
      }

      setError(null)
    }
  }, [open, group])

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('inventoryPage.groupNameRequired'))
      
return
    }

    if (selectedNodes.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneNode'))
      
return
    }

    setSaving(true)
    setError(null)

    try {
      const nodesString = selectedNodes.join(',')
      
      const url = group
        ? `/api/v1/connections/${encodeURIComponent(connId)}/ha/groups/${encodeURIComponent(group.group)}`
        : `/api/v1/connections/${encodeURIComponent(connId)}/ha/groups`
      
      const method = group ? 'PUT' : 'POST'
      
      const body: any = {
        nodes: nodesString,
        restricted,
        nofailback,
        comment: comment || undefined
      }
      
      if (!group) {
        body.group = name.trim()
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const err = await res.json()

        setError(err.error || t('errors.updateError'))
        
return
      }

      onSaved()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  const toggleNode = (node: string) => {
    setSelectedNodes(prev => 
      prev.includes(node) 
        ? prev.filter(n => n !== node)
        : [...prev, node]
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-group-line" style={{ fontSize: 20 }} />
        {group ? t('drs.editHaGroup') : t('drs.createHaGroup')}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.groupName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!group || saving}
          sx={{ mt: 1, mb: 2 }}
          placeholder="Ex: HA-3AZ"
          helperText={group ? t('inventoryPage.nameCannotBeModified') : t('inventoryPage.uniqueGroupId')}
        />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {t('inventoryPage.nodesCount', { selected: selectedNodes.length, total: availableNodes.length })}
        </Typography>
        
        <Box sx={{ 
          border: '1px solid', 
          borderColor: 'divider', 
          borderRadius: 1, 
          maxHeight: 200, 
          overflow: 'auto',
          mb: 2
        }}>
          <List dense disablePadding>
            {availableNodes.map(node => (
              <ListItemButton 
                key={node} 
                onClick={() => toggleNode(node)}
                sx={{ py: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Switch 
                    size="small" 
                    checked={selectedNodes.includes(node)} 
                    onChange={() => toggleNode(node)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </ListItemIcon>
                <ListItemText 
                  primary={node} 
                  primaryTypographyProps={{ variant: 'body2' }}
                />
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Stack direction="row" spacing={3} sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch 
                checked={restricted} 
                onChange={(e) => setRestricted(e.target.checked)}
                disabled={saving}
              />
            }
            label={
              <Box>
                <Typography variant="body2">Restricted</Typography>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('inventoryPage.resourcesCanOnlyMigrate')}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            control={
              <Switch 
                checked={nofailback} 
                onChange={(e) => setNofailback(e.target.checked)}
                disabled={saving}
              />
            }
            label={
              <Box>
                <Typography variant="body2">No Failback</Typography>
                <Typography variant="caption" sx={{ opacity: 0.6 }}>
                  {t('inventoryPage.doNotReturnToPreferred')}
                </Typography>
              </Box>
            }
          />
        </Stack>

        <TextField
          fullWidth
          label={t('inventoryPage.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={saving}
          multiline
          rows={2}
          placeholder={t('inventoryPage.optionalGroupDescription')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button 
          variant="contained" 
          onClick={handleSave}
          disabled={saving || !name.trim() || selectedNodes.length === 0}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? t('common.saving') : group ? t('common.edit') : t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}


export default HaGroupDialog
