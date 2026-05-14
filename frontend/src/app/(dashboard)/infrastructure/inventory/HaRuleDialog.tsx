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
  useTheme,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

type HaRuleDialogProps = {
  open: boolean
  onClose: () => void
  rule: any | null // null = creation, sinon = edition
  ruleType: 'node-affinity' | 'resource-affinity'
  connId: string
  availableNodes: any[] // node objects with { node, status, ... }
  availableResources: any[] // HA resources
  allVms?: any[] // all VMs for name resolution
  onSaved: () => void
}

function HaRuleDialog({ open, onClose, rule, ruleType, connId, availableNodes, availableResources, allVms, onSaved }: HaRuleDialogProps) {
  const t = useTranslations()
  const theme = useTheme()
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [strict, setStrict] = useState(false)
  const [affinity, setAffinity] = useState<'positive' | 'negative'>('positive')
  const [selectedNodes, setSelectedNodes] = useState<string[]>([])
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resourceSearch, setResourceSearch] = useState('')

  // Initialiser les valeurs quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      if (rule) {
        // Mode édition
        setName(rule.rule || '')
        setEnabled(!rule.disable)
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
      setResourceSearch('')
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
        disable: !enabled,
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

  const toggleNode = (nodeName: string) => {
    setSelectedNodes(prev =>
      prev.includes(nodeName)
        ? prev.filter(n => n !== nodeName)
        : [...prev, nodeName]
    )
  }

  const getVmInfo = (sid: string) => {
    const parts = sid.split(':')
    const vmType = parts[0] === 'ct' ? 'lxc' : 'qemu'
    const vmid = parts[1]
    const vm = (allVms || []).find((v: any) => String(v.vmid) === vmid)


return { vmType, vmid, name: vm?.name, status: vm?.status || 'unknown', template: vm?.template }
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
      <AppDialogTitle onClose={onClose} icon={<i className={ruleType === 'node-affinity' ? 'ri-node-tree' : 'ri-links-line'} style={{ fontSize: 20 }} />}>
        {rule ? t('common.edit') : t('common.create')} {ruleType === 'node-affinity' ? 'Node Affinity Rule' : 'Resource Affinity Rule'}
      </AppDialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
        )}

        <Alert severity="info" icon={<i className={ruleType === 'node-affinity' ? 'ri-route-line' : 'ri-links-line'} style={{ fontSize: 18 }} />} sx={{ mb: 2, '& .MuiAlert-message': { fontSize: 12 } }}>
          {ruleType === 'node-affinity'
            ? t('cluster.nodeAffinityInfo')
            : t('cluster.resourceAffinityInfo')
          }
        </Alert>

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mt: 1, mb: 2 }}>
          <TextField
            label={t('inventoryPage.ruleName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!rule || saving}
            sx={{ flex: 1 }}
            placeholder="Ex: ha-rule-web-servers"
            helperText={rule ? t('inventoryPage.nameCannotBeModified') : t('inventoryPage.uniqueRuleId')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={saving}
              />
            }
            label={t('common.enabled')}
            sx={{ mt: 0.5 }}
          />
        </Box>

        <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
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
            <FormControl size="small" fullWidth>
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

        <Box sx={{ px: 1.5, py: 1, border: '1px solid', borderColor: 'divider', borderRadius: '4px 4px 0 0', borderBottom: 'none', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <i className="ri-search-line" style={{ fontSize: 14, opacity: 0.4 }} />
          <input
            type="text"
            value={resourceSearch}
            onChange={e => setResourceSearch(e.target.value)}
            placeholder={t('common.search') + '...'}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: '100%', color: 'inherit', fontFamily: 'Inter, sans-serif' }}
          />
          {resourceSearch && (
            <button
              type="button"
              aria-label={t('common.clear')}
              onClick={() => setResourceSearch('')}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, display: 'inline-flex', color: 'inherit' }}
            >
              <i className="ri-close-line" style={{ fontSize: 14, opacity: 0.4 }} />
            </button>
          )}
        </Box>

        <Box sx={{
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '0 0 4px 4px',
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
              {availableResources
                .map((res: any) => ({ ...res, _info: getVmInfo(res.sid) }))
                .sort((a: any, b: any) => (a._info.name || a.sid).localeCompare(b._info.name || b.sid))
                .filter((res: any) => {
                  if (!resourceSearch.trim()) return true
                  const q = resourceSearch.toLowerCase()


return (res._info.name || '').toLowerCase().includes(q) || res.sid.toLowerCase().includes(q)
                })
                .map((res: any) => {
                const info = res._info
                const iconClass = info.template ? 'ri-file-copy-fill' : info.vmType === 'lxc' ? 'ri-instance-fill' : 'ri-computer-fill'
                const dotColor = info.template ? 'transparent' : info.status === 'running' ? '#4caf50' : info.status === 'paused' ? '#ed6c02' : '#f44336'

                return (
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
                    <Box sx={{ position: 'relative', display: 'inline-flex', mr: 1, flexShrink: 0 }}>
                      <i className={iconClass} style={{ fontSize: 16, opacity: 0.7 }} />
                      {!info.template && (
                        <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: dotColor, border: '1.5px solid', borderColor: 'background.paper', boxShadow: info.status === 'running' ? `0 0 4px ${dotColor}` : 'none' }} />
                      )}
                    </Box>
                    <ListItemText
                      primary={info.name || res.sid}
                      secondary={res.sid}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                      secondaryTypographyProps={{ variant: 'caption', sx: { opacity: 0.5, fontFamily: 'monospace', fontSize: 10 } }}
                    />
                  </ListItemButton>
                )
              })}
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
                {availableNodes.map((nodeObj: any) => {
                  const nodeName = typeof nodeObj === 'string' ? nodeObj : nodeObj.node
                  const nodeStatus = typeof nodeObj === 'string' ? 'unknown' : (nodeObj.status || 'unknown')
                  const dotColor = nodeStatus === 'online' ? '#4caf50' : '#f44336'
                  const logoSrc = theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'

                  return (
                    <ListItemButton
                      key={nodeName}
                      onClick={() => toggleNode(nodeName)}
                      sx={{ py: 0.5 }}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Switch
                          size="small"
                          checked={selectedNodes.includes(nodeName)}
                          onChange={() => toggleNode(nodeName)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </ListItemIcon>
                      <Box sx={{ position: 'relative', display: 'inline-flex', mr: 1, flexShrink: 0 }}>
                        <img src={logoSrc} alt="" width={16} height={16} style={{ opacity: nodeStatus === 'online' ? 0.8 : 0.4 }} />
                        <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 7, height: 7, borderRadius: '50%', bgcolor: dotColor, border: '1.5px solid', borderColor: 'background.paper' }} />
                      </Box>
                      <ListItemText
                        primary={nodeName}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                      />
                    </ListItemButton>
                  )
                })}
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
