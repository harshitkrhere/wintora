# SEO

Acquisition is organic: search, answer engines, app store, referrals,
product-led growth, direct and organic sharing. There is no paid acquisition in
this architecture, which means the product itself has to be the distribution
mechanism.

The strategy is therefore not "rank for keywords". It is: **be the page that
actually answers the question, and put a working tool on it.**

---

## 1. Growth loop

```
organic search result
  -> public educational page that answers the question
  -> free tool on the same page, no signup
  -> immediate useful result
  -> free account to save it
  -> case created
  -> freemium usage
  -> feature limit reached honestly
  -> upgrade
  -> active subscriber
  -> renewal, second case, repeat use
  -> shares a generic tool or guide
  -> new organic visitor
```

The tool runs before registration. Someone holding a confusing bill at 11pm gets
an answer, not a signup wall. The account is what they create to **keep** the
answer, which is a much easier thing to ask for.

Primary business metric: **paid useful outcomes per organic visitor.** Not
sessions, not pageviews, not impressions.

---

## 2. Page inventory

### Core tool pages

```
/medical-bill-checker          upload or paste a bill, get consistency checks
/bill-vs-eob                   compare a bill against an EOB
/itemized-bill-request         generate a request for an itemised statement
/insurance-appeal-template     structured appeal draft the user reviews
/payment-plan-request          draft a payment-plan request
/medical-financial-assistance  find and prepare an assistance application
/medical-bill-dispute          the dispute workflow end to end
```

### Explainer pages

```
/what-is-an-eob
/how-to-read-a-medical-bill
/medical-bill-codes-explained
/what-to-do-if-a-claim-is-denied
/medical-bills-and-collections
```

### Jurisdiction pages

`/us/[state]/[topic]` and `/ca/[province]/[topic]`, generated **only** where
real jurisdiction-specific information exists and has been reviewed. A page is
published for a state or province only when it has: a jurisdiction record, at
least one tier 1-3 source, reviewed content blocks, and a verification date.

If a jurisdiction has nothing genuinely specific to say on a topic, that page is
**not published**. It is not filled with the national page and a find-replace of
the state name. Thin location pages are the default failure mode of programmatic
SEO and they are worse than having no page: they train an answer engine to treat
the site as filler.

### Canada is not a translated United States

The Canadian workflows are genuinely different, and the content model reflects
that. Canadian pages centre on private-pay and extended-health administration:
dental billing, prescription cost coverage, paramedical claims, private insurer
paperwork, and non-publicly-covered expenses. Copying the US hospital-bill and
medical-debt workflow into Canada would produce content that is confidently
wrong, so the topic taxonomy is country-scoped at the data layer and a US-only
topic simply has no Canadian route.

---

## 3. Page template

Every content page renders these blocks, from structured data:

1. `H1` naming the actual question
2. A one-sentence direct answer, above the fold
3. The working tool, inline
4. Who this applies to, including who it does not
5. Steps, numbered and concrete
6. What to gather before starting
7. Common problems and mistakes
8. Official sources, linked, with publisher and date
9. FAQ
10. Related tools and pages
11. Disclaimer appropriate to the topic
12. Last verified date and jurisdiction
13. A single clear call to action

Blocks 2, 8 and 12 are what make the page retrievable by an answer engine: a
direct answer, attributable sources, and a freshness signal. Blocks 4 and 7 are
what make it trustworthy: honest scope and honest failure modes.

---

## 4. Answer-engine readiness

The aim is not to manipulate a model. It is to be genuinely easy to retrieve and
quote correctly.

- The answer appears in the first sentence, in plain prose, not after four
  paragraphs of preamble.
- Claims are attributable, with the source named inline and linked.
- Facts are scoped: "in [state], the published process is ..." rather than a
  bare universal claim.
- Content is stable at a canonical URL; jurisdiction variants are separate URLs
  rather than client-side swaps.
- Structure is semantic HTML with real headings, lists and tables.
- Content is rendered server-side; nothing important is JavaScript-only.
- `last_verified_at` is visible on the page and in the markup.
- The limits of the answer are stated, because a model quoting an
  over-broad claim eventually gets corrected, and the site that made it loses
  the citation.

