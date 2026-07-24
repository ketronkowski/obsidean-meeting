import * as http from 'http';
import { VoiceAnalysisResponse } from '../../voice-analysis-types';

export interface MockDaemonConfig {
	healthResponse?: { status: string; model_loaded: boolean };
	analyzeResponse?: VoiceAnalysisResponse;
	applyResponse?: { updated: number };
	saveSamplesResponse?: { saved: Record<string, number> };
	speakersResponse?: { speakers: string[] };
	extractClipResponse?: { clip_path: string };
	extractClipStatus?: number;
}

export interface MockDaemon {
	port: number;
	close: () => Promise<void>;
	recordedRequests: Array<{ path: string; method: string; body: unknown }>;
}

/** Serialise a VoiceAnalysisResponse to the snake_case wire format the server returns. */
function toWireFormat(r: VoiceAnalysisResponse) {
	return {
		speakers: r.speakers.map(s => ({
			speaker_uuid: s.speakerUuid,
			display_name: s.displayName,
			best_match: s.bestMatch,
			score: s.score,
			action: s.action,
		})),
		known_speakers: r.knownSpeakers,
	};
}

export function createMockDaemon(config: MockDaemonConfig): Promise<MockDaemon> {
	const recorded: Array<{ path: string; method: string; body: unknown }> = [];

	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			let bodyStr = '';
			req.on('data', chunk => { bodyStr += chunk.toString(); });
			req.on('end', () => {
				let body: unknown = null;
				try { body = JSON.parse(bodyStr); } catch { /* no body */ }

				recorded.push({ path: req.url ?? '/', method: req.method ?? 'GET', body });

				res.setHeader('Content-Type', 'application/json');

				if (req.url === '/health') {
					const reply = config.healthResponse ?? { status: 'ok', model_loaded: true };
					res.end(JSON.stringify(reply));
					return;
				}
				if (req.url === '/analyze' && req.method === 'POST') {
					if (!config.analyzeResponse) { res.statusCode = 503; res.end('{}'); return; }
					res.end(JSON.stringify(toWireFormat(config.analyzeResponse)));
					return;
				}
				if (req.url === '/apply' && req.method === 'POST') {
					res.end(JSON.stringify(config.applyResponse ?? { updated: 0 }));
					return;
				}
				if (req.url === '/save-samples' && req.method === 'POST') {
					res.end(JSON.stringify(config.saveSamplesResponse ?? { saved: {} }));
					return;
				}
				if (req.url === '/speakers') {
					res.end(JSON.stringify(config.speakersResponse ?? { speakers: [] }));
					return;
				}
				if (req.url === '/extract-clip' && req.method === 'POST') {
					if (config.extractClipStatus && config.extractClipStatus >= 400) {
						res.statusCode = config.extractClipStatus;
						res.end('{}');
						return;
					}
					res.end(JSON.stringify(config.extractClipResponse ?? { clip_path: '' }));
					return;
				}
				res.statusCode = 404;
				res.end('{}');
			});
		});

		server.listen(0, '127.0.0.1', () => {
			const addr = server.address() as { port: number };
			resolve({
				port: addr.port,
				close: () => new Promise<void>(r => server.close(() => r())),
				recordedRequests: recorded,
			});
		});

		server.on('error', reject);
	});
}
