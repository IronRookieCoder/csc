import { execFile, spawn } from "child_process"
import { createHash } from "node:crypto"
import { createWriteStream, promises as fsp } from "node:fs"
import fs from "fs"
import os from "os"
import path from "path"
import { getCoStrictBaseURL } from "src/costrict/provider/auth.js"

const CLOUD_API_PREFIX = "cloud-api"

function getCloudBaseUrl(): string {
	const raw = getCoStrictBaseURL().replace(/\/$/, "")
	if (raw.endsWith(`/${CLOUD_API_PREFIX}`)) return raw
	return `${raw}/${CLOUD_API_PREFIX}`
}

function csCloudBin(): string {
	const ext = process.platform === "win32" ? ".exe" : ""
	const binDir = path.join(os.homedir(), ".costrict", "bin")
	return path.join(binDir, `cs-cloud${ext}`)
}

function getReleasePlatform(): string {
	const p = process.platform === "win32" ? "windows" : process.platform
	const arch = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : "amd64"
	return `${p}-${arch}`
}

interface UpdateCheckResponse {
	can_update: boolean
	version: string
	changelog?: string
	download_url?: string
	sha256?: string
	force?: boolean
	min_client_version?: string
	release_date?: string
	size?: number
}

async function fetchUpdateInfo(): Promise<UpdateCheckResponse> {
	const base = getCloudBaseUrl()
	const platform = getReleasePlatform()
	const url = `${base}/api/updates/check?platform=${encodeURIComponent(platform)}&version=0.0.0`
	const res = await fetch(url)
	if (!res.ok) {
		throw new Error(`update check failed: ${res.status} ${await res.text().catch(() => "")}`)
	}
	return (await res.json()) as UpdateCheckResponse
}

type ArchiveFormat = "targz" | "zip" | "raw"

function detectFormatByUrl(url: string): ArchiveFormat | undefined {
	const lower = url.toLowerCase()
	if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "targz"
	if (lower.endsWith(".zip")) return "zip"
	return undefined
}

async function detectFormatByMagic(file: string): Promise<ArchiveFormat> {
	const handle = await fsp.open(file, "r")
	const buf = Buffer.alloc(4)
	await handle.read(buf, 0, 4, 0)
	await handle.close()
	if (buf[0] === 0x1f && buf[1] === 0x8b) return "targz"
	if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "zip"
	return "raw"
}

async function detectArchiveFormat(file: string, url: string): Promise<ArchiveFormat> {
	return detectFormatByUrl(url) ?? (await detectFormatByMagic(file))
}

const BIN_NAME = process.platform === "win32" ? "cs-cloud.exe" : "cs-cloud"

async function extractFromTarGz(archive: string, outDir: string): Promise<string> {
	await new Promise<void>((resolve, reject) => {
		execFile("tar", ["xzf", archive, "-C", outDir], (err) => (err ? reject(err) : resolve()))
	})
	for (const name of [BIN_NAME, "cs-cloud"]) {
		const p = path.join(outDir, name)
		if (fs.existsSync(p)) {
			const dest = path.join(outDir, BIN_NAME)
			if (p !== dest) await fsp.rename(p, dest)
			return dest
		}
	}
	throw new Error("cs-cloud binary not found in tar.gz archive")
}

