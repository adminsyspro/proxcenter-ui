'use client'

import { useId } from 'react'

import {
  Alert, Box, Card, CardContent, Chip, Divider, FormControl, FormControlLabel, MenuItem, Select, Stack, Switch,
  TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import type { TlsSettings } from '@/lib/tls/schema'

const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

// One shape for every row of this panel: icon, label, explanation, control,
// on a single line. The label never wraps, the explanation is what yields
// space first when the window narrows (it drops to its own line rather than
// pushing the control out of sight, which is how the previous layout put
// three switches off screen), and the control always sits at the end of the
// row where the eye expects it.
const ROW_SX = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: 2,
  rowGap: 0.5,
  minHeight: 32,
} as const

function SettingRow({
  icon, label, help, control, controlId,
}: {
  icon: string
  label: string
  help: string
  control: React.ReactNode
  controlId?: string
}) {
  return (
    <Box sx={ROW_SX}>
      <i className={icon} aria-hidden='true' style={{ fontSize: 18, opacity: 0.7, flex: '0 0 auto' }} />
      <Typography
        component={controlId ? 'label' : 'span'} htmlFor={controlId}
        variant='body2' fontWeight={500} color='text.primary'
        sx={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
      >
        {label}
      </Typography>
      <Typography
        variant='body2' color='text.secondary' title={help}
        sx={{ flex: '1 1 260px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {help}
      </Typography>
      <Box sx={{ flex: '0 0 auto', ml: 'auto' }}>{control}</Box>
    </Box>
  )
}

export default function ListenerCard({
  settings, listener, tlsPort, urlCoherence, onChange,
}: {
  settings: TlsSettings
  listener: { listening: boolean; port: number | null }
  tlsPort: number
  urlCoherence: { ok: boolean; issues: string[] }
  onChange: (next: TlsSettings) => void
}) {
  const t = useTranslations()
  const enableId = useId()
  const redirectId = useId()
  const hstsId = useId()

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} sx={{ mb: 2 }}>{t('settings.tls.listenerTitle')}</Typography>
        <Stack spacing={2}>
          {/* A warning, never a block. Enabling the listener while the public
              URLs still say http:// is the RIGHT order of operations: switching
              those URLs first hands out `secure` cookies a plain-HTTP browser
              will not send, and locks the operator out of the appliance before
              HTTPS exists to let them back in. The message says what to do and
              in which order; the switch stays usable. */}
          {!urlCoherence.ok && (
            <Alert severity='warning'>
              {t('settings.tls.urlIncoherent')}
              <Typography variant='caption' sx={{ display: 'block', mt: 1 }}>{urlCoherence.issues.join(' \u00b7 ')}</Typography>
            </Alert>
          )}

          <Stack divider={<Divider flexItem />} spacing={0.75}>
            <SettingRow
              icon='ri-server-line' controlId={enableId}
              label={t('settings.tls.enable')} help={t('settings.tls.enableHelp')}
              control={
                <Switch size='small'
                  id={enableId} checked={settings.enabled}
                  onChange={e => onChange({ ...settings, enabled: e.target.checked })}
                />
              }
            />

            <SettingRow
              icon='ri-plug-line'
              label={t('settings.tls.port')} help={t('settings.tls.portReadOnly')}
              control={<Chip size='small' variant='outlined' label={tlsPort} sx={{ fontFamily: 'monospace' }} />}
            />

            <SettingRow
              icon='ri-corner-up-right-line' controlId={redirectId}
              label={t('settings.tls.redirectHttp')} help={t('settings.tls.redirectHttpHelp')}
              control={
                <Switch size='small'
                  id={redirectId} checked={settings.redirectHttp}
                  onChange={e => onChange({ ...settings, redirectHttp: e.target.checked })}
                />
              }
            />

            <SettingRow
              icon='ri-shield-keyhole-line' controlId={hstsId}
              label={t('settings.tls.hsts')} help={t('settings.tls.hstsHelp')}
              control={
                <Switch size='small'
                  id={hstsId} checked={settings.hsts.enabled}
                  onChange={e => onChange({ ...settings, hsts: { ...settings.hsts, enabled: e.target.checked } })}
                />
              }
            />

            <SettingRow
              icon='ri-lock-2-line'
              label={t('settings.tls.minVersion')} help={t('settings.tls.minVersionHelp')}
              control={
                <FormControl size='small' sx={{ width: 140 }}>
                  <Select
                    size='small' sx={{ ...SMALL_SELECT_SX, '& .MuiSelect-select': { py: 0.5 } }} value={settings.minVersion}
                    inputProps={{ 'aria-label': t('settings.tls.minVersion') }}
                    onChange={e => onChange({ ...settings, minVersion: e.target.value as TlsSettings['minVersion'] })}
                  >
                    <MenuItem value='TLSv1.2'>TLS 1.2</MenuItem>
                    <MenuItem value='TLSv1.3'>TLS 1.3</MenuItem>
                  </Select>
                </FormControl>
              }
            />
          </Stack>

          {/* HSTS has three settings of its own; they only exist once it is on,
              and they are indented so they read as belonging to that row. */}
          {settings.hsts.enabled && (
            <Stack spacing={2} sx={{ pl: 3, borderLeft: 2, borderColor: 'divider' }}>
              <TextField
                size='small' sx={{ width: '100%', maxWidth: 280 }}
                label={t('settings.tls.hstsMaxAge')} type='number' value={settings.hsts.maxAge}
                onChange={e => onChange({ ...settings, hsts: { ...settings.hsts, maxAge: Number.parseInt(e.target.value, 10) || 15552000 } })}
              />
              <FormControlLabel sx={{ alignSelf: 'flex-start' }}
                control={
                  <Switch
                    checked={settings.hsts.includeSubDomains}
                    onChange={e => onChange({ ...settings, hsts: { ...settings.hsts, includeSubDomains: e.target.checked } })}
                  />
                }
                label={t('settings.tls.hstsSubdomains')}
              />
              <FormControlLabel sx={{ alignSelf: 'flex-start' }}
                control={
                  <Switch
                    checked={settings.hsts.preload}
                    onChange={e => onChange({ ...settings, hsts: { ...settings.hsts, preload: e.target.checked } })}
                  />
                }
                label={t('settings.tls.hstsPreload')}
              />
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
