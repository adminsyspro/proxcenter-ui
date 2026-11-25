/**
 * The firewall log collection of a cluster (micro-segmentation: the Proxmox
 * API or a forwarder on the nodes): every label exists in the six served
 * locales, with the same placeholders as the English one.
 */
import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

/** Every leaf under a key, as dotted paths. */
function leaves(node: unknown, prefix: string): string[] {
  if (typeof node === 'string') return [prefix]
  if (!node || typeof node !== 'object') return []

  return Object.entries(node).flatMap(([key, value]) => leaves(value, `${prefix}.${key}`))
}

/** The names of the placeholders of a message, plural arguments included. */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)[,}]/g)].map(m => m[1]))].sort()
}

const roots = [
  'settings.connectionTabLogs',
  'settings.logCollection',
  'settings.connectionUsage.titles.logForwarders',
  'settings.sshCommands.profiles.logForwarder',
  'microsegPilot.banner.logNodeForwarder',
  'microsegPilot.banner.logNodeIdle',
  'microsegPilot.banner.logNodeSilent',
  'microsegPilot.banner.logNodeSilentNever',
  'microsegPilot.banner.logNodeNotInstalled',
  'microsegPilot.banner.logNodeChanged',
  'microsegPilot.banner.logForwarder',
  'microsegPilot.banner.logForwarderTrouble',
  'microsegPilot.preflight.checks.log_collection',
  'microsegPilot.preflight.openLogSettings',
  'microsegPilot.observation.dialog.node',
]

const keys = roots.flatMap(root => leaves(get(en, root), root))

describe('Firewall log collection i18n parity across the 6 served locales', () => {
  it('has labels to compare', () => {
    expect(keys.length).toBeGreaterThan(100)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every label, with the placeholders of the English one`, () => {
      const missing = keys.filter(key => typeof get(messages, key) !== 'string' || get(messages, key) === '')

      expect(missing).toEqual([])
      const different = keys.filter(key => placeholders(get(messages, key) as string).join() !== placeholders(get(en, key) as string).join())

      expect(different).toEqual([])
    })

    it(`${locale} declares no label the English one does not`, () => {
      const extra = roots.flatMap(root => leaves(get(messages, root), root)).filter(key => !keys.includes(key))

      expect(extra).toEqual([])
    })

    it(`${locale} uses no em-dash`, () => {
      expect(keys.filter(key => (get(messages, key) as string).includes('—'))).toEqual([])
    })
  }

  it('says pare-feu, nœud and transfert in French, never firewall, node or forwarder', () => {
    const french = keys.map(key => [key, get(fr, key) as string] as const)
    const english = french.filter(([, value]) => /\bfirewall\b|\bforwarder\b|\bnodes?\b/i.test(value.replace(/\{node\}|\{nodes\}/g, ''))).map(([key]) => key)

    expect(english).toEqual([])
  })
})
