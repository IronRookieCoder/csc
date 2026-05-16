import { basename } from 'path'

export const INIT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CSC_SERVE_INIT_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 120000
})()

export function getScriptArgsForChild(): string[] {
  const argv1 = process.argv[1]
  if (!argv1) return []
  // If the executable is not bun/node, we're in a compiled standalone binary.
  // In compiled mode, argv[1] may be the original entrypoint path (e.g.
  // "src/entrypoints/cli.tsx") which looks like a script — prevent that.
  const execBase = basename(process.execPath)
  if (!/^(bun|node)/i.test(execBase)) return []
  // Bun standalone executable embeds a virtual snapshot path like "B:/~BUN/root/cli.js".
  // This is not a real file on disk — skip it so the child process (the same exe)
  // is not launched with a bogus script argument.
  if (argv1.startsWith('B:/~BUN/') || argv1.startsWith('/snapshot/')) return []
  // When running as a compiled standalone binary (./csc), argv[1] is the binary
  // itself — same as execPath. Do not treat it as a script file.
  if (argv1 === process.execPath) return []
  if (argv1.endsWith('.ts') || argv1.endsWith('.tsx') || argv1.includes('/') || argv1.includes('\\')) {
    return [argv1]
  }
  return []
}

export function getChildSpawnArgs(): { execPath: string; scriptArgs: string[] } {
  const execPath = process.execPath
  const scriptArgs = getScriptArgsForChild()
  return { execPath, scriptArgs }
}

export async function saveChildSpawnPrefix(): Promise<void> {
  if (process.env._CSC_CHILD_SPAWN_PREFIX) return
  const { execPath, scriptArgs } = getChildSpawnArgs()
  let defineArgs: string[] = []
  let featureArgs: string[] = []
  // Only pass --feature/define flags when running TypeScript source files.
  // In compiled builds (dist/cli-node.js, standalone binary) feature flags are
  // already baked in at compile time — passing -d/--feature to the child process
  // would cause "unknown option" errors in Node.js or standalone mode.
  // Dev mode: .ts/.tsx source files need -d flags. Build: .js files don't.
  const isRunningSourceFile = scriptArgs.length > 0 && (scriptArgs[0].endsWith('.tsx') || scriptArgs[0].endsWith('.ts'))
  if (isRunningSourceFile) {
    try {
      const definesMod = await import('../../scripts/defines.js') as { getMacroDefines: () => Record<string, string>; DEFAULT_BUILD_FEATURES: readonly string[] }
      const defines = definesMod.getMacroDefines()
      defineArgs = Object.entries(defines).flatMap(([k, v]) => ['-d', `${k}:${v}`])
      const features = definesMod.DEFAULT_BUILD_FEATURES
      featureArgs = features.flatMap((f: string) => ['--feature', f])
    } catch {}
    const envFeatures = Object.entries(process.env)
      .filter(([k]) => k.startsWith('FEATURE_') && k.slice(8))
      .map(([k]) => ['--feature', k.slice(8)] as [string, string])
      .flat()
    featureArgs = [...featureArgs, ...envFeatures]
  }
  const prefix = JSON.stringify({ execPath, scriptArgs, defineArgs, featureArgs })
  process.env._CSC_CHILD_SPAWN_PREFIX = prefix
}

export function loadChildSpawnPrefix(): { execPath: string; scriptArgs: string[]; defineArgs?: string[]; featureArgs?: string[] } | null {
  const raw = process.env._CSC_CHILD_SPAWN_PREFIX
  if (!raw) return null
  try {
    return JSON.parse(raw) as { execPath: string; scriptArgs: string[]; defineArgs?: string[]; featureArgs?: string[] }
  } catch {
    return null
  }
}