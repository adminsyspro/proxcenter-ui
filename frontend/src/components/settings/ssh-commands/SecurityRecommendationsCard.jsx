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
  Button,
  Card,
  CardContent,
  Stack,
  Typography
} from '@mui/material'

import { buildSudoersTemplate, buildInstallCommand } from './sudoersTemplate'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

const SETUP_BASH = `# Run on every PVE node (adapt the public key to yours)
adduser --system --shell /bin/bash --group proxcenter
mkdir -p /home/proxcenter/.ssh
echo "ssh-ed25519 AAAA... proxcenter@your-workstation" >> /home/proxcenter/.ssh/authorized_keys
chown -R proxcenter:proxcenter /home/proxcenter/.ssh
chmod 700 /home/proxcenter/.ssh
chmod 600 /home/proxcenter/.ssh/authorized_keys
# Needed for the Network Flows feature (direct OVS socket access)
usermod -aG openvswitch proxcenter
# IMPORTANT: reconnect the SSH session after this for the new group to take effect`

function CodeBlock({ text, onCopy }) {
  return (
    <Box sx={{ position: 'relative', mt: 1 }}>
      <Box
        component='pre'
        sx={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '0.8rem',
          backgroundColor: 'action.hover',
          p: 1.5,
          borderRadius: 1,
          overflow: 'auto',
          maxHeight: 280,
          m: 0
        }}
      >
        {text}
      </Box>
      <Button
        size='small'
        variant='outlined'
        onClick={onCopy}
        sx={{ position: 'absolute', top: 8, right: 8 }}
        startIcon={<i className='ri-file-copy-line' />}
      >
        Copy
      </Button>
    </Box>
  )
}

export default function SecurityRecommendationsCard() {
  const t = useTranslations()
  const { data } = useSWR('/api/v1/ssh/allowlist', fetcher)
  const [copied, setCopied] = useState('')

  const { body: templateBody, shellWrappedCount } = useMemo(() => {
    if (!data?.categories) return { body: '', shellWrappedCount: 0 }
    return buildSudoersTemplate(data.categories)
  }, [data])

  const installCommand = useMemo(
    () => (templateBody ? buildInstallCommand(templateBody) : ''),
    [templateBody]
  )

  const copy = async (label, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      setCopied('error')
      setTimeout(() => setCopied(''), 2000)
    }
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshCommands.recs.heading')}
        </Typography>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('settings.sshCommands.recs.intro')}
        </Typography>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              1. {t('settings.sshCommands.recs.step1Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step1Hint')}
            </Typography>
            <CodeBlock text={SETUP_BASH} onCopy={() => copy('setup', SETUP_BASH)} />
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              2. {t('settings.sshCommands.recs.step2Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step2Hint')}
            </Typography>

            {shellWrappedCount > 0 && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-alert-line' />}>
                {t('settings.sshCommands.recs.shellWrapWarning')}
              </Alert>
            )}

            <Stack direction='row' spacing={1} sx={{ mt: 1.5, mb: 1 }}>
              <Button
                variant='contained'
                size='small'
                startIcon={<i className='ri-file-copy-line' />}
                onClick={() => copy('template', templateBody)}
                disabled={!templateBody}
              >
                {t('settings.sshCommands.recs.copyTemplate')}
              </Button>
              <Button
                variant='outlined'
                size='small'
                startIcon={<i className='ri-terminal-line' />}
                onClick={() => copy('install', installCommand)}
                disabled={!installCommand}
              >
                {t('settings.sshCommands.recs.copyInstall')}
              </Button>
              {copied && copied !== 'error' && (
                <Typography variant='caption' color='success.main' sx={{ alignSelf: 'center' }}>
                  {t('settings.sshCommands.recs.copied')}
                </Typography>
              )}
              {copied === 'error' && (
                <Typography variant='caption' color='error.main' sx={{ alignSelf: 'center' }}>
                  {t('settings.sshCommands.errors.clipboardFailed')}
                </Typography>
              )}
            </Stack>

            {templateBody && <CodeBlock text={templateBody} onCopy={() => copy('template', templateBody)} />}
          </AccordionDetails>
        </Accordion>

        <Accordion disableGutters variant='outlined' sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
            <Typography variant='body1' fontWeight={600}>
              3. {t('settings.sshCommands.recs.step3Title')}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant='body2' color='text.secondary'>
              {t('settings.sshCommands.recs.step3Hint')}
            </Typography>
          </AccordionDetails>
        </Accordion>

        <Alert severity='info' sx={{ mt: 2 }} icon={<i className='ri-information-line' />}>
          {t('settings.sshCommands.recs.disclaimer')}
        </Alert>
      </CardContent>
    </Card>
  )
}
