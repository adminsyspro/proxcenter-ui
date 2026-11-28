import { describe, it, expect } from 'vitest'
import { nextMinor, upgradeRefusal } from './upgrade'

describe('upgradeRefusal', () => {
  it.each([
    ['v1.36.6+k3s1', 'v1.37.2+k3s1', null],
    ['v1.36.6+k3s1', 'v1.36.7+k3s1', null],
    ['v1.36.6+k3s1', 'v1.36.6+k3s2', null],
    ['v1.36.6+rke2r2', 'v1.37.2+rke2r1', null],
    ['v1.36.6+k3s1', 'v1.36.6+k3s1', 'not_newer'],
    ['v1.36.6+k3s1', 'v1.35.9+k3s3', 'not_newer'],
    ['v1.36.6+k3s2', 'v1.36.6+k3s1', 'not_newer'],
    ['v1.36.6+k3s1', 'v1.38.0+k3s1', 'skips_minor'],
    ['v1.36.6+k3s1', 'v1.37.2+rke2r1', 'format'],
    ['v1.36.6+k3s1', '1.37.2', 'format'],
    ['v1.36.6+k3s1', 'v1.37.2+k3s1 ', 'format'],
    ['1.34.9', 'v1.35.0+k3s1', 'unknown_current'],
  ])('%s -> %s', (current, target, want) => {
    expect(upgradeRefusal(current, target)).toBe(want)
  })
})

describe('nextMinor', () => {
  it('names the next minor line', () => {
    expect(nextMinor('v1.36.6+k3s1')).toBe('v1.37')
    expect(nextMinor('latest')).toBeNull()
  })
})

const k3sReleases = ['v1.35.9+k3s1', 'v1.36.5+k3s1', 'v1.36.6+k3s1', 'v1.36.7+k3s1', 'v1.37.0+k3s1', 'v1.37.2+k3s1', 'v1.37.1+k3s1', 'v1.38.1+k3s1', 'v1.38.0+k3s1', 'v1.37.2+rke2r1']

describe('upgradeCandidates', () => {
  it('lists the newer patches and the next minor line, newest first', async () => {
    const { upgradeCandidates } = await import('./upgrade')
    expect(upgradeCandidates('v1.36.6+k3s1', k3sReleases)).toEqual(['v1.37.2+k3s1', 'v1.37.1+k3s1', 'v1.37.0+k3s1', 'v1.36.7+k3s1'])
    expect(upgradeCandidates('v1.38.1+k3s1', k3sReleases)).toEqual([])
  })
})

describe('upgradePath', () => {
  it('names one step per minor line when the newest is further than one', async () => {
    const { upgradePath } = await import('./upgrade')
    expect(upgradePath('v1.36.6+k3s1', k3sReleases)).toEqual(['v1.37.2+k3s1', 'v1.38.1+k3s1'])
    expect(upgradePath('v1.37.0+k3s1', k3sReleases)).toEqual([])
    expect(upgradePath('latest', k3sReleases)).toEqual([])
  })
})
