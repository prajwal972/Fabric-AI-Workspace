import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateRuntimeConfig } from '../src/server/config.mjs';
import { securityHeaders } from '../src/server/security-headers.mjs';
import { AppError, publicError, safeErrorMessage } from '../src/server/errors.mjs';
import { withTransaction } from '../src/database/transaction.mjs';
import { LocalConversationRepository } from '../src/repositories/conversation.mjs';
import { ConversationService } from '../src/services/conversation.mjs';
import { can, requiredPermission } from '../src/security/rbac.mjs';

const actor = { user: { id: 'u1' }, workspaceId: 'w1', role: 'member' };
function fixture() {
  const store = { conversations: [], messages: [] };
  let saves = 0;
  const repo = new LocalConversationRepository({ getStore: () => store, save: async () => { saves++; } });
  return { store, service: new ConversationService(repo), saves: () => saves };
}

test('config validates URLs, ports and keys without exposing supplied values', () => {
  assert.equal(validateRuntimeConfig({ NODE_ENV: 'test' }).persistence, 'local-json');
  for (const env of [{ FABRIC_PORT: 'oops' }, { FABRIC_MASTER_KEY: 'short' }, { DATABASE_URL: 'https://secret.example' }, { REDIS_URL: 'file:///tmp/secret' }]) assert.throws(() => validateRuntimeConfig(env));
});

test('production cannot silently use JSON even with a configured health-check database', () => {
  const env = { NODE_ENV: 'production', FABRIC_MASTER_KEY: 'x'.repeat(48), DATABASE_URL: 'postgresql://user:secret@localhost/fabric', FABRIC_PUBLIC_URL: 'https://fabric.example' };
  assert.throws(() => validateRuntimeConfig(env), { code: 'PRODUCTION_PERSISTENCE_NOT_MIGRATED' });
  assert.throws(() => validateRuntimeConfig({ NODE_ENV: 'production' }), /MASTER_KEY/);
});

test('production startup refusal occurs before creating data or binding an API', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabric-startup-gate-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const data = path.join(dir, 'must-not-exist');
  const child = spawn(process.execPath, ['src/server.mjs'], { env: { ...process.env, NODE_ENV: 'production', FABRIC_MASTER_KEY: 'x'.repeat(48), DATABASE_URL: 'postgresql://unused:secret@127.0.0.1:1/fabric', FABRIC_PUBLIC_URL: 'https://fabric.example', FABRIC_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => child.kill());
  const exit = await Promise.race([new Promise(resolve => child.once('close', resolve)), new Promise((_, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error('Startup gate failed to exit')); }, 10000); timer.unref(); child.once('close', () => clearTimeout(timer)); })]);
  assert.notEqual(exit, 0); assert.match(stderr, /Production startup blocked/);
  assert.ok(!stderr.includes('unused:secret')); await assert.rejects(fs.stat(data), { code: 'ENOENT' });
});

test('production security headers include HSTS, while local development does not', () => {
  const headers = securityHeaders({ production: true });
  assert.match(headers['strict-transport-security'], /max-age=31536000/);
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(securityHeaders()['strict-transport-security'], undefined);
});

test('public errors have stable codes/request IDs and reject raw secrets/paths/stacks', () => {
  for (const message of ['Bearer very-secret-value', 'postgresql://user:password@db/x', 'Failed /data/private/file', 'Failure\n at worker (src:2)', 'token=supersecret', 'File missing /etc/private-config', '"apiKey":"sensitive-value"']) assert.ok(!safeErrorMessage(message).includes(message));
  assert.equal(safeErrorMessage('Temperature must be between 0 and 2', 400), 'Temperature must be between 0 and 2');
  assert.deepEqual(publicError(new AppError('NOT_FOUND', 'Conversation not found.', 404), 'r1'), { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Conversation not found.', requestId: 'r1' } } });
  const unexpected = publicError(new Error('private implementation details'), 'r2');
  assert.equal(unexpected.body.error.message, 'Internal server error'); assert.equal(unexpected.body.error.requestId, 'r2');
});

test('transaction helper commits and releases one connection; failures roll back', async () => {
  const calls = [];
  const client = { query: async sql => { calls.push(sql); }, release: () => calls.push('release') };
  const pool = { connect: async () => client };
  assert.equal(await withTransaction(pool, async c => { assert.equal(c, client); await c.query('work'); return 42; }), 42);
  assert.deepEqual(calls, ['BEGIN', 'work', 'COMMIT', 'release']); calls.length = 0;
  await assert.rejects(withTransaction(pool, async () => { throw new Error('failed'); }), /failed/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'release']);
});

test('conversation service performs persisted local CRUD and bounded pages', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) await f.service.create(actor, { title: 'Item ' + i });
  const page = await f.service.list(actor, { limit: 2 });
  assert.equal(page.items.length, 2); assert.equal(page.nextOffset, 2);
  const second = await f.service.list(actor, { limit: 2, offset: page.nextOffset });
  assert.equal(second.items.length, 1); assert.equal(second.nextOffset, null);
  const row = page.items[0]; await f.service.update(actor, row.id, { title: 'Changed' });
  assert.equal((await f.service.get(actor, row.id)).title, 'Changed');
  f.store.messages.push({ workspaceId: 'w1', conversationId: row.id, content: 'delete me' }, { workspaceId: 'w2', conversationId: row.id, content: 'do not touch' });
  await f.service.delete(actor, row.id); assert.equal(f.store.messages.length, 1); assert.equal(f.store.messages[0].workspaceId, 'w2');
  assert.equal(f.saves(), 5);
});

test('conversation service blocks viewers, unknown roles and cross-workspace access', async () => {
  const f = fixture(); const row = await f.service.create(actor, { title: 'Secret' });
  await assert.rejects(f.service.get({ ...actor, workspaceId: 'w2' }, row.id), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.update({ ...actor, workspaceId: 'w2' }, row.id, { title: 'attack' }), { code: 'NOT_FOUND' });
  await assert.rejects(f.service.delete({ ...actor, workspaceId: 'w2' }, row.id), { code: 'NOT_FOUND' });
  for (const role of ['viewer', 'unknown']) await assert.rejects(f.service.create({ ...actor, role }, {}), { code: 'FORBIDDEN' });
  assert.throws(() => f.service.list({ ...actor, user: null }), { code: 'UNAUTHORIZED' });
  assert.throws(() => f.service.list(actor, { limit: 1000 }), { code: 'VALIDATION_ERROR' });
  await assert.rejects(f.service.create(actor, { title: 'x'.repeat(121) }), { code: 'VALIDATION_ERROR' });
  assert.equal(f.store.conversations.length, 1);
});

test('dashboard operations require analyst.run independently of general workspace writes', () => {
  assert.equal(requiredPermission('POST', '/api/agents/dashboard-operation'), 'analyst.run');
  assert.equal(can('viewer', 'analyst.run'), false);
});

test('unreachable workflow runner is removed without deleting legacy stored data', async () => {
  const source = await fs.readFile('src/server.mjs', 'utf8');
  assert.ok(!source.includes("if(false&&p==='/api/workflows'"));
  assert.ok(!source.includes('workflow.completed')); assert.ok(source.includes('WORKFLOWS_REMOVED'));
  assert.ok(source.includes('workflows:[]'));
});
