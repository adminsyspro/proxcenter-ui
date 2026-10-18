import { afterEach, describe, expect, it } from 'vitest'

import { bulkBatchInventoryUrl, bulkBatchSourceLogo, OPEN_BULK_BATCH_EVENT, requestOpenBulkBatch, type OpenBulkBatchDetail } from './bulkBatchOpen'

// The node project has no DOM: a minimal window with an EventTarget is enough.
const g = globalThis as any
const hadWindow = 'window' in g
if (!hadWindow) g.window = new EventTarget()
const CE = g.CustomEvent ?? class<T> extends Event { detail: T; constructor(type: string, init: { detail: T }) { super(type); this.detail = init.detail } }
g.CustomEvent = CE

describe('bulkBatchOpen (roadmap#53)', () => {
  let remove: (() => void) | null = null
  afterEach(() => { remove?.(); remove = null })

  it('reports nobody took the request when no Inventory page listens', () => {
    expect(requestOpenBulkBatch('b1', 'vc1')).toBe(false)
  })

  it('reports a listener that took the request, with the batch and its source', () => {
    let seen: OpenBulkBatchDetail | null = null
    const onOpen = (e: Event) => { seen = (e as CustomEvent<OpenBulkBatchDetail>).detail; seen.handled = true }
    window.addEventListener(OPEN_BULK_BATCH_EVENT, onOpen)
    remove = () => window.removeEventListener(OPEN_BULK_BATCH_EVENT, onOpen)

    expect(requestOpenBulkBatch('b1', 'vc1')).toBe(true)
    expect(seen).toMatchObject({ batchId: 'b1', sourceConnectionId: 'vc1' })
  })

  it('points at the source host with the batch to open', () => {
    expect(bulkBatchInventoryUrl('b 1', 'vc&1')).toBe('/infrastructure/inventory?selectType=ext&selectId=vc%261&openBatch=b+1')
  })

  it('picks the source logo like the follow-up dialog', () => {
    expect(['xcpng', 'hyperv', 'nutanix', 'vcenter', 'vmware', null].map(bulkBatchSourceLogo)).toEqual([
      '/images/xcpng-logo.svg', '/images/hyperv-logo.svg', '/images/nutanix-logo.svg', '/images/esxi-logo.svg', '/images/esxi-logo.svg', '/images/esxi-logo.svg',
    ])
  })
})
