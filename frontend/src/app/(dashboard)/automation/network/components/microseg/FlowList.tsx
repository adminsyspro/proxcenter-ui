'use client'

import { useState } from 'react'
import { Box, Button, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import FlowSummary from './FlowSummary'
import PolicyPager, { usePaged } from './PolicyPager'

type Props = {
  flows: MicrosegFlow[]
  zones: MicrosegZone[]
  onAdd: () => void
  onEdit: (flow: MicrosegFlow) => void
  onDelete: (flow: MicrosegFlow) => void
}

function FlowRow({ flow, zonesById, onEdit, onDelete }: { flow: MicrosegFlow; zonesById: Map<string, MicrosegZone> } & Pick<Props, 'onEdit' | 'onDelete'>) {
  const t = useTranslations('microsegPilot.policy')
  const [open, setOpen] = useState(false)
  const details = [flow.comment, flow.created_by ? t('flow.createdBy', { user: flow.created_by }) : ''].filter(Boolean)

  return (
    <Box role='listitem' sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, px: 1 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? t('hideDetails') : t('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <i className='ri-route-line' style={{ flexShrink: 0, opacity: 0.8 }} />
        <FlowSummary flow={flow} zonesById={zonesById} />
        <Tooltip title={t('flow.edit')}>
          <IconButton size='small' aria-label={t('flow.edit')} onClick={() => onEdit(flow)}><i className='ri-pencil-line' /></IconButton>
        </Tooltip>
        <Tooltip title={t('flow.delete')}>
          <IconButton size='small' aria-label={t('flow.delete')} onClick={() => onDelete(flow)}><i className='ri-delete-bin-line' /></IconButton>
        </Tooltip>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 7, pr: 2, pb: 1, minWidth: 0 }}>
          {details.map(line => (
            <Tooltip key={line} title={line}><Typography variant='body2' color='text.secondary' noWrap>{line}</Typography></Tooltip>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

/** Every flow of the draft, ten per page, with edit and delete. */
export default function FlowList({ flows, zones, onAdd, onEdit, onDelete }: Props) {
  const t = useTranslations('microsegPilot.policy')
  const paged = usePaged(flows)
  const zonesById = new Map(zones.map(z => [z.id, z]))

  return (
    <Box component='section' aria-label={t('flowsTitle')} sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('flowsTitle')}</Typography>
        <Button size='small' variant='outlined' startIcon={<i className='ri-add-line' />} onClick={onAdd} disabled={zones.length === 0}>
          {t('addFlow')}
        </Button>
      </Box>
      {flows.length === 0 ? (
        <Typography color='text.secondary' sx={{ py: 2 }}>{t('flowsEmpty')}</Typography>
      ) : (
        <>
          <Box role='list'>
            {paged.rows.map(flow => <FlowRow key={flow.id} flow={flow} zonesById={zonesById} onEdit={onEdit} onDelete={onDelete} />)}
          </Box>
          <PolicyPager count={paged.count} page={paged.page} size={paged.size} onPage={paged.setPage} />
        </>
      )}
    </Box>
  )
}
