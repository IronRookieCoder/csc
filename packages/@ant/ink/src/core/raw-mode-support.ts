function isEnvTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function isWindowsRawModeUnsafe(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== 'win32') {
    return false;
  }

  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_STDIN_RAW_MODE)) {
    return true;
  }

  const term = env.TERM?.toLowerCase() ?? '';
  const msystem = env.MSYSTEM?.toLowerCase() ?? '';
  const shell = env.SHELL?.toLowerCase() ?? '';

  // Git for Windows reports MSYSTEM=MINGW64/MINGW32 and often runs under
  // mintty, but it needs raw mode for Ink key parsing. Disabling raw mode
  // there makes Enter, arrows, and slash commands behave like cooked shell
  // input. Keep the startup-crash workaround scoped to MSYS2/Cygwin-like
  // environments and leave Git Bash on the normal raw-mode path.
  const isGitForWindowsMingw =
    msystem === 'mingw64' || msystem === 'mingw32';
  if (isGitForWindowsMingw) {
    return false;
  }

  return (
    term === 'cygwin' ||
    msystem === 'msys' ||
    msystem.startsWith('ucrt') ||
    msystem.startsWith('clang') ||
    shell.includes('msys') ||
    shell.includes('cygwin')
  );
}

export function supportsStdinRawMode(stdin: NodeJS.ReadStream): boolean {
  if (!stdin.isTTY) {
    return false;
  }

  if (isWindowsRawModeUnsafe(process.env, process.platform)) {
    return false;
  }

  return typeof stdin.setRawMode === 'function';
}
