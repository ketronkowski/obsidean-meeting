/**
 * Strip Copilot CLI execution artifacts from generated text.
 *
 * The CLI occasionally includes tool-trace lines in its output:
 *   ● skill(name)
 *   ✗ Step description (shell)
 *   ✓ Step description (shell)
 *     │ command text
 *     └ N lines...
 *   "I have enough context... Let me now generate..."
 *
 * This function removes all such lines, keeping only the actual content.
 */
export function cleanCopilotOutput(raw: string): string {
	let text = raw.trim();

	// Strip everything before the first real content delimiter:
	// either a "---" separator or the first "**Bold**" heading.
	// This removes internal monologue like "I have enough context..."
	const separatorIdx = text.indexOf('\n---\n');
	if (separatorIdx !== -1) {
		text = text.slice(separatorIdx + 5).trim(); // skip past "---\n"
	}

	// Filter line-by-line for CLI artifact patterns
	text = text
		.split('\n')
		.filter(line => {
			const t = line.trim();
			if (!t) return true; // preserve blank lines

			// Tool-call status indicators: ●, ✓, ✗ at line start
			if (/^[●✓✗]/.test(t)) return false;

			// Indented command/output lines: │ or └ (with any leading whitespace)
			if (/^[│└]/.test(t)) return false;

			// CLI pipe-table lines
			if (t.startsWith('| ')) return false;

			// "Placeholder to satisfy..." CLI boilerplate
			if (/placeholder/i.test(t)) return false;

			// CLI status lines emitted by the runner
			if (/^Analyzing meeting/i.test(t)) return false;

			return true;
		})
		.join('\n');

	// Remove markdown headings the AI might have added
	text = text.replace(/^#{1,6}\s+.+\n+/gm, '');

	// Collapse runs of 3+ blank lines down to two
	text = text.replace(/\n{3,}/g, '\n\n');

	return text.trim();
}
