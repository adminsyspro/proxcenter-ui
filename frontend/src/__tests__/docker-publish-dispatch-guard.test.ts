import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// A manual dispatch names its own image tag. The guard is what keeps one from
// overwriting the images of a published release, so its verdicts are pinned
// here by running the script the workflow runs.
const root = join(__dirname, '..', '..', '..')
const script = join(root, '.github', 'scripts', 'check-staging-inputs.sh')
const wf = readFileSync(join(root, '.github', 'workflows', 'docker-publish.yml'), 'utf8')

type Dispatch = { event: string; ref: string; staging?: string; version?: string; frontendRef?: string; backendRef?: string }

function accepted(d: Dispatch): boolean {
  const result = spawnSync('bash', [script], {
    // The six variables the script reads are all set: nothing it decides on
    // is inherited from the environment of the test run.
    env: {
      ...process.env,
      GH_EVENT: d.event,
      GH_REF: d.ref,
      INPUT_STAGING: d.staging ?? '',
      INPUT_VERSION: d.version ?? '',
      INPUT_FRONTEND_REF: d.frontendRef ?? '',
      INPUT_BACKEND_REF: d.backendRef ?? '',
    },
    encoding: 'utf8',
  })

  return result.status === 0
}

const main = 'refs/heads/main'
const branch = 'refs/heads/feature'
const tag = 'refs/tags/v1.5.0'

describe('docker-publish dispatch guard', () => {
  it.each<[string, Dispatch]>([
    ['a push to main', { event: 'push', ref: main }],
    ['a release tag', { event: 'push', ref: tag }],
    ['a pull request', { event: 'pull_request', ref: 'refs/pull/12/merge' }],
  ])('lets %s through', (_label, dispatch) => {
    expect(accepted(dispatch)).toBe(true)
  })

  it.each<[string, Dispatch]>([
    ['the default version', { event: 'workflow_dispatch', ref: main, staging: 'false', version: 'latest' }],
    ['no version', { event: 'workflow_dispatch', ref: main, staging: 'false' }],
    ['a release candidate', { event: 'workflow_dispatch', ref: main, staging: 'false', version: '1.5.1-rc1' }],
  ])('accepts a dispatch from main with %s', (_label, dispatch) => {
    expect(accepted(dispatch)).toBe(true)
  })

  it.each<[string, Dispatch]>([
    ['a release version', { event: 'workflow_dispatch', ref: main, staging: 'false', version: '1.5.0' }],
    ['a minor alias', { event: 'workflow_dispatch', ref: main, staging: 'false', version: '1.5' }],
    ['a major alias', { event: 'workflow_dispatch', ref: main, staging: 'false', version: '1' }],
    ['a v-prefixed candidate', { event: 'workflow_dispatch', ref: main, staging: 'false', version: 'v1.5.1-rc1' }],
    ['a version with a trailing part', { event: 'workflow_dispatch', ref: main, staging: 'false', version: '1.5.1-rc1-x' }],
    ['another branch', { event: 'workflow_dispatch', ref: branch, staging: 'false', version: 'latest' }],
    ['a candidate from another branch', { event: 'workflow_dispatch', ref: branch, staging: 'false', version: '1.5.1-rc1' }],
    ['a tag ref', { event: 'workflow_dispatch', ref: tag, staging: 'false', version: 'latest' }],
    ['source refs without staging', { event: 'workflow_dispatch', ref: main, staging: 'false', version: 'latest', frontendRef: 'feature', backendRef: 'main' }],
  ])('refuses a dispatch with %s', (_label, dispatch) => {
    expect(accepted(dispatch)).toBe(false)
  })

  it.each<[string, Dispatch]>([
    ['from a branch', { event: 'workflow_dispatch', ref: branch, staging: 'true', version: 'staging', frontendRef: 'feature', backendRef: 'main' }],
    ['with a versioned staging tag', { event: 'workflow_dispatch', ref: main, staging: 'true', version: '1.5.1-staging', frontendRef: 'main', backendRef: 'main' }],
  ])('accepts a staging build %s', (_label, dispatch) => {
    expect(accepted(dispatch)).toBe(true)
  })

  it.each<[string, Dispatch]>([
    ['under a release version', { event: 'workflow_dispatch', ref: branch, staging: 'true', version: '1.5.0', frontendRef: 'feature', backendRef: 'main' }],
    ['from a tag ref', { event: 'workflow_dispatch', ref: tag, staging: 'true', version: 'staging', frontendRef: 'feature', backendRef: 'main' }],
    ['without its backend ref', { event: 'workflow_dispatch', ref: branch, staging: 'true', version: 'staging', frontendRef: 'feature' }],
    ['outside a dispatch', { event: 'push', ref: main, staging: 'true', version: 'staging', frontendRef: 'feature', backendRef: 'main' }],
  ])('refuses a staging build %s', (_label, dispatch) => {
    expect(accepted(dispatch)).toBe(false)
  })

  it('runs before every job that tests or publishes', () => {
    expect(wf).toContain('run: bash .github/scripts/check-staging-inputs.sh')
    expect(wf.slice(wf.indexOf('\n  test:'), wf.indexOf('\n  build-frontend:'))).toContain('needs: [dispatch-guard]')
    expect(wf.slice(wf.indexOf('\n  test-backend:'), wf.indexOf('\n  build-orchestrator:'))).toContain('needs: [dispatch-guard]')
  })
})

describe('docker-publish backend tests', () => {
  // go.mod only states the minimum Go version: read from there, the tests that
  // gate the image ran on an older compiler than the one that builds it.
  it('run on the Go line of the orchestrator image, not on the minimum of go.mod', () => {
    const job = wf.slice(wf.indexOf('\n  test-backend:'), wf.indexOf('\n  build-orchestrator:'))

    expect(job).toMatch(/go-version: '\d+\.\d+\.x'/)
    expect(job).toContain('check-latest: true')
    expect(job).not.toContain('go-version-file')
  })
})
