# Install three-way-match

Product: local per-SKU matching of a supplier invoice, purchase order and accepted goods receipts. No PDF/OCR extraction, ERP connection or payment approval. Requires Node >=18; no external API key. npm publication is pending: use the source checkout, not npx.

```sh
git clone https://github.com/theluckystrike/mcp-servers.git
cd mcp-servers
npm install
npm run build --workspace @theluckystrike/mcp-license
npm run build --workspace @theluckystrike/mcp-three-way-match
```

Set the client command to `node` and args to the absolute checkout path of `servers/three-way-match/dist/index.js`. Merge the README's `mcpServers` config into Claude Desktop or Cursor; preserve existing entries. For Claude Code:

```sh
claude mcp add three-way-match -- node /absolute/path/mcp-servers/servers/three-way-match/dist/index.js
```

Restart the client; call `license_status`, then `three_way_match` with the complete README example. Expected status: `exceptions`, with A `invoiced_above_accepted` and B `accepted_above_order`, although both totals are2000 minor units. For a successful partial case, keep the same PO, receive only A5, invoice only A5 at100, total500, and explicitly supply `prior_invoiced: []`; expected status `matched`.

Required input history `prior_invoiced` is caller-supplied cumulative quantities excluding this invoice. The server never silently updates it from saved reports. Accepted counts exclude rejected counts. Money uses integer minor units; quantities use bounded whole units. Up to500 PO/invoice lines are fully free. Free saves3 reports at a time; Pro removes that count cap. CSV/get/list/delete remain free. Matching data stays local under the XDG data directory; no hosted URL is configured.

After a Pro purchase at https://mcp.zovo.one/buy/three-way-match, call `license_activate` with the key or set `MCP_LICENSE_KEY`. Verification is offline. Source documentation and limits: [README.md](README.md). Built by [theluckystrike](https://github.com/theluckystrike).
