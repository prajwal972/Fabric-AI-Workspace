export function validateRuntimeConfig(env = process.env) {
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test', 'staging', 'production'].includes(mode)) throw new Error('Unsupported NODE_ENV');
  const port = Number(env.FABRIC_PORT || env.FLUX_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('FABRIC_PORT must be an integer between 0 and 65535');
  const key = env.FABRIC_MASTER_KEY || env.FLUX_MASTER_KEY;
  if (key && key.length < 32) throw new Error('FABRIC_MASTER_KEY must be at least 32 characters');
  for (const name of ['DATABASE_URL', 'REDIS_URL', 'FABRIC_PUBLIC_URL', 'S3_ENDPOINT']) {
    if (!env[name]) continue;
    let url; try { url = new URL(env[name]); } catch { throw new Error(`${name} must be a valid URL`); }
    const protocols = name === 'DATABASE_URL' ? ['postgres:', 'postgresql:'] : name === 'REDIS_URL' ? ['redis:', 'rediss:'] : ['http:', 'https:'];
    if (!protocols.includes(url.protocol)) throw new Error(`${name} uses an unsupported protocol`);
  }
  if (['production', 'staging'].includes(mode)) {
    if (!key) throw new Error('FABRIC_MASTER_KEY is required outside development/testing');
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required outside development/testing');
    if (!env.FABRIC_PUBLIC_URL?.startsWith('https://')) throw new Error('FABRIC_PUBLIC_URL must use HTTPS outside development/testing');
    // This checkpoint has not migrated authentication/chat/files/analyst and other
    // live routes. Refuse rather than silently pretend the health-check pool is storage.
    throw Object.assign(new Error('Production startup blocked: live route persistence migration is incomplete. JSON storage is local development/demo only. See docs/engineering/IMPLEMENTATION_PLAN.md.'), { code: 'PRODUCTION_PERSISTENCE_NOT_MIGRATED' });
  }
  return { mode, port, persistence: 'local-json' };
}
