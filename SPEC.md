# three-way-match: contract spec

Version0.22.6. TypeScript ESM, Node>=18, MCP stdio JSON-RPC. Package `@theluckystrike/mcp-three-way-match`, executable `mcp-three-way-match`. Wire inventory is exercised by `test/smoke.test.mjs`; no resources/prompts are registered.

| Tool | Contract |
| --- | --- |
| `three_way_match` | Required `po`, `receipts`, `invoice`, `prior_invoiced`; optional `save=false`. Returns `{report,saved}` with optional saved UUID/timestamp or save error. |
| `report_list` | Offset>=0, limit1–100(default20); paginated report summaries and total. |
| `report_get` | Saved UUID; returns id, created_at, full validated/recomputed report. |
| `report_page` | Saved UUID or preview:UUID; section plus offset/limit (1–100), optional zero-based receipt_index or exact sku; returns complete free evidence pages and next_offset. |
| `report_delete` | Saved UUID; removes one real report file under the server data directory. |
| `report_export_csv` | Saved UUID; returns CSV text, status, currency and document issue codes; optional offset/limit (1–1000), automatic chunks if full response exceeds 8MiB. |
| `license_status` | Shared offline gate status. |
| `license_activate` | Shared offline key verification and config persistence. |

The complete machine input schema is `src/core.ts` and the tools/list output. PO has reference/supplier/currency and priced SKU lines. Invoice additionally has po_reference and total_minor. Receipts have reference/po_reference/supplier/date and SKU accepted_quantity/rejected_quantity. Prior rows have sku/quantity. All object schemas reject unknown fields.

Invariants:

- Exact case-sensitive matching; no fuzzy SKU, supplier/reference normalization, currency conversion or tolerance.
- Whole quantities0–1e9; positive PO/invoice line quantities. Minor-unit money0–MAX_SAFE_INTEGER. BigInt computes products/sums before safe numeric conversion. Unsafe calculations yield invalid reports.
- Up to500 PO/invoice/prior rows,100 receipts of up to500 rows. Distinct receipt references; each document permits one row per SKU. Duplicate ambiguity is invalid and those rows cannot support matching.
- Accepted and rejected quantities are disjoint. Only accepted quantities accumulate as invoice support. Wrong PO/supplier receipt references are exceptions and excluded from support.
- Current+prior billing cannot exceed either accepted units or ordered units. Prior history is required and caller-supplied; no hidden invoice-ledger or repeated-reference guarantee.
- Supported partial invoices can match. Unbilled/undelivered PO remainders are evidence, not automatic exceptions. Missing receipt for a billed SKU is an exception.
- Invoice declared total equals its priced goods lines; no implicit taxes, freight, discounts or credits.
- Status matched/exceptions/invalid reflects only the supplied structured evidence. It never approves payment.
- Reports retain source documents, sorted SKU evidence, one-based source line numbers and receipt inclusion flags. Receipt evidence and issue codes are indexed once by SKU to avoid a row crossproduct.
- Inline reports/CSVs have an 8MiB escaped MCP response budget. Larger reports return an explicit overview and report_page retrieval ID; every issue, line, source row and receipt evidence remains available in pages. Saved IDs persist. Large unsaved reports use process-local preview IDs, last2 with30minute TTL; expiry/eviction/restart requires free resubmission. Lines pages omit receipt arrays and expose receipt_count; line_receipts retrieves those arrays. Incoming encoded requests must fit the SDK10MiB stdio buffer independently of row bounds.
- Free preview includes all500 lines and every exception; only saving a fourth simultaneous report is gated. A cap/storage failure preserves the full report. Pro removes the report-count cap, not the input bounds or64MiB saved-file guard.
- Atomic0600 report JSON files at XDG_DATA_HOME/mcp-servers/three-way-match/<UUID>.json, default~/.local/share. Shared cross-process lock protects saves/deletes and cap checks. Storage paths are bounded and reject symlink ancestry; tools accept no output path.
- Saved report reads validate metadata/documents and recompute evidence; corruption produces an error without overwriting. A real file with a valid UUID can still be deleted to recover its slot.
- Matching and report operations have no network calls. Only protocol traffic goes to stdout. Handler errors return MCP isError text; matching exceptions return ordinary reports.

Tests: core adversarial matching, integer boundaries,50,000 unordered receipt SKUs; stdio initialization/discovery/real calls; storage concurrent and independent-process cap checks; version and descriptor contract tests. Package publication and artifact hashes are finalized by the release owner.
