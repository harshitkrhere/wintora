'use client';

/**
 * What to do next about a bill, as a list that can be ticked off.
 *
 * The steps come from the latest check on the case; the ticks are the
 * customer's, and each one is recorded on the case timeline, so coming back
 * a week later shows exactly where things stood. This is the record the
 * product exists to keep. Nothing here contacts anyone: a tick says "I did
 * this", not "do this for me".
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface Step {
  readonly text: string;
  readonly done: boolean;
}

export function NextSteps({ caseId, steps }: { caseId: string; steps: readonly Step[] }): React.ReactElement {
  const router = useRouter();
  const [items, setItems] = useState<readonly Step[]>(steps);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doneCount = items.filter((s) => s.done).length;
  const allDone = doneCount === items.length;

  const toggle = async (step: Step): Promise<void> => {
    const next = !step.done;
    setError(null);
    setPending(step.text);
    // Shown as done at once; put back if the record did not take.
    setItems((prev) => prev.map((s) => (s.text === step.text ? { ...s, done: next } : s)));
    try {
      const response = await fetch(`/api/cases/${caseId}/steps`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ step: step.text, done: next }),
      });
      if (!response.ok) throw new Error('not recorded');
      // The timeline beneath is server-rendered; ask for it again.
      router.refresh();
    } catch {
      setItems((prev) => prev.map((s) => (s.text === step.text ? { ...s, done: step.done } : s)));
      setError('That was not recorded. Please check your connection and try again.');
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="card stack" aria-labelledby="next-steps-heading">
      <div className="section-head">
        <h2 id="next-steps-heading">What to do next</h2>
        <span className={`badge ${allDone ? 'badge--success' : 'badge--neutral'}`} aria-live="polite">
          {allDone ? 'All done' : `${doneCount} of ${items.length} done`}
        </span>
      </div>
      <ul className="checklist">
        {items.map((step) => (
          <li key={step.text} className={`checklist__item${step.done ? ' checklist__item--done' : ''}`}>
            <label className="checklist__label">
              <input
                type="checkbox"
                className="checklist__box"
                checked={step.done}
                disabled={pending === step.text}
                onChange={() => void toggle(step)}
              />
              <span>{step.text}</span>
            </label>
          </li>
        ))}
      </ul>
      {error !== null ? (
        <p role="alert" className="notice notice--error">
          {error}
        </p>
      ) : null}
      <p className="caption card__last">
        Ticking a step records it on the timeline, so the case remembers what you have done.
        Nothing is sent to anyone.
      </p>
    </section>
  );
}
