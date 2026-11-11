import { describe, it, expect, beforeEach, vi } from 'vitest'

import { truncate } from '@/__tests__/setup/prisma-test'

import { getAsset, putAsset } from './assetStore'

// What sharp does on a CPU without x86-64-v2 (a VM on the kvm64 CPU type).
vi.mock('sharp', () => {
  throw new Error(
    'Could not load the "sharp" module using the linuxmusl-x64 runtime\nUnsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture\nPossible solutions:',
  )
})

// Imported statically on purpose: the module must load even though sharp cannot.
import { EMAIL_LOGO_SLOT, backfillEmailLogos, renderEmailLogo, syncEmailLogo } from './emailLogo'

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"/>')

beforeEach(() => truncate(['uploaded_assets']))

describe('emailLogo when sharp cannot be loaded', () => {
  it('renders nothing and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await renderEmailLogo(SVG)).toBeNull()
    expect(await renderEmailLogo(SVG)).toBeNull()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[branding\] email logo copies disabled, sharp cannot be loaded: /)
  })

  it('empties the email slot on a logo upload, so the emails show the brand name', async () => {
    await putAsset('default', 'branding', EMAIL_LOGO_SLOT, 'png', 'image/png', Buffer.from('previous'))

    expect(await syncEmailLogo('default', SVG)).toBe(false)
    expect(await getAsset('default', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
  })

  it('skips the startup backfill and leaves existing copies alone', async () => {
    await putAsset('default', 'branding', 'logo', 'svg', 'image/svg+xml', SVG)
    await putAsset('acme', 'branding', 'logo', 'svg', 'image/svg+xml', SVG)
    await putAsset('acme', 'branding', EMAIL_LOGO_SLOT, 'png', 'image/png', Buffer.from('existing'))

    expect(await backfillEmailLogos()).toBe(0)
    expect(await getAsset('default', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
    expect((await getAsset('acme', 'branding', EMAIL_LOGO_SLOT))?.data.toString()).toBe('existing')
  })
})
