/**
 * CoStrict OAuth 登录流程模块
 * 负责浏览器登录、Token 轮询和登录 URL 构建
 */

import { randomBytes } from 'node:crypto'
import {
  generateMachineId,
  saveCoStrictCredentials,
  type CoStrictCredentials,
} from './credentials.js'
import { extractExpiryFromJWT } from './token.js'
import { buildOAuthParams } from './oauth-params.js'

/**
 * 生成随机 state 字符串 (格式: {12hex}.{12hex})
 */
export function generateState(): string {
  const part1 = randomBytes(6).toString('hex')
  const part2 = randomBytes(6).toString('hex')
  return `${part1}.${part2}`
}

/**
 * 获取 CoStrict Base URL
 * 优先级: 环境变量 > credentialsBaseUrl > 默认值
 */
export function getCoStrictBaseURL(credentialsBaseUrl?: string): string {
  const envUrl = process.env.COSTRICT_BASE_URL
  const defaultUrl = 'https://zgsm.sangfor.com'
  const baseUrl = envUrl || credentialsBaseUrl || defaultUrl
  return baseUrl.replace(/\/chat-rag\/api\/v1$/, '').replace(/\/$/, '')
}

/**
 * 构建 CoStrict 登录 URL (初次登录包含 machine_code)
 */
export function buildCoStrictLoginURL(
  baseUrl: string,
  state: string,
  machineId: string,
): string {
  const params = buildOAuthParams(true, machineId, state)
  const queryString = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${baseUrl}/oidc-auth/api/v1/plugin/login?${queryString}`
}

/**
 * 轮询 Token 端点获取登录凭证 (轮询时保留 machine_code)
 */
export async function pollLoginToken(
  baseUrl: string,
  state: string,
  machineId: string,
  maxAttempts = 120,
  intervalMs = 5000,
  abortSignal?: AbortSignal,
): Promise<{ access_token: string; refresh_token: string }> {
  const params = buildOAuthParams(true, machineId, state)
  const queryString = params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  const url = `${baseUrl}/oidc-auth/api/v1/plugin/login/token?${queryString}`

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (abortSignal?.aborted) throw new Error('Login cancelled by user')

    await sleep(intervalMs)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: abortSignal,
      })

      if (!response.ok) continue

      const result = (await response.json()) as any

      if (!result.success) {
        const errorMsg = result.message || result.error || 'Unknown error'
        if (
          errorMsg.includes('invalid') ||
          errorMsg.includes('expired') ||
          errorMsg.includes('failed')
        ) {
          throw new Error(`Login failed: ${errorMsg}`)
        }
        continue
      }

      if (
        !result.data?.access_token ||
        !result.data?.refresh_token ||
        result.data.access_token === '' ||
        result.data.refresh_token === ''
      ) {
        continue
      }

      if (result.data.state !== state) continue

      return {
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
      }
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message?.includes('aborted')) {
        throw new Error('Login cancelled')
      }
      if (error.message?.includes('Login failed')) throw error
    }
  }

  throw new Error(
    `Login timeout after ${(maxAttempts * intervalMs) / 1000} seconds. Please try again.`,
  )
}

/**
 * 执行完整的 CoStrict OAuth 登录流程
 *
 * 步骤:
 * 1. 生成 state 和 machine_id
 * 2. 打开浏览器
 * 3. 轮询 Token 端点
 * 4. 保存凭证到 ~/.costrict/share/auth.json
 */
export async function loginCoStrict(
  openBrowser?: (url: string) => Promise<void>,
  abortSignal?: AbortSignal,
): Promise<CoStrictCredentials> {
  const baseUrl = getCoStrictBaseURL()
  const state = generateState()
  const machineId = generateMachineId()
  const loginUrl = buildCoStrictLoginURL(baseUrl, state, machineId)

  if (openBrowser) {
    await openBrowser(loginUrl)
  } else {
    const { spawn } = await import('node:child_process')
    const platform = process.platform
    let command: string
    let args: string[]

    if (platform === 'darwin') {
      command = 'open'
      args = [loginUrl]
    } else if (platform === 'win32') {
      command = 'cmd.exe'
      args = ['/c', 'start', '', loginUrl]
    } else {
      command = 'xdg-open'
      args = [loginUrl]
    }

    spawn(command, args, { detached: true, stdio: 'ignore' }).unref()
  }

  const tokens = await pollLoginToken(
    baseUrl,
    state,
    machineId,
    120,
    5000,
    abortSignal,
  )

  const expiryDate = extractExpiryFromJWT(tokens.access_token)
  const credentials: CoStrictCredentials = {
    id: 'csc',
    name: 'CSC Auth',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    state,
    machine_id: machineId,
    base_url: baseUrl,
    expiry_date: expiryDate,
    updated_at: new Date().toISOString(),
    expired_at: expiryDate ? new Date(expiryDate).toISOString() : undefined,
  }

  await saveCoStrictCredentials(credentials)
  return credentials
}
