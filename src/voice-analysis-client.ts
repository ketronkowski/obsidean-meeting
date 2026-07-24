import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';

const DAEMON_LOG = os.homedir() + '/tmp/wsi-daemon.log';
import { VoiceAnalysisResponse, VoiceNameAssignment } from './voice-analysis-types';

export interface VoiceClientSettings {
	enabled: boolean;
	binaryPath: string;
	port: number;
	autoStart: boolean;
}

interface DaemonState {
	process: ChildProcess | null;
	pid: number | null;
}

const HEALTH_POLL_INTERVAL_MS = 2000;
const HEALTH_POLL_TIMEOUT_MS = 300_000; // 5 minutes — model loading can be slow on first run

export class VoiceAnalysisClient {
	private settings: VoiceClientSettings;
	private daemon: DaemonState = { process: null, pid: null };

	constructor(settings: VoiceClientSettings) {
		this.settings = settings;
	}

	updateSettings(settings: VoiceClientSettings): void {
		this.settings = settings;
	}

	/** Expand leading ~ to the user's home directory. */
	private expandPath(p: string): string {
		if (p.startsWith('~/') || p === '~') {
			return p.replace('~', os.homedir());
		}
		return p;
	}

	private get port(): number {
		return this.settings.port;
	}

	/** Check daemon health. Returns true when the server is up AND model is loaded. */
	async checkHealth(): Promise<boolean> {
		console.log(`[VoiceAnalysisClient] Health check http://127.0.0.1:${this.port}/health`);
		try {
			const data = await httpGet(this.port, '/health', 3000) as { status: string; model_loaded: boolean };
			const ok = data?.status === 'ok' && data?.model_loaded === true;
			console.log(`[VoiceAnalysisClient] Health check result: ${ok ? 'ok' : `not ready (model_loaded=${data?.model_loaded})`}`);
			return ok;
		} catch (err) {
			console.log(`[VoiceAnalysisClient] Health check failed: ${err}`);
			return false;
		}
	}

	/**
	 * Ensure the daemon is reachable. Auto-starts it if not running and autoStart is enabled.
	 * Returns true if connected, false if unavailable.
	 */
	async connect(): Promise<boolean> {
		if (await this.checkHealth()) return true;

		if (!this.settings.autoStart) return false;

		const started = await this.startDaemon();
		return started;
	}

	/** Spawn the daemon as a detached background process and poll until healthy. */
	async startDaemon(): Promise<boolean> {
		const binary = this.expandPath(this.settings.binaryPath || 'whisper-speaker-id');
		const port = this.port;

		console.log(`[VoiceAnalysisClient] Spawning daemon: ${binary} serve --port ${port}`);
		console.log(`[VoiceAnalysisClient] Daemon log: ${DAEMON_LOG}`);

		// Ensure ~/tmp exists
		const logDir = os.homedir() + '/tmp';
		if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

		const logFd = fs.openSync(DAEMON_LOG, 'a');
		const child = spawn(binary, ['serve', '--port', String(port)], {
			detached: true,
			stdio: ['ignore', logFd, logFd],
		});

		child.on('error', (err) => {
			console.error(`[VoiceAnalysisClient] Failed to spawn daemon: ${err.message}`);
		});

		child.unref();

		if (child.pid) {
			this.daemon = { process: child, pid: child.pid };
			console.log(`[VoiceAnalysisClient] Daemon spawned with PID ${child.pid}`);
		}

		return this.pollHealth(HEALTH_POLL_TIMEOUT_MS);
	}

