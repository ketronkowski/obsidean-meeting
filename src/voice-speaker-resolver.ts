import { App, Notice, TFile } from 'obsidian';
import { homedir } from 'os';
import { MeetingProcessorSettings } from './ui/settings-tab';
import { StatusBarManager } from './ui/status-bar';
import { CopilotWorkingModal } from './ui/copilot-working-modal';
import { VoiceAnalysisClient } from './voice-analysis-client';
import { VoiceSpeakerAttributionModal } from './ui/voice-speaker-attribution-modal';
import { VoiceNameAssignment } from './voice-analysis-types';
import { extractAttendeeLinks, extractTranscriptText } from './speaker-resolver';

/**
 * Shared helper that runs voice-based speaker identification on .whisper embeds.
 * Used by both GeneralMeetingHandler and StandupMeetingHandler so the logic
 * is not duplicated.
 */
export class VoiceSpeakerResolver {
	private app: App;
	private statusBar: StatusBarManager;
	private voiceClient: VoiceAnalysisClient;
	private macWhisperTranscriptsDir: string;

	constructor(app: App, settings: MeetingProcessorSettings, statusBar: StatusBarManager) {
		this.app = app;
		this.statusBar = statusBar;
		this.macWhisperTranscriptsDir = settings.macWhisperTranscriptsDir ?? '';
		this.voiceClient = new VoiceAnalysisClient({
			enabled: settings.voiceServiceEnabled,
			binaryPath: settings.voiceServiceBinaryPath,
			port: settings.voiceServicePort,
			autoStart: settings.voiceServiceAutoStart,
		});
	}

	updateSettings(settings: MeetingProcessorSettings): void {
		this.voiceClient.updateSettings({
			enabled: settings.voiceServiceEnabled,
			binaryPath: settings.voiceServiceBinaryPath,
			port: settings.voiceServicePort,
			autoStart: settings.voiceServiceAutoStart,
		});
	}

	/** Return all speaker names in the reference library (empty if service unavailable). */
	async getKnownSpeakers(): Promise<string[]> {
		return this.voiceClient.getKnownSpeakers();
	}

	/**
	 * Run voice analysis on a .whisper embed in the meeting note, then write
	 * real names back into the .whisper file so later processing steps see them.
	 *
	 * MUST be called BEFORE expandTranscriptEmbed (which consumes the embed path)
	 * and BEFORE processAttendees (which reads the .whisper speakers array).
	 *
	 * @param attendeeHints  Names already known (e.g. from screenshots) to seed the
	 *                       modal's candidate list even before the Attendees section
	 *                       is written.  Merged with any wiki-link attendees found in
	 *                       the note.
	 * @returns the VoiceNameAssignment[] that were applied, or [] on skip/failure.
	 */
	async identifyWhisperSpeakers(file: TFile, attendeeHints: string[] = []): Promise<VoiceNameAssignment[]> {
		const content = await this.app.vault.read(file);
		const rawTranscript = extractTranscriptText(content);

		if (!rawTranscript) return [];

		// Resolve whisper file by meeting name (preferred) or embed reference
		const embedText = rawTranscript.length < 300 && rawTranscript.includes('.whisper')
			? rawTranscript : undefined;
		const whisperPath = this.resolveWhisperForMeeting(file, embedText);
		if (!whisperPath) {
			console.log('[VoiceSpeakerResolver] No .whisper file found for meeting, skipping voice analysis');
			return [];
		}

		console.log('[VoiceSpeakerResolver] .whisper file at:', whisperPath);

		const workingModal = new CopilotWorkingModal(
			this.app,
			'Starting voice analysis service…',
			'🎙️ Voice Analysis',
		);
		workingModal.open();

		try {
			this.statusBar.show('Starting voice analysis service...', 0);
			const connected = await this.voiceClient.connect();
			if (!connected) {
				workingModal.close();
				new Notice('Voice analysis unavailable — falling back to text-based speaker matching.');
				console.warn('[VoiceSpeakerResolver] Voice service unavailable');
				return [];
			}

			workingModal.updateStatus('Analyzing voice patterns…');
			this.statusBar.show('Analyzing voice patterns...', 0);
			const response = await this.voiceClient.analyzeWhisperFile(whisperPath);
			workingModal.close();

			if (!response || response.speakers.length === 0) {
				console.warn('[VoiceSpeakerResolver] Voice analysis returned no speakers');
				return [];
			}

			// Build attendee names for the modal's dropdown.
			// Merge wiki-link attendees already in the note with any pre-extracted hints
			// (e.g. screenshot attendees extracted before this method was called).
			const attendeeLinks = extractAttendeeLinks(content);
			const noteAttendeeNames = attendeeLinks.map(a => a.displayName);
			const hintSet = new Set(attendeeHints.map(n => n.toLowerCase()));
			const mergedAttendees = [
				...attendeeHints,
				...noteAttendeeNames.filter(n => !hintSet.has(n.toLowerCase())),
			];

			// Show modal (auto-bypasses when all speakers ≥ 75% confidence).
			// Pass whisperPath + voiceClient so the modal's Play buttons can
			// lazily fetch audio clips via the daemon's /extract-clip endpoint.
			const assignments = await VoiceSpeakerAttributionModal.show(
				this.app,
				response,
				mergedAttendees,
				whisperPath,
				this.voiceClient,
			);

			if (assignments.length === 0) {
				console.log('[VoiceSpeakerResolver] No assignments made, skipping writeback');
				return [];
			}

			// Write names back to the .whisper file
			const nameMap: Record<string, string> = {};
			for (const a of assignments) nameMap[a.speakerUuid] = a.name;
			await this.voiceClient.applyNames(whisperPath, nameMap);
			console.log('[VoiceSpeakerResolver] Applied', assignments.length, 'speaker names to .whisper file');

			// Save voice samples for future auto-identification
			const usedCliMode = !(await this.voiceClient.checkHealth());
			await this.voiceClient.saveSamples(whisperPath, assignments, usedCliMode);

			const autoCount = response.speakers.filter(s => s.action === 'auto').length;
			if (autoCount === response.speakers.length) {
				new Notice(`✓ Identified ${assignments.length} speaker${assignments.length !== 1 ? 's' : ''} by voice automatically.`);
			}

			return assignments;

		} catch (err) {
			workingModal.close();
			console.error('[VoiceSpeakerResolver] Unexpected error:', err);
			new Notice('Voice analysis failed — falling back to text-based speaker matching.');
			return [];
		}
	}

