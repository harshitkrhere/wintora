import { appUrl } from '@/lib/env';
import type { MetadataRoute } from 'next';

/**
 * The sitemap lists only pages that are genuinely publishable.
 *
 * Jurisdiction pages are added from `content_pages` where review_status is
 * PUBLISHED and noindex is false. Since no jurisdiction has passed review yet,
 * none appear: a page is published for a state or province only when it has a
 * reviewed source and something genuinely specific to say, never by
 * find-and-replacing a state name into a national page.
 * See docs/SEO.md section 2.
 */

const STATIC_PAGES: readonly { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/medical-bill-checker', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/bill-vs-eob', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/methodology', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/security', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/privacy', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/data-retention', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/sources', priority: 0.4, changeFrequency: 'monthly' },
  { path: '/corrections', priority: 0.3, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const now = new Date();

  return STATIC_PAGES.map((page) => ({
    url: `${base}${page.path}`,
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
