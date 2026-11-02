import { describe, it, expect } from 'vitest'
import { deploySchema, createConnectionSchema, updateConnectionSchema } from './schemas'

// vmName follows Proxmox DNS-hostname rules (RFC 1123): a label may start
// with a digit. Regression guard for #522 — names like "2604-kdcs-002" were
// rejected with "Invalid VM name" because the regex forced a leading letter.
describe('deploySchema vmName', () => {
  const vmName = deploySchema.shape.vmName

  it('accepts a name starting with a digit (#522)', () => {
    expect(vmName.safeParse('2604-kdcs-002').success).toBe(true)
  })

  it('accepts a name starting with a letter', () => {
    expect(vmName.safeParse('web-server-01').success).toBe(true)
  })

  it('accepts dots and underscores', () => {
    expect(vmName.safeParse('db1.prod_east').success).toBe(true)
  })

  it('is optional', () => {
    expect(vmName.safeParse(undefined).success).toBe(true)
  })

  it('rejects names with spaces or illegal characters', () => {
    expect(vmName.safeParse('my vm').success).toBe(false)
    expect(vmName.safeParse('vm@host').success).toBe(false)
  })

  it('rejects names longer than 63 characters', () => {
    expect(vmName.safeParse('a'.repeat(64)).success).toBe(false)
  })
})

