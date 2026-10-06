import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { GatewayProvider } from './gateway/GatewayProvider'
import { createHttpGateway } from './gateway/httpGateway'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The application root element is missing.')
}

// The browser talks only to the same-origin EvidenceOS API; the server owns identity and credentials.
const gateway = createHttpGateway('/api')

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <GatewayProvider gateway={gateway}>
        <App />
      </GatewayProvider>
    </BrowserRouter>
  </StrictMode>,
)
