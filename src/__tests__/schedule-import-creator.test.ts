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

	test('keeps the real parsed title as the filename for Green Standup items too', () => {
		const item = makeItem({ title: 'Green Team Daily Meeting', isGreenStandup: true });
		expect(buildTargetPath('Meetings', '2026-07-28', item)).toBe('Meetings/2026-07-28 - Green Team Daily Meeting.md');
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
		expect(content).toContain('start: "11:00 AM"');
		expect(content).toContain('end: "11:30 AM"');
		expect(content).toContain('organizer: "[[Meller, Jonathan|Jonathan Meller]]"');
		// Organizer is only recorded in frontmatter — not added to the # Attendees
		// section (that section is left to normal attendee processing).
		expect(content).not.toContain('- [[Meller, Jonathan|Jonathan Meller]]');
	});

	test('creates a Green Standup note from Green Standup Notes.md with organizer only in frontmatter, keeping the real title as filename', async () => {
		const app = makeApp([], { 'Templates/Green Standup Notes.md': GREEN_STANDUP_TEMPLATE });
		const settings = makeSettings();
		const people = makePeopleManager();

		const item = makeItem({ title: 'Green Team Daily Meeting', organizer: 'Piddington, Ila', isGreenStandup: true });
		const result = await createScheduleNote(app, settings, people, '2026-07-28', item);

		expect(result.status).toBe('created');
		// Filename keeps the real meeting title (not forced to "Green Standup")
		// — recognizing it as a standup meeting for routing purposes is instead
		// handled by adding "Green Team Daily Meeting" to standupKeywords.
		expect(result.path).toBe('Meetings/2026-07-28 - Green Team Daily Meeting.md');
		const content = app._created[result.path];
		expect(content).toContain('organizer: "[[Piddington, Ila|Ila Piddington]]"');
		// Default roster stays untouched — organizer is not prepended to it.
		expect(content).toContain('- [[Kevin Tronkowski]]\n- [[Ryan Bennett]]');
		expect(content).not.toContain('- [[Piddington, Ila|Ila Piddington]]');
		expect(content).toContain('# JIRA');
	});

	test('keeps start/end as simple 12-hour clock times, not ISO datetimes', async () => {
		const app = makeApp([], { 'Templates/Meeting Notes.md': MEETING_TEMPLATE });
		const result = await createScheduleNote(app, makeSettings(), makePeopleManager(), '2026-07-28',
			makeItem({ startTime: '12:30 PM', endTime: '1:00 PM' }));
		const content = app._created[result.path];
		expect(content).toContain('start: "12:30 PM"');
		expect(content).toContain('end: "1:00 PM"');
		expect(content).not.toMatch(/start:.*T\d{2}:\d{2}/);
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
