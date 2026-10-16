import test from 'node:test';
import assert from 'node:assert/strict';
import { match, exportCsv, checkSchema } from '../dist/core.js';
import { fixture } from './helpers.mjs';
const codes = r => r.issues.map(i => i.code);
test('matched goods are deterministic and carry source evidence', () => {
  const x = fixture(), r = match(x); assert.equal(r.status, 'matched'); assert.deepEqual(match(x), r);
  assert.equal(r.lines[0].receipts[0].line, 1); assert.equal(r.lines[0].invoice_line, 1); assert.equal(r.totals.invoice_lines_total_minor, 2000);
});
test('offsetting receipt SKUs cannot hide behind equal totals', () => {
  const x = fixture(); x.receipts[0].lines[0].accepted_quantity = 5; x.receipts[0].lines[1].accepted_quantity = 15;
  const r = match(x); assert.equal(r.status, 'exceptions'); assert.equal(r.totals.po_total_minor, r.totals.invoice_lines_total_minor);
  assert(r.issues.some(i => i.sku === 'A' && i.code === 'invoiced_above_accepted')); assert(r.issues.some(i => i.sku === 'B' && i.code === 'accepted_above_order'));
});
test('offsetting unit price changes cannot hide behind equal totals', () => {
  const x = fixture(); x.invoice.lines[0].unit_price_minor = 90; x.invoice.lines[1].unit_price_minor = 110;
  const r = match(x); assert.equal(r.totals.po_total_minor, r.totals.invoice_lines_total_minor); assert.equal(r.issues.filter(i => i.code === 'unit_price_mismatch').length, 2);
});
test('rejected units never support billing; multiple receipts accumulate accepted separately', () => {
  const x = fixture(); x.receipts[0].lines[0] = { sku: 'A', accepted_quantity: 3, rejected_quantity: 4 };
  x.receipts.push({ ...x.receipts[0], reference: 'GR-2', lines: [{ sku: 'A', accepted_quantity: 3, rejected_quantity: 0 }] });
  const r = match(x); assert.equal(r.lines[0].accepted_quantity, 6); assert.equal(r.lines[0].rejected_quantity, 4); assert(codes(r).includes('invoiced_above_accepted'));
});
test('partial invoice can match and omitted PO SKU is allowed', () => {
  const x = fixture(); x.receipts[0].lines = [{ sku: 'A', accepted_quantity: 4, rejected_quantity: 2 }]; x.invoice.lines = [{ sku: 'A', quantity: 4, unit_price_minor: 100 }]; x.invoice.total_minor = 400;
  const r = match(x); assert.equal(r.status, 'matched'); assert.equal(r.lines[0].remaining_order_quantity, 6); assert.equal(r.lines[1].invoice_quantity, 0);
});
test('zero receipts and explicit zero acceptance cannot produce matched billing', () => {
  const x = fixture(); x.receipts = []; assert(codes(match(x)).includes('missing_receipt'));
  x.receipts = fixture().receipts; x.receipts[0].lines[0].accepted_quantity = 0; assert(codes(match(x)).includes('invoiced_above_accepted'));
});
test('prior quantities stop repeat billing within supplied history', () => {
  const x = fixture(); x.prior_invoiced = [{ sku: 'A', quantity: 5 }]; assert(codes(match(x)).includes('invoiced_above_accepted'));
  x.invoice.lines[0].quantity = 5; x.invoice.total_minor = 1500; assert.equal(match(x).status, 'matched');
  delete x.prior_invoiced; assert.throws(() => match(x));
});
test('currency, supplier, PO and receipt reference mismatch are explicit', () => {
  const x = fixture(); x.invoice.currency = 'EUR'; x.invoice.po_reference = 'PO-2'; x.invoice.supplier = 'Other'; x.receipts[0].po_reference = 'PO-2'; x.receipts[0].supplier = 'Other';
  const r = match(x); for (const code of ['currency_mismatch', 'invoice_po_reference_mismatch', 'invoice_supplier_mismatch', 'receipt_po_reference_mismatch', 'receipt_supplier_mismatch', 'missing_receipt']) assert(codes(r).includes(code));
  assert.equal(r.lines[0].accepted_quantity, 0); assert.equal(r.lines[0].receipts[0].included, false);
});
test('duplicate SKU in each source or duplicate receipt ref invalidates without double counting', () => {
  for (const where of ['po', 'invoice', 'receipt', 'prior', 'ref']) {
    const x = fixture();
    if (where === 'po') x.po.lines.push(x.po.lines[0]);
    if (where === 'invoice') x.invoice.lines.push(x.invoice.lines[0]);
    if (where === 'receipt') x.receipts[0].lines.push(x.receipts[0].lines[0]);
    if (where === 'prior') x.prior_invoiced = [{ sku: 'A', quantity: 1 }, { sku: 'A', quantity: 1 }];
    if (where === 'ref') x.receipts.push(x.receipts[0]);
    const r = match(x); assert.equal(r.status, 'invalid', where); assert(codes(r).some(c => c.startsWith('duplicate_')));
    if (where === 'ref' || where === 'receipt') assert.equal(r.lines[0].accepted_quantity, 0);
  }
});
test('unknown SKU, missing exact SKU and document ref collisions cannot silently match', () => {
  const x = fixture(); x.invoice.lines[0].sku = 'a'; assert(codes(match(x)).includes('unordered_sku'));
  x.invoice.reference = x.po.reference; assert.equal(match(x).status, 'invalid');
  x.po.lines[0].sku = ''; assert.throws(() => match(x));
});
test('calendar dates, whitespace, decimals, negative money and bounds are rejected', () => {
  for (const mutate of [x => x.receipts[0].date = '2026-02-30', x => x.po.lines[0].sku = ' A', x => x.invoice.lines[0].quantity = 0.5, x => x.invoice.total_minor = -1, x => x.po.lines[0].quantity = 1_000_000_001, x => x.invoice.total_minor = Number.MAX_SAFE_INTEGER + 1]) {
    const x = fixture(); mutate(x); assert.equal(checkSchema.safeParse(x).success, false);
  }
});
test('money arithmetic accepts safe boundary and rejects unsafe products and sums', () => {
  const x = fixture(); x.po.lines = [{ sku: 'A', quantity: 1, unit_price_minor: Number.MAX_SAFE_INTEGER }]; x.invoice.lines = [...x.po.lines]; x.invoice.total_minor = Number.MAX_SAFE_INTEGER; x.receipts[0].lines = [{ sku: 'A', accepted_quantity: 1, rejected_quantity: 0 }];
  assert.equal(match(x).status, 'matched'); x.invoice.lines[0].quantity = 2;
  const r = match(x); assert.equal(r.status, 'invalid'); assert.equal(r.totals.invoice_lines_total_minor, null); assert(codes(r).includes('unsafe_money_arithmetic'));
  const sum = fixture(); sum.po.lines = [{ sku: 'A', quantity: 1, unit_price_minor: Number.MAX_SAFE_INTEGER }, { sku: 'B', quantity: 1, unit_price_minor: 1 }]; sum.invoice.lines = structuredClone(sum.po.lines); sum.invoice.total_minor = Number.MAX_SAFE_INTEGER;
  const overflow = match(sum); assert.equal(overflow.totals.po_total_minor, null); assert.equal(overflow.totals.invoice_lines_total_minor, null); assert.equal(overflow.status, 'invalid');
});
test('declared invoice amount is checked; CSV quotes commas and blocks formula interpretation', () => {
  const x = fixture(); x.invoice.total_minor = 1999; assert(codes(match(x)).includes('invoice_total_mismatch'));
  x.po.lines[0].sku = '=A,"B"'; x.invoice.lines[0].sku = '=A,"B"'; x.receipts[0].lines[0].sku = '=A,"B"'; const csv = exportCsv(match(x)); assert(csv.includes('"\'=A,""B"""'));
});
test('500-line diagnostic is free of any licensing dependency', () => {
  const x = fixture(); x.po.lines = Array.from({ length: 500 }, (_, i) => ({ sku: `S${i}`, quantity: 1, unit_price_minor: 1 })); x.invoice.lines = structuredClone(x.po.lines); x.invoice.total_minor = 500; x.receipts[0].lines = x.po.lines.map(l => ({ sku: l.sku, accepted_quantity: 1, rejected_quantity: 0 })); assert.equal(match(x).status, 'matched');
});
test('100 receipts with 500 distinct unordered SKUs preserve every line of evidence', () => {
  const x = fixture();
  x.receipts = Array.from({ length: 100 }, (_, r) => ({ reference: `GR-${r}`, po_reference: x.po.reference, supplier: x.po.supplier, date: '2026-10-16', lines: Array.from({ length: 500 }, (_, l) => ({ sku: `UNKNOWN-${r}-${l}`, accepted_quantity: 1, rejected_quantity: 0 })) }));
  const result = match(x); assert.equal(result.status, 'exceptions'); assert.equal(result.lines.length, 50_002); assert.equal(result.issues.filter(i => i.code === 'unordered_sku').length, 50_000);
  const row = result.lines.find(l => l.sku === 'UNKNOWN-99-499'); assert.equal(row.receipts.length, 1); assert.equal(row.receipts[0].reference, 'GR-99'); assert.equal(row.receipts[0].line, 500); assert.deepEqual(row.issue_codes, ['unordered_sku']);
});
