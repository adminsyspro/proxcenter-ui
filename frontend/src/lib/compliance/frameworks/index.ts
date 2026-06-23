import type { FrameworkDef, FrameworkId } from './types'
import { NIST_800_53_R5_CONTROLS } from './catalog.nist-800-53-r5'
import { NIST_800_171_R2_CONTROLS } from './catalog.nist-800-171-r2'
import { CMMC_L2_CONTROLS } from './catalog.cmmc-l2'
import { ISO_27001_2022_CONTROLS } from './catalog.iso-27001-2022'

export { getCrosswalk } from './crosswalk'

const REV2_NOTE = 'Rev 2 (CMMC-contract-targeted). Rev 3 (2024) exists but is not yet contractually required.'

export const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'nist-800-53-r5',
    name: 'NIST SP 800-53',
    version: 'Rev 5',
    sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final',
    baselineLabel: 'Moderate baseline',
    controls: NIST_800_53_R5_CONTROLS,
  },
  {
    id: 'nist-800-171-r2',
    name: 'NIST SP 800-171',
    version: 'Rev 2',
    sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final',
    provenanceNote: REV2_NOTE,
    controls: NIST_800_171_R2_CONTROLS,
  },
  {
    id: 'cmmc-l2',
    name: 'CMMC',
    version: 'Level 2',
    sourceUrl: 'https://dodcio.defense.gov/CMMC/',
    provenanceNote: REV2_NOTE,
    controls: CMMC_L2_CONTROLS,
  },
  {
    id: 'iso-27001-2022',
    name: 'ISO/IEC 27001',
    version: '2022',
    sourceUrl: 'https://www.iso.org/standard/27001',
    provenanceNote: 'Annex A control identifiers and concise titles. ISO/IEC 27001 normative text is copyright ISO and is not reproduced here.',
    controls: ISO_27001_2022_CONTROLS,
  },
]

export function getFramework(id: FrameworkId): FrameworkDef {
  const f = FRAMEWORKS.find(x => x.id === id)
  if (!f) throw new Error(`unknown framework: ${id}`)
  return f
}
