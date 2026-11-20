import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  E_TOO_MANY_REPORT_JOBS,
  getReportJob,
  MAX_REPORT_JOBS_PER_OWNER,
  publicReportJob,
  REPORT_JOB_TTL_MS,
  reportJobOwnerKey,
  resetReportJobs,
  startReportJob,
} from './reportJobs'

const PDF = Buffer.from('%PDF-1.7')

function start(over: Partial<Parameters<typeof startReportJob>[0]> = {}) {
  return startReportJob({
    tenantId: 't1',
    ownerKey: 'session:u1',
    frameworkId: 'cmmc-l2',
    connectionId: 'c1',
    connectionName: 'PVE-PROD',
    run: async () => ({ ok: true, pdf: PDF, filename: 'cmmc-l2-PVE-PROD.pdf' }),
    ...over,
  })
}

beforeEach(() => resetReportJobs())
afterEach(() => vi.useRealTimers())

describe('startReportJob', () => {
  it('answers at once with a running job, then holds the PDF once built', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(r => { release = r })
    const job = start({ run: async () => { await gate; return { ok: true, pdf: PDF, filename: 'r.pdf' } } })

    expect(job.status).toBe('running')
    release()
    await vi.waitFor(() => expect(getReportJob(job.id, 't1', 'session:u1')?.status).toBe('done'))
    const done = getReportJob(job.id, 't1', 'session:u1')!
    expect(done.pdf).toBe(PDF)
    expect(done.filename).toBe('r.pdf')
    expect(done.finishedAt).toBeTypeOf('number')
  })

  it('records a renderer failure and a thrown error as an error', async () => {
    const failed = start({ run: async () => ({ ok: false, error: 'PDF generation failed' }) })
    const thrown = start({ run: async () => { throw new Error('pve down') } })

    await vi.waitFor(() => expect(getReportJob(thrown.id, 't1', 'session:u1')?.status).toBe('error'))
    expect(getReportJob(failed.id, 't1', 'session:u1')).toMatchObject({ status: 'error', error: 'PDF generation failed' })
    expect(getReportJob(thrown.id, 't1', 'session:u1')).toMatchObject({ status: 'error', error: 'pve down' })
  })

  it('refuses a new report while the caller already has the maximum running', () => {
    const never = () => new Promise<never>(() => {})
    for (let i = 0; i < MAX_REPORT_JOBS_PER_OWNER; i++) start({ run: never })

    expect(() => start({ run: never })).toThrow(E_TOO_MANY_REPORT_JOBS)
    // Another caller is not affected.
    expect(start({ ownerKey: 'session:u2', run: never }).status).toBe('running')
  })

  it('drops the oldest finished report of the caller to make room', async () => {
    const first = start()
    await vi.waitFor(() => expect(getReportJob(first.id, 't1', 'session:u1')?.status).toBe('done'))
    for (let i = 1; i < MAX_REPORT_JOBS_PER_OWNER; i++) start()

    const extra = start()

    expect(extra.status).toBe('running')
    expect(getReportJob(first.id, 't1', 'session:u1')).toBeNull()
  })
})

describe('getReportJob', () => {
  it('hands a job only to the caller that started it, in its tenant', () => {
    const job = start()

    expect(getReportJob(job.id, 't1', 'session:u1')).not.toBeNull()
    expect(getReportJob(job.id, 't1', 'session:u2')).toBeNull()
    expect(getReportJob(job.id, 't2', 'session:u1')).toBeNull()
    expect(getReportJob('unknown', 't1', 'session:u1')).toBeNull()
  })

  it('forgets a finished report after its time to live', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    const job = start()
    await vi.waitFor(() => expect(getReportJob(job.id, 't1', 'session:u1')?.status).toBe('done'))

    vi.setSystemTime(new Date(Date.parse('2026-11-20T10:00:00Z') + REPORT_JOB_TTL_MS - 1000))
    expect(getReportJob(job.id, 't1', 'session:u1')).not.toBeNull()

    vi.setSystemTime(new Date(Date.parse('2026-11-20T10:00:00Z') + REPORT_JOB_TTL_MS + 1000))
    expect(getReportJob(job.id, 't1', 'session:u1')).toBeNull()
  })
})

describe('publicReportJob', () => {
  it('shows neither the PDF bytes nor the owner', async () => {
    const job = start()
    await vi.waitFor(() => expect(getReportJob(job.id, 't1', 'session:u1')?.status).toBe('done'))

    const shown = publicReportJob(getReportJob(job.id, 't1', 'session:u1')!)

    expect(shown).not.toHaveProperty('pdf')
    expect(shown).not.toHaveProperty('ownerKey')
    expect(shown).not.toHaveProperty('tenantId')
    expect(shown).toMatchObject({ id: job.id, status: 'done', frameworkId: 'cmmc-l2', connectionName: 'PVE-PROD' })
  })
})

describe('reportJobOwnerKey', () => {
  it('keys a session by its user and a token by its id', () => {
    expect(reportJobOwnerKey({ kind: 'session', userId: 'u1' })).toBe('session:u1')
    expect(reportJobOwnerKey({ kind: 'token', tokenId: 'tk1', userId: 'u1' })).toBe('token:tk1')
    expect(reportJobOwnerKey({ kind: 'session' })).toBeNull()
  })
})
