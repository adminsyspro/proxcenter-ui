/**
 * The Micro-segmentation tab (microsegPilot namespace) must exist in the 6
 * served locales, with the same keys and the same ICU placeholders, and every
 * error code the API client can raise must have a message.
 */

import { describe, expect, it } from 'vitest'

import { KNOWN_CODES } from '@/lib/microseg/api'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Every code the client maps to a message of its own, and the fallback.
const ERROR_CODES = [...KNOWN_CODES, 'generic']

function flatten(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node }
  if (!node || typeof node !== 'object') return {}
  return Object.entries(node).reduce<Record<string, string>>(
    (acc, [key, value]) => Object.assign(acc, flatten(value, prefix ? `${prefix}.${key}` : key)),
    {},
  )
}

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map(m => m[1]))].sort().join(',')

const reference = flatten(en.microsegPilot)

describe('microsegPilot i18n parity across the 6 served locales', () => {
  it('declares the namespace in English', () => {
    expect(Object.keys(reference).length).toBeGreaterThan(40)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    const flat = flatten(messages.microsegPilot)

    it(`${locale} has every English key and no other`, () => {
      expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
    })

    it(`${locale} has no empty string and the same placeholders as English`, () => {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), `${locale}: ${key}`).not.toBe('')
        expect(placeholders(value), `${locale}: ${key}`).toBe(placeholders(reference[key]))
      }
    })

    it(`${locale} has a message for every error code`, () => {
      for (const code of ERROR_CODES) {
        expect(flat[`errors.${code}`], `${locale}: errors.${code}`).toBeTypeOf('string')
      }
    })
  }

  it('is translated, not copied from English', () => {
    // Proper nouns and words that are the same in a language (Plan, Zones, Type, Page, Observation, Direction, Destination...) may coincide:
    // each locale has its own ceiling, set just above what it legitimately shares.
    // de shares 11 words with English today (Name, Zone, Status, Plan, Engine...), at its ceiling: room for two more.
    const ceilings: Record<string, number> = { fr: 21, de: 13, es: 5, ko: 3, 'zh-CN': 3 }
    for (const [locale, ceiling] of Object.entries(ceilings)) {
      const flat = flatten(locales[locale].microsegPilot)
      const same = Object.keys(reference).filter(key => flat[key] === reference[key])
      expect(same.length, `${locale}: ${same.join(', ')}`).toBeLessThanOrEqual(ceiling)
    }
  })

  it('words the state rows, the Outbound section and the tooltips of the zone dialog as agreed in French and English', () => {
    const wanted: Record<string, Record<string, string>> = {
      fr: {
        egressSection: 'Sortie',
        inboundSection: 'Entrée',
        'inboundStates.disabled': 'Désactivée',
        'inboundStates.observe': 'Observation',
        'inboundStates.enforce': 'Blocage',
        'outboundStates.off': 'Non contrôlée',
        'outboundStates.observe': 'Observation',
        'outboundStates.enforce': 'Blocage',
        'tips.isolate': 'Les VM de cette zone ne se joignent entre elles que par un flux déclaré. Décochée, elles communiquent librement.',
        'tips.inbound.disabled': 'La zone n\'est pas appliquée sur Proxmox.',
        'tips.inbound.observe': 'Rien n\'est bloqué : le trafic entrant hors politique est journalisé et proposé en suggestions.',
        'tips.inbound.enforce': 'Seuls les flux de la politique entrent ; le reste est bloqué et visible dans Bloqués.',
        'tips.outbound.off': 'Les VM de la zone sortent librement, rien n\'est journalisé.',
        'tips.outbound.observe': 'Rien n\'est bloqué : les sorties hors politique sont journalisées et proposées en suggestions.',
        'tips.outbound.enforce': 'Seules les sorties autorisées par un flux passent ; le reste est bloqué et visible dans Bloqués.',
        'tips.local': 'Filtre les sorties vers les sous-réseaux des VM en zone, VM sans zone comprises. Internet reste ouvert.',
        'tips.all': 'Filtre toute sortie, Internet compris : seuls les flux de la politique passent.',
        egressFilter: 'Filtrer la sortie vers :',
        egressLocal: 'Le réseau local',
        egressAll: 'Le réseau local et Internet',
        egressAllWarning: 'Filtrage par adresse IP seulement : un service derrière un nom de domaine peut changer d\'adresse.',
      },
      en: {
        egressSection: 'Outbound',
        inboundSection: 'Inbound',
        'inboundStates.disabled': 'Disabled',
        'inboundStates.observe': 'Observing',
        'inboundStates.enforce': 'Blocking',
        'outboundStates.off': 'Not controlled',
        'outboundStates.observe': 'Observing',
        'outboundStates.enforce': 'Blocking',
        egressFilter: 'Filter outbound traffic to:',
        egressLocal: 'Local network',
        egressAll: 'Local network and Internet',
        egressAllWarning: 'IP filtering only: a service behind a domain name can change address.',
      },
    }
    for (const [locale, keys] of Object.entries(wanted)) {
      const flat = flatten(locales[locale].microsegPilot)
      for (const [key, text] of Object.entries(keys)) expect(flat[`policy.zoneDialog.${key}`], `${locale}: ${key}`).toBe(text)
    }
  })
})
