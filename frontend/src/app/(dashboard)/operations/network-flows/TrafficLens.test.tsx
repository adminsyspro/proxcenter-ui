/**
 * The micro-segmentation lens of the Network flows page (UA35): the Group by selector and its disabled state, the
 * status chips and their writes, the Traffic by zone strip, and the hooks behind them (query string, storage, reads).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MicrosegWriteContext } from '@/app/(dashboard)/automation/network/components/microseg/microsegAccess'
import { formatBytes } from '@/utils/format'

vi.mock('next/navigation', async () => {
  const { navigation } = await import('./lensRender')
  return {
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
    usePathname: () => '/operations/network-flows',
    useSearchParams: () => new URLSearchParams(navigation.search),
  }
})
const license = vi.hoisted(() => ({ microseg: true }))
vi.mock('@/contexts/LicenseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/contexts/LicenseContext')>()),
  useLicense: () => ({ hasFeature: () => license.microseg }),
}))

import GroupBySelector, { MICROSEG_SETUP_HREF } from './GroupBySelector'
import { MicrosegPairStatus, usePairActions } from './MicrosegPairStatus'
import TrafficByZoneStrip from './TrafficByZoneStrip'
import { useGroupBy, useLensConnection, useTrafficLens, type TrafficLensRead } from './useTrafficLens'
import { PAIRS, POLICY, SUGGESTIONS, VMS, makeLens, reply } from './lensTestKit'
import { navigation, renderLens } from './lensRender'
import type { LensPair } from '@/lib/microseg/trafficLens'

const BASE = '/api/v1/firewall/microseg/c1'
let routes: Record<string, (init?: RequestInit) => unknown> = {}
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const handler = routes[`${init?.method ?? 'GET'} ${url}`]
  return handler ? handler(init) : reply(404, { code: 'NOT_FOUND' })
})
const callsTo = (key: string) => fetchMock.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}` === key)

const renderWithProviders = renderLens
const renderLive = renderLens

beforeEach(() => {
  license.microseg = true
  routes = {}
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  navigation.search = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GroupBySelector', () => {
  const props = { value: 'vm' as const, connections: [{ id: 'c1', name: 'PROD' }], connectionId: 'c1', onConnection: vi.fn() }

  it('offers VM, IP and Zone once the zones are ready', () => {
    const onChange = vi.fn()
    renderWithProviders(<GroupBySelector {...props} onChange={onChange} lensState='ready' />)
    fireEvent.click(screen.getByRole('button', { name: 'Zone' }))
    expect(onChange).toHaveBeenCalledWith('zone')
    fireEvent.click(screen.getByRole('button', { name: 'IP' }))
    expect(onChange).toHaveBeenCalledWith('ip')
    expect(screen.queryByLabelText('Connection')).not.toBeInTheDocument()
  })

  it('disables Zone without a deployed policy, with the way to set it up', async () => {
    renderWithProviders(<GroupBySelector {...props} onChange={vi.fn()} lensState='unavailable' />)
    expect(screen.getByRole('button', { name: 'Zone' })).toBeDisabled()
    fireEvent.mouseOver(screen.getByTestId('group-by-zone-unavailable'))
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Set up micro-segmentation first')
    expect(within(tip).getByRole('link', { name: 'Open the Micro-segmentation tab' })).toHaveAttribute('href', MICROSEG_SETUP_HREF)
  })

  it('says the zones are loading, or could not be read', async () => {
    const { unmount } = renderWithProviders(<GroupBySelector {...props} onChange={vi.fn()} lensState='loading' />)
    fireEvent.mouseOver(screen.getByTestId('group-by-zone-unavailable'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Loading the micro-segmentation zones...')
    unmount()
    renderWithProviders(<GroupBySelector {...props} onChange={vi.fn()} lensState='error' />)
    fireEvent.mouseOver(screen.getByTestId('group-by-zone-unavailable'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('could not be read')
  })

  it('lets the user pick the connection when there are several', async () => {
    const onConnection = vi.fn()
    renderWithProviders(
      <GroupBySelector {...props} connections={[{ id: 'c1', name: 'PROD' }, { id: 'c2', name: 'DR' }]} onConnection={onConnection} onChange={vi.fn()} lensState='ready' />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'DR' }))
    expect(onConnection).toHaveBeenCalledWith('c2')
  })
})

/** The table cells of the lens and the windows of their writes, as the pairs card renders them. */
function StatusTable({ read, pairs, canWrite = true }: { read: TrafficLensRead; pairs: LensPair[]; canWrite?: boolean }) {
  const actions = usePairActions(read)
  return (
    <MicrosegWriteContext.Provider value={canWrite}>
      {actions.failure}
      {pairs.map(p => (
        <div key={`${p.src_ip}-${p.dst_ip}-${p.protocol}-${p.dst_port}`} data-testid={`row-${p.src_ip}-${p.dst_port}-${p.protocol}`}>
          <MicrosegPairStatus pair={p} lens={read.lens!} actions={actions} />
        </div>
      ))}
      {actions.dialog}
    </MicrosegWriteContext.Provider>
  )
}

