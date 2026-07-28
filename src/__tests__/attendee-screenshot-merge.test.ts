/**
 * Regression tests for attendee/screenshot processing behavior requested by the
 * user:
 *  1. A screenshot in the # Attendees section must be considered even when the
 *     section already has wiki-linked attendees — previously any existing
 *     wiki-link caused processAttendees() to bail out before even looking at
 *     screenshots.
 *  2. Multiple screenshots must all be considered, with names deduped across
 *     them (extractFromScreenshots already used a Set internally; these tests
 *     confirm that behavior survives end-to-end through processAttendees()).
 *  3. Newly extracted names must be merged with (not replace) whatever
 *     attendees are already wiki-linked in the section.
 *  4. Once a screenshot's names have been extracted and merged in, the
 *     underlying screenshot attachment file is deleted from the vault.
 */
import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { GeneralMeetingHandler } from '../handlers/general';

const fakeApp = {} as App;

function buildStatusBar(): StatusBarManager {
	return new StatusBarManager({ setText: () => {}, style: {} } as unknown as HTMLElement);
}

function buildHandler() {
	const settings = {
		autoCreateProfiles: false,
		voiceServiceEnabled: false,
	} as unknown as MeetingProcessorSettings;

	const copilotClient = new CopilotClientManager(fakeApp, settings);
	const skillLoader = new SkillLoader(fakeApp, '/fake/plugin/dir');
	const handler = new GeneralMeetingHandler(fakeApp, settings, copilotClient, skillLoader, buildStatusBar()) as any;

	// Stub out People profile lookups — the tests below only care about which
	// names end up merged into the section, not real profile creation.
	handler.peopleManager = {
		findProfile: jest.fn().mockImplementation(async (name: string) => ({ exists: false, displayName: name })),
		getOrCreateProfile: jest.fn().mockImplementation(async (name: string) => ({ exists: false, displayName: name })),
		generateLink: jest.fn().mockImplementation((profile: { displayName: string }) => `[[${profile.displayName}]]`),
	};

	return handler;
}

function makeFile(basename: string): TFile {
	const f = new TFile();
	(f as any).basename = basename;
	(f as any).path = `Meetings/${basename}.md`;
	return f;
}

describe('processAttendees + screenshots', () => {
	test('a screenshot is still considered when wiki-linked attendees already exist, and its names are merged in', async () => {
		const handler = buildHandler();
		const file = makeFile('Weekly Sync');

		const content = [
			'# Attendees',
			'',
			'- [[Kevin Tronkowski]]',
			'![[SCR-1.png]]',
			'',
			'# Summary',
			'',
		].join('\n');

		let written: string | null = null;
		handler.app.vault = {
			read: jest.fn().mockResolvedValue(content),
			modify: jest.fn().mockImplementation(async (_f: TFile, newContent: string) => { written = newContent; }),
			delete: jest.fn().mockResolvedValue(undefined),
		};
		handler.app.metadataCache = {
			getFirstLinkpathDest: jest.fn().mockReturnValue({ path: 'Media/SCR-1.png' }),
		};

		handler.extractFromScreenshots = jest.fn().mockResolvedValue(['Alice Example']);

		await handler.processAttendees(file, content);

		expect(handler.extractFromScreenshots).toHaveBeenCalledWith(file, ['SCR-1.png']);
		expect(written).not.toBeNull();
		// Existing attendee is preserved, new screenshot-extracted attendee is merged in.
		expect(written).toContain('Kevin Tronkowski');
		expect(written).toContain('Alice Example');
		// Screenshot embed reference is gone from the rewritten section.
		expect(written).not.toContain('SCR-1.png');
		// Screenshot attachment file was deleted after processing.
		expect(handler.app.vault.delete).toHaveBeenCalledWith({ path: 'Media/SCR-1.png' });
	});

	test('multiple screenshots are all considered and deduped, merged with existing attendees', async () => {
		const handler = buildHandler();
		const file = makeFile('Large Meeting');

		const content = [
			'# Attendees',
			'',
			'- [[Kevin Tronkowski]]',
			'![[SCR-1.png]]',
			'![[SCR-2.png]]',
			'',
			'# Summary',
			'',
		].join('\n');

		let written: string | null = null;
		handler.app.vault = {
			read: jest.fn().mockResolvedValue(content),
			modify: jest.fn().mockImplementation(async (_f: TFile, newContent: string) => { written = newContent; }),
			delete: jest.fn().mockResolvedValue(undefined),
		};
		handler.app.metadataCache = {
			getFirstLinkpathDest: jest.fn().mockImplementation((link: string) => ({ path: `Media/${link}` })),
		};

		// Simulate the real extractFromScreenshots behavior: called once with both
		// screenshots, returns a deduped set of names across both.
		handler.extractFromScreenshots = jest.fn().mockImplementation(async (_f: TFile, screenshots: string[]) => {
			expect(screenshots).toEqual(['SCR-1.png', 'SCR-2.png']);
			return ['Alice Example', 'Bob Example'];
		});

		await handler.processAttendees(file, content);

		expect(written).toContain('Kevin Tronkowski');
		expect(written).toContain('Alice Example');
		expect(written).toContain('Bob Example');
		expect(handler.app.vault.delete).toHaveBeenCalledWith({ path: 'Media/SCR-1.png' });
		expect(handler.app.vault.delete).toHaveBeenCalledWith({ path: 'Media/SCR-2.png' });
	});

	test('skips entirely when wiki-linked attendees exist and there are no screenshots', async () => {
		const handler = buildHandler();
		const file = makeFile('No Screenshot Meeting');

		const content = [
			'# Attendees',
			'',
			'- [[Kevin Tronkowski]]',
			'',
			'# Summary',
			'',
		].join('\n');

		handler.app.vault = {
			read: jest.fn().mockResolvedValue(content),
			modify: jest.fn(),
			delete: jest.fn(),
		};
		handler.extractFromScreenshots = jest.fn();

		await handler.processAttendees(file, content);

		expect(handler.extractFromScreenshots).not.toHaveBeenCalled();
		expect(handler.app.vault.modify).not.toHaveBeenCalled();
		expect(handler.app.vault.delete).not.toHaveBeenCalled();
	});

	test('deduplicates a screenshot-extracted name that already exists as a wiki-linked attendee (case-insensitive)', async () => {
		const handler = buildHandler();
		const file = makeFile('Repeat Attendee Meeting');

		const content = [
			'# Attendees',
			'',
			'- [[Kevin Tronkowski]]',
			'![[SCR-1.png]]',
			'',
			'# Summary',
			'',
		].join('\n');

		let written: string | null = null;
		handler.app.vault = {
			read: jest.fn().mockResolvedValue(content),
			modify: jest.fn().mockImplementation(async (_f: TFile, newContent: string) => { written = newContent; }),
			delete: jest.fn().mockResolvedValue(undefined),
		};
		handler.app.metadataCache = {
			getFirstLinkpathDest: jest.fn().mockReturnValue({ path: 'Media/SCR-1.png' }),
		};

		// Vision "re-discovers" the already-listed attendee plus one new person.
		handler.extractFromScreenshots = jest.fn().mockResolvedValue(['kevin tronkowski', 'Alice Example']);

		await handler.processAttendees(file, content);

		const occurrences = (written!.match(/Kevin Tronkowski/gi) || []).length;
		expect(occurrences).toBe(1);
		expect(written).toContain('Alice Example');
	});
});