	/**
	 * Find the .whisper file for a meeting, trying in priority order:
	 * 1. MacWhisper transcripts dir + meeting basename (e.g. "2026-07-02 - My Meeting.whisper")
	 * 2. MacWhisper transcripts dir + embed filename (if a .whisper embed exists in the note)
	 * 3. Vault Media / Attachments paths (vault copy, may be stale)
	 *
	 * Pass `rawTranscript` to also try matching against an embedded filename.
	 */
	resolveWhisperForMeeting(meetingFile: TFile, rawTranscript?: string): string | null {
		const { existsSync } = require('fs');

		if (this.macWhisperTranscriptsDir) {
			const sourceDir = this.macWhisperTranscriptsDir.replace(/^~/, homedir());

			// 1. Try meeting basename → same-name .whisper in MacWhisper dir
			const byName = `${sourceDir}/${meetingFile.basename}.whisper`;
			if (existsSync(byName)) {
				console.log('[VoiceSpeakerResolver] Found MacWhisper file by meeting name:', byName);
				return byName;
			}

			// 2. Try embed filename in MacWhisper dir
			if (rawTranscript) {
				const embedFilename = rawTranscript.replace(/!?\[\[/g, '').replace(/\]\]/g, '').trim();
				if (embedFilename.toLowerCase().endsWith('.whisper')) {
					const byEmbed = `${sourceDir}/${embedFilename}`;
					if (existsSync(byEmbed)) {
						console.log('[VoiceSpeakerResolver] Found MacWhisper file by embed name:', byEmbed);
						return byEmbed;
					}
				}
			}
		}

		// 3. Fall back to vault paths using embed filename
		const embedFilename = rawTranscript
			? rawTranscript.replace(/!?\[\[/g, '').replace(/\]\]/g, '').trim()
			: `${meetingFile.basename}.whisper`;

		if (embedFilename.startsWith('/')) return embedFilename;
		if (embedFilename.startsWith('~')) return embedFilename.replace(/^~/, homedir());

		if (embedFilename.toLowerCase().endsWith('.whisper')) {
			const adapter = this.app.vault.adapter as any;
			if (typeof adapter.getFullPath === 'function') {
				for (const p of [embedFilename, `Media/${embedFilename}`, `Attachments/${embedFilename}`]) {
					const vaultFile = this.app.vault.getAbstractFileByPath(p);
					if (vaultFile instanceof TFile) {
						return adapter.getFullPath(vaultFile.path);
					}
				}
			}
		}

		return null;
	}
}