describe('connection schemas subType', () => {
  it('accepts an XCP-ng pool connection in xapi mode', () => {
    const r = createConnectionSchema.safeParse({
      name: 'XCP-ng Lab', type: 'xcpng', subType: 'xapi', baseUrl: '10.99.99.197',
      vmwareUser: 'root', vmwarePassword: 'pw', insecureTLS: true,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.subType).toBe('xapi')
  })

  it('still accepts the VMware sub types and rejects unknown ones', () => {
    expect(createConnectionSchema.safeParse({ name: 'vc', type: 'vmware', subType: 'vcenter', baseUrl: 'https://vc', vmwareUser: 'a', vmwarePassword: 'b' }).success).toBe(true)
    expect(createConnectionSchema.safeParse({ name: 'x', type: 'xcpng', subType: 'kvm', baseUrl: 'https://x', vmwareUser: 'a', vmwarePassword: 'b' }).success).toBe(false)
  })

  it('strips every trailing slash from baseUrl and keeps inner ones', () => {
    const c = createConnectionSchema.safeParse({ name: 'vc', type: 'vmware', subType: 'vcenter', baseUrl: ' https://vc/a//b/// ', vmwareUser: 'a', vmwarePassword: 'b' })
    expect(c.success && c.data.baseUrl).toBe('https://vc/a//b')
    const u = updateConnectionSchema.safeParse({ baseUrl: 'https://vc//' })
    expect(u.success && u.data.baseUrl).toBe('https://vc')
  })

  it('lets an update switch an XCP-ng connection to xo mode', () => {
    const r = updateConnectionSchema.safeParse({ subType: 'xo' })
    expect(r.success).toBe(true)
  })
})

describe('connection schemas replicationNetwork', () => {
  const pveBody = { name: 'pve', type: 'pve', baseUrl: 'https://pve:8006', apiToken: 'root@pam!t=s' }

  it('accepts, trims and nulls the replication network on create', () => {
    const r = createConnectionSchema.safeParse({ ...pveBody, replicationNetwork: ' 10.10.50.0/24 ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.replicationNetwork).toBe('10.10.50.0/24')
    expect(createConnectionSchema.safeParse({ ...pveBody, replicationNetwork: null }).success).toBe(true)
    expect(createConnectionSchema.safeParse({ ...pveBody, replicationNetwork: '' }).success).toBe(true)
    expect(createConnectionSchema.safeParse(pveBody).success).toBe(true)
  })

  it('rejects a replication network that is not a CIDR on create', () => {
    // With SSH enabled: without it the value is dropped by the route anyway.
    const sshBody = { ...pveBody, sshEnabled: true, sshAuthMethod: 'key', sshKey: 'k' }
    for (const bad of ['10.10.50.0', '10.10.50.0/33', 'replication.lan/24', '2001:db8::/129']) {
      const r = createConnectionSchema.safeParse({ ...sshBody, replicationNetwork: bad })
      expect(r.success, bad).toBe(false)
      if (!r.success) expect(r.error.issues.some(i => i.path.join('.') === 'replicationNetwork'), bad).toBe(true)
    }
  })

  it('ignores the replication network when SSH is disabled in the same request', () => {
    // The routes null the field when SSH is off, so a stale or half-typed value
    // left in a hidden field must not turn a save into a 400.
    expect(createConnectionSchema.safeParse({ ...pveBody, sshEnabled: false, replicationNetwork: '10.10.50' }).success).toBe(true)
    expect(updateConnectionSchema.safeParse({ sshEnabled: false, replicationNetwork: '10.10.50' }).success).toBe(true)
    expect(createConnectionSchema.safeParse({ ...pveBody, sshEnabled: true, sshAuthMethod: 'key', sshKey: 'k', replicationNetwork: '10.10.50' }).success).toBe(false)
  })

  it('applies the same rule on update, where an empty string is the way to clear it', () => {
    expect(updateConnectionSchema.safeParse({ replicationNetwork: 'fd00:10:50::/64' }).success).toBe(true)
    expect(updateConnectionSchema.safeParse({ replicationNetwork: '' }).success).toBe(true)
    expect(updateConnectionSchema.safeParse({ replicationNetwork: null }).success).toBe(true)
    const r = updateConnectionSchema.safeParse({ replicationNetwork: '10.10.50.0/24/8' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].path).toEqual(['replicationNetwork'])
  })
})

describe('connection schemas warmZeroRateLimitMBps (roadmap#45)', () => {
  const pve = { name: 'p', type: 'pve' as const, baseUrl: 'https://10.0.0.1:8006', apiToken: 't' }
  it('accepts 0 (unlimited), a bounded integer and null', () => {
    for (const v of [0, 150, 100_000, null]) {
      expect(createConnectionSchema.safeParse({ ...pve, warmZeroRateLimitMBps: v }).success, String(v)).toBe(true)
      expect(updateConnectionSchema.safeParse({ warmZeroRateLimitMBps: v }).success, String(v)).toBe(true)
    }
  })
  it('refuses a negative, fractional or too large value', () => {
    for (const v of [-1, 1.5, 100_001, '150']) {
      expect(updateConnectionSchema.safeParse({ warmZeroRateLimitMBps: v }).success, String(v)).toBe(false)
    }
  })
})

describe('connection schemas cephExporterPort', () => {
  const pveBody = { name: 'p', type: 'pve', baseUrl: 'https://10.0.0.1:8006', apiToken: 'root@pam!t=s' }

  it('defaults to 9926 on create when absent', () => {
    const r = createConnectionSchema.safeParse(pveBody)
    expect(r.success && r.data.cephExporterPort).toBe(9926)
  })

  it('accepts 1..65535 on create and update', () => {
    for (const port of [1, 9100, 65535]) {
      const c = createConnectionSchema.safeParse({ ...pveBody, cephExporterPort: port })
      expect(c.success && c.data.cephExporterPort).toBe(port)
      const u = updateConnectionSchema.safeParse({ cephExporterPort: port })
      expect(u.success && u.data.cephExporterPort).toBe(port)
    }
  })

  it('refuses 0, 65536, 1.5 and the string "9926" on create and update', () => {
    for (const bad of [0, 65536, 1.5, -1, '9926', null]) {
      expect(createConnectionSchema.safeParse({ ...pveBody, cephExporterPort: bad }).success, `create ${String(bad)}`).toBe(false)
      expect(updateConnectionSchema.safeParse({ cephExporterPort: bad }).success, `update ${String(bad)}`).toBe(false)
    }
  })

  it('stays absent on update when not sent', () => {
    const u = updateConnectionSchema.safeParse({ name: 'x' })
    expect(u.success && 'cephExporterPort' in u.data).toBe(false)
  })
})
