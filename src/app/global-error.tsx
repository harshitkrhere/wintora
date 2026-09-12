'use client';

/**
 * The root layout itself failed. Nothing from globals.css can be assumed to
 * have loaded, so this page carries its own minimal styling and no imports
 * from the rest of the app. It should almost never be seen.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          color: '#2b3f5c',
          background: '#f6f8fc',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: 480 }}>
          <h1 style={{ color: '#0b2d5b', fontSize: '1.6rem', margin: '0 0 0.5rem' }}>
            This one is on us
          </h1>
          <p style={{ margin: '0 0 1.25rem', lineHeight: 1.6 }}>
            The page could not be shown. It was not anything you did, and nothing of
            yours has been lost.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              font: 'inherit',
              fontWeight: 600,
              padding: '0.75rem 1.4rem',
              borderRadius: 999,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: '#64748b' }}>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
