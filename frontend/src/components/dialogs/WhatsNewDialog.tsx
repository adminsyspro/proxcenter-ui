'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import changelog from '@/data/changelog.json'

const STORAGE_KEY = 'proxcenter_whats_new_seen'

type ItemType = 'new' | 'improved' | 'fix' | 'removed'

interface ChangelogItem {
  type: ItemType
  text: string
}

interface ChangelogEntry {
  version: string
  title: string
  items: ChangelogItem[]
}

const typeConfig: Record<ItemType, { icon: string; color: string; label: string }> = {
  new: { icon: 'ri-check-line', color: '#10b981', label: 'New' },
  improved: { icon: 'ri-check-line', color: '#10b981', label: 'Improved' },
  fix: { icon: 'ri-check-line', color: '#10b981', label: 'Fix' },
  removed: { icon: 'ri-check-line', color: '#10b981', label: 'Removed' },
}

interface WhatsNewDialogProps {
  open: boolean
  onClose: () => void
}

export function useWhatsNew() {
  const [open, setOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)

  const latestVersion = (changelog as ChangelogEntry[])[0]?.version

  useEffect(() => {
    if (!latestVersion) return
    const seen = localStorage.getItem(STORAGE_KEY)

    if (seen !== latestVersion) {
      setHasUnseen(true)
      // Small delay so the app renders first
      const timer = setTimeout(() => setOpen(true), 1500)

      return () => clearTimeout(timer)
    }
  }, [latestVersion])

  const markSeen = useCallback(() => {
    if (latestVersion) {
      localStorage.setItem(STORAGE_KEY, latestVersion)
      setHasUnseen(false)
    }
  }, [latestVersion])

  const handleClose = useCallback(() => {
    setOpen(false)
    markSeen()
  }, [markSeen])

  const handleOpen = useCallback(() => {
    setOpen(true)
  }, [])

  return { open, hasUnseen, handleOpen, handleClose }
}

export default function WhatsNewDialog({ open, onClose }: WhatsNewDialogProps) {
  const t = useTranslations()
  const theme = useTheme()
  const entries = changelog as ChangelogEntry[]
  const [expandedVersion, setExpandedVersion] = useState<string | false>(entries[0]?.version || false)

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-megaphone-line' style={{ fontSize: 22, color: theme.palette.primary.main }} />
          <Typography variant='h6' fontWeight={700}>
            {t('whatsNew.title', { defaultMessage: "What's New" })}
          </Typography>
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {entries.map((entry, idx) => {
          const isExpanded = expandedVersion === entry.version
          const isLatest = idx === 0

          return (
            <Accordion
              key={entry.version}
              expanded={isExpanded}
              onChange={(_, expanded) => setExpandedVersion(expanded ? entry.version : false)}
              disableGutters
              elevation={0}
              sx={{
                border: '1px solid',
                borderColor: isExpanded
                  ? alpha(theme.palette.primary.main, 0.3)
                  : 'divider',
                borderRadius: '10px !important',
                overflow: 'hidden',
                '&::before': { display: 'none' },
                ...(isExpanded && {
                  bgcolor: alpha(theme.palette.primary.main, 0.02),
                }),
              }}
            >
              <AccordionSummary
                expandIcon={
                  <i className='ri-arrow-down-s-line' style={{ fontSize: 20, color: theme.palette.text.secondary }} />
                }
                sx={{
                  minHeight: 48,
                  px: 2,
                  '& .MuiAccordionSummary-content': {
                    alignItems: 'center',
                    gap: 1.5,
                    my: 1,
                  },
                }}
              >
                {/* Dot indicator */}
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: isLatest ? theme.palette.primary.main : alpha(theme.palette.text.disabled, 0.3),
                    ...(isLatest && {
                      boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`,
                    }),
                  }}
                />
                <Chip
                  label={entry.version}
                  size='small'
                  color={isLatest ? 'primary' : 'default'}
                  variant={isLatest ? 'filled' : 'outlined'}
                  sx={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    height: 22,
                  }}
                />
                <Typography variant='subtitle2' fontWeight={700} sx={{ flexGrow: 1 }} noWrap>
                  {entry.title}
                </Typography>
              </AccordionSummary>

              <AccordionDetails sx={{ px: 2, pt: 0, pb: 1.5 }}>
                <List dense disablePadding>
                  {entry.items.map((item, i) => {
                    const config = typeConfig[item.type] || typeConfig.improved

                    return (
                      <ListItem key={i} disablePadding sx={{ py: 0.4 }}>
                        <ListItemIcon sx={{ minWidth: 32 }}>
                          <Box
                            sx={{
                              width: 22,
                              height: 22,
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: alpha(config.color, 0.12),
                            }}
                          >
                            <i className={config.icon} style={{ fontSize: 13, color: config.color }} />
                          </Box>
                        </ListItemIcon>
                        <ListItemText
                          primary={item.text}
                          primaryTypographyProps={{ variant: 'body2', fontSize: '0.82rem' }}
                        />
                      </ListItem>
                    )
                  })}
                </List>
              </AccordionDetails>
            </Accordion>
          )
        })}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} variant='contained' size='small'>
          {t('common.close', { defaultMessage: 'Close' })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
