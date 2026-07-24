/**
 * @jest-environment jsdom
 */
import { upsertDailySummarySection, DailySummaryHandler } from '../handlers/daily-summary';
import { validateDailyNote } from '../validators';

const NEW_BODY = '### Key Decisions\n- Decided to ship the feature.';

// ---------------------------------------------------------------------------
// upsertDailySummarySection — pure function tests
// ---------------------------------------------------------------------------

describe('upsertDailySummarySection', () => {
	test('replaces existing ## Daily Summary content', () => {
		const content = `## ✅ Today\n\n\`\`\`todoist\nfilter: today\n\`\`\`\n\n## Daily Summary\n\nOld summary text.\n\n## Short Conversations and Notes\n\n- \n`;
		const result = upsertDailySummarySection(content, NEW_BODY);
		expect(result).toContain(`## Daily Summary\n\n${NEW_BODY}\n\n`);
		expect(result).not.toContain('Old summary text.');
		// Section heading appears exactly once
		expect(result.split('## Daily Summary').length).toBe(2);
	});

	test('preserves content after ## Daily Summary when updating', () => {
		const content = `## Daily Summary\n\nOld.\n\n## Short Conversations and Notes\n\n- Hello\n`;
		const result = upsertDailySummarySection(content, NEW_BODY);
		expect(result).toContain('## Short Conversations and Notes');
		expect(result).toContain('- Hello');
		expect(result).not.toContain('Old.');
	});

	test('no duplicate section on second call', () => {
		const content = `## Daily Summary\n\nFirst.\n\n## Short Conversations and Notes\n\n- \n`;
		const after1 = upsertDailySummarySection(content, 'Second.');
		const after2 = upsertDailySummarySection(after1, 'Third.');
		expect(after2.split('## Daily Summary').length).toBe(2);
		expect(after2).toContain('Third.');
		expect(after2).not.toContain('Second.');
	});

	test('inserts before ## Short Conversations and Notes when section absent', () => {
		const content = `## ✅ Today\n\n\`\`\`todoist\nfilter: today\n\`\`\`\n\n## Short Conversations and Notes\n\n- \n`;
		const result = upsertDailySummarySection(content, NEW_BODY);
		expect(result).toContain(`## Daily Summary\n\n${NEW_BODY}\n\n`);
		const summaryIdx = result.indexOf('## Daily Summary');
		const shortConvIdx = result.indexOf('## Short Conversations and Notes');
		expect(summaryIdx).toBeLessThan(shortConvIdx);
	});

	test('appends to end when neither target section exists', () => {
		const content = `## ✅ Today\n\n\`\`\`todoist\nfilter: today\n\`\`\`\n`;
		const result = upsertDailySummarySection(content, NEW_BODY);
		expect(result).toContain(`## Daily Summary\n\n${NEW_BODY}\n`);
		expect(result.indexOf('## Daily Summary')).toBeGreaterThan(content.length - 1);
	});

	test('handles empty existing ## Daily Summary section', () => {
		const content = `## Daily Summary\n\n\n## Short Conversations and Notes\n\n- \n`;
		const result = upsertDailySummarySection(content, NEW_BODY);
		expect(result).toContain(`## Daily Summary\n\n${NEW_BODY}\n\n`);
		expect(result).toContain('## Short Conversations and Notes');
	});
});

// ---------------------------------------------------------------------------
// validateDailyNote
// ---------------------------------------------------------------------------

function makeFile(name: string, path: string): any {
	return { name, path, extension: 'md', basename: name.replace('.md', '') };
}

function makeSettings(dailyNotesFolder = 'Daily Notes'): any {
	return { dailyNotesFolder, meetingsFolder: 'Meetings', notesFolder: 'Notes' } as any;
}

