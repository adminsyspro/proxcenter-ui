import { describe, expect, it } from 'vitest'

import { residualEscapeRefusal } from './pathParam'

describe('residualEscapeRefusal', () => {
  it('lets a value Next decoded once through, slashes and colons included', () => {
    expect(residualEscapeRefusal('10.0.0.0/24', 'CIDR')).toBeNull()
    expect(residualEscapeRefusal('UPID:pve1:0001:00:00:vzdump::root@pam:', 'UPID')).toBeNull()
  })

  it('answers 400 on a "%" left after that decode, naming the parameter', async () => {
    const res = residualEscapeRefusal('store/vm/100/2026%zz', 'backupId')

    expect(res?.status).toBe(400)
    expect(await res?.json()).toEqual({ error: 'Malformed backupId' })
  })
})
