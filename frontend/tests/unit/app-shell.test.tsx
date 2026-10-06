import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from '../../src/App'

describe('application shell', () => {
  it('renders the product name without claiming backend state', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('<h1>EvidenceOS</h1>')
    expect(markup).toContain('Application shell.')
  })
})
