'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale, useTranslations } from 'next-intl'

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
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

import changelog from '@/data/changelog.json'
import { useBranding } from '@/contexts/BrandingContext'

const STORAGE_KEY = 'proxcenter_whats_new_seen'
const RELEASES_URL = 'https://github.com/adminsyspro/proxcenter-ui/releases'
// Older releases stay one click away through the GitHub link in the footer.
const PREVIOUS_RELEASES_SHOWN = 5
const UPGRADE_COMMAND = 'docker compose pull && docker compose up -d'

type ItemType = 'new' | 'improved' | 'fix' | 'removed'

interface ChangelogItem {
  type: ItemType
  text: string
}

interface ChangelogEntry {
  version: string
  // Day the release was tagged, YYYY-MM-DD.
  date?: string
  title: string
  // Prose paragraphs shown for the release; its items are listed instead when absent.
  summary?: string[]
  items: ChangelogItem[]
}

const typeConfig: Record<ItemType, { icon: string; color: string; label: string }> = {
  new: { icon: 'ri-check-line', color: '#10b981', label: 'New' },
  improved: { icon: 'ri-check-line', color: '#10b981', label: 'Improved' },
  fix: { icon: 'ri-check-line', color: '#10b981', label: 'Fix' },
  removed: { icon: 'ri-check-line', color: '#10b981', label: 'Removed' },
}

interface UpdateInfo {
  updateAvailable: boolean
  latestVersion: string | null
  releaseUrl: string | null
  // 'offline' on an air-gapped instance, which upgrades from a bundle instead of pulling images.
  error?: string | null
}

interface WhatsNewDialogProps {
  open: boolean
  onClose: () => void
  // Result of the provider-side version check, null when this viewer does not run it.
  updateInfo?: UpdateInfo | null
  // Only those who administer the instance see how to upgrade it.
  canUpgrade?: boolean
}

