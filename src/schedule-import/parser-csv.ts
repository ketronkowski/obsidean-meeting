/**
 * Parses a Microsoft Exchange/Outlook CSV export into the same
 * `ParsedSchedule` shape that `parseSchedule()` produces from pasted text,
 * so the downstream `ScheduleImportModal` preview/selection step works
 * unchanged.
 *
 * Expected (and tolerated) CSV column headers:
 *   Subject   – meeting title
 *   Start     – datetime in one of two formats:
 *                 ISO-style:          "YYYY-MM-DD HH:MM"
 *                 Natural language:   "today at H[:MM] AM/PM"
 *   End       – same formats as Start
 *   Or use separate Start Date / Start Time and End Date / End Time columns.
 *   Organizer – optional "Last, First" name
 *
 * Rows without a recognisable HH:MM–HH:MM time range (all-day events,
 * multi-day events, rows spanning multiple calendar days, etc.) are
 * surfaced as `unparsed` lines — matching the behaviour of the text-paste
 * parser so the UI can show them for confirmation without creating notes.
 */

import { ParsedScheduleItem, ParsedSchedule, UnparsedLine } from './parser';

const GREEN_STANDUP_TITLE = 'Green Team Daily Meeting';

/** Maps flexible header variations to canonical slot names. */
type Column = 'subject' | 'start' | 'end' | 'startDate' | 'startTime' | 'endDate' | 'endTime' | 'organizer';
type Columns = Partial<Record<Column, number>>;

const HEADER_ALIASES: Partial<Record<string, Column>> = {
	subject: 'subject',
	title: 'subject',
	summary: 'subject',
	name: 'subject',
	start: 'start',
	'start date': 'startDate',
	startdate: 'startDate',
	starttime: 'startTime',
	'start time': 'startTime',
	begin: 'start',
	end: 'end',
	'end date': 'endDate',
	enddate: 'endDate',
	endtime: 'endTime',
	'end time': 'endTime',
	finish: 'end',
	organizer: 'organizer',
	organiser: 'organizer',
	'organized by': 'organizer',
	host: 'organizer',
	owner: 'organizer',
};

/** Converts a 24-hour "HH:MM" string to a 12-hour display form like "11:30 AM". */
function to12Hour(hhmm: string): string {
	const [hStr, mStr] = hhmm.split(':');
	let h = parseInt(hStr, 10);
	const m = mStr ?? '00';
	const period = h >= 12 ? 'PM' : 'AM';
	if (h === 0) h = 12;
	else if (h > 12) h -= 12;
	return `${h}:${m} ${period}`;
}

/**
 * Normalises a natural-language time string ("1 PM", "11:45 AM", "12 AM")
 * to the standard display form ("1:00 PM", "11:45 AM", "12:00 AM").
 */
function normaliseNaturalTime(raw: string): string {
	// Match "H[:MM] AM/PM" — the minutes group is optional
	const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
	if (!m) return raw.trim();
	const hour = m[1];
	const mins = m[2] ?? '00';
	const period = m[3].toUpperCase();
	return `${hour}:${mins} ${period}`;
}

/**
 * Attempts to extract a displayable 12-hour time string from a CSV
 * Start/End cell value. Handles two formats:
 *
 *   ISO-style:          "YYYY-MM-DD HH:MM"  → via to12Hour()
 *   Natural language:   "today at H[:MM] AM/PM"
 *
 * Returns the normalised time string, or `null` if the value cannot be
 * interpreted as a same-day timed event (e.g. "next Tuesday at 12 AM",
 * "August 11th, 2026 at 12 AM" — these are multi-day/cross-day events).
 */
function extractTime(raw: string): string | null {
	const trimmed = raw.trim();

	// ISO format: "YYYY-MM-DD HH:MM"
	const isoMatch = trimmed.match(/^\d{4}-\d{2}-\d{2}\s+(\d{1,2}:\d{2})$/);
	if (isoMatch) return to12Hour(isoMatch[1]);

	// Natural language — only accept "today at ..." references (same-day events).
	// Any other date keyword ("Wednesday", "next Tuesday", "August ...") indicates
	// a different calendar day and should be treated as multi-day / unparsed.
	const todayMatch = trimmed.match(/^today\s+at\s+(.+)$/i);
	if (todayMatch) return normaliseNaturalTime(todayMatch[1]);

	// Non-"today" reference → not a same-day timed event
	return null;
}

/**
 * Returns true for ISO-format rows that look like all-day or multi-day events:
 * - Both Start/End time portions are 00:00 (Exchange all-day sentinel)
 * - Duration spans more than one calendar date
 */
function isIsoAllDayOrMultiDay(startRaw: string, endRaw: string): boolean {
	const startTime = startRaw.trim().split(' ')[1] ?? '';
	const endTime = endRaw.trim().split(' ')[1] ?? '';
	if (startTime === '00:00' && endTime === '00:00') return true;
	const startDate = startRaw.trim().split(' ')[0] ?? '';
	const endDate = endRaw.trim().split(' ')[0] ?? '';
	if (startDate && endDate && startDate !== endDate) return true;
	return false;
}
function splitCsvRow(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			if (inQuotes && line[i + 1] === '"') {
				// Escaped double-quote
				current += '"';
				i++;
			} else {
				inQuotes = !inQuotes;
			}
		} else if (ch === ',' && !inQuotes) {
			fields.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	fields.push(current);
	return fields;
}

