import { describe, it, expect, beforeEach } from 'vitest'
import sharp from 'sharp'

import { truncate } from '@/__tests__/setup/prisma-test'

import { getAsset, putAsset } from './assetStore'
import { EMAIL_LOGO_SLOT, backfillEmailLogos, renderEmailLogo, syncEmailLogo } from './emailLogo'

beforeEach(() => truncate(['uploaded_assets']))

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" fill="#e57000"/></svg>',
)

function raster(width: number, height: number, format: 'png' | 'webp' | 'jpeg'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: '#1e293b' } })[format]().toBuffer()
}

async function sizeOf(png: Buffer) {
  const meta = await sharp(png).metadata()

  return { format: meta.format, width: meta.width, height: meta.height }
}

describe('renderEmailLogo', () => {
  it('rasterises an SVG to an 80 px high PNG keeping its ratio', async () => {
    const png = await renderEmailLogo(SVG)

    expect(png).not.toBeNull()
    expect(await sizeOf(png!)).toEqual({ format: 'png', width: 240, height: 80 })
  })

  it('converts a WEBP and fits a wide logo in 400 px', async () => {
    const png = await renderEmailLogo(await raster(1000, 100, 'webp'))

    expect(await sizeOf(png!)).toEqual({ format: 'png', width: 400, height: 40 })
  })

  it('converts a JPEG', async () => {
    const png = await renderEmailLogo(await raster(440, 340, 'jpeg'))

    expect(await sizeOf(png!)).toEqual({ format: 'png', width: 104, height: 80 })
  })

  it('returns null for what it cannot decode (ICO, garbage)', async () => {
    const ico = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 0, 0, 0, 0, 22, 0, 0, 0])

    expect(await renderEmailLogo(ico)).toBeNull()
    expect(await renderEmailLogo(Buffer.from('not an image'))).toBeNull()
  })
})

describe('syncEmailLogo', () => {
  it('stores the PNG copy in the logo-email slot of the tenant', async () => {
    expect(await syncEmailLogo('default', SVG)).toBe(true)

    const copy = await getAsset('default', 'branding', EMAIL_LOGO_SLOT)

    expect(copy?.contentType).toBe('image/png')
    expect(copy?.ext).toBe('png')
    expect((await sizeOf(copy!.data)).format).toBe('png')
    expect(await getAsset('tenant-x', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
  })

  it('drops the previous copy when the new logo cannot be rendered', async () => {
    await syncEmailLogo('default', SVG)

    expect(await syncEmailLogo('default', Buffer.from('not an image'))).toBe(false)
    expect(await getAsset('default', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
  })

  it('drops the copy when the logo is removed', async () => {
    await syncEmailLogo('default', SVG)

    expect(await syncEmailLogo('default', null)).toBe(false)
    expect(await getAsset('default', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
  })
})

describe('backfillEmailLogos', () => {
  it('renders a copy only for the logos that lack one', async () => {
    await putAsset('default', 'branding', 'logo', 'svg', 'image/svg+xml', SVG)
    await putAsset('acme', 'branding', 'logo', 'png', 'image/png', await raster(200, 50, 'png'))
    await putAsset('acme', 'branding', EMAIL_LOGO_SLOT, 'png', 'image/png', Buffer.from('existing'))
    await putAsset('globex', 'branding', 'favicon', 'png', 'image/png', await raster(16, 16, 'png'))

    expect(await backfillEmailLogos()).toBe(1)

    expect((await getAsset('default', 'branding', EMAIL_LOGO_SLOT))?.contentType).toBe('image/png')
    expect((await getAsset('acme', 'branding', EMAIL_LOGO_SLOT))?.data.toString()).toBe('existing')
    expect(await getAsset('globex', 'branding', EMAIL_LOGO_SLOT)).toBeNull()

    // Idempotent: the next boot finds nothing to do.
    expect(await backfillEmailLogos()).toBe(0)
  })

  it('does not count a logo that cannot be rendered', async () => {
    await putAsset('default', 'branding', 'logo', 'ico', 'image/x-icon', Buffer.from([0, 0, 1, 0]))

    expect(await backfillEmailLogos()).toBe(0)
    expect(await getAsset('default', 'branding', EMAIL_LOGO_SLOT)).toBeNull()
  })
})
