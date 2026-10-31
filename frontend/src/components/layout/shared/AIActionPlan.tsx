'use client'

import Link from 'next/link'

import { Box, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

import { isRelativeAppPath, type ActionCardsPayload } from '@/lib/ai/actions/cards'
import type { ActionCard, ActionPlan } from '@/lib/ai/actions/types'

import AIActionCard from './AIActionCard'
import type { ActionRuns } from './useActionExecution'

type Translate = (key: string, values?: Record<string, string>) => string

type Shared = {
  runs: ActionRuns
  busy: boolean
  onExecute: (card: ActionCard, confirmed: boolean) => void
  t: Translate
}

const StepNumber = ({ n, done }: { n: number; done: boolean }) => (
  <Box
    aria-hidden
    sx={theme => ({
      width: 20,
      height: 20,
      mt: 1.5,
      flexShrink: 0,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '0.6875rem',
      fontWeight: 600,
      border: 1,
      borderColor: done ? 'success.main' : 'divider',
      color: done ? 'success.main' : 'text.secondary',
      bgcolor: done ? alpha(theme.palette.success.main, 0.1) : 'transparent'
    })}
  >
    {done ? <i className='ri-check-line' style={{ fontSize: 12 }} /> : n}
  </Box>
)

/** A step the user does in the app, between two cards: its text, and a link when it is safe. */
const ManualStep = ({ manual, t }: { manual: { text: string; href: string }; t: Translate }) => (
  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, minWidth: 0 }}>
    <Box
      aria-hidden
      sx={{
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.secondary',
        bgcolor: 'action.hover'
      }}
    >
      <i className='ri-user-line' style={{ fontSize: 17 }} />
    </Box>
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant='body2' sx={{ fontWeight: 600, lineHeight: 1.45 }}>
        {t('ai.actions.manualStep')}
      </Typography>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', lineHeight: 1.6 }}>
        {manual.text}
      </Typography>
      {/* The decoder already empties a link that leaves the app; checked again
          here because this is where it becomes clickable. */}
      {manual.href && isRelativeAppPath(manual.href) && (
        <Box
          component={Link}
          href={manual.href}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            mt: 1,
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'primary.main',
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' }
          }}
        >
          {t('ai.actions.openPage')}
          <i className='ri-arrow-right-line' style={{ fontSize: 13 }} aria-hidden />
        </Box>
      )}
    </Box>
  </Box>
)

/**
 * A remediation plan (roadmap#188): its steps in order, run one at a time. A
 * card step unlocks when the card step it waits for (`after`) succeeded in
 * this widget; the server refuses it otherwise anyway.
 */
export default function AIActionPlan({ plan, runs, busy, onExecute, t }: Shared & { plan: ActionPlan }) {
  const cardOfStep = new Map<number, ActionCard>()

  for (const s of plan.steps) if (s.card) cardOfStep.set(s.step, s.card)

  const succeeded = (card: ActionCard | undefined) => Boolean(card && runs[card.actionId]?.phase === 'done')
  const cards = [...cardOfStep.values()]
  const doneCount = cards.filter(c => succeeded(c)).length

  return (
    <Box role='group' aria-label={plan.title} sx={{ mt: 3, borderRadius: 1.5, border: 1, borderColor: 'divider', overflow: 'hidden' }}>
      <Box
        sx={theme => ({
          display: 'flex',
          alignItems: 'center',
          gap: 2.5,
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.text.primary, 0.02)
        })}
      >
        <Box component='i' className='ri-list-check-3' aria-hidden sx={{ fontSize: 16, color: 'primary.main' }} />
        <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
          {plan.title}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>
          {t('ai.actions.planProgress', { done: String(doneCount), total: String(cards.length) })}
        </Typography>
      </Box>
      <Box component='ol' sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {plan.steps.map((s, i) => {
          const waitsFor = s.card?.after !== undefined && !succeeded(cardOfStep.get(s.card.after)) ? s.card.after : undefined

          return (
            <Box
              key={s.step}
              component='li'
              sx={{ display: 'flex', alignItems: 'flex-start', gap: 3, px: 3, py: 2.5, borderTop: i ? 1 : 0, borderColor: 'divider' }}
            >
              <StepNumber n={s.step} done={succeeded(s.card)} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {s.card ? (
                  <AIActionCard
                    embedded
                    card={s.card}
                    run={runs[s.card.actionId]}
                    busy={busy}
                    waitsFor={waitsFor}
                    onExecute={onExecute}
                    t={t}
                  />
                ) : (
                  s.manual && <ManualStep manual={s.manual} t={t} />
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** Everything one answer proposes: its loose cards, then its plans. */
export function AIActions({ payload, ...shared }: Shared & { payload: ActionCardsPayload }) {
  return (
    <>
      {payload.cards.map(card => (
        <AIActionCard key={card.actionId} card={card} run={shared.runs[card.actionId]} busy={shared.busy} onExecute={shared.onExecute} t={shared.t} />
      ))}
      {payload.plans.map(plan => (
        <AIActionPlan key={plan.planId} plan={plan} {...shared} />
      ))}
    </>
  )
}
