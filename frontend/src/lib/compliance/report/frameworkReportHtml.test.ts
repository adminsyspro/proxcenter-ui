import { describe, it, expect } from 'vitest'
import { frameworkReportHtml } from './frameworkReportHtml'
import { getFramework } from '../frameworks'
import type { FrameworkAssessment } from '../frameworkAssessment'

const a: FrameworkAssessment = {
  frameworkId: 'nist-800-171-r2', score: 60, satisfied: 3, partial: 1, failed: 1, notAssessed: 105,
  assessedControls: 5, totalControls: 110, coverage: 5 / 110,
  families: [{ family: 'Access Control', satisfied: 1, partial: 0, failed: 0, notAssessed: 2 }],
  controls: [{ id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'satisfied', checks: [{ id: 'ssh_root_login', name: 'SSH root login', status: 'pass' }] }],
}
const t = (k: string) => k

describe('frameworkReportHtml', () => {
  it('includes framework name, score and a control row', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'prod', generatedAt: '2026-06-22', locale: 'en' }, t)
    expect(html).toContain('NIST SP 800-171')
    expect(html).toContain('60')
    expect(html).toContain('3.1.1')
  })
  it('escapes hostile dynamic values and embeds no remote/file resources', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: '<script>x</script>', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/src=["']https?:|src=["']file:/)
  })
})
