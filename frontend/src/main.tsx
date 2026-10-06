import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App'
import { GatewayProvider } from './gateway/GatewayProvider'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('The application root element is missing.')
}

// No live backend adapter exists yet (the Momen schema is not available), so the gateway is
// absent and screens report that honestly instead of showing invented data.
createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <GatewayProvider gateway={null}>
        <App />
      </GatewayProvider>
    </BrowserRouter>
  </StrictMode>,
)
