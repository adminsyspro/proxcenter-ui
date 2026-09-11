import { describe, expect, it } from 'vitest'

import { renderExposition } from '../prometheus'
import { buildPbsFamilies } from './pbs'

const view = {
  pbsServers: [
    {
      connId: 'pbs-1', connectionName: 'PBS One', status: 'online', version: '4.2.1',
      datastores: [
        { name: 'S3manu', total: 0, used: 4096, available: 0, usagePercent: 12.5, backupCount: 7, vmCount: 3, ctCount: 1, hostCount: 0 },
        { name: 'local', total: 1000, used: 250, available: 750, usagePercent: 25, backupCount: 4, vmCount: 2, ctCount: 0, hostCount: 1 },
      ],
    },
    { connId: 'pbs-2', connectionName: 'PBS Two', status: 'offline', version: null, datastores: [] },
  ],
} as any

describe('buildPbsFamilies', () => {
  it('reports reachability per server', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).toContain('proxcenter_pbs_up{connection="PBS One"} 1')
    expect(text).toContain('proxcenter_pbs_up{connection="PBS Two"} 0')
  })

  /**
   * renderLabels drops null and empty label values, so an unreachable
   * server with no version would render as a bare `proxcenter_pbs_info 1`
   * with no labels at all, colliding with every other version-less server
   * on one series. Omit the sample instead.
   */
  it('omits the info sample for a server whose version is unknown', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).toContain('proxcenter_pbs_info{connection="PBS One",version="4.2.1"} 1')
    const infoLines = text.split(String.fromCharCode(10)).filter(line => line.startsWith('proxcenter_pbs_info'))
    expect(infoLines).toHaveLength(1)
  })

  it('publishes datastore capacity in bytes', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).toContain('proxcenter_pbs_datastore_total_bytes{connection="PBS One",datastore="local"} 1000')
    expect(text).toContain('proxcenter_pbs_datastore_used_bytes{connection="PBS One",datastore="local"} 250')
    expect(text).toContain('proxcenter_pbs_datastore_available_bytes{connection="PBS One",datastore="local"} 750')
  })

  /**
   * The lab's S3-backed datastore reports total 0 while genuinely holding
   * data. Serving the ratio pre-computed is the whole reason this family
   * exists: a dashboard dividing used by total would render Infinity.
   */
  it('serves the usage ratio pre-computed, so an S3 datastore reporting no capacity still charts', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).toContain('proxcenter_pbs_datastore_usage_ratio{connection="PBS One",datastore="S3manu"} 0.125')
    expect(text).toContain('proxcenter_pbs_datastore_total_bytes{connection="PBS One",datastore="S3manu"} 0')
    expect(text).not.toContain('Infinity')
    expect(text).not.toContain('NaN')
  })

  it('counts snapshots and backup sources by kind', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).toContain('proxcenter_pbs_datastore_snapshots{connection="PBS One",datastore="S3manu"} 7')
    expect(text).toContain('proxcenter_pbs_datastore_guests{connection="PBS One",datastore="S3manu",kind="vm"} 3')
    expect(text).toContain('proxcenter_pbs_datastore_guests{connection="PBS One",datastore="S3manu",kind="ct"} 1')
    expect(text).toContain('proxcenter_pbs_datastore_guests{connection="PBS One",datastore="S3manu",kind="host"} 0')
  })

  it('emits no datastore sample at all for an unreachable server', () => {
    const text = renderExposition(buildPbsFamilies(view))
    expect(text).not.toContain('connection="PBS Two",datastore=')
  })
})
