'use client'

import { useState } from 'react'

import { Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, Divider, IconButton, List, ListItemButton, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'

import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/lib/i18n/date'
import { useCopyToClipboard } from '@/lib/clipboard'

const CRYPT_MODE_KEYS = { none: 'backups.cryptNone', encrypt: 'backups.cryptEncrypt', 'sign-only': 'backups.cryptSignOnly' }

function verificationState(backup) {
  if (backup.verified) return 'ok'
  return backup.verification?.state ? 'failed' : 'none'
}

const WEEK_MS = 7 * 86400000

const VERIFY_LOOK = {
  ok: { icon: 'ri-checkbox-circle-fill', color: 'success.main', label: 'backups.verified' },
  failed: { icon: 'ri-error-warning-fill', color: 'error.main', label: 'backups.verifyFailed' },
  none: { icon: 'ri-subtract-line', color: 'text.disabled', label: 'backups.notVerified' },
}

function Tile({ icon, label, children }) {
  return (
    <Box sx={{ flex: '1 1 140px', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, minWidth: 0 }}>
      <Typography variant='caption' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, opacity: 0.7 }}>
        <i className={icon} />{label}
      </Typography>
      <Box sx={{ mt: 0.5, fontWeight: 600 }}>{children}</Box>
    </Box>
  )
}

