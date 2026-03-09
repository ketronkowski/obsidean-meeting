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
	 * Update JIRA section by checking boxes and adding notes for mentioned keys
	 */
	updateJiraSection(content: string, mentionedKeys: string[], matches?: JiraKeyMatch[]): string {
		if (mentionedKeys.length === 0) {
			return content;
		}

		console.log(`Marking ${mentionedKeys.length} JIRA items as mentioned`);
		
		let newContent = content;
		const mentionedSet = new Set(mentionedKeys.map(k => k.toUpperCase()));
		
		// Build a map of key -> contexts if matches provided
		const contextMap = new Map<string, string[]>();
		if (matches) {
			for (const match of matches) {
				const key = match.key.toUpperCase();
				if (!contextMap.has(key)) {
					contextMap.set(key, []);
				}
				contextMap.get(key)!.push(match.context);
			}
		}
		
		// Find and update checkboxes in JIRA section
		// Pattern: - [ ] {icon} {statusEmoji} [KEY](url) - summary
		const jiraItemPattern = /^(\s*- \[)([ x])(\] [^\[]*\[)([A-Z]+-\d+)(\]\([^\)]+\)[^\n]*\n?)(\s*- .*\n)*/gm;
		
		newContent = newContent.replace(jiraItemPattern, (match, prefix, checked, middle, key, suffix, existingNotes) => {
			const upperKey = key.toUpperCase();
			
			if (mentionedSet.has(upperKey)) {
				let result = match;
				
				// Check the box if not already checked
				if (checked === ' ') {
					console.log(`Checking box for ${key}`);
					result = prefix + 'x' + middle + key + suffix;
				} else {
					result = prefix + checked + middle + key + suffix;
				}
				
				// Add context notes if available and not already present
				if (contextMap.has(upperKey)) {
					const contexts = contextMap.get(upperKey)!;
					for (const context of contexts) {
						// Clean up the context
						const cleanContext = this.cleanContext(context, key);
						if (cleanContext && cleanContext.length > 10) {
							const note = `\t- ${cleanContext}\n`;
							// Only add if not already in existing notes
							if (!match.includes(cleanContext.substring(0, 30))) {
								result = result.trimEnd() + '\n' + note;
								console.log(`Added note to ${key}: ${cleanContext.substring(0, 50)}...`);
							}
						}
					}
				}
				
				return result;
			}
			return match;
		});
		
		return newContent;
	}
	
	/**
	 * Clean context text for use in a note
	 */
	private cleanContext(context: string, jiraKey: string): string {
		// Remove the JIRA key itself
		let cleaned = context.replace(new RegExp(`\\b${jiraKey}\\b`, 'gi'), '').trim();
		
		// Remove markdown links but keep the text
		cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
		
		// Remove excessive whitespace
		cleaned = cleaned.replace(/\s+/g, ' ').trim();
		
		// Remove common prefixes
		cleaned = cleaned.replace(/^[-*•]\s*/, '');
		
		// Truncate if too long
		if (cleaned.length > 150) {
			cleaned = cleaned.substring(0, 147) + '...';
		}
		
		return cleaned;
	}

	/**
	 * Extract content that should be analyzed for JIRA keys
	 */
	extractRelevantContent(fileContent: string): string {
		let content = '';
		
		// 1. Check for Unified Summary (enhanced workflow)
		const unifiedSummaryMatch = fileContent.match(/# Unified Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (unifiedSummaryMatch && unifiedSummaryMatch[1].trim()) {
			content += unifiedSummaryMatch[1].trim() + '\n\n';
		}
		
		// 2. Check for Copilot Summary
		const copilotSummaryMatch = fileContent.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim()) {
			content += copilotSummaryMatch[1].trim() + '\n\n';
		}
		
		// 3. Check for Transcript Summary (enhanced workflow)
		const transcriptSummaryMatch = fileContent.match(/# Transcript Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (transcriptSummaryMatch && transcriptSummaryMatch[1].trim()) {
			content += transcriptSummaryMatch[1].trim() + '\n\n';
		}
		
		// 4. Include Transcript
		const transcriptMatch = fileContent.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
		if (transcriptMatch && transcriptMatch[1].trim()) {
			content += transcriptMatch[1].trim() + '\n\n';
		}
		
		// 5. Include Summary if present (standard workflow)
		const summaryMatch = fileContent.match(/# Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (summaryMatch && summaryMatch[1].trim()) {
			content += summaryMatch[1].trim();
		}
		
		return content;
	}
}
