import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../public/chat-layout.css',import.meta.url),'utf8');

test('settings consolidates providers, security, and logs',()=>{
  assert.match(app,/const nav=\['Dashboard','Chat','Studio','Files','Plugins','Agents','Settings'\]/);
  for(const section of ['providers','security','logs'])assert.ok(app.includes('data-settings-tab="'+section+'"'));
  assert.doesNotMatch(app,/class="btn top-settings/);
  assert.doesNotMatch(app,/class="btn top-more/);
  assert.doesNotMatch(app,/class="icon-btn modelsettings/);
  assert.match(css,/\.settings-tabs/);
});

test('chat uses one microphone with automatic language detection',()=>{
  assert.match(app,/class="icon-btn voice mic-button/);
  assert.doesNotMatch(app,/class="voice-language"/);
  assert.doesNotMatch(app,/>Hold to talk</);
  assert.match(app,/language:'auto'/);
  assert.match(server,/VOICE_AUTO_DETECT=process\.env\.FABRIC_VOICE_AUTO_DETECT!==\'0\'/);
  assert.match(server,/autoLanguageDetection:VOICE_AUTO_DETECT/);
});

test('conversation history has an accessible delete action',()=>{
  assert.match(app,/data-delete-conversation/);
  assert.match(app,/Delete this conversation and its messages\?/);
  assert.match(css,/\.thread-delete/);
});


test('task and performance controls moved into the composer overflow',()=>{
  const chat=app.slice(app.indexOf('function renderChat()'),app.indexOf('function uploadRaw'));
  assert.doesNotMatch(chat,/class="modebar"/);
  assert.match(app,/class="setmode"/);
  assert.match(app,/class="setperformance"/);
  assert.match(app,/class="icon-btn chatmore"/);
  assert.match(app,/class="btn chat-new"/);
  assert.match(css,/\.fabric-chat \.chat-new/);
});

test('chat title header is removed while mobile navigation remains available',()=>{
  const vision=fs.readFileSync(new URL('../public/vision-glass.css',import.meta.url),'utf8');
  assert.match(vision,/\.main\.chat-view-active>\.top\{display:none\}/);
  assert.match(vision,/grid-template-rows:minmax\(0,1fr\)/);
  assert.match(app,/class="btn mobile chat-mobile-menu"/);
  assert.match(app,/chat-mobile-menu'\)\.onclick/);
});
