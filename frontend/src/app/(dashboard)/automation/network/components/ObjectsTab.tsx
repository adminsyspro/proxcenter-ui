'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  IconButton, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { useToast } from '@/contexts/ToastContext'

import { useMicrosegPolicy } from '@/lib/microseg/useMicroseg'

import FirewallLoadAlert from './FirewallLoadAlert'
import { WriteTip, useMicrosegWrite } from './microseg/microsegAccess'
import MicrosegConfirmDialog from './microseg/MicrosegConfirmDialog'
import { objectChipSx, objectColour, objectDotSx } from './microseg/objectColour'

interface ObjectsTabProps {
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  selectedConnection: string
  loading: boolean
  /** What failed on the last load of the firewall data, null when it all loaded. */
  loadError?: string | null
  reload: () => void
  view?: 'aliases' | 'ipsets'
}

export default function ObjectsTab({ aliases, ipsets, selectedConnection, loading, loadError, reload, view }: ObjectsTabProps) {
  const theme = useTheme()
  const t = useTranslations()
  const { showToast } = useToast()
  // A read-only user (no node.manage on the connection) sees every write control disabled, with the reason.
  const { canWrite } = useMicrosegWrite()
  const writable = canWrite && !!selectedConnection
  const { data: microsegPolicy } = useMicrosegPolicy(selectedConnection || null)
  const zones = microsegPolicy?.zones ?? []

  // Alias state
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false)
  const [editingAlias, setEditingAlias] = useState<firewallAPI.Alias | null>(null)
  const [newAlias, setNewAlias] = useState({ name: '', cidr: '', comment: '' })

  // IP Set state
  const [ipsetDialogOpen, setIPSetDialogOpen] = useState(false)
  const [editingIPSet, setEditingIPSet] = useState<{ name: string; comment: string } | null>(null)
  const [newIPSet, setNewIPSet] = useState({ name: '', comment: '' })
  const [ipsetEntryDialog, setIPSetEntryDialog] = useState<{ open: boolean; ipsetName: string }>({ open: false, ipsetName: '' })
  const [newIPSetEntry, setNewIPSetEntry] = useState({ cidr: '', comment: '' })

  // The alias or IP set whose deletion is asked (themed dialog, never a native confirm), and that deletion while it runs
  const [toDelete, setToDelete] = useState<{ kind: 'alias' | 'ipset'; name: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const askDelete = (kind: 'alias' | 'ipset', name: string) => {
    setDeleteError(null)
    setToDelete({ kind, name })
  }

  const totalIPSetEntries = ipsets.reduce((acc, s) => acc + (s.members?.length || 0), 0)

  // ── Alias handlers ──
  const handleCreateAlias = async () => {
    try {
      await firewallAPI.createAlias(selectedConnection, newAlias)
      showToast(t('networkPage.aliasCreated'), 'success')
      setAliasDialogOpen(false)
      setNewAlias({ name: '', cidr: '', comment: '' })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.creationError'), 'error')
    }
  }

  const handleUpdateAlias = async () => {
    if (!editingAlias) return
    try {
      await firewallAPI.updateAlias(selectedConnection, editingAlias.name, {
        cidr: editingAlias.cidr,
        comment: editingAlias.comment || ''
      })
      showToast(t('networkPage.aliasUpdated'), 'success')
      setEditingAlias(null)
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      if (toDelete.kind === 'alias') await firewallAPI.deleteAlias(selectedConnection, toDelete.name)
      else await firewallAPI.deleteIPSet(selectedConnection, toDelete.name)
      showToast(t(toDelete.kind === 'alias' ? 'networkPage.aliasDeleted' : 'networkPage.ipSetDeleted'), 'success')
      setToDelete(null)
      reload()
    } catch (err: any) {
      setDeleteError(err?.message || t('networkPage.error'))
    } finally {
      setDeleting(false)
    }
  }

  // ── IP Set handlers ──
  const handleCreateIPSet = async () => {
    try {
      await firewallAPI.createIPSet(selectedConnection, newIPSet)
      showToast(t('networkPage.ipSetCreated'), 'success')
      setIPSetDialogOpen(false)
      setNewIPSet({ name: '', comment: '' })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleUpdateIPSet = async () => {
    if (!editingIPSet) return
    try {
      await firewallAPI.updateIPSetComment(selectedConnection, editingIPSet.name, editingIPSet.comment)
      showToast(t('networkPage.ipSetUpdated'), 'success')
      setEditingIPSet(null)
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleAddIPSetEntry = async () => {
    if (!ipsetEntryDialog.ipsetName) return
    try {
      await firewallAPI.addIPSetEntry(selectedConnection, ipsetEntryDialog.ipsetName, newIPSetEntry)
      showToast(t('networkPage.entryAdded'), 'success')
      setIPSetEntryDialog({ open: false, ipsetName: '' })
      setNewIPSetEntry({ cidr: '', comment: '' })
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  const handleDeleteIPSetEntry = async (ipsetName: string, cidr: string) => {
    try {
      await firewallAPI.deleteIPSetEntry(selectedConnection, ipsetName, cidr)
      showToast(t('networkPage.entryDeleted'), 'success')
      reload()
    } catch (err: any) {
      showToast(err.message || t('networkPage.error'), 'error')
    }
  }

  return (
    <Box sx={{ p: 3 }}>
      <FirewallLoadAlert error={loadError} onRetry={reload} />

      {/* ── Aliases Section ── */}
      {(!view || view === 'aliases') && <Paper sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.15)}`, mb: 3 }}>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('firewall.aliases')}</Typography>
            <Chip label={t('firewall.aliasesCount', { count: aliases.length })} size="small" />
          </Box>
          <WriteTip>
            <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setAliasDialogOpen(true)} disabled={!writable}>
              {t('networkPage.new')}
            </Button>
          </WriteTip>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.background.default, 0.6) }}>
                <TableCell sx={{ fontWeight: 700 }}>{t('common.name')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('firewall.cidr')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('firewall.description')}</TableCell>
                <TableCell sx={{ width: 100 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aliases.map((alias) => (
                <TableRow key={alias.name} hover>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={alias.name}
                      data-testid={`alias-chip-${alias.name}`}
                      sx={objectChipSx(objectColour(alias.name, zones), theme)}
                    />
                  </TableCell>
                  <TableCell><span style={{ fontSize: 13 }}>{alias.cidr}</span></TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 13 }}>{alias.comment || '-'}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <WriteTip title={t('networkPage.edit')}>
                        <IconButton size="small" aria-label={t('networkPage.edit')} disabled={!writable} onClick={() => setEditingAlias({ ...alias })}>
                          <i className="ri-edit-line" style={{ fontSize: 16 }} />
                        </IconButton>
                      </WriteTip>
                      <WriteTip title={t('networkPage.delete')}>
                        <IconButton size="small" aria-label={t('networkPage.delete')} color="error" disabled={!writable} onClick={() => askDelete('alias', alias.name)}>
                          <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                        </IconButton>
                      </WriteTip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {aliases.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
                    {t('networkPage.noAliasConfiguredLabel')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>}

      {/* ── IP Sets Section ── */}
      {(!view || view === 'ipsets') && <Paper sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${alpha(theme.palette.divider, 0.15)}` }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('firewall.ipSets')}</Typography>
            <Chip label={t('networkPage.setsAndEntries', { sets: ipsets.length, entries: totalIPSetEntries })} size="small" />
          </Box>
          <WriteTip>
            <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={() => setIPSetDialogOpen(true)} disabled={!writable}>
              {t('networkPage.new')}
            </Button>
          </WriteTip>
        </Box>

        <Box sx={{ p: 2 }}>
          <Stack spacing={2}>
            {ipsets.map((ipset) => {
              const colour = objectColour(ipset.name, zones)
              return (
              <Paper key={ipset.name} sx={{ border: `1px solid ${alpha(theme.palette.divider, 0.15)}`, overflow: 'hidden' }}>
                <Box
                  data-testid={`ipset-header-${ipset.name}`}
                  sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', bgcolor: alpha(theme.palette.background.default, 0.5), borderLeft: `4px solid ${colour}` }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box component="span" data-testid={`ipset-dot-${ipset.name}`} sx={objectDotSx(colour)} />
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{ipset.name}</span>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 12, display: 'block' }}>{ipset.comment || t('networkPage.noDescription')}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip label={`${ipset.members?.length || 0} ${t('networkPage.entries')}`} size="small" />
                    <WriteTip>
                      <Button size="small" startIcon={<i className="ri-add-line" />} disabled={!writable} onClick={() => setIPSetEntryDialog({ open: true, ipsetName: ipset.name })}>
                        {t('networkPage.add')}
                      </Button>
                    </WriteTip>
                    <WriteTip title={t('networkPage.edit')}>
                      <IconButton size="small" aria-label={t('networkPage.edit')} disabled={!writable} onClick={() => setEditingIPSet({ name: ipset.name, comment: ipset.comment || '' })}>
                        <i className="ri-edit-line" />
                      </IconButton>
                    </WriteTip>
                    <WriteTip title={t('networkPage.delete')}>
                      <IconButton size="small" aria-label={t('networkPage.delete')} color="error" disabled={!writable} onClick={() => askDelete('ipset', ipset.name)}>
                        <i className="ri-delete-bin-line" />
                      </IconButton>
                    </WriteTip>
                  </Box>
                </Box>
                {ipset.members && ipset.members.length > 0 && (
                  <Box sx={{ p: 2, pt: 1 }}>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                      {ipset.members.map((member, idx) => (
                        <Chip
                          key={idx}
                          label={<span style={{ fontSize: 12 }}>{member.cidr}</span>}
                          size="small"
                          variant="outlined"
                          onDelete={writable ? () => handleDeleteIPSetEntry(ipset.name, member.cidr) : undefined}
                          data-testid={`ipset-entry-${ipset.name}`}
                          sx={objectChipSx(colour, theme)}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
              </Paper>
              )
            })}
            {ipsets.length === 0 && !loading && (
              <Paper sx={{ p: 4, textAlign: 'center', border: `1px dashed ${alpha(theme.palette.divider, 0.4)}` }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{t('networkPage.noIpSetConfigured')}</Typography>
              </Paper>
            )}
          </Stack>
        </Box>
      </Paper>}

      {/* ══ DIALOGS ══ */}

      {/* Delete an alias or an IP set */}
      <MicrosegConfirmDialog
        open={!!toDelete}
        title={toDelete ? t(toDelete.kind === 'alias' ? 'networkPage.deleteAliasConfirm' : 'networkPage.deleteIpSetConfirm', { name: toDelete.name }) : ''}
        body={toDelete ? t(toDelete.kind === 'alias' ? 'networkPage.deleteAliasWarning' : 'networkPage.deleteIpSetWarning', { name: toDelete.name }) : ''}
        confirmLabel={t('common.delete')}
        color='error'
        busy={deleting}
        error={deleteError}
        onConfirm={() => { void confirmDelete() }}
        onCancel={() => setToDelete(null)}
      />

      {/* Create Alias */}
      <Dialog open={aliasDialogOpen} onClose={() => setAliasDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createAliasTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newAlias.name} onChange={(e) => setNewAlias({ ...newAlias, name: e.target.value })} placeholder="net-mgmt" fullWidth size="small" />
            <TextField label={t('firewall.cidr')} value={newAlias.cidr} onChange={(e) => setNewAlias({ ...newAlias, cidr: e.target.value })} placeholder="10.99.99.0/24" fullWidth size="small" />
            <TextField label={t('common.description')} value={newAlias.comment} onChange={(e) => setNewAlias({ ...newAlias, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAliasDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateAlias} disabled={!newAlias.name || !newAlias.cidr}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Alias */}
      <Dialog open={!!editingAlias} onClose={() => setEditingAlias(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.editAlias')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={editingAlias?.name || ''} disabled fullWidth size="small" />
            <TextField label={t('firewall.cidr')} value={editingAlias?.cidr || ''} onChange={(e) => setEditingAlias(prev => prev ? { ...prev, cidr: e.target.value } : null)} fullWidth size="small" />
            <TextField label={t('common.description')} value={editingAlias?.comment || ''} onChange={(e) => setEditingAlias(prev => prev ? { ...prev, comment: e.target.value } : null)} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingAlias(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateAlias}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Create IP Set */}
      <Dialog open={ipsetDialogOpen} onClose={() => setIPSetDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.createIpSetTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={newIPSet.name} onChange={(e) => setNewIPSet({ ...newIPSet, name: e.target.value })} placeholder="trusted-hosts" fullWidth size="small" />
            <TextField label={t('common.description')} value={newIPSet.comment} onChange={(e) => setNewIPSet({ ...newIPSet, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIPSetDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateIPSet} disabled={!newIPSet.name}>{t('networkPage.createButton')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit IP Set */}
      <Dialog open={!!editingIPSet} onClose={() => setEditingIPSet(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.editIpSet')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('common.name')} value={editingIPSet?.name || ''} disabled fullWidth size="small" />
            <TextField label={t('common.description')} value={editingIPSet?.comment || ''} onChange={(e) => setEditingIPSet(prev => prev ? { ...prev, comment: e.target.value } : null)} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingIPSet(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleUpdateIPSet}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add IP Set Entry */}
      <Dialog open={ipsetEntryDialog.open} onClose={() => setIPSetEntryDialog({ open: false, ipsetName: '' })} maxWidth="sm" fullWidth>
        <DialogTitle>{t('networkPage.addToTitle', { name: ipsetEntryDialog.ipsetName })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField label={t('firewall.cidr')} value={newIPSetEntry.cidr} onChange={(e) => setNewIPSetEntry({ ...newIPSetEntry, cidr: e.target.value })} placeholder="10.0.0.0/24" fullWidth size="small" />
            <TextField label={t('networkPage.comment')} value={newIPSetEntry.comment} onChange={(e) => setNewIPSetEntry({ ...newIPSetEntry, comment: e.target.value })} fullWidth size="small" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIPSetEntryDialog({ open: false, ipsetName: '' })}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleAddIPSetEntry} disabled={!newIPSetEntry.cidr}>{t('networkPage.add')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
