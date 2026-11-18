import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OPEN_TASK_VIEWER_EVENT, openTaskViewer, taskViewerRequest } from './taskViewer'

const UPID = 'UPID:pve3:0007AF11:06604734:6AFD3A3C:qmigrate:116:root@pam!root:'

describe('taskViewerRequest', () => {
  it('reads the node, type, guest and user from the UPID', () => {
    expect(taskViewerRequest({ upid: UPID, connectionId: 'c1', description: 'web: Migrate' })).toEqual({
      upid: UPID,
      connectionId: 'c1',
      node: 'pve3',
      type: 'qmigrate',
      entity: '116',
      user: 'root@pam!root',
      description: 'web: Migrate',
    })
  })

  it('refuses what is not a UPID, or a task without its connection', () => {
    expect(taskViewerRequest({ upid: null, connectionId: 'c1' })).toBeNull()
    expect(taskViewerRequest({ upid: 'OK', connectionId: 'c1' })).toBeNull()
    expect(taskViewerRequest({ upid: UPID, connectionId: '' })).toBeNull()
  })
})

describe('openTaskViewer', () => {
  // Node test project: a bare EventTarget stands in for the browser window.
  beforeEach(() => { vi.stubGlobal('window', new EventTarget()) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('announces the task to the taskbar', () => {
    const seen = vi.fn()
    window.addEventListener(OPEN_TASK_VIEWER_EVENT, seen)

    expect(openTaskViewer({ upid: UPID, connectionId: 'c1' })).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
    expect((seen.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ upid: UPID, node: 'pve3', connectionId: 'c1' })
    window.removeEventListener(OPEN_TASK_VIEWER_EVENT, seen)
  })

  it('stays silent when no task was started', () => {
    const seen = vi.fn()
    window.addEventListener(OPEN_TASK_VIEWER_EVENT, seen)

    expect(openTaskViewer({ upid: null, connectionId: 'c1' })).toBe(false)
    expect(seen).not.toHaveBeenCalled()
    window.removeEventListener(OPEN_TASK_VIEWER_EVENT, seen)
  })
})
