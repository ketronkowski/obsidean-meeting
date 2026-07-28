/**
 * Regression tests for standup meetings being permanently stuck in JIRA-only
 * "pre-meeting" mode when a `.whisper` transcript was exported directly by
 * MacWhisper into `macWhisperTranscriptsDir` (auto-located by meeting filename)
 * instead of being embedded inline via `![[...]]` in the `# Transcript` section.
 *
 * Previously `StandupMeetingHandler.detectMode()` only inspected the literal text
 * already in `# Transcript` and never consulted the filesystem, so an empty
 * transcript section always routed to pre-meeting mode even when a matching
 * exported `.whisper` file existed on disk. `resolveNonEmbedTranscript()` and
 * `shouldUseMacWhisperSource()` were also never overridden on StandupMeetingHandler
 * (unlike GeneralMeetingHandler), so even fixing mode-detection alone would not
 * have been enough to actually expand the transcript.
 *
 * Per user feedback, pre-meeting JIRA population and post-meeting processing are
 * now independent, not mutually exclusive: if the `# JIRA` section is empty, the
 * pre-meeting sprint query must run even when post-meeting processing (triggered by
 * an auto-located whisper file or otherwise) is also going to run in the same pass —
 * so extractJiraUpdates() (the last step of processPostMeeting) has real JIRA items
 * to check off against.
 */
import JSZip from 'jszip';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { StandupMeetingHandler } from '../handlers/standup';

const fakeApp = {} as App;

function buildStatusBar(): StatusBarManager {
	return new StatusBarManager({ setText: () => {}, style: {} } as unknown as HTMLElement);
}

function buildHandler(settingsOverrides: Partial<MeetingProcessorSettings> = {}) {
	const settings = {
		macWhisperTranscriptsDir: '',
		voiceServiceEnabled: false,
		voiceServiceBinaryPath: 'whisper-speaker-id',
		voiceServicePort: 8765,
		voiceServiceAutoStart: false,
		greenBoardId: '214',
		jiraProjectKey: 'GLCP',
		autoCreateProfiles: false,
		autoCleanTranscript: false,
		...settingsOverrides,
	} as unknown as MeetingProcessorSettings;

	const copilotClient = new CopilotClientManager(fakeApp, settings);
	const skillLoader = new SkillLoader(fakeApp, '/fake/plugin/dir');
	const handler = new StandupMeetingHandler(fakeApp, settings, copilotClient, skillLoader, buildStatusBar()) as any;
	return handler;
}

function makeFile(basename: string): TFile {
	const f = new TFile();
	(f as any).basename = basename;
	return f;
}

describe('StandupMeetingHandler.hasProcessableTranscript', () => {
	it('returns true when inline transcript text is long', () => {
		const handler = buildHandler();
		const content = `# Transcript\n${'x'.repeat(60)}\n\n# Summary\n`;
		expect(handler.hasProcessableTranscript(makeFile('Green Standup'), content)).toBe(true);
	});

	it('returns true when transcript section contains an embed link', () => {
		const handler = buildHandler();
		const content = '# Transcript\n![[meeting.whisper]]\n\n# Summary\n';
		expect(handler.hasProcessableTranscript(makeFile('Green Standup'), content)).toBe(true);
	});

	it('returns true when transcript is empty but a whisper file can be auto-located', () => {
		const handler = buildHandler();
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue('/fake/meeting.whisper') };
		const content = '# Transcript\n\n\n# Summary\n';
		expect(handler.hasProcessableTranscript(makeFile('Green Standup'), content)).toBe(true);
		expect(handler.voiceResolver.resolveWhisperForMeeting).toHaveBeenCalled();
	});

	it('returns false when transcript is empty and no whisper file can be located', () => {
		const handler = buildHandler();
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue(null) };
		const content = '# Transcript\n\n\n# Summary\n';
		expect(handler.hasProcessableTranscript(makeFile('Green Standup'), content)).toBe(false);
	});

	it('returns false when there is no # Transcript section at all and no whisper file found', () => {
		const handler = buildHandler();
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue(null) };
		const content = '# Attendees\n- [[Kevin Tronkowski]]\n';
		expect(handler.hasProcessableTranscript(makeFile('Green Standup'), content)).toBe(false);
	});
});

