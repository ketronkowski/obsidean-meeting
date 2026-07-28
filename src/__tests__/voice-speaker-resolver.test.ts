import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VoiceSpeakerResolver } from '../voice-speaker-resolver';
import { TFile } from 'obsidian';

/**
 * Regression test for the "no speaker popup" bug: identifyWhisperSpeakers() used to
 * bail out immediately whenever the note had no "# Transcript" section yet (the
 * common case on first-time processing), without ever attempting to resolve the
 * .whisper file by meeting basename. resolveWhisperForMeeting() itself is the piece
 * that must succeed even when called with no transcript/embed text at all.
 */
describe('VoiceSpeakerResolver.resolveWhisperForMeeting', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'macwhisper-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test('finds the .whisper file by meeting basename even with no embed/transcript text', () => {
		const meetingBasename = '2026-07-23 - SIC Weekly Program Meeting';
		writeFileSync(join(tmpDir, `${meetingBasename}.whisper`), Buffer.from(''));

		const fakeStatusBar = { show: () => {}, hide: () => {} } as any;
		const resolver = new VoiceSpeakerResolver(
			{} as any,
			{
				macWhisperTranscriptsDir: tmpDir,
				voiceServiceEnabled: false,
				voiceServiceBinaryPath: 'whisper-speaker-id',
				voiceServicePort: 0,
				voiceServiceAutoStart: false,
			} as any,
			fakeStatusBar,
		);

		const meetingFile = new TFile();
		(meetingFile as any).basename = meetingBasename;

		// Called exactly like identifyWhisperSpeakers now does when the note has no
		// "# Transcript" section yet (embedText is undefined).
		const result = resolver.resolveWhisperForMeeting(meetingFile as any, undefined);

		expect(result).toBe(join(tmpDir, `${meetingBasename}.whisper`));
	});
});
