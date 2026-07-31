import { parseCsvSchedule } from '../schedule-import/parser-csv';

// Sample matching the real Exchange CSV format from the example file.
const SAMPLE_CSV = `Subject,Start,End,Organizer
Mark PTO,2026-07-31 00:00,2026-08-11 00:00,"Vilrokx, Mark"
2026 July P2P - Session 2,2026-07-30 23:00,2026-07-31 02:00,"Meller, Jonathan"
M&T Bank,2026-07-31 10:00,2026-07-31 11:00,"Tronkowski, Kevin"
2026 July P2P - Daily Sync,2026-07-31 11:30,2026-07-31 12:00,"Meller, Jonathan"
SIC Weekly Program Meeting,2026-07-31 11:30,2026-07-31 11:55,"Piddington, Ila"
2026 July P2P - Session 3 (Mission Critical),2026-07-31 12:00,2026-07-31 16:00,"Meller, Jonathan"
GLRP-12009 - Aruba Switches/SIC Integration- Not Managed by Aruba Central,2026-07-31 12:00,2026-07-31 12:55,"Piddington, Ila"
Stella's staff meeting (new series),2026-07-31 12:00,2026-07-31 12:30,"Yun, Stella"
Platform 3.0 bug squashing,2026-07-31 13:00,2026-07-31 13:30,"Brahmandam, Sailaja"
Green Team Daily Meeting,2026-07-31 13:00,2026-07-31 13:55,"Piddington, Ila"
Green and Magenta Design Discussion,2026-07-31 15:00,2026-07-31 16:00,"Bennett, Ryan"`;

