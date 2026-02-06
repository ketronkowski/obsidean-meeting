import { requestUrl } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { JiraIssue } from './client';

/**
 * Direct JIRA REST API client using API token authentication
 */
export class JiraApiClient {
	private settings: MeetingProcessorSettings;

	constructor(settings: MeetingProcessorSettings) {
		this.settings = settings;
	}

	/**
	 * Check if JIRA credentials are configured
	 */
	isConfigured(): boolean {
		return !!(this.settings.jiraEmail && this.settings.jiraApiToken && this.settings.jiraBaseUrl);
	}

	/**
	 * Get Basic Auth header for JIRA API
	 */
	private getAuthHeader(): string {
		const credentials = `${this.settings.jiraEmail}:${this.settings.jiraApiToken}`;
		const encoded = btoa(credentials);
		return `Basic ${encoded}`;
	}

	/**
	 * Query JIRA issues using JQL
	 */
	async searchIssues(jql: string, maxResults: number = 100): Promise<JiraIssue[]> {
		if (!this.isConfigured()) {
			throw new Error('JIRA credentials not configured. Please add email and API token in settings.');
		}

		const url = `${this.settings.jiraBaseUrl}/rest/api/3/search`;
		
		const params = new URLSearchParams({
			jql: jql,
			maxResults: maxResults.toString(),
			fields: 'summary,status,assignee'
		});

		try {
			console.log('Querying JIRA API:', url);
			console.log('JQL:', jql);

			// Use Obsidian's requestUrl to avoid CORS issues
			const response = await requestUrl({
				url: `${url}?${params}`,
				method: 'GET',
				headers: {
					'Authorization': this.getAuthHeader(),
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				}
			});

			if (response.status !== 200) {
				console.error('JIRA API error:', response.status, response.text);
				throw new Error(`JIRA API error (${response.status}): ${response.text}`);
			}

			console.log(`JIRA returned ${response.json.issues?.length || 0} issues`);

			// Transform to our format
			return this.transformIssues(response.json.issues || []);

		} catch (error) {
			console.error('Error querying JIRA:', error);
			throw error;
		}
	}

	/**
	 * Query issues for a specific board's active sprint using Agile API
	 */
	async searchBoardSprintIssues(boardId: string, maxResults: number = 100): Promise<JiraIssue[]> {
		if (!this.isConfigured()) {
			throw new Error('JIRA credentials not configured. Please add email and API token in settings.');
		}

		try {
			// First, get the active sprint for this board
			const sprintUrl = `${this.settings.jiraBaseUrl}/rest/agile/1.0/board/${boardId}/sprint?state=active`;
			
			console.log('Getting active sprint for board:', boardId);
			
			const sprintResponse = await requestUrl({
				url: sprintUrl,
				method: 'GET',
				headers: {
					'Authorization': this.getAuthHeader(),
					'Accept': 'application/json'
				}
			});

			if (sprintResponse.status !== 200) {
				throw new Error(`Failed to get active sprint: ${sprintResponse.status}`);
			}

			const sprints = sprintResponse.json.values || [];
			if (sprints.length === 0) {
				console.log('No active sprint found for board');
				return [];
			}

			const activeSprint = sprints[0];
			console.log('Active sprint:', activeSprint.id, activeSprint.name);

			// Now get issues for this sprint
			const issuesUrl = `${this.settings.jiraBaseUrl}/rest/agile/1.0/board/${boardId}/sprint/${activeSprint.id}/issue`;
			const params = new URLSearchParams({
				maxResults: maxResults.toString(),
				fields: 'summary,status,assignee'
			});

			console.log('Querying sprint issues:', issuesUrl);

			const issuesResponse = await requestUrl({
				url: `${issuesUrl}?${params}`,
				method: 'GET',
				headers: {
					'Authorization': this.getAuthHeader(),
					'Accept': 'application/json'
				}
			});

			if (issuesResponse.status !== 200) {
				throw new Error(`Failed to get sprint issues: ${issuesResponse.status}`);
			}

			console.log(`JIRA returned ${issuesResponse.json.issues?.length || 0} issues`);

			return this.transformIssues(issuesResponse.json.issues || []);

		} catch (error) {
			console.error('Error querying board sprint:', error);
			throw error;
		}
	}

	/**
	 * Transform JIRA API response to our issue format
	 */
	private transformIssues(issues: any[]): JiraIssue[] {
		return issues.map(issue => ({
			key: issue.key,
			summary: issue.fields?.summary || 'No summary',
			status: issue.fields?.status?.name || 'Unknown',
			assignee: issue.fields?.assignee?.accountId || null,
			assigneeDisplayName: issue.fields?.assignee?.displayName || 'Unassigned',
			url: `${this.settings.jiraBaseUrl}/browse/${issue.key}`
		}));
	}

	/**
	 * Test JIRA connection
	 */
	async testConnection(): Promise<boolean> {
		try {
			// Simple test query
			await this.searchIssues('project = ' + this.settings.jiraProjectKey + ' ORDER BY created DESC', 1);
			return true;
		} catch (error) {
			console.error('JIRA connection test failed:', error);
			return false;
		}
	}
}
