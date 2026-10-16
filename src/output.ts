import { randomUUID } from 'node:crypto';
import type { MatchReport } from './core.js';
import { getReport } from './store.js';

export const PREVIEW_TTL_MS = 30 * 60 * 1000;
export const PREVIEW_CAP = 2;
// Leave room below the SDK's default 10 MiB JSON-RPC receive buffer.
const INLINE_LIMIT = 8 * 1024 * 1024;
const previews = new Map<string, { report: MatchReport; expires: number }>();
export const pageSections = ['issues', 'lines', 'po_lines', 'invoice_lines', 'prior_invoiced', 'receipts', 'receipt_lines', 'line_receipts'] as const;
export type PageSection = typeof pageSections[number];

function cleanPreviews() {
  for (const [id, entry] of previews) if (entry.expires <= Date.now()) previews.delete(id);
}
function header(report: MatchReport) {
  const { lines: poLines, ...po } = report.documents.po;
  const { lines: invoiceLines, ...invoice } = report.documents.invoice;
  return { po: { ...po, line_count: poLines.length }, invoice: { ...invoice, line_count: invoiceLines.length }, receipts: report.documents.receipts.map(({ lines, ...r }) => ({ ...r, line_count: lines.length })), save: report.documents.save };
}
export function fitsInline(value: unknown) {
  const text = JSON.stringify(value);
  return Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text }] }), 'utf8') <= INLINE_LIMIT;
}
export function boundedReport(report: MatchReport, savedId?: string) {
  // Measure the actual escaped text-content envelope, not just the inner JSON.
  if (fitsInline({ report })) return report;
  cleanPreviews();
  let id = savedId;
  let expires: number | undefined;
  if (!id) {
    id = `preview:${randomUUID()}`; expires = Date.now() + PREVIEW_TTL_MS;
    while (previews.size >= PREVIEW_CAP) previews.delete(previews.keys().next().value!);
    previews.set(id, { report, expires });
  }
  return {
    schema_version: report.schema_version, status: report.status, scope: report.scope,
    po_reference: report.po_reference, invoice_reference: report.invoice_reference, currency: report.currency, totals: report.totals,
    paginated: true, report_id: id,
    counts: { issues: report.issues.length, lines: report.lines.length, po_lines: report.documents.po.lines.length, invoice_lines: report.documents.invoice.lines.length, receipts: report.documents.receipts.length, prior_invoiced: report.documents.prior_invoiced.length },
    documents: header(report),
    retrieval: { tool: 'report_page', sections: pageSections, ...(expires === undefined ? {} : { expires_at: new Date(expires).toISOString(), preview_policy: 'Last two large unsaved reports in this process, for 30 minutes. Eviction, expiry or restart requires resubmitting the original free diagnostic.' }), note: 'Full evidence is available in pages. Line pages expose receipt_count; retrieve each line_receipts page by exact SKU. Receipt source rows use receipt_lines and zero-based receipt_index.' },
  };
}
export function reportPage(args: { id: string; section: PageSection; offset: number; limit: number; receipt_index?: number; sku?: string }) {
  cleanPreviews();
  let report: MatchReport;
  if (args.id.startsWith('preview:')) {
    const entry = previews.get(args.id);
    if (!entry) throw new Error('Preview expired, was evicted, or belongs to another process. Resubmit the original diagnostic; all checks and preview pages are free.');
    report = entry.report;
  } else report = getReport(args.id).report;
  let rows: unknown[];
  switch (args.section) {
    case 'issues': rows = report.issues; break;
    case 'lines': rows = report.lines; break;
    case 'po_lines': rows = report.documents.po.lines; break;
    case 'invoice_lines': rows = report.documents.invoice.lines; break;
    case 'prior_invoiced': rows = report.documents.prior_invoiced; break;
    case 'receipts': rows = header(report).receipts; break;
    case 'receipt_lines': {
      if (args.receipt_index === undefined || !report.documents.receipts[args.receipt_index]) throw new Error('receipt_lines requires an existing zero-based receipt_index.');
      rows = report.documents.receipts[args.receipt_index].lines; break;
    }
    case 'line_receipts': {
      const line = report.lines.find(l => l.sku === args.sku);
      if (!line) throw new Error('line_receipts requires an existing exact sku.');
      rows = line.receipts; break;
    }
  }
  const next = args.offset + args.limit;
  const page = rows.slice(args.offset, next);
  const output = args.section === 'lines' ? (page as MatchReport['lines']).map(({ receipts, ...line }) => ({ ...line, receipt_count: receipts.length })) : page;
  return { id: args.id, section: args.section, ...(args.receipt_index === undefined ? {} : { receipt_index: args.receipt_index }), ...(args.sku === undefined ? {} : { sku: args.sku }), offset: args.offset, limit: args.limit, total: rows.length, next_offset: next < rows.length ? next : null, rows: output };
}