function Field({ label, children }) {
  return (
    <>
      <Typography variant='body2' sx={{ opacity: 0.7 }}>{label}</Typography>
      <Box sx={{ typography: 'body2', fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </>
  )
}

// Detail of one PBS snapshot. The left column lists every restore point of
// the same machine so the operator can move between dates without closing.
export default function BackupDetailDialog({
  open, onClose, backup, points, onSelectPoint, tab, onTabChange, showExplorer, explorer, vdc, typeChip,
  onRestore, onVerify, verifying, onDelete, deleting, deleteAwaitingConfirm, timeAgo, t, locale,
}) {
  const theme = useTheme()
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'))
  const { copy, copied } = useCopyToClipboard()
  const [now] = useState(() => Date.now())

  if (!backup) return null

  const date = backup.backupTime ? formatDateTime(backup.backupTime * 1000, locale) : backup.backupTimeFormatted
  const label = backup.vmName || `${backup.backupType}/${backup.backupId}`
  const snapshotPath = `${backup.backupType}/${backup.backupId}/${backup.backupTimeIso}`
  const verify = verificationState(backup)
  const lastRun = backup.verification?.['last-run']
  const files = backup.files || []
  // Past a week the relative label falls back to a bare date, which only repeats the absolute one.
  const recent = seconds => (now - seconds * 1000 < WEEK_MS ? timeAgo(seconds * 1000) : null)
  const recentDate = recent(backup.backupTime)
  let deleteIcon = <i className={deleteAwaitingConfirm ? 'ri-alert-line' : 'ri-delete-bin-line'} />
  if (deleting) deleteIcon = <CircularProgress size={14} />

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth='lg' fullScreen={fullScreen}
      PaperProps={{ sx: { height: fullScreen ? '100%' : '85vh' } }} aria-labelledby='backup-detail-title'>
      <Box sx={{ px: 3, pt: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography id='backup-detail-title' variant='h6' sx={{ fontWeight: 800 }}>{label}</Typography>
              {typeChip}
              {backup.protected && <Chip size='small' icon={<i className='ri-lock-line' />} label={t('backups.protected')} />}
              {vdc && <Chip size='small' variant='outlined' label={`${t('backups.vdc')} ${vdc.vdcName}`} />}
            </Box>
            <Typography variant='body2' sx={{ opacity: 0.7 }}>
              {backup.datastore}{backup.namespace ? ` / ${backup.namespace}` : ''} • {date}
            </Typography>
          </Box>
          <IconButton size='small' onClick={onClose} aria-label={t('common.close')}>
            <i className='ri-close-line' />
          </IconButton>
        </Box>
        <Tabs value={tab} onChange={(_, value) => onTabChange(value)} sx={{ mt: 1 }}>
          <Tab label={t('backups.informations')} icon={<i className='ri-information-line' />} iconPosition='start' />
          {showExplorer && <Tab label={t('backups.explorer')} icon={<i className='ri-folder-open-line' />} iconPosition='start' />}
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 0, display: 'flex', flexDirection: { xs: 'column', md: 'row' }, minHeight: 0 }}>
        <Box component='nav' aria-label={t('backups.restorePoints')}
          sx={{ width: { md: 300 }, flexShrink: 0, maxHeight: { xs: 220, md: 'none' }, overflow: 'auto', borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: 'divider' }}>
          <Typography variant='overline' sx={{ display: 'block', px: 2, pt: 1.5, opacity: 0.7 }}>
            {t('backups.restorePoints')} ({points.length})
          </Typography>
          <List dense disablePadding>
            {points.map((point, index) => {
              const look = VERIFY_LOOK[verificationState(point)]
              return (
                <ListItemButton key={point.id} selected={point.id === backup.id} onClick={() => onSelectPoint(point)}
                  aria-current={point.id === backup.id ? 'true' : undefined} sx={{ px: 2, alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography variant='body2' sx={{ fontWeight: 600 }}>{formatDateTime(point.backupTime * 1000, locale)}</Typography>
                      {index === 0 && <Chip size='small' color='primary' variant='outlined' label={t('backups.latestPoint')} sx={{ height: 18 }} />}
                    </Box>
                    <Typography variant='caption' sx={{ opacity: 0.7 }}>
                      {[recent(point.backupTime), point.sizeFormatted].filter(Boolean).join(' · ')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', pt: 0.25 }}>
                    {point.protected && <i className='ri-lock-line' aria-label={t('backups.protected')} />}
                    <Tooltip title={t(look.label)}>
                      <Box component='i' className={look.icon} aria-label={t(look.label)} sx={{ color: look.color }} />
                    </Tooltip>
                  </Box>
                </ListItemButton>
              )
            })}
          </List>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 3 }}>
          {tab === 0 ? (
            <Stack spacing={3}>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                <Tile icon='ri-hard-drive-2-line' label={t('common.size')}>{backup.sizeFormatted}</Tile>
                <Tile icon='ri-archive-line' label={t('backups.backupArchives')}>{backup.fileCount ?? files.length}</Tile>
                <Tile icon='ri-shield-check-line' label={t('backups.verified')}>
                  <Box component='span' sx={{ color: VERIFY_LOOK[verify].color }}>{t(VERIFY_LOOK[verify].label)}</Box>
                  {lastRun && <Typography variant='caption' sx={{ display: 'block', opacity: 0.7 }}>{formatDateTime(lastRun * 1000, locale)}</Typography>}
                </Tile>
                <Tile icon='ri-lock-line' label={t('backups.protected')}>
                  {backup.protected ? t('backups.protectedYes') : t('backups.protectedNo')}
                </Tile>
              </Box>

              <Box>
                <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('backups.identity')}</Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(120px, max-content) 1fr', columnGap: 3, rowGap: 1, mt: 1 }}>
                  <Field label='ID'>{backup.backupId}</Field>
                  <Field label={t('common.name')}>{backup.vmName || '-'}</Field>
                  <Field label='Datastore'>{backup.datastore}</Field>
                  <Field label={t('backups.namespace')}>{backup.namespace || t('backups.rootNamespace')}</Field>
                  {vdc && <Field label={t('backups.vdc')}>{vdc.tenantName ? `${vdc.vdcName} (${vdc.tenantName})` : vdc.vdcName}</Field>}
                  <Field label={t('backups.owner')}>{backup.owner || '-'}</Field>
                  <Field label={t('common.date')}>{date}{recentDate && <Box component='span' sx={{ fontWeight: 400, opacity: 0.7 }}> ({recentDate})</Box>}</Field>
                  <Field label={t('backups.snapshotPath')}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box component='code' sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{snapshotPath}</Box>
                      <Tooltip title={copied ? t('common.copied') : t('common.copy')}>
                        <IconButton size='small' aria-label={t('common.copy')} onClick={() => copy(snapshotPath)}>
                          <i className='ri-file-copy-line' style={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </Field>
                </Box>
              </Box>

              {files.length > 0 && (
                <Box>
                  <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('backups.backupArchives')}</Typography>
                  <Table size='small' sx={{ mt: 0.5 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('common.name')}</TableCell>
                        <TableCell>{t('backups.encryption')}</TableCell>
                        <TableCell align='right'>{t('common.size')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {files.map(file => (
                        <TableRow key={file.filename}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{file.filename}</TableCell>
                          <TableCell>{CRYPT_MODE_KEYS[file['crypt-mode']] ? t(CRYPT_MODE_KEYS[file['crypt-mode']]) : '-'}</TableCell>
                          <TableCell align='right'>{typeof file.size === 'number' ? formatBytes(file.size) : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {backup.comment && (
                <Box>
                  <Typography variant='overline' sx={{ opacity: 0.7 }}>{t('network.comment')}</Typography>
                  <Typography variant='body2' sx={{ mt: 0.5 }}>{backup.comment}</Typography>
                </Box>
              )}

              {deleteAwaitingConfirm && !deleting && (
                <Alert severity='warning' icon={<i className='ri-alert-line' style={{ fontSize: 18 }} />}>
                  {t('backups.deleteConfirm', { name: label, id: backup.backupId, date })}
                </Alert>
              )}
            </Stack>
          ) : explorer}
        </Box>
      </DialogContent>

      <Divider />
      <DialogActions sx={{ px: 3, py: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Button size='small' variant='outlined' color={deleteAwaitingConfirm ? 'warning' : 'error'} onClick={onDelete}
          disabled={deleting || backup.protected}
          startIcon={deleteIcon}>
          {deleteAwaitingConfirm ? t('backups.deleteConfirmButton') : t('common.delete')}
        </Button>
        {backup.protected && (
          <Typography variant='caption' sx={{ opacity: 0.7 }}>{t('backups.deleteProtectedHint')}</Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size='small' variant='outlined' onClick={onVerify} disabled={verifying}
          startIcon={verifying ? <CircularProgress size={14} /> : <i className='ri-shield-check-line' />}>
          {t('backups.verifyAction')}
        </Button>
        <Button size='small' variant='contained' onClick={onRestore} disabled={backup.backupType === 'host'}
          startIcon={<i className='ri-history-line' />}>
          {t('audit.actions.restore')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
