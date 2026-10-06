import { Link, Outlet } from 'react-router-dom'
import { Button } from '../components/Button'
import { useTheme } from '../theme/useTheme'

export function AppShell() {
  const { theme, toggle } = useTheme()
  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="masthead">
        <Link to="/" className="wordmark">EvidenceOS</Link>
        <nav aria-label="Primary" className="masthead__nav">
          <Link to="/investigations/new">New investigation</Link>
          <Button variant="quiet" onClick={toggle} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? 'Dark mode' : 'Light mode'}
          </Button>
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
