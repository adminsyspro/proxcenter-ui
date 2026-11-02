import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

/*
   The Ceph cockpit strings (`cephCockpit`), in the six served locales. de.json
   has no English fallback, so a key missing there shows its raw path. Later
   cockpit views add keys to the same namespace: the parity checks below walk
   the whole block, so they cover them without a list to maintain.
*/

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

type Tree = { [key: string]: string | Tree }

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') out[path] = value
    else Object.assign(out, flatten(value, path))
  }

  return out
}

/**
 * Argument names of an ICU message, nested ones included. A brace opened at an
 * even depth starts an argument (`{count, plural, ...}` or `{pool}`), one opened
 * at an odd depth starts a plural or select branch (`one {...}`).
 */
function icuArguments(message: string): string[] {
  const names = new Set<string>()
  let depth = 0

  for (let i = 0; i < message.length; i++) {
    const c = message[i]

    if (c === '{') {
      if (depth % 2 === 0) {
        const m = /^\s*([A-Za-z_]\w*)\s*[,}]/.exec(message.slice(i + 1))

        if (m) names.add(m[1])
      }
      depth++
    } else if (c === '}') {
      depth--
    }
  }

  return [...names].sort()
}

// Every argument gets 1, a valid number and string: plural, select and plain arguments all format.
const sampleValues = (message: string) => Object.fromEntries(icuArguments(message).map(name => [name, 1]))

const reference = flatten(en.cephCockpit as Tree)
const referenceKeys = Object.keys(reference).sort()

describe('icuArguments', () => {
  it('reads plain, plural and nested arguments, not branch texts', () => {
    expect(icuArguments('{count, plural, one {# OSD} other {# OSDs on {host}}}')).toEqual(['count', 'host'])
    expect(icuArguments('{named, select, yes {Pool {pool}} other {A pool}}')).toEqual(['named', 'pool'])
    expect(icuArguments('Updated {age} ago')).toEqual(['age'])
  })
})