describe('StandupMeetingHandler.isJiraSectionEmpty', () => {
	it('is true when there is no # JIRA heading', () => {
		const handler = buildHandler();
		expect(handler.isJiraSectionEmpty('# Attendees\n- [[Kevin]]\n')).toBe(true);
	});

	it('is true when # JIRA heading exists but is blank', () => {
		const handler = buildHandler();
		expect(handler.isJiraSectionEmpty('# JIRA\n\n\n# Attendees\n')).toBe(true);
	});

	it('is false when # JIRA has content', () => {
		const handler = buildHandler();
		expect(handler.isJiraSectionEmpty('# JIRA\n\n- [ ] GLCP-1 Do the thing\n\n# Attendees\n')).toBe(false);
	});
});

describe('StandupMeetingHandler.process — independent pre/post-meeting orchestration', () => {
	function mockOrchestration(handler: any, opts: { jiraEmpty: boolean; hasTranscript: boolean }) {
		handler.app = { vault: { read: jest.fn().mockResolvedValue('') } };
		jest.spyOn(handler, 'isJiraSectionEmpty').mockReturnValue(opts.jiraEmpty);
		jest.spyOn(handler, 'hasProcessableTranscript').mockReturnValue(opts.hasTranscript);
		jest.spyOn(handler, 'processPreMeeting').mockResolvedValue(undefined);
		jest.spyOn(handler, 'processPostMeeting').mockResolvedValue(undefined);
	}

	it('runs BOTH pre-meeting and post-meeting when JIRA is empty and a transcript/whisper file is found, pre-meeting first', async () => {
		const handler = buildHandler();
		mockOrchestration(handler, { jiraEmpty: true, hasTranscript: true });

		await handler.process(makeFile('Green Standup'));

		expect(handler.processPreMeeting).toHaveBeenCalledTimes(1);
		expect(handler.processPostMeeting).toHaveBeenCalledTimes(1);
		const preOrder = (handler.processPreMeeting as jest.Mock).mock.invocationCallOrder[0];
		const postOrder = (handler.processPostMeeting as jest.Mock).mock.invocationCallOrder[0];
		expect(preOrder).toBeLessThan(postOrder);
	});

	it('runs ONLY pre-meeting when JIRA is empty and no transcript/whisper content exists', async () => {
		const handler = buildHandler();
		mockOrchestration(handler, { jiraEmpty: true, hasTranscript: false });

		await handler.process(makeFile('Green Standup'));

		expect(handler.processPreMeeting).toHaveBeenCalledTimes(1);
		expect(handler.processPostMeeting).not.toHaveBeenCalled();
	});

	it('runs ONLY post-meeting when JIRA is already populated and transcript content exists', async () => {
		const handler = buildHandler();
		mockOrchestration(handler, { jiraEmpty: false, hasTranscript: true });

		await handler.process(makeFile('Green Standup'));

		expect(handler.processPreMeeting).not.toHaveBeenCalled();
		expect(handler.processPostMeeting).toHaveBeenCalledTimes(1);
	});

	it('runs NEITHER when JIRA is already populated and no transcript/whisper content exists', async () => {
		const handler = buildHandler();
		mockOrchestration(handler, { jiraEmpty: false, hasTranscript: false });

		await expect(handler.process(makeFile('Green Standup'))).resolves.toBeUndefined();

		expect(handler.processPreMeeting).not.toHaveBeenCalled();
		expect(handler.processPostMeeting).not.toHaveBeenCalled();
	});
});

