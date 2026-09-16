import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { sinchConfigured, getFax, getFaxPdf, type SinchFax } from '@/lib/sinchFax';
import { upsertFax } from '@/lib/faxLog';
import { SITE } from '@/lib/siteConfig';

/**
 * Sinch Fax webhook (2026-09-14) — one URL for both inbound faxes and outbound
 * status. PUBLIC (allowlisted in proxy.ts) but guarded by an unguessable `?token=`
 * matching SINCH_FAX_WEBHOOK_TOKEN (fail-closed 400 until set).
 *
 * The payload is treated as a TRIGGER only: we re-fetch the authoritative fax from
 * Sinch by id, so a spoofed call with a bogus id just 404s and does nothing. On a
 * new inbound fax we archive the PDF and email the shop; on completion we update
 * the outbound row. Always returns 200 so Sinch doesn't retry-storm. Mirrors
 * app/api/webhooks/stripe/route.ts + the email idiom in identity/webhook.
 *
 * Setup: point the Fax service's inbound callback (and the per-send callbackUrl)
 * at https://<domain>/api/webhooks/fax?token=<SINCH_FAX_WEBHOOK_TOKEN>, JSON type.
 * Sinch notifications originate from 34.232.249.173 / 44.226.9.173.
 */
export const runtime = 'nodejs';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function priceUSD(fax: SinchFax): number | undefined {
  const n = parseFloat(String(fax.price?.amount ?? ''));
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token');
  const expected = process.env.SINCH_FAX_WEBHOOK_TOKEN;
  // Fail closed: no configured token, or a mismatch, is rejected outright.
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 400 });
  }

  // Sinch sends EITHER JSON or multipart/form-data depending on the Fax service's
  // `webhookContentType` (a dashboard setting that can drift out from under us), so
  // parse both. We only need the event name + fax id — everything else is re-fetched
  // from Sinch below, so a malformed or spoofed body can at worst cost one 404.
  const trigger = await readTrigger(req);
  if (!trigger.id) return NextResponse.json({ received: true });
  const { event, id } = trigger;

  try {
    if (!sinchConfigured()) return NextResponse.json({ received: true });

    // Authoritative — never trust the payload's own content.
    const fax = await getFax(id);
    const isInbound = event === 'INCOMING_FAX' || fax.direction === 'INBOUND';

    if (isInbound) {
      let blobUrl: string | undefined;
      try {
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          const pdf = await getFaxPdf(id);
          blobUrl = (await put(`fax/in/${id}.pdf`, pdf, {
            access: 'public',
            addRandomSuffix: true,
            contentType: 'application/pdf',
          })).url;
        }
      } catch (err) {
        console.error('[fax webhook] inbound archive failed', err instanceof Error ? err.message : err);
      }

      const { inserted } = await upsertFax({
        sinchId: id,
        direction: 'INBOUND',
        status: fax.status ?? 'COMPLETED',
        from: fax.from,
        to: fax.to,
        numberOfPages: fax.numberOfPages,
        priceUSD: priceUSD(fax),
        errorType: fax.errorType,
        errorMessage: fax.errorMessage,
        blobUrl,
        createdAt: fax.createTime,
        completedAt: fax.completedTime,
      });

      // Email the shop exactly once (only when this call created the row).
      if (inserted) void emailInbound(fax);
    } else {
      // Outbound status update (FAX_COMPLETED etc.).
      await upsertFax({
        sinchId: id,
        direction: 'OUTBOUND',
        status: fax.status ?? 'COMPLETED',
        from: fax.from,
        to: fax.to,
        numberOfPages: fax.numberOfPages,
        priceUSD: priceUSD(fax),
        errorType: fax.errorType,
        errorMessage: fax.errorMessage,
        createdAt: fax.createTime,
        completedAt: fax.completedTime,
      });
    }
  } catch (err) {
    // Record-keeping only — never fail the webhook (would trigger retries).
    console.error('[fax webhook] processing error', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ received: true });
}

/**
 * Pull `{ event, id }` out of a Sinch callback in either encoding.
 *
 * JSON:      { event, eventTime, fax: { id, … } }
 * multipart: flat form fields (`event`, `id`/`faxId`, sometimes a `fax` JSON part,
 *            plus the rendered PDF, which we ignore — we re-download it ourselves).
 * Untrusted input: values are only ever used as a lookup key against Sinch.
 */
async function readTrigger(req: NextRequest): Promise<{ event: string; id: string }> {
  const ctype = req.headers.get('content-type') ?? '';
  try {
    if (ctype.includes('application/json')) {
      const payload = (await req.json()) as { event?: unknown; fax?: { id?: unknown } };
      return { event: String(payload.event ?? ''), id: String(payload.fax?.id ?? '') };
    }
    if (ctype.includes('multipart/form-data') || ctype.includes('application/x-www-form-urlencoded')) {
      const form = await req.formData();
      const str = (k: string) => {
        const v = form.get(k);
        return typeof v === 'string' ? v : '';
      };
      let id = str('id') || str('faxId') || str('fax_id');
      // Some services nest the fax object as a JSON string part.
      if (!id) {
        const nested = str('fax');
        if (nested.trim().startsWith('{')) {
          try {
            id = String((JSON.parse(nested) as { id?: unknown }).id ?? '');
          } catch {
            /* not JSON — fall through */
          }
        }
      }
      return { event: str('event'), id };
    }
  } catch (err) {
    console.error('[fax webhook] unparseable payload', err instanceof Error ? err.message : err);
  }
  return { event: '', id: '' };
}

/** Notify the shop that a fax arrived. Best-effort; all values escaped. */
async function emailInbound(fax: SinchFax): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'shipping@stormlakepackandship.com';
    const pages = fax.numberOfPages ? `${fax.numberOfPages} page${fax.numberOfPages === 1 ? '' : 's'}` : 'a fax';
    await resend.emails.send({
      from: `${SITE.name} <${fromEmail}>`,
      to: SITE.email,
      subject: `New fax received — ${esc(fax.from) || 'unknown sender'}`,
      html: `
        <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="margin:0 0 4px">New fax received</h2>
          <p style="margin:0 0 16px;color:#555">${esc(SITE.name)}</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:4px 0;color:#666">From</td><td style="padding:4px 0;text-align:right">${esc(fax.from) || 'unknown'}</td></tr>
            <tr><td style="padding:4px 0;color:#666">To</td><td style="padding:4px 0;text-align:right">${esc(fax.to) || esc(process.env.SINCH_FAX_NUMBER)}</td></tr>
            <tr><td style="padding:4px 0;color:#666">Pages</td><td style="padding:4px 0;text-align:right">${esc(fax.numberOfPages ?? '—')}</td></tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#555">Open the Fax page in the admin to view ${pages}.</p>
        </div>`,
    });
  } catch (err) {
    console.error('[fax webhook] inbound email failed', err instanceof Error ? err.message : err);
  }
}
