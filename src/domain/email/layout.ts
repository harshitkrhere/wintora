/**
 * One layout for every email, rendered twice.
 *
 * A message is a heading, a few paragraphs, at most one button, and an
 * optional quiet note. From those parts this renders the plain-text version
 * (what a screen reader, a watch or a text-only client shows) and the HTML
 * version (what most inboxes show), so the two can never say different
 * things.
 *
 * The HTML is the conservative kind that survives mail clients: tables, inline
 * styles, system fonts, no images, one column 600px wide. The look is the
 * product's: ice ground, white card, navy text, one teal button. The link
 * behind the button is repeated as text underneath, because buttons are the
 * first thing a client strips.
 *
 * Pure module: no I/O.
 */

export interface EmailParts {
  readonly subject: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly cta?: { readonly label: string; readonly url: string };
  /** Small print under the button: the "if this was not you" line, or a caveat. */
  readonly note?: string;
}

export interface EmailMessage {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const FOOTER_TEXT =
  'You are receiving this because you have a Wintora account. Reply to this email if something here is wrong or unclear; a person reads it.';

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Bold the phrase between double asterisks, and nothing else. */
function inline(s: string): string {
  return escape(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0d1b30;font-weight:700">$1</strong>');
}

function renderText(p: EmailParts): string {
  const lines: string[] = [p.heading, ''];
  for (const para of p.paragraphs) lines.push(para.replace(/\*\*/g, ''), '');
  if (p.cta !== undefined) lines.push(`${p.cta.label}: ${p.cta.url}`, '');
  if (p.note !== undefined) lines.push(p.note.replace(/\*\*/g, ''), '');
  lines.push('Wintora', FOOTER_TEXT);
  return lines.join('\n');
}

function renderHtml(p: EmailParts): string {
  const paragraphs = p.paragraphs
    .map(
      (para) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#2b3f5c">${inline(para)}</p>`,
    )
    .join('');

  const button =
    p.cta !== undefined
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px"><tr><td style="border-radius:8px;background:#0b7a6c">` +
        `<a href="${escape(p.cta.url)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${escape(p.cta.label)}</a>` +
        `</td></tr></table>` +
        `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#66758a;word-break:break-all">Or copy this link: <a href="${escape(p.cta.url)}" style="color:#1d4ed8">${escape(p.cta.url)}</a></p>`
      : '';

  const note =
    p.note !== undefined
      ? `<p style="margin:0;font-size:13.5px;line-height:1.5;color:#66758a">${inline(p.note)}</p>`
      : '';

  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${escape(p.subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f4f8fa">` +
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escape(p.paragraphs[0] ?? p.heading).replace(/\*\*/g, '')}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f8fa"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif">` +
    `<tr><td style="padding:0 8px 16px;font-size:18px;font-weight:800;letter-spacing:-0.01em;color:#0d1b30">Wintora</td></tr>` +
    `<tr><td style="background:#ffffff;border:1px solid #e2e8ee;border-radius:12px;padding:32px 32px 24px">` +
    `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-0.01em;color:#0d1b30">${escape(p.heading)}</h1>` +
    paragraphs +
    button +
    note +
    `</td></tr>` +
    `<tr><td style="padding:20px 8px 0;font-size:12.5px;line-height:1.5;color:#8f9bad">${escape(FOOTER_TEXT)}</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

export function renderEmail(parts: EmailParts): EmailMessage {
  return { subject: parts.subject, text: renderText(parts), html: renderHtml(parts) };
}