describe('StandupMeetingHandler.resolveNonEmbedTranscript', () => {
	it('auto-locates a whisper file by meeting name and resolves its content when the transcript section has no embed', async () => {
		const handler = buildHandler();
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue('/fake/meeting.whisper') };
		handler.resolveTranscriptContent = jest.fn().mockResolvedValue('[Speaker 1]\nHello, this is a sufficiently long transcript line.');

		const fakeFile = makeFile('Green Standup');
		const result = await handler.resolveNonEmbedTranscript(fakeFile, '', '');

		expect(handler.voiceResolver.resolveWhisperForMeeting).toHaveBeenCalledWith(fakeFile);
		expect(handler.resolveTranscriptContent).toHaveBeenCalledWith('/fake/meeting.whisper', true);
		expect(result).toEqual({
			text: '[Speaker 1]\nHello, this is a sufficiently long transcript line.',
			sourceRef: '/fake/meeting.whisper',
		});
	});

	it('returns null when no whisper file can be located', async () => {
		const handler = buildHandler();
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue(null) };

		const result = await handler.resolveNonEmbedTranscript(makeFile('Green Standup'), '', '');
		expect(result).toBeNull();
	});

	it('expandTranscriptEmbed (inherited) expands an auto-located whisper file end-to-end and adds the whisper-source sentinel', async () => {
		const handler = buildHandler();
		const noteContent = '# Attendees\n- [[Kevin Tronkowski]]\n\n# Transcript\n\n\n\n# Summary\n';
		let writtenContent = noteContent;
		handler.app = {
			vault: {
				read: jest.fn().mockResolvedValue(noteContent),
				modify: jest.fn((_file: TFile, updated: string) => { writtenContent = updated; return Promise.resolve(); }),
			},
		};
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue('/fake/meeting.whisper') };
		handler.resolveTranscriptContent = jest.fn().mockResolvedValue('[Speaker 1]\nHello, this is a sufficiently long transcript line.');

		await handler.expandTranscriptEmbed(makeFile('Green Standup'));

		expect(writtenContent).toContain('<!-- whisper-source -->');
	});
});

describe('StandupMeetingHandler.extractWhisperSpeakers — auto-located export fallback', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'standup-macwhisper-'));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('falls back to macWhisperTranscriptsDir auto-locate and parses speaker names when # Transcript is empty', async () => {
		const meetingBasename = '2026-07-27 - Green Standup';
		const zip = new JSZip();
		zip.file('metadata.json', JSON.stringify({ speakers: [{ name: 'Kevin Tronkowski' }, { name: 'Speaker 2' }] }));
		const buf = await zip.generateAsync({ type: 'nodebuffer' });
		writeFileSync(join(tmpDir, `${meetingBasename}.whisper`), buf);

		const handler = buildHandler({ macWhisperTranscriptsDir: tmpDir });
		const fakeFile = makeFile(meetingBasename);
		const content = '# Attendees\n\n\n# Transcript\n\n\n# Summary\n';

		const names = await handler.extractWhisperSpeakers(fakeFile, content);

		expect(names).toEqual(['Kevin Tronkowski']);
	});

	it('returns an empty array when no inline embed exists and no auto-located file can be found', async () => {
		const handler = buildHandler({ macWhisperTranscriptsDir: tmpDir });
		const fakeFile = makeFile('Nonexistent Meeting');
		const content = '# Transcript\n\n\n# Summary\n';

		const names = await handler.extractWhisperSpeakers(fakeFile, content);

		expect(names).toEqual([]);
	});
});

describe('StandupMeetingHandler.processPostMeeting — JIRA-update order guard', () => {
	it('still runs extractJiraUpdates as the final step, even after processPreMeeting populated the JIRA section in the same pass', async () => {
		const handler = buildHandler();
		const content = '# Attendees\n- [[Kevin Tronkowski]]\n\n# Transcript\n\n\n# Summary\n';
		handler.app = { vault: { read: jest.fn().mockResolvedValue(content) } };

		const callOrder: string[] = [];
		jest.spyOn(handler, 'peekScreenshotAttendees').mockImplementation(async () => { callOrder.push('peekScreenshotAttendees'); return []; });
		jest.spyOn(handler, 'processAttendees').mockImplementation(async () => { callOrder.push('processAttendees'); });
		jest.spyOn(handler, 'expandTranscriptEmbed').mockImplementation(async () => { callOrder.push('expandTranscriptEmbed'); });
		jest.spyOn(handler, 'resolveSpeakers').mockImplementation(async () => { callOrder.push('resolveSpeakers'); });
		jest.spyOn(handler, 'generateSummary').mockImplementation(async () => { callOrder.push('generateSummary'); });
		jest.spyOn(handler, 'extractJiraUpdates').mockImplementation(async () => { callOrder.push('extractJiraUpdates'); });

		await handler.processPostMeeting(makeFile('Green Standup'), '214');

		expect(callOrder[callOrder.length - 1]).toBe('extractJiraUpdates');
		expect(callOrder).toEqual([
			'peekScreenshotAttendees',
			'processAttendees',
			'expandTranscriptEmbed',
			'resolveSpeakers',
			'generateSummary',
			'extractJiraUpdates',
		]);
	});
});
