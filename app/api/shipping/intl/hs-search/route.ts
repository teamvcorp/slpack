import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

// Offline HS (Harmonized System) 6-digit code search. Backs the customs-form
// typeahead. The dataset (data/hsCodes.json — official WCO HS 2022 6-digit list)
// is loaded once into module memory and never shipped to the client.
export const runtime = 'nodejs';

const ROUTE = 'shipping/intl/hs-search';

interface HsEntry { c: string; d: string }

let CACHE: HsEntry[] | null = null;

async function loadDataset(): Promise<HsEntry[]> {
  if (CACHE) return CACHE;
  const file = path.join(process.cwd(), 'data', 'hsCodes.json');
  CACHE = JSON.parse(await readFile(file, 'utf8')) as HsEntry[];
  return CACHE;
}

export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();
    if (q.length < 2) return NextResponse.json({ results: [] });

    const data = await loadDataset();
    const digits = q.replace(/\D/g, '');
    const terms = q.split(/\s+/).filter(Boolean);

    const scored: { entry: HsEntry; score: number }[] = [];
    for (const entry of data) {
      let score = 0;
      // Code prefix match (when the user types digits).
      if (digits && entry.c.startsWith(digits)) score += 100 - entry.c.length;
      // All keyword terms must appear in the description.
      const desc = entry.d.toLowerCase();
      if (terms.every((t) => desc.includes(t))) {
        score += 10;
        // Prefer earlier / whole-word matches.
        if (desc.startsWith(terms[0])) score += 5;
      }
      if (score > 0) scored.push({ entry, score });
    }

    scored.sort((a, b) => b.score - a.score || a.entry.c.localeCompare(b.entry.c));
    const results = scored.slice(0, 10).map(({ entry }) => ({ code: entry.c, description: entry.d }));
    return NextResponse.json({ results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `${ROUTE}: ${message}` }, { status: 500 });
  }
}
