import { Route, Routes } from 'react-router-dom'
import { AppShell } from './layout/AppShell'
import { ClaimDetailPage } from './pages/ClaimDetailPage'
import { GraphPage } from './pages/GraphPage'
import { Home } from './pages/Home'
import { InvestigationPage } from './pages/InvestigationPage'
import { NewInvestigation } from './pages/NewInvestigation'
import { NotFound } from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="investigations/new" element={<NewInvestigation />} />
        <Route path="investigations/:id" element={<InvestigationPage />} />
        <Route path="investigations/:id/claims/:claimId" element={<ClaimDetailPage />} />
        <Route path="investigations/:id/graph" element={<GraphPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
