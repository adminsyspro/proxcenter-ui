import React, { type ReactNode } from 'react'
import { SWRConfig } from 'swr'

/** Cache SWR neuf par rendu, pour que les tests ne se contaminent pas. */
export const swrWrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)

export { inventoryBody, jsonRes, liveBody } from './testHelpers'
