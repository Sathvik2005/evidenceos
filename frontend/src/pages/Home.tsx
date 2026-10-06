import { Link } from 'react-router-dom'

export function Home() {
  return (
    <section className="hero">
      <p className="eyebrow">Evidence operating system</p>
      <h1>Build evidence. Track change. Understand what holds up.</h1>
      <p className="lede">
        EvidenceOS does not tell you what to believe. It shows what the available evidence currently
        supports, where it conflicts, what remains uncertain, and what changed when new evidence arrived.
      </p>
      <Link className="button button--primary" to="/investigations/new">Begin an investigation</Link>
    </section>
  )
}
