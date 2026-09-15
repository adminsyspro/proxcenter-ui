'use client'

// In-product guide of the vDC screen: what a vDC is, how to create one, the
// network model, how to stretch a network across clusters, what to do when
// something is off, and a glossary. Static text from the message catalogue,
// rendered as accordions so an operator opens only the part they need.
// Rendered by VdcTab as its fourth tab.

import { Accordion, AccordionDetails, AccordionSummary, Card, CardContent, Stack, Typography } from '@mui/material'

import { useTranslations } from 'next-intl'

import HelpDiagram, { type HelpDiagramKind } from './VdcHelpDiagrams'

const SECTIONS: ReadonlyArray<{ key: string; icon: string; items: number; numbered: boolean; diagram?: HelpDiagramKind }> = [
  { key: 'Create', icon: 'ri-add-circle-line', items: 5, numbered: true, diagram: 'vdc' },
  { key: 'Network', icon: 'ri-router-line', items: 5, numbered: false, diagram: 'network' },
  { key: 'Stretch', icon: 'ri-git-branch-line', items: 5, numbered: true, diagram: 'stretch' },
  { key: 'Troubleshoot', icon: 'ri-tools-line', items: 6, numbered: false },
  { key: 'Glossary', icon: 'ri-book-open-line', items: 6, numbered: false },
]

export default function VdcHelpSection() {
  const t = useTranslations()

  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <i className="ri-question-line" style={{ opacity: 0.6, fontSize: 18 }} />
          <Typography variant="h6">{t('vdc.helpTitle')}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('vdc.helpIntro')}
        </Typography>

        {SECTIONS.map((section, index) => (
          <Accordion
            key={section.key}
            defaultExpanded={index === 0}
            disableGutters
            variant="outlined"
            sx={{ '&:before': { display: 'none' }, '&:not(:last-of-type)': { borderBottom: 0 } }}
          >
            <AccordionSummary expandIcon={<i className="ri-arrow-down-s-line" />}>
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className={section.icon} />
                {t(`vdc.help${section.key}Title`)}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ pt: 0 }}>
              {section.diagram && <HelpDiagram kind={section.diagram} />}
              <Stack component={section.numbered ? 'ol' : 'ul'} spacing={1} sx={{ m: 0, pl: 2.5 }}>
                {Array.from({ length: section.items }, (_, k) => (
                  <Typography key={k} component="li" variant="body2">
                    {t(`vdc.help${section.key}Item${k + 1}`)}
                  </Typography>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </CardContent>
    </Card>
  )
}
