# Mobile

Wintora's owner set the rule for the signed-in app on a phone in September
2026, and it is short enough to keep in mind whole:

> **Don't shrink desktop. Simplify the task.**
> One screen. One decision. One primary action.
> Show evidence before interpretation. Show interpretation before action.
> Keep the user in control.

The person holding the phone is often in a waiting room, or on the phone to
a billing office, with a bill they do not understand. Every screen lowers
the temperature by answering one question and offering one thing to do.
Where the code disagrees with this document, the code is wrong.

## Vocabulary

| Word        | Means                                                            | Never used for                       |
| ----------- | ---------------------------------------------------------------- | ------------------------------------ |
| **Review**  | Bringing a document in: the tab bar's centre action, the sheet, the upload screen, the sidebar button. | Reading a finding or a draft. |
| **Check**   | What the engine does to confirmed figures ("Run the check", "Latest check"). | Intake.                      |
| **Finding** | One result of a check. The way in is "Open the first finding".   |                                      |
| **Request** | A letter ("Prepare a request", "Your draft").                    |                                      |
| **Case**    | One bill and everything about it.                                |                                      |

## The patterns

**One screen, one decision.** A screen has one dominant action, in the
action bar under the thumb. Anything else it offers is quieter: a text
link, a row to another screen, or an item in the More sheet.

**Finding → Why → Evidence → Next step.** Every finding reads in that
order: the claim in one line, why it is being shown, the numbers it rests on
(collapsed under a row a thumb can open, never hidden away on another
page), and what the person can do about it. This is the product's
signature and it does not vary.

**Calm severity.** Three levels: neutral, "worth a closer look" in amber,
"looks consistent" in teal. Red is for something that failed to happen
(an upload that did not finish), never for a possible billing issue.

**The next step is computed, not remembered.** `nextStepFor` in
`src/lib/cases/next-step.ts` turns a case's real rows (kept documents,
completed checks, letters) into the one thing to do next, and Home, the
case card and the case overview all show that same answer. A person never
has to remember where they left off.

**Screen, sheet, or full-screen task. Never a modal on a modal.** A sheet
(`BottomSheet`) is for a short menu or a small question; it closes on Back
and on any route change, one is open at a time, and it never holds a form
with more than one control. Anything longer is its own screen with a way
back at the top.

**Structure changes on a phone, size does not.** Two documents side by side
become a Bill / EOB switch; a table becomes a list of cards; the sidebar
becomes a tab bar with a raised centre action. Nothing is squeezed.

**Resumable and honest.** An upload creates its case at once, so an
abandoned one is picked up from Home. Progress lists say what has actually
happened and tick a line only when the server has finished it. Every error
names a way out. A letter draft survives a dropped connection.

## The numbers

- Breakpoints are content breakpoints, written mobile-first: **40rem**
  (one column has room for two) and **64rem** (the sidebar fits beside the
  page). Cards use container queries where the same card lives in
  columns of different widths. There are no device breakpoints.
- The page gutter is `--page-pad: clamp(16px, 4vw, 32px)`.
- Nothing a thumb hits is smaller than **44px** (`--touch`); tab bar items
  and rows are 56px.
- Body text is 16px; secondary text is 14px; 12px is for captions only,
  never for a sentence someone has to read.
- Safe areas: the tab bar, the action bar and every sheet pad for
  `env(safe-area-inset-bottom)`; the top bar for the top inset.
- Motion is brief and physical: a sheet rising, a finding expanding, a
  progress dot. Under `prefers-reduced-motion` things appear instead.

## The bars

**Tab bar** (`AppNav`, phone only): Home · Cases · **Review** · Documents ·
Account. Review is a button, not a page: it opens the Review sheet. The bar
hides while a text field has focus, so the keyboard's own bar is not
fighting it, and `interactiveWidget: 'resizes-content'` in the viewport
lets Android Chrome shrink the page above the keyboard.

**Action bar** (`ActionBar`): sticky at the bottom of the viewport above
the tab bar while the page scrolls, resting in flow at the end of it, so it
never covers a field. iOS Safari does not shrink the page for its keyboard;
there the bar scrolls with the page and is reached by scrolling, and the
focused field is never covered. Verified on a real iPhone and a real
Android phone, not only in emulation.

## Tests that matter more than screenshots

- **Thumb test:** upload → check → read a finding → draft a request, one
  hand, no tap above the middle of the screen after the first.
- **Three-second test:** shown Home for three seconds, a person can say
  "review my bill and see what I need to do".
- **Stress test:** open the app holding a $12,000 bill; the first thing on
  the screen is the next step, not a dashboard.
