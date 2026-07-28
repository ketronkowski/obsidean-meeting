import { EventEmitter } from 'events';
import { MeetingProcessorSettings } from '../ui/settings-tab';

jest.mock('../jira/shell-env-token', () => ({
	resolveJiraApiToken: jest.fn(),
}));

/** Mocks a single spawn() call. */
function mockSpawnOnce(impl: (child: any) => void) {
	const spawnMock = jest.spyOn(require('child_process'), 'spawn');
	spawnMock.mockImplementationOnce((..._args: unknown[]) => {
		const child: any = new EventEmitter();
		child.stdout = new EventEmitter();
		child.stderr = new EventEmitter();
		child.kill = jest.fn();
		setImmediate(() => impl(child));
		return child;
	});
	return spawnMock;
}

/**
 * searchActiveSprintIssues() spawns the CLI twice: once for `sprint list` (to resolve
 * the active sprint id(s)) and once for `issue list` (to fetch that sprint's issues).
 * This helper queues up mock implementations for each spawn call in order.
 */
function mockSpawnSequence(impls: Array<(child: any) => void>) {
	const spawnMock = jest.spyOn(require('child_process'), 'spawn');
	for (const impl of impls) {
		spawnMock.mockImplementationOnce((..._args: unknown[]) => {
			const child: any = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = jest.fn();
			setImmediate(() => impl(child));
			return child;
		});
	}
	return spawnMock;
}

function emitStdoutAndClose(stdout: string, code = 0) {
	return (child: any) => {
		child.stdout.emit('data', Buffer.from(stdout));
		child.emit('close', code);
	};
}

const ONE_ACTIVE_SPRINT_STDOUT = '110929\tGreen 2026.07.22 S15\tactive\n';

