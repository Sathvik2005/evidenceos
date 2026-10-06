import { createContext, useContext } from 'react'
import type { InvestigationGateway } from './types'

export const GatewayContext = createContext<InvestigationGateway | null>(null)

/** Null when no backend is configured; screens must then say so, not fake data. */
export function useGateway(): InvestigationGateway | null {
  return useContext(GatewayContext)
}