describe('parseCsvSchedule', () => {
	test('parses 9 meeting items from the sample CSV (all-day + multi-day become unparsed)', () => {
		const { items, unparsed } = parseCsvSchedule(SAMPLE_CSV, '2026-07-31');
		// Mark PTO (all-day, multi-day) and Session 2 (cross-midnight) → unparsed
		// Remaining 9 rows → items
		expect(items).toHaveLength(9);
		expect(unparsed).toHaveLength(2);
	});

	test('extracts title, 12-hour start/end times, and organizer from a standard row', () => {
		const { items } = parseCsvSchedule(SAMPLE_CSV, '2026-07-31');
		const daily = items.find(i => i.title === '2026 July P2P - Daily Sync');
		expect(daily).toBeDefined();
		expect(daily!.startTime).toBe('11:30 AM');
		expect(daily!.endTime).toBe('12:00 PM');
		expect(daily!.organizer).toBe('Meller, Jonathan');
		expect(daily!.isGreenStandup).toBe(false);
	});

	test('detects Green Team Daily Meeting as Green Standup', () => {
		const { items } = parseCsvSchedule(SAMPLE_CSV, '2026-07-31');
		const green = items.find(i => i.title === 'Green Team Daily Meeting');
		expect(green).toBeDefined();
		expect(green!.isGreenStandup).toBe(true);
	});

	test('preserves parenthetical in title when not preceded by a time separator', () => {
		const { items } = parseCsvSchedule(SAMPLE_CSV, '2026-07-31');
		expect(items.find(i => i.title === '2026 July P2P - Session 3 (Mission Critical)')).toBeDefined();
		expect(items.find(i => i.title === "Stella's staff meeting (new series)")).toBeDefined();
	});

	test('preserves special characters in title (ampersand, slash, hyphen)', () => {
		const { items } = parseCsvSchedule(SAMPLE_CSV, '2026-07-31');
		expect(items.find(i => i.title === 'M&T Bank')).toBeDefined();
		expect(items.find(i => i.title.includes('GLRP-12009'))).toBeDefined();
	});

	test('treats all-day event (00:00 start AND 00:00 end on different dates) as unparsed', () => {
		const csv = `Subject,Start,End,Organizer\nMark PTO,2026-07-31 00:00,2026-08-11 00:00,"Vilrokx, Mark"`;
		const { items, unparsed } = parseCsvSchedule(csv);
		expect(items).toHaveLength(0);
		expect(unparsed).toHaveLength(1);
		expect(unparsed[0].rawLine).toContain('Mark PTO');
	});

	test('treats multi-day events (different start and end calendar dates) as unparsed', () => {
		// Session 2 starts the previous day (2026-07-30) and ends on 2026-07-31
		const csv = `Subject,Start,End,Organizer\n2026 July P2P - Session 2,2026-07-30 23:00,2026-07-31 02:00,"Meller, Jonathan"`;
		const { items, unparsed } = parseCsvSchedule(csv);
		expect(items).toHaveLength(0);
		expect(unparsed).toHaveLength(1);
	});

	test('handles missing Organizer column gracefully', () => {
		const csv = `Subject,Start,End\nDaily Standup,2026-07-31 09:00,2026-07-31 09:30`;
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
		expect(items[0].organizer).toBe('');
	});

	test('converts 24-hour times to 12-hour format correctly', () => {
		const csv = `Subject,Start,End\nMorning Sync,2026-07-31 08:00,2026-07-31 08:30\nAfternoon Review,2026-07-31 13:00,2026-07-31 13:30\nNoon Meeting,2026-07-31 12:00,2026-07-31 12:30`;
		const { items } = parseCsvSchedule(csv);
		const morning = items.find(i => i.title === 'Morning Sync');
		expect(morning!.startTime).toBe('8:00 AM');
		expect(morning!.endTime).toBe('8:30 AM');
		const afternoon = items.find(i => i.title === 'Afternoon Review');
		expect(afternoon!.startTime).toBe('1:00 PM');
		expect(afternoon!.endTime).toBe('1:30 PM');
		const noon = items.find(i => i.title === 'Noon Meeting');
		expect(noon!.startTime).toBe('12:00 PM');
		expect(noon!.endTime).toBe('12:30 PM');
	});

	test('tolerant header matching: case and alias variants', () => {
		const csv = `SUBJECT,START DATE,END DATE\nDaily Standup,2026-07-31 09:00,2026-07-31 09:30`;
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Daily Standup');
	});

	test('tolerant header matching: "Title" as a subject alias', () => {
		const csv = `Title,Start,End\nTeam Review,2026-07-31 14:00,2026-07-31 14:30`;
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Team Review');
	});

	test('tolerant header matching: "Organiser" (British spelling) as organizer alias', () => {
		const csv = `Subject,Start,End,Organiser\nSync,2026-07-31 10:00,2026-07-31 10:30,"Smith, John"`;
		const { items } = parseCsvSchedule(csv);
		expect(items[0].organizer).toBe('Smith, John');
	});

	test('skips blank lines without error', () => {
		const csv = `Subject,Start,End\n\nDaily Standup,2026-07-31 09:00,2026-07-31 09:30\n\n`;
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
	});

	test('returns empty for CSV with unrecognised headers', () => {
		const csv = `WhenStart,WhenEnd,EventName\n2026-07-31 09:00,2026-07-31 09:30,Standup`;
		const { items, unparsed } = parseCsvSchedule(csv);
		// No parseable items but the data row surfaces as unparsed
		expect(items).toHaveLength(0);
		expect(unparsed).toHaveLength(1);
	});

	test('handles quoted fields with embedded commas correctly', () => {
		const csv = `Subject,Start,End,Organizer\n"Meeting, Special Edition",2026-07-31 10:00,2026-07-31 10:30,"Last, First"`;
		const { items } = parseCsvSchedule(csv);
		expect(items[0].title).toBe('Meeting, Special Edition');
		expect(items[0].organizer).toBe('Last, First');
	});

	test('handles Windows-style CRLF line endings', () => {
		const csv = `Subject,Start,End\r\nDaily Standup,2026-07-31 09:00,2026-07-31 09:30\r\n`;
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
	});

	test('midnight 00:00 start AND end on the SAME date is NOT treated as all-day', () => {
		// This would be an unusual but technically valid midnight meeting
		const csv = `Subject,Start,End\nMidnight Event,2026-07-31 00:00,2026-07-31 00:30`;
		// The function checks both times being 00:00; end is 00:30 so this is not all-day
		const { items } = parseCsvSchedule(csv);
		expect(items).toHaveLength(1);
		expect(items[0].startTime).toBe('12:00 AM');
		expect(items[0].endTime).toBe('12:30 AM');
	});
});

