import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.FLUX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'flux-core-'));
process.env.FLUX_MASTER_KEY = 'test-master-key-32-characters-long!!';
const { internals } = await import('../src/server.mjs');

test('password hashing uses Argon2id with a unique salt', async () => {
  const a = await internals.hashPass('correct horse battery staple');
  const b = await internals.hashPass('correct horse battery staple');
  assert.notEqual(a, b);
  assert.match(a, /^\$argon2id\$/);
  assert.equal(await internals.checkPass('correct horse battery staple', a), true);
  assert.equal(await internals.checkPass('incorrect value', a), false);
});

test('authenticated encryption rejects tampering', () => {
  const encrypted = internals.enc('sk-sensitive');
  assert.ok(!encrypted.includes('sk-sensitive'));
  assert.equal(internals.dec(encrypted), 'sk-sensitive');
  assert.throws(() => internals.dec(encrypted.slice(0, -2) + 'aa'));
});

test('logs redact sensitive fields', () => {
  assert.deepEqual(
    internals.redact({ apiKey: 'x', nested: { password: 'y' }, safe: 1 }),
    { apiKey: '[REDACTED]', nested: { password: '[REDACTED]' }, safe: 1 },
  );
});

test('SSRF controls reject private targets', () => {
  assert.throws(() => internals.remoteUrl('http://169.254.169.254/latest'));
  assert.throws(() => internals.remoteUrl('http://127.0.0.1'));
  assert.throws(() => internals.remoteUrl('http://[::1]'));
  assert.doesNotThrow(() => internals.remoteUrl('http://127.0.0.1', true));
});

test('calculator is bounded', () => {
  assert.equal(internals.calc('(12 + 3) * 4'), 60);
  assert.throws(() => internals.calc('process.exit()'));
});

test('mock provider streams', async () => {
  let output = '';
  for await (const chunk of new internals.Mock().stream({ messages: [{ role: 'user', content: 'hello' }] })) output += chunk.text;
  assert.match(output, /Mock response: hello/);
});

test('URL rejects malformed and unsupported endpoints', () => {
  assert.throws(() => internals.remoteUrl('file:///etc/passwd'));
  assert.throws(() => internals.remoteUrl('not a url'));
});

test('provider HTTP failures are actionable', () => {
  assert.match(internals.providerHttpError(401).message, /API key was rejected/);
  assert.match(internals.providerHttpError(402).message, /credits/);
  assert.match(internals.providerHttpError(403).message, /permissions/);
  assert.match(internals.providerHttpError(404).message, /base URL/);
  assert.match(internals.providerHttpError(429).message, /quota/);
  assert.match(internals.providerHttpError(503).message, /temporarily unavailable/);
});

test('OpenAI reasoning models use Responses API only on official endpoint',()=>{assert.equal(internals.usesResponsesApi('https://api.openai.com/v1','o4-mini-2025-04-16'),true);assert.equal(internals.usesResponsesApi('https://api.openai.com/v1','gpt-4.1-mini'),false);assert.equal(internals.usesResponsesApi('https://api.groq.com/openai/v1','o4-mini'),false)});

test('provider deprecation messages are detected',()=>{assert.equal(internals.isDeprecatedMessage("The model has been deprecated"),true);assert.equal(internals.isDeprecatedMessage('temporary provider outage'),false)});


test('task modes and artifact paths are bounded',()=>{assert.equal(internals.taskMode('website'),'website');assert.equal(internals.taskMode('unknown'),'general');assert.equal(internals.artifactPath('../../src/../app.js'),'src/app.js');assert.ok(internals.TASK_MODES.research.prompt.includes('cit'))});
test('project outputs become safe downloadable ZIPs',()=>{const files=internals.projectFiles('```file path="src/index.js"\nconsole.log("ok")\n```\n```file path="../README.md"\n# Demo\n```');assert.deepEqual(files.map(x=>x.path),['src/index.js','README.md']);const zip=internals.zipStore(files);assert.equal(zip.subarray(0,2).toString(),'PK');assert.ok(zip.length>100)});
test('research endpoints only permit explicit local services or public URLs',()=>{assert.equal(internals.researchEndpoint('http://127.0.0.1:8080'),'http://127.0.0.1:8080');assert.equal(internals.researchEndpoint('http://searxng:8080'),'http://searxng:8080');assert.throws(()=>internals.researchEndpoint('http://192.168.1.2:8080'));assert.throws(()=>internals.researchEndpoint('https://localhost:8080'))});


test('performance profiles stay bounded',()=>{assert.equal(internals.performanceMode('fast'),'fast');assert.equal(internals.performanceMode('bad'),'fast');assert.ok(internals.PERFORMANCE.fast.fileBudget<internals.PERFORMANCE.quality.fileBudget);assert.equal(internals.fileKind('photo.png','image/png'),'image');assert.equal(internals.fileKind('movie.mp4','video/mp4'),'video');assert.equal(internals.fileKind('unknown.bin'),'binary')});
test('ZIP extraction reads generated project bundles',()=>{const zip=internals.zipStore([{path:'word/document.xml',content:'<w:p><w:t>Hello</w:t></w:p>'}]),entries=internals.zipEntries(zip);assert.equal(entries.get('word/document.xml').toString(),'<w:p><w:t>Hello</w:t></w:p>');assert.match(internals.officeText(zip,'.docx'),/Hello/)});
