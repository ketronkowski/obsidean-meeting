import { createScheduleNote, buildTargetPath } from '../schedule-import/creator';
import { ParsedScheduleItem } from '../schedule-import/parser';
import { TFile } from 'obsidian';

const MEETING_TEMPLATE = `---
when: <% tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD") %>
tags:
  - meeting
---
# Attendees


#  Summary


# Notes


# Transcript

`;

const GREEN_STANDUP_TEMPLATE = `---
when: <% tp.date.now("YYYY-MM-DD", 0, tp.file.title, "YYYY-MM-DD") %>
tags:
  - meeting
---
# Attendees

- [[Kevin Tronkowski]]
- [[Ryan Bennett]]

# Summary


# JIRA



# Notes



# Transcript
`;

function makeApp(existingPaths: string[] = [], templates: Record<string, string> = {}) {
	const created: Record<string, string> = {};
	const files: Record<string, any> = {};
	for (const p of existingPaths) files[p] = Object.assign(new TFile(), { path: p });
	for (const p of Object.keys(templates)) files[p] = Object.assign(new TFile(), { path: p });

	return {
		vault: {
			getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
			read: jest.fn(async (file: any) => {
				if (templates[file.path] !== undefined) return templates[file.path];
				throw new Error(`No template mocked for ${file.path}`);
			}),
			create: jest.fn(async (path: string, content: string) => {
				created[path] = content;
				return { path, basename: path.split('/').pop() };
			}),
			createFolder: jest.fn(),
		},
		_created: created,
	} as any;
}

function makeSettings() {
	return {
		meetingsFolder: 'Meetings',
		templatesFolder: 'Templates',
	} as any;
}

function makePeopleManager(profileExists = true) {
	return {
		getOrCreateProfile: jest.fn(async (name: string) => ({
			file: profileExists ? { basename: name } : null,
			displayName: name,
			firstName: name.split(',')[1]?.trim() ?? name,
			lastName: name.split(',')[0]?.trim() ?? '',
			exists: profileExists,
		})),
		generateLink: jest.fn((profile: any) => profile.exists ? `[[${profile.lastName}, ${profile.firstName}|${profile.firstName} ${profile.lastName}]]` : profile.displayName),
	} as any;
}

function makeItem(overrides: Partial<ParsedScheduleItem> = {}): ParsedScheduleItem {
	return {
		rawLine: 'raw',
		title: '2026 July P2P - Daily Sync',
		startTime: '11:00 AM',
		endTime: '11:30 AM',
		organizer: 'Meller, Jonathan',
		isGreenStandup: false,
		...overrides,
	};
}

describe('buildTargetPath', () => {
	test('builds Meetings/{date} - {sanitized title}.md', () => {
		expect(buildTargetPath('Meetings', '2026-07-28', makeItem())).toBe('Meetings/2026-07-28 - 2026 July P2P - Daily Sync.md');
	});

	test('sanitizes slashes in the title', () => {
		expect(buildTargetPath('Meetings', '2026-07-28', makeItem({ title: 'Kevin/Ila 1-1' }))).toBe('Meetings/2026-07-28 - Kevin-Ila 1-1.md');
	});

	test('always uses the fixed "Green Standup" filename for Green Standup items, ignoring the raw parsed title', () => {
		const item = makeItem({ title: 'Green Team Daily Meeting', isGreenStandup: true });
		expect(buildTargetPath('Meetings', '2026-07-28', item)).toBe('Meetings/2026-07-28 - Green Standup.md');
	});
});

describe('createScheduleNote', () => {
	test('creates a general meeting note from Meeting Notes.md with when/start/end/organizer substituted', async () => {
		const app = makeApp([], { 'Templates/Meeting Notes.md': MEETING_TEMPLATE });
		const settings = makeSettings();
		const people = makePeopleManager();

		const result = await createScheduleNote(app, settings, people, '2026-07-28', makeItem());

		expect(result.status).toBe('created');
		expect(result.path).toBe('Meetings/2026-07-28 - 2026 July P2P - Daily Sync.md');

		const content = app._created[result.path];
		expect(content).toContain('when: 2026-07-28');
		expect(content).not.toContain('<%');
		expect(content).toContain('start: 2026-07-28T11:00:00');
		expect(content).toContain('end: 2026-07-28T11:30:00');
		expect(content).toContain('organizer: "[[Meller, Jonathan|Jonathan Meller]]"');
		expect(content).toContain('# Attendees\n\n- [[Meller, Jonathan|Jonathan Meller]]');
	});

	test('creates a Green Standup note from Green Standup Notes.md, prepending organizer to the default roster, using the "Green Standup" filename', async () => {
		const app = makeApp([], { 'Templates/Green Standup Notes.md': GREEN_STANDUP_TEMPLATE });
		const settings = makeSettings();
		const people = makePeopleManager();

		const item = makeItem({ title: 'Green Team Daily Meeting', organizer: 'Piddington, Ila', isGreenStandup: true });
		const result = await createScheduleNote(app, settings, people, '2026-07-28', item);

		expect(result.status).toBe('created');
		// Filename must be "Green Standup", not the raw parsed title, so that a
		// later "Process Meeting" run's detectMeetingType() (which matches on
		// the filename containing the standupKeywords setting) routes this note
		// to StandupMeetingHandler and populates # JIRA — not the general handler.
		expect(result.path).toBe('Meetings/2026-07-28 - Green Standup.md');
		const content = app._created[result.path];
		expect(content).toContain('- [[Piddington, Ila|Ila Piddington]]\n- [[Kevin Tronkowski]]');
		expect(content).toContain('# JIRA');
	});

	test('converts PM times to 24-hour ISO correctly', async () => {
		const app = makeApp([], { 'Templates/Meeting Notes.md': MEETING_TEMPLATE });
		const result = await createScheduleNote(app, makeSettings(), makePeopleManager(), '2026-07-28',
			makeItem({ startTime: '12:30 PM', endTime: '1:00 PM' }));
		const content = app._created[result.path];
		expect(content).toContain('start: 2026-07-28T12:30:00');
		expect(content).toContain('end: 2026-07-28T13:00:00');
	});

	test('skips creation when the target path already exists (duplicate)', async () => {
		const targetPath = 'Meetings/2026-07-28 - 2026 July P2P - Daily Sync.md';
		const app = makeApp([targetPath], { 'Templates/Meeting Notes.md': MEETING_TEMPLATE });
		const result = await createScheduleNote(app, makeSettings(), makePeopleManager(), '2026-07-28', makeItem());
		expect(result.status).toBe('duplicate');
		expect(app.vault.create).not.toHaveBeenCalled();
	});

	test('creates a new People profile for an unknown organizer via getOrCreateProfile', async () => {
		const app = makeApp([], { 'Templates/Meeting Notes.md': MEETING_TEMPLATE });
		const people = makePeopleManager(false);
		await createScheduleNote(app, makeSettings(), people, '2026-07-28', makeItem({ organizer: 'Unknown, Person' }));
		expect(people.getOrCreateProfile).toHaveBeenCalledWith('Unknown, Person');
	});
});
