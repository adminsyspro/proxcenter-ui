import { describe, it, expect } from 'vitest'
import { frameworkReportHtml } from './frameworkReportHtml'
import { getFramework } from '../frameworks'
import type { FrameworkAssessment } from '../frameworkAssessment'
import type { NodeBreakdown } from '../nodeBreakdown'

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

  it('escapes hostile status value in class attribute and hostile t() output', () => {
    const hostile: FrameworkAssessment = {
      ...a,
      score: null,
      controls: [{ ...a.controls[0], status: '"><x' as any }],
    }
    const tHostile = (k: string) => k.endsWith('noAssessed') ? '<b>none</b>' : k
    const html = frameworkReportHtml(hostile, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, tHostile)
    // status must not break out of the class attribute or style attribute
    expect(html).not.toContain('s-"><x')
    expect(html).toContain('&quot;&gt;')
    // t() return value for noAssessed branch (score === null) must be escaped
    expect(html).not.toContain('<b>none</b>')
    expect(html).toContain('&lt;b&gt;none&lt;/b&gt;')
  })

  // -- Per-node section tests --

  it('emits a per-node section when nodeBreakdown has more than 1 node', () => {
    const breakdown: NodeBreakdown[] = [
      {
        node: 'pve1',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', category: 'ssh', severity: 'high', status: 'pass' },
        ],
      },
      {
        node: 'pve2',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', category: 'ssh', severity: 'high', status: 'fail', details: 'node2: PermitRootLogin=yes' },
        ],
      },
    ]
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'cluster', generatedAt: '2026-06-22', locale: 'en' }, t, breakdown)
    expect(html).toContain('Per-Node Results')
    expect(html).toContain('Node: pve1')
    expect(html).toContain('Node: pve2')
    expect(html).toContain('node2: PermitRootLogin=yes')
  })

  it('escapes hostile node name and hostile details in per-node section', () => {
    const breakdown: NodeBreakdown[] = [
      {
        node: 'pve1',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', category: 'ssh', severity: 'high', status: 'pass' },
        ],
      },
      {
        node: '<b>n</b>',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', category: 'ssh', severity: 'high', status: 'fail', details: '<script>evil</script>' },
        ],
      },
    ]
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'cluster', generatedAt: '2026-06-22', locale: 'en' }, t, breakdown)
    // hostile node name must be escaped
    expect(html).not.toContain('Node: <b>n</b>')
    expect(html).toContain('Node: &lt;b&gt;n&lt;/b&gt;')
    // hostile details must be escaped
    expect(html).not.toContain('<script>evil</script>')
    expect(html).toContain('&lt;script&gt;evil&lt;/script&gt;')
  })

  it('does not emit a per-node section when nodeBreakdown is omitted', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'single', generatedAt: '2026-06-22', locale: 'en' }, t)
    expect(html).not.toContain('Per-Node Results')
  })

  it('does not emit a per-node section for a single-node breakdown', () => {
    const breakdown: NodeBreakdown[] = [
      {
        node: 'pve1',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', category: 'ssh', severity: 'high', status: 'pass' },
        ],
      },
    ]
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'single', generatedAt: '2026-06-22', locale: 'en' }, t, breakdown)
    expect(html).not.toContain('Per-Node Results')
  })

  it('contains no remote or file resource references in any scenario', () => {
    const breakdown: NodeBreakdown[] = [
      { node: 'n1', checks: [] },
      { node: 'n2', checks: [] },
    ]
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t, breakdown)
    expect(html).not.toMatch(/src=["']https?:/)
    expect(html).not.toMatch(/src=["']file:/)
    expect(html).not.toMatch(/@import\s+['"]https?:/)
    expect(html).not.toMatch(/<link/)
  })
})