function readColumns(header: string): Columns {
	const columns: Columns = {};
	splitCsvRow(header).forEach((value, i) => {
		const key = value.trim().toLowerCase();
		if (!Object.prototype.hasOwnProperty.call(HEADER_ALIASES, key)) return;
		const column = HEADER_ALIASES[key];
		if (column && columns[column] === undefined) columns[column] = i;
	});
	return columns;
}

function hasScheduleColumns(columns: Columns): boolean {
	return columns.subject !== undefined
		&& (columns.start ?? columns.startDate ?? columns.startTime) !== undefined
		&& (columns.end ?? columns.endDate ?? columns.endTime) !== undefined;
}

export function isScheduleCsv(text: string): boolean {
	return hasScheduleColumns(readColumns(text.trimStart().split(/\r?\n/, 1)[0]));
}

function normalizeDate(raw: string): string | undefined {
	const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	const date = us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : raw;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (!isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) return date;
}

function normalizeSplitTime(raw: string): string | undefined {
	const time = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
	if (!time) return;
	const hour = Number(time[1]);
	const minute = Number(time[2]);
	const period = time[3]?.toUpperCase();
	if (minute >= 60 || (period ? hour < 1 || hour > 12 : hour > 23)) return;
	const hour24 = period ? hour % 12 + (period === 'PM' ? 12 : 0) : hour;
	return `${String(hour24).padStart(2, '0')}:${time[2]}`;
}

function readEndpoint(fields: string[], combined?: number, date?: number, time?: number): string {
	const cell = (index?: number) => index === undefined ? '' : (fields[index] ?? '').trim();
	if (date !== undefined && time !== undefined) {
		const day = normalizeDate(cell(date));
		const hhmm = normalizeSplitTime(cell(time));
		return day && hhmm ? `${day} ${hhmm}` : '';
	}
	// Older exports also use Start Date or Start Time to label a combined cell.
	return cell(combined ?? date ?? time);
}

/**
 * Parses a Microsoft Outlook/Exchange CSV export (as exported by Copilot or
 * the Outlook calendar export UI) into the same `ParsedSchedule` structure
 * used by the text-paste parser.
 *
 * @param csvText   Raw text of the CSV file.
 * @param targetDate  The daily-note date in "YYYY-MM-DD" format. When
 *   provided, rows whose start date doesn't match are still included as
 *   candidates (matching text-import behaviour).
 */
export function parseCsvSchedule(csvText: string, _targetDate?: string): ParsedSchedule {
	const items: ParsedScheduleItem[] = [];
	const unparsed: UnparsedLine[] = [];

	const lines = csvText.trimStart().split(/\r?\n/);

	// --- parse header row ---
	const headerRow = lines[0];
	if (!headerRow?.trim()) return { items, unparsed };

	const columns = readColumns(headerRow);

	if (columns.subject === undefined || !hasScheduleColumns(columns)) {
		// Can't map essential columns — treat the whole file as unparsed
		for (let i = 1; i < lines.length; i++) {
			const raw = lines[i].trim();
			if (raw) unparsed.push({ rawLine: raw });
		}
		return { items, unparsed };
	}

	// --- parse data rows ---
	for (let i = 1; i < lines.length; i++) {
		const rawLine = lines[i];
		if (!rawLine?.trim()) continue;

		const fields = splitCsvRow(rawLine);

		const subject = (fields[columns.subject] ?? '').trim();
		const startRaw = readEndpoint(fields, columns.start, columns.startDate, columns.startTime);
		const endRaw = readEndpoint(fields, columns.end, columns.endDate, columns.endTime);
		const organizerRaw = columns.organizer !== undefined
			? (fields[columns.organizer] ?? '').trim()
			: '';

		if (!subject || !startRaw || !endRaw) {
			if (rawLine.trim()) unparsed.push({ rawLine: rawLine.trim() });
			continue;
		}

		// ISO format: check for all-day / multi-day before extracting time
		const isIso = /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}$/.test(startRaw);
		if (isIso && isIsoAllDayOrMultiDay(startRaw, endRaw)) {
			unparsed.push({ rawLine: rawLine.trim() });
			continue;
		}

		// Extract normalised 12-hour times (returns null for non-today / multi-day)
		const startTime = extractTime(startRaw);
		const endTime = extractTime(endRaw);

		if (!startTime || !endTime) {
			// One or both times couldn't be resolved as a same-day timed event
			unparsed.push({ rawLine: rawLine.trim() });
			continue;
		}

		items.push({
			rawLine: rawLine.trim(),
			title: subject,
			startTime,
			endTime,
			organizer: organizerRaw,
			isGreenStandup: subject === GREEN_STANDUP_TITLE,
		});
	}

	return { items, unparsed };
}
