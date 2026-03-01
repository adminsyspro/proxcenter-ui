'use client'

import { useEffect, useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'

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
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'

// Available macros organized by category
const TEMPLATE_MACROS = {
  event: {
    label: 'Event',
    icon: 'ri-calendar-event-line',
    macros: [
      { key: '{{event.type}}', label: 'Type (qmsnapshot, vzdump...)', example: 'vzdump' },
      { key: '{{event.type_label}}', label: 'Readable type', example: 'Backup' },
      { key: '{{event.entity}}', label: 'Related VM/CT', example: 'VM 101 (web-server)' },
      { key: '{{event.status}}', label: 'Status', example: 'OK' },
      { key: '{{event.message}}', label: 'Full message', example: 'Backup (101) - OK' },
      { key: '{{event.user}}', label: 'User', example: 'root@pam' },
      { key: '{{event.timestamp}}', label: 'Date/time', example: '03/02/2026 15:30:00' },
    ]
  },
  infrastructure: {
    label: 'Infrastructure',
    icon: 'ri-server-line',
    macros: [
      { key: '{{node.name}}', label: 'Node name', example: 'pve-node-01' },
      { key: '{{node.ip}}', label: 'Node IP', example: '192.168.1.10' },
      { key: '{{cluster.name}}', label: 'Cluster name', example: 'production-cluster' },
      { key: '{{cluster.id}}', label: 'Connection ID', example: 'conn_abc123' },
      { key: '{{datacenter}}', label: 'Datacenter', example: 'GRA4' },
    ]
  },
  alert: {
    label: 'Alert',
    icon: 'ri-alarm-warning-line',
    macros: [
      { key: '{{alert.severity}}', label: 'Severity', example: 'critical' },
      { key: '{{alert.severity_icon}}', label: 'Severity icon', example: '🚨' },
      { key: '{{alert.severity_color}}', label: 'Severity color', example: '#dc2626' },
      { key: '{{rule.name}}', label: 'Rule name', example: 'Backup failed' },
      { key: '{{rule.id}}', label: 'Rule ID', example: 'rule_backup_failed' },
    ]
  },
  system: {
    label: 'System',
    icon: 'ri-settings-3-line',
    macros: [
      { key: '{{app.name}}', label: 'Application name', example: 'ProxCenter' },
      { key: '{{app.url}}', label: 'Application URL', example: 'https://proxcenter.example.com' },
      { key: '{{app.version}}', label: 'Version', example: '1.0.0' },
      { key: '{{date.now}}', label: 'Current date', example: '03/02/2026' },
      { key: '{{date.time}}', label: 'Current time', example: '15:30:00' },
    ]
  }
}

// Default templates
const DEFAULT_TEMPLATES = {
  event: {
    name: 'Proxmox Event',
    subject: '[{{alert.severity}}] {{event.type_label}} - {{event.entity}}',
    body: `<div style="font-family: 'Inter', sans-serif;">
  <h2 style="margin: 0 0 16px 0; color: #18181b;">
    {{event.type_label}}
  </h2>

  <p style="color: #3f3f46; margin-bottom: 20px;">
    {{event.message}}
  </p>

  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #71717a; width: 120px;">Node</td>
      <td style="padding: 8px 0; font-weight: 600;">{{node.name}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #71717a;">Cluster</td>
      <td style="padding: 8px 0;">{{cluster.name}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #71717a;">User</td>
      <td style="padding: 8px 0;">{{event.user}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #71717a;">Status</td>
      <td style="padding: 8px 0; font-weight: 600; color: {{alert.severity_color}};">{{event.status}}</td>
    </tr>
  </table>

  <p style="margin-top: 20px; padding: 12px; background: #f4f4f5; border-radius: 8px; font-size: 13px; color: #71717a;">
    Triggered rule: {{rule.name}}
  </p>
</div>`
  },
  backup: {
    name: 'Backup',
    subject: '[Backup] {{event.entity}} - {{event.status}}',
    body: `<div style="font-family: 'Inter', sans-serif;">
  <h2 style="margin: 0 0 16px 0; color: #18181b;">
    Backup {{event.status}}
  </h2>

  <p style="color: #3f3f46;">
    The backup of <strong>{{event.entity}}</strong> on <strong>{{node.name}}</strong> completed with status: <strong style="color: {{alert.severity_color}};">{{event.status}}</strong>
  </p>

  <table style="width: 100%; margin-top: 20px; border-collapse: collapse; background: #f8fafc; border-radius: 8px;">
    <tr>
      <td style="padding: 12px; color: #64748b;">Cluster</td>
      <td style="padding: 12px; font-weight: 500;">{{cluster.name}}</td>
    </tr>
    <tr>
      <td style="padding: 12px; color: #64748b;">Date</td>
      <td style="padding: 12px;">{{event.timestamp}}</td>
    </tr>
  </table>
</div>`
  },
  migration: {
    name: 'Migration',
    subject: '[Migration] {{event.entity}} - {{event.status}}',
    body: `<div style="font-family: 'Inter', sans-serif;">
  <h2 style="margin: 0 0 16px 0; color: #18181b;">
    Migration {{event.status}}
  </h2>

  <p style="color: #3f3f46;">
    Migration of <strong>{{event.entity}}</strong> completed.
  </p>

  <table style="width: 100%; margin-top: 20px;">
    <tr>
      <td style="padding: 8px 0; color: #71717a;">Source node</td>
      <td style="padding: 8px 0; font-weight: 600;">{{node.name}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #71717a;">Status</td>
      <td style="padding: 8px 0; color: {{alert.severity_color}};">{{event.status}}</td>
    </tr>
  </table>
</div>`
  },
  alert: {
    name: 'System Alert',
    subject: '{{alert.severity_icon}} [{{alert.severity}}] {{rule.name}}',
    body: `<div style="font-family: 'Inter', sans-serif;">
  <h2 style="margin: 0 0 16px 0; color: {{alert.severity_color}};">
    {{alert.severity_icon}} {{rule.name}}
  </h2>

  <p style="color: #3f3f46; margin-bottom: 20px;">
    {{event.message}}
  </p>

  <div style="padding: 16px; background: #fef2f2; border-left: 4px solid {{alert.severity_color}}; border-radius: 4px;">
    <strong>Resource:</strong> {{event.entity}}<br>
    <strong>Node:</strong> {{node.name}}<br>
    <strong>Cluster:</strong> {{cluster.name}}
  </div>
</div>`
  }
}

// Example data for preview
const PREVIEW_DATA = {
  event: {
    type: 'vzdump',
    type_label: 'Backup',
    entity: 'VM 101 (web-server)',
    status: 'OK',
    message: 'Backup (101) completed successfully',
    user: 'root@pam',
    timestamp: '03/02/2026 15:30:00'
  },
  node: {
    name: 'pve-node-01',
    ip: '192.168.1.10'
  },
  cluster: {
    name: 'Production GRA4',
    id: 'conn_gra4_prod'
  },
  datacenter: 'GRA4',
  alert: {
    severity: 'warning',
    severity_icon: '⚠️',
    severity_color: '#f59e0b'
  },
  rule: {
    name: 'Backups completed',
    id: 'rule_backup_completed'
  },
  app: {
    name: 'ProxCenter',
    url: 'https://proxcenter.example.com',
    version: '1.0.0'
  },
  date: {
    now: '03/02/2026',
    time: '15:30:00'
  }
}

// Function to replace macros with values
function replaceMacros(template, data) {
  if (!template) return ''
  
  let result = template
  
  // Iterate through all macro categories
  Object.entries(data).forEach(([category, values]) => {
    if (typeof values === 'object') {
      Object.entries(values).forEach(([key, value]) => {
        const macro = `{{${category}.${key}}}`
        result = result.replace(new RegExp(macro.replace(/[{}]/g, '\\$&'), 'g'), value || '')
      })
    } else {
      const macro = `{{${category}}}`
      result = result.replace(new RegExp(macro.replace(/[{}]/g, '\\$&'), 'g'), values || '')
    }
  })
  
  return result
}

// Function to get the gradient end color
function getSeverityGradientEnd(color) {
  switch (color) {
    case '#dc2626': return '#991b1b' // critical - red
    case '#f59e0b': return '#d97706' // warning - amber  
    case '#10b981': return '#059669' // success - green
    default: return '#1d4ed8' // info - blue
  }
}

async function fetchJson(url, init) {
  const r = await fetch(url, init)
  const text = await r.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)
  return json
}

