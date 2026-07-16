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

function seedValidateOk(capture: { body?: unknown }, externalUrl?: string) {
  server.use(
    http.post('*/api/v1/ha/validate', async ({ request }) => {
      capture.body = await request.json()
      return HttpResponse.json({
        results: [
          { ...PASSING_NODE, ip: '10.0.0.11' },
          { ...PASSING_NODE, ip: '10.0.0.12' },
          { ...PASSING_NODE, ip: '10.0.0.13' },
        ],
        global: { vipAvailable: true, externalUrl },
      })
    }),
  )
}

// Walks steps 0-3 and stops right after "All checks passed." is visible.
async function walkToValidationPassed(externalUrl?: string, externalUrlInput?: string) {
  const capture: { body?: unknown } = {}
  seedValidateOk(capture, externalUrl)
  renderWithProviders(<HaDeployWizard config={undefined} onDeployed={vi.fn()} />)

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

  // Step 2: network
  fireEvent.change(screen.getByLabelText('Virtual IP (VIP)'), { target: { value: '10.0.0.10' } })
  fireEvent.change(screen.getByLabelText('Network Interface'), { target: { value: 'ens18' } })
  if (externalUrlInput !== undefined) {
    fireEvent.change(screen.getByLabelText('External URL (optional)'), { target: { value: externalUrlInput } })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  // Step 3: validation
  fireEvent.click(screen.getByRole('button', { name: 'Run Validation' }))
  await screen.findByText('All checks passed.')

  return capture
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
    })
  })

  it('sends the External URL in the validate body when set', async () => {
    const capture = await walkToValidationPassed(undefined, 'https://pxc.example.com')
    expect((capture.body as { externalUrl?: string }).externalUrl).toBe('https://pxc.example.com')
  })

  it('shows the preserved external URL in the validation summary', async () => {
    await walkToValidationPassed('https://proxcenter.example.com')
    expect(screen.getByText(/External URL kept:/)).toBeInTheDocument()
    expect(screen.getByText(/proxcenter\.example\.com/)).toBeInTheDocument()
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
})
