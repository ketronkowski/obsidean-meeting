import { parseSchedule } from '../schedule-import/parser';

// New format: no "organized by", section headers, parenthetical conflict notes,
// irregular "ended at" entries, and all-day/multi-day events.
const NEW_FORMAT_TEXT = `Upcoming / current meetings
\t\u2022\t2026 July P2P - Daily Sync \u2014 11:30 AM\u201312:00 PM. 3
\t\u2022\tSIC Weekly Program Meeting \u2014 11:30 AM\u201311:55 AM (conflicts with the P2P Daily Sync). 4
\t\u2022\t2026 July P2P - Session 3 (Mission Critical) \u2014 12:00 PM\u20134:00 PM. 5
\t\u2022\tGLRP-12009 - Aruba Switches/SIC Integration- Not Managed by Aruba Central \u2014 12:00 PM\u201312:55 PM. 6
\t\u2022\tStella's staff meeting (new series) \u2014 12:00 PM\u201312:30 PM. 7
\t\u2022\tPlatform 3.0 bug squashing \u2014 1:00 PM\u20131:30 PM. 8
\t\u2022\tGreen Team Daily Meeting \u2014 1:00 PM\u20131:55 PM. 9
\t\u2022\tGreen and Magenta Design Discussion \u2014 3:00 PM\u20134:00 PM. 10
Already past today
\t\u2022\tM&T Bank \u2014 10:00 AM\u201311:00 AM. 11
\t\u2022\t2026 July P2P - Session 2 ended at 2:00 AM today. 2
All-day / multi-day
\t\u2022\tMark PTO is currently in progress and runs through August 11, 2026. 1`;

const SAMPLE_TEXT = `Today's schedule
\u2022\t2026 July P2P - Daily Sync \u2014 11:00 AM\u201311:30 AM, organized by Meller, Jonathan. 2
\u2022\t Platform 3.0 - Weekly Program Meeting \u2014 12:00 PM\u201312:30 PM, organized by Gopalan, Ramachandran. 3
\u2022\t EPIC Dashboard Approach \u2014 12:30 PM\u20131:00 PM, organized by Tronkowski, Kevin. 4
\u2022\t Green Team Daily Meeting \u2014 1:00 PM\u20131:55 PM, organized by Piddington, Ila. 5
\u2022\t Kevin/Ila 1-1 \u2014 3:30 PM\u20133:55 PM, organized by Piddington, Ila. 6
\u2022\t SIC write use cases \u2014 4:30 PM\u20135:00 PM, organized by Pahwa, Kashish. 7
There is also an all-day PTO-related event, Ajay PTO, ending today. 1`;

describe('parseSchedule', () => {
	test('parses all six real meeting bullet lines from the sample schedule', () => {
		const { items } = parseSchedule(SAMPLE_TEXT);
		expect(items).toHaveLength(6);
	});

	test('extracts title, times, and organizer for a simple meeting', () => {
		const { items } = parseSchedule(SAMPLE_TEXT);
		const daily = items.find(i => i.title === '2026 July P2P - Daily Sync');
		expect(daily).toBeDefined();
		expect(daily!.startTime).toBe('11:00 AM');
		expect(daily!.endTime).toBe('11:30 AM');
		expect(daily!.organizer).toBe('Meller, Jonathan');
		expect(daily!.isGreenStandup).toBe(false);
	});

	test('preserves internal hyphens in titles like "Platform 3.0 - Weekly Program Meeting"', () => {
		const { items } = parseSchedule(SAMPLE_TEXT);
		const item = items.find(i => i.title === 'Platform 3.0 - Weekly Program Meeting');
		expect(item).toBeDefined();
		expect(item!.organizer).toBe('Gopalan, Ramachandran');
	});

	test('preserves slash in title "Kevin/Ila 1-1"', () => {
		const { items } = parseSchedule(SAMPLE_TEXT);
		const item = items.find(i => i.title === 'Kevin/Ila 1-1');
		expect(item).toBeDefined();
		expect(item!.organizer).toBe('Piddington, Ila');
	});

	test('detects exact-match "Green Team Daily Meeting" as Green Standup', () => {
		const { items } = parseSchedule(SAMPLE_TEXT);
		const green = items.find(i => i.title === 'Green Team Daily Meeting');
		expect(green).toBeDefined();
		expect(green!.isGreenStandup).toBe(true);
	});

	test('does not flag a similarly-named but non-exact title as Green Standup', () => {
		const { items } = parseSchedule('Green Team Planning \u2014 9:00 AM\u20139:30 AM, organized by Piddington, Ila.');
		expect(items[0].isGreenStandup).toBe(false);
	});

	test('excludes the all-day PTO line and the heading line as unparsed, not as meetings', () => {
		const { items, unparsed } = parseSchedule(SAMPLE_TEXT);
		expect(items.some(i => i.title.includes('PTO'))).toBe(false);
		const unparsedText = unparsed.map(u => u.rawLine).join(' | ');
		expect(unparsedText).toContain('all-day PTO-related event');
		expect(unparsedText).toContain("Today's schedule");
	});

	test('ignores blank lines entirely (not counted as unparsed)', () => {
		const { unparsed } = parseSchedule('\n\nGreen Team Daily Meeting \u2014 1:00 PM\u20131:55 PM, organized by Piddington, Ila.\n\n');
		expect(unparsed).toHaveLength(0);
	});

	test('handles a straight-hyphen dash variant', () => {
		const { items } = parseSchedule('Kevin/Ila 1-1 - 3:30 PM-3:55 PM, organized by Piddington, Ila.');
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Kevin/Ila 1-1');
	});

	test('strips trailing footnote-style digit without dropping the organizer name', () => {
		const { items } = parseSchedule('SIC write use cases \u2014 4:30 PM\u20135:00 PM, organized by Pahwa, Kashish. 7');
		expect(items[0].organizer).toBe('Pahwa, Kashish');
	});
});

