/**
 * Regression test for the "duplicate speaker-identification dialog" bug:
 * BaseMeetingHandler previously defined transformExpandedTranscript()/
 * shouldSkipSpeakerResolution() as no-ops, and only StandupMeetingHandler
 * overrode them to add/check the `<!-- whisper-source -->` sentinel. Since
 * GeneralMeetingHandler never overrode them, general meetings always
 * reopened the text-heuristic SpeakerAttributionModal ("Identify Meeting
 * Speakers") right after voice ID had already handled (or the user
 * explicitly skipped) those same speakers.
 *
 * The sentinel logic now lives in BaseMeetingHandler so both handler types
 * share it.
 */
import { App } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { GeneralMeetingHandler } from '../handlers/general';
import { StandupMeetingHandler } from '../handlers/standup';

function buildStatusBar(): StatusBarManager {
	const fakeEl = { setText: () => {}, style: {} } as unknown as HTMLElement;
	return new StatusBarManager(fakeEl);
}

const fakeApp = {} as App;
const fakeSettings = {
	macWhisperTranscriptsDir: '',
	voiceServiceEnabled: false,
	voiceServiceBinaryPath: 'whisper-speaker-id',
	voiceServicePort: 8765,
	voiceServiceAutoStart: false,
} as unknown as MeetingProcessorSettings;

function buildHandler(kind: 'general' | 'standup') {
	const copilotClient = new CopilotClientManager(fakeApp, fakeSettings);
	const skillLoader = new SkillLoader(fakeApp, '/fake/plugin/dir');
	const statusBar = buildStatusBar();
	return kind === 'general'
		? new GeneralMeetingHandler(fakeApp, fakeSettings, copilotClient, skillLoader, statusBar)
		: new StandupMeetingHandler(fakeApp, fakeSettings, copilotClient, skillLoader, statusBar);
}

describe.each([
	['GeneralMeetingHandler', 'general' as const],
	['StandupMeetingHandler', 'standup' as const],
])('%s — whisper-source sentinel', (_name, kind) => {
	it('prepends the sentinel when the transcript came from a .whisper embed', () => {
		const handler = buildHandler(kind) as any;
		const result = handler.transformExpandedTranscript('![[meeting.whisper]]', 'Hello world');
		expect(result).toBe('<!-- whisper-source -->\nHello world');
	});

	it('does not prepend the sentinel for non-.whisper embeds', () => {
		const handler = buildHandler(kind) as any;
		const result = handler.transformExpandedTranscript('![[meeting.txt]]', 'Hello world');
		expect(result).toBe('Hello world');
	});

	it('skips speaker resolution when the sentinel is present', () => {
		const handler = buildHandler(kind) as any;
		const skip = handler.shouldSkipSpeakerResolution('<!-- whisper-source -->\n[Kevin Tronkowski]\nHi there');
		expect(skip).toBe(true);
	});

	it('does not skip speaker resolution when the sentinel is absent', () => {
		const handler = buildHandler(kind) as any;
		const skip = handler.shouldSkipSpeakerResolution('[Speaker 1]\nHi there');
		expect(skip).toBe(false);
	});

	it('cleanTranscript() skips re-cleaning but strips the sentinel from a transcript that already carries it', async () => {
		const handler = buildHandler(kind) as any;
		const sentinelTranscript = '<!-- whisper-source -->\n[Ila Piddington]\nRight, let\'s see. We have a plan.';
		const noteContent = `---\ntags: [meeting]\n---\n\n# Attendees\n\n# Transcript\n\n${sentinelTranscript}\n\n# Summary\n`;

		const modify = jest.fn();
		const fakeFile = { path: 'Meetings/test.md' };
		handler.app = {
			vault: {
				read: jest.fn().mockResolvedValue(noteContent),
				modify,
			},
		};

		await handler.cleanTranscript(fakeFile);

		// Re-cleaning would have called vault.modify() with GoogleRecorderCleaner's
		// output (which merges the sentinel into the first speaker's line). Skipping
		// re-clean means that corruption doesn't happen — but the sentinel, having
		// already served its purpose (resolveSpeakers() used it to skip the modal),
		// should still be stripped from the note so it's not left visible forever.
		expect(modify).toHaveBeenCalledTimes(1);
		const [, newContent] = modify.mock.calls[0];
		expect(newContent).not.toContain('<!-- whisper-source -->');
		expect(newContent).toContain('[Ila Piddington]\nRight, let\'s see. We have a plan.');
	});
});

