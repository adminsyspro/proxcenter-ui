'use client'

import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from '@mui/material'

const API = '/api/v1/admin/config-backup'
const MIN_PASSPHRASE_LENGTH = 12

const SECTION_ICONS: Record<string, string> = {
  connections: 'ri-link',
  tenants: 'ri-building-line',
  access: 'ri-shield-user-line',
  catalog: 'ri-stack-line',
  monitoring: 'ri-alarm-warning-line',
  automation: 'ri-loop-right-line',
  general: 'ri-settings-3-line'
}

const KNOWN_ERRORS = new Set([
  'passphrase-too-short',
  'missing-file',
  'file-too-large',
  'invalid-file',
  'unsupported-version',
  'wrong-passphrase',
  'newer-schema'
])

interface Inspection {
  createdAt: string
  appVersion: string
  compatibility: 'same' | 'older' | 'newer' | 'unknown'
  sections: { key: string; rows: number }[]
  unknownTables: string[]
}

interface RestoreResult {
  tables: number
  rows: number
  secrets: number
  skippedTables: string[]
  apiTokensInvalid?: boolean
  otherInstall?: boolean
}

async function errorCode(res: Response): Promise<string> {
  const json = await res.json().catch(() => null)
  const code = json?.code
  return typeof code === 'string' && KNOWN_ERRORS.has(code) ? code : 'generic'
}

