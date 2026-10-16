# Three-way supplier invoice matching MCP server

<!-- mirror-seo:start -->

**MCP server for three way matching: supplier invoice matching against purchase orders and accepted receipts by SKU.** Supplier invoice, purchase order and receipt checks by exact SKU.

Works with Claude Desktop, Claude Code, Cursor and any Model Context Protocol client. Runs on your own machine: this one has no hosted endpoint, so install it from the bundle or from source.

[Try the editable matching example in your browser](https://mcp.zovo.one/guides/match-supplier-invoice-purchase-order-delivery-note-in-claude#matcher-demo) before installing. No account is needed; the example checks run in your browser without uploading field values.

## Install

**Claude Desktop, one click.** Download `three-way-match.mcpb` from the [bundle catalog](https://mcp.zovo.one/downloads#three-way-match) and double-click it.

**From source.** The mirror is self-contained: every `@theluckystrike/*` dependency is vendored, so a fresh clone builds with no extra setup.

```sh
git clone https://github.com/theluckystrike/mcp-three-way-match.git
cd mcp-three-way-match
npm install && npm run build
```

Then point your client at the built entry point:

```json
{
  "mcpServers": {
    "three-way-match": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-three-way-match/dist/index.js"]
    }
  }
}
```

> `@theluckystrike/mcp-three-way-match` is **not published on npm yet**, so an `npx -y @theluckystrike/mcp-three-way-match` command will fail. The three paths above are the working ones and each is exercised by CI.

![three-way-match demo](https://raw.githubusercontent.com/theluckystrike/mcp-servers/main/assets/demo-three-way-match.gif)

Read-only mirror of [mcp-servers/servers/three-way-match](https://github.com/theluckystrike/mcp-servers/tree/main/servers/three-way-match). See [MIRROR.md](MIRROR.md).

<!-- mirror-seo:end -->

Check a supplier invoice against its purchase order and delivery receipts in Claude or another MCP client. This local server compares each exact SKU, unit price and billed quantity with the PO, cumulative accepted deliveries and quantities you say were already invoiced. It catches offsetting SKU mistakes even when the invoice and PO grand totals agree, and returns the source values behind every exception. Supply structured documents; this server does not extract PDFs, perform OCR, connect to an ERP, post payments or approve an invoice.

Built by [theluckystrike](https://github.com/theluckystrike). MIT. Support: support@zovo.one.

## Install

Claude Desktop: download [three-way-match.mcpb v0.22.6 (corrected storage archive)](https://github.com/theluckystrike/mcp-servers/releases/download/v0.22.7/three-way-match.mcpb) and open it. SHA-256: `afa608954d51d94b2a439874224b2bd592c51812076c86fe0d207b2c91899c14`. Other clients can use the source instructions below.

Requires Node.js 18 or newer. Build from the source checkout; the npm package is not published. No API key or account is required to run the free tools.

```sh
git clone https://github.com/theluckystrike/mcp-servers.git
cd mcp-servers
npm install
node scripts/bootstrap-timezone.mjs
npm run build --workspace @theluckystrike/mcp-license
npm run build --workspace @theluckystrike/mcp-three-way-match
```

Use the absolute path to `servers/three-way-match/dist/index.js` in your checkout. The server speaks stdio; your MCP client starts it. Do not put an HTTP URL in its place.

Claude Desktop: merge this entry into `mcpServers` in `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS (or `%APPDATA%\Claude\claude_desktop_config.json` on Windows), replacing `/absolute/path` with your checkout location:

```json
{
  "mcpServers": {
    "three-way-match": {
      "command": "node",
      "args": ["/absolute/path/mcp-servers/servers/three-way-match/dist/index.js"]
    }
  }
}
```

Claude Code:

```sh
claude mcp add three-way-match -- node /absolute/path/mcp-servers/servers/three-way-match/dist/index.js
```

Cursor: merge the same JSON into `.cursor/mcp.json` in your project or `~/.cursor/mcp.json`. Restart your client, call `license_status`, then run the example below. A `tools/list` result alone does not verify matching.

For Claude Desktop, download [three-way-match.mcpb](https://github.com/theluckystrike/mcp-servers/releases/download/v0.22.6/three-way-match.mcpb) and open it to install. SHA-256: `22a7b3fa21624cacd644ab90d62b42c85b7067960dee26efd185dd751a816012`. This is a local stdio server; no hosted endpoint is available.

## Tools

| Tool | Arguments and result |
| --- | --- |
| `three_way_match` | PO, receipts, invoice, required `prior_invoiced`, optional `save`; returns full report and save outcome. |
| `report_list` | Optional `offset` (0), `limit` (20, maximum 100); returns saved UUIDs and summaries. |
| `report_get` | `id`; source documents, all issues and per-SKU evidence. |
| `report_page` | `id`, `section`, optional `offset`/`limit`, `receipt_index`/`sku`; free pages of every issue, SKU evidence and source row. |
| `report_delete` | `id`; removes that saved report and frees a storage slot. |
| `report_export_csv` | `id`, optional `offset`/`limit`; CSV text plus currency, status and document-level issue codes; large exports paginate. |
| `license_status` | No arguments; offline free/Pro status and checkout link. |
| `license_activate` | `key`; verifies and stores a Pro key offline. |

## Input contract

One PO and one current supplier invoice per call. There is no fuzzy matching: SKU, supplier and PO references are exact, case-sensitive strings, with no surrounding whitespace or control characters. Document references and SKUs are 1–120 characters. PO, invoice and receipt document references must be distinct. Duplicate SKUs within a document or within `prior_invoiced`, and duplicate receipt references, produce `invalid`; ambiguous rows are excluded from comparison. Repeated SKUs across different receipt documents are expected and accumulate.

Quantities are whole units from 0 to 1,000,000,000; PO and invoice line quantities must be positive. Fractional quantities are rejected. `accepted_quantity` and `rejected_quantity` are disjoint counts, not a gross count and its subset. Rejected units never increase the quantity available to invoice. Receipts must carry valid `YYYY-MM-DD` dates; include only receipts relevant to this check. Dates are evidence, not an automatic invoice-date cutoff.

Every monetary input is an integer minor-unit amount from 0 to `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). For USD, 100 means $1.00; for a zero-decimal currency use its own minor units. Supply the uppercase three-letter currency code on both PO and invoice. No currency conversion or currency-code catalog lookup occurs. Unit prices must match exactly, with no tolerance. Money products and totals use integer arithmetic; unsafe results produce `invalid` with `unsafe_money_arithmetic`, never a rounded amount.

`invoice.total_minor` is the total of the supplied goods lines. There are no implicit tax, freight, discount, rounding or credit adjustments. Represent agreed charges as explicit priced PO/invoice SKUs and appropriate receipt evidence, or prepare an excluding-adjustments goods total before calling. Do not supply an all-in invoice total while omitting its adjustments.

`prior_invoiced` is required, even when empty. Supply the complete cumulative quantities previously billed for each SKU against this PO, excluding this current invoice. `[]` explicitly asserts none. Current plus prior quantities must fit both accepted receipts and the PO. Saving reports does not update this history or detect repeated invoice references across checks; incorrect or omitted history can allow repeat billing to go undetected. Reports are evidence snapshots, not an accounting ledger.

Bounds apply equally to free and Pro: 1–500 PO lines, 1–500 invoice lines, up to 500 prior SKUs, and up to 100 receipts of 1–500 lines each. An empty receipts array is valid and produces missing-receipt exceptions for billed PO SKUs. Empty or malformed references, blank/missing SKUs, decimals, unsafe input numbers and invalid dates are rejected as input errors. Unknown SKUs are explicit `unordered_sku` exceptions.

## Equal totals can hide SKU errors

Call `three_way_match` with:

```json
{
  "po": {
    "reference": "PO-1", "supplier": "Supply Co", "currency": "USD",
    "lines": [
      {"sku": "A", "quantity": 10, "unit_price_minor": 100},
      {"sku": "B", "quantity": 10, "unit_price_minor": 100}
    ]
  },
  "receipts": [{
    "reference": "GR-1", "po_reference": "PO-1", "supplier": "Supply Co", "date": "2026-10-16",
    "lines": [
      {"sku": "A", "accepted_quantity": 5, "rejected_quantity": 0},
      {"sku": "B", "accepted_quantity": 15, "rejected_quantity": 0}
    ]
  }],
  "invoice": {
    "reference": "INV-1", "po_reference": "PO-1", "supplier": "Supply Co", "currency": "USD",
    "lines": [
      {"sku": "A", "quantity": 10, "unit_price_minor": 100},
      {"sku": "B", "quantity": 10, "unit_price_minor": 100}
    ],
    "total_minor": 2000
  },
  "prior_invoiced": [],
  "save": false
}
```

The report has `status: "exceptions"`, despite equal 2,000-minor-unit PO/invoice totals and equal aggregate quantities. SKU A has `invoiced_above_accepted` (10 billed, 5 accepted); SKU B has `accepted_above_order` (15 accepted, 10 ordered). Changing invoice unit prices to 90 for A and 110 for B also preserves the grand total but produces two `unit_price_mismatch` issues.

## Partial deliveries can match

Using the same PO, supply a receipt containing only A with `accepted_quantity: 4`, `rejected_quantity: 2`. Invoice only A with `quantity: 4`, `unit_price_minor: 100`, `total_minor: 400`, and keep `prior_invoiced: []`. This returns `matched`. A has six units still undelivered; B need not appear on this partial invoice. A second matching receipt adds its accepted quantity; rejected quantities remain separate evidence. After previously billing two A units, supply `prior_invoiced: [{"sku":"A","quantity":2}]` and bill at most two more against those four accepted units.

## Reading the report

`matched` means the supplied evidence passes these exact checks; it does not authorize payment. `exceptions` identifies document mismatches, unknown SKUs, missing receipts, excessive accepted/billed quantities, price differences or an inconsistent declared invoice total. `invalid` identifies ambiguity or unsafe computed money; resolve it before interpreting the comparison. Mismatched receipt PO/supplier references are flagged and those receipts do not support billing.

Every issue has `code`, `severity`, `source`, optional `sku`, and a concrete message. Each sorted SKU row includes PO/invoice one-based source line numbers; ordered, accepted, rejected, prior and current invoice quantities; both unit prices; cumulative billed quantity; available quantity before this invoice; remaining undelivered quantity; receipt references/line numbers and inclusion flags; and issue codes. The report retains the complete supplied documents, so a duplicate row never disappears from the audit evidence. Partial shortages are shown as remaining quantities and do not themselves fail a supported partial invoice.

Small reports return inline. A report whose escaped MCP response would exceed 8 MiB returns an explicit `paginated: true` overview with status, totals, counts, source document headers and `report_id`. All evidence remains free through `report_page`. Select `section` from `issues`, `lines`, `po_lines`, `invoice_lines`, `prior_invoiced`, `receipts`, `receipt_lines` or `line_receipts`; use `offset` (default 0) and `limit` (default 100, maximum 100), following `next_offset` until null. `lines` pages contain scalar evidence and `receipt_count`; get those receipt entries with `line_receipts` and the exact `sku`. `receipt_lines` requires the zero-based `receipt_index` from the original receipt array. `receipts` pages contain document headers and line counts. Together these sections preserve every source row and every computed issue.

Saved reports use their persistent UUID for pages, and `report_get` returns the same bounded overview for large saved reports. Large unsaved reports, including save-cap and storage failures, use `preview:<UUID>` IDs: the process keeps its last two large previews for 30 minutes. Restart, expiry or a third preview can evict them; resubmit the original diagnostic to recreate the free preview. Preview IDs belong to the current running server process. The underlying SDK also limits incoming stdio messages to 10 MiB; encoded requests must fit that transport limit even when individual row counts fit the schema.

CSV includes one row per SKU, exact minor-unit prices, quantities and line issue codes; document issues remain in the accompanying JSON and full report. CSV is returned as text, not written to an arbitrary caller-supplied path. Formula-like leading characters are escaped for spreadsheet use.

CSV exports that fit the same 8 MiB response budget stay inline. Larger exports return a first chunk of up to 1,000 rows with `paginated`, `offset`, `returned`, `total_rows` and `next_offset`. Pass that `next_offset` as `offset` in another `report_export_csv` call; optional `limit` is 1–1,000. Every chunk repeats the header; retain one header when combining chunks.

## Free and Pro

| Capability | Free | Pro |
| --- | --- | --- |
| Full diagnostic checks and source evidence | All checks, up to 500 PO/invoice lines | Same |
| Receipts and prior invoice checks | Same documented bounds | Same |
| Saved reports | 3 at a time | No report-count cap |
| List/get/delete and CSV export | Included | Included |

When `save: true` hits the free cap, the full report is still returned with `saved: false`, `save_error: "free_saved_report_cap"` and the checkout link. A storage error likewise preserves the diagnostic report. Delete an old saved report to reuse a free slot. A saved report file is limited to 64 MiB when saved and read; this is a storage integrity guard, not a Pro limit.

[Get Pro: $19 one time](https://mcp.zovo.one/buy/three-way-match). [All servers: $39 bundle](https://mcp.zovo.one/buy/bundle). Activate the key with `license_activate` or set `MCP_LICENSE_KEY`. Keys verify offline.

All data stays local. Matching makes no network requests. Saved JSON reports live under `${XDG_DATA_HOME:-~/.local/share}/mcp-servers/three-way-match/`; `XDG_DATA_HOME` must be absolute and the storage directory ancestry must not contain symlinks. Files use atomic rename and mutations share a cross-process lock. Reports include commercial document data: manage local access and backups accordingly. License activation writes the shared local license config.

## Development

```sh
npm run build --workspace @theluckystrike/mcp-three-way-match
npm test --workspace @theluckystrike/mcp-three-way-match
```

Tests exercise offsetting quantity/price errors, rejected and multiple receipts, partials, explicit prior billing, unknown and duplicate SKUs/references, currency/PO/supplier mismatches, dates, integer boundaries, free/Pro save policy, atomic storage and an MCP stdio initialization/tools/call round trip. Docker builds from the repository root with `docker build -f servers/three-way-match/Dockerfile .`.
