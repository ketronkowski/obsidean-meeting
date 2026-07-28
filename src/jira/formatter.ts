import { JiraIssue, JiraIssuesByAssignee } from './client';

/**
 * Format JIRA issues as markdown with checkboxes, issue type icons, and status emoji
 */
export class JiraFormatter {
	/**
	 * Get issue type icon
	 */
	private getIssueTypeIcon(issueType: string): string {
		const typeLower = issueType.toLowerCase();
		
		if (typeLower.includes('story')) {
			return '📋';
		} else if (typeLower.includes('bug')) {
			return '🐛';
		} else if (typeLower.includes('task')) {
			return '☑️'; // Changed from ✅ to avoid conflict with Done status
		} else if (typeLower.includes('epic')) {
			return '🎯';
		} else if (typeLower.includes('subtask') || typeLower.includes('sub-task')) {
			return '📝';
		} else {
			return '📌'; // Default for unknown types
		}
	}

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
			return '🔵'; // To Do / Other (changed from ⚪ for better visibility)
		}
	}

	/**
	 * Format a single issue as a checkbox line
	 */
	private formatIssue(issue: JiraIssue): string {
		const typeIcon = this.getIssueTypeIcon(issue.issueType);
		const statusEmoji = this.getStatusEmoji(issue.status);
		return `- [ ] ${typeIcon} ${statusEmoji} [${issue.key}](${issue.url}) - ${issue.summary} (${issue.status})`;
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
	 * Build the legend explaining the issue-type icons and status emoji used below
	 */
	private buildKey(): string {
		return [
			'**Key:** 📋 Story · 🐛 Bug · ☑️ Task · 🎯 Epic · 📝 Subtask · 📌 Other  |  ✅ Done · 🟢 In Progress · 🟡 In Review · 🔴 Blocked · 🔵 To Do / Other',
			'',
		].join('\n');
	}

	/**
	 * Create complete JIRA section for standup
	 */
	createJiraSection(grouped: JiraIssuesByAssignee): string {
		const formattedIssues = this.formatByAssignee(grouped);

		return `# JIRA

${this.buildKey()}
${formattedIssues}`;
	}
}
