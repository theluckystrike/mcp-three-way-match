import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { fixture, temporary } from './helpers.mjs';
test('stdio initializes, exposes exact tools, diagnoses offsets, gates only saving and supports report CRUD/CSV', async () => {
  const temp = temporary();
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))], env: { ...process.env, XDG_DATA_HOME: temp.dir, XDG_CONFIG_HOME: temp.dir, MCP_LICENSE_KEY: '' }, stderr: 'pipe' });
  const client = new Client({ name: 'three-way-match-smoke', version: '1.0.0' });
  const call = async (name, args = {}) => { const result = await client.callTool({ name, arguments: args }); assert(!result.isError, result.content?.[0]?.text); return JSON.parse(result.content[0].text); };
  try {
    await client.connect(transport); const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(t => t.name).sort(), ['three_way_match', 'report_list', 'report_get', 'report_page', 'report_delete', 'report_export_csv', 'license_status', 'license_activate'].sort());
    for (const tool of tools.tools.filter(t => !t.name.startsWith('license_'))) assert(tool.description.length <= 220, `${tool.name}: ${tool.description.length}`);
    assert.equal((await call('license_status')).tier, 'free');
    // A raw Zod shape is permissive at its root in the SDK. The registered
    // object schema must reject unsupported invoice adjustments instead.
    for (const extra of [x => { x.tax_minor = 10; }, x => { x.po.tax_minor = 10; }]) {
      const unsupported = fixture(); extra(unsupported);
      const rejected = await client.callTool({ name: 'three_way_match', arguments: unsupported });
      assert.equal(rejected.isError, true, 'unknown input fields must not be silently removed');
      assert.match(rejected.content[0].text, /Unrecognized key/);
    }
    const x = fixture(); x.save = true; x.receipts[0].lines[0].accepted_quantity = 5; x.receipts[0].lines[1].accepted_quantity = 15;
    const first = await call('three_way_match', x); assert.equal(first.report.status, 'exceptions'); assert.equal(first.saved, true);
    assert.equal((await call('report_get', { id: first.id })).report.lines[0].accepted_quantity, 5);
    assert((await call('report_export_csv', { id: first.id })).csv.includes('invoiced_above_accepted'));
    await call('three_way_match', x); await call('three_way_match', x);
    const capped = await call('three_way_match', x); assert.equal(capped.saved, false); assert.equal(capped.save_error, 'free_saved_report_cap'); assert.equal(capped.report.status, 'exceptions'); assert(capped.upgrade.includes('/buy/three-way-match'));
    assert.equal((await call('report_list')).total, 3); await call('report_delete', { id: first.id }); assert.equal((await call('three_way_match', x)).saved, true);
    const bad = await client.callTool({ name: 'report_get', arguments: { id: '../license' } }); assert.equal(bad.isError, true);
    const invalidKey = await client.callTool({ name: 'license_activate', arguments: { key: 'invalid' } }); assert.equal(invalidKey.isError, true);
    const many = fixture(); many.po.lines = Array.from({ length: 500 }, (_, i) => ({ sku: `S${i}`, quantity: 1, unit_price_minor: 1 })); many.invoice.lines = structuredClone(many.po.lines); many.invoice.total_minor = 500; many.receipts[0].lines = many.po.lines.map(l => ({ sku: l.sku, accepted_quantity: 1, rejected_quantity: 0 })); assert.equal((await call('three_way_match', many)).report.status, 'matched');
  } finally { await client.close(); temp.cleanup(); }
});
