/**
 * JIRA key extraction and checkbox management
 */

export interface JiraKeyMatch {
	key: string;
	context: string;
}

export class JiraKeyExtractor {
	/**
	 * Extract JIRA keys from content
	 */
	extractKeys(content: string): JiraKeyMatch[] {
		const jiraKeyPattern = /\b([A-Z]+-\d+)\b/g;
		const matches: JiraKeyMatch[] = [];
		const seen = new Set<string>();
		
		let match;
		while ((match = jiraKeyPattern.exec(content)) !== null) {
			const key = match[1];
			if (!seen.has(key)) {
				seen.add(key);
				
				// Get context (50 chars before and after)
				const start = Math.max(0, match.index - 50);
				const end = Math.min(content.length, match.index + key.length + 50);
				const context = content.substring(start, end).trim();
				
				matches.push({ key, context });
			}
		}
		
		console.log(`Extracted ${matches.length} JIRA keys:`, matches.map(m => m.key));
		return matches;
	}

	/**
	 * Update JIRA section by checking boxes for mentioned keys
	 */
	updateJiraSection(content: string, mentionedKeys: string[]): string {
		if (mentionedKeys.length === 0) {
			return content;
		}

		console.log(`Marking ${mentionedKeys.length} JIRA items as mentioned`);
		
		let newContent = content;
		const mentionedSet = new Set(mentionedKeys.map(k => k.toUpperCase()));
		
		// Find and update checkboxes in JIRA section
		// Pattern: - [ ] {icon} {statusEmoji} [KEY](url) - summary
		const jiraItemPattern = /^(\s*- \[)([ x])(\] [^\[]*\[)([A-Z]+-\d+)(\]\([^\)]+\)[^\n]*)/gm;
		
		newContent = newContent.replace(jiraItemPattern, (match, prefix, checked, middle, key, suffix) => {
			if (mentionedSet.has(key.toUpperCase()) && checked === ' ') {
				console.log(`Checking box for ${key}`);
				return prefix + 'x' + middle + key + suffix;
			}
			return match;
		});
		
		return newContent;
	}

	/**
	 * Extract content that should be analyzed for JIRA keys
	 */
	extractRelevantContent(fileContent: string): string {
		let content = '';
		
		// 1. Check for Copilot Summary first
		const copilotSummaryMatch = fileContent.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim()) {
			content += copilotSummaryMatch[1].trim() + '\n\n';
		}
		
		// 2. Include Transcript
		const transcriptMatch = fileContent.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
		if (transcriptMatch && transcriptMatch[1].trim()) {
			content += transcriptMatch[1].trim() + '\n\n';
		}
		
		// 3. Include Summary if present
		const summaryMatch = fileContent.match(/# Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (summaryMatch && summaryMatch[1].trim()) {
			content += summaryMatch[1].trim();
		}
		
		return content;
	}
}
