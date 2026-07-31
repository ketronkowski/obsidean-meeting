import { App, Modal, Notice } from 'obsidian';
import { VoiceAnalysisResponse, VoiceNameAssignment, VoiceSpeakerResult } from '../voice-analysis-types';
import { VoiceAnalysisClient } from '../voice-analysis-client';
import { WhisperSpeakerStats, isLowSignalSpeaker } from '../transcript/whisper-speaker-stats';

const AUTO_THRESHOLD = 0.85;
const UNRESOLVED_THRESHOLD = 0.65;

/**
 * Modal for resolving speakers using voice analysis results from whisper-speaker-id.
 *
 * Sections:
 *   - Auto (collapsible): high-confidence auto-assigned speakers
 *   - Confirm: borderline matches needing user confirmation
 *   - Unresolved: low-confidence speakers that need manual assignment
 *
 * Each speaker row also has a ▶ Play button that lazily extracts (via the
 * whisper-speaker-id daemon) and plays their longest utterance, and — when a
 * sample quote could be extracted from the .whisper file — a short italic
 * transcript excerpt, to help the user identify who's who by voice and text.
 */
export class VoiceSpeakerAttributionModal extends Modal {
	private response: VoiceAnalysisResponse;
	private attendees: string[];
	private resolve: (assignments: VoiceNameAssignment[]) => void;
	private whisperPath: string | null;
	private voiceClient: VoiceAnalysisClient | null;
	private sampleQuotes: Map<string, string>;
	private speakerStats: Map<string, WhisperSpeakerStats>;

	// Per-UUID pending name decisions (empty string = skip). Forced to '' while
	// that row's Skip checkbox is checked.
	private pending: Map<string, string>;

	// Per-UUID "real" assignment, mirroring `pending` but never zeroed out by
	// Skip — used to know which name to wipe for a row even after Skip has
	// forced `pending` to ''. Also used to restore `pending` when Skip is
	// unchecked again.
	private lastAssignedName: Map<string, string> = new Map();

	// Per-UUID references to the dropdown/text-input controls, so the batched
	// wipe flow and Skip-checkbox handler can read/reset a row's UI without a
	// full modal re-render.
	private selectEls: Map<string, HTMLSelectElement> = new Map();
	private inputEls: Map<string, HTMLInputElement> = new Map();

	// Per-UUID references to the Skip / Clear-voice-cache checkboxes (only
	// rendered on Auto/Confirm rows). Clear-voice-cache is gated by Skip: it
	// stays disabled+unchecked until Skip is checked for that row.
	private skipCheckboxEls: Map<string, HTMLInputElement> = new Map();
	private wipeCheckboxEls: Map<string, HTMLInputElement> = new Map();

	// Mutable copy of known reference-library speaker names, shrunk in-session
	// as names are wiped via the batched Apply/Skip-All flow so they stop
	// being offered.
	private knownSpeakers: string[];

	// Audio playback state — one shared <audio> element so only one clip plays at a time
	private audioEl: HTMLAudioElement | null = null;
	private clipCache: Map<string, string> = new Map(); // speakerUuid -> local clip path
	private blobUrlCache: Map<string, string> = new Map(); // speakerUuid -> blob: object URL
	private playingUuid: string | null = null;

	// Live "Applying N of M speakers" label shown next to Apply, kept in sync
	// with `pending` via a delegated change/input listener on contentEl —
	// see updateApplySummary(). Exists so it's always visually verifiable
	// exactly how many name assignments (and thus voice samples) Apply will
	// actually send, rather than having to infer it from console logs after
	// the fact (a source of confusion previously).
	private applySummaryEl: HTMLElement | null = null;
	private playButtons: Map<string, HTMLButtonElement> = new Map();

