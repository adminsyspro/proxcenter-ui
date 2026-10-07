/**
 * Component tests for HaDeployWizard.tsx (Task 7 features only).
 *
 * Strategy: walk the wizard to the validation step with MSW seeding the
 * validate endpoint, then assert (1) the captured request body carries
 * vipInterface, (2) the preserved external URL is displayed, (3) the
 * deployment step shows the backup path and gates the deploy button behind
 * the snapshot checkbox. The Deploy button is never clicked: jsdom has no
 * EventSource and the deploy flow is out of scope here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import HaDeployWizard from './HaDeployWizard'

afterEach(cleanup)

const PASSING_NODE = {
  ssh: true,
  docker: true,
  dockerVersion: '27.1.1',
  dockerCompose: true,
  pgCompatible: true,
  ping: {},
}

function seedValidate(capture: { body?: unknown }, response: unknown) {
  server.use(
    http.post('*/api/v1/ha/validate', async ({ request }) => {
      capture.body = await request.json()
      return HttpResponse.json(response)
    }),
  )
}

function okResponse(externalUrl?: string) {
  return {
    results: [
      { ...PASSING_NODE, ip: '10.0.0.11' },
      { ...PASSING_NODE, ip: '10.0.0.12' },
      { ...PASSING_NODE, ip: '10.0.0.13' },
    ],
    global: { vipAvailable: true, externalUrl },
  }
}

// Walks steps 0-3 and stops right after "All checks passed." is visible.
async function walkToValidationPassed(externalUrl?: string, externalUrlInput?: string) {
  const capture = await walkToValidationResult(okResponse(externalUrl), externalUrlInput)
  await screen.findByText('All checks passed.')
  return capture
}

// Walks steps 0-3 and clicks Run Validation with the given seeded response.
async function walkToValidationResult(response: unknown, externalUrlInput?: string, onNetworkStep?: () => void) {
  const capture: { body?: unknown } = {}
  seedValidate(capture, response)
  renderWithProviders(<HaDeployWizard config={undefined} onDeployed={vi.fn()} />)

  walkToNetworkStep()

  // Step 2: network
  fireEvent.change(screen.getByLabelText('Virtual IP (VIP)'), { target: { value: '10.0.0.10' } })
  fireEvent.change(screen.getByLabelText('Network Interface'), { target: { value: 'ens18' } })
  if (externalUrlInput !== undefined) {
    fireEvent.change(screen.getByLabelText('External URL (optional)'), { target: { value: externalUrlInput } })
  }
  onNetworkStep?.()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  // Step 3: validation
  fireEvent.click(screen.getByRole('button', { name: 'Run Validation' }))
  await screen.findByText('Check')

  return capture
}

