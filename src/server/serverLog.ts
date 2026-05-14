export function createServerLogger() {
  return {
    info(message: string, meta?: Record<string, unknown>) {
      process.stderr.write(
        `[serve:info] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`,
      )
    },
    error(message: string, meta?: Record<string, unknown>) {
      process.stderr.write(
        `[serve:error] ${message}${meta ? ' ' + JSON.stringify(meta) : ''}\n`,
      )
    },
  }
}
