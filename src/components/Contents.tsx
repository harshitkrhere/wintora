/**
 * The sections of a long page, as links.
 *
 * Under the lede on a phone; beside the text, and sticky, on a wide screen
 * (see .contents in globals.css). Every item points at a section id on the
 * same page, so the list is also the page's outline for a screen reader.
 */

export interface ContentsItem {
  readonly id: string;
  readonly label: string;
}

export function Contents({ items }: { items: readonly ContentsItem[] }): React.ReactElement {
  return (
    <nav className="contents" aria-label="On this page">
      <p className="contents__label">On this page</p>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`}>{item.label}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
