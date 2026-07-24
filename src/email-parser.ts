/**
 * Parses email participants from Obsidian email chain note content.
 *
 * Handles Outlook-style headers as rendered in Obsidian markdown:
 *   **From:** Last, First <[email@hpe.com](mailto:email@hpe.com)>
 *   **To:** Last, First <[email@hpe.com](mailto:email@hpe.com)>; Last2, First2 <...>
 *   **Cc:** Display Name <[email@hpe.com](mailto:email@hpe.com)>
 */

export interface EmailParticipant {
	/** "First Last" — display name for wiki links */
	displayName: string;
	/** "Last, First" — used as People profile filename */
	mailboxName: string;
	/** HPE email address */
	email: string;
}

/**
 * Parse all unique HPE participants from the Email Chain section content.
 * Filters to @hpe.com addresses only and skips group/alias mailboxes
 * (display names without a comma are treated as non-personal).
 */
export function parseEmailParticipants(emailChainContent: string): EmailParticipant[] {
	const seen = new Map<string, EmailParticipant>(); // keyed by lowercase email

	// Match From/To/Cc header lines (case-insensitive)
	const headerLinePattern = /^\*\*(From|To|Cc):\*\*\s+(.+?)(?:\s{2,}|\s*$)/gim;
	let headerMatch: RegExpExecArray | null;

	while ((headerMatch = headerLinePattern.exec(emailChainContent)) !== null) {
		const field = headerMatch[1].toLowerCase();
		if (field !== 'from' && field !== 'to' && field !== 'cc') continue;

		const value = headerMatch[2];
		extractEntriesFromField(value, seen);
	}

	return Array.from(seen.values());
}

/**
 * Extract individual participants from a header field value.
 * Entries are separated by `;` and may be in either:
 *   - Markdown link format: `Last, First <[email@hpe.com](mailto:email@hpe.com)>`
 *   - Plain format: `Last, First <email@hpe.com>`
 */
function extractEntriesFromField(
	fieldValue: string,
	seen: Map<string, EmailParticipant>
): void {
	// Split by "; " to separate multiple recipients
	const entries = fieldValue.split(/;\s*/);

	for (const entry of entries) {
		const trimmed = entry.trim();
		if (!trimmed) continue;

		// Try markdown link format first: Name <[email](mailto:email)>
		const mdMatch = trimmed.match(/^([^<]+?)\s*<\[([^\]]+)\]\([^)]*\)>\s*$/);
		if (mdMatch) {
			const displayName = mdMatch[1].trim();
			const email = mdMatch[2].trim();
			addParticipant(displayName, email, seen);
			continue;
		}

		// Fall back to plain format: Name <email@domain>
		const plainMatch = trimmed.match(/^([^<]+?)\s*<([^>@\s]+@[^>\s]+)>\s*$/);
		if (plainMatch) {
			const displayName = plainMatch[1].trim();
			const email = plainMatch[2].trim();
			addParticipant(displayName, email, seen);
		}
	}
}

function addParticipant(
	rawName: string,
	email: string,
	seen: Map<string, EmailParticipant>
): void {
	const emailKey = email.toLowerCase();

	// HPE only
	if (!emailKey.endsWith('@hpe.com')) return;

	// Skip if already seen
	if (seen.has(emailKey)) return;

	// Personal name heuristic: HPE personal mailboxes use "Last, First" (contains comma).
	// Group/alias mailboxes (e.g. "GL Platform Services Support") have no comma.
	if (!rawName.includes(',')) return;

	const participant: EmailParticipant = {
		displayName: parseLastFirst(rawName),
		mailboxName: rawName.replace(/\s+/g, ' ').trim(),
		email,
	};

	seen.set(emailKey, participant);
}

/**
 * Convert "Last, First" to "First Last".
 * "Tronkowski, Kevin" → "Kevin Tronkowski"
 */
export function parseLastFirst(name: string): string {
	const commaIdx = name.indexOf(',');
	if (commaIdx === -1) return name.trim();
	const last = name.slice(0, commaIdx).trim();
	const first = name.slice(commaIdx + 1).trim();
	return first ? `${first} ${last}` : last;
}