---

## 5. Structured data

Applied only where accurate:

| Type | Where |
| --- | --- |
| `Organization` | Site-wide |
| `WebSite` | Home |
| `SoftwareApplication` | Tool pages, with real plan pricing from the catalog |
| `Article` | Explainer pages, with author, dates and reviewer |
| `FAQPage` | Only where a real FAQ is rendered |
| `BreadcrumbList` | All nested pages |
| `HowTo` | Only where the page really is a numbered procedure |

Never emitted: `AggregateRating`, `Review`, awards, endorsements, or any
credential the business does not hold. Fabricated review markup is both a policy
violation and a lie, and it is the fastest way to lose the organic channel that
this entire business depends on.

---

## 6. Indexing rules

`noindex` on: dashboards, cases, documents, generated letters, account and
settings pages, billing pages, internal search results, previews, unverified
drafts, and any page whose `review_status` is not `PUBLISHED`.

Indexable: the marketing site, tool landing pages, explainer content, published
jurisdiction pages, pricing, and the trust centre.

`robots.txt` disallows `/dashboard`, `/cases`, `/settings`, `/billing`,
`/api`, and `/preview`. The sitemap is generated from `content_pages` where
`review_status = 'PUBLISHED'` and `noindex = false`, so an unreviewed page
cannot leak into it.

Every page has one canonical URL. Jurisdiction pages canonicalise to themselves,
never to the national page, because they are genuinely different content.

---

## 7. Internal linking

The topic graph is explicit in the data, not left to editorial habit:

```
medical bill
  -> itemised bill request
  -> EOB comparison
       -> claim denial
            -> insurance appeal
  -> financial assistance
  -> payment plan
  -> collections
  -> state or province resources
```

Every page links up to its topic hub, sideways to sibling jurisdictions where
they exist, and down to the specific tool that does the work. Related links are
generated from the topic and jurisdiction relationships in `content_pages`, so
the graph stays consistent as pages are added and removed.

---

## 8. Content operations

```
draft -> automated validation -> source verification -> risk classification
      -> human editorial review -> publish -> version recorded -> scheduled re-verification
```

`content_pages` carries author, editor, created date, updated date, source
verification date, jurisdiction, review status and version. Every publish writes
a `content_page_versions` row, so any page can be rolled back.

A scheduled job re-fetches each source, hashes it, and compares against
`source_versions`. A changed source marks dependent content `STALE`, opens a
review ticket, and the publishing layer stops serving the stale claim rather
than continuing to assert something that may no longer be true. High-risk
content is never auto-rewritten; a human decides.

Users can report an error from any page. Every report becomes a review item in
`corrections`, and `/corrections` publishes what was fixed and when.

---

## 9. Performance and accessibility

Public pages are statically generated or ISR, ship minimal JavaScript, inline
critical CSS, use modern image formats with explicit dimensions, and
self-host fonts. The interactive tool hydrates as an island; the content around
it does not need JavaScript at all.

Accessibility target is WCAG 2.2 AA, and it applies to the commercial surfaces
too: the pricing table, the plan comparison, the paywalls and the checkout flow
are all keyboard navigable and screen-reader coherent. A paywall that traps
focus is a paywall that excludes disabled customers from buying.

---

## 10. Measurement

Tracked per landing page: impressions, clicks, tool starts, tool completions,
signups, first case created, first premium feature attempt, subscriptions, and
revenue per organic session. The funnel is measured end to end, so a page that
ranks well and converts nobody is visible as a content problem rather than
celebrated as traffic.

Answer-engine referrals are attributed where platforms expose them and left
unattributed where they do not. The dashboard shows an explicit "unattributed"
bucket rather than distributing it into channels by guesswork.

---

## 11. Sharing

Shareable: generic tools, public guides, blank checklists, plan comparisons.

Never shareable automatically: anything derived from a user's documents. No
"John saved 6,238 dollars" cards, no auto-generated social proof, no referral
copy that implies an outcome. A user can compose and approve their own message
if they choose to, and the default share text describes the tool, not a result.
