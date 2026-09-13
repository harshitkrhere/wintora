/**
 * The shape of a case overview while it is rendered on the server: the
 * way back, a title, the amount, the next-step card, two findings. It
 * says nothing and claims nothing; it only shows that something is on its
 * way.
 */

export default function Loading(): React.ReactElement {
  return (
    <div className="shell stack--lg page" aria-busy="true" aria-label="Loading">
      <div className="page-head__text skeleton-group">
        <span className="skeleton skeleton--text" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="stack">
        <span className="skeleton skeleton--stat" />
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
        <span className="skeleton skeleton--card" />
      </div>
    </div>
  );
}
