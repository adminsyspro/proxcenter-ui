// src/lib/microseg/trafficGroups.ts
//
// The groups the Network Security Dashboard draws its observed traffic in (donut, time chart, volume): a zone, the
// guests in no zone, an address outside the cluster, the destinations outside the zones, and "Other".

export const UNZONED_KEY = 'unzoned'
export const EXTERNAL_KEY = 'external'
/** The destination group of an outbound flow to an address outside the zones (the "Outside" of the map). */
export const OUTSIDE_KEY = 'outside'
export const OTHER_KEY = 'other'
export const zoneKey = (zoneId: string) => `zone:${zoneId}`

/** The colours of the two groups that are not zones, and of the "Other" slice. */
export const GROUP_COLORS = { unzoned: '#9e9e9e', external: '#616161', other: '#bdbdbd', zone: '#64748b' } as const
