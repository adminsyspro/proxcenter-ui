'use client'

import { Dialog, DialogTitle, DialogContent, IconButton, Box, Typography, LinearProgress, Chip } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { SharedTask } from '@/lib/tasks/sharedTask'

type DetailResponse = { data: SharedTask & { logs?: unknown[] } }

export default function SharedTaskDetailDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const t = useTranslations()
  const { data } = useSWRFetch<DetailResponse>(jobId ? `/api/v1/tasks/shared/${jobId}` : null, { refreshInterval: 5000 })
  const task = data?.data

  return (
    <Dialog open={!!jobId} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{task?.label ?? t('tasks.shared.detailTitle')}</span>
        <IconButton onClick={onClose} size="small"><i className="ri-close-line" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!task ? (
          <LinearProgress />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                size="small"
                label={task.status === 'cancelled' ? t('tasks.status.cancelled') : task.status}
                color={task.status === 'failed' || task.status === 'cancelled' ? 'error' : task.status === 'completed' ? 'success' : 'primary'}
              />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {t('tasks.shared.startedBy', { name: task.createdByName })}
              </Typography>
            </Box>
            <LinearProgress variant={task.progress > 0 ? 'determinate' : 'indeterminate'} value={task.progress} />
            {task.currentStep && <Typography variant="body2">{task.currentStep}</Typography>}
            {task.error && <Typography variant="body2" color="error">{task.error}</Typography>}
            {Array.isArray(task.logs) && task.logs.length > 0 && (
              <Box component="pre" sx={{ fontSize: '0.75rem', maxHeight: 320, overflow: 'auto', bgcolor: 'action.hover', p: 1, borderRadius: 1, whiteSpace: 'pre-wrap' }}>
                {task.logs.map((l: unknown) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  )
}
