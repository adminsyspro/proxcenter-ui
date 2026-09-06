'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import ColorPicker from '@/components/common/ColorPicker'
import { useBranding } from '@/contexts/BrandingContext'
import { useToast } from '@/contexts/ToastContext'
import {
  BASE_FONT_SIZES,
  checkCustomCss,
  DEFAULT_REPORT_TEMPLATE,
  FONT_FAMILIES,
  ORIENTATIONS,
  PAGE_SIZES,
  TEXT_LIMITS,
  type ReportTemplateSettings,
} from '@/lib/reports/templateSettings'
import { isHexColor } from '@/lib/theme/hexColor'

interface Language {
  code: string
  name: string
}

interface ReportCustomizationProps {
  languages: Language[]
}

// The orchestrator's built-in brand colour, shown in the swatch when neither
// the white label nor the template overrides it.
const FACTORY_PRIMARY = '#e57000'

// A WeasyPrint render takes a second or two; wait for the administrator to
// pause before asking for a new one.
const PREVIEW_DEBOUNCE_MS = 1200

const SETTINGS_URL = '/api/v1/settings/reports-template'
const PREVIEW_URL = '/api/v1/orchestrator/reports/preview'

export default function ReportCustomization({ languages }: ReportCustomizationProps) {
  const t = useTranslations()
  const locale = useLocale()
  const { showToast } = useToast()
  const { branding } = useBranding()

  const [draft, setDraft] = useState<ReportTemplateSettings>(DEFAULT_REPORT_TEMPLATE)
  const [saved, setSaved] = useState<ReportTemplateSettings>(DEFAULT_REPORT_TEMPLATE)
  const [loading, setLoading] = useState(true)
  // null = loaded fine; a string (possibly empty) = the load failed, with the
  // server's message when it gave one. Kept language-neutral so the loading
  // effect does not depend on the translator: a locale switch would otherwise
  // refetch and wipe an unsaved draft.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [previewLanguage, setPreviewLanguage] = useState(() =>
    languages.some(l => l.code === locale) ? locale : 'en'
  )
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const previewAbort = useRef<AbortController | null>(null)
  const previewUrlRef = useRef('')

  const cssError = useMemo(() => checkCustomCss(draft.customCss), [draft.customCss])
  const colorInvalid = draft.primaryColor !== '' && !isHexColor(draft.primaryColor)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved])
  const canSave = dirty && !cssError && !colorInvalid && !saving

  const brandingPrimary = branding?.enabled && branding.primaryColor ? branding.primaryColor : FACTORY_PRIMARY

  const update = <K extends keyof ReportTemplateSettings>(key: K, value: ReportTemplateSettings[K]) =>
    setDraft(prev => ({ ...prev, [key]: value }))

  // Load the stored template once.
  useEffect(() => {
    let cancelled = false

    fetch(SETTINGS_URL)
      .then(async res => {
        const data = await res.json()

        if (!res.ok || data.error) throw new Error(data.error || '')
        if (cancelled) return
        const value = { ...DEFAULT_REPORT_TEMPLATE, ...data } as ReportTemplateSettings

        setDraft(value)
        setSaved(value)
      })
      .catch(e => {
        if (!cancelled) setLoadError(e?.message ?? '')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // The ref keeps the exact URL createObjectURL returned, which is what
  // revokeObjectURL expects; the fragment is only added for display.
  const replacePreviewUrl = useCallback((url: string) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    // PDF open parameters: Chromium hides its thumbnail pane and fits the
    // page width, Firefox ignores what it does not know.
    setPreviewUrl(url + '#navpanes=0&view=FitH')
  }, [])

  const renderPreview = useCallback(
    async (template: ReportTemplateSettings, language: string) => {
      previewAbort.current?.abort()
      const controller = new AbortController()

      previewAbort.current = controller
      setPreviewing(true)
      setPreviewError('')

      try {
        const res = await fetch(PREVIEW_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language, template }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({}))

          throw new Error(data.error || t('reports.customization.previewUnavailable'))
        }

        const blob = await res.blob()

        if (controller.signal.aborted) return
        replacePreviewUrl(URL.createObjectURL(blob))
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setPreviewError(e?.message || t('reports.customization.previewUnavailable'))
      } finally {
        if (previewAbort.current === controller) setPreviewing(false)
      }
    },
    [replacePreviewUrl, t]
  )

  // Re-render the sample after the administrator pauses. A refused stylesheet
  // is reported under the field instead of being sent.
  useEffect(() => {
    if (loading || loadError !== null || cssError || colorInvalid) return
    const timer = setTimeout(() => renderPreview(draft, previewLanguage), PREVIEW_DEBOUNCE_MS)

    // Also drop a render already in flight: it belongs to the previous draft
    // and would otherwise land later as if it showed the current one, even
    // when the current one cannot be previewed at all.
    return () => {
      clearTimeout(timer)
      previewAbort.current?.abort()
    }
  }, [draft, previewLanguage, loading, loadError, cssError, colorInvalid, renderPreview])

  // Release the last blob URL and any in-flight render on unmount.
  useEffect(
    () => () => {
      previewAbort.current?.abort()
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    },
    []
  )

  const handleSave = async () => {
    const submitted = draft

    setSaving(true)

    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submitted),
      })
      const data = await res.json()

      if (!res.ok || data.error) throw new Error(data.error || t('common.error'))
      const value = { ...DEFAULT_REPORT_TEMPLATE, ...data } as ReportTemplateSettings & { success?: boolean }

      delete value.success
      setSaved(value)
      // Fields stay editable while the request runs: only adopt the server's
      // normalized copy if nothing was typed in the meantime.
      setDraft(prev => (prev === submitted ? value : prev))
      showToast(t('reports.customization.saved'), 'success')
    } catch (e: any) {
      showToast(e?.message || t('common.error'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleOpenPreview = () => {
    if (previewUrl) window.open(previewUrl, '_blank', 'noopener')
  }

  if (loading) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (loadError !== null) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{loadError || t('common.error')}</Alert>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: { xs: 'column', lg: 'row' },
        overflow: { xs: 'auto', lg: 'hidden' },
      }}
    >
      {/* ===== Form ===== */}
      <Box
        sx={{
          width: { xs: '100%', lg: 560 },
          flexShrink: 0,
          overflow: { lg: 'auto' },
          p: 3,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          borderRight: { lg: 1 },
          borderColor: { lg: 'divider' },
        }}
      >
        <Box>
          <Typography variant="h6">{t('reports.customization.title')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('reports.customization.description')}{' '}
            <Link href="/settings?tab=white-label" underline="hover">
              {t('reports.customization.whiteLabelLink')}
            </Link>
          </Typography>
        </Box>

        {/* Page */}
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.page')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel id="report-tpl-pageSize-label">{t('reports.customization.pageSize')}</InputLabel>
                <Select
                  labelId="report-tpl-pageSize-label"
                  value={draft.pageSize}
                  label={t('reports.customization.pageSize')}
                  onChange={e => update('pageSize', e.target.value as ReportTemplateSettings['pageSize'])}
                >
                  {PAGE_SIZES.map(size => (
                    <MenuItem key={size} value={size}>
                      {size}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="report-tpl-orientation-label">{t('reports.customization.orientation')}</InputLabel>
                <Select
                  labelId="report-tpl-orientation-label"
                  value={draft.orientation}
                  label={t('reports.customization.orientation')}
                  onChange={e => update('orientation', e.target.value as ReportTemplateSettings['orientation'])}
                >
                  {ORIENTATIONS.map(o => (
                    <MenuItem key={o} value={o}>
                      {t(`reports.customization.${o}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="report-tpl-fontFamily-label">{t('reports.customization.fontFamily')}</InputLabel>
                <Select
                  labelId="report-tpl-fontFamily-label"
                  value={draft.fontFamily}
                  label={t('reports.customization.fontFamily')}
                  onChange={e => update('fontFamily', e.target.value as ReportTemplateSettings['fontFamily'])}
                >
                  {FONT_FAMILIES.map(f => (
                    <MenuItem key={f} value={f}>
                      {t(`reports.customization.font_${f}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="report-tpl-baseFontSize-label">{t('reports.customization.baseFontSize')}</InputLabel>
                <Select
                  labelId="report-tpl-baseFontSize-label"
                  value={draft.baseFontSize}
                  label={t('reports.customization.baseFontSize')}
                  onChange={e => update('baseFontSize', Number(e.target.value) as ReportTemplateSettings['baseFontSize'])}
                >
                  {BASE_FONT_SIZES.map(size => (
                    <MenuItem key={size} value={size}>
                      {size} pt
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </CardContent>
        </Card>

        {/* Colours */}
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.colors')}
            </Typography>
            <ColorPicker
              label={t('reports.customization.primaryColor')}
              value={draft.primaryColor}
              onChange={(v: string) => update('primaryColor', v)}
              fallback={brandingPrimary}
              placeholder={brandingPrimary}
              onReset={() => update('primaryColor', '')}
              error={colorInvalid}
              fullWidth
            />
            <Typography variant="caption" sx={{ color: colorInvalid ? 'error.main' : 'text.secondary' }}>
              {colorInvalid ? t('reports.customization.primaryColorInvalid') : t('reports.customization.primaryColorHelp')}
            </Typography>
          </CardContent>
        </Card>

        {/* Cover */}
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.cover')}
            </Typography>
            <FormControlLabel
              control={<Switch checked={draft.showLogo} onChange={e => update('showLogo', e.target.checked)} />}
              label={t('reports.customization.showLogo')}
            />
            <TextField
              size="small"
              label={t('reports.customization.coverSubtitle')}
              value={draft.coverSubtitle}
              onChange={e => update('coverSubtitle', e.target.value)}
              placeholder={t('reports.customization.coverSubtitlePlaceholder')}
              inputProps={{ maxLength: TEXT_LIMITS.coverSubtitle }}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('reports.customization.coverNote')}
              value={draft.coverNote}
              onChange={e => update('coverNote', e.target.value)}
              helperText={t('reports.customization.coverNoteHelp')}
              inputProps={{ maxLength: TEXT_LIMITS.coverNote }}
              multiline
              minRows={3}
              fullWidth
            />
          </CardContent>
        </Card>

        {/* Header and footer */}
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.headerFooter')}
            </Typography>
            <TextField
              size="small"
              label={t('reports.customization.headerText')}
              value={draft.headerText}
              onChange={e => update('headerText', e.target.value)}
              helperText={t('reports.customization.headerTextHelp', { appToken: '{app}', reportToken: '{report}' })}
              inputProps={{ maxLength: TEXT_LIMITS.headerText }}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              size="small"
              label={t('reports.customization.footerText')}
              value={draft.footerText}
              onChange={e => update('footerText', e.target.value)}
              helperText={t('reports.customization.footerTextHelp')}
              inputProps={{ maxLength: TEXT_LIMITS.footerText }}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <FormControlLabel
              control={
                <Switch checked={draft.showPageNumbers} onChange={e => update('showPageNumbers', e.target.checked)} />
              }
              label={t('reports.customization.showPageNumbers')}
            />
          </CardContent>
        </Card>

        {/* Custom CSS */}
        <Card variant="outlined">
          <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.customCss')}
            </Typography>
            <TextField
              value={draft.customCss}
              onChange={e => update('customCss', e.target.value)}
              placeholder={'.stat-card { border-radius: 0; }\n.section-header h2 { color: #003366; }'}
              error={Boolean(cssError)}
              helperText={
                cssError ? t(`reports.customization.cssErrors.${cssError}`) : t('reports.customization.customCssHelp')
              }
              multiline
              minRows={8}
              maxRows={20}
              fullWidth
              InputProps={{
                sx: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '0.8125rem' },
              }}
              inputProps={{ 'aria-label': t('reports.customization.customCss') }}
              spellCheck={false}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!canSave}
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <i className="ri-save-line" />}
          >
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          <Button
            variant="outlined"
            color="secondary"
            onClick={() => setDraft(DEFAULT_REPORT_TEMPLATE)}
            startIcon={<i className="ri-restart-line" />}
          >
            {t('reports.customization.resetDefaults')}
          </Button>
          {dirty && (
            <Typography variant="caption" sx={{ color: 'warning.main', ml: 'auto' }}>
              {t('reports.customization.unsavedChanges')}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ===== Preview ===== */}
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          minHeight: { xs: 640, lg: 0 },
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'action.hover',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('reports.customization.preview')}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="div">
              {t('reports.customization.previewHint')}
            </Typography>
          </Box>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="report-tpl-previewLanguage-label">{t('reports.customization.previewLanguage')}</InputLabel>
            <Select
                  labelId="report-tpl-previewLanguage-label"
              value={previewLanguage}
              label={t('reports.customization.previewLanguage')}
              onChange={e => setPreviewLanguage(e.target.value)}
            >
              {languages.map(lang => (
                <MenuItem key={lang.code} value={lang.code}>
                  {lang.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Tooltip title={t('reports.customization.refreshPreview')}>
            <span>
              <IconButton
                onClick={() => renderPreview(draft, previewLanguage)}
                disabled={previewing || Boolean(cssError) || colorInvalid}
              >
                {previewing ? <CircularProgress size={20} /> : <i className="ri-refresh-line" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('reports.customization.openPreview')}>
            <span>
              <IconButton onClick={handleOpenPreview} disabled={!previewUrl}>
                <i className="ri-external-link-line" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {previewError && (
            <Alert severity="warning" sx={{ m: 2 }}>
              {previewError}
            </Alert>
          )}
          {!previewError && !previewUrl && (
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
                gap: 1.5,
              }}
            >
              <CircularProgress size={20} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('reports.customization.previewRendering')}
              </Typography>
            </Box>
          )}
          {previewUrl && !previewError && (
            <iframe
              title={t('reports.customization.preview')}
              src={previewUrl}
              style={{ border: 0, width: '100%', height: '100%', display: 'block' }}
            />
          )}
        </Box>
      </Box>
    </Box>
  )
}
