/** The light manifest, at the address browsers expect. See src/config/manifest.ts. */

import { NextResponse } from 'next/server';
import { buildManifest } from '@/config/manifest';

export const dynamic = 'force-static';

export function GET(): NextResponse {
  return NextResponse.json(buildManifest('light'), {
    headers: { 'content-type': 'application/manifest+json' },
  });
}
