import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// AI-assisted HS-code suggestion. Given a plain-language item description,
// Claude proposes a 6-digit Harmonized System code. This is a SUGGESTION only —
// staff must confirm (misclassification carries customs risk). Uses structured
// outputs so the response is always a valid, parseable object.
export const runtime = 'nodejs';

const ROUTE = 'shipping/intl/hs-suggest';

// JSON-schema-constrained response shape (structured outputs).
const HS_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: '6-digit HS code, digits only' },
      description: { type: 'string', description: 'Short description of the HS category' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    },
    required: ['code', 'description', 'confidence'],
    additionalProperties: false,
  },
};

export async function POST(req: NextRequest) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI suggestions unavailable (ANTHROPIC_API_KEY not configured)' },
        { status: 503 }
      );
    }

    const { description } = await req.json();
    const desc = String(description ?? '').trim().slice(0, 300);
    if (desc.length < 2) {
      return NextResponse.json({ error: 'Provide an item description' }, { status: 400 });
    }

    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      output_config: { format: HS_FORMAT },
      system:
        'You are a customs classification assistant. Given a product description, ' +
        'return the most likely 6-digit Harmonized System (HS) tariff code (digits only, ' +
        'no dots). Base it on the internationally harmonized 6-digit level. If unsure, ' +
        'give your best guess and set confidence to "low".',
      messages: [{ role: 'user', content: `Classify this item for a commercial invoice: "${desc}"` }],
    });

    // Extract the JSON text block and parse.
    const text = message.content.find((b) => b.type === 'text');
    const raw = text && 'text' in text ? text.text : '{}';
    let parsed: { code?: string; description?: string; confidence?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Could not parse suggestion' }, { status: 502 });
    }

    const code = String(parsed.code ?? '').replace(/\D/g, '').slice(0, 6);
    if (!code) return NextResponse.json({ error: 'No code suggested' }, { status: 502 });

    return NextResponse.json({
      code,
      description: String(parsed.description ?? '').slice(0, 120),
      confidence: ['high', 'medium', 'low'].includes(String(parsed.confidence)) ? parsed.confidence : 'low',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `${ROUTE}: ${message}` }, { status: 500 });
  }
}
