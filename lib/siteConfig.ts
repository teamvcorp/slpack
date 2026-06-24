/**
 * Canonical site + business information — the single source of truth for SEO
 * metadata, structured data, sitemap, robots, and the web manifest.
 * Override the domain at build time with NEXT_PUBLIC_SITE_URL if it ever changes.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://slpacknship.com').replace(/\/+$/, '');

export const SITE = {
  name: 'Storm Lake Pack & Ship',
  shortName: 'SL Pack & Ship',
  url: SITE_URL,
  description:
    'Storm Lake Pack & Ship offers shipping, professional packing, printing & copy, and mailbox rental in Storm Lake, Iowa. Compare UPS, FedEx, and USPS rates, pack fragile items safely, and ship domestic or international — all in one trusted local shop.',
  tagline: 'Shipping, Packing, Printing & Mailbox Rental in Storm Lake, Iowa',
  telephone: '+1-712-560-1128',
  telephoneDisplay: '(712) 560-1128',
  email: 'shipit@slpacknship.com',
  address: {
    street: '503 Lake Ave',
    city: 'Storm Lake',
    region: 'IA',
    regionName: 'Iowa',
    postalCode: '50588',
    country: 'US',
  },
  geo: { lat: 42.643, lng: -95.209 },
  /** Business hours — drives both the JSON-LD schema and the on-page display. */
  hours: [
    { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00', label: 'Mon–Fri', display: '9:00 AM – 6:00 PM' },
    { days: ['Saturday'], opens: '10:00', closes: '14:00', label: 'Saturday', display: '10:00 AM – 2:00 PM' },
    { days: ['Sunday'], opens: null, closes: null, label: 'Sunday', display: 'Closed' },
  ],
  get logo() {
    return `${SITE_URL}/images/logo.png`;
  },
  services: [
    'Package shipping (UPS, FedEx, USPS)',
    'Domestic & international shipping',
    'Professional & custom packing',
    'Printing & copy services',
    'Mailbox rental',
    'Bulk & business shipping',
    'Website building & hosting',
  ],
  keywords: [
    'Storm Lake Pack and Ship',
    'shipping Storm Lake Iowa',
    'packing services Storm Lake',
    'UPS Storm Lake',
    'FedEx Storm Lake',
    'USPS Storm Lake',
    'ship a package Storm Lake IA',
    'printing and copy Storm Lake',
    'mailbox rental Storm Lake',
    'pack and ship 50588',
  ],
} as const;

/** JSON-LD LocalBusiness graph for the homepage. */
export function localBusinessJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'PostalService'],
    '@id': `${SITE_URL}/#business`,
    name: SITE.name,
    description: SITE.description,
    url: SITE_URL,
    image: SITE.logo,
    logo: SITE.logo,
    telephone: SITE.telephone,
    email: SITE.email,
    priceRange: '$$',
    address: {
      '@type': 'PostalAddress',
      streetAddress: SITE.address.street,
      addressLocality: SITE.address.city,
      addressRegion: SITE.address.region,
      postalCode: SITE.address.postalCode,
      addressCountry: SITE.address.country,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: SITE.geo.lat,
      longitude: SITE.geo.lng,
    },
    areaServed: {
      '@type': 'AdministrativeArea',
      name: 'Storm Lake, Iowa and surrounding Buena Vista County',
    },
    openingHoursSpecification: SITE.hours
      .filter((h) => h.opens && h.closes)
      .map((h) => ({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: h.days,
        opens: h.opens,
        closes: h.closes,
      })),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Services',
      itemListElement: SITE.services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s },
      })),
    },
  };
}
