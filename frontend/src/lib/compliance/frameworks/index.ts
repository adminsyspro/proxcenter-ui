import type { FrameworkDef, FrameworkId } from './types'
import { NIST_800_53_R5_CONTROLS } from './catalog.nist-800-53-r5'
import { NIST_800_171_R2_CONTROLS } from './catalog.nist-800-171-r2'
import { CMMC_L2_CONTROLS } from './catalog.cmmc-l2'

export { getCrosswalk } from './crosswalk'

const REV2_NOTE = 'Rev 2 (CMMC-contract-targeted). Rev 3 (2024) exists but is not yet contractually required.'

export const FRAMEWORKS: FrameworkDef[] = [
  {
    id: 'nist-800-53-r5',
    name: 'NIST SP 800-53',
    version: 'Rev 5',
    sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final',
    baselineLabel: 'Moderate baseline',
    description: 'NIST SP 800-53 is the U.S. federal catalog of security and privacy controls for information systems and organizations. The Moderate baseline applies to systems where a loss of confidentiality, integrity, or availability would have a serious adverse effect.',
    controls: NIST_800_53_R5_CONTROLS,
  },
  {
    id: 'nist-800-171-r2',
    name: 'NIST SP 800-171',
    version: 'Rev 2',
    sourceUrl: 'https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final',
    description: 'NIST SP 800-171 defines requirements for protecting Controlled Unclassified Information (CUI) in nonfederal systems and organizations: 110 requirements across 14 families. It is the technical baseline that CMMC Level 2 builds on.',
    provenanceNote: REV2_NOTE,
    controls: NIST_800_171_R2_CONTROLS,
  },
  {
    id: 'cmmc-l2',
    name: 'CMMC',
    version: 'Level 2',
    sourceUrl: 'https://dodcio.defense.gov/CMMC/',
    description: 'CMMC (Cybersecurity Maturity Model Certification) is the U.S. Department of Defense framework for safeguarding CUI across the defense supply chain. Level 2 maps one-to-one to the 110 NIST SP 800-171 Rev 2 requirements.',
    provenanceNote: REV2_NOTE,
    controls: CMMC_L2_CONTROLS,
  },
]

export function getFramework(id: FrameworkId): FrameworkDef {
  const f = FRAMEWORKS.find(x => x.id === id)
  if (!f) throw new Error(`unknown framework: ${id}`)
  return f
}
