/**
 * The landing page.
 *
 * One promise, four steps, one honest paragraph about limits, one action.
 * No fabricated numbers, testimonials, logos or urgency: every claim on this
 * page is something the product can show.
 */

import Link from 'next/link';
import { CAPABILITY_STATEMENT } from '@/config/disclaimers';

function Icon({ name }: { name: 'understand' | 'check' | 'act' | 'control' }): React.ReactElement {
  const common = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'understand':
      return (
        <svg {...common} aria-hidden>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <circle cx="11.5" cy="14.5" r="2.5" />
          <path d="m13.5 16.5 2 2" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'act':
      return (
        <svg {...common} aria-hidden>
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      );
    case 'control':
      return (
        <svg {...common} aria-hidden>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
        </svg>
      );
  }
}

const PILLARS = [
  {
    icon: 'understand' as const,
    title: 'Understand',
    text: 'Upload a bill or a photo of one. We read the figures and lay them out plainly, and you confirm every number before anything else happens.',
  },
  {
    icon: 'check' as const,
    title: 'Check',
    text: 'A deterministic engine checks whether the line items add up, whether totals reconcile, and whether anything is repeated or dated wrong.',
  },
  {
    icon: 'act' as const,
    title: 'Take action',
    text: 'Every finding shows the numbers behind it, so you can ask the billing office a specific question rather than a vague one.',
  },
  {
    icon: 'control' as const,
    title: 'Feel in control',
    text: 'One case per bill. Your documents, results and timeline in one place, private to you, exportable or deletable at any time.',
  },
];

export default function HomePage(): React.ReactElement {
  return (
    <div className="shell">
      <section className="hero">
        <div className="hero__rule" />
        <h1>Understand your medical bills before you pay.</h1>
        <p className="lede">
          Review. Compare. Take action. Wintora checks whether the arithmetic on a
          medical bill holds together, and shows you exactly what it found.
        </p>
        <div className="hero__actions">
          <Link href="/signup" className="btn btn--primary btn--lg">
            Get started
          </Link>
          <Link href="/medical-bill-checker" className="btn btn--secondary btn--lg">
            Try it without an account
          </Link>
        </div>
        <p className="hero__proof">
          Free plan, no card. The free checker keeps nothing unless you choose to save it.
        </p>
      </section>

      <section>
        <div className="pillars">
          {PILLARS.map((p) => (
            <div className="pillar" key={p.title}>
              <div className="pillar__icon">
                <Icon name={p.icon} />
              </div>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ paddingTop: '4rem' }}>
        <div className="two-col" style={{ alignItems: 'start' }}>
          <div>
            <p className="eyebrow">What it does</p>
            <ul className="plan__features">
              {CAPABILITY_STATEMENT.does.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="eyebrow" style={{ color: 'var(--ink-400)' }}>What it does not</p>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: '0.45rem' }}>
              {CAPABILITY_STATEMENT.doesNot.map((item) => (
                <li key={item} className="small muted">
                  — {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: '1.5rem' }}>
          Both lists matter equally. Knowing where a tool stops is what makes the rest of
          it worth trusting.
        </p>
      </section>

      <section style={{ paddingTop: '3rem', textAlign: 'center' }}>
        <h2>Real people. Real answers. A clearer path forward.</h2>
        <p className="lede" style={{ marginInline: 'auto' }}>
          Private by design. Every letter is a draft you review and send yourself.
          Wintora never contacts anyone on your behalf.
        </p>
        <div className="hero__actions">
          <Link href="/signup" className="btn btn--primary btn--lg">
            Create a free account
          </Link>
          <Link href="/pricing" className="btn btn--quiet btn--lg">
            See pricing
          </Link>
        </div>
      </section>
    </div>
  );
}
