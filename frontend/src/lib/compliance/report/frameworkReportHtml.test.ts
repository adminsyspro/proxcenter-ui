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

  // -- Not-assessed hiding --

  it('hides not_assessed controls from the control table', () => {
    const withNotAssessed: FrameworkAssessment = {
      ...a,
      controls: [
        { id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'satisfied', checks: [] },
        { id: '3.1.99', title: 'Policy review', family: 'Policy', status: 'not_assessed', checks: [] },
      ],
    }
    const html = frameworkReportHtml(withNotAssessed, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('3.1.1')
    expect(html).not.toContain('3.1.99')
  })

  it('does not include a "Not Assessed" stat card', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    // The stat card with "Not Assessed" label must be gone
    expect(html).not.toMatch(/stat-label[^<]*Not Assessed/)
  })

  it('omits families with zero assessed controls from the by-family table', () => {
    const allNotAssessed: FrameworkAssessment = {
      ...a,
      families: [
        { family: 'Policy', satisfied: 0, partial: 0, failed: 0, notAssessed: 5 },
        { family: 'Access Control', satisfied: 1, partial: 0, failed: 0, notAssessed: 2 },
      ],
    }
    const html = frameworkReportHtml(allNotAssessed, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('Access Control')
    // Policy has no assessed controls so it should be omitted
    expect(html).not.toContain('>Policy<')
  })

  it('does not show "Not Assessed" column header in the by-family table', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toMatch(/<th[^>]*>Not Assessed<\/th>/)
  })

  it('includes a scope note about omitted organizational controls', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('outside the scope of automated infrastructure assessment')
  })

  // -- Brand color --

  it('injects a valid hex brand color into --primary', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', brandColor: '#FF5500' }, t)
    expect(html).toContain('--primary: #FF5500')
  })

  it('falls back to #E57000 when brandColor is an invalid / hostile value', () => {
    const hostile = 'red;}body{x:1'
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', brandColor: hostile }, t)
    expect(html).not.toContain(hostile)
    expect(html).toContain('--primary: #E57000')
  })

  it('falls back to #E57000 when brandColor is absent', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('--primary: #E57000')
  })

  // -- Logo --

  it('renders logo img when logoDataUri starts with data:', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', logoDataUri: 'data:image/png;base64,AAAA' }, t)
    expect(html).toContain('<img class="cover-logo" src="data:image/png;base64,AAAA"')
  })

  it('rejects non-data: logoDataUri (no img rendered)', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', logoDataUri: 'http://evil.com/logo.png' }, t)
    expect(html).not.toContain('http://evil.com')
    expect(html).not.toContain('<img class="cover-logo"')
  })

  it('omits logo img when logoDataUri is absent', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('<img class="cover-logo"')
  })

  // -- Framework badge --

  it('renders the framework badge when frameworkLogoDataUri starts with data:', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', frameworkLogoDataUri: 'data:image/png;base64,BBBB' }, t)
    expect(html).toContain('<img class="cover-framework-logo" src="data:image/png;base64,BBBB"')
  })

  it('rejects a non-data: frameworkLogoDataUri (no badge rendered)', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', frameworkLogoDataUri: 'https://evil.com/badge.png' }, t)
    expect(html).not.toContain('evil.com')
    expect(html).not.toContain('<img class="cover-framework-logo"')
  })

  it('omits the framework badge when frameworkLogoDataUri is absent', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('<img class="cover-framework-logo"')
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

  it('allows data: URI logo without treating it as a remote resource', () => {
    const html = frameworkReportHtml(a, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en', logoDataUri: 'data:image/png;base64,AAAA' }, t)
    // data: URI is allowed
    expect(html).toContain('data:image/png;base64,AAAA')
    // still no http/file
    expect(html).not.toMatch(/src=["']https?:/)
    expect(html).not.toMatch(/src=["']file:/)
  })

  // -- sourceUrl link --

  it('renders a clickable <a> for a valid https sourceUrl', () => {
    const defWithUrl = { ...getFramework('nist-800-171-r2'), sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final' }
    const html = frameworkReportHtml(a, defWithUrl, { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('<a href="https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final">')
    expect(html).toContain('https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final</a>')
  })

  it('rejects a javascript: sourceUrl and emits no <a href="javascript:', () => {
    const defWithHostile = { ...getFramework('nist-800-171-r2'), sourceUrl: 'javascript:alert(1)' }
    const html = frameworkReportHtml(a, defWithHostile, { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('<a href="javascript:')
    expect(html).not.toContain('href="javascript:')
  })

  it('rejects a data: sourceUrl and emits no <a href="data:', () => {
    const defWithData = { ...getFramework('nist-800-171-r2'), sourceUrl: 'data:text/html,<script>x</script>' }
    const html = frameworkReportHtml(a, defWithData, { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('href="data:')
  })

  it('rejects a file: sourceUrl and emits no <a href="file:', () => {
    const defWithFile = { ...getFramework('nist-800-171-r2'), sourceUrl: 'file:///etc/passwd' }
    const html = frameworkReportHtml(a, defWithFile, { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('href="file:')
  })

  // -- Details column in control table --

  it('renders check details for a partial control in the Details column', () => {
    const withDetails: FrameworkAssessment = {
      ...a,
      controls: [{
        id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'partial',
        checks: [
          { id: 'ssh_root_login', name: 'SSH root login', status: 'fail', details: 'node2: PermitRootLogin=yes' },
          { id: 'node_fw', name: 'Node firewall', status: 'pass' },
        ],
      }],
    }
    const html = frameworkReportHtml(withDetails, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('node2: PermitRootLogin=yes')
    expect(html).toContain('Fail: node2: PermitRootLogin=yes')
  })

  it('escapes hostile details value in the Details column', () => {
    const withHostile: FrameworkAssessment = {
      ...a,
      controls: [{
        id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'failed',
        checks: [
          { id: 'check_x', name: 'Check X', status: 'fail', details: '<script>x</script>' },
        ],
      }],
    }
    const html = frameworkReportHtml(withHostile, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })

  it('renders placeholder when no check has details', () => {
    const noDetails: FrameworkAssessment = {
      ...a,
      controls: [{
        id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'satisfied',
        checks: [{ id: 'ssh_root_login', name: 'SSH root login', status: 'pass' }],
      }],
    }
    const html = frameworkReportHtml(noDetails, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    // Should render the placeholder, not an empty cell
    expect(html).toContain('#94a3b8')
  })

  it('skips checks with no details and only renders lines for checks that have details', () => {
    const mixed: FrameworkAssessment = {
      ...a,
      controls: [{
        id: '3.1.1', title: 'Limit access', family: 'Access Control', status: 'partial',
        checks: [
          { id: 'check_a', name: 'Check A', status: 'fail', details: 'reason A' },
          { id: 'check_b', name: 'Check B', status: 'pass' },
        ],
      }],
    }
    const html = frameworkReportHtml(mixed, getFramework('nist-800-171-r2'), { connectionName: 'c', generatedAt: 'd', locale: 'en' }, t)
    expect(html).toContain('reason A')
    // check_b has no details; its name should not appear in a "status: details" pattern in the details column
    expect(html).not.toContain('Pass: Check B')
  })
})
