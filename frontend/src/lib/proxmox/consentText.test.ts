/**
 * `consent-text` is base64 of UTF-8 in datacenter.cfg (the Proxmox VE GUI
 * writes it that way, Proxmox VE 9.3 refuses anything else).
 */
import { describe, expect, it } from 'vitest'

import { decodeConsentText, encodeConsentText } from './consentText'

// Written by `pvesh set /cluster/options --consent-text` on the lab, 26/11/2026.
const LAB = 'VXNhZ2UgYXV0b3Jpc8OpIHVuaXF1ZW1lbnQuIExhYiBQcm94Q2VudGVyLg=='

describe('consent text', () => {
  it('decodes what the Proxmox VE GUI stored, accents included', () => {
    expect(decodeConsentText(LAB)).toBe('Usage autorisé uniquement. Lab ProxCenter.')
  })

  it('encodes the way Proxmox VE expects it', () => {
    expect(encodeConsentText('Usage autorisé uniquement. Lab ProxCenter.')).toBe(LAB)
  })

  it('round-trips multi-line and non-Latin text', () => {
    const text = '접근 제한\nAuthorized use only.\n仅限授权使用'
    expect(decodeConsentText(encodeConsentText(text))).toBe(text)
  })

  it('shows a clear text stored by an older ProxCenter as it is', () => {
    expect(decodeConsentText('Authorized use only')).toBe('Authorized use only')
    // valid base64 alphabet and length, but not UTF-8 once decoded
    expect(decodeConsentText('Test')).toBe('Test')
  })

  it('maps empty values to empty', () => {
    expect(decodeConsentText(undefined)).toBe('')
    expect(decodeConsentText('')).toBe('')
    expect(encodeConsentText('')).toBe('')
  })
})
