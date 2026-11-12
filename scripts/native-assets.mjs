const archivePattern = /\.(?:zip|tar\.gz)$/i;
const gpuPattern = /(?:cuda|cublas|cudart|vulkan|rocm|hip|sycl|openvino|opencl|metal)/i;

function architectureMatches(name, arch) {
  const n = name.toLowerCase();
  if (arch === 'x64') return /(?:x64|x86_64|amd64)/.test(n) && !/(?:arm64|aarch64|win32|i686)/.test(n);
  if (arch === 'arm64') return /(?:arm64|aarch64)/.test(n) && !/(?:x64|x86_64|amd64|win32|i686)/.test(n);
  return n.includes(arch.toLowerCase());
}

export function scoreRuntimeAsset(name, { kind, platform, arch }) {
  const n = String(name || '').toLowerCase();
  const reasons = [];
  if (!archivePattern.test(n)) reasons.push('not a ZIP or tar.gz archive');
  if (gpuPattern.test(n)) reasons.push('optional GPU-specific build');
  if (kind === 'llama' && !/^llama-/.test(n)) reasons.push('not a llama.cpp binary archive');
  if (kind === 'whisper' && !/^whisper-/.test(n)) reasons.push('not a whisper.cpp binary archive');
  if (platform === 'win32' && !/(?:^|-)win(?:32|-|$)|bin-(?:x64|arm64)\.zip$/.test(n)) reasons.push('not a Windows build');
  if (platform === 'linux' && !/(?:linux|ubuntu)/.test(n)) reasons.push('not a Linux build');
  if (platform === 'darwin' && !/(?:macos|darwin)/.test(n)) reasons.push('not a macOS build');
  if (!architectureMatches(n, arch)) reasons.push(`not ${arch}`);
  if (reasons.length) return { score: -1, reasons };
  let score = 100;
  if (/cpu/.test(n)) score += 20;
  if (/\bbin\b|bin-/.test(n)) score += 8;
  if (kind === 'llama' && /win-cpu-x64/.test(n)) score += 40;
  if (kind === 'whisper' && /whisper-bin-x64\.zip$/.test(n)) score += 40;
  if (/blas/.test(n)) score -= 10;
  return { score, reasons: ['compatible portable CPU build'] };
}

export function selectRuntimeAsset(releases, options) {
  const rows = [];
  for (let releaseIndex = 0; releaseIndex < (Array.isArray(releases) ? releases.length : 0); releaseIndex++) {
    const release = releases[releaseIndex] || {};
    for (const asset of Array.isArray(release.assets) ? release.assets : []) {
      const evaluation = scoreRuntimeAsset(asset.name, options);
      rows.push({ asset, release: release.tag_name || release.name || `release-${releaseIndex + 1}`, releaseIndex, ...evaluation });
    }
  }
  const compatible = rows.filter(row => row.score >= 0).sort((a, b) => (b.score - a.score) || (a.releaseIndex - b.releaseIndex));
  if (!compatible.length) {
    const sample = rows.slice(0, 18).map(row => `${row.asset?.name || 'unnamed'} (${row.reasons.join(', ')})`);
    const error = new Error(`No compatible ${options.kind} runtime archive was found for ${options.platform}/${options.arch}. Checked ${rows.length} assets.${sample.length ? ` Candidates: ${sample.join('; ')}` : ''}`);
    error.code = 'NO_COMPATIBLE_RUNTIME';
    error.diagnostics = rows;
    throw error;
  }
  return { ...compatible[0], diagnostics: rows };
}

export function runtimeDiagnostics(selection, options) {
  const rejected = selection.diagnostics.filter(row => row.score < 0).slice(0, 12).map(row => ({ name: row.asset?.name || 'unnamed', reason: row.reasons.join(', ') }));
  return { kind: options.kind, platform: options.platform, arch: options.arch, selected: selection.asset.name, release: selection.release, rejected };
}
