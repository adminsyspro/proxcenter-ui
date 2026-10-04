'use client'

import { Box, Button, Card, Chip, IconButton, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material'

import { leaseDaysLeft } from '@/components/settings/leaseDays'
import { optionDisplayName } from '@/lib/license/features'

import { formatDate } from './format'

// The name given on proxcenter.io first, then what the key says.
function licenseName(row, held, t) {
  if (held?.label) return held.label
  if (row.role === 'option') return row.capabilities?.length ? row.capabilities.map(optionDisplayName).join(', ') : t('settings.licenseTab.licenses.roleOption')
  if (row.edition === 'enterprise' || row.edition === 'enterprise_plus') return t('settings.licenseTab.summary.enterprise')
  if (row.edition) return row.edition

  return row.label || t('settings.licenseTab.licenses.unknown')
}

function roleLabel(row, t) {
  return t(`settings.licenseTab.licenses.role${row.role === 'primary' ? 'Primary' : row.role === 'option' ? 'Option' : 'Import'}`)
}

// A held license moved to another instance reads as such; otherwise the
// state the orchestrator gives, in words.
function StateCell({ row, held, t }) {
  if (held?.lost) {
    const days = leaseDaysLeft(held.grace_until)

    return (
      <Typography variant='body2' color={days === null ? 'error.main' : 'warning.main'}>
        {days === null ? t('settings.licenseTab.licenses.movedEnded') : t('settings.licenseTab.licenses.moved', { days })}
      </Typography>
    )
  }

  const known = ['active', 'expired', 'invalid']
  const state = known.includes(row.state) ? row.state : 'unknown'

  return (
    <Typography variant='body2' color={state === 'active' ? 'text.secondary' : 'error.main'}>
      {t(`settings.licenseTab.licenses.state.${state}`)}
    </Typography>
  )
}

// effectiveLicenseId: the import standing in for the primary, if any; its
// row says so next to its name.
export default function LicensesSection({ rows, held, t, locale, connName, canImport, perTenant, effectiveLicenseId = null, onImport, onEditMapping, onRemove, onDeactivate }) {
  const msp = rows.some(r => r.role === 'import')

  return (
    <Card variant='outlined' sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.75 }}>
        <Typography variant='subtitle1' fontWeight={600}>{t('settings.licenseTab.licenses.title')}</Typography>
        <Typography variant='body2' color='text.secondary' sx={{ flex: 1 }}>
          {t('settings.licenseTab.summary.licenseCount', { count: rows.length })}
        </Typography>
        {canImport && (
          <Button size='small' variant='outlined' onClick={onImport} startIcon={<i className='ri-add-line' />}>
            {t('settings.licenseTab.licenses.import')}
          </Button>
        )}
      </Box>

      <Box sx={{ overflowX: 'auto' }}>
        <Table size='small' sx={{ '& td, & th': { borderColor: 'divider' }, '& tr:last-child td': { borderBottom: 0 } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('settings.licenseTab.licenses.colLicense')}</TableCell>
              <TableCell>{t('settings.licenseTab.licenses.colNodes')}</TableCell>
              {msp && <TableCell>{t('settings.licenseTab.licenses.colClusters')}</TableCell>}
              <TableCell>{t('settings.licenseTab.licenses.colValidUntil')}</TableCell>
              <TableCell>{t('settings.licenseTab.licenses.colState')}</TableCell>
              <TableCell align='right' />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map(row => {
              const h = held.get(row.licenseId)
              const sub = [roleLabel(row, t), row.role === 'primary' ? null : row.licensedTo].filter(Boolean).join(' · ')

              return (
                <TableRow key={row.rowId} hover>
                  <TableCell sx={{ py: 1.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'text.secondary' }}>
                        <i className={row.role === 'option' ? 'ri-puzzle-line' : 'ri-key-2-line'} style={{ fontSize: 16 }} aria-hidden='true' />
                      </Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                          <Typography variant='body2' fontWeight={600}>{licenseName(row, h, t)}</Typography>
                          {effectiveLicenseId && row.licenseId === effectiveLicenseId && (
                            <Chip size='small' variant='outlined' color='success' label={t('settings.licenseTab.licenses.providesEdition')} />
                          )}
                        </Box>
                        <Typography variant='caption' color='text.secondary' title={row.licenseId}>{sub}</Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {row.role === 'option' || row.heldOnly
                      ? '—'
                      : row.unlimited ? t('settings.licenseTab.summary.unlimited') : `${row.usedNodes} / ${row.maxNodes}`}
                  </TableCell>
                  {msp && (
                    <TableCell>
                      {row.role === 'option' || row.heldOnly ? '—' : (row.connectionIds || []).length === 0
                        ? <Typography variant='body2' color='text.secondary'>{t('settings.licenseTab.licenses.pool')}</Typography>
                        : row.connectionIds.map(id => connName[id] || id).join(', ')}
                    </TableCell>
                  )}
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{formatDate(row.expiresAt, locale)}</TableCell>
                  <TableCell><StateCell row={row} held={h} t={t} /></TableCell>
                  <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                    {!row.heldOnly && row.role === 'import' && (
                      <Tooltip title={t('settings.licenseEditMapping')}>
                        <IconButton size='small' onClick={() => onEditMapping(row)} aria-label={t('settings.licenseEditMapping')}><i className='ri-links-line' /></IconButton>
                      </Tooltip>
                    )}
                    {!row.heldOnly && (
                      <Tooltip title={row.role === 'primary' ? t('settings.deactivateLicense') : t('settings.licenseRemoveImport')}>
                        <IconButton size='small' color='error'
                          aria-label={row.role === 'primary' ? t('settings.deactivateLicense') : t('settings.licenseRemoveImport')}
                          onClick={() => (row.role === 'primary' ? onDeactivate() : onRemove(row))}>
                          <i className='ri-delete-bin-line' />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>

      {perTenant.length > 0 && (
        <Box sx={{ px: 2.5, py: 1.75, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant='body2' fontWeight={600} sx={{ mb: 1 }}>{t('settings.licensePerTenantTitle')}</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {perTenant.map(tn => (
              <Chip key={tn.tenantId} size='small' variant='outlined'
                label={`${tn.tenantName} · ${tn.unlimited ? t('settings.licenseTab.summary.unlimited') : `${tn.usedNodes} / ${tn.maxNodes}`}`} />
            ))}
          </Box>
        </Box>
      )}
    </Card>
  )
}