export function useWhatsNew() {
  const [open, setOpen] = useState(false)
  const [hasUnseen, setHasUnseen] = useState(false)

  const latestVersion = (changelog as ChangelogEntry[])[0]?.version

  // Detect a new version to surface the "What's New" badge, but do NOT auto-open
  // the dialog. It opens only on demand from the profile menu (handleOpen).
  useEffect(() => {
    if (!latestVersion) return
    const seen = localStorage.getItem(STORAGE_KEY)

    if (seen !== latestVersion) {
      setHasUnseen(true)
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

function ChangelogItems({ items }: { items: ChangelogItem[] }) {
  return (
    <List dense disablePadding>
      {items.map((item, i) => {
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
            <ListItemText primary={item.text} primaryTypographyProps={{ variant: 'body2', fontSize: '0.82rem' }} />
          </ListItem>
        )
      })}
    </List>
  )
}

function formatReleaseDate(date: string, locale: string) {
  // Release dates are calendar days, read in UTC so no timezone moves them to the day before.
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`)
  )
}

function ReleaseNotes({ entry, lead = false }: { entry: ChangelogEntry; lead?: boolean }) {
  if (!entry.summary?.length) return <ChangelogItems items={entry.items} />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {entry.summary.map((paragraph, i) =>
        lead && i === 0 ? (
          <Typography key={i} variant='body2' color='text.primary' sx={{ lineHeight: 1.65 }}>
            {paragraph}
          </Typography>
        ) : (
          <Typography key={i} variant='body2' color='text.secondary' sx={{ lineHeight: 1.65 }}>
            {paragraph}
          </Typography>
        )
      )}
    </Box>
  )
}

function UpgradeCommand({ updateInfo }: { updateInfo?: UpdateInfo | null }) {
  const t = useTranslations()
  const newVersion = updateInfo?.updateAvailable ? updateInfo.latestVersion : null
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)

    return () => clearTimeout(timer)
  }, [copied])

  const copy = () => {
    void navigator.clipboard?.writeText(UPGRADE_COMMAND).then(() => setCopied(true), () => setCopied(false))
  }

  if (updateInfo?.error === 'offline') {
    return (
      <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography variant='subtitle2' color='text.primary' sx={{ fontWeight: 600 }}>
          {t('whatsNew.upgradeTitle')}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
          {t('about.updateCheckOffline')}
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ mt: 2.5, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1 }}>
        <Typography variant='subtitle2' color={newVersion ? 'warning.main' : 'text.primary'} sx={{ fontWeight: 600 }}>
          {newVersion ? t('about.newVersionAvailable', { version: newVersion }) : t('whatsNew.upgradeTitle')}
        </Typography>
        {newVersion && updateInfo?.releaseUrl && (
          <Link href={updateInfo.releaseUrl} target='_blank' rel='noopener noreferrer' variant='caption' underline='hover' sx={{ flexShrink: 0 }}>
            {t('about.viewRelease')}
          </Link>
        )}
      </Box>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>
        {t('whatsNew.upgradeHint')}
      </Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1.5,
          pr: 0.5,
          py: 0.5,
          borderRadius: '8px',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Box
          component='code'
          sx={{
            flexGrow: 1,
            minWidth: 0,
            overflowX: 'auto',
            whiteSpace: 'nowrap',
            p: 0,
            bgcolor: 'transparent',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '0.78rem',
            color: 'text.primary',
          }}
        >
          {UPGRADE_COMMAND}
        </Box>
        <Tooltip title={copied ? t('whatsNew.copied') : t('whatsNew.copy')}>
          <IconButton size='small' onClick={copy} aria-label={t('whatsNew.copy')}>
            <i className={copied ? 'ri-check-line' : 'ri-file-copy-line'} style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}

// Every release hangs on one timeline rail: dots are centred on RAIL_X, content starts at CONTENT_X.
const RAIL_X = 14
const CONTENT_X = 40
const VERSION_WIDTH = 52
const VERSION_GAP = 12

export default function WhatsNewDialog({ open, onClose, updateInfo = null, canUpgrade = false }: WhatsNewDialogProps) {
  const t = useTranslations()
  const { branding } = useBranding()
  // A white-labelled instance points at its own changelog when it sets one.
  const customChangelog = branding.enabled && branding.changelogUrl ? branding.changelogUrl : null
  const locale = useLocale()
  const theme = useTheme()
  const [latest, ...older] = changelog as ChangelogEntry[]
  const previous = older.slice(0, PREVIOUS_RELEASES_SHOWN)
  const [expandedVersion, setExpandedVersion] = useState<string | false>(false)

  const dot = (size: number) => ({
    position: 'absolute',
    left: RAIL_X - size / 2,
    width: size,
    height: size,
    borderRadius: '50%',
    zIndex: 1,
  })

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-megaphone-line' style={{ fontSize: 22, color: theme.palette.primary.main }} />
          <Typography variant='h6' fontWeight={700}>
            {t('whatsNew.title')}
          </Typography>
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2.5, py: 2.5, minHeight: 0, overflowY: 'auto' }}>
        <Box sx={{ position: 'relative' }}>
          {/* Timeline rail, from the latest release's dot down to the last listed one */}
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              left: RAIL_X - 1,
              top: 24,
              bottom: previous.length > 0 ? 22 : '100%',
              width: 2,
              borderRadius: 1,
              bgcolor: 'divider',
            }}
          />

          {latest && (
            <Box sx={{ position: 'relative', pl: `${CONTENT_X}px` }}>
              <Box
                aria-hidden
                sx={{
                  ...dot(12),
                  top: 14,
                  bgcolor: 'primary.main',
                  boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.2)}`,
                }}
              />
              <Box sx={{ p: 2.5, borderRadius: '12px', bgcolor: alpha(theme.palette.primary.main, 0.06) }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}>
                  <Typography
                    component='span'
                    variant='body2'
                    color='primary.main'
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {latest.version}
                  </Typography>
                  <Chip
                    label={updateInfo?.updateAvailable ? t('whatsNew.installed') : t('whatsNew.latest')}
                    size='small'
                    sx={{
                      height: 18,
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      color: updateInfo?.updateAvailable ? 'text.secondary' : 'primary.main',
                      bgcolor: updateInfo?.updateAvailable
                        ? alpha(theme.palette.text.primary, 0.08)
                        : alpha(theme.palette.primary.main, 0.12),
                      '& .MuiChip-label': { px: 1 },
                    }}
                  />
                  {latest.date && (
                    <Typography variant='caption' color='text.secondary'>
                      {formatReleaseDate(latest.date, locale)}
                    </Typography>
                  )}
                </Box>
                <Typography variant='subtitle1' color='text.primary' sx={{ fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.45, mt: 1, mb: 1.5 }}>
                  {latest.title}
                </Typography>
                <ReleaseNotes entry={latest} lead />
                {canUpgrade && <UpgradeCommand updateInfo={updateInfo} />}
              </Box>
            </Box>
          )}

          {previous.length > 0 && (
            <Typography
              variant='subtitle2'
              color='text.secondary'
              sx={{ display: 'block', fontWeight: 600, pl: `${CONTENT_X}px`, mt: 3, mb: 0.5 }}
            >
              {t('whatsNew.previousReleases')}
            </Typography>
          )}

          {previous.map(entry => {
            const isExpanded = expandedVersion === entry.version

            return (
              <Accordion
                key={entry.version}
                expanded={isExpanded}
                onChange={(_, expanded) => setExpandedVersion(expanded ? entry.version : false)}
                disableGutters
                square
                elevation={0}
                sx={{
                  bgcolor: 'transparent',
                  backgroundImage: 'none',
                  '&::before': { display: 'none' },
                  // The theme gives accordions a shadow and an expanded margin; rows sit flat on the rail.
                  '&, &.Mui-expanded': { boxShadow: 'none', margin: 0, borderRadius: 0 },
                }}
              >
                <AccordionSummary
                  expandIcon={
                    <i className='ri-arrow-down-s-line' style={{ fontSize: 20, color: theme.palette.text.secondary }} />
                  }
                  sx={{
                    position: 'relative',
                    minHeight: 44,
                    pl: `${CONTENT_X}px`,
                    pr: 1,
                    py: 0.75,
                    '&.Mui-expanded': { minHeight: 44 },
                    '&:hover .whats-new-version': { color: 'primary.main' },
                    '& .MuiAccordionSummary-content': { alignItems: 'center', gap: `${VERSION_GAP}px`, minWidth: 0 },
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      ...dot(10),
                      top: '50%',
                      transform: 'translateY(-50%)',
                      bgcolor: 'background.paper',
                      border: '2px solid',
                      borderColor: isExpanded ? 'primary.main' : 'text.disabled',
                      transition: theme.transitions.create('border-color'),
                    }}
                  />
                  {/* Box, not Typography: the theme forces color: inherit on Typography inside a summary. */}
                  <Box
                    component='span'
                    className='whats-new-version'
                    sx={{
                      typography: 'body2',
                      width: VERSION_WIDTH,
                      flexShrink: 0,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: isExpanded ? 'primary.main' : 'text.primary',
                      transition: theme.transitions.create('color'),
                    }}
                  >
                    {entry.version}
                  </Box>
                  <Box component='span' sx={{ typography: 'body2', flexGrow: 1, minWidth: 0, fontWeight: 500, lineHeight: 1.45, color: 'text.primary' }}>
                    {entry.title}
                  </Box>
                  {entry.date && (
                    <Box
                      component='span'
                      sx={{
                        typography: 'caption',
                        color: 'text.secondary',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        display: { xs: 'none', sm: 'block' },
                      }}
                    >
                      {formatReleaseDate(entry.date, locale)}
                    </Box>
                  )}
                </AccordionSummary>

                <AccordionDetails sx={{ pl: `${CONTENT_X + VERSION_WIDTH + VERSION_GAP}px`, pr: 4, pt: 0, pb: 2 }}>
                  <ReleaseNotes entry={entry} />
                </AccordionDetails>
              </Accordion>
            )
          })}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 1.5, justifyContent: 'space-between' }}>
        <Link
          href={customChangelog ?? RELEASES_URL}
          target='_blank'
          rel='noopener noreferrer'
          variant='body2'
          underline='hover'
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
        >
          {!customChangelog && <i className='ri-github-fill' style={{ fontSize: 16 }} />}
          {customChangelog ? t('whatsNew.allReleasesCustom') : t('whatsNew.allReleases')}
          <i className='ri-external-link-line' style={{ fontSize: 14 }} />
        </Link>
        <Button onClick={onClose} variant='contained' size='small'>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
