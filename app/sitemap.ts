import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteConfig';

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: 'monthly', priority: 1 },
    // Public service pages, each with its own metadata/canonical. They were
    // missing here, so search engines only ever learned about the homepage.
    { url: `${SITE_URL}/printing`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/fax`, lastModified, changeFrequency: 'monthly', priority: 0.8 },
  ];
}