describe('Ceph cockpit i18n parity across the 6 served locales', () => {
  it('names every string the shell uses', () => {
    for (const key of [
      'tabs.overview', 'tabs.osd', 'tabs.pools', 'tabs.crush', 'tabs.services', 'tabs.perf',
      'header.cluster', 'header.updated', 'header.range', 'header.refresh',
      'range.live', 'range.1h', 'range.24h', 'range.7d', 'range.30d',
      'rail.title', 'rail.errors', 'rail.warnings',
      'rail.flags', 'rail.flagsNone', 'rail.editFlags', 'rail.showDetail', 'rail.hideDetail',
      'stale.title', 'stale.body', 'empty.title', 'empty.description', 'ui.noData',
      'overview.tiles.raw', 'overview.tiles.iops', 'overview.tiles.throughput', 'overview.tiles.latency', 'overview.recovery.title',
      'overview.hostMap.title', 'overview.hostMap.open',
    ]) expect(referenceKeys).toContain(key)
  })

  it('names every string of the OSD tab, its sheet and its confirmation', () => {
    for (const key of [
      'osd.search', 'osd.filters.all', 'osd.filters.problem', 'osd.filters.down', 'osd.filters.out', 'osd.columns.fill', 'osd.group.osdCount',
      'osd.pager.range', 'osd.drawer.close', 'osd.drawer.prev', 'osd.drawer.next', 'osd.drawer.pools', 'osd.actions.deepScrub', 'osd.actions.outStarted',
      'osd.actions.stopStarted', 'osd.actions.restartStarted', 'osd.actions.failed', 'osd.confirm.title.out', 'osd.confirm.title.stop', 'osd.confirm.title.restart',
      'osd.confirm.body.out', 'osd.confirm.body.stop', 'osd.confirm.body.restart', 'osd.confirm.verdictOk', 'osd.confirm.verdictRefused', 'osd.confirm.verdictUnknown',
      'osd.confirm.typePrompt', 'osd.confirm.forceAction.out', 'osd.confirm.forceAction.stop', 'osd.confirm.forceAction.restart', 'osd.confirm.refusedNow',
    ]) expect(referenceKeys).toContain(key)
  })

  it('names every string of the Services tab', () => {
    const block = flatten(locales.en.cephCockpit as Tree)

    for (const key of ['services.title', 'services.select', 'services.noNode', 'services.group.mon', 'services.group.monMeta', 'services.group.mgrMeta', 'services.group.mgrMetaStopped', 'services.group.mdsMeta', 'services.col.actions', 'services.state.quorum', 'services.state.standbyReplay', 'services.state.stopped', 'services.role.leader', 'services.role.rank', 'services.empty.mds', 'services.versions.mixed', 'services.versions.item', 'services.create.button', 'services.create.noPermission']) {
      expect(block[key], key).toBeTypeOf('string')
    }
  })

  it('names every string of the Performance tab and keeps its arguments', () => {
    for (const key of [
      'perf.iops.title', 'perf.throughput.title', 'perf.recovery.title', 'perf.series.read', 'perf.series.write', 'perf.series.recovery', 'perf.series.unclean',
      'perf.live.waiting', 'perf.slowest.title', 'perf.slowest.subtitleLive', 'perf.slowest.subtitlePeriod', 'perf.slowest.all', 'perf.slowest.allPlain',
      'perf.slowest.mean', 'perf.slowest.empty', 'perf.slowest.open', 'perf.slowest.max', 'perf.slowest.value', 'perf.recovery.idle', 'perf.slowest.threshold', 'perf.slowest.openSlow', 'perf.slowest.slow', 'osd.glyph.upIn', 'osd.glyph.upOut', 'osd.glyph.down', 'osd.glyph.unknown',
    ]) expect(referenceKeys).toContain(key)

    for (const [locale, messages] of Object.entries(locales)) {
      const block = flatten(messages.cephCockpit as Tree)

      expect(icuArguments(block['perf.chartLabel']).sort(), locale).toEqual(['period', 'title'])
      expect(icuArguments(block['perf.slowest.all']), locale).toEqual(['count'])
      expect(icuArguments(block['perf.slowest.mean']), locale).toEqual(['ms'])
      expect(icuArguments(block['perf.slowest.open']), locale).toEqual(['id'])
      expect(icuArguments(block['perf.slowest.max']), locale).toEqual(['ms'])
      expect(icuArguments(block['perf.slowest.value']), locale).toEqual(['ms'])
      expect(icuArguments(block['perf.slowest.threshold']), locale).toEqual(['ms'])
    }
  })

  it('says why the exporter is not read, in every locale, with the port and the node as arguments', () => {
    for (const key of ['osd.activity.unreachable', 'osd.activity.unreachableRefused', 'osd.activity.unreachableTimeout', 'osd.activity.unreachableInvalid']) expect(referenceKeys).toContain(key)

    for (const [locale, messages] of Object.entries(locales)) {
      const block = flatten(messages.cephCockpit as Tree)

      expect(icuArguments(block['osd.activity.unreachable']), locale).toEqual(['port'])
      for (const key of ['unreachableRefused', 'unreachableTimeout', 'unreachableInvalid']) {
        expect(icuArguments(block[`osd.activity.${key}`]).sort(), `${locale}: ${key}`).toEqual(['node', 'port'])
      }
    }

    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      const block = flatten(locales[locale].cephCockpit as Tree)

      for (const key of ['unreachableRefused', 'unreachableTimeout', 'unreachableInvalid']) {
        expect(block[`osd.activity.${key}`], `${locale}: ${key}`).not.toBe(reference[`osd.activity.${key}`])
      }
    }
  })

  it('keeps the counts and names as arguments of the Services messages', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const block = flatten(messages.cephCockpit as Tree)

      expect(icuArguments(block['services.group.monMeta']).sort(), locale).toEqual(['inQuorum', 'total'])
      expect(icuArguments(block['services.group.mgrMeta']).sort(), locale).toEqual(['active', 'standby'])
      expect(icuArguments(block['services.group.mgrMetaStopped']).sort(), locale).toEqual(['active', 'standby', 'stopped'])
      expect(icuArguments(block['services.versions.item']).sort(), locale).toEqual(['count', 'version'])
      expect(icuArguments(block['services.noNode']), locale).toEqual(['host'])
      expect(icuArguments(block['services.select']), locale).toEqual(['service'])
      expect(icuArguments(block['services.role.rank']), locale).toEqual(['rank'])
    }
  })

  it('keeps the OSD name and the counts as arguments of the messages that confirm an action', () => {
    expect(icuArguments(reference['osd.confirm.typePrompt'])).toEqual(['name'])
    expect(icuArguments(reference['osd.confirm.verdictRefused'])).toEqual(['count'])
    expect(icuArguments(reference['osd.confirm.moved'])).toEqual(['count', 'size'])
    expect(icuArguments(reference['osd.pager.range'])).toEqual(['from', 'to', 'total'])
    expect(icuArguments(reference['perf.slowest.openSlow'])).toEqual(['id'])
    expect(icuArguments(reference['overview.hostMap.hiddenHealthy'])).toEqual(['count'])
    for (const action of ['out', 'stop', 'restart']) expect(icuArguments(reference[`osd.confirm.title.${action}`]), action).toEqual(['id'])
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of cephCockpit, filled, without an em-dash, same arguments, valid ICU`, () => {
      expect(messages?.cephCockpit, locale).toBeTypeOf('object')
      const block = flatten(messages.cephCockpit as Tree)

      expect(Object.keys(block).sort()).toEqual(referenceKeys)

      const errors: string[] = []
      const t = createTranslator({ locale, messages: { cephCockpit: messages.cephCockpit }, onError: e => errors.push(e.message) })

      for (const key of referenceKeys) {
        const value = block[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ${key} is empty`).not.toBe('')
        expect(value, `${locale}: ${key} has an em-dash`).not.toContain('\u2014')
        expect(icuArguments(value), `${locale}: ${key} arguments`).toEqual(icuArguments(reference[key]))
        const out = (t as unknown as (k: string, v: Record<string, number>) => string)(`cephCockpit.${key}`, sampleValues(value))

        expect(out, `${locale}: ${key} left a placeholder`).not.toMatch(/[{}]/)
      }
      expect(errors, locale).toEqual([])
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      const block = flatten(locales[locale].cephCockpit as Tree)

      for (const key of ['rail.title', 'stale.body', 'empty.description', 'overview.tiles.raw', 'overview.recovery.title', 'overview.hostMap.title', 'osd.confirm.typeIntro', 'osd.confirm.verdictOk', 'osd.drawer.pools', 'services.versions.mixed', 'services.create.noNode', 'services.empty.mds']) {
        expect(block[key], `${locale}: ${key}`).not.toBe(reference[key])
      }
    }
  })
})

describe('cephPage', () => {
  it('is gone from every locale, with the empty state strings only it read: the cockpit replaced the page', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      expect(messages.cephPage, locale).toBeUndefined()
      expect(messages.emptyState.noCeph, locale).toBeUndefined()
      expect(messages.emptyState.noCephDesc, locale).toBeUndefined()
    }
  })
})
