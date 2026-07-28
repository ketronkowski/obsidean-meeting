/**
 * Tests for VoiceSpeakerAttributionModal.
 * @jest-environment jsdom
 *
 * Because the Modal runs in jsdom and uses document.createElement, these tests
 * check the static `show()` factory and the modal's Promise resolution behaviour
 * rather than clicking DOM elements (which would require a full browser environment).
 */

import { VoiceSpeakerAttributionModal } from '../ui/voice-speaker-attribution-modal';
import * as obsidian from 'obsidian';
import {
	ALL_AUTO_RESPONSE,
	MIXED_RESPONSE,
	ALL_SKIP_RESPONSE,
} from './fixtures/daemon-responses';

jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
import { readFile } from 'fs/promises';

// Minimal app mock
const mockApp = {} as any;

describe('VoiceSpeakerAttributionModal.show()', () => {

	// -------------------------------------------------------------------------
	// Auto-bypass
	// -------------------------------------------------------------------------

	test('auto-bypass: resolves immediately when all speakers are action=auto', async () => {
		const assignments = await VoiceSpeakerAttributionModal.show(
			mockApp,
			ALL_AUTO_RESPONSE,
			['Dave Lee', 'Eve Brown'],
		);

		expect(assignments).toHaveLength(3);
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-001', name: 'Alice Smith' });
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-002', name: 'Bob Jones' });
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-003', name: 'Carol White' });
	});

	test('auto-bypass: returns empty array if all-auto but no bestMatch', async () => {
		const response = {
			speakers: [
				{ speakerUuid: 'x', displayName: 'Speaker 1', bestMatch: null, score: 0.8, action: 'auto' as const },
			],
			knownSpeakers: [],
		};

		const assignments = await VoiceSpeakerAttributionModal.show(mockApp, response, []);
		// No best match → no assignments (filter drops them)
		expect(assignments).toHaveLength(0);
	});

	test('does NOT auto-bypass when at least one speaker is not auto', async () => {
		// MIXED_RESPONSE has a confirm and skip — modal must open.
		// We intercept the modal open to simulate user clicking "Skip All"
		const originalOpen = VoiceSpeakerAttributionModal.prototype.open;
		VoiceSpeakerAttributionModal.prototype.open = function () {
			// Simulate clicking "Skip All" immediately
			(this as any).resolve([]);
			(this as any).close = jest.fn();
		};

		const assignments = await VoiceSpeakerAttributionModal.show(
			mockApp,
			MIXED_RESPONSE,
			['Dave Lee'],
		);

		VoiceSpeakerAttributionModal.prototype.open = originalOpen;

		expect(assignments).toHaveLength(0);
	});

	// -------------------------------------------------------------------------
	// Modal.applyAndClose via direct construction
	// -------------------------------------------------------------------------

	test('applyAndClose includes auto speakers without user interaction', async () => {
		// Use MIXED_RESPONSE with modal's applyAndClose (no confirm/skip changes)
		const assignmentPromise = new Promise<ReturnType<typeof VoiceSpeakerAttributionModal.prototype.onOpen>>((resolve) => {
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				resolve as any,
			);
			// Call applyAndClose directly (via bracket access — private)
			(modal as any).applyAndClose();
		});

		const assignments = await assignmentPromise as any;

		// Auto speaker (Alice) must be included
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-001', name: 'Alice Smith' });

		// Confirm/skip pending values start as bestMatch (Bob Jones) and '' respectively
		// Bob Jones has pending = 'Bob Jones' (pre-filled), Speaker 3 has '' → skipped
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-002', name: 'Bob Jones' });
		// Speaker 3 bestMatch is null → pending = '' → not included
		const speaker3 = assignments.find((a: any) => a.speakerUuid === 'test-uuid-003');
		expect(speaker3).toBeUndefined();
	});

	test('applyAndClose returns empty array when all speakers are skip with no pending', async () => {
		const assignmentPromise = new Promise<any[]>((resolve) => {
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_SKIP_RESPONSE,
				['Dave Lee'],
				resolve,
			);
			(modal as any).applyAndClose();
		});

		const assignments = await assignmentPromise;
		expect(assignments).toHaveLength(0);
	});

	test('pending override: confirm speaker with manually-set name is included', async () => {
		const assignmentPromise = new Promise<any[]>((resolve) => {
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				resolve,
			);
			// Simulate user typing "Carol White" for test-uuid-003 (skip speaker)
			(modal as any).pending.set('test-uuid-003', 'Carol White');
			(modal as any).applyAndClose();
		});

		const assignments = await assignmentPromise;
		expect(assignments).toContainEqual({ speakerUuid: 'test-uuid-003', name: 'Carol White' });
	});

	// -------------------------------------------------------------------------
	// Dropdown uses optgroups: attendees first, then other speakers
	// -------------------------------------------------------------------------

	test('buildDropdown uses optgroups: Meeting Attendees first, Other Speakers second', () => {
		const modal = new VoiceSpeakerAttributionModal(
			mockApp,
			MIXED_RESPONSE,                   // knownSpeakers: Alice, Bob, Carol
			['Dave Lee', 'Alice Smith'],       // attendees — Alice is in both
			() => {},
		);
		(modal as any).contentEl = document.createElement('div');
		const container = document.createElement('div');
		const select = (modal as any).buildDropdown(container, '') as HTMLSelectElement;

		const optgroups = Array.from(select.querySelectorAll('optgroup'));
		expect(optgroups).toHaveLength(2);
		expect(optgroups[0].label).toBe('Meeting Attendees');
		expect(optgroups[1].label).toBe('Other Speakers');

		// Meeting Attendees group contains attendees
		const attendeeOptions = Array.from(optgroups[0].querySelectorAll('option')).map((o: any) => o.value);
		expect(attendeeOptions).toContain('Alice Smith');
		expect(attendeeOptions).toContain('Dave Lee');

		// Other Speakers group contains non-attendee library speakers
		const otherOptions = Array.from(optgroups[1].querySelectorAll('option')).map((o: any) => o.value);
		expect(otherOptions).toContain('Bob Jones');
		expect(otherOptions).toContain('Carol White');
		// Alice is an attendee — should NOT appear in Other Speakers
		expect(otherOptions).not.toContain('Alice Smith');
	});

	test('buildDropdown: Alice deduped — appears only in Meeting Attendees group', () => {
		const modal = new VoiceSpeakerAttributionModal(
			mockApp,
			MIXED_RESPONSE,
			['Dave Lee', 'Alice Smith'],
			() => {},
		);
		(modal as any).contentEl = document.createElement('div');
		const container = document.createElement('div');
		const select = (modal as any).buildDropdown(container, '') as HTMLSelectElement;

		const allOptionValues = Array.from(select.querySelectorAll('option'))
			.map((o: any) => o.value)
			.filter((v: string) => v);
		expect(allOptionValues.filter((v: string) => v === 'Alice Smith')).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// Datalist in new-name input has attendees before library speakers
	// -------------------------------------------------------------------------

	test('renderNewNameInput datalist lists attendees before library speakers', () => {
		const modal = new VoiceSpeakerAttributionModal(
			mockApp,
			MIXED_RESPONSE,                   // knownSpeakers: Alice, Bob, Carol
			['Dave Lee', 'Alice Smith'],
			() => {},
		);
		(modal as any).contentEl = document.createElement('div');
		const container = document.createElement('div');
		(modal as any).renderNewNameInput(container, 'test-uuid-001');

		const datalist = container.querySelector('datalist') as HTMLDataListElement;
		expect(datalist).not.toBeNull();
		const options = Array.from(datalist.querySelectorAll('option')).map((o: any) => o.value);

		// All attendees appear before any non-attendee library speaker
		const daveIdx = options.indexOf('Dave Lee');
		const aliceIdx = options.indexOf('Alice Smith');
		const bobIdx = options.indexOf('Bob Jones');
		const carolIdx = options.indexOf('Carol White');

		expect(daveIdx).toBeGreaterThanOrEqual(0);
		expect(aliceIdx).toBeGreaterThanOrEqual(0);
		expect(bobIdx).toBeGreaterThan(Math.max(daveIdx, aliceIdx));
		expect(carolIdx).toBeGreaterThan(Math.max(daveIdx, aliceIdx));
		// Alice (attendee) not duplicated in library section
		expect(options.filter((v: string) => v === 'Alice Smith')).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// Auto section shows 👤 badge for attendee matches
	// -------------------------------------------------------------------------

	test('renderAutoSection shows attendee badge when match is a meeting attendee', () => {
		// ALL_AUTO_RESPONSE speakers: Alice Smith, Bob Jones, Carol White
		const modal = new VoiceSpeakerAttributionModal(
			mockApp,
			ALL_AUTO_RESPONSE,
			['Alice Smith', 'Dave Lee'],   // Alice is an attendee; Bob and Carol are not
			() => {},
		);
		const contentEl = document.createElement('div');
		(modal as any).contentEl = contentEl;

		const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
		(modal as any).renderAutoSection(contentEl, autoSpeakers);

		const badges = contentEl.querySelectorAll('.voice-attendee-badge');
		// Only Alice should get a badge
		expect(badges).toHaveLength(1);
		expect(badges[0].textContent).toBe('👤');
	});

	// -------------------------------------------------------------------------
	// Play button — lazy audio clip playback
	// -------------------------------------------------------------------------

	describe('play button', () => {
		let playSpy: jest.Mock;
		let pauseSpy: jest.Mock;
		let createObjectURLSpy: jest.Mock;

		beforeEach(() => {
			playSpy = jest.fn().mockResolvedValue(undefined);
			pauseSpy = jest.fn();
			window.HTMLMediaElement.prototype.play = playSpy;
			window.HTMLMediaElement.prototype.pause = pauseSpy;

			(readFile as jest.Mock).mockReset().mockResolvedValue(Buffer.from('fake-audio-bytes'));
			createObjectURLSpy = jest.fn().mockReturnValue('blob:mock-url');
			(global as any).URL.createObjectURL = createObjectURLSpy;
			(global as any).URL.revokeObjectURL = jest.fn();
		});

		test('play button is not rendered when whisperPath/voiceClient are not provided', () => {
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				() => {},
				// no whisperPath / voiceClient
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const autoSpeakers = MIXED_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			expect(contentEl.querySelectorAll('.voice-play-button')).toHaveLength(0);
		});

		test('play button is rendered when whisperPath/voiceClient are provided', () => {
			const fakeClient = { getSpeakerClip: jest.fn() } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const autoSpeakers = MIXED_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			expect(contentEl.querySelectorAll('.voice-play-button')).toHaveLength(1);
		});

		test('clicking play fetches the clip once, sets audio src, and toggles to Pause', async () => {
			const fakeClient = {
				getSpeakerClip: jest.fn().mockResolvedValue('/tmp/wsi-audio-cache/x/test-uuid-001.m4a'),
			} as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const btn = document.createElement('button');
			contentEl.appendChild(btn);

			await (modal as any).togglePlayback('test-uuid-001', btn);

			expect(fakeClient.getSpeakerClip).toHaveBeenCalledWith('/path/to/meeting.whisper', 'test-uuid-001');
			expect(readFile).toHaveBeenCalledWith('/tmp/wsi-audio-cache/x/test-uuid-001.m4a');
			expect(btn.textContent).toBe('⏸ Pause');
			expect((modal as any).audioEl.src).toContain('blob:mock-url');
			expect(playSpy).toHaveBeenCalled();

			// Second click on the same (still-playing) speaker pauses instead of re-fetching
			Object.defineProperty((modal as any).audioEl, 'paused', { value: false, configurable: true });
			await (modal as any).togglePlayback('test-uuid-001', btn);
			expect(pauseSpy).toHaveBeenCalled();
			expect(fakeClient.getSpeakerClip).toHaveBeenCalledTimes(1); // cached, no re-fetch
			expect(readFile).toHaveBeenCalledTimes(1); // blob URL cached too, no re-read
		});

		test('shows an error state and resets when clip extraction fails', async () => {
			jest.useFakeTimers();
			const fakeClient = { getSpeakerClip: jest.fn().mockResolvedValue(null) } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const btn = document.createElement('button');

			await (modal as any).togglePlayback('test-uuid-001', btn);

			expect(btn.textContent).toBe('⚠ Unavailable');
			jest.advanceTimersByTime(2000);
			expect(btn.textContent).toBe('▶ Play');
			jest.useRealTimers();
		});

		test('shows an error state when the clip file cannot be read for playback', async () => {
			jest.useFakeTimers();
			(readFile as jest.Mock).mockReset().mockRejectedValue(new Error('ENOENT'));
			const fakeClient = {
				getSpeakerClip: jest.fn().mockResolvedValue('/tmp/wsi-audio-cache/x/test-uuid-001.m4a'),
			} as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				MIXED_RESPONSE,
				['Dave Lee'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const btn = document.createElement('button');

			await (modal as any).togglePlayback('test-uuid-001', btn);

			expect(btn.textContent).toBe('⚠ Unavailable');
			jest.advanceTimersByTime(2000);
			expect(btn.textContent).toBe('▶ Play');
			jest.useRealTimers();
		});
	});

	// -------------------------------------------------------------------------
	// Auto rows are now correctable (dropdown + type-a-name), not read-only
	// -------------------------------------------------------------------------

	describe('correctable Auto rows', () => {
		test('renderAutoSection renders an editable dropdown and new-name input per speaker', () => {
			const fakeClient = { getSpeakerClip: jest.fn() } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith', 'Dave Lee'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			// One dropdown + one new-name input per auto speaker, preselected to bestMatch
			expect(contentEl.querySelectorAll('.voice-select')).toHaveLength(autoSpeakers.length);
			expect(contentEl.querySelectorAll('.voice-new-name-input')).toHaveLength(autoSpeakers.length);
			const firstSelect = contentEl.querySelector('.voice-select') as HTMLSelectElement;
			expect(firstSelect.value).toBe('Alice Smith');
		});

		test('applyAndClose picks up a corrected Auto-row name from the dropdown', async () => {
			const fakeClient = { getSpeakerClip: jest.fn() } as any;
			let resolvedAssignments: any[] = [];
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith', 'Dave Lee'],
				(assignments) => { resolvedAssignments = assignments; },
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			// Simulate the user correcting "Alice Smith" (wrong match) to "Dave Lee"
			const select = (modal as any).selectEls.get('test-uuid-001') as HTMLSelectElement;
			select.value = 'Dave Lee';
			select.dispatchEvent(new Event('change'));

			(modal as any).applyAndClose();

			expect(resolvedAssignments).toContainEqual({ speakerUuid: 'test-uuid-001', name: 'Dave Lee' });
			expect(resolvedAssignments).not.toContainEqual({ speakerUuid: 'test-uuid-001', name: 'Alice Smith' });
		});
	});

	// -------------------------------------------------------------------------
	// Skip / Clear-voice-cache checkboxes (replaces the old 🗑 wipe button)
	// -------------------------------------------------------------------------

	describe('Skip / Clear-voice-cache checkboxes', () => {
		let confirmSpy: jest.SpyInstance;
		let noticeSpy: jest.SpyInstance;

		beforeEach(() => {
			confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
			noticeSpy = jest.spyOn(obsidian, 'Notice').mockImplementation(function () { return {} as any; } as any);
		});

		afterEach(() => {
			confirmSpy.mockRestore();
			noticeSpy.mockRestore();
		});

		test('renders a Skip checkbox even without a voice client, but no Clear-voice-cache checkbox', () => {
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				() => {},
				// no whisperPath / voiceClient
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;

			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			expect(contentEl.querySelectorAll('.voice-checkbox-group')).toHaveLength(autoSpeakers.length);
			expect((modal as any).skipCheckboxEls.size).toBe(autoSpeakers.length);
			expect((modal as any).wipeCheckboxEls.size).toBe(0);
			expect(contentEl.querySelectorAll('.voice-wipe-button')).toHaveLength(0);
		});

		test('Clear-voice-cache checkbox starts disabled and is enabled (but not auto-checked) once Skip is checked', () => {
			const fakeClient = { getSpeakerClip: jest.fn(), forgetSpeaker: jest.fn() } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid;
			const skipCb = (modal as any).skipCheckboxEls.get(uuid) as HTMLInputElement;
			const wipeCb = (modal as any).wipeCheckboxEls.get(uuid) as HTMLInputElement;
			const select = (modal as any).selectEls.get(uuid) as HTMLSelectElement;
			const input = (modal as any).inputEls.get(uuid) as HTMLInputElement;

			expect(wipeCb.disabled).toBe(true);
			expect(select.disabled).toBe(false);

			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));

			expect(wipeCb.disabled).toBe(false);
			expect(wipeCb.checked).toBe(false); // not auto-checked
			expect(select.disabled).toBe(true);
			expect(input.disabled).toBe(true);
			expect((modal as any).pending.get(uuid)).toBe('');
		});

		test('cannot check Clear-voice-cache while Skip is unchecked (checkbox stays disabled)', () => {
			const fakeClient = { getSpeakerClip: jest.fn(), forgetSpeaker: jest.fn() } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid;
			const wipeCb = (modal as any).wipeCheckboxEls.get(uuid) as HTMLInputElement;
			expect(wipeCb.disabled).toBe(true);
		});

		test('unchecking Skip disables and unchecks Clear-voice-cache, and re-enables dropdown/input', () => {
			const fakeClient = { getSpeakerClip: jest.fn(), forgetSpeaker: jest.fn() } as any;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				() => {},
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid;
			const skipCb = (modal as any).skipCheckboxEls.get(uuid) as HTMLInputElement;
			const wipeCb = (modal as any).wipeCheckboxEls.get(uuid) as HTMLInputElement;
			const select = (modal as any).selectEls.get(uuid) as HTMLSelectElement;

			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));
			wipeCb.checked = true; // user opts in to clearing the cache too

			skipCb.checked = false;
			skipCb.dispatchEvent(new Event('change'));

			expect(wipeCb.disabled).toBe(true);
			expect(wipeCb.checked).toBe(false);
			expect(select.disabled).toBe(false);
			expect((modal as any).pending.get(uuid)).toBe(select.value);
		});

		test('you can check Skip alone (plain skip, no wipe) without ever touching Clear-voice-cache', async () => {
			const fakeClient = { getSpeakerClip: jest.fn(), forgetSpeaker: jest.fn() } as any;
			let resolved: any[] = [];
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				(assignments) => { resolved = assignments; },
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid;
			const skipCb = (modal as any).skipCheckboxEls.get(uuid) as HTMLInputElement;
			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));

			(modal as any).applyAndClose();
			await Promise.resolve();
			await Promise.resolve();

			expect(fakeClient.forgetSpeaker).not.toHaveBeenCalled();
			expect(resolved.find(a => a.speakerUuid === uuid)).toBeUndefined();
		});

		test('Apply with Clear-voice-cache checked confirms once, calls forgetSpeaker, and shows a summary Notice', async () => {
			const fakeClient = {
				getSpeakerClip: jest.fn(),
				forgetSpeaker: jest.fn().mockResolvedValue(5),
			} as any;
			let resolved: any[] = [];
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				(assignments) => { resolved = assignments; },
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid; // bestMatch: Alice Smith
			const skipCb = (modal as any).skipCheckboxEls.get(uuid) as HTMLInputElement;
			const wipeCb = (modal as any).wipeCheckboxEls.get(uuid) as HTMLInputElement;
			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));
			wipeCb.checked = true;

			(modal as any).applyAndClose();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			expect(confirmSpy).toHaveBeenCalledTimes(1);
			expect(confirmSpy.mock.calls[0][0]).toContain('Alice Smith');
			expect(fakeClient.forgetSpeaker).toHaveBeenCalledWith('Alice Smith');
			expect(noticeSpy).toHaveBeenCalled();
			expect(resolved.find(a => a.speakerUuid === uuid)).toBeUndefined(); // still skipped
		});

		test('cancelling the combined confirm aborts the whole Apply action (nothing deleted, not resolved)', async () => {
			confirmSpy.mockReturnValue(false);
			const fakeClient = {
				getSpeakerClip: jest.fn(),
				forgetSpeaker: jest.fn(),
			} as any;
			let resolvedCalled = false;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				ALL_AUTO_RESPONSE,
				['Alice Smith'],
				() => { resolvedCalled = true; },
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			const autoSpeakers = ALL_AUTO_RESPONSE.speakers.filter(s => s.action === 'auto');
			(modal as any).renderAutoSection(contentEl, autoSpeakers);

			const uuid = autoSpeakers[0].speakerUuid;
			const skipCb = (modal as any).skipCheckboxEls.get(uuid) as HTMLInputElement;
			const wipeCb = (modal as any).wipeCheckboxEls.get(uuid) as HTMLInputElement;
			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));
			wipeCb.checked = true;

			(modal as any).applyAndClose();
			await Promise.resolve();
			await Promise.resolve();

			expect(fakeClient.forgetSpeaker).not.toHaveBeenCalled();
			expect(resolvedCalled).toBe(false);
		});

		test('Skip All also collects and wipes checked Clear-voice-cache rows before resolving', async () => {
			const fakeClient = {
				getSpeakerClip: jest.fn(),
				forgetSpeaker: jest.fn().mockResolvedValue(2),
			} as any;
			const response = {
				speakers: [
					{ speakerUuid: 'uuid-a', displayName: 'Speaker 1', bestMatch: 'Alice Smith', score: 0.78, action: 'confirm' as const },
					{ speakerUuid: 'uuid-b', displayName: 'Speaker 2', bestMatch: 'Bob Jones', score: 0.6, action: 'confirm' as const },
				],
				knownSpeakers: ['Alice Smith', 'Bob Jones'],
			};
			let resolved: any[] | null = null;
			const modal = new VoiceSpeakerAttributionModal(
				mockApp,
				response,
				[],
				(assignments) => { resolved = assignments; },
				'/path/to/meeting.whisper',
				fakeClient,
			);
			const contentEl = document.createElement('div');
			(modal as any).contentEl = contentEl;
			(modal as any).renderConfirmSection(contentEl, response.speakers);

			const skipCb = (modal as any).skipCheckboxEls.get('uuid-a') as HTMLInputElement;
			const wipeCb = (modal as any).wipeCheckboxEls.get('uuid-a') as HTMLInputElement;
			skipCb.checked = true;
			skipCb.dispatchEvent(new Event('change'));
			wipeCb.checked = true;

			// Directly invoke the Skip All handler's underlying logic.
			(modal as any).finishWithWipes([]);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			expect(fakeClient.forgetSpeaker).toHaveBeenCalledWith('Alice Smith');
			expect(resolved).toEqual([]);
			// wiping resets any other row assigned to the same name too
			expect((modal as any).knownSpeakers).not.toContain('Alice Smith');
		});
	});
});
