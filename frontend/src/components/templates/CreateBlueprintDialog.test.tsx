import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: true, currentTenant: { id: 'default', name: 'default', slug: 'default' }, loading: false }),
}))
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))
vi.mock('./VendorLogo', () => ({ default: () => null }))

import CreateBlueprintDialog from './CreateBlueprintDialog'
import { CLOUD_IMAGES } from '@/lib/templates/cloudImages'

/** A served catalog that deliberately excludes the embedded first slug. */
const served = [
  {
    slug: 'debian-13', name: 'Debian 13 served', vendor: 'debian', version: '13', arch: 'amd64', format: 'qcow2',
    downloadUrl: 'https://img.test/d.qcow2', checksumUrl: null, defaultDiskSize: '20G', minMemory: 512,
    recommendedMemory: 2048, minCores: 1, recommendedCores: 2, ostype: 'l26', tags: [], logoIcon: 'ri-cloud-line',
    isCustom: false, isShared: true,
  },
]

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/api/v1/templates/catalog')) {
      return new Response(JSON.stringify({ data: { images: served, vendors: [], meta: null } }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }

    return new Response(JSON.stringify({ data: { options: [] } }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

/**
 * The image Select renders no accessible name of its own, and the dialog has a
 * second combobox (the network Autocomplete), so reach it through its label.
 */
function imageSelect(): HTMLElement {
  const control = screen.getByText('Image', { selector: 'label' }).closest('.MuiFormControl-root')

  return control!.querySelector('[role="combobox"]') as HTMLElement
}

beforeEach(() => { stubFetch() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('CreateBlueprintDialog image reconciliation', () => {
  it('moves a new blueprint onto an image the served catalog actually offers', async () => {
    // The embedded list seeds imageSlug before the fetch lands, and the served
    // catalog has retired that slug: without reconciliation the Select stays
    // blank while Save persists the retired slug.
    expect(CLOUD_IMAGES[0].slug).not.toBe('debian-13')
    renderWithProviders(<CreateBlueprintDialog open onClose={() => {}} />)

    await waitFor(() => expect(imageSelect().textContent).toContain('Debian 13 served'))
  })

  it('keeps an existing blueprint on its own image, retired or not', async () => {
    renderWithProviders(
      <CreateBlueprintDialog
        open
        onClose={() => {}}
        blueprint={{ id: 'bp1', name: 'Legacy', imageSlug: 'ubuntu-1804', isPublic: true, hardware: {}, cloudInit: null } as never}
      />,
    )

    // The catalog has loaded; edit mode must not rewrite the stored slug onto
    // the first served image just because the catalog no longer lists it.
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0))
    await waitFor(() => expect(imageSelect().textContent).not.toContain('Debian 13 served'))
  })
})
