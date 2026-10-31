'use client'

import { useState } from 'react'

import { Box, ButtonBase, Typography } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { GuestGlyph, NodeGlyph } from '@/components/automation/drs/glyphs'
import type { TargetChoice } from '@/lib/tools/types'

type Translate = (key: string, values?: Record<string, string>) => string

const ChoiceGlyph = ({ choice, dark, dotBorder }: { choice: TargetChoice; dark: boolean; dotBorder: string }) => {
  if (choice.kind === 'guest') return <GuestGlyph type={choice.guestKind} dotBorder={dotBorder} />
  if (choice.kind === 'host') return <NodeGlyph dark={dark} dotBorder={dotBorder} />

  return <Box component='i' className='ri-server-line' aria-hidden sx={{ fontSize: 14, width: 16, textAlign: 'center', opacity: 0.8, flexShrink: 0 }} />
}

/**
 * The targets an ambiguous reference matched (roadmap#188), one row each:
 * clicking a row sends its `reply` as the user's next message. Computed by the
 * resolvers, never by the model. Active only under the last answer while no
 * other one is running; once a row is picked, the list stays as a record of
 * the choice and takes no other click.
 */
export default function AIChoiceList({
  choices,
  disabled,
  onSelect,
  t
}: {
  choices: TargetChoice[]
  disabled: boolean
  onSelect: (reply: string) => void
  t: Translate
}) {
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper
  const [picked, setPicked] = useState<string | null>(null)
  const inactive = disabled || picked !== null

  return (
    <Box role='group' aria-label={t('ai.whichOne')} sx={{ mt: 3 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1.5, fontWeight: 600 }}>
        {t('ai.whichOne')}
      </Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
        {choices.map((choice, index) => (
          <ButtonBase
            key={choice.reply}
            disabled={inactive}
            onClick={() => {
              setPicked(choice.reply)
              onSelect(choice.reply)
            }}
            sx={{
              width: '100%',
              display: 'flex',
              justifyContent: 'flex-start',
              alignItems: 'center',
              gap: 2,
              px: 2.5,
              py: 1.5,
              textAlign: 'left',
              borderTop: index ? 1 : 0,
              borderColor: 'divider',
              color: 'text.primary',
              transition: 'background-color 0.15s',
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
              '&.Mui-focusVisible': { bgcolor: alpha(theme.palette.primary.main, 0.1) },
              '&.Mui-disabled': { opacity: picked === choice.reply ? 1 : 0.55 }
            }}
          >
            <ChoiceGlyph choice={choice} dark={dark} dotBorder={dotBorder} />
            <Typography variant='body2' noWrap sx={{ flex: 1, minWidth: 0 }}>
              {choice.label}
            </Typography>
            <Box
              component='i'
              aria-hidden
              className={picked === choice.reply ? 'ri-check-line' : 'ri-arrow-right-s-line'}
              sx={{ fontSize: 16, color: picked === choice.reply ? 'success.main' : 'text.secondary', flexShrink: 0 }}
            />
          </ButtonBase>
        ))}
      </Box>
    </Box>
  )
}
