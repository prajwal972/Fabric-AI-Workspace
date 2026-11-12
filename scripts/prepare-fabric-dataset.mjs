import fs from 'node:fs/promises';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/prepare-fabric-dataset.mjs input.jsonl output.jsonl');
  process.exit(2);
}
const lines = (await fs.readFile(path.resolve(input), 'utf8')).split(/\r?\n/).filter(Boolean);
const clean = [];
for (let i = 0; i < lines.length; i++) {
  let row;
  try { row = JSON.parse(lines[i]); } catch { throw new Error(`Invalid JSON on line ${i + 1}`); }
  if (!Array.isArray(row.messages) || row.messages.length < 2) throw new Error(`Line ${i + 1} needs a messages array with at least two turns`);
  const messages = row.messages.map((m) => ({ role: String(m.role || ''), content: String(m.content || '').trim() }));
  if (messages.some((m) => !['system', 'user', 'assistant'].includes(m.role) || !m.content)) throw new Error(`Line ${i + 1} contains an invalid message`);
  if (!messages.some((m) => m.role === 'user') || !messages.some((m) => m.role === 'assistant')) throw new Error(`Line ${i + 1} needs user and assistant turns`);
  clean.push(JSON.stringify({ messages }));
}
await fs.mkdir(path.dirname(path.resolve(output)), { recursive: true });
await fs.writeFile(path.resolve(output), clean.join('\n') + (clean.length ? '\n' : ''));
console.log(`Validated ${clean.length} Fabric 1.0 examples.`);
