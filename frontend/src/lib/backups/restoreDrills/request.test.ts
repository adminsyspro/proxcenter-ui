import { describe, expect, it } from 'vitest'

import {
  CT_NOT_SUPPORTED,
  DEFAULT_SCREENSHOT_DELAY_SEC,
  buildArchiveVolid,
  isDrillId,
  normalizeBackupTime,
  parseDrillInput,
  parseDrillSettings,
  pickPbsStorage,
  toDrillRequest,
  toRfc3339Seconds,
} from './request'

const BODY = {
  pbsId: 'pbs-1',
  datastore: 'store1',
  namespace: '/prod/',
  backupType: 'vm',
  backupId: '101',
  backupTime: '2026-10-18T02:00:05.000Z',
  vmName: 'web01',
  verifyState: 'ok',
  verifiedAt: '2026-10-18T03:00:00.123Z',
  backupSize: 1234.7,
  targetConnectionId: 'conn-1',
  targetNode: 'pve1',
  targetStorage: 'local-lvm',
  networkMode: 'link_down',
  bridge: 'vmbr0',
  restoreTimeoutSec: 7200,
  bootTimeoutSec: 0,
  agentTimeoutSec: '',
}

describe('parseDrillInput', () => {
  it('normalises a valid body', () => {
    const r = parseDrillInput(BODY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toMatchObject({
      namespace: 'prod',
      backupTime: '2026-10-18T02:00:05Z',
      verifiedAt: '2026-10-18T03:00:00Z',
      backupSize: 1234,
      bridge: '',
      restoreTimeoutSec: 7200,
      bootTimeoutSec: 0,
      agentTimeoutSec: 0,
    })
  })

  it('accepts a numeric backupId and defaults the optional fields', () => {
    const r = parseDrillInput({ ...BODY, backupId: 101, verifyState: undefined, verifiedAt: undefined, backupSize: undefined, networkMode: undefined, namespace: undefined })
    expect(r.ok && r.value).toMatchObject({ backupId: '101', verifyState: 'none', verifiedAt: '', backupSize: 0, networkMode: 'link_down', namespace: '' })
  })

  it('keeps the bridge only in bridge mode', () => {
    const r = parseDrillInput({ ...BODY, networkMode: 'bridge', bridge: 'vmbr9' })
    expect(r.ok && r.value.bridge).toBe('vmbr9')
  })

  it.each([
    [null, 'Invalid body'],
    [[], 'Invalid body'],
    [{ ...BODY, pbsId: '' }, 'pbsId is required'],
    [{ ...BODY, targetStorage: '  ' }, 'targetStorage is required'],
    [{ ...BODY, backupId: 'abc' }, 'backupId must be numeric'],
    [{ ...BODY, targetNode: '../x' }, 'targetNode is invalid'],
    [{ ...BODY, targetStorage: 'a b' }, 'targetStorage is invalid'],
    [{ ...BODY, backupTime: '2026-10-18 02:00:05' }, 'backupTime must be an RFC 3339 UTC timestamp'],
    [{ ...BODY, networkMode: 'none' }, 'networkMode must be link_down or bridge'],
    [{ ...BODY, networkMode: 'bridge', bridge: '' }, 'bridge is required when networkMode is bridge'],
    [{ ...BODY, verifyState: 'maybe' }, 'verifyState must be ok, failed or none'],
    [{ ...BODY, verifiedAt: 'yesterday' }, 'verifiedAt must be an RFC 3339 timestamp'],
    [{ ...BODY, backupSize: -1 }, 'backupSize must be a positive number'],
    [{ ...BODY, restoreTimeoutSec: 12.5 }, 'restore_timeout_sec must be an integer'],
    [{ ...BODY, bootTimeoutSec: 10 }, 'boot_timeout_sec must be 0 or between 60 and 3600'],
    [{ ...BODY, agentTimeoutSec: 99999 }, 'agent_timeout_sec must be 0 or between 30 and 1800'],
  ])('refuses %j', (body, error) => {
    expect(parseDrillInput(body)).toEqual({ ok: false, error })
  })
})

describe('archive volid', () => {
  it('builds <storage>:backup/<type>/<id>/<time> without fractions', () => {
    expect(buildArchiveVolid('pbs-prod', { backupType: 'vm', backupId: '101', backupTime: '2026-10-18T02:00:05.123Z' }))
      .toBe('pbs-prod:backup/vm/101/2026-10-18T02:00:05Z')
    expect(normalizeBackupTime('2026-10-18T02:00:05Z')).toBe('2026-10-18T02:00:05Z')
    expect(normalizeBackupTime('nope')).toBeNull()
    expect(toRfc3339Seconds(0)).toBe('1970-01-01T00:00:00Z')
  })
})

describe('pickPbsStorage', () => {
  const storages = [
    { storage: 'other', type: 'pbs', server: 'pbs.lab', datastore: 'store2', namespace: '' },
    { storage: 'pinned', type: 'pbs', server: 'PBS.lab', datastore: 'store1', namespace: 'prod', nodes: 'pve2,pve3' },
    { storage: 'everywhere', type: 'pbs', server: 'pbs.lab', datastore: 'store1', namespace: 'prod' },
    { storage: 'local', type: 'dir' },
  ]

  it('takes the first storage of this PBS that the node can reach', () => {
    expect(pickPbsStorage(storages, { baseUrl: 'https://pbs.lab:8007', datastore: 'store1', namespace: 'prod', node: 'pve2' })).toBe('pinned')
    expect(pickPbsStorage(storages, { baseUrl: 'https://pbs.lab:8007', datastore: 'store1', namespace: 'prod', node: 'pve1' })).toBe('everywhere')
  })

  it('returns null when nothing matches', () => {
    expect(pickPbsStorage(storages, { baseUrl: 'https://pbs.lab:8007', datastore: 'store1', namespace: '', node: 'pve1' })).toBeNull()
    expect(pickPbsStorage(null, { baseUrl: 'https://pbs.lab', datastore: 'store1', namespace: '', node: 'pve1' })).toBeNull()
  })
})

describe('toDrillRequest', () => {
  it('maps the UI body to the contract, snake_case', () => {
    const r = parseDrillInput({ ...BODY, networkMode: 'bridge', bridge: 'vmbr9' })
    if (!r.ok) throw new Error(r.error)
    expect(toDrillRequest(r.value, { pbsName: 'PBS lab', pbsStorage: 'pbs-prod', requestedBy: 'a@b.c' })).toEqual({
      connection_id: 'conn-1',
      node: 'pve1',
      target_storage: 'local-lvm',
      archive: 'pbs-prod:backup/vm/101/2026-10-18T02:00:05Z',
      network_mode: 'bridge',
      bridge: 'vmbr9',
      restore_timeout_sec: 7200,
      boot_timeout_sec: 0,
      agent_timeout_sec: 0,
      source: {
        pbs_id: 'pbs-1',
        pbs_name: 'PBS lab',
        pbs_storage: 'pbs-prod',
        datastore: 'store1',
        namespace: 'prod',
        backup_type: 'vm',
        backup_id: '101',
        backup_time: '2026-10-18T02:00:05Z',
        vm_name: 'web01',
        verify_state: 'ok',
        verified_at: '2026-10-18T03:00:00Z',
        backup_size_bytes: 1234,
      },
      requested_by: 'a@b.c',
    })
  })

  it('exposes the contract message for containers', () => {
    expect(CT_NOT_SUPPORTED).toBe('guest type ct is not supported by restore drills yet')
  })
})

describe('parseDrillSettings', () => {
  const S = {
    max_concurrent: 2, capacity_budget_gb: 0, free_space_margin_pct: 10, restore_timeout_sec: 14400,
    boot_timeout_sec: 600, agent_timeout_sec: 300, default_network_mode: 'bridge', default_bridge: ' vmbr9 ',
    screenshot_delay_sec: 30,
  }

  it('accepts the ranges of the contract', () => {
    expect(parseDrillSettings(S)).toEqual({ ok: true, value: { ...S, default_bridge: 'vmbr9' } })
    expect(parseDrillSettings({ ...S, max_concurrent: '3', default_network_mode: '' })).toMatchObject({ ok: true, value: { max_concurrent: 3, default_network_mode: 'link_down' } })
    expect(parseDrillSettings({ ...S, screenshot_delay_sec: 0 })).toMatchObject({ ok: true, value: { screenshot_delay_sec: 0 } })
    expect(parseDrillSettings({ ...S, screenshot_delay_sec: '600' })).toMatchObject({ ok: true, value: { screenshot_delay_sec: 600 } })
  })

  it('keeps the orchestrator default delay when an older client leaves it out', () => {
    const { screenshot_delay_sec: _omitted, ...legacy } = S
    expect(parseDrillSettings(legacy)).toMatchObject({ ok: true, value: { screenshot_delay_sec: DEFAULT_SCREENSHOT_DELAY_SEC } })
    expect(parseDrillSettings({ ...S, screenshot_delay_sec: null })).toMatchObject({ ok: true, value: { screenshot_delay_sec: 45 } })
  })

  it.each([
    [null, 'Invalid body'],
    [{ ...S, max_concurrent: 0 }, 'max_concurrent must be an integer between 1 and 10'],
    [{ ...S, capacity_budget_gb: -1 }, 'capacity_budget_gb must be an integer between 0 and 1000000'],
    [{ ...S, free_space_margin_pct: 101 }, 'free_space_margin_pct must be an integer between 0 and 100'],
    [{ ...S, restore_timeout_sec: 299 }, 'restore_timeout_sec must be an integer between 300 and 86400'],
    [{ ...S, screenshot_delay_sec: 601 }, 'screenshot_delay_sec must be an integer between 0 and 600'],
    [{ ...S, screenshot_delay_sec: -1 }, 'screenshot_delay_sec must be an integer between 0 and 600'],
    [{ ...S, screenshot_delay_sec: 1.5 }, 'screenshot_delay_sec must be an integer between 0 and 600'],
    [{ ...S, default_network_mode: 'x' }, 'default_network_mode must be link_down or bridge'],
    [{ ...S, default_bridge: 'vm br' }, 'default_bridge is invalid'],
  ])('refuses %j', (body, error) => {
    expect(parseDrillSettings(body)).toEqual({ ok: false, error })
  })
})

describe('isDrillId', () => {
  it('accepts a UUID only', () => {
    expect(isDrillId('1a2b3c4d-0000-4000-8000-000000000000')).toBe(true)
    expect(isDrillId('../etc')).toBe(false)
    expect(isDrillId(undefined)).toBe(false)
  })
})
