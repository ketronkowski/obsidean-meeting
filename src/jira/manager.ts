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
	 * Get Atlassian cloud ID using Copilot
	 */
	private async getCloudId(): Promise<string> {
		const prompt = `Use the Atlassian MCP getAccessibleAtlassianResources tool to get my cloud ID. 
Return ONLY the cloud ID string, nothing else. For example, if the cloud is hpe.atlassian.net, return "hpe".`;

		const response = await this.copilotClient.sendPrompt(prompt);
		const cleaned = response.trim().replace(/['"]/g, '');
		
		// If response looks like a cloud ID, use it, otherwise default to 'hpe'
		if (cleaned.length < 50 && !cleaned.includes(' ')) {
			return cleaned;
		}
		
		// Default fallback
		console.warn('Could not parse cloud ID from response, using default "hpe"');
		return 'hpe';
	}

	/**
	 * Query JIRA issues using Copilot SDK with Atlassian MCP
	 */
	private async queryJiraIssues(cloudId: string, jql: string): Promise<JiraIssue[]> {
		// Ask Copilot to use the Atlassian MCP searchJiraIssuesUsingJql tool
		const prompt = `Use the Atlassian MCP searchJiraIssuesUsingJql tool with these parameters:
- cloudId: "${cloudId}"
- jql: "${jql}"
- fields: ["summary", "status", "assignee"]
- maxResults: 100

For each issue in the results, extract and format as JSON:
- key: the issue key (e.g., "GLCP-12345")
- summary: the issue summary/title
- status: the status name (e.g., "In Progress", "To Do")
- assignee: the assignee display name (or "Unassigned" if null)

Return ONLY a valid JSON array of issues, nothing else. Example:
[{"key":"GLCP-123","summary":"Fix bug","status":"In Progress","assignee":"John Smith"}]`;

		try {
			const response = await this.copilotClient.sendPrompt(prompt);
			
			// Try to extract JSON from the response
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
