/**
 * JIRA client for querying issues via Atlassian MCP
 * 
 * NOTE: This uses Atlassian MCP server tools that should be available
 * in the Obsidian environment. The actual tool calling happens through
 * the GitHub Copilot SDK which has access to MCP servers.
 */

export interface JiraIssue {
	key: string;
	summary: string;
	status: string;
	assignee: string | null;
	assigneeDisplayName: string | null;
	url: string;
}

export interface JiraIssuesByAssignee {
	[assignee: string]: JiraIssue[];
}

/**
 * Query active sprint issues for a board
 * 
 * This method prepares the JQL query. The actual execution needs to happen
 * via the Copilot SDK which can call Atlassian MCP tools.
 */
export function buildActiveSprintJql(boardId: string, projectKey: string): string {
	return `project = ${projectKey} AND sprint in openSprints() AND board = ${boardId} ORDER BY assignee, status`;
}

/**
 * Transform raw JIRA API response to our issue format
 */
export function transformJiraIssues(issues: any[], cloudId: string): JiraIssue[] {
	if (!issues || !Array.isArray(issues)) {
		return [];
	}

	return issues.map((issue: any) => ({
		key: issue.key,
		summary: issue.fields?.summary || 'No summary',
		status: issue.fields?.status?.name || 'Unknown',
		assignee: issue.fields?.assignee?.accountId || null,
		assigneeDisplayName: issue.fields?.assignee?.displayName || 'Unassigned',
		url: `https://hpe.atlassian.net/browse/${issue.key}`
	}));
}

/**
 * Group issues by assignee
 */
export function groupIssuesByAssignee(issues: JiraIssue[]): JiraIssuesByAssignee {
	const grouped: JiraIssuesByAssignee = {};

	for (const issue of issues) {
		const assignee = issue.assigneeDisplayName || 'Unassigned';
		if (!grouped[assignee]) {
			grouped[assignee] = [];
		}
		grouped[assignee].push(issue);
	}

	return grouped;
}
