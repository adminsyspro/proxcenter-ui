import { describe, it, expect, vi } from 'vitest'

import {
  loadBackupJobs,
  loadBackupVms,
  saveBackupJob,
  deleteBackupJob,
  toggleBackupJob,
} from './backupJobsApi'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function htmlGateway(status = 504) {
  // A reverse-proxy error page (no <!DOCTYPE), the discussion #396 case.
  return new Response('<html> <head><title>err</title></head></html>', {
    status,
    headers: { 'content-type': 'text/html' },
  })
}

describe('backupJobsApi', () => {
  describe('loadBackupJobs', () => {
    it('GETs the connection backup-jobs endpoint and returns the payload', async () => {
      const payload = { jobs: [{ id: 'b1' }], storages: [], nodes: [] }
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: payload }))

      const result = await loadBackupJobs('conn 1', fetchImpl as unknown as typeof fetch)

      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/v1/connections/conn%201/backup-jobs',
        undefined,
      )
      expect(result).toEqual({ ok: true, data: payload })
    })

    it('returns a clean HTTP error on an nginx gateway HTML page', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(htmlGateway(504))

      const result = await loadBackupJobs('c', fetchImpl as unknown as typeof fetch)

      expect(result).toEqual({ ok: false, error: 'HTTP 504' })
    })
  })

  describe('loadBackupVms', () => {
    it('GETs the resources endpoint filtered to VMs', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))

      await loadBackupVms('c', fetchImpl as unknown as typeof fetch)

      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/v1/connections/c/resources?type=vm',
        undefined,
      )
    })
  })

  describe('saveBackupJob', () => {
    it('POSTs to the collection in create mode', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'new' } }))

      await saveBackupJob('c', 'create', '', { schedule: '0 2' }, fetchImpl as unknown as typeof fetch)

      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe('/api/v1/connections/c/backup-jobs')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ schedule: '0 2' })
    })

    it('PUTs to the per-job URL in edit mode', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))

      await saveBackupJob('c', 'edit', 'job 9', { enabled: true }, fetchImpl as unknown as typeof fetch)

      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe('/api/v1/connections/c/backup-jobs/job%209')
      expect(init.method).toBe('PUT')
    })

    it('surfaces a backend error field', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad cron' }, 400))

      const result = await saveBackupJob('c', 'create', '', {}, fetchImpl as unknown as typeof fetch)

      expect(result).toEqual({ ok: false, error: 'bad cron' })
    })
  })

  describe('deleteBackupJob', () => {
    it('DELETEs the per-job URL', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))

      await deleteBackupJob('c', 'job 9', fetchImpl as unknown as typeof fetch)

      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe('/api/v1/connections/c/backup-jobs/job%209')
      expect(init.method).toBe('DELETE')
    })
  })

  describe('toggleBackupJob', () => {
    it('PUTs the enabled flag', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))

      await toggleBackupJob('c', 'b1', false, fetchImpl as unknown as typeof fetch)

      const [url, init] = fetchImpl.mock.calls[0]
      expect(url).toBe('/api/v1/connections/c/backup-jobs/b1')
      expect(init.method).toBe('PUT')
      expect(JSON.parse(init.body)).toEqual({ enabled: false })
    })
  })
})
