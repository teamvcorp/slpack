import path from 'path';
import fs from 'fs';
import type { ShipmentLogEntry } from '@/app/admin/types/shipping';

const LOG_FILE = path.join(process.cwd(), 'data', 'shipment-log.json');

function ensureFile() {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '[]', 'utf8');
}

export function readLog(): ShipmentLogEntry[] {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')) as ShipmentLogEntry[];
  } catch {
    return [];
  }
}

export function appendLog(entry: ShipmentLogEntry): void {
  const entries = readLog();
  entries.unshift(entry); // newest first
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2), 'utf8');
}
