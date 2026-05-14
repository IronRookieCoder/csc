export const INIT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.CSC_SERVE_INIT_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 120000
})()

export function getScriptArgsForChild(): string[] {
  const argv1 = process.argv[1]
  if (!argv1) return []
  // Bun standalone executable embeds a virtual snapshot path like "B:/~BUN/root/cli.js".
  // This is not a real file on disk — skip it so the child process (the same exe)
  // is not launched with a bogus script argument.
  if (argv1.startsWith('B:/~BUN/') || argv1.startsWith('/snapshot/')) return []
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
  // Only pass --feature/define flags when running as a script (dev mode).
  // In compiled standalone executable mode scriptArgs is empty, and feature
  // flags are already baked in at compile time — passing --feature to the
  // child process would cause "unknown option" errors.
  const isScriptMode = scriptArgs.length > 0
  if (isScriptMode) {
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
