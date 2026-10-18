import { describe, expect, it } from 'vitest'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

import { rollingUpdateDetail, rollingUpdateNeutralDetail } from './rollingUpdateDetail'

// Minimal ICU-less translator: looks the key up and fills {placeholders}.
function translatorFor(messages: any) {
  return (key: string, values: Record<string, string | number> = {}) => {
    const template = key.split('.').reduce((node, k) => (node ? node[k] : undefined), messages)

    if (typeof template !== 'string') return key

    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
  }
}

const job = (status: string, currentNode = 'pve01', completedNodes = 0, totalNodes = 3) => ({
  type: 'rolling_update',
  status,
  metadata: { currentNode, completedNodes, totalNodes }
})

describe('rollingUpdateNeutralDetail', () => {
  it('names the node being updated while the run is open', () => {
    expect(rollingUpdateNeutralDetail({ status: 'running', current_node: 'pve01', completed_nodes: 0, total_nodes: 3 })).toBe('pve01 (0/3)')
    expect(rollingUpdateNeutralDetail({ status: 'paused', current_node: 'pve02', completed_nodes: 1, total_nodes: 3 })).toBe('pve02 (1/3)')
  })

  it('drops the node once the run is over, even when the record still carries it', () => {
    expect(rollingUpdateNeutralDetail({ status: 'failed', current_node: 'pve01', completed_nodes: 0, total_nodes: 3 })).toBe('0/3')
    expect(rollingUpdateNeutralDetail({ status: 'completed', current_node: '', completed_nodes: 3, total_nodes: 3 })).toBe('3/3')
  })

  it('carries no word of any language', () => {
    const line = rollingUpdateNeutralDetail({ status: 'running', current_node: 'pve01', completed_nodes: 0, total_nodes: 3 })

    expect(line).not.toMatch(/En cours|nœuds|nodes/)
  })

  it('survives a record with missing counters', () => {
    expect(rollingUpdateNeutralDetail(undefined)).toBe('0/0')
  })
})

describe('rollingUpdateDetail', () => {
  it('speaks the operator language instead of hardcoded French', () => {
    expect(rollingUpdateDetail(job('running'), translatorFor(en))).toBe('pve01: 0/3 nodes')
    expect(rollingUpdateDetail(job('running'), translatorFor(fr))).toBe('pve01 : 0/3 nœuds')
  })

  it('does not call a failed run in progress', () => {
    expect(rollingUpdateDetail(job('failed'), translatorFor(en))).toBe('0/3 nodes')
    expect(rollingUpdateDetail(job('completed', '', 3, 3), translatorFor(fr))).toBe('3/3 nœuds')
  })

  it('every served locale declares both lines with their placeholders', () => {
    for (const [locale, messages] of Object.entries({ en, fr, de, es, ko, 'zh-CN': zhCN })) {
      const t = translatorFor(messages)

      expect(t('jobsPage.rollingDetailCurrent', { node: 'pveX', done: 1, total: 3 }), locale).toMatch(/pveX.*1\/3/)
      expect(t('jobsPage.rollingDetailNodes', { done: 1, total: 3 }), locale).toMatch(/1\/3/)
    }
  })
})
