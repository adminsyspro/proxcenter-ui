'use client'

import { createContext, useContext } from 'react'

export interface IncidentDialogApi {
  /** Opens the incident panel on an incident, or on the alert an incident could be opened for. */
  open: (incidentId: string | null, seedAlertId?: string) => void
}

// Without a provider (a test, a row used elsewhere) opening does nothing.
export const IncidentDialogContext = createContext<IncidentDialogApi>({ open: () => {} })

export const useIncidentDialog = () => useContext(IncidentDialogContext)
