import { saveReport } from '../dist/store.js';
import { match } from '../dist/core.js';
import { fixture } from './helpers.mjs';
const saved = await saveReport(match(fixture()), false);
process.stdout.write(JSON.stringify({ saved: saved !== null }));
