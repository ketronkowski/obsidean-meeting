/**
 * Sanitizes a parsed meeting title into a safe filename fragment for
 * `Meetings/{date} - {sanitized}.md`.
 *
 * Obsidian treats "/" as a folder separator, so a title like "Kevin/Ila 1-1"
 * must not be allowed to create a subfolder (see the vault's existing
 * "Royce 1on1.md" precedent for working around this exact issue by hand).
 * Other filesystem-illegal characters are also replaced.
 */
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeMeetingTitle(title: string): string {
	let sanitized = title
		.trim()
		.replace(ILLEGAL_CHARS, '-')
		.replace(/\s+/g, ' ')
		.replace(/(-\s*)-+/g, '-')
		.replace(/(-\s)(-\s)+/g, '$1')
		.replace(/-{2,}/g, '-')
		.trim()
		.replace(/^[-\s]+|[-\s]+$/g, '');

	if (!sanitized) {
		// Fallback mirrors the existing "New Meeting" button's un-renamed
		// default (a Unix timestamp), flagged by the caller for manual rename.
		sanitized = `${Math.floor(Date.now() / 1000)}`;
	}

	return sanitized;
}

/** True if the title needed to fall back to a timestamp (i.e. was unusable as-is). */
export function isFallbackTitle(sanitized: string): boolean {
	return /^\d{10}$/.test(sanitized);
}
