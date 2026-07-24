import { App, Modal } from 'obsidian';
import { VoiceAnalysisResponse, VoiceNameAssignment, VoiceSpeakerResult } from '../voice-analysis-types';
import { VoiceAnalysisClient } from '../voice-analysis-client';

const AUTO_THRESHOLD = 0.75;

/**
 * Modal for resolving speakers using voice analysis results from whisper-speaker-id.
 *
 * Sections:
 *   - Auto (collapsible): high-confidence auto-assigned speakers
 *   - Confirm: borderline matches needing user confirmation
 *   - Unresolved: low-confidence speakers that need manual assignment
 *
 * Each speaker row also has a ▶ Play button that lazily extracts (via the
 * whisper-speaker-id daemon) and plays their longest utterance, to help the
 * user identify who's who by voice in addition to reading sample quotes.
 */
export class VoiceSpeakerAttributionModal extends Modal {
	private response: VoiceAnalysisResponse;
	private attendees: string[];
	private resolve: (assignments: VoiceNameAssignment[]) => void;
	private whisperPath: string | null;
	private voiceClient: VoiceAnalysisClient | null;

	// Per-UUID pending name decisions (empty string = skip)
	private pending: Map<string, string>;

	// Audio playback state — one shared <audio> element so only one clip plays at a time
	private audioEl: HTMLAudioElement | null = null;
	private clipCache: Map<string, string> = new Map(); // speakerUuid -> local clip path
	private playingUuid: string | null = null;
	private playButtons: Map<string, HTMLButtonElement> = new Map();

	constructor(
		app: App,
		response: VoiceAnalysisResponse,
		attendees: string[],
		resolve: (assignments: VoiceNameAssignment[]) => void,
		whisperPath: string | null = null,
		voiceClient: VoiceAnalysisClient | null = null,
	) {
		super(app);
		this.response = response;
		this.attendees = attendees;
		this.resolve = resolve;
		this.whisperPath = whisperPath;
		this.voiceClient = voiceClient;
		this.pending = new Map();

		// Initialize with suggested names
		for (const s of response.speakers) {
			this.pending.set(s.speakerUuid, s.bestMatch ?? '');
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
	}

	// ---------------------------------------------------------------------------
	// Sections
	// ---------------------------------------------------------------------------

	private renderAutoSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const section = container.createDiv({ cls: 'voice-section' });

		const header = section.createDiv({ cls: 'voice-section-header' });
		const toggle = header.createEl('span', { text: '▶', cls: 'voice-section-toggle' });
		header.createEl('strong', { text: ` ✓ Auto-identified (${speakers.length})` });
		header.createEl('span', {
			text: ' — expand to review',
			cls: 'voice-section-hint',
		});

		const body = section.createDiv({ cls: 'voice-section-body' });
		body.style.display = 'none';

		toggle.addEventListener('click', () => {
			const hidden = body.style.display === 'none';
			body.style.display = hidden ? 'block' : 'none';
			toggle.textContent = hidden ? '▼' : '▶';
		});

		for (const s of speakers) {
			const row = body.createDiv({ cls: 'voice-row' });
			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			row.createEl('span', { text: ' → ', cls: 'voice-arrow' });
			row.createEl('span', { text: s.bestMatch ?? '', cls: 'voice-assigned-name' });
			if (s.bestMatch && this.attendees.some(a => a.toLowerCase() === s.bestMatch!.toLowerCase())) {
				row.createEl('span', { text: '👤', cls: 'voice-attendee-badge' });
			}
			this.renderScoreBadge(row, s.score);
			this.renderPlayButton(row, s.speakerUuid);
		}
	}

	private renderConfirmSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const section = container.createDiv({ cls: 'voice-section' });
		section.createEl('strong', { text: `❓ Needs confirmation (${speakers.length})` });

