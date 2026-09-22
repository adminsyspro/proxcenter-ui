'use client'

import { IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

/**
 * The stop glyph carried by a task row (#974): same icon, same colour and the
 * same spinner-while-stopping as the one that has always sat in the PVE task
 * detail dialog, so an operator recognises it wherever the row lives.
 */
export default function StopTaskButton({
  onClick,
  stopping = false,
  size = 16,
}: Readonly<{
  onClick: () => void
  stopping?: boolean
  size?: number
}>) {
  const t = useTranslations()

  return (
    <Tooltip title={stopping ? t('tasks.stop.stopping') : t('tasks.stop.action')}>
      {/* A disabled IconButton fires no events, so the tooltip needs a live
          wrapper to hang on to. */}
      <span>
        <IconButton
          size="small"
          disabled={stopping}
          aria-label={t('tasks.stop.action')}
          onClick={event => {
            // Rows open a detail dialog on click: stopping must not do both.
            event.stopPropagation()
            onClick()
          }}
          sx={{
            color: 'error.main',
            // Own keyframes: the `spin` used elsewhere is declared by the
            // taskbar and by a couple of dialogs, never globally, and this
            // button also renders on the Task Center page.
            '@keyframes stopTaskSpin': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
            ...(stopping && { '& i': { animation: 'stopTaskSpin 1s linear infinite' } })
          }}
        >
          <i
            className={stopping ? 'ri-loader-4-line' : 'ri-stop-circle-line'}
            style={{ fontSize: size }}
          />
        </IconButton>
      </span>
    </Tooltip>
  )
}