/** Downloads the export answered for `passphrase`; resolves to an error code, or null. */
async function downloadExport(passphrase: string): Promise<string | null> {
  const res = await fetch(`${API}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase })
  })
  if (!res.ok) return errorCode(res)

  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'proxcenter-config.json'
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
  return null
}

function PassphraseField({ label, value, onChange, helperText, error }: {
  label: string
  value: string
  onChange: (v: string) => void
  helperText?: string
  error?: boolean
}) {
  const t = useTranslations()
  const [visible, setVisible] = useState(false)

  return (
    <TextField
      size='small'
      fullWidth
      label={label}
      type={visible ? 'text' : 'password'}
      autoComplete='new-password'
      value={value}
      onChange={e => onChange(e.target.value)}
      helperText={helperText}
      error={error}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position='end'>
              <IconButton
                size='small'
                aria-label={visible ? t('settings.configBackup.hidePassphrase') : t('settings.configBackup.showPassphrase')}
                onClick={() => setVisible(v => !v)}
              >
                <i className={visible ? 'ri-eye-off-line' : 'ri-eye-line'} style={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          )
        }
      }}
    />
  )
}

function SectionTitle({ icon, title }: { icon: string; title: string }) {
  return (
    <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
      <i className={icon} style={{ fontSize: 18 }} />
      {title}
    </Typography>
  )
}

function ExportCard() {
  const t = useTranslations()
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH
  const mismatch = confirm.length > 0 && confirm !== passphrase
  const ready = passphrase.length >= MIN_PASSPHRASE_LENGTH && confirm === passphrase

  const run = async () => {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const code = await downloadExport(passphrase)
      if (code) setError(code)
      else setDone(true)
    } catch {
      setError('generic')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <SectionTitle icon='ri-download-2-line' title={t('settings.configBackup.exportTitle')} />
        <Typography variant='body2' sx={{ opacity: 0.75, mb: 2 }}>
          {t('settings.configBackup.exportDescription')}
        </Typography>
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <PassphraseField
            label={t('settings.configBackup.passphrase')}
            value={passphrase}
            onChange={setPassphrase}
            error={tooShort}
            helperText={t('settings.configBackup.passphraseHelp', { min: MIN_PASSPHRASE_LENGTH })}
          />
          <PassphraseField
            label={t('settings.configBackup.passphraseConfirm')}
            value={confirm}
            onChange={setConfirm}
            error={mismatch}
            helperText={mismatch ? t('settings.configBackup.passphraseMismatch') : undefined}
          />
          <Box>
            <Button
              variant='contained'
              disabled={!ready || busy}
              onClick={run}
              startIcon={busy ? <CircularProgress size={16} color='inherit' /> : <i className='ri-download-2-line' />}
            >
              {t('settings.configBackup.exportButton')}
            </Button>
          </Box>
        </Stack>
        {done && <Alert severity='success' sx={{ mt: 2 }}>{t('settings.configBackup.exportDone')}</Alert>}
        {error && <Alert severity='error' sx={{ mt: 2 }}>{t(`settings.configBackup.errors.${error}`)}</Alert>}
      </CardContent>
    </Card>
  )
}

function InspectionSummary({ inspection }: { inspection: Inspection }) {
  const t = useTranslations()
  const created = new Date(inspection.createdAt).toLocaleString()

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant='body2' sx={{ mb: 1 }}>
        {t('settings.configBackup.fileInfo', { date: created, version: inspection.appVersion })}
      </Typography>
      {inspection.compatibility === 'newer' && (
        <Alert severity='error' sx={{ mb: 1 }}>{t('settings.configBackup.errors.newer-schema')}</Alert>
      )}
      {inspection.compatibility === 'older' && (
        <Alert severity='warning' sx={{ mb: 1 }}>{t('settings.configBackup.olderSchema')}</Alert>
      )}
      {inspection.unknownTables.length > 0 && (
        <Alert severity='warning' sx={{ mb: 1 }}>
          {t('settings.configBackup.unknownTables', { tables: inspection.unknownTables.join(', ') })}
        </Alert>
      )}
      <Box component='ul' sx={{ listStyle: 'none', p: 0, m: 0, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        {inspection.sections.map((section, i) => (
          <Box
            component='li'
            key={section.key}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderTop: i ? 1 : 0, borderColor: 'divider' }}
          >
            <i className={SECTION_ICONS[section.key] ?? 'ri-file-list-line'} style={{ fontSize: 16, opacity: 0.8 }} />
            <Typography variant='body2' sx={{ flex: 1 }}>{t(`settings.configBackup.sections.${section.key}`)}</Typography>
            <Typography variant='body2' sx={{ opacity: 0.7 }}>
              {t('settings.configBackup.rowCount', { count: section.rows })}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function ImportCard() {
  const t = useTranslations()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [backupFirst, setBackupFirst] = useState(true)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)

  const upload = () => {
    const form = new FormData()
    form.set('file', file as File)
    form.set('passphrase', passphrase)
    return form
  }

  const reset = () => {
    setInspection(null)
    setError(null)
    setResult(null)
  }

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null)
    reset()
  }

  const inspect = async () => {
    setBusy(true)
    reset()
    try {
      const res = await fetch(`${API}/inspect`, { method: 'POST', body: upload() })
      if (res.ok) setInspection((await res.json()).data)
      else setError(await errorCode(res))
    } catch {
      setError('generic')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    setConfirmOpen(false)
    setBusy(true)
    setError(null)
    try {
      // The current configuration goes out first, under the same passphrase:
      // a restore that turns out to be the wrong file can be undone.
      if (backupFirst) {
        const code = await downloadExport(passphrase)
        if (code) {
          setError(code === 'passphrase-too-short' ? 'backupFirstPassphrase' : code)
          return
        }
      }
      const res = await fetch(`${API}/import`, { method: 'POST', body: upload() })
      if (res.ok) setResult((await res.json()).data)
      else setError(await errorCode(res))
    } catch {
      setError('generic')
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <Card variant='outlined'>
        <CardContent>
          <SectionTitle icon='ri-upload-2-line' title={t('settings.configBackup.importTitle')} />
          <Alert severity='success' sx={{ mb: 2 }}>
            {t('settings.configBackup.importDone', { rows: result.rows, tables: result.tables })}
          </Alert>
          <Alert severity='warning' sx={{ mb: 2 }}>{t('settings.configBackup.afterImport')}</Alert>
          {result.otherInstall && (
            <Alert
              severity='warning'
              sx={{ mb: 2 }}
              action={
                <Button color='inherit' size='small' href='/settings?tab=license' sx={{ whiteSpace: 'nowrap' }}>
                  {t('settings.configBackup.openLicenseTab')}
                </Button>
              }
            >
              {t('settings.configBackup.otherInstall')}
            </Alert>
          )}
          {result.apiTokensInvalid && (
            <Alert severity='warning' sx={{ mb: 2 }}>{t('settings.configBackup.apiTokensInvalid')}</Alert>
          )}
          <Button variant='contained' onClick={() => window.location.reload()} startIcon={<i className='ri-refresh-line' />}>
            {t('settings.configBackup.reloadPage')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <SectionTitle icon='ri-upload-2-line' title={t('settings.configBackup.importTitle')} />
        <Typography variant='body2' sx={{ opacity: 0.75, mb: 2 }}>
          {t('settings.configBackup.importDescription')}
        </Typography>
        <Stack spacing={2} sx={{ maxWidth: 480 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
            <input ref={fileInput} type='file' accept='.json,application/json' hidden onChange={onFile} data-testid='config-backup-file' />
            <Button variant='outlined' onClick={() => fileInput.current?.click()} startIcon={<i className='ri-file-upload-line' />}>
              {t('settings.configBackup.chooseFile')}
            </Button>
            <Typography variant='body2' noWrap sx={{ opacity: file ? 1 : 0.6 }}>
              {file?.name ?? t('settings.configBackup.noFile')}
            </Typography>
          </Box>
          <PassphraseField label={t('settings.configBackup.passphrase')} value={passphrase} onChange={v => { setPassphrase(v); reset() }} />
          <Box>
            <Button
              variant='outlined'
              disabled={!file || !passphrase || busy}
              onClick={inspect}
              startIcon={busy && !inspection ? <CircularProgress size={16} color='inherit' /> : <i className='ri-search-eye-line' />}
            >
              {t('settings.configBackup.inspectButton')}
            </Button>
          </Box>
        </Stack>

        {inspection && <InspectionSummary inspection={inspection} />}

        {inspection && inspection.compatibility !== 'newer' && (
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={<Checkbox checked={backupFirst} onChange={e => setBackupFirst(e.target.checked)} />}
              label={t('settings.configBackup.backupFirst')}
            />
            <Box sx={{ mt: 1 }}>
              <Button
                variant='contained'
                color='error'
                disabled={busy}
                onClick={() => setConfirmOpen(true)}
                startIcon={busy ? <CircularProgress size={16} color='inherit' /> : <i className='ri-history-line' />}
              >
                {t('settings.configBackup.restoreButton')}
              </Button>
            </Box>
          </Box>
        )}

        {error && <Alert severity='error' sx={{ mt: 2 }}>{t(`settings.configBackup.errors.${error}`)}</Alert>}
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.configBackup.confirmTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>{t('settings.configBackup.confirmBody')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='error' onClick={restore}>
            {t('settings.configBackup.confirmButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

function NoteSection({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant='subtitle2' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <i className={icon} style={{ fontSize: 16 }} />
        {title}
      </Typography>
      {children}
    </Box>
  )
}

/** What to know before exporting or restoring, kept beside the two cards rather than inside them. */
function NotesPanel() {
  const t = useTranslations()
  const items = ['notesOtherInstallLicense', 'notesOtherInstallMapping', 'notesOtherInstallKey'] as const

  return (
    <Card variant='outlined' sx={{ bgcolor: 'action.hover', height: '100%' }}>
      <CardContent>
        <Stack spacing={2.5}>
          <NoteSection icon='ri-key-2-line' title={t('settings.configBackup.notesPassphraseTitle')}>
            <Typography variant='body2' sx={{ opacity: 0.85 }}>{t('settings.configBackup.exportWarning')}</Typography>
          </NoteSection>
          <NoteSection icon='ri-server-line' title={t('settings.configBackup.notesOtherInstallTitle')}>
            <Box component='ul' sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {items.map(key => (
                <Typography key={key} component='li' variant='body2' sx={{ opacity: 0.85 }}>
                  {t(`settings.configBackup.${key}`)}
                </Typography>
              ))}
            </Box>
          </NoteSection>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function ConfigBackupTab() {
  return (
    <Box sx={{ display: 'grid', gap: 3, alignItems: 'stretch', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 360px' } }}>
      <Stack spacing={3} sx={{ minWidth: 0 }}>
        <ExportCard />
        <ImportCard />
      </Stack>
      <NotesPanel />
    </Box>
  )
}