	constructor(
		app: App,
		response: VoiceAnalysisResponse,
		attendees: string[],
		resolve: (assignments: VoiceNameAssignment[]) => void,
		whisperPath: string | null = null,
		voiceClient: VoiceAnalysisClient | null = null,
		sampleQuotes: Map<string, string> = new Map(),
		speakerStats: Map<string, WhisperSpeakerStats> = new Map(),
	) {
		super(app);
		this.response = response;
		this.attendees = attendees;
		this.resolve = resolve;
		this.whisperPath = whisperPath;
		this.voiceClient = voiceClient;
		this.sampleQuotes = sampleQuotes;
		this.speakerStats = speakerStats;
		this.pending = new Map();
		this.knownSpeakers = [...response.knownSpeakers];

		// Initialize with suggested names
		for (const s of response.speakers) {
			this.pending.set(s.speakerUuid, s.bestMatch ?? '');
			this.lastAssignedName.set(s.speakerUuid, s.bestMatch ?? '');
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('voice-speaker-attribution-modal');

		contentEl.createEl('h2', { text: '🎙️ Voice Speaker Identification' });
		contentEl.createEl('p', {
			text: 'Speakers were identified by voice analysis. Review the assignments below.',
			cls: 'voice-speaker-attribution-desc',
		});

		const autoSpeakers = this.response.speakers.filter(s => s.action === 'auto');
		const confirmSpeakers = this.response.speakers.filter(s => s.action === 'confirm');
		const skipSpeakers = this.response.speakers.filter(s => s.action === 'skip');

		if (autoSpeakers.length > 0) this.renderAutoSection(contentEl, autoSpeakers);
		if (confirmSpeakers.length > 0) this.renderConfirmSection(contentEl, confirmSpeakers);
		if (skipSpeakers.length > 0) this.renderSkipSection(contentEl, skipSpeakers);

		this.renderButtons(contentEl);

		// Delegated listener: any select/checkbox `change` or new-name-input
		// `input` event anywhere in the modal bubbles up here, so the summary
		// stays accurate without wiring a call into every individual handler.
		contentEl.addEventListener('change', () => this.updateApplySummary());
		contentEl.addEventListener('input', () => this.updateApplySummary());
		this.updateApplySummary();
	}

	// ---------------------------------------------------------------------------
	// Sections
	// ---------------------------------------------------------------------------

	/**
	 * Renders a collapsible section shell shared by Auto/Confirm/Unresolved:
	 * a header with a ▶/▼ toggle + title + optional hint text, and a body div
	 * whose visibility that toggle controls. `defaultExpanded` controls the
	 * section's initial state — Auto starts collapsed (already resolved,
	 * nothing to do), Confirm/Unresolved start expanded (need attention).
	 * Returns both the header (so callers can add inline action buttons that
	 * stay visible even while collapsed) and the body (for per-speaker rows).
	 */
	private createCollapsibleSection(
		container: HTMLElement,
		titleText: string,
		hint: string,
		defaultExpanded: boolean,
	): { header: HTMLElement; body: HTMLElement } {
		const section = container.createDiv({ cls: 'voice-section' });

		const header = section.createDiv({ cls: 'voice-section-header' });
		const toggle = header.createEl('span', { text: defaultExpanded ? '▼' : '▶', cls: 'voice-section-toggle' });
		header.createEl('strong', { text: titleText });
		if (hint) {
			header.createEl('span', { text: hint, cls: 'voice-section-hint' });
		}

		const body = section.createDiv({ cls: 'voice-section-body' });
		body.style.display = defaultExpanded ? 'block' : 'none';

		toggle.addEventListener('click', () => {
			const hidden = body.style.display === 'none';
			body.style.display = hidden ? 'block' : 'none';
			toggle.textContent = hidden ? '▼' : '▶';
		});

		return { header, body };
	}

	private renderAutoSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const { body } = this.createCollapsibleSection(
			container,
			` ✓ Auto-identified (${speakers.length})`,
			' — expand to review or correct',
			false,
		);

		for (const s of speakers) {
			const row = body.createDiv({ cls: 'voice-row' });
			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			if (s.bestMatch && this.attendees.some(a => a.toLowerCase() === s.bestMatch!.toLowerCase())) {
				row.createEl('span', { text: '👤', cls: 'voice-attendee-badge' });
			}
			this.renderScoreBadge(row, s.score);
			this.renderLowSignalBadge(row, s.speakerUuid);
			this.renderPlayButton(row, s.speakerUuid);
			this.renderSampleQuote(row, s.speakerUuid);

			// Correctable, same as Confirm rows — a wrong high-confidence match is
			// otherwise invisible/unfixable since Apply always used to accept it verbatim.
			const assignRow = row.createDiv({ cls: 'voice-assign-row' });
			const select = this.buildDropdown(assignRow, s.bestMatch ?? '');
			this.selectEls.set(s.speakerUuid, select);
			select.addEventListener('change', () => {
				this.pending.set(s.speakerUuid, select.value);
				this.lastAssignedName.set(s.speakerUuid, select.value);
			});

			const input = this.renderNewNameInput(row, s.speakerUuid);
			this.renderSkipAndWipeCheckboxes(assignRow, s.speakerUuid, select, input, this.isLowSignal(s.speakerUuid));
		}
	}

