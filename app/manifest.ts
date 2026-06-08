import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/siteConfig';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f0e8',
    theme_color: '#1e2d4d',
    icons: [
      { src: '/images/logo.png', sizes: 'any', type: 'image/png' },
    ],
  };
}
