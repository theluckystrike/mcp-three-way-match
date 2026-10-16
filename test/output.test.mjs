import test from 'node:test';
import assert from 'node:assert/strict';
import { match } from '../dist/core.js';
import { boundedReport, reportPage, fitsInline, PREVIEW_TTL_MS } from '../dist/output.js';
import { fixture } from './helpers.mjs';
test('50,000 receipt entries for a single ambiguous SKU page without oversized line rows; expired previews fail clearly', () => {
  const x = fixture();
  x.receipts = Array.from({ length: 100 }, (_, r) => ({ reference: `GR-${r}`, po_reference: x.po.reference, supplier: x.po.supplier, date: '2026-10-16', lines: Array.from({ length: 500 }, () => ({ sku: 'A', accepted_quantity: 1, rejected_quantity: 0 })) }));
  const full = match(x), overview = boundedReport(full);
  assert.equal(overview.paginated, true); assert(fitsInline({ report: overview }));
  const lines = reportPage({ id: overview.report_id, section: 'lines', offset: 0, limit: 100 });
  assert.equal(lines.rows[0].receipt_count, 50000); assert.equal(lines.rows[0].receipts, undefined); assert(fitsInline(lines));
  const receiptPage = reportPage({ id: overview.report_id, section: 'line_receipts', sku: 'A', offset: 49900, limit: 100 });
  assert.equal(receiptPage.rows.length, 100); assert.equal(receiptPage.rows.at(-1).line, 500); assert.equal(receiptPage.rows.at(-1).reference, 'GR-99'); assert.equal(receiptPage.rows.at(-1).included, false); assert.equal(receiptPage.next_offset, null); assert(fitsInline(receiptPage));
  assert.throws(() => reportPage({ id: overview.report_id, section: 'receipt_lines', offset: 0, limit: 100 }), /receipt_index/);
  assert.throws(() => reportPage({ id: overview.report_id, section: 'line_receipts', sku: 'missing', offset: 0, limit: 100 }), /exact sku/);
  const now = Date.now; Date.now = () => now() + PREVIEW_TTL_MS + 1;
  try { assert.throws(() => reportPage({ id: overview.report_id, section: 'issues', offset: 0, limit: 100 }), /expired/); }
  finally { Date.now = now; }
});
