import { ImageResponse } from 'next/og';
import { SITE } from '@/lib/siteConfig';

export const alt = `${SITE.name} — ${SITE.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// Branded 1200×630 card used for Open Graph + Twitter share previews.
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #1e2d4d 0%, #2a3f6b 100%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', color: '#34aef8', fontSize: 30, fontWeight: 700, letterSpacing: 2 }}>
          STORM LAKE, IOWA
        </div>
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>
          <span>Storm Lake</span>
          <span>Pack &amp; Ship</span>
        </div>
        <div style={{ marginTop: 28, fontSize: 36, color: '#cfd8e8', maxWidth: 900 }}>
          Shipping · Packing · Printing · Mailbox Rental
        </div>
        <div style={{ marginTop: 48, display: 'flex', gap: 28, fontSize: 28, color: '#9fb0cc' }}>
          <span>{SITE.address.street}, {SITE.address.city}, {SITE.address.region} {SITE.address.postalCode}</span>
          <span>·</span>
          <span>{SITE.telephoneDisplay}</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
