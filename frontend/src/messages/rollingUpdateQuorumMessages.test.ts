import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The codes the orchestrator sends and the wizard translates. A code the
// wizard claims to know but a locale does not declare renders as the key
// path, since the catalogues have no English fallback.
const FINDING_PLACEHOLDERS: Record<string, string[]> = {
  quorum_would_be_lost: ['{remaining}', '{online}', '{required}'],
  not_enough_healthy_nodes: ['{healthy}', '{required}', '{remaining}'],
  cluster_unhealthy: [],
  qdevice_offline: [],
}

describe('rolling update quorum pre-flight i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [code, placeholders] of Object.entries(FINDING_PLACEHOLDERS)) {
      it(`${locale} declares updates.finding.${code} with its values`, () => {
        const value = messages?.updates?.finding?.[code]

        expect(value, `${locale}: finding.${code}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: finding.${code} must not be empty`).toBeGreaterThan(0)
        for (const placeholder of placeholders) {
          expect(value, `${locale}: finding.${code} needs ${placeholder}`).toContain(placeholder)
        }
      })
    }

    for (const key of ['healthVotes', 'healthVotesQDevice']) {
      it(`${locale} declares updates.${key} with its {required} placeholder`, () => {
        const value = messages?.updates?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value, `${locale}: {required} placeholder`).toContain('{required}')
      })
    }

    // The tile only earns its place if it names the QDevice, which is what
    // the operator has to recognise to trust the verdict.
    it(`${locale} names the QDevice in updates.healthVotesQDevice`, () => {
      expect(messages?.updates?.healthVotesQDevice as string).toContain('QDevice')
    })

    // The default moved from 2 to 1 when quorum took over the safety call,
    // and the hint is where an operator reads it.
    it(`${locale} does not still advertise a default of 2 healthy nodes`, () => {
      const hint = messages?.updates?.minHealthyNodesHint as string

      expect(hint, `${locale}: minHealthyNodesHint`).toBeTypeOf('string')
      expect(hint, `${locale}: the default is 1`).not.toMatch(/\b2\b/)
    })

    it(`${locale} translates the minimum healthy nodes label`, () => {
      const label = messages?.updates?.minHealthyNodes as string

      expect(label, `${locale}: minHealthyNodes`).toBeTypeOf('string')
      // "minimal healthy Nodes" shipped in de.json: half the label was left
      // in English on the very field operators were sent to.
      if (locale !== 'en') {
        expect(label, `${locale}: must not be left in English`).not.toContain('healthy')
      }
    })
  }
})