describe('validateDailyNote', () => {
	const app = {} as any;

	test('valid daily note in correct folder with correct filename', async () => {
		const file = makeFile('2026-05-22.md', 'Daily Notes/2026-05-22.md');
		const result = await validateDailyNote(file, app, makeSettings());
		expect(result.valid).toBe(true);
	});

	test('rejects file not in daily notes folder', async () => {
		const file = makeFile('2026-05-22.md', 'Meetings/2026-05-22.md');
		const result = await validateDailyNote(file, app, makeSettings());
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Daily Notes');
	});

	test('rejects file with meeting-style filename', async () => {
		const file = makeFile('2026-05-22 - Green Standup.md', 'Daily Notes/2026-05-22 - Green Standup.md');
		const result = await validateDailyNote(file, app, makeSettings());
		expect(result.valid).toBe(false);
		expect(result.error).toContain('YYYY-MM-DD.md');
	});

	test('rejects non-markdown file', async () => {
		const file = { name: '2026-05-22.txt', path: 'Daily Notes/2026-05-22.txt', extension: 'txt', basename: '2026-05-22' };
		const result = await validateDailyNote(file as any, app, makeSettings());
		expect(result.valid).toBe(false);
	});

	test('respects custom dailyNotesFolder setting', async () => {
		const file = makeFile('2026-05-22.md', 'Journal/2026-05-22.md');
		const result = await validateDailyNote(file, app, makeSettings('Journal'));
		expect(result.valid).toBe(true);
	});

	test('rejects filename with words beyond date', async () => {
		const file = makeFile('2026-05-22-extra.md', 'Daily Notes/2026-05-22-extra.md');
		const result = await validateDailyNote(file, app, makeSettings());
		expect(result.valid).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// DailySummaryHandler.extractSummaryFromContent
// ---------------------------------------------------------------------------

describe('DailySummaryHandler.extractSummaryFromContent', () => {
	let handler: DailySummaryHandler;

	beforeEach(() => {
		handler = new DailySummaryHandler(
			makeApp([]),
			makeSettings() as any,
			makeCopilotClient(),
			makeSkillLoader(),
			makeStatusBar(),
		);
	});

	test('extracts # Summary section', () => {
		const content = `---\ntags: [meeting]\n---\n\n# Attendees\n- Alice\n\n# Summary\n\nDecided to ship v2.\n\n# Transcript\nRaw transcript here.\n`;
		expect(handler.extractSummaryFromContent(content)).toBe('Decided to ship v2.');
	});

	test('extracts # Copilot Summary when no # Summary exists', () => {
		const content = `---\ntags: [meeting]\n---\n\n# Copilot Summary\n\nTeams AI summary here.\n\n# Transcript\nRaw transcript.\n`;
		expect(handler.extractSummaryFromContent(content)).toBe('Teams AI summary here.');
	});

	test('prefers # Summary over # Copilot Summary', () => {
		const content = `---\ntags: [meeting]\n---\n\n# Copilot Summary\n\nTeams version.\n\n# Summary\n\nPlugin version.\n`;
		expect(handler.extractSummaryFromContent(content)).toBe('Plugin version.');
	});

	test('falls back to truncated content when no summary section exists', () => {
		const content = `# Attendees\n- Alice\n\n# Notes\nSome notes.\n`;
		const result = handler.extractSummaryFromContent(content);
		expect(result).toContain('# Attendees');
	});

	test('ignores empty # Summary section and falls back to # Copilot Summary', () => {
		const content = `# Summary\n\n\n# Copilot Summary\n\nFallback content.\n`;
		expect(handler.extractSummaryFromContent(content)).toBe('Fallback content.');
	});
});



function makeVaultFile(name: string, folder: string): any {
	return { name, path: `${folder}/${name}`, extension: 'md', basename: name.replace('.md', '') };
}

function makeApp(files: any[]): any {
	return {
		vault: {
			getMarkdownFiles: jest.fn().mockReturnValue(files),
			read: jest.fn().mockResolvedValue('Mock content'),
			modify: jest.fn().mockResolvedValue(undefined),
		},
	} as any;
}

function makeCopilotClient(response = 'Summary output') {
	return { sendPrompt: jest.fn().mockResolvedValue(response) } as any;
}

function makeSkillLoader() {
	return {
		getSkill: jest.fn().mockReturnValue({
			sections: new Map([
				['Workflow', 'Analyze content.'],
				['Output Format', 'Bullet points.'],
				['Handling Sparse Days', 'Generate even if sparse.'],
			]),
		}),
	} as any;
}

function makeStatusBar() {
	return { show: jest.fn() } as any;
}

describe('DailySummaryHandler.getLinkedFiles', () => {
	const settings = makeSettings() as any;
	const allFiles = [
		makeVaultFile('2026-05-22 - Green Standup.md', 'Meetings'),
		makeVaultFile('2026-05-22 - Project Review.md', 'Meetings'),
		makeVaultFile('2026-05-21 - Unrelated.md', 'Meetings'),
		makeVaultFile('2026-05-22 - 1234567890 - Email Thread.md', 'Notes'),
		makeVaultFile('2026-05-22 - 9876543210 - Another Note.md', 'Notes'),
		makeVaultFile('2026-05-23 - Future Note.md', 'Notes'),
		makeVaultFile('2026-05-22.md', 'Daily Notes'),
	];

	let handler: DailySummaryHandler;

	beforeEach(() => {
		handler = new DailySummaryHandler(
			makeApp(allFiles),
			settings,
			makeCopilotClient(),
			makeSkillLoader(),
			makeStatusBar(),
		);
	});

	test('returns meetings for the given date', () => {
		const { meetings } = handler.getLinkedFiles('2026-05-22');
		expect(meetings.map(f => f.name)).toContain('2026-05-22 - Green Standup.md');
		expect(meetings.map(f => f.name)).toContain('2026-05-22 - Project Review.md');
		expect(meetings.map(f => f.name)).not.toContain('2026-05-21 - Unrelated.md');
	});

	test('returns notes for the given date', () => {
		const { notes } = handler.getLinkedFiles('2026-05-22');
		expect(notes.map(f => f.name)).toContain('2026-05-22 - 1234567890 - Email Thread.md');
		expect(notes.map(f => f.name)).toContain('2026-05-22 - 9876543210 - Another Note.md');
		expect(notes.map(f => f.name)).not.toContain('2026-05-23 - Future Note.md');
	});

	test('excludes daily note file from note results', () => {
		const { notes } = handler.getLinkedFiles('2026-05-22');
		expect(notes.map(f => f.name)).not.toContain('2026-05-22.md');
	});

	test('returns empty arrays when no files match', () => {
		const { meetings, notes } = handler.getLinkedFiles('2099-01-01');
		expect(meetings).toHaveLength(0);
		expect(notes).toHaveLength(0);
	});
});