// ---------------------------------------------------------------------------
// Natural-language "today at ..." format (newer Copilot-generated CSV variant)
// ---------------------------------------------------------------------------

const NATURAL_LANG_CSV = `Subject,Start,End,Organizer
Mark PTO,Wednesday at 12 AM,"August 11th, 2026 at 12 AM","Vilrokx, Mark"
Kashish-OOO,today at 12 AM,next Tuesday at 12 AM,"Pahwa, Kashish"
Workout,today at 11 AM,today at 11:45 AM,"Tronkowski, Kevin"
Platform 3.0 bug squashing,today at 1 PM,today at 1:30 PM,"Brahmandam, Sailaja"
Green Team Daily Meeting,today at 1 PM,today at 1:55 PM,"Piddington, Ila"
Green Team Backlog Refinement,today at 3 PM,today at 3:55 PM,"Piddington, Ila"`;

describe('parseCsvSchedule — natural language "today at ..." format', () => {
	test('parses 4 timed meetings; multi-day and non-today rows become unparsed', () => {
		const { items, unparsed } = parseCsvSchedule(NATURAL_LANG_CSV);
		// Mark PTO (Wednesday at...) and Kashish-OOO (next Tuesday end) → unparsed
		expect(items).toHaveLength(4);
		expect(unparsed).toHaveLength(2);
	});

	test('extracts title, 12-hour times, and organizer from "today at H AM/PM" rows', () => {
		const { items } = parseCsvSchedule(NATURAL_LANG_CSV);
		const workout = items.find(i => i.title === 'Workout');
		expect(workout).toBeDefined();
		expect(workout!.startTime).toBe('11:00 AM');
		expect(workout!.endTime).toBe('11:45 AM');
		expect(workout!.organizer).toBe('Tronkowski, Kevin');
	});

	test('handles "today at 1 PM" (no minutes) → normalised to "1:00 PM"', () => {
		const { items } = parseCsvSchedule(NATURAL_LANG_CSV);
		const platform = items.find(i => i.title === 'Platform 3.0 bug squashing');
		expect(platform!.startTime).toBe('1:00 PM');
		expect(platform!.endTime).toBe('1:30 PM');
	});

	test('detects Green Team Daily Meeting as Green Standup', () => {
		const { items } = parseCsvSchedule(NATURAL_LANG_CSV);
		const green = items.find(i => i.title === 'Green Team Daily Meeting');
		expect(green).toBeDefined();
		expect(green!.isGreenStandup).toBe(true);
	});

	test('treats "Wednesday at 12 AM" (non-today start) as unparsed', () => {
		const { unparsed } = parseCsvSchedule(NATURAL_LANG_CSV);
		expect(unparsed.some(u => u.rawLine.includes('Mark PTO'))).toBe(true);
	});

	test('treats event with non-today end date ("next Tuesday at 12 AM") as unparsed', () => {
		const { unparsed } = parseCsvSchedule(NATURAL_LANG_CSV);
		expect(unparsed.some(u => u.rawLine.includes('Kashish-OOO'))).toBe(true);
	});

	test('handles "today at 12 AM" (midnight) → "12:00 AM"', () => {
		const csv = `Subject,Start,End\nMidnight Call,today at 12 AM,today at 12:30 AM`;
		const { items } = parseCsvSchedule(csv);
		expect(items[0].startTime).toBe('12:00 AM');
		expect(items[0].endTime).toBe('12:30 AM');
	});

	test('handles "today at 12 PM" (noon) → "12:00 PM"', () => {
		const csv = `Subject,Start,End\nNoon Sync,today at 12 PM,today at 12:30 PM`;
		const { items } = parseCsvSchedule(csv);
		expect(items[0].startTime).toBe('12:00 PM');
		expect(items[0].endTime).toBe('12:30 PM');
	});
});
