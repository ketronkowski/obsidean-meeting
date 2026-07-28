/**
 * Regression test for the "second speaker-attribution dialog still opens after
 * Skip All" bug when a meeting has NO `![[*.whisper]]` embed in its `# Transcript`
 * section (the section is empty) and the `.whisper` file is instead auto-located
 * by matching the meeting's filename (GeneralMeetingHandler.resolveNonEmbedTranscript).
 *
 * expandTranscriptEmbed() previously passed the *original* (empty) rawTranscript
 * string to writeExpandedTranscript() instead of the resolved whisper file path,
 * so transformExpandedTranscript()'s `rawTranscript.includes('.whisper')` check
 * always failed for this auto-found path — the `<!-- whisper-source -->` sentinel
 * was silently dropped, and resolveSpeakers() (called later in the same pipeline)
 * reopened the text-heuristic SpeakerAttributionModal for every [Speaker N] label.
 *
 * Fixed by having resolveNonEmbedTranscript() return `{ text, sourceRef }` so the
 * real whisper path flows through to transformExpandedTranscript().
 */
import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { GeneralMeetingHandler } from '../handlers/general';

const fakeApp = {} as App;
const fakeSettings = {} as unknown as MeetingProcessorSettings;

function buildStatusBar(): StatusBarManager {
	return new StatusBarManager({ setText: () => {}, style: {} } as unknown as HTMLElement);
}

describe('expandTranscriptEmbed — auto-found .whisper file (no embed link)', () => {
	it('prepends the <!-- whisper-source --> sentinel and causes resolveSpeakers to skip its modal', async () => {
		const copilotClient = new CopilotClientManager(fakeApp, fakeSettings);
		const skillLoader = new SkillLoader(fakeApp, '/fake/plugin/dir');
		const handler = new GeneralMeetingHandler(fakeApp, fakeSettings, copilotClient, skillLoader, buildStatusBar()) as any;

		const noteContent = '# Attendees\n- [[Kevin Tronkowski]]\n\n# Transcript\n\n\n\n# Summary\n';
		let writtenContent = noteContent;
		const fakeFile = {} as TFile;
		handler.app = {
			vault: {
				read: jest.fn().mockResolvedValue(noteContent),
				modify: jest.fn((_file: TFile, updated: string) => { writtenContent = updated; return Promise.resolve(); }),
			},
		};

		// Simulate the auto-found-by-meeting-name path: no embed in the note, but a
		// matching .whisper file exists on disk.
		handler.voiceResolver = { resolveWhisperForMeeting: jest.fn().mockReturnValue('/fake/meeting.whisper') };
		handler.resolveTranscriptContent = jest.fn().mockResolvedValue('[Speaker 1]\nHello, this is a sufficiently long transcript line.');

		await handler.expandTranscriptEmbed(fakeFile);

		expect(handler.voiceResolver.resolveWhisperForMeeting).toHaveBeenCalledWith(fakeFile);
		expect(handler.resolveTranscriptContent).toHaveBeenCalledWith('/fake/meeting.whisper', true);
		expect(writtenContent).toContain('<!-- whisper-source -->');

		// resolveSpeakers() re-reads the file and must see the sentinel to skip its modal.
		handler.app.vault.read = jest.fn().mockResolvedValue(writtenContent);
		const rawTranscript = writtenContent.match(/# Transcript\s*\n([\s\S]*?)(?=\n# [^#]|$)/)?.[1] ?? '';
		expect(handler.shouldSkipSpeakerResolution(rawTranscript)).toBe(true);
	});
});
