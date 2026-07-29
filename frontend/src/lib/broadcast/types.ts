// src/lib/broadcast/types.ts
//
// Payload shapes shared by the server and the client. Deliberately free of
// any import: client components and hooks pull PublicBroadcast from here so
// they never name a Prisma-backed module, not even in a type position.

/** Everything an admin may write. Matches the parsed broadcastMessageSchema. */
export interface BroadcastInput {
  message: string
  linkUrl: string | null
  linkLabel: string | null
  bgColor: string
  fgColor: string
  dismissible: boolean
  enabled: boolean
  startsAt: Date | null
  endsAt: Date | null
  targetKind: 'all' | 'tenants' | 'roles'
  targetIds: string[]
}

/** What a non-admin caller is allowed to see: no targeting, no author. */
export interface PublicBroadcast {
  id: string
  message: string
  linkUrl: string | null
  linkLabel: string | null
  bgColor: string
  fgColor: string
  dismissible: boolean
  updatedAt: string
}
