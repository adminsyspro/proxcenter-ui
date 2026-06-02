'use client'

import { useTranslations } from 'next-intl'
import { Autocomplete, TextField, Chip } from '@mui/material'

import { usePVEConnections } from '@/hooks/useConnections'

interface Conn { id: string; name: string }

interface ReportConnectionSelectProps {
  value: string[]
  onChange: (ids: string[]) => void
}

export default function ReportConnectionSelect({ value, onChange }: ReportConnectionSelectProps) {
  const t = useTranslations()
  const { data } = usePVEConnections()
  const options: Conn[] = (data?.data ?? []).map((c: any) => ({ id: c.id, name: c.name }))
  const selected = options.filter((o) => value.includes(o.id))

  return (
    <Autocomplete
      multiple
      options={options}
      value={selected}
      getOptionLabel={(o) => o.name}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_, next) => onChange(next.map((o) => o.id))}
      renderTags={(tags, getTagProps) =>
        tags.map((o, i) => <Chip {...getTagProps({ index: i })} key={o.id} label={o.name} size="small" />)
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={t('reports.connections')}
          placeholder={value.length === 0 ? t('reports.allConnections') : undefined}
        />
      )}
    />
  )
}
