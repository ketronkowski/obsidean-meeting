import { parseSchedule } from '../schedule-import/parser';

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
