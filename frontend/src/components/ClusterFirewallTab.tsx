'use client'

import React, { useState, useEffect, useCallback } from 'react'
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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface FirewallRule {
  pos: number
  type: string
  action: string
  enable?: number
  source?: string
  dest?: string
  proto?: string
  dport?: string
  sport?: string
  macro?: string
  iface?: string
  log?: string
  comment?: string
}

interface FirewallOptions {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_ratelimit?: string
}

interface SecurityGroup {
  group: string
  comment?: string
  rules?: FirewallRule[]
}

interface Alias {
  name: string
  cidr: string
  comment?: string
}

interface IPSet {
  name: string
  comment?: string
}

interface Props {
  connectionId: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function ClusterFirewallTab({ connectionId }: Props) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main

  // States
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'options' | 'rules' | 'groups' | 'aliases' | 'ipsets'>('options')

  // Firewall data
  const [options, setOptions] = useState<FirewallOptions>({})
  const [rules, setRules] = useState<FirewallRule[]>([])
  const [groups, setGroups] = useState<SecurityGroup[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [ipsets, setIpsets] = useState<IPSet[]>([])

  // Load all firewall data
  const loadFirewallData = useCallback(async () => {
    if (!connectionId) return
    
    setLoading(true)
    setError(null)
    
    try {
      // Load options
      const optRes = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/firewall/options`)
      const optJson = await optRes.json()
      if (optJson.data) setOptions(optJson.data)

      // Load rules
      const rulesRes = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/firewall/rules`)
      const rulesJson = await rulesRes.json()
      if (rulesJson.data) setRules(rulesJson.data)

      // Load security groups
      const groupsRes = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/firewall/groups`)
      const groupsJson = await groupsRes.json()
      if (groupsJson.data) setGroups(groupsJson.data)

      // Load aliases
      const aliasRes = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/firewall/aliases`)
      const aliasJson = await aliasRes.json()
      if (aliasJson.data) setAliases(aliasJson.data)

      // Load ipsets
      const ipsetRes = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/firewall/ipset`)
      const ipsetJson = await ipsetRes.json()
      if (ipsetJson.data) setIpsets(ipsetJson.data)

    } catch (e: any) {
      setError(e?.message || 'Failed to load firewall data')
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => {
    loadFirewallData()
  }, [loadFirewallData])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Sub-tabs */}
      <Box sx={{ display: 'flex', gap: 1, p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        {[
          { key: 'options', label: 'Options', icon: 'ri-settings-3-line' },
          { key: 'rules', label: 'Rules', icon: 'ri-list-check-2', count: rules.length },
          { key: 'groups', label: 'Security Groups', icon: 'ri-shield-check-line', count: groups.length },
          { key: 'aliases', label: 'Aliases', icon: 'ri-price-tag-3-line', count: aliases.length },
          { key: 'ipsets', label: 'IPSets', icon: 'ri-database-line', count: ipsets.length },
        ].map(tab => (
          <Chip
            key={tab.key}
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <i className={tab.icon} style={{ fontSize: 14 }} />
                {tab.label}
                {tab.count !== undefined && (
                  <Chip size="small" label={tab.count} sx={{ height: 16, fontSize: 10, ml: 0.5 }} />
                )}
              </Box>
            }
            onClick={() => setActiveTab(tab.key as any)}
            sx={{
              cursor: 'pointer',
              bgcolor: activeTab === tab.key ? 'primary.main' : 'action.hover',
              color: activeTab === tab.key ? 'primary.contrastText' : 'text.primary',
              '&:hover': { bgcolor: activeTab === tab.key ? 'primary.dark' : 'action.selected' },
            }}
          />
        ))}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {/* Options Tab */}
        {activeTab === 'options' && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Firewall Options</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="body2">Firewall Enabled</Typography>
                  <Chip 
                    size="small" 
                    label={options.enable ? 'Yes' : 'No'} 
                    color={options.enable ? 'success' : 'default'} 
                  />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="body2">Input Policy</Typography>
                  <Chip size="small" label={options.policy_in || 'DROP'} color={options.policy_in === 'ACCEPT' ? 'success' : 'warning'} />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                  <Typography variant="body2">Output Policy</Typography>
                  <Chip size="small" label={options.policy_out || 'ACCEPT'} color={options.policy_out === 'ACCEPT' ? 'success' : 'warning'} />
                </Box>
                {options.log_ratelimit && (
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                    <Typography variant="body2">Log Rate Limit</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{options.log_ratelimit}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <Box>
            {rules.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 700, width: 50 }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Action</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Direction</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Source</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Dest</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Proto</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>D.Port</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Comment</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="center">Enabled</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rules.map((rule, idx) => (
                    <TableRow key={idx} hover sx={{ opacity: rule.enable === 0 ? 0.5 : 1 }}>
                      <TableCell>{rule.pos}</TableCell>
                      <TableCell>
                        <Chip 
                          size="small" 
                          label={rule.action} 
                          color={rule.action === 'ACCEPT' ? 'success' : rule.action === 'DROP' ? 'error' : 'warning'}
                          sx={{ height: 20, fontSize: 11 }}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={rule.type} sx={{ height: 20, fontSize: 11 }} />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{rule.source || '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{rule.dest || '—'}</TableCell>
                      <TableCell>{rule.proto || '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{rule.dport || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {rule.comment || '—'}
                      </TableCell>
                      <TableCell align="center">
                        {rule.enable !== 0 ? (
                          <i className="ri-checkbox-circle-fill" style={{ color: '#4caf50', fontSize: 18 }} />
                        ) : (
                          <i className="ri-close-circle-fill" style={{ color: '#9e9e9e', fontSize: 18 }} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                <i className="ri-shield-line" style={{ fontSize: 48 }} />
                <Typography sx={{ mt: 1 }}>No firewall rules configured</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Security Groups Tab */}
        {activeTab === 'groups' && (
          <Box>
            {groups.length > 0 ? (
              <Stack spacing={2}>
                {groups.map((group) => (
                  <Card key={group.group} variant="outlined">
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className="ri-shield-check-line" style={{ fontSize: 18, color: primaryColor }} />
                          <Typography fontWeight={600}>{group.group}</Typography>
                        </Box>
                        {group.comment && (
                          <Typography variant="caption" sx={{ opacity: 0.7 }}>{group.comment}</Typography>
                        )}
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                <i className="ri-shield-check-line" style={{ fontSize: 48 }} />
                <Typography sx={{ mt: 1 }}>No security groups configured</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* Aliases Tab */}
        {activeTab === 'aliases' && (
          <Box>
            {aliases.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>CIDR</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Comment</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {aliases.map((alias) => (
                    <TableRow key={alias.name} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{alias.name}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{alias.cidr}</TableCell>
                      <TableCell sx={{ opacity: 0.7 }}>{alias.comment || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                <i className="ri-price-tag-3-line" style={{ fontSize: 48 }} />
                <Typography sx={{ mt: 1 }}>No aliases configured</Typography>
              </Box>
            )}
          </Box>
        )}

        {/* IPSets Tab */}
        {activeTab === 'ipsets' && (
          <Box>
            {ipsets.length > 0 ? (
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Comment</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ipsets.map((ipset) => (
                    <TableRow key={ipset.name} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{ipset.name}</TableCell>
                      <TableCell sx={{ opacity: 0.7 }}>{ipset.comment || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
                <i className="ri-database-line" style={{ fontSize: 48 }} />
                <Typography sx={{ mt: 1 }}>No IPSets configured</Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}