describe('parseSchedule — new format (no "organized by", section headers, conflict notes)', () => {
	test('parses all 9 meeting bullet lines (8 upcoming + 1 past)', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		expect(items).toHaveLength(9);
	});

	test('sets organizer to empty string when absent', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		expect(items.every(i => i.organizer === '')).toBe(true);
	});

	test('extracts title and times for a simple no-organizer line', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		const item = items.find(i => i.title === '2026 July P2P - Daily Sync');
		expect(item).toBeDefined();
		expect(item!.startTime).toBe('11:30 AM');
		expect(item!.endTime).toBe('12:00 PM');
	});

	test('strips parenthetical conflict note from after the end time', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		const item = items.find(i => i.title === 'SIC Weekly Program Meeting');
		expect(item).toBeDefined();
		expect(item!.startTime).toBe('11:30 AM');
		expect(item!.endTime).toBe('11:55 AM');
	});

	test('preserves parenthetical in title when it appears before the em dash', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		expect(items.find(i => i.title === '2026 July P2P - Session 3 (Mission Critical)')).toBeDefined();
		expect(items.find(i => i.title === "Stella's staff meeting (new series)")).toBeDefined();
	});

	test('handles titles with internal hyphens and no em dash (GLRP-NNNNN style)', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		const item = items.find(i => i.title === 'GLRP-12009 - Aruba Switches/SIC Integration- Not Managed by Aruba Central');
		expect(item).toBeDefined();
		expect(item!.startTime).toBe('12:00 PM');
		expect(item!.endTime).toBe('12:55 PM');
	});

	test('detects Green Team Daily Meeting as Green Standup with no organizer', () => {
		const { items } = parseSchedule(NEW_FORMAT_TEXT);
		const green = items.find(i => i.title === 'Green Team Daily Meeting');
		expect(green).toBeDefined();
		expect(green!.isGreenStandup).toBe(true);
	});

	test('section headers are unparsed, not meetings', () => {
		const { unparsed } = parseSchedule(NEW_FORMAT_TEXT);
		const texts = unparsed.map(u => u.rawLine);
		expect(texts.some(t => t.includes('Upcoming / current meetings'))).toBe(true);
		expect(texts.some(t => t.includes('Already past today'))).toBe(true);
		expect(texts.some(t => t.includes('All-day / multi-day'))).toBe(true);
	});

	test('"ended at" entries without a time range are unparsed', () => {
		const { unparsed } = parseSchedule(NEW_FORMAT_TEXT);
		expect(unparsed.some(u => u.rawLine.includes('Session 2 ended at'))).toBe(true);
	});

	test('all-day/multi-day prose entries are unparsed', () => {
		const { unparsed } = parseSchedule(NEW_FORMAT_TEXT);
		expect(unparsed.some(u => u.rawLine.includes('Mark PTO'))).toBe(true);
	});

	test('standalone no-organizer line (no section, no bullet)', () => {
		const { items } = parseSchedule('Platform 3.0 bug squashing \u2014 1:00 PM\u20131:30 PM. 8');
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Platform 3.0 bug squashing');
		expect(items[0].organizer).toBe('');
	});
});