const lensRead = (): TrafficLensRead & { reloadPolicy: ReturnType<typeof vi.fn>; reloadSuggestions: ReturnType<typeof vi.fn> } => ({
  state: 'ready',
  lens: makeLens(),
  reloadPolicy: vi.fn(async () => undefined),
  reloadSuggestions: vi.fn(async () => undefined),
})

describe('MicrosegPairStatus', () => {
  it('shows the status of every pair against the draft, with what decides it', async () => {
    renderWithProviders(<StatusTable read={lensRead()} pairs={PAIRS} />)
    expect(screen.getAllByTestId('microseg-status').map(c => c.dataset.status)).toEqual([
      'allowed', 'not_covered', 'not_covered', 'blocked', 'unknown', 'unknown',
    ])
    expect(screen.getAllByTestId('microseg-status').map(c => c.textContent)).toEqual([
      'Allowed', 'Not covered', 'Not covered', 'Blocked', 'Unknown', 'Unknown',
    ])

    fireEvent.mouseOver(screen.getAllByTestId('microseg-status')[0])
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Allowed by the flow web → db tcp/5432')
  })

  it.each([
    [1, 'the zone would block it once enforced (4 hits observed)'],
    [2, 'No flow from db to web covers tcp/443'],
    [3, 'Blocked: no flow from db to web covers udp/53 (9 hits observed)'],
    [4, 'Unzoned → db: one end is in no zone'],
    [5, 'Unknown / External → web'],
  ])('explains the status of pair %i', async (index, text) => {
    renderWithProviders(<StatusTable read={lensRead()} pairs={PAIRS} />)
    fireEvent.mouseOver(screen.getAllByTestId('microseg-status')[index])
    expect(await screen.findByRole('tooltip')).toHaveTextContent(text)
  })

  it('shows return traffic as such, with no action, and says what a row sums', async () => {
    const lens = makeLens()
    const rows = lens.rows([
      { src_ip: '10.0.0.1', dst_ip: '10.0.0.2', protocol: 'TCP', dst_port: 5432, bytes: 3000, packets: 3 },
      { src_ip: '10.0.0.2', dst_ip: '10.0.0.1', protocol: 'TCP', dst_port: 51234, bytes: 1024, packets: 1 },
      { src_ip: '10.0.0.2', dst_ip: '10.0.0.3', protocol: 'TCP', dst_port: 40001, bytes: 10, packets: 1 },
    ])
    renderWithProviders(<StatusTable read={{ ...lensRead(), lens }} pairs={rows} />)
    expect(screen.getAllByTestId('microseg-status').map(c => c.dataset.status)).toEqual(['allowed', 'reply'])
    expect(screen.getAllByTestId('microseg-status')[1]).toHaveTextContent('Return traffic')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    fireEvent.mouseOver(screen.getAllByTestId('microseg-status')[0])
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(`Includes ${formatBytes(1024)} of return traffic`)
    expect(tip).toHaveTextContent('the status is for the last one sampled, tcp/5432')
  })

  it('explains the return traffic and a disabled destination zone', async () => {
    const lens = makeLens()
    const [orphan] = lens.rows([{ src_ip: '10.0.0.2', dst_ip: '10.0.0.1', protocol: 'TCP', dst_port: 51234, bytes: 10, packets: 1 }])
    const off = makeLens({ ...POLICY, zones: [POLICY.zones[0], { ...POLICY.zones[1], state: 'disabled' }] })
    const view = renderWithProviders(<StatusTable read={{ ...lensRead(), lens }} pairs={[orphan]} />)
    fireEvent.mouseOver(screen.getByTestId('microseg-status'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Return traffic of a connection web opened to db: port 51234 is a client port')
    view.unmount()

    renderWithProviders(<StatusTable read={{ ...lensRead(), lens: off }} pairs={[PAIRS[1]]} />)
    expect(screen.getByTestId('microseg-status').dataset.status).toBe('unknown')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    fireEvent.mouseOver(screen.getByTestId('microseg-status'))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('The zone db is disabled: the policy is not enforced for it')
  })

  it('offers Accept on a pending suggestion and Create flow when nothing covers the pair, nothing on the others', () => {
    renderWithProviders(<StatusTable read={lensRead()} pairs={PAIRS} />)
    const row = (src: string, port: number, proto: string) => within(screen.getByTestId(`row-${src}-${port}-${proto}`))
    expect(row('10.0.0.1', 5432, 'TCP').queryByRole('button')).not.toBeInTheDocument()
    expect(row('10.0.0.1', 22, 'TCP').getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(row('10.0.0.2', 443, 'TCP').getByRole('button', { name: 'Create flow' })).toBeEnabled()
    expect(row('10.0.0.2', 53, 'UDP').getByRole('button', { name: 'Accept' })).toBeEnabled()
    expect(row('10.0.0.3', 5432, 'TCP').queryByRole('button')).not.toBeInTheDocument()
  })

  it('accepts the suggestion against the draft version and reads the draft and the suggestions again', async () => {
    routes[`POST ${BASE}/suggestions/resolve`] = () => reply(200, { version: 8 })
    const read = lensRead()
    renderWithProviders(<StatusTable read={read} pairs={[PAIRS[1]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(read.reloadSuggestions).toHaveBeenCalled())
    expect(read.reloadPolicy).toHaveBeenCalled()
    const [[, init]] = callsTo(`POST ${BASE}/suggestions/resolve`)
    expect(JSON.parse(String(init?.body))).toEqual({ version: 7, ids: ['s1'], action: 'accept' })
  })

  it('shows why an accept failed', async () => {
    routes[`POST ${BASE}/suggestions/resolve`] = () => reply(503, { code: 'NOT_LEADER', error: 'not the leader' })
    renderWithProviders(<StatusTable read={lensRead()} pairs={[PAIRS[1]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('opens the flow window with the zones and the service of the pair, and creates the flow in the draft', async () => {
    routes[`POST ${BASE}/flows`] = () => reply(200, { version: 8, flow: {} })
    const read = lensRead()
    renderWithProviders(<StatusTable read={read} pairs={[PAIRS[2]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))

    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByLabelText('Port(s)')).toHaveValue('443')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const [[, init]] = callsTo(`POST ${BASE}/flows`)
    expect(JSON.parse(String(init?.body))).toMatchObject({ version: 7, src_zone_id: 'db', dst_zone_id: 'web', proto: 'tcp', dport: '443', origin: 'manual' })
    expect(read.reloadPolicy).toHaveBeenCalled()
    expect(read.reloadSuggestions).toHaveBeenCalled()
  })

  it('keeps the window open and reloads the draft on a version conflict', async () => {
    routes[`POST ${BASE}/flows`] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'moved' })
    const read = lensRead()
    renderWithProviders(<StatusTable read={read} pairs={[PAIRS[2]]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create flow' }))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(read.reloadPolicy).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'New flow' })).toBeInTheDocument()
  })

  it('disables the writes for a read-only user, with the reason', async () => {
    renderWithProviders(<StatusTable read={lensRead()} pairs={[PAIRS[1], PAIRS[2]]} canWrite={false} />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create flow' })).toBeDisabled()
    fireEvent.mouseOver(screen.getByRole('button', { name: 'Create flow' }).parentElement!)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Read-only')
  })
})

describe('TrafficByZoneStrip', () => {
  const pairs: LensPair[] = [
    ...PAIRS,
    { src_ip: '10.0.0.1', dst_ip: '10.0.0.1', protocol: 'TCP', dst_port: 80, bytes: 5000, packets: 1 },
    { src_ip: '10.0.0.2', dst_ip: '192.0.2.1', protocol: 'UDP', dst_port: 53, bytes: 5000, packets: 1 },
  ]

  it('splits the bytes inside a zone, between zones, to the outside and from unknown sources', () => {
    renderWithProviders(<TrafficByZoneStrip pairs={pairs} lens={makeLens()} />)
    expect(screen.getByText('Traffic by zone')).toBeInTheDocument()
    expect(screen.getByTestId('share-intra')).toHaveTextContent(`Intra-zone25%${formatBytes(5000)}`)
    expect(screen.getByTestId('share-between')).toHaveTextContent(`Between zones48%${formatBytes(9500)}`)
    expect(screen.getByTestId('share-outside')).toHaveTextContent(`To outside25%${formatBytes(5000)}`)
    expect(screen.getByTestId('share-unknown')).toHaveTextContent(`From unknown2.5%${formatBytes(500)}`)
  })

  it('draws the bytes per source zone in the zone colours', () => {
    renderWithProviders(<TrafficByZoneStrip pairs={pairs} lens={makeLens()} />)
    expect(screen.getByRole('img', { name: 'Bytes per source zone' })).toBeInTheDocument()
    expect(screen.getByTestId('donut-zone:web')).toHaveAttribute('stroke', '#3b82f6')
    expect(screen.getByTestId('donut-zone:db')).toHaveAttribute('stroke', '#10b981')
    expect(screen.getByTestId('donut-unzoned')).toBeInTheDocument()
    expect(screen.getByTestId('donut-external')).toBeInTheDocument()
    expect(screen.getByText('Unknown / External')).toBeInTheDocument()
    // Dot, name and share of every slice sit in the three columns of one grid.
    expect(screen.getByTestId('donut-legend').children).toHaveLength(4)
  })
})

function Probe() {
  const [groupBy, setGroupBy] = useGroupBy()
  const { connectionId, choose } = useLensConnection()
  const { state, lens } = useTrafficLens(connectionId)
  return (
    <div>
      <span data-testid='group-by'>{groupBy}</span>
      <span data-testid='connection'>{connectionId ?? '-'}</span>
      <span data-testid='state'>{state}</span>
      <span data-testid='verdict'>{lens ? lens.verdictOf(PAIRS[0]).status : '-'}</span>
      <button onClick={() => setGroupBy('ip')}>ip</button>
      <button onClick={() => choose('c1')}>c1</button>
    </div>
  )
}

describe('the lens hooks', () => {
  const live = (policy = POLICY) => {
    routes['GET /api/v1/connections?type=pve'] = () => reply(200, { data: [{ id: 'c1', name: 'PROD' }, { id: 'c2', name: 'DR' }] })
    for (const id of ['c1', 'c2']) {
      routes[`GET /api/v1/firewall/microseg/${id}/policy`] = () => reply(200, policy)
      routes[`GET /api/v1/firewall/microseg/${id}/suggestions?status=pending&limit=200`] = () => reply(200, { suggestions: SUGGESTIONS, limit: 200, offset: 0 })
      routes[`GET /api/v1/vms?connId=${id}`] = () => reply(200, VMS)
    }
  }

  it('starts from ?groupBy=zone&connection= (the link of the Micro-segmentation tab) and reads the zones', async () => {
    live()
    navigation.search = 'groupBy=zone&connection=c2'
    renderLive(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('zone')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('ready'))
    expect(screen.getByTestId('connection')).toHaveTextContent('c2')
    expect(screen.getByTestId('verdict')).toHaveTextContent('allowed')
  })

  it('remembers the grouping and the connection', async () => {
    live()
    window.localStorage.setItem('networkFlows.groupBy', 'zone')
    window.localStorage.setItem('networkFlows.lensConnection', 'c2')
    renderLive(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('zone')
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('c2'))
    fireEvent.click(screen.getByRole('button', { name: 'ip' }))
    fireEvent.click(screen.getByRole('button', { name: 'c1' }))
    expect(window.localStorage.getItem('networkFlows.groupBy')).toBe('ip')
    expect(window.localStorage.getItem('networkFlows.lensConnection')).toBe('c1')
    expect(screen.getByTestId('connection')).toHaveTextContent('c1')
  })

  it('falls back on VM and the first connection when nothing valid is asked or stored', async () => {
    live()
    navigation.search = 'groupBy=bogus&connection=gone'
    renderLive(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('vm')
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('c1'))
  })

  it('follows the search params of a client-side navigation, over the stored choice and the one made before', async () => {
    live()
    window.localStorage.setItem('networkFlows.groupBy', 'ip')
    const view = renderLive(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('ip')
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('c1'))

    // The Overview link of the Micro-segmentation tab: the router hands the new params to the mounted page.
    navigation.search = 'groupBy=zone&connection=c2'
    view.rerender(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('zone')
    expect(screen.getByTestId('connection')).toHaveTextContent('c2')

    // A choice made afterwards wins over the same params, and new params win again.
    fireEvent.click(screen.getByRole('button', { name: 'ip' }))
    expect(screen.getByTestId('group-by')).toHaveTextContent('ip')
    navigation.search = 'groupBy=vm'
    view.rerender(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('vm')
  })

  it('uses the stored grouping when the params ask for none, even with an invalid one', () => {
    live()
    window.localStorage.setItem('networkFlows.groupBy', 'zone')
    navigation.search = 'groupBy=bogus'
    renderLive(<Probe />)
    expect(screen.getByTestId('group-by')).toHaveTextContent('zone')
  })

  it('is unavailable until a policy is applied, and reads neither the suggestions nor the guests then', async () => {
    live({ ...POLICY, last_revision: null })
    renderLive(<Probe />)
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unavailable'))
    expect(callsTo('GET /api/v1/vms?connId=c1')).toHaveLength(0)
    expect(callsTo(`GET ${BASE}/suggestions?status=pending&limit=200`)).toHaveLength(0)
  })

  it('reads nothing without the micro-segmentation feature', async () => {
    license.microseg = false
    live()
    renderLive(<Probe />)
    await waitFor(() => expect(screen.getByTestId('connection')).toHaveTextContent('c1'))
    expect(screen.getByTestId('state')).toHaveTextContent('off')
    expect(callsTo(`GET ${BASE}/policy`)).toHaveLength(0)
  })

  it('says so when a read fails', async () => {
    live()
    routes[`GET /api/v1/vms?connId=c1`] = () => reply(500, {})
    renderLive(<Probe />)
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('error'))
  })
})
