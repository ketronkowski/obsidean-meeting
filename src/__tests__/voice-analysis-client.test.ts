import { VoiceAnalysisClient } from '../voice-analysis-client';
import { createMockDaemon } from './helpers/mock-daemon';
import { ALL_AUTO_RESPONSE, MIXED_RESPONSE } from './fixtures/daemon-responses';

describe('VoiceAnalysisClient', () => {
	// -------------------------------------------------------------------------
	// connect / health
	// -------------------------------------------------------------------------

	test('connect returns true when daemon is healthy', async () => {
		const daemon = await createMockDaemon({ healthResponse: { status: 'ok', model_loaded: true } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const result = await client.connect();
		expect(result).toBe(true);
		await daemon.close();
	});

	test('connect returns false when daemon is unreachable and autoStart is false', async () => {
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: 19999, // nothing listening here
			autoStart: false,
		});
		const result = await client.connect();
		expect(result).toBe(false);
	});

	// -------------------------------------------------------------------------
	// analyzeWhisperFile — HTTP path
	// -------------------------------------------------------------------------

	test('analyzeWhisperFile returns ALL_AUTO_RESPONSE when daemon returns it', async () => {
		const daemon = await createMockDaemon({ analyzeResponse: ALL_AUTO_RESPONSE });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const result = await client.analyzeWhisperFile('/test/meeting.whisper');

		expect(result).not.toBeNull();
		expect(result!.speakers).toHaveLength(3);
		expect(result!.speakers[0]).toMatchObject({
			speakerUuid: 'test-uuid-001',
			displayName: 'Speaker 1',
			bestMatch: 'Alice Smith',
			score: 0.85,
			action: 'auto',
		});
		expect(result!.knownSpeakers).toContain('Alice Smith');

		await daemon.close();
	});

	test('analyzeWhisperFile returns MIXED_RESPONSE correctly', async () => {
		const daemon = await createMockDaemon({ analyzeResponse: MIXED_RESPONSE });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const result = await client.analyzeWhisperFile('/test/meeting.whisper');

		expect(result).not.toBeNull();
		expect(result!.speakers[0].action).toBe('auto');
		expect(result!.speakers[1].action).toBe('confirm');
		expect(result!.speakers[2].action).toBe('skip');
		expect(result!.speakers[2].bestMatch).toBeNull();

		await daemon.close();
	});

	// -------------------------------------------------------------------------
	// applyNames — payload verification
	// -------------------------------------------------------------------------

	test('applyNames sends correct payload to daemon', async () => {
		const daemon = await createMockDaemon({ applyResponse: { updated: 2 } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		await client.applyNames('/test/meeting.whisper', {
			'test-uuid-001': 'Alice Smith',
			'test-uuid-002': 'Bob Jones',
		});

		const applyReq = daemon.recordedRequests.find(r => r.path === '/apply' && r.method === 'POST');
		expect(applyReq).toBeDefined();
		expect(applyReq!.body).toMatchObject({
			whisper_path: '/test/meeting.whisper',
			name_map: {
				'test-uuid-001': 'Alice Smith',
				'test-uuid-002': 'Bob Jones',
			},
		});

		await daemon.close();
	});

	test('applyNames is a no-op when nameMap is empty', async () => {
		const daemon = await createMockDaemon({ applyResponse: { updated: 0 } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		await client.applyNames('/test/meeting.whisper', {});

		const applyReq = daemon.recordedRequests.find(r => r.path === '/apply');
		expect(applyReq).toBeUndefined(); // should not have been called

		await daemon.close();
	});

	// -------------------------------------------------------------------------
	// saveSamples — payload verification
	// -------------------------------------------------------------------------

	test('saveSamples sends correct payload to daemon', async () => {
		const daemon = await createMockDaemon({ saveSamplesResponse: { saved: { 'Alice Smith': 2 } } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		await client.saveSamples('/test/meeting.whisper', [
			{ speakerUuid: 'test-uuid-001', name: 'Alice Smith' },
			{ speakerUuid: 'test-uuid-002', name: 'Bob Jones' },
		]);

		const req = daemon.recordedRequests.find(r => r.path === '/save-samples' && r.method === 'POST');
		expect(req).toBeDefined();
		expect(req!.body).toMatchObject({
			whisper_path: '/test/meeting.whisper',
			assignments: [
				{ speaker_id: 'test-uuid-001', name: 'Alice Smith' },
				{ speaker_id: 'test-uuid-002', name: 'Bob Jones' },
			],
		});

		await daemon.close();
	});

	test('saveSamples is skipped in CLI mode', async () => {
		const daemon = await createMockDaemon({});
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		await client.saveSamples('/test/meeting.whisper', [
			{ speakerUuid: 'test-uuid-001', name: 'Alice Smith' },
		], true /* cliMode */);

		const req = daemon.recordedRequests.find(r => r.path === '/save-samples');
		expect(req).toBeUndefined(); // must not be called in CLI mode

		await daemon.close();
	});

	// -------------------------------------------------------------------------
	// analyzeWhisperFile — fallback to null when HTTP fails + no CLI
	// -------------------------------------------------------------------------

	test('analyzeWhisperFile returns null when both HTTP and CLI fail', async () => {
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'nonexistent-binary-12345',
			port: 19998, // nothing listening
			autoStart: false,
		});

		const result = await client.analyzeWhisperFile('/test/meeting.whisper');
		expect(result).toBeNull();
	});

	// -------------------------------------------------------------------------
	// getSpeakerClip
	// -------------------------------------------------------------------------

	test('getSpeakerClip returns clip path on success', async () => {
		const daemon = await createMockDaemon({ extractClipResponse: { clip_path: '/tmp/wsi-audio-cache/abc/test-uuid-001.m4a' } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const clipPath = await client.getSpeakerClip('/test/meeting.whisper', 'test-uuid-001');
		expect(clipPath).toBe('/tmp/wsi-audio-cache/abc/test-uuid-001.m4a');

		const req = daemon.recordedRequests.find(r => r.path === '/extract-clip' && r.method === 'POST');
		expect(req).toBeDefined();
		expect(req!.body).toMatchObject({
			whisper_path: '/test/meeting.whisper',
			speaker_id: 'test-uuid-001',
		});

		await daemon.close();
	});

	test('getSpeakerClip returns null when daemon is unreachable', async () => {
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: 19997, // nothing listening
			autoStart: false,
		});

		const clipPath = await client.getSpeakerClip('/test/meeting.whisper', 'test-uuid-001');
		expect(clipPath).toBeNull();
	});

	test('getSpeakerClip returns null on 404 (unknown speaker)', async () => {
		const daemon = await createMockDaemon({ extractClipStatus: 404 });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const clipPath = await client.getSpeakerClip('/test/meeting.whisper', 'unknown-speaker');
		expect(clipPath).toBeNull();

		await daemon.close();
	});

	// -------------------------------------------------------------------------
	// forgetSpeaker
	// -------------------------------------------------------------------------

	test('forgetSpeaker sends DELETE to /speakers/{name} and returns deleted count', async () => {
		const daemon = await createMockDaemon({ forgetSpeakerResponse: { deleted: 3 } });
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'whisper-speaker-id',
			port: daemon.port,
			autoStart: false,
		});

		const deleted = await client.forgetSpeaker('Shaji Mohammed');
		expect(deleted).toBe(3);

		const req = daemon.recordedRequests.find(r => r.method === 'DELETE');
		expect(req).toBeDefined();
		expect(req!.path).toBe('/speakers/Shaji%20Mohammed');

		await daemon.close();
	});

	test('forgetSpeaker falls back to CLI when HTTP is unreachable', async () => {
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: process.execPath, // node — used to fake a "CLI" that prints expected output
			port: 19996, // nothing listening
			autoStart: false,
		});

		// Spawn Node itself with an inline script printing the expected CLI output,
		// simulating `whisper-speaker-id forget-speaker` succeeding.
		const spawnMock = jest.spyOn(require('child_process'), 'spawn');
		spawnMock.mockImplementation((..._args: unknown[]) => {
			const { EventEmitter } = require('events');
			const child: any = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			process.nextTick(() => {
				child.stdout.emit('data', Buffer.from('Deleted 2 sample(s) for speaker: Shaji Mohammed\n'));
				child.emit('close', 0);
			});
			return child;
		});

		const deleted = await client.forgetSpeaker('Shaji Mohammed');
		expect(deleted).toBe(2);

		spawnMock.mockRestore();
	});

	test('forgetSpeaker rejects when both HTTP and CLI fail', async () => {
		const client = new VoiceAnalysisClient({
			enabled: true,
			binaryPath: 'nonexistent-binary-12345',
			port: 19995, // nothing listening
			autoStart: false,
		});

		await expect(client.forgetSpeaker('Nobody')).rejects.toThrow();
	});
});
