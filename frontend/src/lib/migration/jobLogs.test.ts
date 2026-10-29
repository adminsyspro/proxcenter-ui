import { describe, expect, it } from 'vitest'

import { mergeJobLogs, parseLogOffset, parseLogOffsets, sliceJobLogs } from './jobLogs'

describe('parseLogOffset / parseLogOffsets', () => {
  it('reads a count and ignores anything else', () => {
    expect(parseLogOffset('12')).toBe(12)
    expect(parseLogOffset('0')).toBe(0)
    expect(parseLogOffset(null)).toBeUndefined()
    for (const bad of ['', '-1', '1.5', 'abc', '1e3', '9999999999']) expect(parseLogOffset(bad), bad).toBeUndefined()
  })

  it('reads one count per job, and nothing when one of them is not a count', () => {
    expect(parseLogOffsets('3,0,12')).toEqual([3, 0, 12])
    expect(parseLogOffsets('3,,12')).toBeUndefined()
    expect(parseLogOffsets('3,x')).toBeUndefined()
    expect(parseLogOffsets('')).toBeUndefined()
    expect(parseLogOffsets(null)).toBeUndefined()
  })
})

describe('sliceJobLogs', () => {
  const log = ['a', 'b', 'c', 'd']

  it('sends the lines past the ones the caller has', () => {
    expect(sliceJobLogs(log, 3)).toEqual({ logs: ['d'], logOffset: 3, logCount: 4 })
    expect(sliceJobLogs(log, 4)).toEqual({ logs: [], logOffset: 4, logCount: 4 })
  })

  it('sends the whole log without a count, or with one past its end', () => {
    expect(sliceJobLogs(log)).toEqual({ logs: log, logOffset: 0, logCount: 4 })
    expect(sliceJobLogs(log, 9)).toEqual({ logs: log, logOffset: 0, logCount: 4 })
  })

  it('reads a missing log as empty', () => {
    expect(sliceJobLogs(null, 2)).toEqual({ logs: [], logOffset: 0, logCount: 0 })
  })
})

describe('mergeJobLogs', () => {
  const shown = { id: 'j1', logs: ['a', 'b'] }

  it('extends the kept log with a slice that starts where it ends', () => {
    expect(mergeJobLogs(shown, { id: 'j1', logs: ['c'], logOffset: 2 })).toEqual(['a', 'b', 'c'])
  })

  it('takes the whole log a read sent, and the log of another job', () => {
    expect(mergeJobLogs(shown, { id: 'j1', logs: ['x'], logOffset: 0 })).toEqual(['x'])
    expect(mergeJobLogs(shown, { id: 'j2', logs: ['y'], logOffset: 2 })).toEqual(['y'])
    expect(mergeJobLogs(null, { id: 'j1', logs: ['z'] })).toEqual(['z'])
  })

  it('keeps what it has when two reads crossed', () => {
    expect(mergeJobLogs(shown, { id: 'j1', logs: ['d'], logOffset: 3 })).toEqual(['a', 'b'])
  })

  it('reads a missing log as empty', () => {
    expect(mergeJobLogs({ id: 'j1' }, { id: 'j1', logs: null, logOffset: 0 })).toEqual([])
  })
})
