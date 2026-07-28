import { EventEmitter } from 'events';
import { MeetingProcessorSettings } from '../ui/settings-tab';

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

describe('shell-env-token', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
		delete process.env.JIRA_API_TOKEN;
	});

	afterEach(() => {
		jest.restoreAllMocks();
		process.env = { ...originalEnv };
	});

	function makeSettings(overrides: Partial<MeetingProcessorSettings> = {}): MeetingProcessorSettings {
		return {
			jiraApiToken: '',
			jiraBaseUrl: 'https://hpe.atlassian.net',
			jiraCliEnabled: true,
			jiraCliPath: 'jira',
			...overrides,
		} as MeetingProcessorSettings;
	}

	test('getShellEnvVar resolves the captured value on clean exit', async () => {
		const { getShellEnvVar } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('captured-token-value'));
			child.emit('close', 0);
		});

		await expect(getShellEnvVar('JIRA_API_TOKEN')).resolves.toBe('captured-token-value');
	});

	test('getShellEnvVar resolves undefined on non-zero exit', async () => {
		const { getShellEnvVar } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.emit('close', 1);
		});

		await expect(getShellEnvVar('JIRA_API_TOKEN')).resolves.toBeUndefined();
	});

	test('getShellEnvVar resolves undefined and kills the child on timeout', async () => {
		const { getShellEnvVar } = require('../jira/shell-env-token');
		const spawnMock = jest.spyOn(require('child_process'), 'spawn');
		let killed = false;
		spawnMock.mockImplementationOnce((..._args: unknown[]) => {
			const child: any = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.kill = jest.fn(() => { killed = true; });
			// Never emits close — simulates a hung shell (e.g. interactive prompt in .zshrc)
			return child;
		});

		const result = await getShellEnvVar('JIRA_API_TOKEN', 20);
		expect(result).toBeUndefined();
		expect(killed).toBe(true);
	});

	test('getShellEnvVar resolves undefined on spawn error (e.g. shell not found)', async () => {
		const { getShellEnvVar } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.emit('error', new Error('spawn ENOENT'));
		});

		await expect(getShellEnvVar('JIRA_API_TOKEN')).resolves.toBeUndefined();
	});

	test('resolveJiraApiToken prefers process.env.JIRA_API_TOKEN over settings and shell capture', async () => {
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		process.env.JIRA_API_TOKEN = 'env-token';
		const spawnMock = jest.spyOn(require('child_process'), 'spawn');

		const token = await resolveJiraApiToken(makeSettings({ jiraApiToken: 'settings-token' }));

		expect(token).toBe('env-token');
		expect(spawnMock).not.toHaveBeenCalled();
	});

	test('resolveJiraApiToken prefers shell-captured value over settings.jiraApiToken when process.env is empty', async () => {
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('shell-captured-token'));
			child.emit('close', 0);
		});

		const token = await resolveJiraApiToken(makeSettings({ jiraApiToken: 'settings-token' }));

		expect(token).toBe('shell-captured-token');
	});

	test('resolveJiraApiToken falls back to settings.jiraApiToken as a last resort when process.env and shell capture are both empty', async () => {
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.emit('close', 1);
		});

		const token = await resolveJiraApiToken(makeSettings({ jiraApiToken: 'settings-token' }));

		expect(token).toBe('settings-token');
	});

	test('resolveJiraApiToken falls back to shell capture when settings and process.env are empty', async () => {
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('shell-captured-token'));
			child.emit('close', 0);
		});

		const token = await resolveJiraApiToken(makeSettings({ jiraApiToken: '' }));

		expect(token).toBe('shell-captured-token');
	});

	test('resolveJiraApiToken caches the shell-captured value across calls', async () => {
		const { resolveJiraApiToken } = require('../jira/shell-env-token');
		const spawnMock = mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('shell-captured-token'));
			child.emit('close', 0);
		});

		const settings = makeSettings({ jiraApiToken: '' });
		const first = await resolveJiraApiToken(settings);
		const second = await resolveJiraApiToken(settings);

		expect(first).toBe('shell-captured-token');
		expect(second).toBe('shell-captured-token');
		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	test('resetShellEnvTokenCache forces a fresh shell capture on next resolution', async () => {
		const { resolveJiraApiToken, resetShellEnvTokenCache } = require('../jira/shell-env-token');
		const settings = makeSettings({ jiraApiToken: '' });

		mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('first-token'));
			child.emit('close', 0);
		});
		await resolveJiraApiToken(settings);

		resetShellEnvTokenCache();

		mockSpawnOnce((child) => {
			child.stdout.emit('data', Buffer.from('second-token'));
			child.emit('close', 0);
		});
		const second = await resolveJiraApiToken(settings);

		expect(second).toBe('second-token');
	});
});
