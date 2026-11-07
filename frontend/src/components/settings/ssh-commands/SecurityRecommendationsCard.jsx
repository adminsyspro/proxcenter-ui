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
  Checkbox,
  FormControlLabel,
  Stack,
  Typography
} from '@mui/material'

import { buildProfileSudoersTemplate, buildInstallCommand, profileRules, SETUP_BASH } from './sudoersTemplate'
import { SUDO_PROFILES, SUDO_PROFILE_I18N } from '@/lib/ssh/sudo'
import { copyToClipboard } from '@/lib/clipboard'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

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
  const { data } = useSWR('/api/v1/ssh/sudo-rules', fetcher)
  const [copied, setCopied] = useState('')
  const [profiles, setProfiles] = useState(['node-ops', 'site-recovery'])

  const rules = useMemo(() => data?.rules ?? [], [data])

  const templateBody = useMemo(
    () => (rules.length > 0 && profiles.length > 0 ? buildProfileSudoersTemplate(rules, SUDO_PROFILES.filter(p => profiles.includes(p))) : ''),
    [rules, profiles]
  )

  // Restricted profiles still holding a rule that amounts to root, with why.
  const rootEquivalent = useMemo(
    () => profiles.filter(p => p !== 'migrations').flatMap(p => profileRules(rules, p).filter(r => r.rootEquivalent)),
    [rules, profiles]
  )

  // Rules short of root that a stolen key could still misuse, with how.
  const sensitive = useMemo(
    () => profiles.flatMap(p => profileRules(rules, p).filter(r => r.sensitive)),
    [rules, profiles]
  )

  const toggleProfile = (p, on) => setProfiles(prev => (on ? [...new Set([...prev, p])] : prev.filter(x => x !== p)))

  const installCommand = useMemo(
    () => (templateBody ? buildInstallCommand(templateBody) : ''),
    [templateBody]
  )

  const copy = async (label, text) => {
    const ok = await copyToClipboard(text)
    setCopied(ok ? label : 'error')
    setTimeout(() => setCopied(''), 2000)
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

            <Stack direction='row' spacing={2} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              {SUDO_PROFILES.map(p => (
                <FormControlLabel
                  key={p}
                  control={<Checkbox size='small' checked={profiles.includes(p)} onChange={e => toggleProfile(p, e.target.checked)} />}
                  label={t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.label`)}
                />
              ))}
            </Stack>
            {SUDO_PROFILES.map(p => (
              <Typography key={p} variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                {t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.label`)} : {t(`settings.sshCommands.profiles.${SUDO_PROFILE_I18N[p]}.features`)}
              </Typography>
            ))}

            {profiles.includes('migrations') && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-alert-line' />}>
                {t('settings.sshCommands.recs.migrationsWarning')}
              </Alert>
            )}

            {rootEquivalent.length > 0 && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-alert-line' />}>
                {t('settings.sshCommands.recs.rootEquivalentWarning')}
                {rootEquivalent.map(r => (
                  <Typography key={r.id} variant='caption' sx={{ display: 'block' }}>
                    {r.path} : {r.why}
                  </Typography>
                ))}
              </Alert>
            )}

            {sensitive.length > 0 && (
              <Alert severity='info' sx={{ mt: 1.5 }} icon={<i className='ri-information-line' />}>
                {t('settings.sshCommands.recs.sensitiveWarning')}
                {sensitive.map(r => (
                  <Typography key={r.id} variant='caption' sx={{ display: 'block' }}>
                    {r.path} : {r.why}
                  </Typography>
                ))}
              </Alert>
            )}

            {profiles.includes('node-ops') && data?.sflowCollector && (
              <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1.5 }}>
                {t('settings.sshCommands.recs.sflowPinned', { target: data.sflowCollector })}
              </Typography>
            )}

            {data && data.orchestratorAvailable === false && (
              <Alert severity='info' sx={{ mt: 1.5 }} icon={<i className='ri-information-line' />}>
                {t('settings.sshCommands.recs.orchestratorRulesMissing')}
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
