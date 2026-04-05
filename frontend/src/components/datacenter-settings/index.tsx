'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Button, CircularProgress, Alert, Stack } from '@mui/material'
import { useToast } from '@/contexts/ToastContext'

import TagStyleSection from './TagStyleSection'
import GeneralSection from './GeneralSection'
import CrsSection from './CrsSection'
import SecuritySection from './SecuritySection'
import BandwidthSection from './BandwidthSection'
import AdvancedSection from './AdvancedSection'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface TagColorEntry {
  tag: string
  bg: string
  fg: string
}

interface DatacenterOptions {
  [key: string]: any
}

/* ------------------------------------------------------------------ */
/* tag-style parsing                                                   */
/* ------------------------------------------------------------------ */

function parseTagStyle(tagStyle: any): {
  colorMap: TagColorEntry[]
  shape: string
  ordering: string
  caseSensitive: boolean
} {
  const result = { colorMap: [] as TagColorEntry[], shape: 'full', ordering: 'config', caseSensitive: false }
  if (!tagStyle) return result

  if (typeof tagStyle === 'object') {
    if (tagStyle['color-map']) {
      String(tagStyle['color-map']).split(';').forEach(entry => {
        if (!entry) return
        const segments = entry.split(':')
        if (segments.length < 2) return
        const tag = segments[0], bgHex = segments[1], fgHex = segments[2]
        if (!tag || !bgHex || bgHex.length < 6) return
        result.colorMap.push({ tag, bg: `#${bgHex.slice(0, 6)}`, fg: fgHex && fgHex.length >= 6 ? `#${fgHex.slice(0, 6)}` : '#ffffff' })
      })
    }
    if (tagStyle.shape) result.shape = tagStyle.shape
    if (tagStyle.ordering) result.ordering = tagStyle.ordering
    if (tagStyle['case-sensitive'] === 1 || tagStyle['case-sensitive'] === '1') result.caseSensitive = true
    return result
  }

  const parts = String(tagStyle).split(',')
  for (const part of parts) {
    const [key, ...rest] = part.split('=')
    const val = rest.join('=')
    if (key === 'color-map' && val) {
      val.split(';').forEach(entry => {
        if (!entry) return
        const segments = entry.split(':')
        if (segments.length < 2) return
        const tag = segments[0], bgHex = segments[1], fgHex = segments[2]
        if (!tag || !bgHex || bgHex.length < 6) return
        result.colorMap.push({ tag, bg: `#${bgHex.slice(0, 6)}`, fg: fgHex && fgHex.length >= 6 ? `#${fgHex.slice(0, 6)}` : '#ffffff' })
      })
    } else if (key === 'shape') result.shape = val || 'full'
    else if (key === 'ordering') result.ordering = val || 'config'
    else if (key === 'case-sensitive') result.caseSensitive = val === '1'
  }
  return result
}

function buildTagStyleString(colorMap: TagColorEntry[], shape: string, ordering: string, caseSensitive: boolean): string {
  const parts: string[] = []
  if (colorMap.length > 0) {
    const mapStr = colorMap
      .filter(e => e.tag && e.bg)
      .map(e => {
        const bg = e.bg.replace('#', ''), fg = e.fg.replace('#', '')
        return fg && fg !== 'ffffff' ? `${e.tag}:${bg}:${fg}` : `${e.tag}:${bg}`
      }).join(';')
    if (mapStr) parts.push(`color-map=${mapStr}`)
  }
  if (shape && shape !== 'full') parts.push(`shape=${shape}`)
  if (ordering && ordering !== 'config') parts.push(`ordering=${ordering}`)
  if (caseSensitive) parts.push('case-sensitive=1')
  return parts.join(',')
}

/* ------------------------------------------------------------------ */
/* Generic option parsers (PVE returns string or object)               */
/* ------------------------------------------------------------------ */

function parseKV(val: any, keys: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  keys.forEach(k => result[k] = '')
  if (!val) return result
  if (typeof val === 'object') {
    keys.forEach(k => { if (val[k] !== undefined) result[k] = String(val[k]) })
    // webauthn uses 'rp' for name
    if (val.rp !== undefined && keys.includes('rp')) result.rp = String(val.rp)
    return result
  }
  String(val).split(',').forEach(part => {
    const [k, ...rest] = part.split('=')
    const v = rest.join('=')
    if (keys.includes(k)) result[k] = v || ''
  })
  return result
}

