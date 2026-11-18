import { describe, expect, it } from 'vitest'

import { getLogColor, getLogType, splitLogTimestamp, taskLogFileName } from './TaskDetailDialog'

describe('task log lines', () => {
  it('classes a line by what it reports', () => {
    expect(getLogType('TASK ERROR: migration aborted')).toBe('error')
    expect(getLogType('2026-11-18 06:39:22 command failed')).toBe('error')
    expect(getLogType('WARN: no quorum')).toBe('warning')
    expect(getLogType('TASK OK')).toBe('success')
    expect(getLogType('migration finished successfully (duration 00:00:11)')).toBe('success')
    expect(getLogType('migration active, transferred 139.7 MiB of 2.0 GiB VM-state')).toBe('transfer')
    expect(getLogType('start remote tunnel')).toBe('info')
  })

  it('keeps plain lines neutral and gives each class its own colour', () => {
    const colours = ['error', 'warning', 'success', 'transfer', 'info'].map(getLogColor)

    expect(new Set(colours).size).toBe(5)
    expect(getLogColor('unknown')).toBe(getLogColor('info'))
  })

  it('splits the leading timestamp off, and only when there is one', () => {
    expect(splitLogTimestamp('2026-11-18 06:39:21 start remote tunnel')).toEqual({ time: '2026-11-18 06:39:21', message: 'start remote tunnel' })
    expect(splitLogTimestamp('TASK OK')).toEqual({ time: null, message: 'TASK OK' })
  })

  it('names the exported file after the task, the guest and the start time', () => {
    expect(taskLogFileName({ id: 'UPID:pve3:0007AF11:06604734:6AFD3A3C:qmigrate:116:root@pam!root:', type: 'qmigrate' }))
      .toBe('task-qmigrate-116-6AFD3A3C.log')
    expect(taskLogFileName({ id: 'job-1', type: 'weird/type' })).toBe('task-weird_type.log')
    expect(taskLogFileName(null)).toBe('task.log')
  })
})
