import { CopilotClientManager } from '../copilot-client';
import { JiraIssue, transformJiraIssues, groupIssuesByAssignee, JiraIssuesByAssignee } from './client';
import { JiraFormatter } from './formatter';

/**
 * Manages JIRA queries using Copilot SDK with Atlassian MCP
 */
export class JiraManager {
	private copilotClient: CopilotClientManager;
	private formatter: JiraFormatter;

	constructor(copilotClient: CopilotClientManager) {
		this.copilotClient = copilotClient;
		this.formatter = new JiraFormatter();
	}

	/**
	 * Query active sprint issues and return formatted JIRA section
	 */
	async queryAndFormatSprint(boardId: string, projectKey: string): Promise<string> {
		try {
			// First, get the cloud ID
			const cloudId = await this.getCloudId();
			console.log('Using Atlassian cloud ID:', cloudId);

			// Build JQL query
			const jql = `project = ${projectKey} AND sprint in openSprints() AND board = ${boardId} ORDER BY assignee, status`;
			
			// Query issues through Copilot (which has access to Atlassian MCP)
			const issues = await this.queryJiraIssues(cloudId, jql);
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
			return `## JIRA\n\n⚠️ Error querying JIRA: ${error.message}\n`;
		}
	}

	/**
	 * Get Atlassian cloud ID using Copilot CLI
	 */
	private async getCloudId(): Promise<string> {
		try {
			const response = await this.copilotClient.queryJiraWithCLI(
				'hpe', // Try with default first
				'project = GLCP AND resolution = Unresolved ORDER BY created DESC' // Simple test query
			);
			
			// If it works, we know 'hpe' is correct
			return 'hpe';
		} catch (error) {
			console.warn('Could not verify cloud ID, using default "hpe"');
			return 'hpe';
		}
	}

	/**
	 * Query JIRA issues using Copilot CLI with Atlassian MCP
	 */
	private async queryJiraIssues(cloudId: string, jql: string): Promise<JiraIssue[]> {
		try {
			const response = await this.copilotClient.queryJiraWithCLI(cloudId, jql);
			
			// Parse the response
			const issues = this.parseJiraResponse(response, cloudId);
			return issues;

		} catch (error) {
			console.error('Error querying JIRA issues:', error);
			throw error;
		}
	}

	/**
	 * Parse Copilot's response to extract JIRA issues
	 */
	private parseJiraResponse(response: string, cloudId: string): JiraIssue[] {
		try {
			// Remove markdown code fences if present
			let cleaned = response.trim();
			cleaned = cleaned.replace(/^```json\s*/,'' );
			cleaned = cleaned.replace(/^```\s*/, '');
			cleaned = cleaned.replace(/\s*```$/, '');
			cleaned = cleaned.trim();

			// Try to find JSON array in the response
			const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
			if (arrayMatch) {
				const parsed = JSON.parse(arrayMatch[0]);
				
				if (Array.isArray(parsed)) {
					// Convert to our JiraIssue format
					return parsed.map(item => ({
						key: item.key || 'UNKNOWN',
						summary: item.summary || 'No summary',
						status: item.status || 'Unknown',
						assignee: null, // Not needed for display
						assigneeDisplayName: item.assignee || 'Unassigned',
						url: `https://hpe.atlassian.net/browse/${item.key}`
					}));
				}
			}

			console.warn('Could not parse JSON from response:', cleaned);
			return [];

		} catch (error) {
			console.error('Error parsing JIRA response:', error);
			console.log('Response was:', response);
			return [];
		}
	}
}
