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
  const termProgram = env.TERM_PROGRAM?.toLowerCase() ?? '';
  const msystem = env.MSYSTEM?.toLowerCase() ?? '';
  const shell = env.SHELL?.toLowerCase() ?? '';

  return (
    term === 'cygwin' ||
    term.includes('mintty') ||
    termProgram.includes('mintty') ||
    msystem.length > 0 ||
    shell.includes('msys') ||
    shell.includes('cygwin') ||
    shell.includes('mingw')
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
