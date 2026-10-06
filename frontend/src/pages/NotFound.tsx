import { Link } from 'react-router-dom'
import { EmptyState } from '../components/StatusViews'

export function NotFound() {
  return (
    <EmptyState title="Page not found">
      That address does not exist. <Link to="/">Return to the start</Link>.
    </EmptyState>
  )
}
