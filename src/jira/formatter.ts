import { JiraIssue, JiraIssuesByAssignee } from './client';

/**
 * Format JIRA issues as markdown with checkboxes and status emoji
 */
export class JiraFormatter {
	/**
	 * Get status emoji based on JIRA status name
	 */
	private getStatusEmoji(status: string): string {
		const statusLower = status.toLowerCase();
		
		if (statusLower.includes('done') || statusLower.includes('closed') || statusLower.includes('resolved')) {
			return '✅'; // Done
		} else if (statusLower.includes('progress') || statusLower.includes('development')) {
			return '🟢'; // In Progress
		} else if (statusLower.includes('review') || statusLower.includes('testing')) {
			return '🟡'; // In Review
		} else if (statusLower.includes('blocked')) {
			return '🔴'; // Blocked
		} else {
			return '⚪'; // To Do / Other
		}
	}

	/**
	 * Format a single issue as a checkbox line
	 */
	private formatIssue(issue: JiraIssue): string {
		const emoji = this.getStatusEmoji(issue.status);
		return `- [ ] ${emoji} [${issue.key}](${issue.url}) - ${issue.summary} (${issue.status})`;
	}

	/**
	 * Format grouped issues by assignee
	 */
	formatByAssignee(grouped: JiraIssuesByAssignee): string {
		const lines: string[] = [];

		// Sort assignees alphabetically, with "Unassigned" last
		const assignees = Object.keys(grouped).sort((a, b) => {
			if (a === 'Unassigned') return 1;
			if (b === 'Unassigned') return -1;
			return a.localeCompare(b);
		});

		for (const assignee of assignees) {
			const issues = grouped[assignee];
			
			// Assignee header
			lines.push(`### ${assignee} (${issues.length})`);
			lines.push('');

			// Format each issue
			for (const issue of issues) {
				lines.push(this.formatIssue(issue));
			}

			lines.push('');
		}

		return lines.join('\n');
	}

	/**
	 * Create complete JIRA section for standup
	 */
	createJiraSection(grouped: JiraIssuesByAssignee): string {
		const formattedIssues = this.formatByAssignee(grouped);
		
		return `## JIRA

${formattedIssues}`;
	}
}
