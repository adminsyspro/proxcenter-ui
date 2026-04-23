'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  InputAdornment,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function filterCategories(categories, query) {
  if (!query) return categories
  const q = query.toLowerCase()
  return categories
    .map(cat => ({
      ...cat,
      commands: cat.commands.filter(c =>
        c.prefix.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.usedBy.toLowerCase().includes(q)
      )
    }))
    .filter(cat => cat.commands.length > 0)
}

export default function AllowlistCard() {
  const t = useTranslations()
  const { data, error, isLoading } = useSWR('/api/v1/ssh/allowlist', fetcher)
  const [query, setQuery] = useState('')

  const categories = useMemo(() => {
    if (!data?.categories) return []
    return filterCategories(data.categories, query)
  }, [data, query])

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshCommands.allowlist.heading')}
        </Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {t('settings.sshCommands.errors.fetchFailed')}
          </Alert>
        )}

        <TextField
          fullWidth
          size='small'
          placeholder={t('settings.sshCommands.allowlist.searchPlaceholder')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position='start'>
                <i className='ri-search-line' />
              </InputAdornment>
            )
          }}
        />

        {isLoading && (
          <Stack spacing={1}>
            <Skeleton variant='rounded' height={48} />
            <Skeleton variant='rounded' height={48} />
            <Skeleton variant='rounded' height={48} />
          </Stack>
        )}

        {!isLoading && !error && categories.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshCommands.allowlist.noResults')}
          </Typography>
        )}

        {!isLoading && !error && categories.map(cat => (
          <Accordion
            key={cat.id}
            defaultExpanded={Boolean(query)}
            disableGutters
            variant='outlined'
            sx={{ mb: 1 }}
          >
            <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
              <Stack direction='row' alignItems='center' spacing={1.5} sx={{ width: '100%' }}>
                <Typography variant='body1' fontWeight={600}>
                  {cat.label}
                </Typography>
                <Chip size='small' label={t('settings.sshCommands.allowlist.categoryCount', { count: cat.commands.length })} />
                {cat.description && (
                  <Typography variant='caption' color='text.secondary' sx={{ ml: 'auto', display: { xs: 'none', md: 'block' } }}>
                    {cat.description}
                  </Typography>
                )}
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Table size='small'>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('settings.sshCommands.allowlist.columnPrefix')}</TableCell>
                    <TableCell>{t('settings.sshCommands.allowlist.columnPurpose')}</TableCell>
                    <TableCell>{t('settings.sshCommands.allowlist.columnUsedBy')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cat.commands.map(c => (
                    <TableRow key={c.prefix}>
                      <TableCell>
                        <Box component='code' sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85rem', backgroundColor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5 }}>
                          {c.prefix}
                        </Box>
                      </TableCell>
                      <TableCell>{c.description}</TableCell>
                      <TableCell>
                        <Typography variant='caption' color='text.secondary'>{c.usedBy}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionDetails>
          </Accordion>
        ))}
      </CardContent>
    </Card>
  )
}
