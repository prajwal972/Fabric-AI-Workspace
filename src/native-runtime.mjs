import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const exists = async file => fs.promises.access(file, fs.constants.F_OK).then(() => true, () => false);
const readJson = async file => { try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch { return null; } };
const trimBase = value => String(value || '').replace(/\/$/, '');

export function createNativeRuntime({ root, dataDir, log = () => {} }) {
  const nativeDir = path.join(dataDir, 'native');
  const manifestFile = path.join(nativeDir, 'manifest.json');
  const statusFile = path.join(nativeDir, 'install-status.json');
  const logFile = path.join(nativeDir, 'install.log');
  const installScript = path.join(root, 'scripts', 'install-native.mjs');
  const llmPort = Number(process.env.FABRIC_NATIVE_LLM_PORT || 11990);
  const nativeThreads = Number(process.env.FABRIC_NATIVE_THREADS || Math.max(1, Math.min(8, (os.availableParallelism?.() || os.cpus().length) - 1)));
  const nativeContext = Number(process.env.FABRIC_NATIVE_CONTEXT || 4096);
  const nativeBatch = Number(process.env.FABRIC_NATIVE_BATCH || 256);
  const sttPort = Number(process.env.FABRIC_NATIVE_STT_PORT || 11991);
  const configuredLlm = trimBase(process.env.FABRIC_NATIVE_BASE_URL || '');
  const configuredStt = trimBase(process.env.FABRIC_NATIVE_STT_URL || '');
  let installer = null;
  let installerComponent = null;
  let llmProcess = null;
  let sttProcess = null;

  async function endpointReady(url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
      return response.ok || response.status === 404;
    } catch { return false; }
  }

  async function manifest() { return readJson(manifestFile); }

  async function status() {
    const m = await manifest();
    const install = await readJson(statusFile) || { state: m ? 'installed' : 'not-installed', stage: m ? 'Ready' : 'Not installed', percent: m ? 100 : 0 };
    const llmFiles = !!(m?.llmExecutable && m?.llmModel && await exists(m.llmExecutable) && await exists(m.llmModel));
    const sttFiles = !!(m?.sttExecutable && m?.sttModel && await exists(m.sttExecutable) && await exists(m.sttModel));
    const llmUrl = configuredLlm || `http://127.0.0.1:${llmPort}/v1`;
    const sttUrl = configuredStt || `http://127.0.0.1:${sttPort}`;
    return {
      platform: process.platform,
      arch: process.arch,
      state: install.state,
      stage: install.stage,
      percent: Number(install.percent || 0),
      downloadedBytes: Number(install.downloadedBytes || 0),
      totalBytes: Number(install.totalBytes || 0),
      bytesPerSecond: Number(install.bytesPerSecond || 0),
      etaSeconds: install.etaSeconds == null ? null : Number(install.etaSeconds),
      currentFile: install.currentFile || null,
      downloadStartedAt: install.downloadStartedAt || null,
      error: install.error || null,
      component: install.component || null,
      components: install.components || null,
      diagnostics: install.diagnostics || null,
      installed: !!configuredLlm || llmFiles,
      voiceInstalled: !!configuredStt || sttFiles,
      llmReady: await endpointReady(llmUrl.replace(/\/v1$/, '') + '/health'),
      voiceReady: await endpointReady(sttUrl + '/health'),
      modelName: 'Fabric1.0',
      runtime: configuredLlm ? 'managed-endpoint' : 'Fabric Native',
      modelFile: m?.llmModel ? path.basename(m.llmModel) : null,
      voiceModelFile: m?.sttModel ? path.basename(m.sttModel) : null,
      license: m?.license || 'Runtime and base weights retain their upstream licenses.'
    };
  }

  async function install(component = 'all') {
    if (!['all', 'llm', 'voice'].includes(component)) component = 'all';
    await fs.promises.mkdir(nativeDir, { recursive: true, mode: 0o700 });
    if (installer && installer.exitCode == null) return { ...(await status()), installerComponent };
    const current = await status();
    if ((component === 'all' && current.installed && current.voiceInstalled) || (component === 'llm' && current.installed) || (component === 'voice' && current.voiceInstalled)) return current;
    await fs.promises.rm(statusFile + '.tmp', { force: true });
    const output = fs.openSync(logFile, 'a');
    installerComponent = component;
    installer = spawn(process.execPath, [installScript, '--data-dir', dataDir, '--component', component], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', output, output],
      windowsHide: true
    });
    installer.on('error', error => log('native.install.error', { component, error: error.message }));
    installer.on('close', code => { log('native.install.complete', { component, code }); installer = null; installerComponent = null; try { fs.closeSync(output); } catch {} });
    return { ...(await status()), state: 'starting', component, stage: component === 'voice' ? 'Starting Fabric Voice installation' : component === 'llm' ? 'Starting Fabric1.0 installation' : 'Starting Fabric native installation' };
  }

  async function waitFor(url, processRef, label) {
    for (let attempt = 0; attempt < 120; attempt++) {
      if (await endpointReady(url)) return;
      if (processRef?.exitCode != null) throw Object.assign(new Error(`${label} stopped before becoming ready`), { code: 'NATIVE_RUNTIME_FAILED' });
      await sleep(500);
    }
    throw Object.assign(new Error(`${label} did not become ready`), { code: 'NATIVE_RUNTIME_TIMEOUT' });
  }

  async function ensureLlm({ autoInstall = true } = {}) {
    if (configuredLlm) return configuredLlm;
    const base = `http://127.0.0.1:${llmPort}/v1`;
    if (await endpointReady(`http://127.0.0.1:${llmPort}/health`)) return base;
    const m = await manifest();
    if (!m?.llmExecutable || !m?.llmModel || !await exists(m.llmExecutable) || !await exists(m.llmModel)) {
      if (autoInstall) await install('llm');
      throw Object.assign(new Error('Fabric1.0 native installation is running. Open Studio to view download progress, then retry when it reaches 100%.'), { code: 'FABRIC_NATIVE_INSTALLING', status: 503 });
    }
    if (!llmProcess || llmProcess.exitCode != null) {
      const args = ['-m', m.llmModel, '--host', '127.0.0.1', '--port', String(llmPort), '-c', String(nativeContext), '-t', String(nativeThreads), '-tb', String(nativeThreads), '-b', String(nativeBatch), '-ngl', String(Number(process.env.FABRIC_NATIVE_GPU_LAYERS || 0))];
      llmProcess = spawn(m.llmExecutable, args, { cwd: path.dirname(m.llmExecutable), stdio: 'ignore', windowsHide: true });
      llmProcess.on('error', error => log('native.llm.error', { error: error.message }));
    }
    await waitFor(`http://127.0.0.1:${llmPort}/health`, llmProcess, 'Fabric native model');
    return base;
  }

  async function ensureStt({ autoInstall = true } = {}) {
    if (configuredStt) return configuredStt;
    const base = `http://127.0.0.1:${sttPort}`;
    if (await endpointReady(base + '/health')) return base;
    const m = await manifest();
    if (!m?.sttExecutable || !m?.sttModel || !await exists(m.sttExecutable) || !await exists(m.sttModel)) {
      if (autoInstall) await install('voice');
      throw Object.assign(new Error('Fabric Voice is being installed. Open Studio to view download progress, then retry when it reaches 100%.'), { code: 'FABRIC_VOICE_INSTALLING', status: 503 });
    }
    if (!sttProcess || sttProcess.exitCode != null) {
      const args = ['-m', m.sttModel, '--host', '127.0.0.1', '--port', String(sttPort)];
      sttProcess = spawn(m.sttExecutable, args, { cwd: path.dirname(m.sttExecutable), stdio: 'ignore', windowsHide: true });
      sttProcess.on('error', error => log('native.voice.error', { error: error.message }));
    }
    await waitFor(base + '/health', sttProcess, 'Fabric Voice');
    return base;
  }

  function shutdown() {
    for (const child of [llmProcess, sttProcess, installer]) try { if (child?.exitCode == null) child.kill(); } catch {}
  }

  return { status, install, ensureLlm, ensureStt, shutdown, paths: { nativeDir, manifestFile, statusFile, logFile } };
}
