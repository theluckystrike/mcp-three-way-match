import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { VERSION } from '../dist/version.js';
const root = new URL('../', import.meta.url);
test('package, runtime version and all local registry descriptors agree', () => {
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.name, '@theluckystrike/mcp-three-way-match'); assert.equal(pkg.version, VERSION);
  let release;
  for (const name of readdirSync(root).filter(n => /^server(?:\..+)?\.json$/.test(n))) {
    const descriptor = JSON.parse(readFileSync(new URL(name, root), 'utf8'));
    assert.equal(descriptor.version, VERSION); assert.equal(descriptor.repository.subfolder, 'servers/three-way-match'); assert(!descriptor.remotes?.length);
    for (const p of descriptor.packages) { assert.equal(p.version, VERSION); assert.equal(p.transport.type, 'stdio'); release ??= p.identifier; assert.equal(p.identifier, release); }
  }
});
test('release and operational files are present; source does not open network connections', () => {
  for (const file of ['README.md', 'llms-install.md', 'SPEC.md', 'LICENSE', 'Dockerfile', 'smithery.yaml', 'glama.json', 'server.json', 'server.mcpb.json', 'server.supplier-invoice-matching.json']) assert(existsSync(new URL(file, root)), file);
  for (const file of readdirSync(new URL('src/', root)).filter(n => n.endsWith('.ts'))) {
    const source = readFileSync(new URL(`src/${file}`, root), 'utf8');
    assert(!/fetch\s*\(|node:(?:https?|net|dns)|console\.(?:log|info)/.test(source), file);
  }
});
