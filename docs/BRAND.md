# Brand

The decisions below were made by Wintora's owner in September 2026 and are
the source of truth for everything the interface, the emails and any future
print or social material look like. Nothing here is a suggestion; where the
code disagrees with this document, the code is wrong.

## The mark

Two leaves whose stems meet in a W: Wintora Teal on the left, Wintora Blue on
the right. The source is `public/brand/wintora-mark.svg`, two flat-filled
paths and nothing else. There is no glow, no gradient and no background in
the mark itself.

`npm run brand` regenerates every derived asset from that file: the path data
the interface renders inline (`src/components/brand-mark.ts`), the browser
tab icon (`src/app/icon.svg`), the iOS home-screen icon, and the three PWA
icons under `public/brand/`. Replace the SVG and run the script; do not edit
the outputs by hand.

Rules for placing it:

- The mark may stand alone as an app icon or favicon. Next to text it is
  always followed by the wordmark, never above it, in the interface.
- Minimum size in the interface is 24px wide. It is never placed inside a
  disc, a tile or a coloured box.
- Clear space on every side is at least the height of the mark.
- On a dark ground the colours stay the same. A one-colour version
  (`tone="mono"` on `LeafMark`) exists for print and for placement on
  colour, and takes the surrounding text colour.

## The wordmark

**Wintora**, in title case, always. Never `WINTORA`, `wintora` or any mixed
casing; the capital W is the visual anchor of the name.

The wordmark is a customised wordmark derived from Inter SemiBold, with
adjusted letterforms and spacing. Until the custom letterforms are drawn it
is set in Inter SemiBold at -0.03em tracking, and Inter is loaded for this
purpose alone (`--font-wordmark`). Nothing else on the site is set in Inter.

The lock-up is the mark followed by the wordmark at a gap of half the mark's
height, both vertically centred.

## Colour

| Name          | Value     | Role                                                        |
| ------------- | --------- | ----------------------------------------------------------- |
| Midnight      | `#0B2D5B` | Headings, primary text, primary buttons                     |
| Wintora Teal  | `#13B8A8` | The left leaf; what is settled, consistent or done          |
| Wintora Blue  | `#2867D8` | The right leaf; links, and one accent per screen            |
| Ice           | `#F4F8FA` | The canvas everything sits on                               |
| Mist          | `#E4F2F1` | A soft teal tint, used sparingly behind settled states      |
| Slate         | `#66758A` | Secondary text                                              |

Attention is amber, never red. Colour is used for state and for links; it is
not used decoratively, and there are no gradients anywhere in the product.
The dark theme keeps the brand hues and inverts the neutrals; the tokens live
in `src/app/globals.css` section 1.

## Typography

**Manrope** is the product typeface, loaded through `next/font` as
`--font-manrope`. It is free and commercially usable, geometric without being
cold, and its numerals set well in the ledgers, prices, balances and dates
the product is made of.

| Weight        | Used for                                                  |
| ------------- | --------------------------------------------------------- |
| 700 Bold      | Page titles, the landing statement, prices                |
| 600 SemiBold  | Section headings, buttons, navigation, labels, badges     |
| 400 Regular   | Body text, explanations, notes                            |

Ten sizes, held as tokens (`--text-display` down to `--text-caption`), and
tabular numerals wherever digits can line up. Uppercase with tracking is
reserved for table column headers.

## Voice

**Clear. Reassuring. Empowering.**

Tone: calm, intelligent, respectful, transparent, practical. Wintora is a
knowledgeable guide, not a doctor, a lawyer, a salesperson or a bureaucracy.
Every message follows one shape: explain, then show what can be verified,
then guide, then hand back control.

Wintora sounds human, confident, helpful, professional, calm and direct. It
never sounds fear-driven, salesy, legalistic, patronising, alarmist, overly
cheerful, or like a government agency or an insurer.

The core rule: **never make the person more worried than the evidence
warrants, and never make the situation sound simpler than it is.**

Say: "Your bill lists $1,240. The EOB shows $860 as your patient
responsibility."
Do not say: "Your account appears to demonstrate a potentially significant
billing discrepancy."

Say: "Here is what we found, what you can verify, and a draft you can send."
Do not say: "We'll fight the hospital for you."

## Imagery

None. No stock photography, no lifestyle or medical photography, no
decorative illustration, and nothing generated. The visual language is the
mark, typography, colour, whitespace, hairline rules, the product's own
documents and results, and the in-house line icons in
`src/components/Icons.tsx`. If a picture is ever needed it is a screenshot
of the product on a plain ground, or a licensed asset chosen for one purpose.

## Demonstrations and sample documents

Every example document on the site is synthetic and is labelled:

> Example document using fictional data. Layout inspired by common
> healthcare billing documents. Not an actual patient's bill or EOB.

The US example follows the layout of a common itemised hospital bill, with
the public CMS sample explanation of benefits as the structural reference for
the EOB side. A Canadian example uses Canadian terminology and CAD amounts.
Each example deliberately contains two or three inconsistencies for the
engine to find, and the findings shown are the engine's real output for those
figures. Real consumers' documents are never used.

## Legal identity and metadata

- Production domain: `wintora.online`
- Site and application name: Wintora
- Legal operator: not yet finalised, pending registration. Do not invent a
  company name. Do not display "Wintora Inc.", "Wintora LLC", "Wintora
  Technologies" or any similar form until the legal entity exists.
- Footer line: `© 2026 Wintora. All rights reserved.`

## Devices

No validated traffic data exists yet, so no device split is assumed. The
product is designed for phones and desktops from the start: phone first for
the checker and the public pages, since high-intent searches often begin on a
phone; desktop kept efficient for document-heavy work, comparisons and
letters. Once real traffic exists, measure phone, desktop and tablet
separately across landing sessions, tool starts, uploads, completed analyses,
account creation, checkout and retention, and let that data set priorities.
Device analytics must never carry health information.
