'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Chip,
  Divider,
  Link,
  CircularProgress,
  Alert,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material'

import { VERSION, VERSION_NAME, GITHUB_URL, CHANGELOG } from '@/config/version'

interface VersionInfo {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseNotes: string | null
  releaseName?: string
  publishedAt: string | null
  error?: string
}

interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export default function AboutDialog({ open, onClose }: AboutDialogProps) {
  const t = useTranslations()
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetchVersionInfo()
    }
  }, [open])

  const fetchVersionInfo = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/version/check', { cache: 'no-store' })
      const data = await res.json()
      setVersionInfo(data)
    } catch (e) {
      console.error('Failed to check version:', e)
      setVersionInfo({
        currentVersion: VERSION,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseNotes: null,
        publishedAt: null,
        error: 'Failed to check for updates'
      })
    } finally {
      setLoading(false)
    }
  }

  const changelogEntries = Object.entries(CHANGELOG).sort((a, b) =>
    b[0].localeCompare(a[0], undefined, { numeric: true })
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderRadius: 3 }
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 2,
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <i className="ri-server-line" style={{ fontSize: 24, color: 'white' }} />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                {VERSION_NAME}
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.6 }}>
                {t('about.description')}
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={onClose} size="small">
            <i className="ri-close-line" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Version Info */}
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          p: 2,
          bgcolor: 'action.hover',
          borderRadius: 2,
          mb: 2
        }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
              {t('about.currentVersion')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                v{VERSION}
              </Typography>
              {loading && <CircularProgress size={16} />}
              {!loading && versionInfo?.updateAvailable && (
                <Chip
                  label={t('about.updateAvailable')}
                  color="warning"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
              {!loading && !versionInfo?.updateAvailable && !versionInfo?.error && (
                <Chip
                  label={t('about.upToDate')}
                  color="success"
                  size="small"
                  sx={{ fontWeight: 600 }}
                />
              )}
            </Box>
          </Box>

          {versionInfo?.updateAvailable && versionInfo?.latestVersion && (
            <Box sx={{ textAlign: 'right' }}>
              <Typography variant="caption" sx={{ opacity: 0.6, display: 'block' }}>
                {t('about.latestVersion')}
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 600, color: 'warning.main' }}>
                v{versionInfo.latestVersion}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Update Available Alert */}
        {versionInfo?.updateAvailable && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={
              versionInfo.releaseUrl && (
                <Button
                  component={Link}
                  href={versionInfo.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="small"
                  variant="contained"
                  sx={{ whiteSpace: 'nowrap' }}
                >
                  {t('about.viewRelease')}
                </Button>
              )
            }
          >
            <Typography variant="body2">
              {t('about.newVersionAvailable', { version: versionInfo.latestVersion })}
            </Typography>
            {versionInfo.publishedAt && (
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                {t('about.publishedOn', {
                  date: new Date(versionInfo.publishedAt).toLocaleDateString()
                })}
              </Typography>
            )}
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Changelog */}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {t('about.changelog')}
        </Typography>

        <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
          {changelogEntries.map(([version, info], idx) => (
            <Accordion
              key={version}
              defaultExpanded={idx === 0}
              disableGutters
              sx={{
                boxShadow: 'none',
                '&:before': { display: 'none' },
                bgcolor: 'transparent'
              }}
            >
              <AccordionSummary
                expandIcon={<i className="ri-arrow-down-s-line" />}
                sx={{
                  minHeight: 40,
                  px: 1,
                  '& .MuiAccordionSummary-content': { my: 0.5 }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={`v${version}`}
                    size="small"
                    color={idx === 0 ? 'primary' : 'default'}
                    sx={{ fontWeight: 600, fontSize: '0.7rem' }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    {info.date}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, px: 1 }}>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {info.changes.map((change, i) => (
                    <Typography
                      key={i}
                      component="li"
                      variant="body2"
                      sx={{ opacity: 0.8, mb: 0.5 }}
                    >
                      {change}
                    </Typography>
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Links */}
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-github-fill" style={{ fontSize: 18 }} />
            <Typography variant="caption">GitHub</Typography>
          </Link>
          <Link
            href={`${GITHUB_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-bug-line" style={{ fontSize: 18 }} />
            <Typography variant="caption">{t('about.reportBug')}</Typography>
          </Link>
          <Link
            href={`${GITHUB_URL}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              textDecoration: 'none',
              opacity: 0.7,
              '&:hover': { opacity: 1 }
            }}
          >
            <i className="ri-download-line" style={{ fontSize: 18 }} />
            <Typography variant="caption">{t('about.allReleases')}</Typography>
          </Link>
        </Box>

        {/* Copyright */}
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            textAlign: 'center',
            mt: 2,
            opacity: 0.5
          }}
        >
          {new Date().getFullYear()} {VERSION_NAME}. {t('about.copyright')}
        </Typography>
      </DialogContent>
    </Dialog>
  )
}