function buildKV(obj: Record<string, string>): string {
  return Object.entries(obj).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(',')
}

/* ------------------------------------------------------------------ */
/* Bandwidth parsing                                                   */
/* ------------------------------------------------------------------ */

function parseBwLimit(val: any): Record<string, string> {
  return parseKV(val, ['default', 'restore', 'migration', 'clone', 'move'])
}

function buildBwLimit(bw: Record<string, string>): string {
  return buildKV(bw)
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
  connectionId: string
}

export default function DatacenterSettingsTab({ connectionId }: Props) {
  const t = useTranslations('inventory')
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rawOptions, setRawOptions] = useState<DatacenterOptions>({})
  const [dirty, setDirty] = useState(false)

  // Tag style
  const [tagColors, setTagColors] = useState<TagColorEntry[]>([])
  const [tagShape, setTagShape] = useState('full')
  const [tagOrdering, setTagOrdering] = useState('config')
  const [tagCaseSensitive, setTagCaseSensitive] = useState(false)

  // General
  const [consoleType, setConsoleType] = useState('')
  const [keyboard, setKeyboard] = useState('')
  const [language, setLanguage] = useState('')
  const [httpProxy, setHttpProxy] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [macPrefix, setMacPrefix] = useState('')
  const [maxWorkers, setMaxWorkers] = useState('')
  const [migrationType, setMigrationType] = useState('')
  const [migrationNetwork, setMigrationNetwork] = useState('')
  const [haShutdownPolicy, setHaShutdownPolicy] = useState('conditional')

  // CRS
  const [crsHaScheduling, setCrsHaScheduling] = useState('basic')
  const [crsRebalance, setCrsRebalance] = useState(false)

  // Security
  const [u2fAppId, setU2fAppId] = useState('')
  const [u2fOrigin, setU2fOrigin] = useState('')
  const [webauthnName, setWebauthnName] = useState('')
  const [webauthnOrigin, setWebauthnOrigin] = useState('')
  const [webauthnId, setWebauthnId] = useState('')

  // Bandwidth
  const [bwDefault, setBwDefault] = useState('')
  const [bwRestore, setBwRestore] = useState('')
  const [bwMigration, setBwMigration] = useState('')
  const [bwClone, setBwClone] = useState('')
  const [bwMove, setBwMove] = useState('')

  // Advanced
  const [nextIdLower, setNextIdLower] = useState('')
  const [nextIdUpper, setNextIdUpper] = useState('')
  const [userTagAccess, setUserTagAccess] = useState('free')
  const [registeredTags, setRegisteredTags] = useState('')
  const [consentText, setConsentText] = useState('')

  /* ---- State setter maps for child onChange callbacks ---- */

  const generalSetters: Record<string, (v: string) => void> = {
    console: setConsoleType, keyboard: setKeyboard, language: setLanguage,
    httpProxy: setHttpProxy, emailFrom: setEmailFrom, macPrefix: setMacPrefix,
    maxWorkers: setMaxWorkers, migrationType: setMigrationType,
    migrationNetwork: setMigrationNetwork, haShutdownPolicy: setHaShutdownPolicy,
  }

  const securitySetters: Record<string, (v: string) => void> = {
    u2fAppId: setU2fAppId, u2fOrigin: setU2fOrigin,
    webauthnName: setWebauthnName, webauthnOrigin: setWebauthnOrigin, webauthnId: setWebauthnId,
  }

  const bwSetters: Record<string, (v: string) => void> = {
    bwDefault: setBwDefault, bwRestore: setBwRestore, bwMigration: setBwMigration,
    bwClone: setBwClone, bwMove: setBwMove,
  }

  const advancedSetters: Record<string, (v: string) => void> = {
    nextIdLower: setNextIdLower, nextIdUpper: setNextIdUpper,
    userTagAccess: setUserTagAccess, registeredTags: setRegisteredTags, consentText: setConsentText,
  }

  const makeOnChange = (setters: Record<string, (v: string) => void>) =>
    (field: string, value: string) => { setters[field]?.(value); setDirty(true) }

  const handleCrsChange = (field: string, value: string | boolean) => {
    if (field === 'haScheduling') setCrsHaScheduling(value as string)
    else if (field === 'rebalanceOnStart') setCrsRebalance(value as boolean)
    setDirty(true)
  }

  /* ---- Fetch ---- */

  const fetchOptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/options`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data: DatacenterOptions = json?.data || {}
      setRawOptions(data)

      // Tag style
      const ts = parseTagStyle(data['tag-style'])
      setTagColors(ts.colorMap)
      setTagShape(ts.shape)
      setTagOrdering(ts.ordering)
      setTagCaseSensitive(ts.caseSensitive)

      // General
      setConsoleType(data.console || '')
      setKeyboard(data.keyboard || '')
      setLanguage(data.language || '')
      setHttpProxy(data.http_proxy || '')
      setEmailFrom(data.email_from || '')
      setMacPrefix(data.mac_prefix || '')
      setMaxWorkers(data.max_workers != null ? String(data.max_workers) : '')

      // Migration
      const mig = parseKV(data.migration, ['type', 'network'])
      setMigrationType(mig.type)
      setMigrationNetwork(mig.network)

      // HA
      const ha = parseKV(data.ha, ['shutdown_policy'])
      setHaShutdownPolicy(ha.shutdown_policy || 'conditional')

      // CRS
      const crs = parseKV(data.crs, ['ha', 'ha-rebalance-on-start'])
      setCrsHaScheduling(crs.ha || 'basic')
      setCrsRebalance(crs['ha-rebalance-on-start'] === '1')

      // U2F
      const u2f = parseKV(data.u2f, ['appid', 'origin'])
      setU2fAppId(u2f.appid)
      setU2fOrigin(u2f.origin)

      // WebAuthn
      const wa = parseKV(data.webauthn, ['rp', 'origin', 'id'])
      setWebauthnName(wa.rp)
      setWebauthnOrigin(wa.origin)
      setWebauthnId(wa.id)

      // Bandwidth
      const bw = parseBwLimit(data.bwlimit)
      setBwDefault(bw.default)
      setBwRestore(bw.restore)
      setBwMigration(bw.migration)
      setBwClone(bw.clone)
      setBwMove(bw.move)

      // Advanced
      const nid = parseKV(data['next-id'], ['lower', 'upper'])
      setNextIdLower(nid.lower)
      setNextIdUpper(nid.upper)

      const uta = parseKV(data['user-tag-access'], ['user-allow'])
      setUserTagAccess(uta['user-allow'] || 'free')
      setRegisteredTags(data['registered-tags'] || '')
      setConsentText(data['consent-text'] || '')

      setDirty(false)
    } catch (e: any) {
      setError(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  useEffect(() => { fetchOptions() }, [fetchOptions])

  /* ---- Save ---- */

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      const deleteKeys: string[] = []

      // Tag style
      const tagStyleStr = buildTagStyleString(tagColors, tagShape, tagOrdering, tagCaseSensitive)
      if (tagStyleStr) body['tag-style'] = tagStyleStr
      else if (rawOptions['tag-style']) deleteKeys.push('tag-style')

      // Simple string fields
      const simpleFields: Array<{ key: string; value: string }> = [
        { key: 'console', value: consoleType },
        { key: 'keyboard', value: keyboard },
        { key: 'language', value: language },
        { key: 'http_proxy', value: httpProxy },
        { key: 'email_from', value: emailFrom },
        { key: 'mac_prefix', value: macPrefix },
        { key: 'max_workers', value: maxWorkers },
        { key: 'registered-tags', value: registeredTags },
        { key: 'consent-text', value: consentText },
      ]
      for (const { key, value } of simpleFields) {
        if (value) body[key] = value
        else if (rawOptions[key]) deleteKeys.push(key)
      }

      // Migration
      const migStr = buildKV({ type: migrationType, network: migrationNetwork })
      if (migStr) body.migration = migStr
      else if (rawOptions.migration) deleteKeys.push('migration')

      // HA
      const haStr = buildKV({ shutdown_policy: haShutdownPolicy })
      if (haStr) body.ha = haStr
      else if (rawOptions.ha) deleteKeys.push('ha')

      // CRS
      const crsparts: string[] = []
      if (crsHaScheduling && crsHaScheduling !== 'basic') crsparts.push(`ha=${crsHaScheduling}`)
      if (crsRebalance) crsparts.push('ha-rebalance-on-start=1')
      const crsStr = crsparts.join(',')
      if (crsStr) body.crs = crsStr
      else if (rawOptions.crs) deleteKeys.push('crs')

      // U2F
      const u2fStr = buildKV({ appid: u2fAppId, origin: u2fOrigin })
      if (u2fStr) body.u2f = u2fStr
      else if (rawOptions.u2f) deleteKeys.push('u2f')

      // WebAuthn
      const waStr = buildKV({ rp: webauthnName, origin: webauthnOrigin, id: webauthnId })
      if (waStr) body.webauthn = waStr
      else if (rawOptions.webauthn) deleteKeys.push('webauthn')

      // Bandwidth
      const bwStr = buildBwLimit({ default: bwDefault, restore: bwRestore, migration: bwMigration, clone: bwClone, move: bwMove })
      if (bwStr) body.bwlimit = bwStr
      else if (rawOptions.bwlimit) deleteKeys.push('bwlimit')

      // Next ID
      const nidStr = buildKV({ lower: nextIdLower, upper: nextIdUpper })
      if (nidStr) body['next-id'] = nidStr
      else if (rawOptions['next-id']) deleteKeys.push('next-id')

      // User tag access
      const utaStr = userTagAccess && userTagAccess !== 'free' ? `user-allow=${userTagAccess}` : ''
      if (utaStr) body['user-tag-access'] = utaStr
      else if (rawOptions['user-tag-access']) deleteKeys.push('user-tag-access')

      if (deleteKeys.length > 0) body.delete = deleteKeys.join(',')

      if (Object.keys(body).length === 0) { setDirty(false); return }

      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/options`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      toast.success(t('dcSettingsSaveSuccess'))
      await fetchOptions()
    } catch (e: any) {
      toast.error(t('dcSettingsSaveError') + ': ' + (e?.message || String(e)))
    } finally {
      setSaving(false)
    }
  }

  /* ---- Render ---- */

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 6 }}><CircularProgress size={32} /></Box>
  }

  if (error) {
    return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>
  }

  return (
    <Box sx={{ p: 2, overflow: 'auto' }}>
      <Stack spacing={3}>
        <TagStyleSection
          tagColors={tagColors} tagShape={tagShape} tagOrdering={tagOrdering} tagCaseSensitive={tagCaseSensitive}
          onTagColorsChange={v => { setTagColors(v); setDirty(true) }}
          onTagShapeChange={v => { setTagShape(v); setDirty(true) }}
          onTagOrderingChange={v => { setTagOrdering(v); setDirty(true) }}
          onTagCaseSensitiveChange={v => { setTagCaseSensitive(v); setDirty(true) }}
          t={t}
        />

        <GeneralSection
          consoleType={consoleType} keyboard={keyboard} language={language}
          httpProxy={httpProxy} emailFrom={emailFrom} macPrefix={macPrefix}
          maxWorkers={maxWorkers} migrationType={migrationType}
          migrationNetwork={migrationNetwork} haShutdownPolicy={haShutdownPolicy}
          onChange={makeOnChange(generalSetters)} t={t}
        />

        <CrsSection
          haScheduling={crsHaScheduling} rebalanceOnStart={crsRebalance}
          onChange={handleCrsChange} t={t}
        />

        <SecuritySection
          u2fAppId={u2fAppId} u2fOrigin={u2fOrigin}
          webauthnName={webauthnName} webauthnOrigin={webauthnOrigin} webauthnId={webauthnId}
          onChange={makeOnChange(securitySetters)} t={t}
        />

        <BandwidthSection
          bwDefault={bwDefault} bwRestore={bwRestore} bwMigration={bwMigration}
          bwClone={bwClone} bwMove={bwMove}
          onChange={makeOnChange(bwSetters)} t={t}
        />

        <AdvancedSection
          nextIdLower={nextIdLower} nextIdUpper={nextIdUpper}
          userTagAccess={userTagAccess} registeredTags={registeredTags} consentText={consentText}
          onChange={makeOnChange(advancedSetters)} t={t}
        />

        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button variant="outlined" onClick={fetchOptions} disabled={saving || !dirty} startIcon={<i className="ri-refresh-line" />}>
            {t('dcSettingsReset')}
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !dirty} startIcon={saving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}>
            {t('dcSettingsSave')}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
