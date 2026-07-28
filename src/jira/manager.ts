import { CopilotClientManager } from '../copilot-client';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { JiraIssue, groupIssuesByAssignee, JiraIssuesByAssignee } from './client';
import { JiraFormatter } from './formatter';
import { JiraApiClient } from './api-client';
import { JiraCliClient } from './cli-client';

/**
 * Manages JIRA queries. Prefers the `jira` CLI (JiraCliClient, using a shell-captured
 * JIRA_API_TOKEN) when enabled, falling back to the direct REST API (JiraApiClient,
 * using settings.jiraEmail/jiraApiToken Basic Auth) if the CLI is unavailable, fails to
 * auth, or otherwise errors. See plan.md for the full rationale.
 */
export class JiraManager {
	private copilotClient: CopilotClientManager;
	private settings: MeetingProcessorSettings;
	private formatter: JiraFormatter;
	private apiClient: JiraApiClient;
	private cliClient: JiraCliClient;

	constructor(copilotClient: CopilotClientManager, settings: MeetingProcessorSettings) {
		this.copilotClient = copilotClient;
		this.settings = settings;
		this.formatter = new JiraFormatter();
		this.apiClient = new JiraApiClient(settings);
		this.cliClient = new JiraCliClient(settings);
	}

	/**
	 * Query active sprint issues and return formatted JIRA section
	 */
	async queryAndFormatSprint(boardId: string, projectKey: string, teamName?: string): Promise<string> {
		try {
			const issues = await this.getIssues(boardId, projectKey, teamName);
			console.log(`Found ${issues.length} issues in active sprint`);

			if (issues.length === 0) {
				return `# JIRA\n\nNo issues found in active sprint for board ${boardId}.\n`;
			}

			// Group by assignee
			const grouped = groupIssuesByAssignee(issues);

			// Format as markdown
			return this.formatter.createJiraSection(grouped);

		} catch (error) {
			console.error('Error querying JIRA:', error);
			return `# JIRA\n\n⚠️ Error querying JIRA: ${error.message}\n\nPlease check your JIRA credentials in plugin settings.\n`;
		}
	}

	/**
	 * Try the jira CLI first (if enabled), falling back to the direct REST API on any
	 * failure (binary missing, auth failure, timeout, bad JSON, etc.)
	 */
	private async getIssues(boardId: string, _projectKey: string, teamName?: string): Promise<JiraIssue[]> {
		if (this.cliClient.isEnabled()) {
			try {
				// The CLI path scopes to the active sprint of whatever board is configured
				// in the jira CLI's own config (`jira init` / board.id) — there's no CLI
				// flag to pass boardId/projectKey, so neither is used here. See
				// JiraCliClient's class doc comment for why project-scoped JQL was wrong.
				return await this.cliClient.searchActiveSprintIssues(teamName, 100);
			} catch (error) {
				console.warn('jira CLI query failed, falling back to REST API:', error);
			}
		}

		// Use board sprint API instead of JQL (board isn't a valid JQL field)
		return this.apiClient.searchBoardSprintIssues(boardId, teamName, 100);
	}
}
