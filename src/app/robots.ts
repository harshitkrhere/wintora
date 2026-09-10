import type { MetadataRoute } from 'next';

/**
 * Private surfaces are disallowed here, marked noindex by the middleware, and
 * excluded from the sitemap. Three independent mechanisms, because a case page
 * appearing in a search index would be a serious failure.
 * See docs/SEO.md section 6.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/cases',
          '/settings',
          '/billing',
          '/api',
          '/preview',
          '/checkout',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
