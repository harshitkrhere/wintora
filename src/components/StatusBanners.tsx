'use client';

/**
 * Offline banner.
 *
 * Appears the moment the connection drops and leaves the moment it returns.
 * It says what is true and nothing more: nothing is cached for offline use,
 * so anything submitted while this shows will fail, and the forms already
 * say so when it does. This just says it first.
 */

import { useEffect, useState } from 'react';

export function OfflineBanner(): React.ReactElement | null {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = (): void => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div role="status" aria-live="polite" className="banner banner--offline">
      You are offline. Anything you submit will not reach us until the connection is back.
    </div>
  );
}