async function extractFromZip(archive: string, outDir: string): Promise<string> {
	const bin = path.join(outDir, BIN_NAME)
	if (process.platform === "win32") {
		const zipPath = archive.endsWith(".zip") ? archive : archive + ".zip"
		if (zipPath !== archive) await fsp.rename(archive, zipPath)
		await new Promise<void>((resolve, reject) => {
			execFile(
				"powershell",
				["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`],
				(err) => (err ? reject(err) : resolve()),
			)
		}).finally(() => {
			if (zipPath !== archive) fsp.rename(zipPath, archive).catch(() => {})
		})
		const extracted = path.join(outDir, "cs-cloud.exe")
		if (fs.existsSync(extracted)) {
			if (extracted !== bin) await fsp.rename(extracted, bin)
		} else if (!fs.existsSync(bin)) {
			throw new Error("cs-cloud.exe not found in zip archive")
		}
		return bin
	}
	await new Promise<void>((resolve, reject) => {
		execFile("unzip", ["-o", archive, "-d", outDir], (err) => (err ? reject(err) : resolve()))
	})
	for (const name of [BIN_NAME, "cs-cloud"]) {
		const p = path.join(outDir, name)
		if (fs.existsSync(p)) {
			if (p !== bin) await fsp.rename(p, bin)
			return bin
		}
	}
	throw new Error("cs-cloud binary not found in zip archive")
}

async function extractBinary(archive: string, outDir: string, url: string): Promise<string> {
	const fmt = await detectArchiveFormat(archive, url)
	switch (fmt) {
		case "targz":
			return extractFromTarGz(archive, outDir)
		case "zip":
			return extractFromZip(archive, outDir)
		default: {
			const dest = path.join(outDir, BIN_NAME)
			await fsp.rename(archive, dest)
			if (process.platform !== "win32") await fsp.chmod(dest, 0o755)
			return dest
		}
	}
}

async function downloadToTemp(url: string, expectedSha256?: string, totalSize?: number): Promise<string> {
	const tmp = path.join(os.tmpdir(), `cs-cloud-download-${Date.now()}`)
	const res = await fetch(url)
	if (!res.ok) throw new Error(`download failed: ${res.status}`)
	const body = res.body
	if (!body) throw new Error("empty response body")
	const ws = createWriteStream(tmp, { mode: 0o755 })
	const hash = expectedSha256 ? createHash("sha256") : null
	const reader = body.getReader()
	let downloaded = 0
	let lastLog = 0
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break
			hash?.update(value)
			ws.write(value)
			downloaded += value.length
			const now = Date.now()
			if (totalSize && now - lastLog > 500) {
				const pct = Math.min(Math.round((downloaded / totalSize) * 100), 100)
				const mb = (downloaded / 1048576).toFixed(1)
				const total = (totalSize / 1048576).toFixed(1)
				process.stdout.write(`\rdownloading... ${pct}% (${mb}/${total} MB)`)
				lastLog = now
			}
		}
	} finally {
		reader.releaseLock()
	}
	if (totalSize) process.stdout.write("\r")
	ws.end()
	await new Promise<void>((resolve, reject) => {
		ws.on("finish", resolve)
		ws.on("error", reject)
	})
	if (hash && expectedSha256) {
		const actual = hash.digest("hex")
		if (actual !== expectedSha256) {
			await fsp.unlink(tmp).catch(() => {})
			throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${actual}`)
		}
	}
	return tmp
}

async function ensureCsCloud(): Promise<string> {
	const bin = csCloudBin()
	if (fs.existsSync(bin)) return bin

	console.log("cs-cloud not found, downloading...")
	const info = await fetchUpdateInfo()
	if (!info.can_update || !info.download_url) {
		throw new Error("no cs-cloud release available for your platform")
	}

	const binDir = path.dirname(bin)
	await fsp.mkdir(binDir, { recursive: true })

	const archive = await downloadToTemp(info.download_url, info.sha256, info.size)
	try {
		const extracted = await extractBinary(archive, binDir, info.download_url)
		if (extracted !== bin && fs.existsSync(extracted)) {
			await fsp.rename(extracted, bin)
		}
	} finally {
		await fsp.unlink(archive).catch(() => {})
	}

	if (process.platform === "darwin") {
		await new Promise<void>((resolve, reject) => {
			execFile("xattr", ["-d", "com.apple.quarantine", bin], (err) => {
				if (err && !(err as NodeJS.ErrnoException).message?.includes("NO SUCH")) reject(err)
				else resolve()
			})
		})
	}

	console.log(`cs-cloud ${info.version} installed`)
	return bin
}

function getCloudRawArgs(): string[] {
	const argv = process.argv.slice(2)
	const index = argv.indexOf("cloud")
	if (index === -1) return []
	return argv.slice(index + 1)
}

async function runCsCloud(args: string[]): Promise<void> {
	const bin = await ensureCsCloud()

	// Print the exact command being executed for debugging
	console.error(`[DEBUG] Executing: ${bin} ${args.join(" ")}`)

	// Close stdin to prevent blocking, inherit stdout/stderr
	const child = spawn(bin, args, {
		stdio: ["ignore", "inherit", "inherit"],
		windowsHide: false,
		env: { ...process.env, CSC_CLOUD_INVOKER: "csc" },
		detached: false,
	})

	const code = await new Promise<number | null>((resolve) => {
		child.on("error", (err) => {
			console.error(`failed to run cs-cloud: ${err.message}`)
			resolve(1)
		})
		child.on("exit", resolve)
		child.on("disconnect", () => {
			console.error(`cs-cloud disconnected unexpectedly`)
			resolve(1)
		})
	})

	process.exit(code ?? 1)
}

export async function cloudHandler(rawArgs: string[]): Promise<void> {
	const args = getCloudRawArgs()
	if (args.length === 0) {
		console.error("specify a subcommand. usage: csc cloud <command> [args...]")
		process.exit(1)
	}

	await runCsCloud(args)
}
