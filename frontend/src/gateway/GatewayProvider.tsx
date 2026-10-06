import type { ReactNode } from 'react'
import { GatewayContext } from './gatewayContext'
import type { InvestigationGateway } from './types'

export function GatewayProvider({ gateway, children }: { gateway: InvestigationGateway | null; children: ReactNode }) {
  return <GatewayContext.Provider value={gateway}>{children}</GatewayContext.Provider>
}
