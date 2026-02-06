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

			const response = await fetch(`${url}?${params}`, {
				method: 'GET',
				headers: {
					'Authorization': this.getAuthHeader(),
					'Accept': 'application/json',
					'Content-Type': 'application/json'
				}
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('JIRA API error:', response.status, errorText);
				throw new Error(`JIRA API error (${response.status}): ${errorText}`);
			}

			const data = await response.json();
			console.log(`JIRA returned ${data.issues?.length || 0} issues`);

			// Transform to our format
			return this.transformIssues(data.issues || []);

		} catch (error) {
			console.error('Error querying JIRA:', error);
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
