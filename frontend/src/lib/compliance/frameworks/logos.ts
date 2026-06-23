import type { FrameworkId } from './types'

// Single source of truth for the per-framework badge assets. Files live in
// public/images/frameworks/: served to the browser by the Frameworks tab and
// read from disk to embed (base64 data URI) in the PDF report. The two NIST
// frameworks share the NIST wordmark. PNG so WeasyPrint (Pillow) renders them
// reliably in the PDF (webp support is not guaranteed in the sidecar).
export const FRAMEWORK_LOGO_FILES: Record<FrameworkId, string> = {
  'nist-800-53-r5': 'nist.png',
  'nist-800-171-r2': 'nist.png',
  'cmmc-l2': 'cmmc.png',
  'iso-27001-2022': 'iso.png',
}

export const FRAMEWORK_LOGO_DIR = '/images/frameworks'
