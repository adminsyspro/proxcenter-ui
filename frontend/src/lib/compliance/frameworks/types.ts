export const FRAMEWORK_IDS = ['nist-800-53-r5', 'nist-800-171-r2', 'cmmc-l2', 'iso-27001-2022'] as const
export type FrameworkId = (typeof FRAMEWORK_IDS)[number]

export interface FrameworkControl {
  id: string
  title: string
  family: string
}

export interface FrameworkDef {
  id: FrameworkId
  name: string
  version: string
  sourceUrl: string
  baselineLabel?: string
  provenanceNote?: string
  controls: FrameworkControl[]
}

export interface CrosswalkMapping {
  controlIds: string[]
  rationale: string
}

export type Crosswalk = Record<string, CrosswalkMapping>
