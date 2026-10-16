import { mkdtempSync, mkdirSync, readdirSync, lstatSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
export function fixture() {
  return { po: { reference: 'PO-1', supplier: 'Supply Co', currency: 'USD', lines: [{ sku: 'A', quantity: 10, unit_price_minor: 100 }, { sku: 'B', quantity: 10, unit_price_minor: 100 }] }, receipts: [{ reference: 'GR-1', po_reference: 'PO-1', supplier: 'Supply Co', date: '2026-10-16', lines: [{ sku: 'A', accepted_quantity: 10, rejected_quantity: 0 }, { sku: 'B', accepted_quantity: 10, rejected_quantity: 0 }] }], invoice: { reference: 'INV-1', po_reference: 'PO-1', supplier: 'Supply Co', currency: 'USD', lines: [{ sku: 'A', quantity: 10, unit_price_minor: 100 }, { sku: 'B', quantity: 10, unit_price_minor: 100 }], total_minor: 2000 }, prior_invoiced: [], save: false };
}
export function temporary() {
  const root = process.env.TMPDIR || join(homedir(), 'mcp-servers-work'); mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'three-way-match-'));
  return { dir, cleanup() {
    const open = spawnSync(process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof', ['-t', '+D', dir], { encoding: 'utf8' });
    if (open.status !== 1 || open.stdout.trim()) throw new Error(`Refusing cleanup: lsof ${open.status}: ${open.stdout} ${open.stderr}`);
    function size(p) { const s = lstatSync(p); return s.isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : s.size; }
    appendFileSync(new URL('../cleanup-manifest.jsonl', import.meta.url), JSON.stringify({ path: dir, bytes: size(dir), lsof: 'no open handles', at: new Date().toISOString() }) + '\n');
    rmSync(dir, { recursive: true });
  } };
}
