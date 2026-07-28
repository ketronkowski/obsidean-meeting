/**
 * Regression test for attendee-screenshot vision parsing.
 *
 * The vision prompt asks for "First Last, First Last" but Teams screenshots
 * are sometimes transcribed literally as "Last, First, Last, First, ..."
 * (alphabetized surname/given-name pairs). Splitting that naively on every
 * comma produces single-word fragments ("Tronkowski", "Kevin", ...) that fail
 * the "must contain a space" full-name check, so 0 attendees were extracted
 * even though the vision response actually contained valid names.
 */
import { App } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { GeneralMeetingHandler } from '../handlers/general';

const fakeApp = {} as App;
const fakeSettings = {} as unknown as MeetingProcessorSettings;

function buildHandler(): any {
	const copilotClient = new CopilotClientManager(fakeApp, fakeSettings);
	const skillLoader = new SkillLoader(fakeApp, '/fake/plugin/dir');
	const statusBar = new StatusBarManager({ setText: () => {}, style: {} } as unknown as HTMLElement);
	return new GeneralMeetingHandler(fakeApp, fakeSettings, copilotClient, skillLoader, statusBar);
}

describe('parseScreenshotNames', () => {
	it('parses standard "First Last, First Last" comma-separated full names', () => {
		const handler = buildHandler();
		const names = handler.parseScreenshotNames('Kevin Tronkowski, Prasad G V N, Yogesh Kumar');
		expect(names).toEqual(['Kevin Tronkowski', 'Prasad G V N', 'Yogesh Kumar']);
	});

	it('re-pairs "Last, First, Last, First, ..." into "First Last" names', () => {
		const handler = buildHandler();
		const names = handler.parseScreenshotNames('Tronkowski, Kevin, Griffin, Drew, Vilrokx, Mark');
		expect(names).toEqual(['Kevin Tronkowski', 'Drew Griffin', 'Mark Vilrokx']);
	});

	it('re-pairs a single "Last, First" pair', () => {
		const handler = buildHandler();
		const names = handler.parseScreenshotNames('Tronkowski, Kevin');
		expect(names).toEqual(['Kevin Tronkowski']);
	});

	it('falls back to per-token filtering for odd-length single-word lists', () => {
		const handler = buildHandler();
		// Odd count of single-word tokens can't be name pairs — treat as garbage,
		// each fragment fails the "must contain a space" check, so nothing is returned.
		const names = handler.parseScreenshotNames('Tronkowski, Kevin, Griffin');
		expect(names).toEqual([]);
	});

	it('does not mis-pair when tokens are already full names (mixed spacing)', () => {
		const handler = buildHandler();
		const names = handler.parseScreenshotNames('Kevin Tronkowski, Drew Griffin');
		expect(names).toEqual(['Kevin Tronkowski', 'Drew Griffin']);
	});
});
