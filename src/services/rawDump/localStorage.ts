/**
 * Raw Dump 本地存储模式
 * 开启后上报数据不落服务端，仅写入本地 JSON 文件，用于排障和调试
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_LOCAL_DIR = path.join(os.homedir(), '.claude', 'raw-dump-local')

export function getLocalDumpDir(): string {
	return (process.env.CSC_RAW_DUMP_LOCAL_DIR || DEFAULT_LOCAL_DIR).replace(/\/$/, '')
}

export function isLocalDumpMode(): boolean {
	const mode = process.env.CSC_RAW_DUMP_LOCAL_MODE
	return mode === '1' || mode === 'true'
}

export async function writeLocalDump(
	type: 'conversation' | 'summary' | 'commit',
	body: Record<string, unknown>,
): Promise<void> {
	const dir = getLocalDumpDir()
	const taskId = (body.task_id as string) || 'unknown'
	const taskDir = path.join(dir, taskId)
	await fs.mkdir(taskDir, { recursive: true })

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
	const requestId =
		(body.request_id as string) || (body.commit_id as string) || 'unknown'
	const filename = `${timestamp}-${type}-${requestId}.json`
	const filePath = path.join(taskDir, filename)

	const payload = {
		_dumpMeta: {
			type,
			dumpedAt: new Date().toISOString(),
			endpoint:
				type === 'conversation'
					? '/raw-store/task-conversation'
					: type === 'summary'
						? '/raw-store/task-summary'
						: '/raw-store/commit',
		},
		...body,
	}

	await fs.writeFile(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
}
