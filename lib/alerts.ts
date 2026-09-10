import { SITE } from '@/lib/siteConfig';

/**
 * Best-effort operational alert email (2026-09-10).
 *
 * The money-anomaly detections in shipping/submit (sold below carrier cost,
 * insurance underpriced) were written to the error log with status 200 and no
 * notification — if nobody opened Reports → Errors daily, the backstop was
 * decorative. This pushes those to a human.
 *
 * NEVER throws — an alert failure must not affect the request. Sends to
 * ALERT_EMAIL, falling back to the shop address. No-ops without RESEND_API_KEY.
 */
export async function sendMoneyAlert(subject: string, lines: string[]): Promise<void> {
  try {
    if (!process.env.RESEND_API_KEY) return;
    const to = process.env.ALERT_EMAIL || SITE.email;
    if (!to) return;
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
    await resend.emails.send({
      from: `${SITE.name} alerts <${fromEmail}>`,
      to,
      subject: `[slpack alert] ${subject}`,
      text: lines.join('\n'),
    });
  } catch (err) {
    console.error('[alerts] failed to send', err instanceof Error ? err.message : err);
  }
}
