'use client'

import { useCallback, useRef, useState } from 'react'
import { Box, IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegSuggestion, SuggestionAction, SuggestionKind } from '@/lib/microseg/types'

import { isVersionConflict, writeErrorMessage } from './dialogParts'

// Same semantics as the edges of the zone map (EDGE_COLORS): a flow an enforced zone blocked is blue, a flow
// that would be blocked once its zone enforces (unprotected today) is red.
const KIND_GLYPH: Record<SuggestionKind, { icon: string; dot: string }> = {
  blocked: { icon: 'ri-forbid-line', dot: 'info.main' },
  would_block: { icon: 'ri-eye-line', dot: 'error.main' },
}

/** The icon of an observed flow, with its kind as a coloured dot and in the tooltip. */
export function ObservedKindGlyph({ kind }: { kind: SuggestionKind }) {
  const t = useTranslations('microsegPilot.observation')
  const glyph = KIND_GLYPH[kind] ?? KIND_GLYPH.would_block

  return (
    <Tooltip title={t(`kind.${kind}`)}>
      <Box component='span' data-kind={kind} sx={{ position: 'relative', display: 'inline-flex', width: 16, height: 16, flexShrink: 0 }}>
        <i className={glyph.icon} style={{ fontSize: 16 }} />
        <Box
          component='span'
          data-dot={glyph.dot}
          sx={{
            position: 'absolute', bottom: -2, right: -3, width: 8, height: 8, borderRadius: '50%', border: '1.5px solid', borderColor: 'background.paper',
            bgcolor: glyph.dot,
          }}
        />
      </Box>
    </Tooltip>
  )
}

type ResolveActionsProps = {
  suggestion: MicrosegSuggestion
  busy: boolean
  onResolve: (action: SuggestionAction) => void
  /** Name of the accept button (its tooltip too when the flow has a source zone); "Accept" by default. */
  acceptLabel?: string
}

/** The three ways out of an observed flow: accept as a flow of the zones, accept as a CIDR, dismiss. */
export function ResolveActions({ suggestion: s, busy, onResolve, acceptLabel }: ResolveActionsProps) {
  const t = useTranslations('microsegPilot.observation')
  const accept = acceptLabel ?? t('accept')

  return (
    <>
      <Tooltip title={s.src_zone_id ? accept : t('acceptNoZone')}>
        <span>
          <IconButton size='small' aria-label={accept} disabled={busy || !s.src_zone_id} onClick={() => onResolve('accept')}><i className='ri-check-line' /></IconButton>
        </span>
      </Tooltip>
      <Tooltip title={s.src_ip ? t('acceptCidr') : t('acceptCidrNoIp')}>
        <span>
          <IconButton size='small' aria-label={t('acceptCidr')} disabled={busy || !s.src_ip} onClick={() => onResolve('accept_cidr')}><i className='ri-checkbox-multiple-line' /></IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('dismiss')}>
        <span>
          <IconButton size='small' aria-label={t('dismiss')} disabled={busy} onClick={() => onResolve('dismiss')}><i className='ri-close-line' /></IconButton>
        </span>
      </Tooltip>
    </>
  )
}

/** What a resolve call came to: whether the server took it, and the suggestions as re-read after it (when they were). */
export type ResolveOutcome<R> = { resolved: boolean; fresh: R | undefined }

/**
 * Resolves suggestions against the draft version. On success, and on a 409 (the draft moved), the draft and the
 * list are re-read; any other failure leaves them as they are. The failure is kept as a message for an Alert.
 * Returns null when nothing was sent (a call already running, or no id).
 */
export function useResolveSuggestions<R>(
  connectionId: string,
  version: number,
  reloadPolicy: () => Promise<unknown>,
  reloadSuggestions: () => Promise<R>,
) {
  const tAll = useTranslations()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Read synchronously, so a second click in the same render does not send a second request.
  const running = useRef(false)

  const clearFailure = useCallback(() => setFailure(null), [])

  const resolve = useCallback(async (ids: string[], action: SuggestionAction): Promise<ResolveOutcome<R> | null> => {
    if (running.current || ids.length === 0) return null
    running.current = true
    setBusy(true)
    setFailure(null)
    let resolved = false
    try {
      await microsegApi(connectionId).resolveSuggestions({ version, ids, action })
      resolved = true
    } catch (e) {
      setFailure(writeErrorMessage(tAll as (key: string) => string, e))
      if (!isVersionConflict(e)) {
        running.current = false
        setBusy(false)
        return { resolved, fresh: undefined }
      }
    }
    const [, fresh] = await Promise.all([reloadPolicy().catch(() => undefined), reloadSuggestions().catch(() => undefined)])
    running.current = false
    setBusy(false)
    return { resolved, fresh }
  }, [connectionId, version, reloadPolicy, reloadSuggestions, tAll])

  return { busy, failure, clearFailure, resolve }
}
