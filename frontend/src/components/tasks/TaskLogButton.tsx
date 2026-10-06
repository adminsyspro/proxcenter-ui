'use client'

import { useState } from 'react'

import { IconButton, Tooltip } from '@mui/material'
import { useTranslations } from 'next-intl'

import TaskDetailDialog from '@/components/TaskDetailDialog'
import { parseUpid } from '@/lib/proxmox/upid'

/**
 * "View log" on a task row (#926): opens the PVE task log viewer that was
 * otherwise only reachable by double-clicking a row of the taskbar. The node
 * is read from the UPID when the caller does not know it.
 */
export default function TaskLogButton({
  connectionId,
  upid,
  node,
  status,
  size = 16,
}: Readonly<{
  connectionId: string
  upid: string
  node?: string
  /** The task's exitstatus when known, so the viewer opens on the right state. */
  status?: string
  size?: number
}>) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const taskNode = node || parseUpid(upid)?.node

  if (!connectionId || !taskNode) return null

  return (
    <>
      <Tooltip title={t('tasks.viewLog')}>
        <IconButton
          size="small"
          aria-label={t('tasks.viewLog')}
          onClick={event => {
            // Rows open their own detail dialog on click: this must not do both.
            event.stopPropagation()
            setOpen(true)
          }}
        >
          <i className="ri-file-list-3-line" style={{ fontSize: size }} />
        </IconButton>
      </Tooltip>
      {open && (
        <TaskDetailDialog
          open
          onClose={() => setOpen(false)}
          task={{ id: upid, connectionId, node: taskNode, type: upid.split(':')[5] || '', status: status || 'stopped' }}
        />
      )}
    </>
  )
}
