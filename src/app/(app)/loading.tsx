/**
 * Shown while a signed-in page is rendered on the server.
 *
 * The shape of the page that is coming, in grey: a heading, a lead, a button,
 * three tiles, three cards. It replaces a blank screen, not a real page, so
 * it says nothing and claims nothing; it only shows that something is on its
 * way.
 */

export default function Loading(): React.ReactElement {
  return (
    <div className="shell stack--lg page" aria-busy="true" aria-label="Loading">
      <div className="page-head">
        <div className="page-head__text skeleton-group">
          <span className="skeleton skeleton--title" />
          <span className="skeleton skeleton--text" />
        </div>
        <span className="skeleton skeleton--btn" />
      </div>
      <div className="stats">
        <span className="skeleton skeleton--stat" />
        <span className="skeleton skeleton--stat" />
        <span className="skeleton skeleton--stat" />
      </div>
      <div className="stack">
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
      </div>
    </div>
  );
}
