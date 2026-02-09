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
  FormControlLabel,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

type HaRuleDialogProps = {
  open: boolean
  onClose: () => void
  rule: any | null // null = création, sinon = édition
  ruleType: 'node-affinity' | 'resource-affinity'
  connId: string
  availableNodes: string[]
  availableResources: any[] // HA resources
  onSaved: () => void
}

function HaRuleDialog({ open, onClose, rule, ruleType, connId, availableNodes, availableResources, onSaved }: HaRuleDialogProps) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [strict, setStrict] = useState(false)
  const [affinity, setAffinity] = useState<'positive' | 'negative'>('positive')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialiser les valeurs quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      if (rule) {
        // Mode édition
        setName(rule.rule || '')
        setEnabled(rule.state !== 'disabled')
        setStrict(!!rule.strict)
        setAffinity(rule.affinity === 'negative' ? 'negative' : 'positive')

        // Parser les nodes
        const nodesStr = rule.nodes || ''
        const nodesList = nodesStr.split(',').map((n: string) => n.split(':')[0].trim()).filter(Boolean)

        setSelectedNodes(nodesList)

        // Parser les resources
        const resourcesStr = rule.resources || ''
        const resourcesList = resourcesStr.split(',').map((r: string) => r.trim()).filter(Boolean)

        setSelectedResources(resourcesList)
        setComment(rule.comment || '')
      } else {
        // Mode création
        setName('')
        setEnabled(true)
        setStrict(false)
        setAffinity('positive')
        setSelectedNodes([])
        setSelectedResources([])
        setComment('')
      }

      setError(null)
    }
  }, [open, rule])

  const handleSave = async () => {
    if (!name.trim() && !rule) {
      setError(t('inventoryPage.ruleNameRequired'))
      
return
    }

    if (ruleType === 'node-affinity' && selectedNodes.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneNode'))
      
return
    }

    if (selectedResources.length === 0) {
      setError(t('inventoryPage.selectAtLeastOneResource'))
      
return
    }

    setSaving(true)
    setError(null)

    try {
      const nodesString = selectedNodes.join(',')
      const resourcesString = selectedResources.join(',')
      
      const url = rule
        ? `/api/v1/connections/${encodeURIComponent(connId)}/ha/affinity-rules/${encodeURIComponent(rule.rule)}`
        : `/api/v1/connections/${encodeURIComponent(connId)}/ha/affinity-rules`
      
      const method = rule ? 'PUT' : 'POST'
      
      const body: any = {
        resources: resourcesString,
        state: enabled ? 'enabled' : 'disabled',
        comment: comment || undefined
      }
      
      if (!rule) {
        body.type = ruleType
        body.rule = name.trim()
      }
      
      if (ruleType === 'node-affinity') {
        body.nodes = nodesString
        body.strict = strict
      } else {
        body.affinity = affinity
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

  const toggleResource = (resource: string) => {
    setSelectedResources(prev => 
      prev.includes(resource) 
        ? prev.filter(r => r !== resource)
        : [...prev, resource]
    )
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={ruleType === 'node-affinity' ? 'ri-node-tree' : 'ri-links-line'} style={{ fontSize: 20 }} />
        {rule ? t('common.edit') : t('common.create')} {ruleType === 'node-affinity' ? 'Node Affinity Rule' : 'Resource Affinity Rule'}
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.ruleName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!rule || saving}
          sx={{ mt: 1, mb: 2 }}
          placeholder="Ex: ha-rule-web-servers"
          helperText={rule ? t('inventoryPage.nameCannotBeModified') : t('inventoryPage.uniqueRuleId')}
        />

        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
          <FormControlLabel
            control={
              <Switch 
                checked={enabled} 
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={saving}
              />
            }
            label={t('common.enabled')}
          />
          
          {ruleType === 'node-affinity' && (
            <FormControlLabel
              control={
                <Switch 
                  checked={strict} 
                  onChange={(e) => setStrict(e.target.checked)}
                  disabled={saving}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Strict</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {t('inventoryPage.restrictToSelectedNodes')}
                  </Typography>
                </Box>
              }
            />
          )}
          
          {ruleType === 'resource-affinity' && (
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Affinity</InputLabel>
              <Select
                value={affinity}
                onChange={(e) => setAffinity(e.target.value as 'positive' | 'negative')}
                label="Affinity"
                disabled={saving}
              >
                <MenuItem value="positive">Keep Together</MenuItem>
                <MenuItem value="negative">Keep Separate</MenuItem>
              </Select>
            </FormControl>
          )}
        </Stack>

        {/* Sélection des ressources HA */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          HA Resources ({selectedResources.length})
        </Typography>
        
        <Box sx={{ 
          border: '1px solid', 
          borderColor: 'divider', 
          borderRadius: 1, 
          maxHeight: 150, 
          overflow: 'auto',
          mb: 2
        }}>
          {availableResources.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center', opacity: 0.6 }}>
              <Typography variant="body2">{t('common.noData')}</Typography>
              <Typography variant="caption">{t('inventoryPage.addHaResourcesFirst')}</Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {availableResources.map((res: any) => (
                <ListItemButton 
                  key={res.sid} 
                  onClick={() => toggleResource(res.sid)}
                  sx={{ py: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Switch 
                      size="small" 
                      checked={selectedResources.includes(res.sid)} 
                      onChange={() => toggleResource(res.sid)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </ListItemIcon>
                  <ListItemText 
                    primary={res.sid} 
                    primaryTypographyProps={{ variant: 'body2', fontFamily: 'monospace' }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        {/* Sélection des nœuds (uniquement pour node-affinity) */}
        {ruleType === 'node-affinity' && (
          <>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Nodes ({selectedNodes.length}/{availableNodes.length})
            </Typography>
            
            <Box sx={{ 
              border: '1px solid', 
              borderColor: 'divider', 
              borderRadius: 1, 
              maxHeight: 150, 
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
          </>
        )}

        <TextField
          fullWidth
          label={t('inventoryPage.comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={saving}
          multiline
          rows={2}
          placeholder={t('inventoryPage.optionalRuleDescription')}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || (!rule && !name.trim()) || selectedResources.length === 0 || (ruleType === 'node-affinity' && selectedNodes.length === 0)}
          startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />}
        >
          {saving ? t('common.saving') : rule ? t('common.edit') : t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}


export default HaRuleDialog
