import { readdir, readFile, writeFile, cp, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { getMacroDefines } from './scripts/defines.ts'

const outdir = 'dist'

// Step 1: Clean output directory
const { rmSync } = await import('fs')
rmSync(outdir, { recursive: true, force: true })

// Step 1.5: Generate review builtin files
console.log('Generating review builtin files...')
const { spawnSync: genSpawnSync } = await import('child_process')
const genResult = genSpawnSync('bun', ['run', 'scripts/generate-review-builtin.ts'], {
  stdio: 'inherit',
  cwd: process.cwd(),
})
if (genResult.status !== 0) {
  console.warn('Warning: generate-review-builtin.ts failed, using existing files')
}

// Default features that match the official CLI build.
// Additional features can be enabled via FEATURE_<NAME>=1 env vars.
const DEFAULT_BUILD_FEATURES = [
  'AGENT_TRIGGERS_REMOTE',
  'CHICAGO_MCP',
  'VOICE_MODE',
  'SHOT_STATS',
  'PROMPT_CACHE_BREAK_DETECTION',
  'TOKEN_BUDGET',
  // P0: local features
  'AGENT_TRIGGERS',
  'ULTRATHINK',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'LODESTONE',
  // P1: API-dependent features
  'EXTRACT_MEMORIES',
  'VERIFICATION_AGENT',
  'KAIROS_BRIEF',
  'AWAY_SUMMARY',
  'ULTRAPLAN',
  // P2: daemon + remote control server
  'DAEMON',
  // PR-package restored features
  'WORKFLOW_SCRIPTS',
  'HISTORY_SNIP',
  'CONTEXT_COLLAPSE',
  'MONITOR_TOOL',
  'FORK_SUBAGENT',
//   'UDS_INBOX',
  'KAIROS',
  'COORDINATOR_MODE',
  'LAN_PIPES',
  // 'REVIEW_ARTIFACT', // API 请求无响应，需进一步排查 schema 兼容性
  // P3: poor mode (disable extract_memories + prompt_suggestion)
  'POOR',
  // P3: serve mode (HTTP API server)
  'DIRECT_CONNECT',
]

// Collect FEATURE_* env vars → Bun.build features
const envFeatures = Object.keys(process.env)
  .filter(k => k.startsWith('FEATURE_'))
  .map(k => k.replace('FEATURE_', ''))
const features = [...new Set([...DEFAULT_BUILD_FEATURES, ...envFeatures])]

// Step 2: Bundle main entrypoint
const result = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  outdir,
  target: 'bun',
  splitting: true,
  sourcemap: 'linked',
  define: {
    ...getMacroDefines(),
    // React production mode — eliminates _debugStack Error objects
    // (6,889 objects × ~1.7KB = 12MB in development builds) and removes
    // prop-type / key warnings not useful in a production CLI tool.
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
})

