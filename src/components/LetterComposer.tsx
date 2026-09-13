'use client';

/**
 * Write a letter: pick a template, fill in the facts, get a draft.
 *
 * The template decides the words; the customer supplies every fact, and
 * the case fills in the ones it already knows. Nothing is sent. The draft
 * that comes back opens on its own page, where it is edited, confirmed and
 * downloaded.
 *
 * With ADVANCED_LETTERS the customer can also attach evidence: the case
 * documents they are enclosing, and the points the last check raised. Both
 * are appended to the draft as plain text.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TemplateField } from '@/domain/letters/render';
import { splitListInput } from '@/domain/letters/send';
import { Icon } from './Icons';

export interface TemplateSummary {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly fields: readonly TemplateField[];
  readonly isPremium: boolean;
}

export interface EvidenceOption {
  readonly id: string;
  readonly label: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  REQUEST: 'Requests',
  CONFIRMATION: 'Confirmations',
  FOLLOW_UP: 'Follow-ups',
  APPEAL: 'Appeals',
};

export function LetterComposer({
  caseId,
  templates,
  prefill,
  can,
  documents,
  findings,
  initialTemplate,
}: {
  caseId: string;
  templates: readonly TemplateSummary[];
  /** Field values the case already knows. */
  prefill: Readonly<Record<string, string>>;
  can: { premiumTemplates: boolean; evidence: boolean };
  documents: readonly EvidenceOption[];
  findings: readonly EvidenceOption[];
  initialTemplate?: string;
}): React.ReactElement {
  const router = useRouter();
  const [templateKey, setTemplateKey] = useState<string | null>(initialTemplate ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [docIds, setDocIds] = useState<string[]>([]);
  const [findingIds, setFindingIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per form session: a double-click or a retry is the same letter.
  const [idempotencyKey] = useState(() => crypto.randomUUID().replace(/-/g, ''));

  const template = useMemo(() => templates.find((t) => t.key === templateKey) ?? null, [templates, templateKey]);

  // When a template is chosen, start from what the case knows. A value the
  // customer has typed for a field of the same name is kept.
  useEffect(() => {
    if (template === null) return;
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const field of template.fields) {
        next[field.key] = prev[field.key] ?? prefill[field.key] ?? '';
      }
      return next;
    });
    setError(null);
  }, [template, prefill]);

  const grouped = useMemo(() => {
    const out = new Map<string, TemplateSummary[]>();
    for (const t of templates) {
      const list = out.get(t.category) ?? [];
      list.push(t);
      out.set(t.category, list);
    }
    return [...out.entries()];
  }, [templates]);

  const submit = useCallback(
    async (event: React.FormEvent): Promise<void> => {
      event.preventDefault();
      if (template === null) return;
      setBusy(true);
      setError(null);

      const fieldValues: Record<string, string | string[]> = {};
      for (const field of template.fields) {
        const raw = (values[field.key] ?? '').trim();
        if (raw.length === 0) continue;
        fieldValues[field.key] = field.type === 'list' ? splitListInput(raw) : raw;
      }

      try {
        const response = await fetch('/api/letters', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            caseId,
            templateKey: template.key,
            idempotencyKey,
            fieldValues,
            ...(docIds.length > 0 || findingIds.length > 0
              ? { evidence: { documentIds: docIds, findingIds } }
              : {}),
          }),
        });
        const json = (await response.json()) as
          | { letter: { id: string } }
          | { error: { message: string } };
        if (!response.ok || !('letter' in json)) {
          setError('error' in json ? json.error.message : 'We could not prepare the draft.');
          return;
        }
        router.push(`/cases/${caseId}/letters/${json.letter.id}`);
      } catch {
        setError('We could not reach the service. Please check your connection.');
      } finally {
        setBusy(false);
      }
    },
    [template, values, caseId, idempotencyKey, docIds, findingIds, router],
  );

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="stack--lg">
      <section className="stack" aria-labelledby="pick-heading">
        <div className="section-head">
          <h2 id="pick-heading">What do you want to ask for?</h2>
          <span className="section-head__count">{templates.length}</span>
        </div>
        {grouped.map(([category, list]) => (
          <div key={category} className="stack--sm">
            <p className="eyebrow eyebrow--quiet m-0">{CATEGORY_LABEL[category] ?? category}</p>
            <ul className="template-list">
              {list.map((t) => {
                const locked = t.isPremium && !can.premiumTemplates;
                return (
                  <li key={t.key}>
                    <button
                      type="button"
                      className="card card--interactive"
                      aria-pressed={templateKey === t.key}
                      onClick={() => setTemplateKey(t.key)}
                    >
                      <span className="template__name">{t.name}</span>
                      <span className="template__desc">{t.description}</span>
                      <span className="template__meta">
                        {t.isPremium ? (
                          <span className={`badge ${locked ? 'badge--neutral' : 'badge--info'}`}>
                            {locked ? 'Full library' : 'Library'}
                          </span>
                        ) : null}
                        <span className="caption">
                          {t.fields.filter((f) => f.required).length} required field
                          {t.fields.filter((f) => f.required).length === 1 ? '' : 's'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      {template !== null ? (
        <form onSubmit={submit} className="card stack" aria-labelledby="fill-heading">
          <div>
            <h2 id="fill-heading" className="card__title">
              {template.name}
            </h2>
            <p className="muted card__lead">
              Fill in the facts. Fields the case already knows are filled for you; check them
              against the statement.
            </p>
          </div>

          {template.isPremium && !can.premiumTemplates ? (
            <p className="notice notice--info">
              This template is part of the full library, which your plan does not include. You can
              read what it asks for; preparing a draft from it needs a plan with the full library.{' '}
              <a href="/pricing">See plans</a>
            </p>
          ) : null}

          <div className="stack">
            {template.fields.map((field) => (
              <div className="field" key={field.key}>
                <label htmlFor={`f-${field.key}`}>
                  {field.label}
                  {field.required ? '' : <span className="muted"> (optional)</span>}
                </label>
                {field.type === 'textarea' || field.type === 'list' ? (
                  <textarea
                    id={`f-${field.key}`}
                    rows={field.type === 'list' ? 4 : 3}
                    value={values[field.key] ?? ''}
                    maxLength={field.maxLength ?? 4000}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    required={field.required}
                    placeholder={field.type === 'list' ? 'One per line' : undefined}
                  />
                ) : (
                  <input
                    id={`f-${field.key}`}
                    type={field.type === 'date' ? 'date' : 'text'}
                    inputMode={field.type === 'money' ? 'decimal' : undefined}
                    value={values[field.key] ?? ''}
                    maxLength={field.maxLength ?? 400}
                    onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    required={field.required}
                    placeholder={field.type === 'money' ? '$0.00' : undefined}
                  />
                )}
                {field.help ? <span className="field__hint">{field.help}</span> : null}
                {field.type === 'list' ? (
                  <span className="field__hint">
                    One entry per line; the letter numbers them for you, so there is no need to.
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          {can.evidence && (documents.length > 0 || findings.length > 0) ? (
            <fieldset className="form-group">
              <legend className="form-group__legend">Attach evidence</legend>
              <p className="form-group__hint">
                Listed at the end of the letter as enclosures and points in question, with the
                figures from the check. You can edit or remove any of it on the next step.
              </p>
              {documents.length > 0 ? (
                <ul className="confirm-list">
                  {documents.map((d) => (
                    <li key={d.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={docIds.includes(d.id)}
                          onChange={() => setDocIds((l) => toggle(l, d.id))}
                        />
                        <span>
                          Enclose <strong>{d.label}</strong>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
              {findings.length > 0 ? (
                <ul className="confirm-list mt-4">
                  {findings.map((f) => (
                    <li key={f.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={findingIds.includes(f.id)}
                          onChange={() => setFindingIds((l) => toggle(l, f.id))}
                        />
                        <span>{f.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>
          ) : null}

          {error !== null ? (
            <p role="alert" className="notice notice--error">
              {error}
            </p>
          ) : null}

          <div className="form-actions">
            <button
              type="submit"
              className="btn btn--primary btn--lg"
              disabled={busy || (template.isPremium && !can.premiumTemplates)}
              aria-busy={busy}
            >
              {busy ? 'Preparing…' : 'Prepare the draft'}
              {!busy ? <Icon name="arrow-right" /> : null}
            </button>
            <span className="small muted">You review it before anything leaves your hands.</span>
          </div>
        </form>
      ) : null}
    </div>
  );
}
