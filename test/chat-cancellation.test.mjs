import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.FABRIC_NATIVE_DISABLE = '1';
process.env.FABRIC_MASTER_KEY = 'disposable-cancellation-test-key-32-characters';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabric-cancel-'));
process.env.FABRIC_DATA_DIR = dir;
const { server } = await import('../src/server.mjs');

test('disconnected chat records partial cancellation rather than silently losing it', async t => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const reg = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cancel QA', email: 'cancel@example.test', password: 'disposable test password' }) });
  const data = await reg.json(); const cookie = reg.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': data.csrf };
  const row = await (await fetch(base + '/api/conversations', { method: 'POST', headers, body: '{}' })).json();
  const controller = new AbortController();
  const response = await fetch(base + '/api/chat/stream', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ conversationId: row.id, content: 'long cancellation prompt '.repeat(100), maxTokens: 128 }) });
  const reader = response.body.getReader(); let seen = '';
  while (!seen.includes('event: token')) { const part = await reader.read(); if (part.done) throw new Error('Stream ended before cancellation test'); seen += Buffer.from(part.value).toString(); }
  controller.abort(); await reader.cancel().catch(() => {});
  let messages = [];
  for (let i = 0; i < 100; i++) {
    messages = (await (await fetch(base + '/api/conversations/' + row.id, { headers: { cookie } })).json()).messages;
    if (messages.some(message => message.status === 'cancelled')) break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const cancelled = messages.find(message => message.status === 'cancelled');
  assert.ok(cancelled); assert.equal(cancelled.role, 'assistant'); assert.ok(cancelled.content.length > 0);
  assert.ok(!messages.some(message => message.status === 'error'));
});
