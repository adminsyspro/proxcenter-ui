import { describe, expect, it } from 'vitest'

import { withoutCloudInitSecrets } from './blueprintSecrets'

describe('withoutCloudInitSecrets (roadmap#265)', () => {
  it('drops the cloud-init password and keeps the rest of the row', () => {
    const row = { id: 'bp-1', name: 'web', cloudInit: { ciuser: 'ops', cipassword: 's3cret', sshKeys: 'ssh-ed25519 AAAA', ipconfig0: 'ip=dhcp' } }
    expect(withoutCloudInitSecrets(row)).toEqual({ id: 'bp-1', name: 'web', cloudInit: { ciuser: 'ops', sshKeys: 'ssh-ed25519 AAAA', ipconfig0: 'ip=dhcp' } })
  })

  it('leaves a row without cloud-init as it is', () => {
    expect(withoutCloudInitSecrets({ id: 'bp-1', cloudInit: null })).toEqual({ id: 'bp-1', cloudInit: null })
    expect(withoutCloudInitSecrets({ id: 'bp-1' })).toEqual({ id: 'bp-1' })
  })

  it('never changes the row it is given', () => {
    const row = { id: 'bp-1', cloudInit: { cipassword: 's3cret' } }
    withoutCloudInitSecrets(row)
    expect(row.cloudInit.cipassword).toBe('s3cret')
  })
})
