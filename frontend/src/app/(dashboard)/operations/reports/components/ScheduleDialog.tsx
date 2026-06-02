'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import { useTenant } from '@/contexts/TenantContext'
import { usePVEConnections } from '@/hooks/useConnections'

import ReportConnectionSelect from './ReportConnectionSelect'

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

interface Language {
  code: string
  name: string
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
  language?: string
  last_run_at?: string
  next_run_at?: string
  created_at: string
}

interface ScheduleDialogProps {
  open: boolean
  onClose: () => void
  onSave: (data: any) => Promise<void>
  schedule: Schedule | null
  reportTypes: ReportType[]
  languages: Language[]
}

export default function ScheduleDialog({
  open,
  onClose,
  onSave,
  schedule,
  reportTypes,
  languages,
}: ScheduleDialogProps) {
  const t = useTranslations()
  const { isProvider } = useTenant()
  const { data: pveData } = usePVEConnections()
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [timeOfDay, setTimeOfDay] = useState('08:00')
  const [recipients, setRecipients] = useState('')
  const [language, setLanguage] = useState('en')
  const [selectedSections, setSelectedSections] = useState<string[]>([])
  const [allSections, setAllSections] = useState(true)
  const [connectionIds, setConnectionIds] = useState<string[]>([])

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      if (schedule) {
        setName(schedule.name)
        setType(schedule.type)
        setFrequency(schedule.frequency)
        setDayOfWeek(schedule.day_of_week || 1)
        setDayOfMonth(schedule.day_of_month || 1)
        setTimeOfDay(schedule.time_of_day || '08:00')
        setRecipients(schedule.recipients.join(', '))
        setLanguage(schedule.language || 'en')

        // Legacy schedules were created under the old force-all-connections
        // behavior, so connection_ids holds every connection. Show that as
        // empty (= all, dynamic) instead of a frozen list that would exclude
        // future connections.
        const allPveIds: string[] = (pveData?.data ?? []).map((c: any) => c.id)
        const sched = schedule.connection_ids ?? []
        const coversAll = allPveIds.length > 0 && allPveIds.every((id) => sched.includes(id))
        setConnectionIds(coversAll ? [] : sched)

        if (schedule.sections && schedule.sections.length > 0) {
          setSelectedSections(schedule.sections)
          setAllSections(false)
        } else {
          setSelectedSections([])
          setAllSections(true)
        }
      } else {
        setName('')
        setType(reportTypes[0]?.type || '')
        setFrequency('weekly')
        setDayOfWeek(1)
        setDayOfMonth(1)
        setTimeOfDay('08:00')
        setRecipients('')
        setLanguage('en')
        setSelectedSections([])
        setAllSections(true)
        setConnectionIds([])
      }
    }
  }, [open, schedule, reportTypes, pveData])

  const selectedReportType = reportTypes.find(rt => rt.type === type)

  const handleSave = async () => {
    if (!name || !type || !recipients.trim()) return

    setSaving(true)

    try {
      await onSave({
        name,
        type,
        frequency,
        day_of_week: frequency === 'weekly' ? dayOfWeek : undefined,
        day_of_month: frequency === 'monthly' ? dayOfMonth : undefined,
        time_of_day: timeOfDay,
        language,
        recipients: recipients.split(',').map(r => r.trim()).filter(r => r),
        sections: allSections ? [] : selectedSections,
        ...(isProvider && type !== 'vdc' ? { connection_ids: connectionIds } : {}),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSectionToggle = (sectionId: string) => {
    if (selectedSections.includes(sectionId)) {
      setSelectedSections(selectedSections.filter(s => s !== sectionId))
    } else {
      setSelectedSections([...selectedSections, sectionId])
    }
  }

  const days = [
    { value: 0, label: t('reports.days.sunday') },
    { value: 1, label: t('reports.days.monday') },
    { value: 2, label: t('reports.days.tuesday') },
    { value: 3, label: t('reports.days.wednesday') },
    { value: 4, label: t('reports.days.thursday') },
    { value: 5, label: t('reports.days.friday') },
    { value: 6, label: t('reports.days.saturday') },
  ]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {schedule ? t('reports.editSchedule') : t('reports.newSchedule')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {/* Schedule Name */}
          <TextField
            label={t('common.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />

          {/* Report Type */}
          <FormControl fullWidth>
            <InputLabel>{t('reports.reportType')}</InputLabel>
            <Select
              value={type}
              label={t('reports.reportType')}
              onChange={(e) => {
                setType(e.target.value)
                setSelectedSections([])
                setAllSections(true)
                if (e.target.value === 'vdc') setConnectionIds([])
              }}
            >
              {reportTypes.map((rt) => (
                <MenuItem key={rt.type} value={rt.type}>
                  {rt.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Report Language */}
          <FormControl fullWidth>
            <InputLabel>{t('reports.language')}</InputLabel>
            <Select
              value={language}
              label={t('reports.language')}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {languages.map((lang) => (
                <MenuItem key={lang.code} value={lang.code}>
                  {lang.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Connection scope (provider-only; hidden for the vdc report type) */}
          {isProvider && type !== 'vdc' && (
            <ReportConnectionSelect value={connectionIds} onChange={setConnectionIds} />
          )}

          {/* Frequency */}
          <FormControl fullWidth>
            <InputLabel>{t('reports.frequency')}</InputLabel>
            <Select
              value={frequency}
              label={t('reports.frequency')}
              onChange={(e) => setFrequency(e.target.value as 'daily' | 'weekly' | 'monthly')}
            >
              <MenuItem value="daily">{t('reports.daily')}</MenuItem>
              <MenuItem value="weekly">{t('reports.weekly')}</MenuItem>
              <MenuItem value="monthly">{t('reports.monthly')}</MenuItem>
            </Select>
          </FormControl>

          {/* Day of Week (for weekly) */}
          {frequency === 'weekly' && (
            <FormControl fullWidth>
              <InputLabel>{t('reports.dayOfWeek')}</InputLabel>
              <Select
                value={dayOfWeek}
                label={t('reports.dayOfWeek')}
                onChange={(e) => setDayOfWeek(e.target.value as number)}
              >
                {days.map((day) => (
                  <MenuItem key={day.value} value={day.value}>
                    {day.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Day of Month (for monthly) */}
          {frequency === 'monthly' && (
            <FormControl fullWidth>
              <InputLabel>{t('reports.dayOfMonth')}</InputLabel>
              <Select
                value={dayOfMonth}
                label={t('reports.dayOfMonth')}
                onChange={(e) => setDayOfMonth(e.target.value as number)}
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                  <MenuItem key={day} value={day}>
                    {day}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {/* Time of Day */}
          <TextField
            label={t('reports.timeOfDay')}
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            InputLabelProps={{ shrink: true }}
            fullWidth
          />

          {/* Recipients */}
          <TextField
            label={t('reports.recipients')}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
            placeholder={t('reports.recipientsPlaceholder')}
            helperText={t('reports.recipientsPlaceholder')}
            required
            fullWidth
            multiline
            rows={2}
          />

          {/* Sections */}
          {selectedReportType && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('reports.sections')}
              </Typography>
              <FormGroup>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={allSections}
                      onChange={() => {
                        setAllSections(!allSections)
                        setSelectedSections([])
                      }}
                    />
                  }
                  label={t('reports.allSections')}
                />
                {!allSections && (
                  <Box sx={{ pl: 2 }}>
                    {selectedReportType.sections.map((section) => (
                      <FormControlLabel
                        key={section.id}
                        control={
                          <Checkbox
                            checked={selectedSections.includes(section.id)}
                            onChange={() => handleSectionToggle(section.id)}
                            size="small"
                          />
                        }
                        label={section.name}
                      />
                    ))}
                  </Box>
                )}
              </FormGroup>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name || !type || !recipients.trim()}
        >
          {saving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
