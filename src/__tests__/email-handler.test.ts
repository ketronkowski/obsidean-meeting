/**
 * @jest-environment jsdom
 */
import { EmailChainHandler } from '../handlers/email';

// Minimal Obsidian mocks
function makeApp(fileContent: string, writeCapture: { content: string }) {
	return {
		vault: {
			read: jest.fn().mockResolvedValue(fileContent),
			modify: jest.fn().mockImplementation((_file: any, content: string) => {
				writeCapture.content = content;
				return Promise.resolve();
			}),
			getAbstractFileByPath: jest.fn().mockReturnValue({ path: 'People' }),
			create: jest.fn().mockResolvedValue({ basename: 'Test, User', path: 'People/Test, User.md' }),
			createFolder: jest.fn(),
			getMarkdownFiles: jest.fn().mockReturnValue([]),
		},
		metadataCache: {
			getFileCache: jest.fn().mockReturnValue(null),
		},
	} as any;
}

function makeFile(basename: string): any {
	return { basename, extension: 'md', path: `Notes/${basename}.md`, name: `${basename}.md` };
}

function makeSettings() {
	return {
		notesFolder: 'Notes',
		meetingsFolder: 'Meetings',
		peopleFolder: 'People',
		model: 'claude-sonnet-4',
		copilotCliPath: 'copilot',
		voiceServiceEnabled: false,
	} as any;
}

function makeCopilotClient(response = 'Mocked Copilot response') {
	return {
		sendPrompt: jest.fn().mockResolvedValue(response),
	} as any;
}

function makeSkillLoader(sections: Record<string, string> = {}) {
	return {
		getSkill: jest.fn().mockReturnValue({
			sections: new Map(Object.entries(sections)),
		}),
	} as any;
}

function makeStatusBar() {
	return { show: jest.fn() } as any;
}

// ---------------------------------------------------------------------------
// extractSection / isSectionEmpty / replaceSection unit tests
// ---------------------------------------------------------------------------

describe('EmailChainHandler section utilities', () => {
	let handler: EmailChainHandler;

	beforeEach(() => {
		const write = { content: '' };
		handler = new EmailChainHandler(
			makeApp('', write), makeSettings(), makeCopilotClient(),
			makeSkillLoader(), makeStatusBar()
		);
	});

	const DOC = `---\nwhen: 2026-05-22\ntags:\n  - note\n---\n# Participants\n\n\n# Summary\n\n\n# Email Chain\n\nHello from John.\n\n`;

	test('extractSection returns content for Email Chain', () => {
		expect(handler.extractSection(DOC, 'Email Chain')).toBe('Hello from John.');
	});

	test('extractSection returns empty string for missing section', () => {
		expect(handler.extractSection(DOC, 'Nonexistent')).toBe('');
	});

	test('isSectionEmpty returns true for empty Participants', () => {
		expect(handler.isSectionEmpty(DOC, 'Participants')).toBe(true);
	});

	test('isSectionEmpty returns false after content is set', () => {
		const doc = DOC.replace('# Participants\n\n', '# Participants\n\n- [[Smith, John|John Smith]]\n');
		expect(handler.isSectionEmpty(doc, 'Participants')).toBe(false);
	});

	test('replaceSection inserts body between heading and next heading', () => {
		const result = handler.replaceSection(DOC, 'Participants', '- [[Smith, John|John Smith]]');
		expect(result).toContain('# Participants\n\n- [[Smith, John|John Smith]]\n');
		expect(result).toContain('# Summary');
	});
});

// ---------------------------------------------------------------------------
// process() — preserve existing sections
// ---------------------------------------------------------------------------

describe('EmailChainHandler.process() preserve-existing', () => {
	test('skips Participants if already populated', async () => {
		const content =
			`---\nwhen: 2026-05-22\ntags:\n  - note\n---\n` +
			`# Participants\n\n- [[Smith, John|John Smith]]\n\n` +
			`# Summary\n\n\n` +
			`# Email Chain\n\n**From:** Doe, Jane <[jane.doe@hpe.com](mailto:jane.doe@hpe.com)>\n\n`;

		const write = { content: '' };
		const app = makeApp(content, write);
		const copilot = makeCopilotClient('Generated summary text');
		const handler = new EmailChainHandler(
			app, makeSettings(), copilot, makeSkillLoader(), makeStatusBar()
		);

		await handler.process(makeFile('Test Note'));

		// Summary should be written (it was empty)
		expect(write.content).toContain('Generated summary text');
		// Participants wiki link must be preserved
		expect(write.content).toContain('[[Smith, John|John Smith]]');
		// Copilot was called once (for summary only — participants skipped)
		expect(copilot.sendPrompt).toHaveBeenCalledTimes(1);
	});

	test('skips Summary if already populated', async () => {
		const content =
			`---\nwhen: 2026-05-22\ntags:\n  - note\n---\n` +
			`# Participants\n\n\n` +
			`# Summary\n\nExisting summary text.\n\n` +
			`# Email Chain\n\n**From:** Doe, Jane <[jane.doe@hpe.com](mailto:jane.doe@hpe.com)>\n\n`;

		const write = { content: '' };
		const app = makeApp(content, write);
		const copilot = makeCopilotClient('profile body');
		const handler = new EmailChainHandler(
			app, makeSettings(), copilot, makeSkillLoader(), makeStatusBar()
		);

		await handler.process(makeFile('Test Note'));

		// Existing summary must be preserved
		expect(write.content).toContain('Existing summary text.');
		// Summary generation prompt should not have been called
		const calls: string[] = copilot.sendPrompt.mock.calls.map((c: any[]) => c[0] as string);
		const summaryCalls = calls.filter(p => p.includes('email thread to summarize'));
		expect(summaryCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// process() — populates empty sections
// ---------------------------------------------------------------------------

describe('EmailChainHandler.process() populates empty sections', () => {
	test('writes wiki-linked participant when Participants section is empty', async () => {
		const content =
			`---\nwhen: 2026-05-22\ntags:\n  - note\n---\n` +
			`# Participants\n\n\n` +
			`# Summary\n\nAlready exists.\n\n` +
			`# Email Chain\n\n**From:** Colton, Will <[will.colton@hpe.com](mailto:will.colton@hpe.com)>\n\n`;

		const write = { content: '' };
		const app = makeApp(content, write);
		// Mock findProfile to return "exists" so we don't call createProfile
		const pm = require('../people-manager');
		const origFindProfile = pm.PeopleManager.prototype.findProfile;
		pm.PeopleManager.prototype.findProfile = jest.fn().mockResolvedValue({
			file: { basename: 'Colton, Will', path: 'People/Colton, Will.md' },
			displayName: 'Will Colton',
			firstName: 'Will',
			lastName: 'Colton',
			exists: true,
		});

		const handler = new EmailChainHandler(
			app, makeSettings(), makeCopilotClient(), makeSkillLoader(), makeStatusBar()
		);

		await handler.process(makeFile('Test Note'));

		// Restore mock
		pm.PeopleManager.prototype.findProfile = origFindProfile;

		expect(write.content).toContain('[[Colton, Will|Will Colton]]');
	});
});
