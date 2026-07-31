/**
 * Parses pasted daily-schedule text (copy/pasted from a calendar agenda view)
 * into structured meeting items. Recognized lines look like:
 *
 *   • 2026 July P2P - Daily Sync — 11:00 AM–11:30 AM, organized by Meller, Jonathan. 2
 *
 * All-day events, headings, and any other line that doesn't match this shape
 * (e.g. "There is also an all-day PTO-related event, Ajay PTO, ending today. 1")
 * are never treated as meetings — they are reported back as `unparsed` so the
 * caller can surface them for visual confirmation without creating a note.
 */

export interface ParsedScheduleItem {
	rawLine: string;
	title: string;
	startTime: string;
	endTime: string;
	organizer: string;
	isGreenStandup: boolean;
}

export interface UnparsedLine {
	rawLine: string;
}

export interface ParsedSchedule {
	items: ParsedScheduleItem[];
	unparsed: UnparsedLine[];
}

const GREEN_STANDUP_TITLE = 'Green Team Daily Meeting';

// Bullet character, straight/em/en dash before the title, or nothing at all.
const BULLET_PREFIX = /^[•\-*]\s*/;

// Title — start–end[, organized by Organizer]. [trailing footnote digits]
// Accepts en dash (–) or hyphen (-) as both the title/time separator and the
// time-range separator, and a hyphen or em dash between times.
// An optional parenthetical note (e.g. "(conflicts with the P2P Daily Sync)")
// after the end time is silently discarded. "organized by" is optional —
// newer calendar paste formats omit the organizer entirely.
const MEETING_LINE_PATTERN =
	/^(.+?)\s*[–—-]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[–—-]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*(?:\([^)]*\)\s*)?(?:,\s*organized by\s+(.+?))?\.?\s*\d*\s*$/i;

function stripBullet(line: string): string {
	return line.replace(BULLET_PREFIX, '').trim();
}

export function parseSchedule(text: string): ParsedSchedule {
	const items: ParsedScheduleItem[] = [];
	const unparsed: UnparsedLine[] = [];

	const lines = text.split(/\r?\n/);

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;

		const candidate = stripBullet(trimmed);
		const match = MEETING_LINE_PATTERN.exec(candidate);

		if (!match) {
			unparsed.push({ rawLine: trimmed });
			continue;
		}

		const title = match[1].trim();
		const startTime = match[2].replace(/\s+/g, ' ').trim().toUpperCase();
		const endTime = match[3].replace(/\s+/g, ' ').trim().toUpperCase();
		const organizer = match[4]?.trim() ?? '';

		items.push({
			rawLine: trimmed,
			title,
			startTime,
			endTime,
			organizer,
			isGreenStandup: title === GREEN_STANDUP_TITLE,
		});
	}

	return { items, unparsed };
}