export default function EmailTemplateEditor() {
  const t = useTranslations()
  
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [editedTemplate, setEditedTemplate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)
  const [previewTab, setPreviewTab] = useState(0) // 0 = edit, 1 = preview
  const [macroCategory, setMacroCategory] = useState('event')
  const [previewData, setPreviewData] = useState(PREVIEW_DATA)
  const [showMacroDialog, setShowMacroDialog] = useState(false)

  // Load templates from API
  const loadTemplates = async () => {
    setLoading(true)
    try {
      const data = await fetchJson('/api/v1/orchestrator/notifications/templates')
      if (data && data.length > 0) {
        setTemplates(data)
        setSelectedTemplate(data[0])
        setEditedTemplate({ ...data[0] })
      } else {
        // Use default templates
        const defaultList = Object.entries(DEFAULT_TEMPLATES).map(([id, tpl]) => ({
          id,
          ...tpl,
          is_default: true
        }))
        setTemplates(defaultList)
        setSelectedTemplate(defaultList[0])
        setEditedTemplate({ ...defaultList[0] })
      }
    } catch (err) {
      console.error('Failed to load templates:', err)
      // Fallback to default templates
      const defaultList = Object.entries(DEFAULT_TEMPLATES).map(([id, tpl]) => ({
        id,
        ...tpl,
        is_default: true
      }))
      setTemplates(defaultList)
      setSelectedTemplate(defaultList[0])
      setEditedTemplate({ ...defaultList[0] })
    } finally {
      setLoading(false)
    }
  }

  // Save the template
  const saveTemplate = async () => {
    if (!editedTemplate) return
    
    setSaving(true)
    try {
      await fetchJson('/api/v1/orchestrator/notifications/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedTemplate)
      })
      setMessage({ type: 'success', text: t('emailTemplate.templateSaved') })
      loadTemplates()
    } catch (err) {
      setMessage({ type: 'error', text: t('common.error') + ': ' + err.message })
    } finally {
      setSaving(false)
    }
  }

  // Reset to default template
  const resetToDefault = () => {
    if (selectedTemplate && DEFAULT_TEMPLATES[selectedTemplate.id]) {
      setEditedTemplate({
        ...selectedTemplate,
        ...DEFAULT_TEMPLATES[selectedTemplate.id]
      })
    }
  }

  // Insert a macro into the body
  const insertMacro = (macro) => {
    if (!editedTemplate) return
    setEditedTemplate(prev => ({
      ...prev,
      body: prev.body + macro
    }))
  }

  // HTML preview
  const previewHtml = useMemo(() => {
    if (!editedTemplate) return ''
    return replaceMacros(editedTemplate.body, previewData)
  }, [editedTemplate, previewData])

  const previewSubject = useMemo(() => {
    if (!editedTemplate) return ''
    return replaceMacros(editedTemplate.subject, previewData)
  }, [editedTemplate, previewData])

  useEffect(() => {
    loadTemplates()
  }, [])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Sidebar - Template list */}
        <Grid item xs={12} md={3}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                <i className="ri-file-list-3-line" style={{ marginRight: 8 }} />
                Templates
              </Typography>
              
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {templates.map((tpl) => (
                  <Button
                    key={tpl.id}
                    variant={selectedTemplate?.id === tpl.id ? 'contained' : 'outlined'}
                    size="small"
                    fullWidth
                    sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
                    onClick={() => {
                      setSelectedTemplate(tpl)
                      setEditedTemplate({ ...tpl })
                    }}
                  >
                    {tpl.name}
                    {tpl.is_default && (
                      <Chip label={t('emailTemplate.defaultChip')} size="small" sx={{ ml: 'auto', height: 18, fontSize: 10 }} />
                    )}
                  </Button>
                ))}
              </Box>

              <Divider sx={{ my: 2 }} />

              {/* Available macros */}
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
                <i className="ri-code-s-slash-line" style={{ marginRight: 8 }} />
                {t('emailTemplate.macros')}
              </Typography>

              <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                <Select
                  value={macroCategory}
                  onChange={(e) => setMacroCategory(e.target.value)}
                >
                  {Object.entries(TEMPLATE_MACROS).map(([key, cat]) => (
                    <MenuItem key={key} value={key}>
                      <i className={cat.icon} style={{ marginRight: 8 }} />
                      {cat.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 300, overflow: 'auto' }}>
                {TEMPLATE_MACROS[macroCategory]?.macros.map((macro) => (
                  <Tooltip key={macro.key} title={`Ex: ${macro.example}`} placement="right">
                    <Chip
                      label={macro.key}
                      size="small"
                      variant="outlined"
                      onClick={() => insertMacro(macro.key)}
                      sx={{ 
                        cursor: 'pointer',
                        justifyContent: 'flex-start',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                    />
                  </Tooltip>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Main editor */}
        <Grid item xs={12} md={9}>
          <Card variant="outlined">
            <CardContent>
              {/* Tabs Edit/Preview */}
              <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
                <Tabs value={previewTab} onChange={(e, v) => setPreviewTab(v)}>
                  <Tab
                    icon={<i className="ri-edit-line" />}
                    iconPosition="start"
                    label={t('emailTemplate.edit')}
                  />
                  <Tab
                    icon={<i className="ri-eye-line" />}
                    iconPosition="start"
                    label={t('emailTemplate.preview')}
                  />
                </Tabs>
              </Box>

              {previewTab === 0 ? (
                /* Edit mode */
                <Box>
                  <TextField
                    fullWidth
                    label={t('emailTemplate.templateName')}
                    value={editedTemplate?.name || ''}
                    onChange={(e) => setEditedTemplate(prev => ({ ...prev, name: e.target.value }))}
                    sx={{ mb: 2 }}
                  />

                  <TextField
                    fullWidth
                    label={t('emailTemplate.emailSubject')}
                    value={editedTemplate?.subject || ''}
                    onChange={(e) => setEditedTemplate(prev => ({ ...prev, subject: e.target.value }))}
                    placeholder="[{{alert.severity}}] {{event.type_label}} - {{event.entity}}"
                    sx={{ mb: 2 }}
                    helperText={t('emailTemplate.emailSubjectHelper')}
                  />

                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    {t('emailTemplate.templateBody')}
                  </Typography>
                  <TextField
                    fullWidth
                    multiline
                    rows={16}
                    value={editedTemplate?.body || ''}
                    onChange={(e) => setEditedTemplate(prev => ({ ...prev, body: e.target.value }))}
                    sx={{ 
                      mb: 2,
                      '& .MuiInputBase-input': {
                        fontFamily: 'monospace',
                        fontSize: 13
                      }
                    }}
                  />

                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                      variant="contained"
                      startIcon={saving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
                      onClick={saveTemplate}
                      disabled={saving}
                    >
                      {t('common.save')}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<i className="ri-refresh-line" />}
                      onClick={resetToDefault}
                    >
                      {t('common.reset')}
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<i className="ri-question-line" />}
                      onClick={() => setShowMacroDialog(true)}
                    >
                      {t('emailTemplate.macroHelp')}
                    </Button>
                  </Box>
                </Box>
              ) : (
                /* Preview mode */
                <Box>
                  {/* Subject preview */}
                  <Paper variant="outlined" sx={{ p: 2, mb: 2, bgcolor: '#f8fafc', borderRadius: 2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                      {t('emailTemplate.emailSubjectPreview')}
                    </Typography>
                    <Typography variant="body1" fontWeight={600}>
                      {previewSubject}
                    </Typography>
                  </Paper>

                  {/* Email Preview Container */}
                  <Paper 
                    variant="outlined" 
                    sx={{ 
                      p: 4, 
                      overflow: 'hidden',
                      background: 'linear-gradient(135deg, #1e1e2d 0%, #2d2d3f 100%)',
                      minHeight: 500,
                      borderRadius: 2
                    }}
                  >
                    {/* Email Card */}
                    <Box sx={{ 
                      maxWidth: 600, 
                      mx: 'auto',
                      bgcolor: '#ffffff',
                      borderRadius: 3,
                      overflow: 'hidden',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
                    }}>
                      {/* ProxCenter header with logo */}
                      <Box sx={{ 
                        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)', 
                        p: 3, 
                        display: 'flex', 
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 1.5
                      }}>
                        <Box 
                          component="img"
                          src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjIwIiBoZWlnaHQ9IjE3MCIgdmlld0JveD0iMCAwIDIyMCAxNzAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHBhdGggZD0iTSAxNzQuMzAgMTU4LjkxIEMxNjAuOTksMTQwLjM0IDE1NS44MSwxMzMuMTggMTUxLjUyLDEyNy40MiBDMTQ5LjA0LDEyNC4wOCAxNDcuMDAsMTIwLjc4IDE0Ny4wMCwxMjAuMTAgQzE0Ny4wMCwxMTkuNDIgMTQ4LjkxLDExNi40NyAxNTEuMjUsMTEzLjU1IEMxNTMuNTksMTEwLjYzIDE1Ny40NCwxMDUuNzEgMTU5LjgxLDEwMi42MiBDMTYyLjE4LDk5LjUzIDE2NC43MSw5Ny4wMCAxNjUuNDQsOTcuMDAgQzE2Ni41OCw5Ny4wMCAxODIuOTMsMTE5LjA5IDIwMC43OSwxNDQuNzcgQzIwMy43MSwxNDguOTUgMjA4LjMyLDE1NS4zOCAyMTEuMDQsMTU5LjA2IEMyMTMuNzcsMTYyLjc0IDIxNi4wMCwxNjYuMDMgMjE2LjAwLDE2Ni4zNyBDMjE2LjAwLDE2Ni43MiAyMDcuOTIsMTY3LjAwIDE5OC4wNSwxNjcuMDAgTCAxODAuMTAgMTY3LjAwIFogTSAxNjQuMTEgNjkuNjIgQzE2MS44Nyw2Ny4yNCAxNTkuMjIsNjMuNjEgMTUxLjQ0LDUyLjI5IEwgMTQ3Ljg1IDQ3LjA3IEwgMTUzLjc5IDM5LjI5IEMxNTcuMDUsMzUuMDAgMTYxLjI1LDI5LjYyIDE2My4xMSwyNy4zMiBDMTY0Ljk4LDI1LjAyIDE2OS42NSwxOS4wOCAxNzMuNTAsMTQuMTEgTCAxODAuNTAgNS4wOCBMIDE5OS4yNSA1LjA0IEMyMDkuNTYsNS4wMiAyMTguMDAsNS4yMyAyMTguMDAsNS41MSBDMjE4LjAwLDUuNzkgMjE0LjUxLDEwLjQyIDIxMC4yNSwxNS44MSBDMjA1Ljk5LDIxLjE5IDE5OS44MCwyOS4xMSAxOTYuNTAsMzMuNDEgQzE5My4yMCwzNy43MSAxODkuMTUsNDIuOTIgMTg3LjUwLDQ0Ljk4IEMxODMuMTgsNTAuMzkgMTY5LjMyLDY4LjE4IDE2Ny43Niw3MC4zMCBDMTY2LjUyLDcyLjAxIDE2Ni4zMyw3MS45OCAxNjQuMTEsNjkuNjIgWiIgZmlsbD0iI0YyOTIyMSIvPgogIDxwYXRoIGQ9Ik0gMC4wMyAxNjQuNzUgQzAuMDUsMTYyLjE4IDIuMDAsMTU5LjA0IDkuMjgsMTQ5LjgzIEMxOS45MiwxMzYuMzcgNDUuNTYsMTAzLjQzIDU0Ljg0LDkxLjMyIEwgNjEuMTcgODMuMDUgTCA1OC44NyA3OS43NyBDNDkuMzIsNjYuMTggMTEuMTAsMTIuNzcgOC44Myw5Ljg2IEM3LjI4LDcuODUgNi4wMCw1Ljk0IDYuMDAsNS42MSBDNi4wMCw1LjI3IDE0LjIxLDUuMDEgMjQuMjUsNS4wMyBMIDQyLjUwIDUuMDYgTCA1My41MCAyMC42MyBDNTkuNTUsMjkuMjAgNjUuNDQsMzcuNDAgNjYuNTgsMzguODUgQzcyLjE2LDQ1Ljk3IDk3LjMzLDgxLjY5IDk3LjcwLDgzLjAyIEM5OC4xMyw4NC41OSA5NS40MCw4OC4yNyA2My41MCwxMjkuMDYgQzUzLjA1LDE0Mi40MiA0Mi43NywxNTUuNjQgNDAuNjYsMTU4LjQzIEMzMi44NCwxNjguNzYgMzQuNzcsMTY4LjAwIDE2LjMzLDE2OC4wMCBMIDAuMDAgMTY4LjAwIEwgMC4wMyAxNjQuNzUgWiBNIDU1LjU2IDE2Ny4wOSBDNTUuMjUsMTY2LjU5IDU2Ljk1LDE2My43OCA1OS4zMywxNjAuODQgQzYxLjcxLDE1Ny45MCA2Ni4xMCwxNTIuMzMgNjkuMDgsMTQ4LjQ2IEM3Mi4wNiwxNDQuNTkgODEuNDcsMTMyLjUwIDkwLjAwLDEyMS42MCBDOTguNTMsMTEwLjY5IDEwNi4zOCwxMDAuNTggMTA3LjQ2LDk5LjEzIEMxMDguNTQsOTcuNjkgMTExLjgxLDkzLjQ5IDExNC43Miw4OS44MCBMIDEyMC4wMCA4My4xMCBMIDExNS4yNSA3Ni40NyBDMTEyLjY0LDcyLjgyIDEwOS44Miw2OC44MyAxMDkuMDAsNjcuNjEgQzEwOC4xOCw2Ni4zOCAxMDUuNzMsNjIuOTMgMTAzLjU3LDU5Ljk0IEMxMDEuNDEsNTYuOTUgOTYuODgsNTAuNjcgOTMuNTEsNDYuMDAgQzc3LjE1LDIzLjM2IDY1LjAwLDYuMTIgNjUuMDAsNS41NyBDNjUuMDAsNS4yMyA3My4yMSw1LjA4IDgzLjI0LDUuMjMgTCAxMDEuNDkgNS41MCBMIDEyNC43NyAzOC4wMCBDMTM3LjU4LDU1Ljg4IDE1MC4wOSw3My4zNyAxNTIuNTgsNzYuODggQzE1NS4wOCw4MC4zOSAxNTYuOTEsODMuNzkgMTU2LjY2LDg0LjQ0IEMxNTYuNDEsODUuMDkgMTUzLjU1LDg4Ljk3IDE1MC4zMCw5My4wNiBDMTQ3LjA2LDk3LjE1IDEzNy45MywxMDguODIgMTMwLjAyLDExOS4wMCBDMTIyLjEyLDEyOS4xOCAxMTAuMjksMTQ0LjM2IDEwMy43NSwxNTIuNzUgTCA5MS44NSAxNjguMDAgTCA3My45OCAxNjguMDAgQzY0LjE2LDE2OC4wMCA1NS44NywxNjcuNTkgNTUuNTYsMTY3LjA5IFoiIGZpbGw9IiNGQ0ZDRkMiLz4KPC9zdmc+Cg=="
                          alt="ProxCenter"
                          sx={{ width: 40, height: 32 }}
                        />
                        <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 24, letterSpacing: -0.5 }}>
                          PROX
                        </Typography>
                        <Typography sx={{ color: '#e57000', fontWeight: 300, fontSize: 24, letterSpacing: -0.5 }}>
                          CENTER
                        </Typography>
                      </Box>

                      {/* Severity Banner */}
                      <Box sx={{ 
                        background: `linear-gradient(90deg, ${previewData.alert.severity_color} 0%, ${getSeverityGradientEnd(previewData.alert.severity_color)} 100%)`,
                        p: 2,
                        px: 3,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <Typography sx={{ 
                          color: '#fff', 
                          fontWeight: 600, 
                          fontSize: 14, 
                          textTransform: 'uppercase',
                          letterSpacing: 1,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1
                        }}>
                          <span style={{ fontSize: 18 }}>{previewData.alert.severity_icon}</span>
                          {previewData.alert.severity}
                        </Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
                          📅 {previewData.event.timestamp}
                        </Typography>
                      </Box>

                      {/* Content */}
                      <Box sx={{ p: 4 }}>
                        <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                      </Box>

                      {/* Divider */}
                      <Box sx={{ px: 4 }}>
                        <Divider />
                      </Box>

                      {/* Footer */}
                      <Box sx={{ p: 3, bgcolor: '#f9fafb', textAlign: 'center' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                          {t('emailTemplate.autoEmail')}
                        </Typography>
                        <Typography variant="body2" fontWeight={600} color="text.primary">
                          🖥️ ProxCenter - Proxmox Management Platform
                        </Typography>
                      </Box>
                    </Box>

                    {/* Sub-footer */}
                    <Box sx={{ textAlign: 'center', mt: 2 }}>
                      <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                        © 2026 ProxCenter • {t('emailTemplate.manageNotifications')}
                      </Typography>
                    </Box>
                  </Paper>

                  {/* Editable test data */}
                  <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" sx={{ mb: 2 }}>
                      <i className="ri-test-tube-line" style={{ marginRight: 8 }} />
                      {t('emailTemplate.testData')}
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid item xs={6} md={3}>
                        <TextField
                          fullWidth
                          size="small"
                          label={t('emailTemplate.entity')}
                          value={previewData.event.entity}
                          onChange={(e) => setPreviewData(prev => ({
                            ...prev,
                            event: { ...prev.event, entity: e.target.value }
                          }))}
                        />
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <TextField
                          fullWidth
                          size="small"
                          label={t('common.status')}
                          value={previewData.event.status}
                          onChange={(e) => setPreviewData(prev => ({
                            ...prev,
                            event: { ...prev.event, status: e.target.value }
                          }))}
                        />
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <TextField
                          fullWidth
                          size="small"
                          label={t('emailTemplate.node')}
                          value={previewData.node.name}
                          onChange={(e) => setPreviewData(prev => ({
                            ...prev,
                            node: { ...prev.node, name: e.target.value }
                          }))}
                        />
                      </Grid>
                      <Grid item xs={6} md={3}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('emailTemplate.severity')}</InputLabel>
                          <Select
                            value={previewData.alert.severity}
                            label={t('emailTemplate.severity')}
                            onChange={(e) => {
                              const severity = e.target.value
                              const colors = {
                                info: { icon: 'ℹ️', color: '#3b82f6' },
                                success: { icon: '✅', color: '#10b981' },
                                warning: { icon: '⚠️', color: '#f59e0b' },
                                critical: { icon: '🚨', color: '#dc2626' }
                              }
                              setPreviewData(prev => ({
                                ...prev,
                                alert: {
                                  severity,
                                  severity_icon: colors[severity].icon,
                                  severity_color: colors[severity].color
                                }
                              }))
                            }}
                          >
                            <MenuItem value="info">Info</MenuItem>
                            <MenuItem value="success">Success</MenuItem>
                            <MenuItem value="warning">Warning</MenuItem>
                            <MenuItem value="critical">Critical</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                    </Grid>
                  </Box>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Macro help dialog */}
      <Dialog open={showMacroDialog} onClose={() => setShowMacroDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <i className="ri-code-s-slash-line" style={{ marginRight: 8 }} />
          {t('emailTemplate.macroReference')}
        </DialogTitle>
        <DialogContent dividers>
          {Object.entries(TEMPLATE_MACROS).map(([key, category]) => (
            <Box key={key} sx={{ mb: 3 }}>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className={category.icon} />
                {category.label}
              </Typography>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e4e4e7' }}>{t('emailTemplate.macro')}</th>
                    <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e4e4e7' }}>{t('common.description')}</th>
                    <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #e4e4e7' }}>{t('emailTemplate.example')}</th>
                  </tr>
                </thead>
                <tbody>
                  {category.macros.map((macro) => (
                    <tr key={macro.key}>
                      <td style={{ padding: '8px', fontFamily: 'monospace', color: '#7c3aed' }}>{macro.key}</td>
                      <td style={{ padding: '8px' }}>{macro.label}</td>
                      <td style={{ padding: '8px', color: '#71717a' }}>{macro.example}</td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowMacroDialog(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
