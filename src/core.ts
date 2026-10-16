import { z } from 'zod';

const token = z.string().min(1).max(120).refine(s => s === s.trim() && !/[\x00-\x1f\x7f]/.test(s), 'Use nonblank exact text without surrounding whitespace or control characters');
const quantity = z.number().int().min(0).max(1_000_000_000);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const priced = z.object({ sku: token, quantity: quantity.min(1), unit_price_minor: money }).strict();
const currency = z.string().regex(/^[A-Z]{3}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => { const d = new Date(`${s}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Use a valid calendar date');
export const inputSchema = {
  po: z.object({ reference: token, supplier: token, currency, lines: z.array(priced).min(1).max(500) }).strict(),
  receipts: z.array(z.object({ reference: token, po_reference: token, supplier: token, date: isoDate, lines: z.array(z.object({ sku: token, accepted_quantity: quantity, rejected_quantity: quantity }).strict()).min(1).max(500) }).strict()).max(100),
  invoice: z.object({ reference: token, po_reference: token, supplier: token, currency, lines: z.array(priced).min(1).max(500), total_minor: money }).strict(),
  prior_invoiced: z.array(z.object({ sku: token, quantity }).strict()).max(500).describe('Cumulative previously invoiced whole units, excluding this invoice; [] explicitly asserts none. Caller must supply complete history.'),
  save: z.boolean().optional().default(false),
};
export const checkSchema = z.object(inputSchema).strict();
export type CheckInput = z.infer<typeof checkSchema>;
export interface Issue { code: string; severity: 'error' | 'invalid'; source: string; sku?: string; message: string }
export interface LineEvidence {
  sku: string; po_line: number | null; invoice_line: number | null;
  ordered_quantity: number | null; po_unit_price_minor: number | null;
  accepted_quantity: number; rejected_quantity: number; prior_invoiced_quantity: number;
  invoice_quantity: number; invoice_unit_price_minor: number | null;
  cumulative_invoiced_quantity: number; remaining_order_quantity: number | null;
  available_to_invoice_quantity: number | null; invoice_line_total_minor: number | null;
  receipts: { reference: string; line: number; accepted_quantity: number; rejected_quantity: number; included: boolean }[];
  issue_codes: string[];
}
export interface MatchReport {
  schema_version: 1; status: 'matched' | 'exceptions' | 'invalid';
  scope: string; po_reference: string; invoice_reference: string; currency: string;
  totals: { po_total_minor: number | null; invoice_lines_total_minor: number | null; declared_invoice_total_minor: number };
  issues: Issue[]; lines: LineEvidence[]; documents: CheckInput;
}

/** Pure deterministic comparison; source line numbers are one-based. No licensing or I/O. */
export function match(raw: CheckInput): MatchReport {
  const input = checkSchema.parse(raw);
  const { po, invoice, receipts, prior_invoiced } = input;
  const issues: Issue[] = [];
  const add = (code: string, source: string, message: string, sku?: string, invalid = false) => issues.push({ code, severity: invalid ? 'invalid' : 'error', source, ...(sku === undefined ? {} : { sku }), message });
  function duplicates<T>(rows: T[], key: (r: T) => string, source: string, code: string, sku = true) {
    const seen = new Set<string>(), repeated = new Set<string>();
    rows.forEach(r => { const k = key(r); if (seen.has(k)) repeated.add(k); seen.add(k); });
    for (const k of repeated) add(code, source, `Duplicate ${sku ? 'SKU' : 'reference'} ${k}; ambiguous entries are excluded from comparison.`, sku ? k : undefined, true);
    return repeated;
  }
  const duplicatePo = duplicates(po.lines, r => r.sku, 'po.lines', 'duplicate_po_sku');
  const duplicateInvoice = duplicates(invoice.lines, r => r.sku, 'invoice.lines', 'duplicate_invoice_sku');
  const duplicatePrior = duplicates(prior_invoiced, r => r.sku, 'prior_invoiced', 'duplicate_prior_sku');
  const duplicateRefs = duplicates(receipts, r => r.reference, 'receipts', 'duplicate_receipt_reference', false);
  if (invoice.reference === po.reference || receipts.some(r => r.reference === invoice.reference || r.reference === po.reference)) add('ambiguous_document_reference', 'documents', 'PO, invoice, and receipt document references must be distinct.', undefined, true);
  if (invoice.po_reference !== po.reference) add('invoice_po_reference_mismatch', 'invoice.po_reference', `Expected ${po.reference}; supplied ${invoice.po_reference}.`);
  if (invoice.supplier !== po.supplier) add('invoice_supplier_mismatch', 'invoice.supplier', `Expected ${po.supplier}; supplied ${invoice.supplier}.`);
  if (invoice.currency !== po.currency) add('currency_mismatch', 'invoice.currency', `Expected ${po.currency}; supplied ${invoice.currency}; no conversion performed.`);
  const receiptChecks = receipts.map((r, i) => {
    const source = `receipts[${i}]`;
    let included = !duplicateRefs.has(r.reference);
    if (r.po_reference !== po.reference) { included = false; add('receipt_po_reference_mismatch', `${source}.po_reference`, `Expected ${po.reference}; supplied ${r.po_reference}. Receipt excluded.`); }
    if (r.supplier !== po.supplier) { included = false; add('receipt_supplier_mismatch', `${source}.supplier`, `Expected ${po.supplier}; supplied ${r.supplier}. Receipt excluded.`); }
    const duplicateSkus = duplicates(r.lines, l => l.sku, `${source}.lines`, 'duplicate_receipt_sku');
    return { included, duplicateSkus };
  });
  const poBySku = new Map(po.lines.filter(l => !duplicatePo.has(l.sku)).map(l => [l.sku, l]));
  const invBySku = new Map(invoice.lines.filter(l => !duplicateInvoice.has(l.sku)).map(l => [l.sku, l]));
  const priorBySku = new Map(prior_invoiced.filter(l => !duplicatePrior.has(l.sku)).map(l => [l.sku, l.quantity]));
  const skus = new Set([...po.lines, ...invoice.lines, ...prior_invoiced, ...receipts.flatMap(r => r.lines)].map(l => l.sku));
  function safeMoney(n: bigint, source: string, sku?: string): number | null {
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) { add('unsafe_money_arithmetic', source, 'Calculated minor-unit amount exceeds Number.MAX_SAFE_INTEGER.', sku, true); return null; }
    return Number(n);
  }
  const poTotal = safeMoney(po.lines.reduce((n, l) => n + BigInt(l.quantity) * BigInt(l.unit_price_minor), 0n), 'po.lines');
  const invTotal = safeMoney(invoice.lines.reduce((n, l) => n + BigInt(l.quantity) * BigInt(l.unit_price_minor), 0n), 'invoice.lines');
  if (invTotal !== null && invTotal !== invoice.total_minor) add('invoice_total_mismatch', 'invoice.total_minor', `Supplied ${invoice.total_minor}; priced lines total ${invTotal}.`);
  const receiptsBySku = new Map<string, LineEvidence['receipts']>();
  receipts.forEach((r, i) => r.lines.forEach((l, j) => {
    const evidence = receiptsBySku.get(l.sku) ?? [];
    evidence.push({ reference: r.reference, line: j + 1, accepted_quantity: l.accepted_quantity, rejected_quantity: l.rejected_quantity, included: receiptChecks[i].included && !receiptChecks[i].duplicateSkus.has(l.sku) });
    receiptsBySku.set(l.sku, evidence);
  }));
  const lines: LineEvidence[] = [...skus].sort().map(sku => {
    const p = poBySku.get(sku), inv = invBySku.get(sku);
    const evidence = receiptsBySku.get(sku) ?? [];
    const accepted = evidence.reduce((s, r) => s + (r.included ? r.accepted_quantity : 0), 0);
    const rejected = evidence.reduce((s, r) => s + (r.included ? r.rejected_quantity : 0), 0);
    const prior = priorBySku.get(sku) ?? 0, billed = inv?.quantity ?? 0;
    if (!p && !duplicatePo.has(sku)) add('unordered_sku', 'documents', 'SKU is absent from the purchase order.', sku);
    if (p) {
      if (accepted > p.quantity) add('accepted_above_order', 'receipts', `Accepted ${accepted}; ordered ${p.quantity}.`, sku);
      if (prior > accepted) add('prior_invoiced_above_accepted', 'prior_invoiced', `Previously invoiced ${prior}; accepted ${accepted}.`, sku);
      if (prior > p.quantity) add('prior_invoiced_above_order', 'prior_invoiced', `Previously invoiced ${prior}; ordered ${p.quantity}.`, sku);
      if (billed > 0 && !evidence.some(r => r.included)) add('missing_receipt', 'receipts', 'No unambiguous matching receipt line supports this billed SKU.', sku);
      if (prior + billed > accepted) add('invoiced_above_accepted', 'invoice.lines', `Prior ${prior} + current ${billed} exceeds accepted ${accepted} by ${prior + billed - accepted}.`, sku);
      if (prior + billed > p.quantity) add('invoiced_above_order', 'invoice.lines', `Prior ${prior} + current ${billed} exceeds ordered ${p.quantity} by ${prior + billed - p.quantity}.`, sku);
      if (inv && inv.unit_price_minor !== p.unit_price_minor) add('unit_price_mismatch', 'invoice.lines', `PO unit price ${p.unit_price_minor}; invoice unit price ${inv.unit_price_minor}.`, sku);
    }
    return { sku, po_line: p ? po.lines.indexOf(p) + 1 : null, invoice_line: inv ? invoice.lines.indexOf(inv) + 1 : null, ordered_quantity: p?.quantity ?? null, po_unit_price_minor: p?.unit_price_minor ?? null, accepted_quantity: accepted, rejected_quantity: rejected, prior_invoiced_quantity: prior, invoice_quantity: billed, invoice_unit_price_minor: inv?.unit_price_minor ?? null, cumulative_invoiced_quantity: prior + billed, remaining_order_quantity: p ? Math.max(0, p.quantity - accepted) : null, available_to_invoice_quantity: p ? Math.max(0, Math.min(accepted, p.quantity) - prior) : null, invoice_line_total_minor: inv ? safeMoney(BigInt(inv.quantity) * BigInt(inv.unit_price_minor), 'invoice.lines', sku) : null, receipts: evidence, issue_codes: [] };
  });
  const codesBySku = new Map<string, Set<string>>();
  for (const issue of issues) if (issue.sku !== undefined) {
    const codes = codesBySku.get(issue.sku) ?? new Set<string>();
    codes.add(issue.code); codesBySku.set(issue.sku, codes);
  }
  for (const line of lines) line.issue_codes = [...(codesBySku.get(line.sku) ?? [])];
  return { schema_version: 1, status: issues.some(i => i.severity === 'invalid') ? 'invalid' : issues.length ? 'exceptions' : 'matched', scope: 'Structured goods evidence only; no payment approval. Prior billing history is caller-supplied, not independently verified.', po_reference: po.reference, invoice_reference: invoice.reference, currency: po.currency, totals: { po_total_minor: poTotal, invoice_lines_total_minor: invTotal, declared_invoice_total_minor: invoice.total_minor }, issues, lines, documents: input };
}

export function exportCsv(report: MatchReport): string {
  const fields = ['sku', 'ordered_quantity', 'po_unit_price_minor', 'accepted_quantity', 'rejected_quantity', 'prior_invoiced_quantity', 'invoice_quantity', 'invoice_unit_price_minor', 'cumulative_invoiced_quantity', 'available_to_invoice_quantity', 'invoice_line_total_minor', 'issue_codes'] as const;
  const escape = (v: unknown) => { let s = Array.isArray(v) ? v.join(';') : v == null ? '' : String(v); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  return [fields.map(escape).join(','), ...report.lines.map(l => fields.map(f => escape(l[f])).join(','))].join('\r\n') + '\r\n';
}
