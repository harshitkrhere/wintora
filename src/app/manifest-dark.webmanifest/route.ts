/** The dark manifest: the same app, on the graphite canvas. See src/config/manifest.ts. */

import { NextResponse } from 'next/server';
import { buildManifest } from '@/config/manifest';

export const dynamic = 'force-static';

export function GET(): NextResponse {
  return NextResponse.json(buildManifest('dark'), {
    headers: { 'content-type': 'application/manifest+json' },
  });
}
