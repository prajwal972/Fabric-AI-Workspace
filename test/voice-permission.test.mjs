import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
test('same-origin microphone permission is allowed',()=>{assert.match(server,/microphone=\(self\)/);assert.doesNotMatch(server,/microphone=\(\)/);assert.match(server,/version:'1\.10\.4'/)});
test('voice explains secure-context and denied-permission recovery',()=>{assert.match(app,/window\.isSecureContext/);assert.match(app,/browser site controls/);assert.match(app,/trusted HTTPS/);assert.match(app,/startLocalVoice\(\)/)});
