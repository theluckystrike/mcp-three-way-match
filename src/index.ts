#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createLicenseGate } from '@theluckystrike/mcp-license';
import { checkSchema, match, exportCsv } from './core.js';
import { saveReport, listReports, getReport, deleteReport } from './store.js';
import { VERSION } from './version.js';
import { boundedReport, reportPage, pageSections, fitsInline } from './output.js';

const server = new McpServer({ name: 'three-way-match', version: VERSION });
const gate = createLicenseGate({ product: 'three-way-match' });
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const error = (e: unknown) => ({ content: [{ type: 'text' as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true as const });
const localRead = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/).describe('Saved UUID from report_list or three_way_match');
server.registerTool('three_way_match', {
  title: 'Match PO, goods receipts and supplier invoice',
  description: 'Compare up to 500 PO/invoice lines by exact SKU, accepted receipts and prior billed quantities. Returns source evidence and exceptions, including offsetting errors. All diagnosis is free; save optionally.',
  inputSchema: checkSchema,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async args => {
  try {
    const report = match(args);
    if (!args.save) return json({ report: boundedReport(report), saved: false });
    try {
      const saved = await saveReport(report, gate.isPro());
      return saved ? json({ report: boundedReport(report, saved.id), saved: true, id: saved.id, created_at: saved.created_at }) : json({ report: boundedReport(report), saved: false, save_error: 'free_saved_report_cap', upgrade: gate.upgradeText('More than 3 saved reports', 'three_way_match'), payment: gate.payment('free_tier_cap', 'More than 3 saved reports', 'three_way_match') });
    } catch (e) { return json({ report: boundedReport(report), saved: false, save_error: e instanceof Error ? e.message : String(e) }); }
  } catch (e) { return error(e); }
});
server.registerTool('report_list', {
  title: 'List saved matching reports', description: 'List saved report ids, timestamps, document references, status and issue counts. Free on both tiers; paginated, up to 100 reports per call.',
  inputSchema: { offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.number().int().min(1).max(100).default(20) }, annotations: localRead,
}, async ({ offset, limit }) => { try { return json(listReports(offset, limit)); } catch (e) { return error(e); } });
server.registerTool('report_get', {
  title: 'Get a saved matching report', description: 'Read a saved report with source documents, per-SKU evidence and all exceptions. Free on both tiers.', inputSchema: { id }, annotations: localRead,
}, async ({ id }) => { try { const saved = getReport(id); return json({ ...saved, report: boundedReport(saved.report, id) }); } catch (e) { return error(e); } });
server.registerTool('report_page', {
  title: 'Read a page of complete matching evidence', description: 'Read free pages of large report issues, SKU rows or original source rows. Use report_id from the paginated overview. Unsaved previews expire after 30 minutes and keep only the last two large checks.',
  inputSchema: z.object({ id: z.string().regex(/^(?:preview:)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), section: z.enum(pageSections), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: z.number().int().min(1).max(100).default(100), receipt_index: z.number().int().min(0).max(99).optional(), sku: z.string().min(1).max(120).optional() }).strict(), annotations: localRead,
}, async args => { try { return json(reportPage(args)); } catch (e) { return error(e); } });
server.registerTool('report_delete', {
  title: 'Delete a saved matching report', description: 'Delete one saved report by id, freeing a free-tier storage slot. Does not alter source documents or prior invoice history.', inputSchema: { id },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
}, async ({ id }) => { try { return json(await deleteReport(id)); } catch (e) { return error(e); } });
server.registerTool('report_export_csv', {
  title: 'Export saved report line evidence as CSV', description: 'Return CSV of saved SKU quantities, prices and issues. Large CSVs paginate; follow next_offset with offset. Formula-like text is escaped. Full source evidence uses report_get/report_page.', inputSchema: { id, offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), limit: z.number().int().min(1).max(1000).optional() }, annotations: localRead,
}, async ({ id, offset, limit }) => { try {
  const r = getReport(id), report = r.report;
  const metadata = { id, currency: report.currency, status: report.status, document_issue_codes: report.issues.filter(i => !i.sku).map(i => i.code) };
  if (offset === undefined && limit === undefined) { const full = { ...metadata, csv: exportCsv(report) }; if (fitsInline(full)) return json(full); }
  const start = offset ?? 0, count = limit ?? 1000, rows = report.lines.slice(start, start + count);
  return json({ ...metadata, csv: exportCsv({ ...report, lines: rows }), paginated: true, offset: start, returned: rows.length, total_rows: report.lines.length, next_offset: start + rows.length < report.lines.length ? start + rows.length : null });
} catch (e) { return error(e); } });
gate.registerTools(server);
server.connect(new StdioServerTransport()).catch(e => { process.stderr.write(`three-way-match: ${e instanceof Error ? e.message : String(e)}\n`); process.exitCode = 1; });
