import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import { drsReasonText, pinnedReasonText } from './drsReason'

const LOCALES = { en, fr, de, es, ko, 'zh-CN': zhCN } as Record<string, any>

const translator = (locale: string) => createTranslator({ locale, messages: LOCALES[locale] }) as unknown as
  (key: string, values?: Record<string, string | number>) => string

describe('drsReasonText', () => {
  it('translates a recommendation reason from its code, numbers in the user locale', () => {
    const rec = {
      reason: 'Homogenization: reduce load from 69.7% to 52.4%',
      reason_code: 'homogenization',
      reason_params: { from: '69.7', to: '52.4' },
    }

    expect(drsReasonText(rec, translator('fr'))).toBe('Homogénéisation : charge réduite de 69,7 % à 52,4 %')
    expect(drsReasonText(rec, translator('en'))).toBe('Homogenization: reduce load from 69.7% to 52.4%')
  })

  it('names the rule of an affinity reason', () => {
    const rec = { reason: 'x', reason_code: 'nodeAffinity', reason_params: { rule: 'db-on-pve1', node: 'pve1' } }

    expect(drsReasonText(rec, translator('fr'))).toBe('Règle d\'affinité de nœud « db-on-pve1 » : la VM doit tourner sur pve1')
  })

  it('translates the English text of a history row written before the codes', () => {
    const t = translator('fr')

    expect(drsReasonText({ reason: 'Load balancing optimization' }, t)).toBe('Optimisation de l\'équilibrage de charge')
    expect(drsReasonText({ reason: 'Homogenization: reduce load from 69.7% to 52.4%' }, t)).toBe('Homogénéisation : charge réduite de 69,7 % à 52,4 %')
    expect(drsReasonText({ reason: 'Node affinity rule \'db\': VM should run on pve1' }, t)).toBe('Règle d\'affinité de nœud « db » : la VM doit tourner sur pve1')
    expect(drsReasonText({ reason: 'Anti-affinity rule \'web\': VMs should be on different nodes' }, t)).toBe('Règle d\'anti-affinité « web » : les VM doivent être sur des nœuds différents')
  })

  it('falls back to the English text for an unknown reason or code', () => {
    const t = translator('fr')

    expect(drsReasonText({ reason: 'Load balancing: memory 71% on pve1-dr' }, t)).toBe('Load balancing: memory 71% on pve1-dr')
    expect(drsReasonText({ reason: 'Something new', reason_code: 'futureCode' }, t)).toBe('Something new')
    expect(drsReasonText({}, t)).toBe('')
  })

  it('renders every code in every locale', () => {
    const params = { from: '70', to: '50', rule: 'r', node: 'n', resource: 'vmbr1' }

    for (const locale of Object.keys(LOCALES)) {
      const t = translator(locale)

      for (const code of Object.keys(en.drsPage.reasons)) {
        const text = drsReasonText({ reason: 'fallback', reason_code: code, reason_params: params }, t)

        expect(text, `${locale} ${code}`).not.toMatch(/fallback|drsPage\.|\{/)
      }
      for (const code of Object.keys(en.drsPage.pinnedReasons)) {
        const text = pinnedReasonText({ reason: 'fallback', reason_code: code, reason_params: params }, t)

        expect(text, `${locale} ${code}`).not.toMatch(/fallback|drsPage\.|\{/)
      }
    }
  })
})

describe('pinnedReasonText', () => {
  it('names the missing network or storage and the node', () => {
    const guest = { reason: 'network "vdmz" unavailable on node "n2": x', reason_code: 'network', reason_params: { resource: 'vdmz', node: 'n2' } }

    expect(pinnedReasonText(guest, translator('fr'))).toBe('Réseau vdmz indisponible sur le nœud n2')
    expect(pinnedReasonText({ reason_code: 'noTarget' }, translator('en'))).toBe('No other node carries this guest\'s network or storage')
  })
})
