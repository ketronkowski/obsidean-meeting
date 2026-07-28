import { MeetingProcessorSettings } from '../ui/settings-tab';

jest.mock('../jira/cli-client');
jest.mock('../jira/api-client');

import { JiraManager } from '../jira/manager';
import { JiraCliClient } from '../jira/cli-client';
import { JiraApiClient } from '../jira/api-client';

describe('JiraManager CLI-first / REST-fallback ordering', () => {
	function makeSettings(overrides: Partial<MeetingProcessorSettings> = {}): MeetingProcessorSettings {
		return {
			jiraCliEnabled: true,
			jiraCliPath: 'jira',
			jiraProjectKey: 'GLCP',
			jiraBaseUrl: 'https://hpe.atlassian.net',
			jiraEmail: 'user@example.com',
			jiraApiToken: 'rest-token',
			...overrides,
		} as MeetingProcessorSettings;
	}

	const sampleIssue = {
		key: 'GLCP-1',
		summary: 'Something',
		status: 'To Do',
		issueType: 'Task',
		assignee: null,
		assigneeDisplayName: 'Unassigned',
		url: 'https://hpe.atlassian.net/browse/GLCP-1',
	};

	beforeEach(() => {
		jest.clearAllMocks();
	});

	test('uses CLI result and does not call REST when CLI succeeds', async () => {
		const isEnabledMock = jest.fn().mockReturnValue(true);
		const searchCliMock = jest.fn().mockResolvedValue([sampleIssue]);
		(JiraCliClient as jest.Mock).mockImplementation(() => ({
			isEnabled: isEnabledMock,
			searchActiveSprintIssues: searchCliMock,
		}));

		const searchRestMock = jest.fn();
		(JiraApiClient as jest.Mock).mockImplementation(() => ({
			searchBoardSprintIssues: searchRestMock,
		}));

		const manager = new JiraManager({} as any, makeSettings());
		const section = await manager.queryAndFormatSprint('214', 'GLCP', 'green');

		expect(searchCliMock).toHaveBeenCalledWith('green', 100);
		expect(searchRestMock).not.toHaveBeenCalled();
		expect(section).toContain('# JIRA');
		expect(section).toContain('GLCP-1');
	});

	test('falls back to REST when the CLI throws, and still returns formatted issues', async () => {
		const searchCliMock = jest.fn().mockRejectedValue(new Error('jira CLI exited with code 1: 401 Unauthorized'));
		(JiraCliClient as jest.Mock).mockImplementation(() => ({
			isEnabled: jest.fn().mockReturnValue(true),
			searchActiveSprintIssues: searchCliMock,
		}));

		const searchRestMock = jest.fn().mockResolvedValue([sampleIssue]);
		(JiraApiClient as jest.Mock).mockImplementation(() => ({
			searchBoardSprintIssues: searchRestMock,
		}));

		const manager = new JiraManager({} as any, makeSettings());
		const section = await manager.queryAndFormatSprint('214', 'GLCP', 'green');

		expect(searchCliMock).toHaveBeenCalled();
		expect(searchRestMock).toHaveBeenCalledWith('214', 'green', 100);
		expect(section).toContain('GLCP-1');
	});

	test('skips the CLI entirely and goes straight to REST when jiraCliEnabled is false', async () => {
		const searchCliMock = jest.fn();
		(JiraCliClient as jest.Mock).mockImplementation(() => ({
			isEnabled: jest.fn().mockReturnValue(false),
			searchActiveSprintIssues: searchCliMock,
		}));

		const searchRestMock = jest.fn().mockResolvedValue([sampleIssue]);
		(JiraApiClient as jest.Mock).mockImplementation(() => ({
			searchBoardSprintIssues: searchRestMock,
		}));

		const manager = new JiraManager({} as any, makeSettings({ jiraCliEnabled: false }));
		await manager.queryAndFormatSprint('214', 'GLCP', 'green');

		expect(searchCliMock).not.toHaveBeenCalled();
		expect(searchRestMock).toHaveBeenCalledWith('214', 'green', 100);
	});

	test('returns the existing error-string catch-all when both CLI and REST fail', async () => {
		(JiraCliClient as jest.Mock).mockImplementation(() => ({
			isEnabled: jest.fn().mockReturnValue(true),
			searchActiveSprintIssues: jest.fn().mockRejectedValue(new Error('cli failed')),
		}));
		(JiraApiClient as jest.Mock).mockImplementation(() => ({
			searchBoardSprintIssues: jest.fn().mockRejectedValue(new Error('Request failed, status 401')),
		}));

		const manager = new JiraManager({} as any, makeSettings());
		const section = await manager.queryAndFormatSprint('214', 'GLCP', 'green');

		expect(section).toContain('# JIRA');
		expect(section).toContain('⚠️ Error querying JIRA');
		expect(section).toContain('Request failed, status 401');
	});

	test('returns "no issues found" message when both CLI (disabled) and REST return empty', async () => {
		(JiraCliClient as jest.Mock).mockImplementation(() => ({
			isEnabled: jest.fn().mockReturnValue(false),
			searchActiveSprintIssues: jest.fn(),
		}));
		(JiraApiClient as jest.Mock).mockImplementation(() => ({
			searchBoardSprintIssues: jest.fn().mockResolvedValue([]),
		}));

		const manager = new JiraManager({} as any, makeSettings({ jiraCliEnabled: false }));
		const section = await manager.queryAndFormatSprint('214', 'GLCP', 'green');

		expect(section).toContain('No issues found in active sprint for board 214');
	});
});
