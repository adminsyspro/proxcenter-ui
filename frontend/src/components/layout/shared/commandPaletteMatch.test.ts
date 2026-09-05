import { describe, expect, it } from 'vitest'

import {
  descriptionSnippet,
  fuzzyMatch,
  macSearchKey,
  matchAddresses,
  matchDescription,
  matchGuest,
  matchNode,
} from './commandPaletteMatch'

describe('fuzzyMatch', () => {
  it('scores an exact substring above a subsequence', () => {
    const substring = fuzzyMatch('web', 'my web server')
    const subsequence = fuzzyMatch('web', 'work edge box')

    expect(substring.match).toBe(true)
    expect(subsequence.match).toBe(true)
    expect(substring.score).toBeGreaterThan(subsequence.score)
  })

  it('returns a non-match when the characters are absent or out of order', () => {
    expect(fuzzyMatch('web', 'database')).toEqual({ match: false, score: 0 })
  })
})

describe('macSearchKey', () => {
  it('normalizes common MAC query separators and casing', () => {
    expect(macSearchKey('BC:24:11')).toBe('bc2411')
    expect(macSearchKey('bc-24-11')).toBe('bc2411')
    expect(macSearchKey('bc24.11')).toBe('bc2411')
  })
})

describe('matchAddresses', () => {
  const ips = ['10.42.0.151']
  const macs = ['BC:24:11:C0:F0:6F']

  it('matches an IP substring and returns the full IP as the hit', () => {
    expect(matchAddresses('10.42', ips, macs)).toMatchObject({
      match: true, via: 'ip', hit: '10.42.0.151',
    })
  })

  it('does not treat ordinary words as addresses', () => {
    expect(matchAddresses('web', ips, macs)).toEqual({ match: false, score: 0 })
  })

  it('requires at least four normalized hex characters for a MAC match', () => {
    expect(matchAddresses('bc24', ips, macs)).toMatchObject({
      match: true, via: 'mac', hit: 'BC:24:11:C0:F0:6F',
    })
    expect(matchAddresses('bc2', ips, macs)).toEqual({ match: false, score: 0 })
  })

  it('matches a MAC fragment containing separators', () => {
    expect(matchAddresses('bc:24:11:c0', ips, macs)).toMatchObject({
      match: true, via: 'mac', hit: 'BC:24:11:C0:F0:6F',
    })
  })

  it('scores address prefix hits above mid-string hits', () => {
    const prefix = matchAddresses('10', ['10.42.0.151'])
    const middle = matchAddresses('10', ['210.42.0.15'])

    expect(prefix.score).toBeGreaterThan(middle.score)
  })
})

describe('descriptionSnippet', () => {
  it('returns the whole string without ellipses when it fits', () => {
    expect(descriptionSnippet('short web note', 6, 3, 60)).toBe('short web note')
  })
})

describe('matchDescription', () => {
  it('does not match queries shorter than three characters', () => {
    expect(matchDescription('we', 'web front server')).toEqual({ match: false, score: 0 })
  })

  it('matches case-insensitively via description', () => {
    expect(matchDescription('WEB', 'Primary web front server')).toMatchObject({
      match: true, via: 'description', hit: 'Primary web front server',
    })
  })

  it('flattens multiline text and returns a truncated excerpt around the hit', () => {
    const description = `${'prefix '.repeat(12)}important web service\n${'suffix '.repeat(12)}`
    const result = matchDescription('web', description)

    expect(result).toMatchObject({ match: true, via: 'description' })
    expect(result.hit).toContain('web')
    expect(result.hit).not.toContain('\n')
    expect(result.hit).toContain('…')
  })
})

describe('matchGuest', () => {
  it('labels a fuzzy name hit', () => {
    expect(matchGuest('d13', { name: 'Debian 13', vmid: 100 })).toMatchObject({ match: true, via: 'name' })
  })

  it('prefers an address hit over a fuzzy name hit', () => {
    const result = matchGuest('10.42', {
      name: 'rack 1 unit 0 dot . zone 4 host 2',
      vmid: 100,
      ips: ['10.42.0.151'],
    })

    expect(result).toMatchObject({ match: true, via: 'ip', hit: '10.42.0.151' })
  })

  it('labels a vmid hit', () => {
    expect(matchGuest('100', { name: 'Debian', vmid: 100 })).toMatchObject({ match: true, via: 'vmid' })
  })

  it('handles nullable optional identity fields', () => {
    expect(matchGuest('web', {
      name: null,
      vmid: null,
      ips: null,
      macs: undefined,
      description: null,
    })).toEqual({ match: false, score: 0 })
  })
})

describe('matchNode', () => {
  const node = {
    node: 'pve-alpha',
    connName: 'Paris Lab',
    ip: '192.168.1.2',
    ips: ['10.20.0.2'],
  }

  it('matches the node name and connection name', () => {
    expect(matchNode('alpha', node)).toMatchObject({ match: true, via: 'name' })
    expect(matchNode('paris', node)).toMatchObject({ match: true, via: 'connection' })
  })

  it('matches both the management IP and any additional node IP', () => {
    expect(matchNode('192.168', node)).toMatchObject({ match: true, via: 'ip', hit: '192.168.1.2' })
    expect(matchNode('10.20', node)).toMatchObject({ match: true, via: 'ip', hit: '10.20.0.2' })
  })
})