	private async pollHealth(timeoutMs: number): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			await sleep(HEALTH_POLL_INTERVAL_MS);
			if (await this.checkHealth()) return true;
		}
		console.warn(`[VoiceAnalysisClient] Timed out waiting for daemon after ${timeoutMs}ms`);
		return false;
	}

	/** Analyze a .whisper file. Falls back to CLI subprocess if HTTP fails. */
	async analyzeWhisperFile(whisperPath: string): Promise<VoiceAnalysisResponse | null> {
		// Try HTTP daemon first
		try {
			console.log(`[VoiceAnalysisClient] POST /analyze for: ${whisperPath}`);
			const data = await httpPost(this.port, '/analyze', { whisper_path: whisperPath }, 120_000);
			return transformAnalyzeResponse(data as Record<string, unknown>);
		} catch (err) {
			console.warn(`[VoiceAnalysisClient] HTTP analyze failed: ${err}, trying CLI fallback`);
		}

		// CLI fallback
		return this.analyzeViaCli(whisperPath);
	}

	private async analyzeViaCli(whisperPath: string): Promise<VoiceAnalysisResponse | null> {
		const binary = this.expandPath(this.settings.binaryPath);
		console.log(`[VoiceAnalysisClient] CLI fallback: ${binary} analyze --input <path> --json`);
		try {
			const stdout = await runCommand(binary, [
				'analyze',
				'--input', whisperPath,
				'--json',
			]);
			return transformAnalyzeResponse(JSON.parse(stdout));
		} catch (err) {
			console.error(`[VoiceAnalysisClient] CLI fallback failed: ${err}`);
			return null;
		}
	}

	/**
	 * Apply the name→UUID map to the .whisper file.
	 * Falls back to `apply` CLI command if HTTP unavailable.
	 */
	async applyNames(whisperPath: string, nameMap: Record<string, string>): Promise<void> {
		if (Object.keys(nameMap).length === 0) return;

		// Try HTTP
		try {
			console.log(`[VoiceAnalysisClient] POST /apply for: ${whisperPath}`);
			await httpPost(this.port, '/apply', { whisper_path: whisperPath, name_map: nameMap }, 10_000);
			return;
		} catch (err) {
			console.warn(`[VoiceAnalysisClient] HTTP apply failed: ${err}, trying CLI fallback`);
		}

		// CLI fallback
		const binary = this.expandPath(this.settings.binaryPath);
		await runCommand(binary, [
			'apply',
			'--input', whisperPath,
			'--name-map', JSON.stringify(nameMap),
		]);
	}

	/**
	 * Save speaker voice samples to the reference library.
	 * HTTP daemon only — skipped in CLI-fallback mode.
	 */
	async saveSamples(
		whisperPath: string,
		assignments: VoiceNameAssignment[],
		cliMode = false,
	): Promise<void> {
		if (cliMode || assignments.length === 0) return;

		try {
			console.log(`[VoiceAnalysisClient] POST /save-samples for ${assignments.length} speakers`);
			await httpPost(this.port, '/save-samples', {
				whisper_path: whisperPath,
				assignments: assignments.map(a => ({ speaker_id: a.speakerUuid, name: a.name })),
			}, 60_000);
		} catch (err) {
			console.warn(`[VoiceAnalysisClient] save-samples failed (non-fatal): ${err}`);
		}
	}

	/** Return all names currently in the reference library. */
	async getKnownSpeakers(): Promise<string[]> {
		try {
			const data = await httpGet(this.port, '/speakers', 5000) as { speakers: string[] };
			return data?.speakers ?? [];
		} catch {
			return [];
		}
	}

	/**
	 * Lazily extract (and cache) a representative audio clip for a speaker's
	 * longest utterance, for playback in the speaker attribution modal.
	 * Returns the local file path of the extracted clip, or null on failure
	 * (daemon unavailable, no segments for that speaker, etc). No CLI fallback —
	 * this is a playback convenience feature, not required for core functionality.
	 */
	async getSpeakerClip(whisperPath: string, speakerId: string): Promise<string | null> {
		try {
			const data = await httpPost(this.port, '/extract-clip', {
				whisper_path: whisperPath,
				speaker_id: speakerId,
			}, 30_000) as { clip_path: string };
			return data?.clip_path ?? null;
		} catch (err) {
			console.warn(`[VoiceAnalysisClient] getSpeakerClip failed: ${err}`);
			return null;
		}
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transformAnalyzeResponse(raw: Record<string, unknown>): VoiceAnalysisResponse {
	const rawSpeakers = raw['speakers'] as Array<Record<string, unknown>>;
	return {
		speakers: rawSpeakers.map(s => ({
			speakerUuid: s['speaker_uuid'] as string,
			displayName: s['display_name'] as string,
			bestMatch: (s['best_match'] as string | null) ?? null,
			score: s['score'] as number,
			action: s['action'] as 'auto' | 'confirm' | 'skip',
		})),
		knownSpeakers: (raw['known_speakers'] as string[]) ?? [],
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** HTTP GET using Node's built-in http module (bypasses Electron CSP for localhost). */
function httpGet(port: number, path: string, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
			let body = '';
			res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
			res.on('end', () => {
				try { resolve(JSON.parse(body)); }
				catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
			});
		});
		req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out')); });
		req.on('error', reject);
	});
}

/** HTTP POST using Node's built-in http module (bypasses Electron CSP for localhost). */
function httpPost(port: number, path: string, body: unknown, timeoutMs: number): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const payload = JSON.stringify(body);
		const req = http.request({
			hostname: '127.0.0.1',
			port,
			path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(payload),
			},
		}, (res) => {
			let data = '';
			res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
			res.on('end', () => {
				if (res.statusCode && res.statusCode >= 400) {
					reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
					return;
				}
				try { resolve(JSON.parse(data)); }
				catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
			});
		});
		req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out')); });
		req.on('error', reject);
		req.write(payload);
		req.end();
	});
}

function runCommand(binary: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
		child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
		child.on('close', code => {
			if (code === 0) resolve(stdout.trim());
			else reject(new Error(`Command failed (${code}): ${stderr.trim()}`));
		});
		child.on('error', reject);
	});
}
