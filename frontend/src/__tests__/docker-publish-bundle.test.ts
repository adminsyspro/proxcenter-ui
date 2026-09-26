import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// The bundle job is the only producer of the official air-gapped artefacts.
// A YAML parser is not a dependency of the frontend, so this pins the lines
// that matter as text.
const wf = readFileSync(join(__dirname, '..', '..', '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8')

describe('docker-publish bundle job', () => {
  it('runs on tags only, after the release, for both editions', () => {
    const job = wf.slice(wf.indexOf('\n  bundle:'))
    expect(job).toContain("if: startsWith(github.ref, 'refs/tags/v')")
    expect(job).toContain('needs: [release]')
    expect(job).toContain('edition: [community, enterprise]')
    expect(job).toContain('./install-airgap.sh bundle --edition "$EDITION" --version "$VERSION" --compose "docker-compose.$EDITION.yml" --output dist')
  })

  it('attaches the community bundle to the release and pushes the enterprise one to R2 only when the secrets exist', () => {
    const job = wf.slice(wf.indexOf('\n  bundle:'))
    expect(job).toContain('gh release upload "$TAG" dist/proxcenter-community-')
    expect(job).toContain("if: matrix.edition == 'enterprise' && env.R2_ACCESS_KEY_ID != ''")
    expect(job).toContain('r2.cloudflarestorage.com')
    expect(job).toContain('s3://proxcenter-bundles/enterprise/')
  })
})
