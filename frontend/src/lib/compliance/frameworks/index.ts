import type { FrameworkDef, FrameworkId } from './types'
import { NIST_800_53_R5_CONTROLS } from './catalog.nist-800-53-r5'
import { NIST_800_171_R3_CONTROLS } from './catalog.nist-800-171-r3'
import { CMMC_L2_CONTROLS } from './catalog.cmmc-l2'
import { ISO_27001_2022_CONTROLS } from './catalog.iso-27001-2022'
import { CIS_CONTROLS_V8_1_CONTROLS } from './catalog.cis-controls-v8-1'

export { getCrosswalk } from './crosswalk'

const REV3_NOTE = 'Rev 3 (May 2024): the 97 requirements in force across 17 families. Withdrawn Rev 3 identifiers are not scored. CMMC Level 2 is still assessed against Rev 2.'
const CMMC_NOTE = 'Derived from NIST SP 800-171 Rev 2 (110 requirements), the revision the CMMC program rule (32 CFR Part 170) still references.'

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
    id: 'nist-800-171-r3',
    name: 'NIST SP 800-171',
    version: 'Rev 3',
    sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/171/r3/final',
    provenanceNote: REV3_NOTE,
    controls: NIST_800_171_R3_CONTROLS,
  },
  {
    id: 'cmmc-l2',
    name: 'CMMC',
    version: 'Level 2',
    sourceUrl: 'https://dodcio.defense.gov/CMMC/',
    provenanceNote: CMMC_NOTE,
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
  {
    id: 'cis-controls-v8-1',
    name: 'CIS Controls',
    version: 'v8.1',
    sourceUrl: 'https://www.cisecurity.org/controls/cis-controls-list',
    provenanceNote: 'Safeguard identifiers and short titles only. CIS Controls descriptive text is copyright Center for Internet Security and is not reproduced here. The score is a technical pass rate over assessable safeguards, not a CIS certification.',
    controls: CIS_CONTROLS_V8_1_CONTROLS,
  },
]

export function getFramework(id: FrameworkId): FrameworkDef {
  const f = FRAMEWORKS.find(x => x.id === id)
  if (!f) throw new Error(`unknown framework: ${id}`)
  return f
}
