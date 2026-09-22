import { describe, expect, it } from 'vitest'

import { hasDeepLinkSelection } from './deepLink'

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
