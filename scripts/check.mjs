import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
async function files(dir) {
  const list = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) list.push(...await files(name));
    else if (/\.(mjs|js)$/.test(name)) list.push(name);
  }
  return list;
}
for (const file of (await Promise.all(['src', 'scripts', 'public', 'test', 'integration'].map(files))).flat()) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
const config = spawnSync(process.execPath, ['--check', 'playwright.config.mjs'], { stdio: 'inherit' });
if (config.status !== 0) process.exit(config.status || 1);
const runtimeConfig=spawnSync(process.execPath,['--check','playwright.runtime.config.mjs'],{stdio:'inherit'});if(runtimeConfig.status!==0)process.exit(runtimeConfig.status||1);
console.log('JavaScript syntax checks passed.');
