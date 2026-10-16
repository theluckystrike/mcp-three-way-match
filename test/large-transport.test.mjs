import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { fixture, temporary } from './helpers.mjs';

function largeFixture() {
  const x = fixture();
  x.receipts = Array.from({ length: 100 }, (_, r) => ({ reference: `GR-${r}`, po_reference: x.po.reference, supplier: x.po.supplier, date: '2026-10-16', lines: Array.from({ length: 500 }, (_, l) => ({ sku: `UNKNOWN-${r}-${l}`, accepted_quantity: 1, rejected_quantity: 0 })) }));
  return x;
}
test('default SDK transport retrieves every issue and SKU from 50,000 receipt rows, saved and free previews', { timeout: 60000 }, async () => {
  const temp = temporary();
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env: { ...process.env, XDG_DATA_HOME: temp.dir, XDG_CONFIG_HOME: temp.dir, MCP_LICENSE_KEY: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'large-transport-review', version: '1' });
  const transportErrors = []; client.onerror = e => transportErrors.push(e.message);
  const call = async (name, args) => { const response = await client.callTool({ name, arguments: args }); assert(!response.isError, response.content[0].text); return JSON.parse(response.content[0].text); };
  try {
    await client.connect(transport);
    const x = largeFixture(), preview = await call('three_way_match', x);
    assert.equal(preview.saved, false); assert.equal(preview.report.paginated, true); assert.match(preview.report.report_id, /^preview:/);
    assert.equal(preview.report.counts.lines, 50002); assert.equal(preview.report.counts.issues, 50004);
    const previewId = preview.report.report_id;
    for (const section of ['issues', 'lines']) {
      let offset = 0, retrieved = 0; const skus = new Set();
      do {
        const page = await call('report_page', { id: previewId, section, offset });
        for (const row of page.rows) { assert(row.sku); skus.add(row.sku); if (section === 'lines') assert.equal(typeof row.receipt_count, 'number'); }
        retrieved += page.rows.length; offset = page.next_offset;
      } while (offset !== null);
      assert.equal(retrieved, preview.report.counts[section]); assert.equal(skus.size, 50002);
    }
    const lastSource = await call('report_page', { id: previewId, section: 'receipt_lines', receipt_index: 99, offset: 400 });
    assert.equal(lastSource.rows.at(-1).sku, 'UNKNOWN-99-499'); assert.equal(lastSource.next_offset, null);
    const evidence = await call('report_page', { id: previewId, section: 'line_receipts', sku: 'UNKNOWN-99-499' });
    assert.deepEqual(evidence.rows, [{ reference: 'GR-99', line: 500, accepted_quantity: 1, rejected_quantity: 0, included: true }]);
    const saved = await call('three_way_match', { ...x, save: true }); assert.equal(saved.saved, true); assert.equal(saved.report.report_id, saved.id);
    assert.equal((await call('report_get', { id: saved.id })).report.paginated, true);
    assert.equal((await call('report_page', { id: saved.id, section: 'receipt_lines', receipt_index: 99, offset: 499 })).rows[0].sku, 'UNKNOWN-99-499');
    const csv = await call('report_export_csv', { id: saved.id, offset: 50000, limit: 1000 });
    assert.equal(csv.paginated, true); assert.equal(csv.returned, 2); assert.equal(csv.next_offset, null); assert.equal(csv.csv.split('\r\n').length, 4);
    await call('three_way_match', { ...fixture(), save: true }); await call('three_way_match', { ...fixture(), save: true });
    const capped = await call('three_way_match', { ...x, save: true }); assert.equal(capped.saved, false); assert.equal(capped.save_error, 'free_saved_report_cap'); assert.equal(capped.report.paginated, true);
    assert.equal((await call('report_page', { id: capped.report.report_id, section: 'receipt_lines', receipt_index: 99, offset: 499 })).rows[0].sku, 'UNKNOWN-99-499');
    // The next two large previews evict the oldest while saved evidence persists.
    await call('three_way_match', x); await call('three_way_match', x);
    const evicted = await client.callTool({ name: 'report_page', arguments: { id: previewId, section: 'issues' } });
    assert.equal(evicted.isError, true); assert.match(evicted.content[0].text, /evicted/);
    assert.equal((await call('report_page', { id: saved.id, section: 'po_lines' })).rows.length, 2);
    assert.deepEqual(transportErrors, []);
  } finally { await client.close(); temp.cleanup(); }
});
test('large CSV automatically paginates through the default SDK instead of overflowing its receive buffer', { timeout: 60000 }, async () => {
  const temp = temporary();
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env: { ...process.env, XDG_DATA_HOME: temp.dir, XDG_CONFIG_HOME: temp.dir, MCP_LICENSE_KEY: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'large-csv-review', version: '1' });
  const call = async (name, args) => { const response = await client.callTool({ name, arguments: args }); assert(!response.isError, response.content[0].text); return JSON.parse(response.content[0].text); };
  try {
    await client.connect(transport);
    const x = largeFixture(); x.save = true;
    for (const receipt of x.receipts) for (const line of receipt.lines) line.sku = `${'S'.repeat(100)}${line.sku.slice('UNKNOWN-'.length)}`;
    const saved = await call('three_way_match', x); assert.equal(saved.saved, true);
    // The persisted fixture is below 50 MB; the full escaped CSV exceeds 8 MiB.
    const { statSync } = await import('node:fs'); const { join } = await import('node:path');
    assert(statSync(join(temp.dir, 'mcp-servers', 'three-way-match', `${saved.id}.json`)).size < 50_000_000);
    const csv = await call('report_export_csv', { id: saved.id });
    assert.equal(csv.paginated, true); assert.equal(csv.returned, 1000); assert.equal(csv.next_offset, 1000); assert.equal(csv.total_rows, 50002);
    assert.equal(csv.csv.split('\r\n').length, 1002);
    const next = await call('report_export_csv', { id: saved.id, offset: csv.next_offset, limit: 1 }); assert.equal(next.returned, 1); assert.equal(next.next_offset, 1001);
  } finally { await client.close(); temp.cleanup(); }
});
