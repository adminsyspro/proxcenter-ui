import { describe, it, expect } from 'vitest'

import { menuData } from './menuData'

interface MenuNode {
  href?: string
  permissions?: string[]
  children?: MenuNode[]
}

const findByHref = (items: MenuNode[], href: string): MenuNode | null => {
  for (const item of items) {
    if (item.href === href) return item
    const hit = item.children && findByHref(item.children, href)

    if (hit) return hit
  }

  return null
}

describe('menuData permissions', () => {
  // A role that lacks the page's view permission must not see the entry:
  // the page would open and every API call behind it would answer 403.
  it.each([
    ['/operations/reports', 'reports.view'],
    ['/operations/task-center', 'tasks.view'],
    ['/security/compliance', 'admin.compliance'],
  ])('%s requires %s', (href, permission) => {
    const item = findByHref(menuData(), href)

    expect(item).not.toBeNull()
    expect(item?.permissions).toContain(permission)
  })
})
