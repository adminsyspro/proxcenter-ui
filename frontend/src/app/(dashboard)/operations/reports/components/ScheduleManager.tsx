'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Chip,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid, GridColDef } from '@mui/x-data-grid'

import ScheduleDialog from './ScheduleDialog'

interface ReportType {
  type: string
  name: string
  description: string
  sections: Array<{
    id: string
    name: string
    description: string
  }>
}

interface Schedule {
  id: string
  name: string
  enabled: boolean
  type: string
  frequency: 'daily' | 'weekly' | 'monthly'
  day_of_week?: number
  day_of_month?: number
  time_of_day: string
  connection_ids?: string[]
  sections?: string[]
  recipients: string[]
  last_run_at?: string
  next_run_at?: string
  created_at: string
}

interface ScheduleManagerProps {
  schedules: Schedule[]
  reportTypes: ReportType[]
  onCreate: (request: any) => Promise<void>
  onUpdate: (id: string, request: any) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRunNow: (id: string) => Promise<void>
  loading: boolean
}

export default function ScheduleManager({
  schedules,
  reportTypes,
  onCreate,
  onUpdate,
  onDelete,
  onRunNow,
  loading,
}: ScheduleManagerProps) {
  const t = useTranslations()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null)

  const handleCreate = () => {
    setEditingSchedule(null)
    setDialogOpen(true)
  }

  const handleEdit = (schedule: Schedule) => {
    setEditingSchedule(schedule)
    setDialogOpen(true)
  }

  const handleDialogClose = () => {
    setDialogOpen(false)
    setEditingSchedule(null)
  }

  const handleDialogSave = async (data: any) => {
    if (editingSchedule) {
      await onUpdate(editingSchedule.id, data)
    } else {
      await onCreate(data)
    }

    handleDialogClose()
  }

  const handleToggleEnabled = async (schedule: Schedule) => {
    await onUpdate(schedule.id, { enabled: !schedule.enabled })
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      infrastructure: t('reports.types.infrastructure'),
      alerts: t('reports.types.alerts'),
      utilization: t('reports.types.utilization'),
      inventory: t('reports.types.inventory'),
      capacity: t('reports.types.capacity'),
    }

    return labels[type] || type
  }

  const getFrequencyLabel = (frequency: string) => {
    const labels: Record<string, string> = {
      daily: t('reports.daily'),
      weekly: t('reports.weekly'),
      monthly: t('reports.monthly'),
    }

    return labels[frequency] || frequency
  }

  const getDayLabel = (schedule: Schedule) => {
    if (schedule.frequency === 'weekly' && schedule.day_of_week !== undefined) {
      const days = [
        t('reports.days.sunday'),
        t('reports.days.monday'),
        t('reports.days.tuesday'),
        t('reports.days.wednesday'),
        t('reports.days.thursday'),
        t('reports.days.friday'),
        t('reports.days.saturday'),
      ]

      return days[schedule.day_of_week] || ''
    }

    if (schedule.frequency === 'monthly' && schedule.day_of_month !== undefined) {
      return `Day ${schedule.day_of_month}`
    }

    return ''
  }

  const formatDateTime = (dateStr?: string) => {
    if (!dateStr) return t('reports.neverRun')

    return new Date(dateStr).toLocaleString()
  }

  const columns: GridColDef[] = [
    {
      field: 'enabled',
      headerName: '',
      width: 60,
      renderCell: (params) => (
        <Switch
          size="small"
          checked={params.value}
          onChange={() => handleToggleEnabled(params.row)}
        />
      ),
    },
    {
      field: 'name',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 200,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', flexDirection: 'column', py: 0.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {params.value}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.6 }}>
            {getTypeLabel(params.row.type)}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'frequency',
      headerName: t('reports.frequency'),
      width: 150,
      renderCell: (params) => (
        <Box>
          <Chip size="small" label={getFrequencyLabel(params.value)} variant="outlined" />
          <Typography variant="caption" sx={{ ml: 1, opacity: 0.7 }}>
            {getDayLabel(params.row)} {params.row.time_of_day}
          </Typography>
        </Box>
      ),
    },
    {
      field: 'recipients',
      headerName: t('reports.recipients'),
      width: 200,
      renderCell: (params) => (
        <Tooltip title={params.value?.join(', ') || ''}>
          <Typography variant="caption" noWrap>
            {params.value?.length || 0} recipient(s)
          </Typography>
        </Tooltip>
      ),
    },
    {
      field: 'next_run_at',
      headerName: t('reports.nextRun'),
      width: 160,
      renderCell: (params) => (
        <Typography variant="caption">
          {formatDateTime(params.value)}
        </Typography>
      ),
    },
    {
      field: 'last_run_at',
      headerName: t('reports.lastRun'),
      width: 160,
      renderCell: (params) => (
        <Typography variant="caption">
          {formatDateTime(params.value)}
        </Typography>
      ),
    },
    {
      field: 'actions',
      headerName: t('common.actions'),
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('reports.runNow')}>
            <IconButton size="small" color="primary" onClick={() => onRunNow(params.row.id)}>
              <i className="ri-play-line" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.edit')}>
            <IconButton size="small" onClick={() => handleEdit(params.row)}>
              <i className="ri-edit-line" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('common.delete')}>
            <IconButton size="small" color="error" onClick={() => onDelete(params.row.id)}>
              <i className="ri-delete-bin-line" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ]

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6">{t('reports.schedules')}</Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<i className="ri-add-line" />}
          onClick={handleCreate}
        >
          {t('reports.newSchedule')}
        </Button>
      </Box>

      {schedules.length === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, opacity: 0.6 }}>
          <i className="ri-calendar-schedule-line" style={{ fontSize: 48, marginBottom: 16 }} />
          <Typography>{t('reports.noSchedules')}</Typography>
          <Button
            variant="outlined"
            sx={{ mt: 2 }}
            startIcon={<i className="ri-add-line" />}
            onClick={handleCreate}
          >
            {t('reports.newSchedule')}
          </Button>
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <DataGrid
            rows={schedules}
            columns={columns}
            loading={loading}
            density="compact"
            pageSizeOptions={[10, 25, 50]}
            initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
            sx={{
              border: 'none',
              '& .MuiDataGrid-cell': {
                display: 'flex',
                alignItems: 'center',
              },
              '& .MuiDataGrid-row': {
                minHeight: '52px !important',
              },
            }}
          />
        </Box>
      )}

      <ScheduleDialog
        open={dialogOpen}
        onClose={handleDialogClose}
        onSave={handleDialogSave}
        schedule={editingSchedule}
        reportTypes={reportTypes}
      />
    </Box>
  )
}
