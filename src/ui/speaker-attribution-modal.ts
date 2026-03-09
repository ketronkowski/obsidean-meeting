import { App, Modal, Setting } from 'obsidian';
import { SpeakerProfile, SpeakerMapping } from '../speaker-resolver';

/**
 * Modal dialog for resolving generic [Speaker N] labels to real attendee names.
 * Shows auto-detected mappings for review and lets the user assign unresolved speakers.
 */
export class SpeakerAttributionModal extends Modal {
	private unresolvedProfiles: SpeakerProfile[];
	private autoMappings: SpeakerMapping[];
	private attendees: Array<{ displayName: string; wikiLink: string }>;
	private resolve: (mappings: SpeakerMapping[]) => void;
	private pendingMappings: Map<string, string>; // speakerId → displayName (or '')
	private overrides: Map<string, string>;       // speakerId → displayName for auto-detected overrides

	constructor(
		app: App,
		unresolvedProfiles: SpeakerProfile[],
		autoMappings: SpeakerMapping[],
		attendees: Array<{ displayName: string; wikiLink: string }>,
		resolve: (mappings: SpeakerMapping[]) => void
	) {
		super(app);
		this.unresolvedProfiles = unresolvedProfiles;
		this.autoMappings = autoMappings;
		this.attendees = attendees;
		this.resolve = resolve;
		this.pendingMappings = new Map();
		this.overrides = new Map();

		// Initialize all unresolved as empty (skip)
		for (const profile of unresolvedProfiles) {
			this.pendingMappings.set(profile.speakerId, '');
		}
		// Initialize overrides as auto-detected values
		for (const mapping of autoMappings) {
			this.overrides.set(mapping.speakerId, mapping.attendeeName);
		}
	}

	onOpen() {
		console.log('[SpeakerAttributionModal] Opening modal — unresolved:', this.unresolvedProfiles.map(p => p.speakerId), 'auto:', this.autoMappings.map(m => m.speakerId));
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('speaker-attribution-modal');

		contentEl.createEl('h2', { text: '🎤 Identify Meeting Speakers' });
		contentEl.createEl('p', {
			text: 'Associate generic speaker labels with meeting attendees. Sample quotes are shown to help identify each speaker.',
			cls: 'speaker-attribution-desc'
		});

		// Auto-detected section
		if (this.autoMappings.length > 0) {
			this.renderAutoDetectedSection(contentEl);
		}

		// Unresolved section
		if (this.unresolvedProfiles.length > 0) {
			this.renderUnresolvedSection(contentEl);
		} else {
			contentEl.createEl('p', {
				text: '✅ All speakers were auto-detected. Review above and click Apply.',
				cls: 'speaker-attribution-all-resolved'
			});
		}

		// Action buttons
		this.renderButtons(contentEl);
	}

