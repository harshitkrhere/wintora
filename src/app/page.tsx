import Link from 'next/link';
import { CAPABILITY_STATEMENT } from '@/config/disclaimers';

export default function HomePage(): React.ReactElement {
  return (
    <div className="shell">
      <section style={{ paddingTop: '4rem' }}>
        <h1>Understand your medical bills before you pay.</h1>
        <p className="lede">
          Review bills, compare documents, prepare requests, and keep everything
          organised in one private workspace.
        </p>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
          <Link href="/medical-bill-checker" className="btn btn--primary">
            Review my bill
          </Link>
          <Link href="/methodology" className="btn btn--secondary">
            See how it works
          </Link>
        </div>

        <p className="small muted" style={{ marginTop: '1rem' }}>
          The checker runs without an account. Nothing is saved unless you choose to
          save it.
        </p>
      </section>

      <section>
        <div className="two-col">
          <div className="card">
            <h3>Private by design</h3>
            <p className="small">
              Documents are encrypted, stored in private buckets, and never used to
              train models. You can export or delete everything at any time, on every
              plan.
            </p>
          </div>
          <div className="card">
            <h3>Transparent pricing</h3>
            <p className="small">
              Four plans, all limits published, no hidden renewal. Cancel in one click
              and keep your access until the period you paid for ends.
            </p>
          </div>
          <div className="card">
            <h3>You stay in control</h3>
            <p className="small">
              Every letter is a draft you review and send yourself. Wintora never
              contacts a provider, insurer or agency on your behalf.
            </p>
          </div>
          <div className="card">
            <h3>Source-backed information</h3>
            <p className="small">
              Guidance cites where it came from and when it was last verified. If a
              source changes, we stop showing the claim until it is reviewed.
            </p>
          </div>
        </div>
      </section>

      <section>
        <h2>What it does, and what it does not</h2>
        <p className="muted" style={{ marginBottom: '1.5rem' }}>
          Both lists matter equally. Knowing where a tool stops is what makes the rest
          of it trustworthy.
        </p>

        <div className="two-col">
          <div>
            <h3>What Wintora does</h3>
            <ul className="plan__features">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3>What Wintora does not do</h3>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.4rem' }}>
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item} className="small muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <h2>How people use it</h2>
        <div className="two-col">
          <div>
            <p className="eyebrow">Step one</p>
            <h3>Check the arithmetic</h3>
            <p className="small">
              Enter or upload the figures from your statement. Wintora checks whether
              the line items add up to the stated totals, looks for repeated entries,
              and flags dates that cannot be right.
            </p>
          </div>
          <div>
            <p className="eyebrow">Step two</p>
            <h3>Compare with your EOB</h3>
            <p className="small">
              If you have an explanation of benefits, compare the two documents. A
              difference is common and usually has an ordinary explanation, but it is
              worth a question.
            </p>
          </div>
          <div>
            <p className="eyebrow">Step three</p>
            <h3>Prepare a request</h3>
            <p className="small">
              Generate a clear, polite request for an itemised statement, a
              clarification, a payment plan or a financial assistance application. You
              review it, edit it, and send it yourself.
            </p>
          </div>
          <div>
            <p className="eyebrow">Step four</p>
            <h3>Keep track</h3>
            <p className="small">
              Everything stays in one case with a dated timeline, so when someone asks
              what you sent and when, you have the answer.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Start with one bill</h2>
          <p>
            The free plan includes one case, real analysis using the same engine every
            paid plan uses, and a request letter. No card required.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link href="/medical-bill-checker" className="btn btn--primary">
              Review my bill
            </Link>
            <Link href="/pricing" className="btn btn--secondary">
              Compare plans
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
