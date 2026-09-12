/**
 * Shown across the signed-in app while safe mode is on.
 *
 * Safe mode is the real maintenance state: uploads, reading and analysis
 * pause; sign-in, billing, your cases and your data stay available. No
 * countdown, because we do not know one, and a made-up time is worse than
 * none. See docs/SECURITY.md section 12.
 *
 * Presentational only. The layout reads the flag; components never touch
 * the environment, which is what lets the leak scanner treat this directory
 * as client-side without exception.
 */

export function SafeModeBanner({ active }: { active: boolean }): React.ReactElement | null {
  if (!active) return null;
  return (
    <div role="status" className="banner banner--maintenance">
      Wintora is in maintenance. You can sign in, read your cases and manage your account;
      uploading and checking bills will return shortly.
    </div>
  );
}
