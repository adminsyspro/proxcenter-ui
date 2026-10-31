import { describe, expect, it } from 'vitest'

import { evidenceTranslator } from '@/lib/backups/restoreDrills/evidence'
import { makeIncident } from '@/components/incidents/fixtures'

import { incidentReportHtml } from './reportPdf'

const meta = { generatedAt: '2026-10-29T12:00:00.000Z', locale: 'en', branding: { brandColor: '#E57000', logoDataUri: '', appName: '' } }

const comment = (id: string, body: string, internal: boolean) => ({
  id, incident_id: 'i1', body, internal, author_id: 'u1', author_name: 'alice', created_at: '2026-10-27T10:05:00.000Z',
})

describe('incidentReportHtml', () => {
  it('keeps the internal notes out and escapes every value', async () => {
    const t = await evidenceTranslator('en')
    const html = incidentReportHtml(makeIncident({
      title: '<b>pve1</b> down',
      comments: [comment('c1', 'Public <script>x</script>', false), comment('c2', 'SECRET-INTERNAL', true)],
    }), meta, t)

    expect(html).not.toContain('SECRET-INTERNAL')
    expect(html).toContain('Public &lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;pve1&lt;/b&gt; down')
    expect(html).not.toContain('<script>')
  })

  it('lists the alerts by start time and marks an unvalidated post-mortem as a draft', async () => {
    const t = await evidenceTranslator('en')
    const html = incidentReportHtml(makeIncident({
      alerts: [
        { id: 'a2', type: 'vm_down', resource: 'vm-100', message: 'late', first_seen_at: '2026-10-27T10:01:00.000Z', resolved_at: '2026-10-27T10:09:00.000Z' },
        { id: 'a1', type: 'node_down', resource: 'pve1', message: 'early', first_seen_at: '2026-10-27T10:00:00.000Z', resolved_at: null },
      ],
    }), meta, t)

    expect(html.indexOf('early')).toBeLessThan(html.indexOf('late'))
    expect(html).toContain('2026-10-27 10:09:00 UTC')
    expect(html).toContain('8m')
    expect(html).toContain('Draft: the post-mortem is not validated yet.')
  })

  it('names who validated a closed incident, in the reader language', async () => {
    const t = await evidenceTranslator('fr')
    const html = incidentReportHtml(makeIncident({
      status: 'closed', root_cause: 'Disque', impact: 'Aucun', postmortem_by: 'bob', postmortem_at: '2026-10-28T09:00:00.000Z',
      actions: [{ id: 'x1', incident_id: 'i1', text: 'Remplacer le disque', done: true, position: 0 }],
    }), { ...meta, locale: 'fr' }, t)

    expect(html).toContain('Validé par bob le 2026-10-28 09:00:00 UTC')
    expect(html).toContain('Rapport d&#39;incident')
    expect(html).toContain('Remplacer le disque')
    expect(html).not.toContain('Brouillon')
  })
})
