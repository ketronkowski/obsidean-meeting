import { CopilotClientManager } from '../copilot-client';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { JiraIssue, groupIssuesByAssignee, JiraIssuesByAssignee } from './client';
import { JiraFormatter } from './formatter';
import { JiraApiClient } from './api-client';

/**
 * Manages JIRA queries using direct API or Copilot CLI fallback
 */
export class JiraManager {
	private copilotClient: CopilotClientManager;
	private settings: MeetingProcessorSettings;
	private formatter: JiraFormatter;
	private apiClient: JiraApiClient;

	constructor(copilotClient: CopilotClientManager, settings: MeetingProcessorSettings) {
		this.copilotClient = copilotClient;
		this.settings = settings;
		this.formatter = new JiraFormatter();
		this.apiClient = new JiraApiClient(settings);
	}

	/**
	 * Query active sprint issues and return formatted JIRA section
	 */
	async queryAndFormatSprint(boardId: string, projectKey: string): Promise<string> {
		try {
			// Use board sprint API instead of JQL (board isn't a valid JQL field)
			const issues = await this.apiClient.searchBoardSprintIssues(boardId, 100);
			console.log(`Found ${issues.length} issues in active sprint`);

			if (issues.length === 0) {
				return `## JIRA\n\nNo issues found in active sprint for board ${boardId}.\n`;
			}

			// Group by assignee
			const grouped = groupIssuesByAssignee(issues);

			// Format as markdown
			return this.formatter.createJiraSection(grouped);

		} catch (error) {
			console.error('Error querying JIRA:', error);
			return `## JIRA\n\n⚠️ Error querying JIRA: ${error.message}\n\nPlease check your JIRA credentials in plugin settings.\n`;
		}
	}
}