describe('JiraCliClient', () => {
	function makeSettings(overrides: Partial<MeetingProcessorSettings> = {}): MeetingProcessorSettings {
		return {
			jiraApiToken: '',
			jiraBaseUrl: 'https://hpe.atlassian.net',
			jiraCliEnabled: true,
			jiraCliPath: 'jira',
			...overrides,
		} as MeetingProcessorSettings;
	}

	beforeEach(() => {
		jest.clearAllMocks();
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		(resolveJiraApiToken as jest.Mock).mockResolvedValue('a-valid-token');
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	test('isEnabled reflects settings.jiraCliEnabled', () => {
		const { JiraCliClient } = require('../jira/cli-client');
		expect(new JiraCliClient(makeSettings({ jiraCliEnabled: true })).isEnabled()).toBe(true);
		expect(new JiraCliClient(makeSettings({ jiraCliEnabled: false })).isEnabled()).toBe(false);
	});

	test('resolves the active sprint id via `jira sprint list`, then scopes `issue list` to it', async () => {
		const { JiraCliClient } = require('../jira/cli-client');
		const rawIssues = [
			{
				key: 'GLCP-1',
				fields: {
					summary: 'Fix the thing',
					status: { name: 'In Progress' },
					issuetype: { name: 'Bug' },
					assignee: { accountId: 'acc-1', displayName: 'Jane Doe' },
				},
			},
			{
				key: 'GLCP-2',
				fields: { summary: 'Unassigned task', status: { name: 'To Do' }, issuetype: { name: 'Task' }, assignee: null },
			},
		];

		const spawnMock = mockSpawnSequence([
			emitStdoutAndClose(ONE_ACTIVE_SPRINT_STDOUT),
			emitStdoutAndClose(JSON.stringify(rawIssues)),
		]);

		const client = new JiraCliClient(makeSettings());
		const issues = await client.searchActiveSprintIssues(undefined, 100);

		expect(issues).toHaveLength(2);
		expect(issues[0]).toEqual({
			key: 'GLCP-1',
			summary: 'Fix the thing',
			status: 'In Progress',
			issueType: 'Bug',
			assignee: 'acc-1',
			assigneeDisplayName: 'Jane Doe',
			url: 'https://hpe.atlassian.net/browse/GLCP-1',
		});
		expect(issues[1].assigneeDisplayName).toBe('Unassigned');

		// First call: sprint list, board-scoped via jira CLI's own config (no --board flag exists).
		const [, sprintArgs] = spawnMock.mock.calls[0];
		expect(sprintArgs).toEqual(['sprint', 'list', '--state', 'active', '--plain', '--no-headers', '--columns', 'ID,NAME,STATE']);

		// Second call: issue list scoped to the resolved sprint id, no ORDER BY, no --board.
		const [, issueArgs] = spawnMock.mock.calls[1];
		expect(issueArgs).toContain('issue');
		expect(issueArgs).toContain('list');
		const jqlIndex = (issueArgs as string[]).indexOf('-q') + 1;
		expect((issueArgs as string[])[jqlIndex]).toBe('sprint in (110929)');
		expect((issueArgs as string[]).join(' ')).not.toMatch(/ORDER BY/);
		expect((issueArgs as string[]).join(' ')).not.toMatch(/--board/);
	});

	test('prefers the sprint whose name matches teamName when multiple active sprints are returned', async () => {
		const { JiraCliClient } = require('../jira/cli-client');
		const multiSprintStdout = '110929\tGreen 2026.07.22 S15\tactive\n110930\tMagenta 2026.07.22 S15\tactive\n';

		const spawnMock = mockSpawnSequence([
			emitStdoutAndClose(multiSprintStdout),
			emitStdoutAndClose('[]'),
		]);

		const client = new JiraCliClient(makeSettings());
		await client.searchActiveSprintIssues('green', 100);

		const [, issueArgs] = spawnMock.mock.calls[1];
		const jqlIndex = (issueArgs as string[]).indexOf('-q') + 1;
		expect((issueArgs as string[])[jqlIndex]).toBe('sprint in (110929)');
	});

	test('throws JiraCliError when no active sprint is found', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		mockSpawnOnce(emitStdoutAndClose(''));

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(JiraCliError);
	});

	test('throws JiraCliError when the token cannot be resolved', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		(resolveJiraApiToken as jest.Mock).mockResolvedValue(undefined);

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(JiraCliError);
	});

	test('throws JiraCliError with stderr detail on non-zero exit (e.g. 401) during sprint list', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		mockSpawnOnce((child) => {
			child.stderr.emit('data', Buffer.from("jira: Received unexpected response '401 Unauthorized'."));
			child.emit('close', 1);
		});

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(/401 Unauthorized/);
	});

	test('throws JiraCliError (generic) on any other non-zero exit during issue list', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		mockSpawnSequence([
			emitStdoutAndClose(ONE_ACTIVE_SPRINT_STDOUT),
			(child) => {
				child.stderr.emit('data', Buffer.from('boom'));
				child.emit('close', 1);
			},
		]);

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(JiraCliError);
	});

	test('throws JiraCliError when the jira binary is not found (ENOENT)', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		mockSpawnOnce((child) => {
			const err: any = new Error('spawn jira ENOENT');
			err.code = 'ENOENT';
			child.emit('error', err);
		});

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(JiraCliError);
	});

	test('throws JiraCliError on unparseable JSON output from issue list', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		mockSpawnSequence([
			emitStdoutAndClose(ONE_ACTIVE_SPRINT_STDOUT),
			emitStdoutAndClose('not json'),
		]);

		const client = new JiraCliClient(makeSettings());
		await expect(client.searchActiveSprintIssues()).rejects.toThrow(JiraCliError);
	});

	test('throws JiraCliError and kills the child process on timeout', async () => {
		const { JiraCliClient, JiraCliError } = require('../jira/cli-client');
		const spawnMock = jest.spyOn(require('child_process'), 'spawn');
		let killed = false;
		spawnMock.mockImplementationOnce((..._args: unknown[]) => {
			const child: any = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = jest.fn(() => { killed = true; });
			return child; // never closes — simulates a hung CLI
		});

		// Use fake timers to avoid an actual 20s wait in the test.
		jest.useFakeTimers();
		const client = new JiraCliClient(makeSettings());
		const promise = client.searchActiveSprintIssues();
		// Attach the rejection assertion BEFORE advancing timers, so the rejection is
		// never briefly "unhandled" (which Jest would otherwise flag as a failure).
		const assertion = expect(promise).rejects.toThrow(JiraCliError);
		await jest.advanceTimersByTimeAsync(21_000);
		await assertion;
		expect(killed).toBe(true);
		jest.useRealTimers();
	});
});