// Steps 0-1 (the wizard must already be rendered).
function walkToNetworkStep() {
  // Step 0: prerequisites
  fireEvent.click(screen.getByRole('checkbox', { name: /I confirm all prerequisites are met/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  // Step 1: nodes
  const ips = screen.getAllByLabelText('IP Address')
  const passwords = screen.getAllByLabelText('Root SSH Password')
  const nodeIps = ['10.0.0.11', '10.0.0.12', '10.0.0.13']
  nodeIps.forEach((ip, i) => {
    fireEvent.change(ips[i], { target: { value: ip } })
    fireEvent.change(passwords[i], { target: { value: `pw-${i}` } })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
}

async function walkToDeploymentStep(externalUrl?: string) {
  const capture = await walkToValidationPassed(externalUrl)
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('button', { name: 'Deploy HA Cluster' })
  return capture
}

describe('HaDeployWizard', () => {
  it('sends vipInterface in the validate request body', async () => {
    const capture = await walkToValidationPassed()
    expect(capture.body).toEqual({
      nodes: [
        { ip: '10.0.0.11', password: 'pw-0' },
        { ip: '10.0.0.12', password: 'pw-1' },
        { ip: '10.0.0.13', password: 'pw-2' },
      ],
      vip: '10.0.0.10',
      vipInterface: 'ens18',
      externalUrl: '',
      imageSource: { mode: '' },
    })
  })

  it('sends the External URL in the validate body when set', async () => {
    const capture = await walkToValidationPassed(undefined, 'https://pxc.example.com')
    expect((capture.body as { externalUrl?: string }).externalUrl).toBe('https://pxc.example.com')
  })

  it('shows the detected external URL in the validation summary', async () => {
    await walkToValidationPassed('https://proxcenter.example.com')
    expect(screen.getByText(/External URL detected on node 1:/)).toBeInTheDocument()
    expect(screen.getByText('proxcenter.example.com', { exact: false })).toBeInTheDocument()
  })

  it('shows the backup path and rollback behavior on the deployment step', async () => {
    await walkToDeploymentStep()
    expect(screen.getByText(/\/opt\/proxcenter\/backup-pre-patroni\.sql/)).toBeInTheDocument()
    expect(screen.getByText(/restarted automatically/)).toBeInTheDocument()
  })

  it('gates the deploy button behind the snapshot checkbox', async () => {
    await walkToDeploymentStep()
    const deployBtn = screen.getByRole('button', { name: 'Deploy HA Cluster' })
    expect(deployBtn).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /I have taken a VM snapshot of this server/ }))
    expect(deployBtn).toBeEnabled()
  })

  describe('image source', () => {
    const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----'

    function fillRegistry() {
      fireEvent.click(screen.getByRole('radio', { name: 'Private registry (Harbor, ...)' }))
      fireEvent.change(screen.getByLabelText('Registry'), { target: { value: 'harbor.example.com:8443/proxcenter/' } })
      fireEvent.change(screen.getByLabelText('Username (optional)'), { target: { value: 'robot$pxc' } })
      fireEvent.change(screen.getByLabelText('Password or token (optional)'), { target: { value: 's3cret' } })
      fireEvent.change(screen.getByLabelText('Registry CA certificate (optional, PEM)'), { target: { value: PEM } })
    }

    it('sends the registry, CA and credentials in the validate body', async () => {
      const capture = await walkToValidationResult(okResponse(), undefined, fillRegistry)
      expect(capture.body).toMatchObject({
        imageSource: { mode: 'registry', registry: 'harbor.example.com:8443/proxcenter', caCert: PEM },
        registryUsername: 'robot$pxc',
        registryPassword: 's3cret',
      })
    })

    it('blocks Next on an invalid registry', () => {
      renderWithProviders(<HaDeployWizard config={undefined} onDeployed={vi.fn()} />)
      walkToNetworkStep()
      fireEvent.change(screen.getByLabelText('Virtual IP (VIP)'), { target: { value: '10.0.0.10' } })
      fireEvent.click(screen.getByRole('radio', { name: 'Private registry (Harbor, ...)' }))
      // Empty registry blocks too.
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      fireEvent.change(screen.getByLabelText('Registry'), { target: { value: 'https://harbor.example.com/ProxCenter' } })
      expect(screen.getByText(/Invalid registry/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      fireEvent.change(screen.getByLabelText('Registry'), { target: { value: 'harbor.example.com/proxcenter' } })
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })

    it('shows the load hint in air-gapped mode and sends mode local', async () => {
      const capture = await walkToValidationResult(okResponse(), undefined, () => {
        fireEvent.click(screen.getByRole('radio', { name: 'Air-gapped, images loaded on each node' }))
        expect(screen.getByText('sudo ./install-airgap.sh load')).toBeInTheDocument()
      })
      expect((capture.body as { imageSource?: unknown }).imageSource).toEqual({ mode: 'local' })
      expect(capture.body).not.toHaveProperty('registryUsername')
    })

    it('prefills the image source from the saved config', () => {
      renderWithProviders(
        <HaDeployWizard
          config={{
            enabled: false, vip: '10.0.0.10', vipInterface: 'eth0', deploymentState: 'idle',
            deploymentStep: 0, deployedAt: null, nodes: [],
            imageSource: { mode: 'registry', registry: 'harbor.example.com/pxc' },
          }}
          onDeployed={vi.fn()}
        />,
      )
      walkToNetworkStep()
      expect(screen.getByRole('radio', { name: 'Private registry (Harbor, ...)' })).toBeChecked()
      expect(screen.getByLabelText('Registry')).toHaveValue('harbor.example.com/pxc')
    })

    it('carries the image source in the config and the credentials in the deploy body', async () => {
      class FakeEventSource {
        onmessage: unknown = null
        onerror: unknown = null
        close() {}
      }
      vi.stubGlobal('EventSource', FakeEventSource)
      const bodies: { config?: unknown; deploy?: unknown } = {}
      server.use(
        http.put('*/api/v1/ha/config', async ({ request }) => {
          bodies.config = await request.json()
          return HttpResponse.json({})
        }),
        http.post('*/api/v1/ha/deploy', async ({ request }) => {
          bodies.deploy = await request.json()
          return HttpResponse.json({})
        }),
      )
      try {
        await walkToValidationResult(okResponse(), undefined, fillRegistry)
        await screen.findByText('All checks passed.')
        fireEvent.click(screen.getByRole('button', { name: 'Next' }))
        fireEvent.click(await screen.findByRole('checkbox', { name: /I have taken a VM snapshot of this server/ }))
        fireEvent.click(screen.getByRole('button', { name: 'Deploy HA Cluster' }))
        await vi.waitFor(() => expect(bodies.deploy).toBeDefined())
        expect(bodies.config).toMatchObject({
          imageSource: { mode: 'registry', registry: 'harbor.example.com:8443/proxcenter', caCert: PEM },
        })
        expect(bodies.config).not.toHaveProperty('registryPassword')
        expect(bodies.deploy).toEqual({
          sshPasswords: { '10.0.0.11': 'pw-0', '10.0.0.12': 'pw-1', '10.0.0.13': 'pw-2' },
          registryUsername: 'robot$pxc',
          registryPassword: 's3cret',
        })
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('structured pre-flight checks', () => {
    const passChecks = [
      { name: 'registry', status: 'pass' },
      { name: 'tcpMatrix', status: 'pass' },
    ]

    it('shows a failed registry check on node 2 and keeps Next disabled', async () => {
      const base = okResponse()
      await walkToValidationResult({
        ...base,
        results: [
          { ...base.results[0], checks: passChecks },
          {
            ...base.results[1],
            checks: [
              { name: 'registry', status: 'fail', detail: 'cannot pull ghcr.io/adminsyspro/proxcenter-orchestrator' },
              { name: 'tcpMatrix', status: 'pass' },
            ],
          },
          { ...base.results[2], checks: passChecks },
        ],
        global: { ...base.global, checks: [{ name: 'existingStack', status: 'pass' }, { name: 'vipAddress', status: 'pass' }] },
      })

      expect(await screen.findByText('Images available')).toBeInTheDocument()
      expect(screen.getByText('Blocking issues')).toBeInTheDocument()
      expect(screen.getByText('proxcenter-2: cannot pull ghcr.io/adminsyspro/proxcenter-orchestrator')).toBeInTheDocument()
      expect(screen.getByText('Some checks failed. Fix the issues and retry.')).toBeInTheDocument()
      expect(screen.queryByText('All checks passed.')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
      // The global vipAddress check is skipped: the legacy VIP row covers it.
      expect(screen.queryByText('vipAddress')).not.toBeInTheDocument()
      expect(screen.getByText('Existing installation')).toBeInTheDocument()
    })

    it('blocks on a failed global check', async () => {
      const base = okResponse()
      await walkToValidationResult({
        ...base,
        global: { ...base.global, checks: [{ name: 'postgresVolume', status: 'fail', detail: 'volume pgdata already exists' }] },
      })

      expect(await screen.findByText('Database volume: volume pgdata already exists')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    })

    it('shows warn and unverifiable checks without blocking the deploy', async () => {
      const base = okResponse()
      await walkToValidationResult({
        ...base,
        results: [
          { ...base.results[0], checks: [{ name: 'listeners', status: 'warn', detail: 'port 8008 already in use' }] },
          { ...base.results[1], checks: [{ name: 'listeners', status: 'unverifiable', detail: 'ss not installed' }] },
          { ...base.results[2], checks: [{ name: 'listeners', status: 'pass' }] },
        ],
      })

      expect(await screen.findByText('All checks passed.')).toBeInTheDocument()
      expect(screen.getByText('Ports free')).toBeInTheDocument()
      expect(screen.getByText('Warnings (deployment is not blocked)')).toBeInTheDocument()
      expect(screen.getByText('proxcenter-1: port 8008 already in use')).toBeInTheDocument()
      expect(screen.getByText('proxcenter-2: ss not installed')).toBeInTheDocument()
      expect(screen.queryByText('Blocking issues')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })

    it('still passes when the orchestrator sends no checks', async () => {
      await walkToValidationPassed()
      expect(screen.queryByText('Images available')).not.toBeInTheDocument()
      expect(screen.queryByText('Blocking issues')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    })
  })
})
