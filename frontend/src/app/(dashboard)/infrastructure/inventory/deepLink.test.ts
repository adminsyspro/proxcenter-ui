import { describe, expect, it } from 'vitest'

import { findDeepLinkedVm, hasDeepLinkSelection } from './deepLink'

const params = (search: string) => new URLSearchParams(search)

// The inventory page has two effects writing the same selection: the RBAC
// profile, which falls back to the tree root, and the deep-link. When the RBAC
// context has to load — a cold page load, which is exactly how a shared or
// bookmarked link arrives — it settles last and wipes the deep-link. This
// predicate is what tells the RBAC effect to stand down.
describe('hasDeepLinkSelection', () => {
  it('sees a node deep-link', () => {
    expect(hasDeepLinkSelection(params('selectType=node&selectId=conn1:pve1'))).toBe(true)
  })

  it('sees the cluster and pbs deep-links, which select the same way', () => {
    expect(hasDeepLinkSelection(params('selectType=cluster&selectId=conn1'))).toBe(true)
    expect(hasDeepLinkSelection(params('selectType=pbs&selectId=pbs1'))).toBe(true)
  })

  it('sees nothing on a plain inventory URL', () => {
    expect(hasDeepLinkSelection(params(''))).toBe(false)
  })

  it('ignores a half-written link, which selects nothing either', () => {
    expect(hasDeepLinkSelection(params('selectType=node'))).toBe(false)
    expect(hasDeepLinkSelection(params('selectId=conn1:pve1'))).toBe(false)
  })

  it('ignores an unknown selectType rather than blocking the default view', () => {
    expect(hasDeepLinkSelection(params('selectType=banana&selectId=conn1'))).toBe(false)
  })

  it('leaves the VM deep-link alone: it resolves from the loaded VM list, and', () => {
    // when it finds nothing the tree root is the right place to land.
    expect(hasDeepLinkSelection(params('vmid=100&connId=conn1'))).toBe(false)
  })
})

// The same vmid exists on several clusters (roadmap#50): a link that names its
// cluster must never land on a guest of another cluster.
describe('findDeepLinkedVm', () => {
  const PROD = { connId: 'prod', node: 'pve1', vmid: 9882, name: 'prod-guest' }
  const DR = { connId: 'dr', node: 'pve1-dr', vmid: 9882, name: 'dr-guest' }

  it('opens the guest of the linked cluster, whatever the inventory order', () => {
    const link = params('vmid=9882&connId=dr&node=pve1-dr')

    expect(findDeepLinkedVm([PROD, DR], link)).toBe(DR)
    expect(findDeepLinkedVm([DR, PROD], link)).toBe(DR)
  })

  it('stays on the linked cluster when the node in the link is stale', () => {
    expect(findDeepLinkedVm([PROD, DR], params('vmid=9882&connId=dr&node=pve2-dr'))).toBe(DR)
  })

  it('finds nothing while the linked cluster is not loaded, so the page waits for it', () => {
    expect(findDeepLinkedVm([PROD], params('vmid=9882&connId=dr&node=pve1-dr'))).toBeUndefined()
  })

  it('keeps the first guest carrying the vmid for a link without a cluster', () => {
    expect(findDeepLinkedVm([PROD, DR], params('vmid=9882'))).toBe(PROD)
  })

  it('finds nothing without a vmid', () => {
    expect(findDeepLinkedVm([PROD, DR], params('connId=dr'))).toBeUndefined()
  })
})