		for (const s of speakers) {
			const row = section.createDiv({ cls: 'voice-row' });

			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			this.renderScoreBadge(row, s.score);
			this.renderPlayButton(row, s.speakerUuid);

			const assignRow = row.createDiv({ cls: 'voice-assign-row' });
			const select = this.buildDropdown(assignRow, s.bestMatch ?? '');
			select.addEventListener('change', () => this.pending.set(s.speakerUuid, select.value));

			this.renderNewNameInput(row, s.speakerUuid);
		}
	}

	private renderSkipSection(container: HTMLElement, speakers: VoiceSpeakerResult[]) {
		const section = container.createDiv({ cls: 'voice-section' });
		section.createEl('strong', { text: `🔍 Unresolved speakers (${speakers.length})` });

		for (const s of speakers) {
			const row = section.createDiv({ cls: 'voice-row' });
			row.createEl('span', { text: s.displayName, cls: 'voice-speaker-label' });
			this.renderPlayButton(row, s.speakerUuid);

			const assignRow = row.createDiv({ cls: 'voice-assign-row' });
			assignRow.createEl('span', { text: 'Assign to: ', cls: 'voice-assign-label' });

			const select = this.buildDropdown(assignRow, '');
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
		const otherSpeakers = this.response.knownSpeakers.filter(
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

	private renderNewNameInput(container: HTMLElement, uuid: string) {
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
		for (const name of sortedNames(this.response.knownSpeakers)) {
			if (!attendeeSet.has(name.toLowerCase())) {
				datalist.createEl('option', { value: name });
			}
		}

		const input = inputRow.createEl('input', {
			type: 'text',
			cls: 'voice-new-name-input',
			placeholder: 'New speaker name…',
		} as DomElementInfo & { type: string; placeholder: string });
		(input as HTMLInputElement).setAttribute('list', datalistId);
		input.addEventListener('input', () => {
			if ((input as HTMLInputElement).value.trim()) {
				this.pending.set(uuid, (input as HTMLInputElement).value.trim());
			}
		});
	}

	private renderScoreBadge(container: HTMLElement, score: number) {
		const pct = Math.round(score * 100);
		const cls = pct >= 75 ? 'voice-score-high'
			: pct >= 50 ? 'voice-score-mid'
			: 'voice-score-low';
		container.createEl('span', {
			text: `Voice match: ${pct}%`,
			cls: `voice-score-badge ${cls}`,
		});
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

		if (!this.audioEl) {
			this.audioEl = new Audio();
			this.audioEl.addEventListener('ended', () => this.resetPlayButton());
			this.audioEl.addEventListener('pause', () => this.resetPlayButton());
		}

		this.audioEl.src = `file://${clipPath}`;
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

	private renderButtons(container: HTMLElement) {
		const row = container.createDiv({ cls: 'voice-buttons' });

		const skipBtn = row.createEl('button', { text: 'Skip All', cls: 'mod-muted' });
		skipBtn.addEventListener('click', () => { this.resolve([]); this.close(); });

		const applyBtn = row.createEl('button', { text: 'Apply', cls: 'mod-cta' });
		applyBtn.addEventListener('click', () => { this.applyAndClose(); });
	}

	private applyAndClose() {
		const assignments: VoiceNameAssignment[] = [];

		// Include auto-assigned speakers
		for (const s of this.response.speakers) {
			if (s.action === 'auto' && s.bestMatch) {
				assignments.push({ speakerUuid: s.speakerUuid, name: s.bestMatch });
				continue;
			}
			// Confirm / skip: use whatever is in pending
			const name = this.pending.get(s.speakerUuid);
			if (name) assignments.push({ speakerUuid: s.speakerUuid, name });
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
	 */
	static show(
		app: App,
		response: VoiceAnalysisResponse,
		attendees: string[],
		whisperPath: string | null = null,
		voiceClient: VoiceAnalysisClient | null = null,
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
			new VoiceSpeakerAttributionModal(app, response, attendees, resolve, whisperPath, voiceClient).open();
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