	private renderAutoDetectedSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'speaker-attribution-section' });

		const header = section.createDiv({ cls: 'speaker-attribution-section-header' });
		const toggle = header.createEl('span', {
			text: '▶',
			cls: 'speaker-attribution-toggle'
		});
		header.createEl('strong', { text: ` ✓ Auto-detected (${this.autoMappings.length})` });
		header.createEl('span', {
			text: ' — expand to review or override',
			cls: 'speaker-attribution-hint'
		});

		const body = section.createDiv({ cls: 'speaker-attribution-auto-body' });
		body.style.display = 'none';

		toggle.addEventListener('click', () => {
			const isHidden = body.style.display === 'none';
			body.style.display = isHidden ? 'block' : 'none';
			toggle.textContent = isHidden ? '▼' : '▶';
		});

		for (const mapping of this.autoMappings) {
			const row = body.createDiv({ cls: 'speaker-attribution-auto-row' });

			row.createEl('span', {
				text: `${mapping.speakerId}`,
				cls: 'speaker-attribution-speaker-label'
			});
			row.createEl('span', { text: ' → ', cls: 'speaker-attribution-arrow' });

			// Dropdown to allow override
			const select = row.createEl('select', { cls: 'speaker-attribution-select' });
			const skipOpt = select.createEl('option', { text: '— Keep auto-detected —', value: mapping.attendeeName });
			skipOpt.selected = true;

			for (const attendee of this.attendees) {
				const opt = select.createEl('option', {
					text: attendee.displayName,
					value: attendee.displayName
				});
				if (attendee.displayName === mapping.attendeeName) {
					opt.selected = true;
					skipOpt.selected = false;
				}
			}
			select.createEl('option', { text: '— Skip this speaker —', value: '' });

			select.addEventListener('change', () => {
				this.overrides.set(mapping.speakerId, select.value);
			});

			row.createEl('span', {
				text: ` (${Math.round(mapping.confidence * 100)}% confident)`,
				cls: 'speaker-attribution-confidence'
			});
		}
	}

	private renderUnresolvedSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'speaker-attribution-section' });
		section.createEl('strong', { text: `❓ Needs identification (${this.unresolvedProfiles.length})` });

		for (const profile of this.unresolvedProfiles) {
			this.renderSpeakerRow(section, profile);
		}
	}

	private renderSpeakerRow(container: HTMLElement, profile: SpeakerProfile) {
		const row = container.createDiv({ cls: 'speaker-attribution-row' });

		// Speaker label + quote count
		const labelRow = row.createDiv({ cls: 'speaker-attribution-row-header' });
		labelRow.createEl('strong', {
			text: profile.speakerId,
			cls: 'speaker-attribution-speaker-label'
		});
		labelRow.createEl('span', {
			text: ` — ${profile.lineCount} utterance${profile.lineCount !== 1 ? 's' : ''}`,
			cls: 'speaker-attribution-hint'
		});

		// Sample quotes
		if (profile.sampleQuotes.length > 0) {
			const quotes = row.createDiv({ cls: 'speaker-attribution-quotes' });
			for (const quote of profile.sampleQuotes) {
				const truncated = quote.length > 120 ? quote.substring(0, 117) + '…' : quote;
				quotes.createEl('div', { text: `"${truncated}"`, cls: 'speaker-attribution-quote' });
			}
		} else {
			row.createEl('div', {
				text: '(no substantial quotes available)',
				cls: 'speaker-attribution-hint'
			});
		}

		// Assignment dropdown
		const assignRow = row.createDiv({ cls: 'speaker-attribution-assign-row' });
		assignRow.createEl('span', { text: 'Assign to: ', cls: 'speaker-attribution-assign-label' });

		const select = assignRow.createEl('select', { cls: 'speaker-attribution-select' });
		select.createEl('option', { text: '— Skip / Unknown —', value: '' }).selected = true;

		for (const attendee of this.attendees) {
			select.createEl('option', {
				text: attendee.displayName,
				value: attendee.displayName
			});
		}

		select.addEventListener('change', () => {
			this.pendingMappings.set(profile.speakerId, select.value);
		});
	}

	private renderButtons(container: HTMLElement) {
		const buttonRow = container.createDiv({ cls: 'speaker-attribution-buttons' });

		const skipBtn = buttonRow.createEl('button', { text: 'Skip All', cls: 'mod-muted' });
		skipBtn.addEventListener('click', () => {
			console.log('[SpeakerAttributionModal] Skip All clicked');
			this.resolve([]);
			this.close();
		});

		const applyBtn = buttonRow.createEl('button', { text: 'Apply Mappings', cls: 'mod-cta' });
		applyBtn.addEventListener('click', () => {
			console.log('[SpeakerAttributionModal] Apply Mappings clicked');
			this.applyAndClose();
		});
	}

	private applyAndClose() {
		const result: SpeakerMapping[] = [];

		// Auto-detected mappings (with any overrides applied)
		for (const mapping of this.autoMappings) {
			const overrideValue = this.overrides.get(mapping.speakerId);
			const effectiveName = overrideValue !== undefined ? overrideValue : mapping.attendeeName;
			if (effectiveName) {
				const attendee = this.attendees.find(a => a.displayName === effectiveName);
				result.push({
					speakerId: mapping.speakerId,
					attendeeName: effectiveName,
					wikiLink: attendee?.wikiLink ?? effectiveName,
					confidence: mapping.confidence,
					autoDetected: true
				});
			}
		}

		// User-assigned mappings
		for (const [speakerId, displayName] of this.pendingMappings.entries()) {
			if (displayName) {
				const attendee = this.attendees.find(a => a.displayName === displayName);
				result.push({
					speakerId,
					attendeeName: displayName,
					wikiLink: attendee?.wikiLink ?? displayName,
					confidence: 1.0,
					autoDetected: false
				});
			}
		}

		console.log('[SpeakerAttributionModal] Applying mappings:', result.map(m => `${m.speakerId} → ${m.attendeeName}`));
		this.resolve(result);
		this.close();
	}

	onClose() {
		console.log('[SpeakerAttributionModal] Modal closed');
		const { contentEl } = this;
		contentEl.empty();
	}
}