// Step 2.5: Bundle raw dump worker (standalone, no splitting)
const workerResult = await Bun.build({
  entrypoints: ['src/services/rawDump/batchWorker.ts'],
  outdir,
  target: 'bun',
  sourcemap: 'linked',
  define: {
    ...getMacroDefines(),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  features,
})

if (!result.success || !workerResult.success) {
  console.error('Build failed:')
  for (const log of [...result.logs, ...workerResult.logs]) {
    console.error(log)
  }
  process.exit(1)
}

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir)
const IMPORT_META_REQUIRE = 'var __require = import.meta.require;'
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`

let patched = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (content.includes(IMPORT_META_REQUIRE)) {
    await writeFile(
      filePath,
      content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
    )
    patched++
  }
}

// Step 3.5: Replace feature('FLAG_NAME') with true/false at build time
// Bun.build does not natively replace feature flags, so we do it manually here
// to match the behavior of vite-plugin-feature-flags.ts.
const FEATURE_CALL_RE = /feature\s*\(\s*['"]([\w]+)['"]\s*\)/g
let featureReplaced = 0
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  let matchCount = 0
  const transformed = content.replace(FEATURE_CALL_RE, (match, flagName) => {
    matchCount++
    return features.includes(flagName) ? 'true' : 'false'
  })
  if (matchCount > 0) {
    await writeFile(filePath, transformed)
    featureReplaced += matchCount
  }
}

// Also patch unguarded globalThis.Bun destructuring from third-party deps
// (e.g. @anthropic-ai/sandbox-runtime) so Node.js doesn't crash at import time.
let bunPatched = 0
const BUN_DESTRUCTURE = /var \{([^}]+)\} = globalThis\.Bun;?/g
const BUN_DESTRUCTURE_SAFE =
  'var {$1} = typeof globalThis.Bun !== "undefined" ? globalThis.Bun : {};'
for (const file of files) {
  if (!file.endsWith('.js')) continue
  const filePath = join(outdir, file)
  const content = await readFile(filePath, 'utf-8')
  if (BUN_DESTRUCTURE.test(content)) {
    await writeFile(
      filePath,
      content.replace(BUN_DESTRUCTURE, BUN_DESTRUCTURE_SAFE),
    )
    bunPatched++
  }
}
BUN_DESTRUCTURE.lastIndex = 0

console.log(
  `Bundled ${result.outputs.length} files to ${outdir}/ (patched ${patched} for Node.js compat)`,
)

// Step 3.9: Move raw dump worker to expected subdir (must happen after patches, before map cleanup)
const workerSrc = join(outdir, 'batchWorker.js')
const workerDstDir = join(outdir, 'services', 'rawDump')
const workerDst = join(workerDstDir, 'batchWorker.js')
try {
  await mkdir(workerDstDir, { recursive: true })
  await cp(workerSrc, workerDst)
  await unlink(workerSrc)
  console.log(`Moved batchWorker.js → ${workerDst}`)
} catch (err) {
  console.warn('Warning: could not move batchWorker.js:', (err as Error).message)
}

// Step 4: Copy native .node addon files (audio-capture) and vendored binaries (ripgrep)
const audioCaptureDir = join(outdir, 'vendor', 'audio-capture')
await cp('vendor/audio-capture', audioCaptureDir, { recursive: true })
console.log(`Copied vendor/audio-capture/ → ${audioCaptureDir}/`)

// Step 5: Bundle download-ripgrep script as standalone JS for postinstall
if (await Bun.file('scripts/download-ripgrep.ts').exists()) {
  const rgScript = await Bun.build({
    entrypoints: ['scripts/download-ripgrep.ts'],
    outdir,
    target: 'node',
  })
  if (!rgScript.success) {
    console.error('Failed to bundle download-ripgrep script:')
    for (const log of rgScript.logs) {
      console.error(log)
    }
    // Non-fatal — postinstall fallback to bun run scripts/download-ripgrep.ts
  } else {
    console.log(`Bundled download-ripgrep script to ${outdir}/`)
  }
} else {
  console.log('Skipping download-ripgrep script (not found)')
}

// Step 6: Generate cli-bun and cli-node executable entry points
const cliBun = join(outdir, 'cli-bun.js')
const cliNode = join(outdir, 'cli-node.js')

await writeFile(cliBun, '#!/usr/bin/env bun\nimport "./cli.js"\n')

// Node.js entry needs a Bun API polyfill because Bun.build({ target: 'bun' })
// emits globalThis.Bun references (e.g. Bun.$ shell tag in computer-use-input,
// Bun.which in chunk-ys6smqg9) that crash at import time under plain Node.js.
const NODE_BUN_POLYFILL = `#!/usr/bin/env node
// Bun API polyfill for Node.js runtime
if (typeof globalThis.Bun === "undefined") {
  const { execFileSync } = await import("child_process");
  const { resolve, delimiter } = await import("path");
  const { accessSync, constants: { X_OK } } = await import("fs");
  function which(bin) {
    const isWin = process.platform === "win32";
    const pathExt = isWin ? (process.env.PATHEXT || ".EXE").split(";") : [""];
    for (const dir of (process.env.PATH || "").split(delimiter)) {
      for (const ext of pathExt) {
        const candidate = resolve(dir, bin + ext);
        try { accessSync(candidate, X_OK); return candidate; } catch {}
      }
    }
    return null;
  }
  // Bun.$ is the shell template tag (e.g. $\`osascript ...\`). Only used by
  // computer-use-input/darwin — stub it so the top-level destructuring
  // \`var { $ } = globalThis.Bun\` doesn't crash.
  function $(parts, ...args) {
    throw new Error("Bun.$ shell API is not available in Node.js. Use Bun runtime for this feature.");
  }
  function hash(data, seed) {
    let h = ((seed || 0) ^ 0x811c9dc5) >>> 0;
    for (let i = 0; i < data.length; i++) {
      h ^= data.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }
  globalThis.Bun = { which, $, hash };
}
import "./cli.js"
`
await writeFile(cliNode, NODE_BUN_POLYFILL)
// NOTE: when new Bun-specific globals appear in bundled output, add them here.

// Make both executable
const { chmodSync } = await import('fs')
chmodSync(cliBun, 0o755)
chmodSync(cliNode, 0o755)

console.log(`Generated ${cliBun} (shebang: bun) and ${cliNode} (shebang: node)`)

// Step 7: Compile standalone executable (csc.exe on Windows, csc on Unix)
// Must use Bun.build({ compile: true, features }) instead of `bun build --compile`
// because the CLI command doesn't support the --feature flag.
// NOTE: compile mode uses outdir (not outfile) — Bun names the output after the entrypoint.
const isWin = process.platform === 'win32'
const exeName = isWin ? 'csc.exe' : 'csc'

const compileResult = await Bun.build({
  entrypoints: ['src/entrypoints/cli.tsx'],
  target: 'bun',
  compile: true,
  define: getMacroDefines(),
  features,
  outdir: import.meta.dir,
})

if (!compileResult.success) {
  console.error('Compile failed:')
  for (const log of compileResult.logs) {
    console.error(log)
  }
  process.exit(1)
}

// Rename auto-generated cli.tsx.exe → csc.exe
const generated = compileResult.outputs[0]
const targetPath = join(import.meta.dir, exeName)
if (generated && generated.path !== targetPath) {
  const { renameSync, unlinkSync, existsSync } = await import('fs')
  if (existsSync(targetPath)) {
    try { unlinkSync(targetPath) } catch { /* locked by running process */ }
  }
  renameSync(generated.path, targetPath)
}

console.log(`Compiled standalone executable: ${join(import.meta.dir, exeName)}`)

// Step 8: Clean up source maps — they add ~64MB to the package, exceeding
// npmmirror's 80MB size limit. Source maps are only useful for local
// debugging, not for package consumers.
const { unlinkSync } = await import('fs')
let mapCount = 0
for (const file of files) {
  if (file.endsWith('.map')) {
    unlinkSync(join(outdir, file))
    mapCount++
  }
}
console.log(`Cleaned ${mapCount} source map files from ${outdir}/ (saved ~64MB)`)