	private renderConfirmSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const { header, body } = this.createCollapsibleSection(
			container,
			`❓ Needs confirmation (${speakers.length})`,
			'',
			true,
		);

		// "Skip All" and "Clear all voice cache" live here (rather than in the
		// modal's global footer) since they act on every row's Skip/Clear-voice-
		// cache checkbox across the whole modal, and this is the section users
		// most often reach for them from. They sit in the header, not the
		// collapsible body, so they stay usable even while collapsed.
		const actions = header.createDiv({ cls: 'voice-section-actions' });
		const skipBtn = actions.createEl('button', { text: 'Skip All', cls: 'mod-muted voice-inline-btn' });
		skipBtn.addEventListener('click', () => { this.skipAllRows(); });
		const clearAllBtn = actions.createEl('button', { text: 'Clear all voice cache', cls: 'mod-warning voice-inline-btn' });
		clearAllBtn.addEventListener('click', () => { this.clearAllActiveWipeCheckboxes(); });

		for (const s of speakers) {
			const row = body.createDiv({ cls: 'voice-row' });

			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			this.renderScoreBadge(row, s.score);
			this.renderLowSignalBadge(row, s.speakerUuid);
			this.renderPlayButton(row, s.speakerUuid);
			this.renderSampleQuote(row, s.speakerUuid);

			const assignRow = row.createDiv({ cls: 'voice-assign-row' });
			const select = this.buildDropdown(assignRow, s.bestMatch ?? '');
			this.selectEls.set(s.speakerUuid, select);
			select.addEventListener('change', () => {
				this.pending.set(s.speakerUuid, select.value);
				this.lastAssignedName.set(s.speakerUuid, select.value);
			});

			const input = this.renderNewNameInput(row, s.speakerUuid);
			this.renderSkipAndWipeCheckboxes(assignRow, s.speakerUuid, select, input, this.isLowSignal(s.speakerUuid));
		}
	}

	private renderSkipSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const { body } = this.createCollapsibleSection(
			container,
			`🔍 Unresolved speakers (${speakers.length})`,
			'',
			true,
		);

		for (const s of speakers) {
			const row = body.createDiv({ cls: 'voice-row' });
			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			this.renderLowSignalBadge(row, s.speakerUuid);
			this.renderPlayButton(row, s.speakerUuid);
			this.renderSampleQuote(row, s.speakerUuid);

			const assignRow = row.createDiv({ cls: 'voice-assign-row' });
			assignRow.createEl('span', { text: 'Assign to: ', cls: 'voice-assign-label' });

			const select = this.buildDropdown(assignRow, '');
			this.selectEls.set(s.speakerUuid, select);
			select.addEventListener('change', () => this.pending.set(s.speakerUuid, select.value));

			this.renderNewNameInput(row, s.speakerUuid);
		}
	}


	// ---------------------------------------------------------------------------
	// Controls
	// ---------------------------------------------------------------------------

	private buildDropdown(container: HTMLElement, preselect: string): HTMLSelectElement {
		const select = container.createEl('select', { cls: 'voice-select' });
		select.createEl('option', { text: '— Skip —', value: '' });

		const attendeeSet = new Set(this.attendees.map(n => n.toLowerCase()));
		const otherSpeakers = this.knownSpeakers.filter(
			n => !attendeeSet.has(n.toLowerCase()),
		);

		// Group 1: meeting attendees
		if (this.attendees.length > 0) {
			const grpAttendees = select.createEl('optgroup') as HTMLOptGroupElement;
			grpAttendees.label = 'Meeting Attendees';
			for (const name of sortedNames(this.attendees)) {
				const opt = grpAttendees.createEl('option', { text: name, value: name });
				if (name === preselect) opt.selected = true;
			}
		}

		// Group 2: reference library speakers not in this meeting
		if (otherSpeakers.length > 0) {
			const grpOther = select.createEl('optgroup') as HTMLOptGroupElement;
			grpOther.label = 'Other Speakers';
			for (const name of sortedNames(otherSpeakers)) {
				const opt = grpOther.createEl('option', { text: name, value: name });
				if (name === preselect) opt.selected = true;
			}
		}

		return select;
	}

	private renderNewNameInput(container: HTMLElement, uuid: string): HTMLInputElement {
		const inputRow = container.createDiv({ cls: 'voice-new-name-row' });
		inputRow.createEl('span', { text: 'or type a new name: ', cls: 'voice-assign-label' });

		// Build datalist with attendees first, then library speakers
		const datalistId = `voice-names-${uuid}`;
		const datalist = inputRow.createEl('datalist') as HTMLDataListElement;
		datalist.id = datalistId;
		const attendeeSet = new Set(this.attendees.map(n => n.toLowerCase()));
		for (const name of sortedNames(this.attendees)) {
			datalist.createEl('option', { value: name });
		}
		for (const name of sortedNames(this.knownSpeakers)) {
			if (!attendeeSet.has(name.toLowerCase())) {
				datalist.createEl('option', { value: name });
			}
		}

		const input = inputRow.createEl('input', {
			type: 'text',
			cls: 'voice-new-name-input',
			placeholder: 'New speaker name…',
		} as DomElementInfo & { type: string; placeholder: string }) as HTMLInputElement;
		input.setAttribute('list', datalistId);
		this.inputEls.set(uuid, input);
		input.addEventListener('input', () => {
			if (input.value.trim()) {
				this.pending.set(uuid, input.value.trim());
				this.lastAssignedName.set(uuid, input.value.trim());
			}
		});
		return input;
	}


	private renderScoreBadge(container: HTMLElement, score: number) {
		const pct = Math.round(score * 100);
		const cls = score >= AUTO_THRESHOLD ? 'voice-score-high'
			: score >= UNRESOLVED_THRESHOLD ? 'voice-score-mid'
			: 'voice-score-low';
		container.createEl('span', {
			text: `Voice match: ${pct}%`,
			cls: `voice-score-badge ${cls}`,
		});
	}

	/** Whether this speaker's total speaking time looks like diarization noise. */
	private isLowSignal(speakerUuid: string): boolean {
		return isLowSignalSpeaker(this.speakerStats.get(speakerUuid));
	}

	/**
	 * Render a "⚠ Low signal" badge with the speaker's total speaking time and
	 * segment count when their stats suggest MacWhisper's diarization split
	 * out crosstalk/noise as a spurious extra "speaker" rather than a real
	 * distinct participant. On Auto/Confirm rows, this pairs with Skip being
	 * pre-checked (see renderSkipAndWipeCheckboxes); on Unresolved rows there's
	 * no Skip checkbox to pre-check (the dropdown already defaults to skip),
	 * so the badge is shown purely as an explanation.
	 */
	private renderLowSignalBadge(container: HTMLElement, speakerUuid: string) {
		const stats = this.speakerStats.get(speakerUuid);
		if (!isLowSignalSpeaker(stats)) return;
		const dur = stats!.totalDurationSec;
		const durText = dur < 1 ? `${Math.round(dur * 1000)}ms` : `${dur.toFixed(1)}s`;
		container.createEl('span', {
			text: `⚠ Low signal (${durText} / ${stats!.segmentCount} clip${stats!.segmentCount !== 1 ? 's' : ''})`,
			cls: 'voice-low-signal-badge',
		});
	}

	/**
	 * Render a short transcript excerpt for this speaker (if one was extracted
	 * from the .whisper file) so users have text context, not just a voice
	 * match score/Play button, to help identify who's speaking.
	 */
	private renderSampleQuote(container: HTMLElement, speakerUuid: string) {
		const quote = this.sampleQuotes.get(speakerUuid);
		if (!quote) return;
		container.createEl('div', {
			text: `"${quote}"`,
			cls: 'voice-sample-quote',
		});
	}

	// ---------------------------------------------------------------------------
	// Skip / Clear-voice-cache checkboxes
	// ---------------------------------------------------------------------------

	/**
	 * Render the "Skip" and "Clear voice cache" checkboxes next to a row's
	 * dropdown (Auto/Confirm rows only).
	 *
	 * - "Skip": when checked, disables `select`/`input` (forcing this row's
	 *   assignment to skip regardless of whatever was selected/typed) and
	 *   enables the "Clear voice cache" checkbox for this row. When
	 *   unchecked, re-enables `select`/`input`, restores this row's pending
	 *   assignment from the dropdown's current value, and disables+unchecks
	 *   "Clear voice cache" again.
	 * - "Clear voice cache": gated by Skip — starts disabled/unchecked, and
	 *   can only be checked while Skip is checked. Doesn't delete anything
	 *   immediately; marked rows are collected and wiped in one batch when
	 *   Apply is clicked (see `finishWithWipes`) — "Skip All" only checks
	 *   every row's Skip checkbox, it does not itself finalize or wipe.
	 *   Only rendered when a voice client is available (nothing to wipe
	 *   against otherwise).
	 */
	private renderSkipAndWipeCheckboxes(
		container: HTMLElement,
		uuid: string,
		select: HTMLSelectElement,
		input: HTMLInputElement,
		lowSignal: boolean = false,
	) {
		const group = container.createDiv({ cls: 'voice-checkbox-group' });

		const skipLabel = group.createEl('label', { cls: 'voice-checkbox-label' });
		const skipCb = skipLabel.createEl('input', { type: 'checkbox' } as DomElementInfo & { type: string }) as HTMLInputElement;
		skipLabel.createEl('span', { text: ' Skip' });
		this.skipCheckboxEls.set(uuid, skipCb);

		let wipeCb: HTMLInputElement | null = null;
		if (this.voiceClient) {
			const wipeLabel = group.createEl('label', { cls: 'voice-checkbox-label' });
			wipeCb = wipeLabel.createEl('input', { type: 'checkbox' } as DomElementInfo & { type: string }) as HTMLInputElement;
			wipeCb.disabled = true;
			wipeLabel.createEl('span', { text: ' Clear voice cache' });
			this.wipeCheckboxEls.set(uuid, wipeCb);
		}

		const applySkipState = (checked: boolean) => {
			if (checked) {
				select.disabled = true;
				input.disabled = true;
				this.pending.set(uuid, '');
				if (wipeCb) wipeCb.disabled = false;
			} else {
				select.disabled = false;
				input.disabled = false;
				this.pending.set(uuid, select.value);
				this.lastAssignedName.set(uuid, select.value);
				if (wipeCb) {
					wipeCb.checked = false;
					wipeCb.disabled = true;
				}
			}
		};

		skipCb.addEventListener('change', () => applySkipState(skipCb.checked));

		// Pre-check Skip for speakers whose stats look like diarization noise
		// (e.g. a couple of seconds of crosstalk MacWhisper split into its own
		// "speaker") — still fully correctable, the user can just uncheck it.
		if (lowSignal) {
			skipCb.checked = true;
			applySkipState(true);
		}
	}

	/**
	 * Collect the set of names marked for deletion via a checked "Clear
	 * voice cache" checkbox. Reads from `lastAssignedName` (not `pending`,
	 * which is forced to '' once Skip is checked) so the correct name is
	 * still wiped even though the row's final assignment is "skip".
	 */
	private collectWipeTargets(): string[] {
		const names = new Set<string>();
		for (const [uuid, cb] of this.wipeCheckboxEls) {
			if (!cb.checked) continue;
			const name = this.lastAssignedName.get(uuid);
			if (name) names.add(name);
		}
		return [...names];
	}

	/**
	 * Remove `name` from the in-session known-speakers list and reset any
	 * row currently assigned to it (pending + its select/input UI) back to
	 * blank, so the just-wiped name isn't immediately re-applied or
	 * re-saved as a sample on Apply.
	 */
	private forgetNameEverywhere(name: string) {
		this.knownSpeakers = this.knownSpeakers.filter(n => n.toLowerCase() !== name.toLowerCase());

		for (const [uuid, assigned] of this.pending) {
			if (assigned.toLowerCase() !== name.toLowerCase()) continue;

			this.pending.set(uuid, '');
			this.lastAssignedName.set(uuid, '');

			const select = this.selectEls.get(uuid);
			if (select) select.value = '';

			const input = this.inputEls.get(uuid);
			if (input) input.value = '';
		}
	}


	// ---------------------------------------------------------------------------
	// Audio playback
	// ---------------------------------------------------------------------------

	/**
	 * Render a ▶ Play button that lazily extracts and plays the speaker's
	 * longest utterance. No-op (button hidden) if voice playback isn't
	 * available (e.g. no whisperPath/voiceClient — auto-bypass path never
	 * reaches this, but defensive in direct-construction/test scenarios).
	 */
	private renderPlayButton(container: HTMLElement, speakerUuid: string) {
		if (!this.whisperPath || !this.voiceClient) return;

		const btn = container.createEl('button', {
			text: '▶ Play',
			cls: 'voice-play-button',
		});
		this.playButtons.set(speakerUuid, btn);
		btn.addEventListener('click', () => this.togglePlayback(speakerUuid, btn));
	}

	private async togglePlayback(speakerUuid: string, btn: HTMLButtonElement) {
		// Clicking the currently-playing speaker's button pauses it
		if (this.playingUuid === speakerUuid && this.audioEl && !this.audioEl.paused) {
			this.audioEl.pause();
			return;
		}

		// Stop whatever else is playing first
		this.stopPlayback();

		let clipPath = this.clipCache.get(speakerUuid) ?? null;
		if (!clipPath) {
			btn.disabled = true;
			btn.textContent = 'Loading…';
			clipPath = await this.voiceClient!.getSpeakerClip(this.whisperPath!, speakerUuid);
			btn.disabled = false;
			if (!clipPath) {
				btn.textContent = '⚠ Unavailable';
				setTimeout(() => { btn.textContent = '▶ Play'; }, 2000);
				return;
			}
			this.clipCache.set(speakerUuid, clipPath);
		}

		// Obsidian's renderer CSP blocks `file://` as a <audio> media-src
		// (NotSupportedError, even though the file itself is valid audio) —
		// read the clip via Node fs and play it as a blob: object URL instead.
		let blobUrl = this.blobUrlCache.get(speakerUuid) ?? null;
		if (!blobUrl) {
			try {
				const { readFile } = require('fs/promises');
				const data: Buffer = await readFile(clipPath);
				const blob = new Blob([new Uint8Array(data)], { type: 'audio/mp4' });
				blobUrl = URL.createObjectURL(blob);
				this.blobUrlCache.set(speakerUuid, blobUrl);
			} catch (err) {
				console.warn(`[VoiceSpeakerAttributionModal] Failed to read clip for playback: ${err}`);
				btn.textContent = '⚠ Unavailable';
				setTimeout(() => { btn.textContent = '▶ Play'; }, 2000);
				return;
			}
		}

		if (!this.audioEl) {
			this.audioEl = new Audio();
			this.audioEl.addEventListener('ended', () => this.resetPlayButton());
			this.audioEl.addEventListener('pause', () => this.resetPlayButton());
		}

		this.audioEl.src = blobUrl;
		this.playingUuid = speakerUuid;
		btn.textContent = '⏸ Pause';
		try {
			await this.audioEl.play();
		} catch (err) {
			console.warn(`[VoiceSpeakerAttributionModal] Playback failed: ${err}`);
			this.resetPlayButton();
		}
	}

	private resetPlayButton() {
		if (this.playingUuid) {
			const btn = this.playButtons.get(this.playingUuid);
			if (btn) btn.textContent = '▶ Play';
		}
		this.playingUuid = null;
	}

	private stopPlayback() {
		if (this.audioEl && !this.audioEl.paused) {
			this.audioEl.pause();
		}
		this.resetPlayButton();
	}

	// ---------------------------------------------------------------------------
	// Buttons
	// ---------------------------------------------------------------------------

	// "Skip All" / "Clear all voice cache" now live inline in the "Needs
	// confirmation" section header (renderConfirmSection) rather than here —
	// they act on every row's Skip/Clear-voice-cache checkbox across the whole
	// modal, but are placed where users most often reach for them.
	private renderButtons(container: HTMLElement) {
		const row = container.createDiv({ cls: 'voice-buttons' });

		this.applySummaryEl = row.createEl('span', { cls: 'voice-apply-summary' });

		const applyBtn = row.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		applyBtn.addEventListener('click', () => { this.applyAndClose(); });
	}

	/**
	 * Recomputes and displays how many speakers currently have a non-blank
	 * name in `pending` (i.e. exactly what Apply will send to `applyNames`/
	 * `saveSamples`) out of the total speaker count, e.g. "Applying 2 of 6
	 * speakers". Kept live via delegated change/input listeners in onOpen()
	 * plus explicit calls from skipAllRows(), so it's always trustworthy —
	 * added after a case where the user believed 2 rows were resolved but
	 * only 1 name assignment actually reached Apply.
	 */
	private updateApplySummary() {
		if (!this.applySummaryEl) return;
		const total = this.response.speakers.length;
		const assigned = [...this.pending.values()].filter(name => name.trim().length > 0).length;
		this.applySummaryEl.textContent = `Applying ${assigned} of ${total} speaker${total !== 1 ? 's' : ''}`;
	}

	/**
	 * "Skip All": checks every row's "Skip" checkbox (Auto/Confirm rows) and
	 * resets any Unresolved row's dropdown/typed name back to blank — it does
	 * NOT close the modal. This lets the user see every row marked as skipped,
	 * still uncheck individual ones they want to keep identifying, and/or still
	 * check "Clear voice cache" on any row, before clicking Apply to finalize.
	 */
	private skipAllRows() {
		for (const s of this.response.speakers) {
			const uuid = s.speakerUuid;
			const skipCb = this.skipCheckboxEls.get(uuid);
			if (skipCb) {
				if (!skipCb.checked) {
					skipCb.checked = true;
					skipCb.dispatchEvent(new Event('change'));
				}
			} else {
				// Unresolved rows have no Skip checkbox — they default to skip via a
				// blank dropdown, so just reset the controls directly.
				this.pending.set(uuid, '');
				const select = this.selectEls.get(uuid);
				if (select) select.value = '';
				const input = this.inputEls.get(uuid);
				if (input) input.value = '';
			}
		}
		// The dispatched `change` events above don't bubble (default Event
		// options), so the delegated listener in onOpen() won't catch them —
		// update the summary explicitly instead.
		this.updateApplySummary();
	}

	/**
	 * "Clear all voice cache": checks every "Clear voice cache" checkbox that
	 * is currently *active* (i.e. enabled — only true once that row's Skip
	 * checkbox is checked). Doesn't touch disabled ones and doesn't check any
	 * Skip boxes itself — pair with "Skip All" first if a row's Clear-voice-
	 * cache checkbox needs to be enabled before this can select it. Like Skip
	 * All, doesn't close the modal or wipe anything immediately — wipes are
	 * still collected and confirmed once, in a batch, when Apply is clicked.
	 */
	private clearAllActiveWipeCheckboxes() {
		for (const cb of this.wipeCheckboxEls.values()) {
			if (!cb.disabled) {
				cb.checked = true;
			}
		}
	}

	private applyAndClose() {
		const assignments: VoiceNameAssignment[] = [];

		// pending is seeded with bestMatch for every speaker (including auto) in the
		// constructor and updated live by each row's dropdown/new-name input, so it
		// already reflects any correction — no need to special-case action === 'auto'.
		for (const s of this.response.speakers) {
			const name = this.pending.get(s.speakerUuid);
			if (name) assignments.push({ speakerUuid: s.speakerUuid, name });
		}

		this.finishWithWipes(assignments);
	}

	/**
	 * Tail end of "Apply" (Skip All no longer routes through here — it only
	 * checks Skip checkboxes so the user can review/adjust before finalizing):
	 * collect any rows whose "Clear voice cache" checkbox is checked, confirm
	 * once with the user (listing every name to be deleted), delete them via
	 * the voice client, show a summary Notice, then resolve the modal's
	 * promise with `assignments` and close.
	 *
	 * If the user cancels the combined confirm, the whole action (including
	 * the name assignments) is aborted — the modal stays open so the user
	 * can reconsider.
	 */
	private async finishWithWipes(assignments: VoiceNameAssignment[]) {
		const wipeNames = this.collectWipeTargets();

		if (wipeNames.length > 0) {
			const confirmed = window.confirm(
				`Permanently delete all stored voice samples for: ${wipeNames.join(', ')}? ` +
				`This forgets these voice profiles entirely — they will need to be re-identified from scratch next time.`,
			);
			if (!confirmed) return;

			if (this.voiceClient) {
				let deletedCount = 0;
				const failures: string[] = [];
				for (const name of wipeNames) {
					try {
						await this.voiceClient.forgetSpeaker(name);
						deletedCount++;
						this.forgetNameEverywhere(name);
					} catch (err) {
						console.error(`[VoiceSpeakerAttributionModal] forgetSpeaker failed for "${name}": ${err}`);
						failures.push(name);
					}
				}
				const summary = failures.length > 0
					? `Deleted voice samples for ${deletedCount} speaker(s). Failed: ${failures.join(', ')}.`
					: `Deleted voice samples for ${deletedCount} speaker(s).`;
				new Notice(summary);
			}
		}

		this.resolve(assignments);
		this.close();
	}

	onClose() {
		this.stopPlayback();
		if (this.audioEl) {
			this.audioEl.src = '';
			this.audioEl = null;
		}
		for (const url of this.blobUrlCache.values()) {
			URL.revokeObjectURL(url);
		}
		this.blobUrlCache.clear();
		this.contentEl.empty();
	}

	// ---------------------------------------------------------------------------
	// Static factory — auto-bypass if all speakers are high-confidence auto
	// ---------------------------------------------------------------------------

	/**
	 * Show the modal if needed. Returns Promise<VoiceNameAssignment[]>.
	 * If all speakers have action="auto", resolves immediately without opening the modal.
	 *
	 * @param whisperPath  Path to the .whisper file, used to lazily fetch playback
	 *                     clips. Pass null to disable the Play button (e.g. tests).
	 * @param voiceClient  Client used to call the whisper-speaker-id daemon's
	 *                     /extract-clip endpoint. Pass null to disable the Play button.
	 * @param sampleQuotes Map of speakerUuid -> a representative transcript excerpt,
	 *                     shown alongside confirm/unresolved speakers for text context.
	 * @param speakerStats Map of speakerUuid -> total speaking duration/segment count,
	 *                     used to pre-check "Skip" and show a "⚠ Low signal" badge for
	 *                     speakers whose stats look like diarization noise rather than
	 *                     a real distinct participant (see whisper-speaker-stats.ts).
	 */
	static show(
		app: App,
		response: VoiceAnalysisResponse,
		attendees: string[],
		whisperPath: string | null = null,
		voiceClient: VoiceAnalysisClient | null = null,
		sampleQuotes: Map<string, string> = new Map(),
		speakerStats: Map<string, WhisperSpeakerStats> = new Map(),
	): Promise<VoiceNameAssignment[]> {
		const allAuto = response.speakers.every(s => s.action === 'auto');
		if (allAuto) {
			// Bypass: build assignments from best matches directly
			const assignments = response.speakers
				.filter(s => s.bestMatch !== null)
				.map(s => ({ speakerUuid: s.speakerUuid, name: s.bestMatch! }));
			return Promise.resolve(assignments);
		}

		return new Promise(resolve => {
			new VoiceSpeakerAttributionModal(app, response, attendees, resolve, whisperPath, voiceClient, sampleQuotes, speakerStats).open();
		});
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortedNames(names: string[]): string[] {
	return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/** @deprecated use sortedNames — kept for any callers outside this file */
function uniqueNames(names: string[]): string[] {
	return sortedNames(names);
}
