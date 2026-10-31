'use client'

// Settings > AI actions: the administrator's switch for the assistant's
// approved actions (roadmap#188). Everything is off by default. The assistant
// only PROPOSES; each action runs on the user's click, with the user's rights.

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Skeleton,
  Stack,
  Switch,
  Typography,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import {
  ACTION_KINDS,
  ACTION_TIER,
  DEFAULT_MAX_PER_CONVERSATION,
  MAX_MAX_PER_CONVERSATION,
  MIN_MAX_PER_CONVERSATION,
  normalizeAiActionsSettings,
  type ActionKind,
  type ActionTier,
  type AiActionsSettings,
} from '@/lib/ai/actions/types'

const API = '/api/v1/settings/ai-actions'

const GROUPS: ActionTier[] = ['safe', 'disruptive']

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const text = await r.text()
  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)

  return json as T
}

const fetcher = (url: string) => fetchJson<{ data: AiActionsSettings }>(url)

export default function AIActionsTab() {
  const t = useTranslations('settings.aiActions')
  const toast = useToast()
  const { data, error, isLoading, mutate } = useSWR(API, fetcher, { revalidateOnFocus: false })

  // Local edits on top of the saved settings; null = nothing edited.
  const [edits, setEdits] = useState<AiActionsSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const saved = data?.data ? normalizeAiActionsSettings(data.data) : null
  const form = edits ?? saved ?? normalizeAiActionsSettings(null)
  const dirty = !!saved && !!edits && JSON.stringify(saved) !== JSON.stringify(edits)

  const setKinds = (kinds: ActionKind[], value: boolean) => {
    const actions = { ...form.actions }

    for (const k of kinds) actions[k] = value
    setEdits({ ...form, actions })
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      const json = await fetchJson<{ data: AiActionsSettings }>(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizeAiActionsSettings(form)),
      })

      await mutate(json, { revalidate: false })
      setEdits(null)
      toast.success(t('saved'))
    } catch (e: any) {
      toast.error(t('saveFailed', { error: e?.message || String(e) }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant='h5' fontWeight={600}>{t('title')}</Typography>
        <Typography variant='body2' color='text.secondary'>{t('description')}</Typography>
      </Box>

      <Alert severity='info'>
        {t('info')}
        <Box component='span' sx={{ display: 'block', mt: 1 }}>{t('vdcInherit')}</Box>
      </Alert>

      {error && <Alert severity='error'>{t('loadError', { error: error.message })}</Alert>}

      {isLoading ? (
        <Stack spacing={1.5}>
          <Skeleton variant='rounded' height={40} />
          <Skeleton variant='rounded' height={40} />
          <Skeleton variant='rounded' height={40} />
        </Stack>
      ) : (
        <>
          <Card variant='outlined'>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.enabled}
                    onChange={e => setEdits({ ...form, enabled: e.target.checked })}
                  />
                }
                label={t('enabled')}
              />
              <Typography variant='body2' color='text.secondary'>{t('enabledHelper')}</Typography>
            </CardContent>
          </Card>

          {GROUPS.map(tier => {
            const kinds = ACTION_KINDS.filter(k => ACTION_TIER[k] === tier)
            const count = kinds.filter(k => form.actions[k]).length
            const all = count === kinds.length
            const some = count > 0 && !all

            return (
              <Card key={tier} variant='outlined'>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
                    <Box
                      component='i'
                      className={tier === 'safe' ? 'ri-shield-check-line' : 'ri-alert-line'}
                      sx={{ fontSize: 20, color: tier === 'safe' ? 'primary.main' : 'warning.main' }}
                    />
                    <Typography variant='subtitle1' fontWeight={600}>
                      {t(tier === 'safe' ? 'groupSafe' : 'groupDisruptive')}
                    </Typography>
                  </Box>

                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={all}
                        indeterminate={some}
                        disabled={!form.enabled}
                        onChange={() => setKinds(kinds, !all)}
                      />
                    }
                    label={t('selectAll')}
                  />

                  <Stack sx={{ pl: 6 }}>
                    {kinds.map(kind => (
                      <Box key={kind}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={form.actions[kind]}
                              disabled={!form.enabled}
                              onChange={e => setKinds([kind], e.target.checked)}
                            />
                          }
                          label={t(`kinds.${kind}.label`)}
                        />
                        <Typography variant='body2' color='text.secondary' sx={{ display: 'block', pl: 8, mt: -1, mb: 1 }}>
                          {t(`kinds.${kind}.help`)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            )
          })}

          <Card variant='outlined'>
            <CardContent>
              <Box sx={{ maxWidth: 320 }}>
                <NumericTextField
                  size='small'
                  type='number'
                  fullWidth
                  label={t('maxPerConversation')}
                  helperText={t('maxPerConversationHelper')}
                  value={form.maxPerConversation}
                  onChange={v => setEdits({ ...form, maxPerConversation: v })}
                  fallback={DEFAULT_MAX_PER_CONVERSATION}
                  min={MIN_MAX_PER_CONVERSATION}
                  max={MAX_MAX_PER_CONVERSATION}
                />
              </Box>
            </CardContent>
          </Card>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant='contained'
              onClick={handleSave}
              disabled={!dirty || saving}
              startIcon={saving ? <CircularProgress size={16} color='inherit' /> : <i className='ri-save-line' />}
            >
              {t('save')}
            </Button>
          </Box>
        </>
      )}
    </Stack>
  )
}
