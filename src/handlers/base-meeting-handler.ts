import { App, Notice, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';
import { PeopleManager, isValidPersonName } from '../people-manager';
import { StatusBarManager } from '../ui/status-bar';
import { SpeakerAttributionModal } from '../ui/speaker-attribution-modal';
import { VoiceSpeakerResolver } from '../voice-speaker-resolver';
import {
	extractSpeakerProfiles,
	extractAttendeeLinks,
	autoDetectMappings,
	computeBestGuesses,
	rewriteTranscript,
	extractTranscriptText,
	countDistinctSpeakerLabels,
} from '../speaker-resolver';
import { cleanCopilotOutput } from '../output-cleaner';
import { getSection, replaceSection, upsertSection } from '../section-utils';
import * as mammoth from 'mammoth';
import * as JSZip from 'jszip';
import { readFile } from 'fs/promises';
import { homedir } from 'os';

export abstract class BaseMeetingHandler {
	protected app: App;
	protected settings: MeetingProcessorSettings;
	protected copilotClient: CopilotClientManager;
	protected skillLoader: SkillLoader;
	protected transcriptDetector: TranscriptDetector;
	protected peopleManager: PeopleManager;
	protected statusBar: StatusBarManager;
	protected voiceResolver: VoiceSpeakerResolver;

	constructor(
		app: App,
		settings: MeetingProcessorSettings,
		copilotClient: CopilotClientManager,
		skillLoader: SkillLoader,
		statusBar: StatusBarManager,
	) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
		this.peopleManager = new PeopleManager(app);
		this.statusBar = statusBar;
		this.voiceResolver = new VoiceSpeakerResolver(app, settings, statusBar);
	}

	protected async expandTranscriptEmbed(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const rawTranscript = extractTranscriptText(content);

		if (!rawTranscript) {
			const fallback = await this.resolveNonEmbedTranscript(file, content, rawTranscript);
			if (!fallback) {
				console.log('[expandTranscriptEmbed] No transcript section found');
				return;
			}
			await this.writeExpandedTranscript(file, content, fallback.sourceRef, fallback.text, true);
			return;
		}

		const isEmbed = rawTranscript.length < 300 && (
			rawTranscript.includes('![[') ||
			rawTranscript.includes('.txt') ||
			rawTranscript.includes('.docx') ||
			rawTranscript.includes('.json') ||
			rawTranscript.includes('.whisper')
		);

		if (!isEmbed) {
			const fallback = await this.resolveNonEmbedTranscript(file, content, rawTranscript);
			if (!fallback) {
				console.log('[expandTranscriptEmbed] Transcript is already inline text, skipping');
				return;
			}
			await this.writeExpandedTranscript(file, content, fallback.sourceRef, fallback.text, true);
			return;
		}

		console.log('[expandTranscriptEmbed] Expanding embed:', rawTranscript.trim());
		const resolved = await this.resolveTranscriptContent(rawTranscript);
		if (!resolved || resolved.length < 20) {
			console.warn('[expandTranscriptEmbed] Could not resolve embed content, leaving as-is');
			return;
		}

		await this.writeExpandedTranscript(file, content, rawTranscript, resolved, false);
	}

	protected async resolveSpeakers(file: TFile): Promise<void> {
		console.log('[resolveSpeakers] Starting...');

		const content = await this.app.vault.read(file);
		const rawTranscript = extractTranscriptText(content);

		console.log('[resolveSpeakers] Raw transcript section length:', rawTranscript.length, '— preview:', rawTranscript.substring(0, 80));

		if (!rawTranscript) {
			console.log('[resolveSpeakers] No transcript section found, skipping');
			return;
		}

		if (this.shouldSkipSpeakerResolution(rawTranscript)) {
			console.log('[resolveSpeakers] Speaker resolution skipped for this transcript');
			return;
		}

		const transcriptText = await this.resolveTranscriptContent(rawTranscript);
		if (!transcriptText) {
			console.warn('[resolveSpeakers] Could not resolve transcript content, skipping');
			return;
		}

		console.log('[resolveSpeakers] Resolved transcript length:', transcriptText.length);

		if (!/\[Speaker \d+\]/i.test(transcriptText)) {
			console.log('[resolveSpeakers] No [Speaker N] labels found in transcript, skipping');
			return;
		}

		const attendees = extractAttendeeLinks(content);
		console.log('[resolveSpeakers] Attendees found:', attendees.map(a => a.displayName));

		const vaultPeople = this.peopleManager.getAllPeople();
		const attendeeNames = new Set(attendees.map(a => a.displayName.toLowerCase()));
		const allCandidates = [
			...attendees,
			...vaultPeople.filter(p => !attendeeNames.has(p.displayName.toLowerCase())),
		];

		const extraCandidates = await this.getAdditionalSpeakerCandidates(allCandidates);
		for (const candidate of extraCandidates) {
			if (!allCandidates.some(existing => existing.displayName.toLowerCase() === candidate.displayName.toLowerCase())) {
				allCandidates.push(candidate);
			}
		}

		console.log('[resolveSpeakers] All candidates for modal:', allCandidates.length);

		if (allCandidates.length === 0) {
			console.log('[resolveSpeakers] No candidates found, skipping');
			return;
		}

		const profiles = extractSpeakerProfiles(transcriptText);
		console.log('[resolveSpeakers] Speaker profiles extracted:', profiles.map(p => `${p.speakerId}(${p.lineCount} lines)`));

		if (profiles.length === 0) {
			console.log('[resolveSpeakers] No speaker profiles extracted, skipping');
			return;
		}

		const autoMappings = autoDetectMappings(profiles, allCandidates);
		const resolvedIds = new Set(autoMappings.map(m => m.speakerId));
		const unresolvedProfiles = profiles.filter(p => !resolvedIds.has(p.speakerId));
		const bestGuesses = computeBestGuesses(unresolvedProfiles, allCandidates);

		console.log('[resolveSpeakers] Auto-detected mappings:', autoMappings.map(m => `${m.speakerId} → ${m.attendeeName} (${Math.round(m.confidence * 100)}%)`));
		console.log('[resolveSpeakers] Unresolved speakers:', unresolvedProfiles.map(p => p.speakerId));
		console.log('[resolveSpeakers] Opening SpeakerAttributionModal...');

		const finalMappings = await new Promise<typeof autoMappings>((resolve) => {
			new SpeakerAttributionModal(
				this.app,
				unresolvedProfiles,
				autoMappings,
				allCandidates,
				bestGuesses,
				resolve,
			).open();
		});

		console.log('[resolveSpeakers] Modal closed, final mappings:', finalMappings.map(m => `${m.speakerId} → ${m.attendeeName}`));

		if (finalMappings.length === 0) {
			console.log('[resolveSpeakers] No mappings to apply');
			return;
		}

		const isEmbed = rawTranscript.includes('![[') || (rawTranscript.length < 300 && (rawTranscript.includes('.txt') || rawTranscript.includes('.json')));
		let rewrittenTranscript = transcriptText;
		for (const mapping of finalMappings) {
			const pattern = new RegExp(`\\[${mapping.speakerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'g');
			rewrittenTranscript = rewrittenTranscript.replace(pattern, `[${mapping.attendeeName}]`);
		}

		let updatedContent: string;
		if (isEmbed) {
			updatedContent = content.replace(
				/# Transcript\s*\n[\s\S]*?(?=\n# [^#]|$)/,
				`# Transcript\n\n${rewrittenTranscript}\n\n`,
			);
			console.log('[resolveSpeakers] Expanded embed to inline transcript with speaker names');
		} else {
			updatedContent = rewriteTranscript(content, finalMappings);
		}

		if (updatedContent !== content) {
			await this.app.vault.modify(file, updatedContent);
			console.log(`[resolveSpeakers] Applied ${finalMappings.length} speaker mappings to transcript`);
		} else {
			console.log('[resolveSpeakers] No changes made (content unchanged)');
		}
	}

	/**
	 * Safety net for the "everyone got merged into one speaker" failure mode: some
	 * transcription engines (e.g. Apple's native/on-device speech engine used by
	 * MacWhisper) don't diarize multiple speakers at all — they produce a single voice
	 * stream and pre-label it with a real name (often the recording device's owner)
	 * instead of a generic "Speaker N" placeholder. Downstream tooling (our cleaners,
	 * and the whisper-speaker-id voice-matching daemon, which intentionally skips
	 * already-named speakers) then has nothing to disambiguate, and no error is ever
	 * raised — the note just silently ends up with the whole meeting attributed to one
	 * person. Warn the user so this doesn't go unnoticed.
	 */
	protected async warnIfSpeakerCountMismatch(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const transcript = getSection(content, 'Transcript');
		if (!transcript || transcript.length < 20) return;

		const attendees = extractAttendeeLinks(content);
		if (attendees.length <= 1) return; // nothing to mismatch against

		const speakerCount = countDistinctSpeakerLabels(transcript);

		if (speakerCount === 1) {
			console.warn(
				`[warnIfSpeakerCountMismatch] Transcript has only 1 distinct speaker label but ` +
				`${attendees.length} attendees are listed — the recording likely wasn't diarized ` +
				`(check the MacWhisper transcription engine/model and audio capture settings).`
			);
			new Notice(
				`⚠️ Transcript for "${file.basename}" has only 1 speaker but ${attendees.length} attendees were listed. ` +
				`The recording may not have been diarized (check MacWhisper's transcription engine) — review the transcript before trusting the summary.`,
				10000,
			);
		}
	}

	protected hasCopilotSummary(content: string): boolean {
		const summaryContent = getSection(content, 'Copilot Summary');
		if (!summaryContent || summaryContent.startsWith('#')) return false;

		let normalized = summaryContent;
		if (this.shouldStripDisclaimerForCopilotSummaryCheck()) {
			const disclaimerPatterns = [
				/AI-generated content.*?may be incorrect.*?\[Learn more\]\([^)]+\)/gi,
				/AI-generated content.*?may not be accurate.*?\[Learn more\]\([^)]+\)/gi,
				/This summary was generated by AI.*?may be incorrect.*?\[Learn more\]\([^)]+\]/gi,
				/\[Learn more\]\([^)]+\)/gi,
			];
			for (const pattern of disclaimerPatterns) {
				normalized = normalized.replace(pattern, '').trim();
			}
		}

		return normalized.length >= this.getCopilotSummaryMinLength();
	}

	protected async processAttendees(file: TFile, content: string): Promise<void> {
		console.log('Processing attendees...');

		const currentContent = await this.getAttendeeProcessingContent(file, content);
		const attendeesContent = getSection(currentContent, 'Attendees');

		if (this.shouldSkipAttendeeProcessing(attendeesContent)) {
			console.log('Attendees section already has wiki-links — skipping attendee processing');
			return;
		}

		const screenshots = this.extractScreenshotReferences(attendeesContent);
		let extractedNames: string[] = [];

		if (screenshots.length > 0) {
			console.log(`Found ${screenshots.length} screenshots for attendee extraction`);
			extractedNames = await this.extractFromScreenshots(file, screenshots);
		}

		extractedNames = await this.mergeSupplementalAttendees(file, currentContent, extractedNames);

		if (extractedNames.length === 0) {
			console.log('Falling back to content extraction');
			extractedNames = await this.extractFromContent(currentContent);
		}

		if (extractedNames.length > 0) {
			console.log(`Extracted ${extractedNames.length} attendees:`, extractedNames);
			await this.updateAttendeesSection(file, extractedNames);
		} else {
			console.log('No attendees extracted');
		}
	}

	protected async extractFromScreenshots(file: TFile, screenshots: string[]): Promise<string[]> {
		console.log('Extracting attendees from screenshots using vision...');

		const allNames: Set<string> = new Set();
		let visionFailed = false;

		for (const screenshot of screenshots) {
			try {
				const imagePath = this.app.metadataCache.getFirstLinkpathDest(screenshot, file.path);
				if (!imagePath) {
					console.warn(`Screenshot not found: ${screenshot}`);
					continue;
				}

				console.log(`Processing screenshot: ${screenshot}`);
				const adapter = this.app.vault.adapter;
				const fullPath = (adapter as any).getFullPath(imagePath.path);
				console.log('Full image path:', fullPath);

				const prompt = 'Extract all participant names from this Microsoft Teams meeting screenshot. Output ONLY a comma-separated list of full names like: "First Last, First Last". No other text or explanation.';
				console.log('Using Copilot CLI directly for vision analysis...');
				const response = await this.copilotClient.analyzeImageWithCLI(fullPath, prompt, 'Analyzing attendee screenshot…');
				console.log('Vision response:', response);

				if (this.isScreenshotVisionFailure(response)) {
					console.warn('Vision analysis failed, will fall back to content extraction');
					visionFailed = true;
					break;
				}

				let namesList = response.trim();
				if (namesList.includes('\n')) {
					const lines = namesList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
					const namesLine = lines.find(l => l.includes(',') && !l.includes(':') && l.split(',').length > 1);
					if (namesLine) {
						namesList = namesLine;
					}
				}

				if (namesList && namesList !== 'NO_NAMES_FOUND') {
					const names = this.parseScreenshotNames(namesList);
					names.forEach(name => allNames.add(name));
					console.log(`Extracted ${names.length} names from ${screenshot}:`, names);
				}
			} catch (error) {
				console.error(`Error processing screenshot ${screenshot}:`, error);
				visionFailed = true;
			}
		}

		if (visionFailed || allNames.size === 0) {
			console.log('Vision extraction failed or returned no names, falling back to content extraction');
			return [];
		}

		return Array.from(allNames);
	}

	protected async extractFromContent(content: string): Promise<string[]> {
		console.log('Extracting attendees from content (fallback - limited capability)...');

		const speakers = new Set<string>();
		const jiraKeyPattern = /^[A-Z]+-\d+$/;
		const speakerNumberPattern = /^Speaker \d+$/i;
		const fileExtPattern = /\.(docx?|pdf|xlsx?|pptx?|txt|md)$/i;
		const bracketPattern = /(?<!\[)\[([^\[\]]+)\](?!\])/g;
		let match;

		while ((match = bracketPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			if (!speaker.includes('.png') &&
				!speaker.includes('.jpg') &&
				!fileExtPattern.test(speaker) &&
				!speaker.includes('/') &&
				speaker.length > 3 &&
				speaker.length < 50 &&
				/[a-zA-Z]/.test(speaker) &&
				!jiraKeyPattern.test(speaker) &&
				!speakerNumberPattern.test(speaker) &&
				speaker !== 'Learn more' &&
				!/[[\]|{}<>!]/.test(speaker) &&
				!/^[A-Z]+-\d+$/.test(speaker)) {
				speakers.add(speaker);
			}
		}

		const boldPattern = /\*\*([^*:]+):\*\*/g;
		while ((match = boldPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			if (speaker.length > 3 &&
				speaker.length < 50 &&
				!speakerNumberPattern.test(speaker) &&
				!jiraKeyPattern.test(speaker)) {
				speakers.add(speaker);
			}
		}

		const speakersArray = Array.from(speakers);
		const filtered = speakersArray.filter(name => {
			if (!name.includes('|')) {
				const hasWikiVersion = speakersArray.some(other =>
					other.includes('|') && other.includes(name),
				);
				return !hasWikiVersion;
			}
			return true;
		});

		console.log(`Found ${filtered.length} unique attendees (after deduplication):`, filtered);

		const allGeneric = filtered.every(s => speakerNumberPattern.test(s));
		if (allGeneric && filtered.length > 0) {
			console.warn('Only generic speaker labels found (Speaker 1, Speaker 2, etc.). Vision API would provide real names from screenshots.');
		}

		return filtered;
	}

	protected async updateAttendeesSection(file: TFile, names: string[]): Promise<void> {
		console.log('Updating Attendees section...');
		const content = await this.app.vault.read(file);
		const newContent = await this.buildUpdatedAttendeesContent(content, names);
		if (!newContent || newContent === content) {
			if (!newContent) {
				console.warn('Attendees section not found in file');
			}
			return;
		}
		await this.app.vault.modify(file, newContent);
		console.log('Attendees section updated');
	}

	protected arrayBufferToBase64(buffer: ArrayBuffer): string {
		let binary = '';
		const bytes = new Uint8Array(buffer);
		const len = bytes.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	protected async cleanTranscript(file: TFile): Promise<void> {
		console.log('[cleanTranscript] Starting...');

		const content = await this.app.vault.read(file);
		const rawTranscript = getSection(content, 'Transcript');
		if (!rawTranscript || rawTranscript.length < 10) {
			console.log('[cleanTranscript] Transcript section is empty or too short');
			return;
		}

		console.log('[cleanTranscript] Raw transcript length:', rawTranscript.length, '— preview:', rawTranscript.substring(0, 80));

		if (rawTranscript.includes('<!-- whisper-source -->')) {
			// expandTranscriptEmbed() already ran the correct cleaner (e.g. MacWhisper) on
			// this transcript before prepending the sentinel. Re-running detectAndClean()
			// here would re-detect the already-clean "[Name]\nUtterance" text as matching
			// GoogleRecorderCleaner's pattern (any "[text]" on its own line) and reformat
			// it a second time, which treats the sentinel comment line as pre-speaker
			// "preamble" and merges it into the first speaker's utterance — corrupting the
			// transcript (e.g. "[Name]\n<!-- whisper-source --> First words..."). Skip the
			// redundant re-clean; this transcript is already in its final form. The sentinel
			// has now served its purpose (resolveSpeakers() already used it to skip the
			// modal), so strip it here before it's left permanently visible in the note.
			console.log('[cleanTranscript] Transcript sourced from .whisper file and already cleaned by expandTranscriptEmbed — skipping re-clean');
			const stripped = rawTranscript.replace(/^<!-- whisper-source -->\n?/, '');
			if (stripped !== rawTranscript) {
				const newContent = replaceSection(content, 'Transcript', stripped);
				await this.app.vault.modify(file, newContent);
				console.log('[cleanTranscript] Stripped whisper-source sentinel from transcript');
			}
			return;
		}

		const resolvedText = await this.resolveTranscriptContent(rawTranscript);
		if (!resolvedText) {
			console.warn('[cleanTranscript] Could not resolve transcript content, skipping clean');
			return;
		}

		console.log('[cleanTranscript] Resolved transcript length:', resolvedText.length);

		const result = this.transcriptDetector.detectAndClean(resolvedText);
		console.log(`[cleanTranscript] Cleaned using: ${result.cleaner}, output length: ${result.cleaned.length}`);

		if (!result.cleaned || result.cleaned.length < 10) {
			console.warn('[cleanTranscript] Cleaner produced empty output, skipping write to avoid data loss');
			return;
		}

		const newContent = content.replace(
			/# Transcript\s*\n[\s\S]*?(?=\n# [^#]|$)/,
			`# Transcript\n\n${result.cleaned}\n\n`,
		);

		await this.app.vault.modify(file, newContent);
		console.log('[cleanTranscript] Transcript cleaned and saved');
	}

	protected async resolveTranscriptContent(rawTranscript: string, isAbsolutePath = false): Promise<string | null> {
		if (isAbsolutePath) {
			try {
				const isWhisperFile = rawTranscript.toLowerCase().endsWith('.whisper');
				if (isWhisperFile) {
					const buffer = await readFile(rawTranscript);
					const zip = await JSZip.loadAsync(buffer);
					const metaEntry = zip.file('metadata.json');
					if (!metaEntry) throw new Error('.whisper file is missing metadata.json');
					const text = await metaEntry.async('text');
					console.log('[resolveTranscriptContent] Read whisper by absolute path, length:', text.length);
					return text;
				}
				const text = await readFile(rawTranscript, 'utf-8');
				console.log('[resolveTranscriptContent] Read file by absolute path, length:', text.length);
				return text;
			} catch (e) {
				console.error('[resolveTranscriptContent] Failed to read absolute path:', rawTranscript, e);
				return null;
			}
		}

		const isEmbedRef = rawTranscript.length < 300 && (
			rawTranscript.includes('.docx') ||
			rawTranscript.includes('.doc') ||
			rawTranscript.includes('.txt') ||
			rawTranscript.includes('.json') ||
			rawTranscript.includes('.whisper') ||
			rawTranscript.includes('![[')
		);

		if (!isEmbedRef) {
			console.log('[resolveTranscriptContent] Already inline text, length:', rawTranscript.length);
			return rawTranscript;
		}

		console.log('[resolveTranscriptContent] Detected embed/file reference:', rawTranscript.substring(0, 80));

		try {
			let filename = rawTranscript;
			filename = filename.replace(/!?\[\[/g, '').replace(/\]\]/g, '').trim();
			console.log('[resolveTranscriptContent] Extracted filename:', filename);

			const embeddedIsAbsolutePath = filename.startsWith('/');
			const isHomePath = filename.startsWith('~');
			const isTxtFile = filename.toLowerCase().endsWith('.txt');
			const isDocxFile = filename.toLowerCase().endsWith('.docx') || filename.toLowerCase().endsWith('.doc');
			const isJsonFile = filename.toLowerCase().endsWith('.json');
			const isWhisperFile = filename.toLowerCase().endsWith('.whisper');

			if (!isTxtFile && !isDocxFile && !isJsonFile && !isWhisperFile) {
				console.warn('[resolveTranscriptContent] Unsupported file type:', filename);
				return null;
			}

			if (embeddedIsAbsolutePath || isHomePath) {
				const fullPath = isHomePath ? filename.replace(/^~/, homedir()) : filename;
				console.log('[resolveTranscriptContent] Reading external file:', fullPath);
				if (isWhisperFile) {
					const buffer = await readFile(fullPath);
					const zip = await JSZip.loadAsync(buffer);
					const metaEntry = zip.file('metadata.json');
					if (!metaEntry) throw new Error('.whisper file is missing metadata.json');
					const text = await metaEntry.async('text');
					console.log('[resolveTranscriptContent] Extracted .whisper metadata.json, length:', text.length);
					return text;
				} else if (isTxtFile || isJsonFile) {
					const text = await readFile(fullPath, 'utf-8');
					console.log('[resolveTranscriptContent] Read external file, length:', text.length);
					return text;
				} else {
					const buffer = await readFile(fullPath);
					const result = await mammoth.extractRawText({ buffer });
					console.log('[resolveTranscriptContent] Extracted docx text, length:', result.value.length);
					return result.value;
				}
			}

			if (isWhisperFile && this.shouldUseMacWhisperSource() && this.settings.macWhisperTranscriptsDir) {
				const sourceDir = this.settings.macWhisperTranscriptsDir.replace(/^~/, homedir());
				const sourcePath = `${sourceDir}/${filename}`;
				const { existsSync } = require('fs');
				if (existsSync(sourcePath)) {
					console.log('[resolveTranscriptContent] Using MacWhisper source:', sourcePath);
					const buffer = await readFile(sourcePath);
					const zip = await JSZip.loadAsync(buffer);
					const metaEntry = zip.file('metadata.json');
					if (!metaEntry) throw new Error('.whisper file is missing metadata.json');
					const text = await metaEntry.async('text');
					console.log('[resolveTranscriptContent] Extracted .whisper metadata.json, length:', text.length);
					return text;
				}
			}

			const possiblePaths = [filename, `Media/${filename}`, `Attachments/${filename}`, `Files/${filename}`];
			console.log('[resolveTranscriptContent] Searching vault paths:', possiblePaths);

			let docFile: TFile | null = null;
			for (const path of possiblePaths) {
				const f = this.app.vault.getAbstractFileByPath(path);
				if (f instanceof TFile) {
					docFile = f;
					console.log('[resolveTranscriptContent] Found vault file at:', path);
					break;
				}
			}

			if (!docFile) {
				console.warn('[resolveTranscriptContent] File not found in vault:', filename);
				return null;
			}

			if (isWhisperFile) {
				const arrayBuffer = await this.app.vault.readBinary(docFile);
				const buffer = Buffer.from(arrayBuffer);
				const zip = await JSZip.loadAsync(buffer);
				const metaEntry = zip.file('metadata.json');
				if (!metaEntry) throw new Error('.whisper file is missing metadata.json');
				const text = await metaEntry.async('text');
				console.log('[resolveTranscriptContent] Extracted .whisper metadata.json, length:', text.length);
				return text;
			}

			if (isTxtFile || isJsonFile) {
				const text = await this.app.vault.read(docFile);
				console.log('[resolveTranscriptContent] Read vault file, length:', text.length);
				return text;
			}

			const arrayBuffer = await this.app.vault.readBinary(docFile);
			const buffer = Buffer.from(arrayBuffer);
			const result = await mammoth.extractRawText({ buffer });
			console.log('[resolveTranscriptContent] Extracted vault docx text, length:', result.value.length);
			return result.value;
		} catch (error) {
			console.error('[resolveTranscriptContent] Error resolving transcript file:', error);
			return null;
		}
	}

	protected hasUnifiedSummary(content: string): boolean {
		const match = content.match(/# Unified Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		return match !== null && match[1].trim().length > 20;
	}

	protected hasTranscript(content: string): boolean {
		return getSection(content, 'Transcript').trim().length > 20;
	}

	protected async generateSummary(file: TFile): Promise<void> {
		console.log('Generating meeting summary...');

		const content = await this.app.vault.read(file);
		if (this.shouldSkipSummaryGeneration(content)) {
			console.log('Unified Summary already exists, skipping generation');
			return;
		}

		const hasCopilotSummary = this.hasCopilotSummary(content);
		const hasTranscript = this.hasTranscript(content);

		if (hasCopilotSummary && hasTranscript) {
			console.log('Both sources available - using enhanced workflow');
			await this.generateEnhancedSummary(file, content);
		} else if (this.shouldRunStandardSummary(hasCopilotSummary, hasTranscript)) {
			console.log('Single source available - using standard workflow');
			await this.generateStandardSummary(file, content);
		} else {
			console.log('No transcript available, skipping summary generation');
		}
	}

	protected async generateStandardSummary(file: TFile, content: string): Promise<void> {
		console.log('Generating standard summary...');

		const summarySkill = this.skillLoader.getSkill('summary-generation');
		if (!summarySkill) {
			console.warn('Summary generation skill not found');
			return;
		}

		const contentToSummarize = this.getStandardSummaryContent(content);
		if (!contentToSummarize || contentToSummarize.length < 20) {
			console.log('No content available for summary generation');
			return;
		}

		try {
			const prompt = this.buildStandardSummaryPrompt(summarySkill, contentToSummarize);
			const rawSummary = await this.copilotClient.sendPrompt(prompt, undefined, 'Generating transcript summary…');
			const summary = cleanCopilotOutput(rawSummary);

			let newContent = content;
			newContent = newContent.replace(/\n# Transcript Summary[^\n]*\n[\s\S]*?(?=\n# [^#]|$)/, '\n');
			newContent = newContent.replace(/\n# Unified Summary[^\n]*\n[\s\S]*?(?=\n# [^#]|$)/, '\n');
			newContent = upsertSection(newContent, 'Summary', summary, { insertBeforeHeading: 'Notes' });

			await this.app.vault.modify(file, newContent);
			console.log('Summary generated and saved');
		} catch (error) {
			console.error('Error generating transcript summary:', error);
			throw error;
		}
	}

	protected async generateEnhancedSummary(file: TFile, content: string): Promise<void> {
		console.log('Generating enhanced summary with both sources...');

		try {
			this.statusBar.show('Generating transcript summary...', 0);
			const transcriptSummary = await this.generateTranscriptSummary(content);
			if (!transcriptSummary) {
				console.warn('Failed to generate transcript summary, falling back to standard');
				await this.generateStandardSummary(file, content);
				return;
			}

			this.statusBar.show('Combining summaries...', 0);
			const unifiedSummary = await this.combineSummaries(content, transcriptSummary);
			if (!unifiedSummary) {
				console.warn('Failed to combine summaries, falling back to standard');
				await this.generateStandardSummary(file, content);
				return;
			}

			await this.updateSummarySections(file, content, unifiedSummary, transcriptSummary);
			console.log('Enhanced summary generated successfully');
		} catch (error) {
			console.error('Error in enhanced summary generation:', error);
			console.log('Falling back to standard summary generation');
			await this.generateStandardSummary(file, content);
		}
	}

	protected async generateTranscriptSummary(content: string): Promise<string | null> {
		console.log('Generating transcript summary...');

		const rawTranscript = getSection(content, 'Transcript');
		if (!rawTranscript) {
			console.warn('No transcript content found');
			return null;
		}

		console.log('Transcript content length:', rawTranscript.length);
		console.log('Transcript preview:', rawTranscript.substring(0, 200));

		const transcriptContent = await this.resolveTranscriptContentForSummary(rawTranscript);
		if (!transcriptContent || transcriptContent.length < 20) {
			console.warn('Could not resolve transcript content or content too short');
			return null;
		}

		try {
			const prompt = this.buildTranscriptSummaryPrompt(transcriptContent);
			const summary = await this.copilotClient.sendPrompt(prompt, undefined, 'Generating Copilot summary…');
			return cleanCopilotOutput(summary);
		} catch (error) {
			console.error('Error generating transcript summary:', error);
			return null;
		}
	}

	protected async combineSummaries(content: string, transcriptSummary: string): Promise<string | null> {
		console.log('Combining summaries...');

		const copilotSection = getSection(content, 'Copilot Summary');
		if (!copilotSection) {
			console.warn('No Copilot Summary content found');
			return transcriptSummary;
		}

		let copilotSummary = copilotSection.trim();
		console.log('Copilot Summary raw length:', copilotSummary.length);
		console.log('Copilot Summary preview:', copilotSummary.substring(0, 200));

		if (copilotSummary.startsWith('#')) {
			console.log('Copilot Summary section is empty (captured next heading), using transcript summary only');
			return transcriptSummary;
		}

		const disclaimerPatterns = [
			/AI-generated content.*?may be incorrect.*?\[Learn more\]\([^)]+\)/gi,
			/AI-generated content.*?may not be accurate.*?\[Learn more\]\([^)]+\)/gi,
			/This summary was generated by AI.*?may be incorrect.*?\[Learn more\]\([^)]+\]/gi,
			/\[Learn more\]\([^)]+\)/gi,
		];
		for (const pattern of disclaimerPatterns) {
			copilotSummary = copilotSummary.replace(pattern, '').trim();
		}

		console.log('Copilot Summary after disclaimer removal:', copilotSummary.length);

		if (copilotSummary.length < 50) {
			console.log('Copilot Summary is empty or too short after disclaimer removal, using transcript summary only');
			return transcriptSummary;
		}

		try {
			const prompt = this.buildCombineSummariesPrompt(copilotSummary, transcriptSummary);
			const unified = await this.copilotClient.sendPrompt(prompt, undefined, 'Combining summaries…');
			return cleanCopilotOutput(unified);
		} catch (error) {
			console.error('Error combining summaries:', error);
			return null;
		}
	}

	protected async updateSummarySections(
		file: TFile,
		content: string,
		unifiedSummary: string,
		_transcriptSummary: string,
	): Promise<void> {
		console.log('Updating summary sections...');

		let newContent = content;
		newContent = newContent.replace(/\n# Transcript Summary[^\n]*\n[\s\S]*?(?=\n# [^#]|$)/, '\n');
		newContent = newContent.replace(/\n# Unified Summary[^\n]*\n[\s\S]*?(?=\n# [^#]|$)/, '\n');
		newContent = upsertSection(newContent, 'Summary', unifiedSummary, { insertBeforeHeading: 'Notes' });

		await this.app.vault.modify(file, newContent);
		console.log('Summary section updated');
	}

	protected async resolveNonEmbedTranscript(_file: TFile, _content: string, _rawTranscript: string): Promise<{ text: string; sourceRef: string } | null> {
		return null;
	}

	/**
	 * Default: prepend the `<!-- whisper-source -->` sentinel when the transcript came
	 * from a `.whisper` embed, so resolveSpeakers() knows voice ID already had a chance
	 * to name these speakers (and skips reopening the text-heuristic modal for them).
	 * Meeting-type-agnostic — applies equally to general and standup meetings.
	 */
	protected transformExpandedTranscript(rawTranscript: string, transcriptText: string): string {
		return rawTranscript.includes('.whisper')
			? `<!-- whisper-source -->\n${transcriptText}`
			: transcriptText;
	}

	/**
	 * Default: skip the SpeakerAttributionModal when the transcript already carries the
	 * `<!-- whisper-source -->` sentinel — those speaker names are authoritative (from
	 * voice ID or already-named in the .whisper file), whether or not the user assigned
	 * every speaker there. Without this, any remaining [Speaker N] placeholders would
	 * reopen a second, redundant "Identify Meeting Speakers" dialog right after voice ID.
	 */
	protected shouldSkipSpeakerResolution(rawTranscript: string): boolean {
		if (rawTranscript.includes('<!-- whisper-source -->')) {
			console.log('[resolveSpeakers] Transcript sourced from .whisper file — speaker names are authoritative, skipping modal');
			return true;
		}
		return false;
	}

	protected async getAdditionalSpeakerCandidates(_existingCandidates: Array<{ displayName: string; wikiLink: string }>): Promise<Array<{ displayName: string; wikiLink: string }>> {
		if (!this.settings.voiceServiceEnabled) {
			return [];
		}

		const voiceKnownSpeakers = await this.voiceResolver.getKnownSpeakers();
		return voiceKnownSpeakers.map(name => ({ displayName: name, wikiLink: name }));
	}

	protected shouldStripDisclaimerForCopilotSummaryCheck(): boolean {
		return true;
	}

	protected getCopilotSummaryMinLength(): number {
		return 50;
	}

	protected async getAttendeeProcessingContent(_file: TFile, content: string): Promise<string> {
		return content;
	}

	protected shouldSkipAttendeeProcessing(attendeesContent: string): boolean {
		return /(?<!!)(?<!\w)\[\[(?!.*\.(?:png|jpg|jpeg|gif|svg|webp))/.test(attendeesContent);
	}

	protected extractScreenshotReferences(attendeesContent: string): string[] {
		const screenshotPattern = /!\[\[(SCR-[^\]]+\.png)\]\]/g;
		const screenshots: string[] = [];
		let match;
		while ((match = screenshotPattern.exec(attendeesContent)) !== null) {
			screenshots.push(match[1]);
		}
		return screenshots;
	}

	protected async mergeSupplementalAttendees(_file: TFile, _content: string, extractedNames: string[]): Promise<string[]> {
		return extractedNames;
	}

	protected isScreenshotVisionFailure(response: string): boolean {
		return response.includes("don't see") || response.includes('cannot see') ||
			response.includes('no image') || response.includes('Please provide') ||
			response.includes('error') || response.length === 0 ||
			response.includes('image contains') || response.includes('not a list') ||
			response.includes('no names') || response.includes('specification') ||
			response.includes('hardware') || response.includes('table') ||
			(response.length > 120 && !response.includes(','));
	}

	protected parseScreenshotNames(namesList: string): string[] {
		const rawTokens = namesList.split(',').map(n => n.trim()).filter(n => n.length > 0);

		// Vision sometimes ignores the "First Last" instruction and instead transcribes
		// a Teams attendee list literally as "Last, First, Last, First, ..." (comma-separated
		// surname/given-name pairs rather than comma-separated full names). Splitting that on
		// every comma yields single-word fragments that fail the full-name check below, so
		// detect this shape first and re-pair tokens into "First Last" before filtering.
		const looksLikeNamePairs = rawTokens.length >= 2 &&
			rawTokens.length % 2 === 0 &&
			rawTokens.every(t => !t.includes(' '));

		let candidates: string[];
		if (looksLikeNamePairs) {
			candidates = [];
			for (let i = 0; i < rawTokens.length; i += 2) {
				candidates.push(`${rawTokens[i + 1]} ${rawTokens[i]}`);
			}
		} else {
			candidates = rawTokens;
		}

		return candidates.filter(n =>
			n.length > 0 &&
			n.length < 60 &&
			!/don't|cannot|please/i.test(n) &&
			/^[A-Za-z]/.test(n) &&
			!/[\/\(\)\+\[\]]/.test(n) &&
			n.split(' ').length >= 2 &&
			isValidPersonName(n),
		);
	}

	protected async buildUpdatedAttendeesContent(_content: string, _names: string[]): Promise<string | null> {
		return null;
	}

	protected shouldUseMacWhisperSource(): boolean {
		return false;
	}

	protected shouldSkipSummaryGeneration(_content: string): boolean {
		return false;
	}

	protected shouldRunStandardSummary(hasCopilotSummary: boolean, hasTranscript: boolean): boolean {
		return !hasCopilotSummary && hasTranscript;
	}

	protected getStandardSummaryContent(content: string): string {
		return getSection(content, 'Transcript');
	}

	protected buildStandardSummaryPrompt(summarySkill: any, contentToSummarize: string): string {
		return `You are a meeting summarization assistant. Analyze the following meeting content and generate a structured summary.\n\n${summarySkill.sections.get('Analysis Points') || ''}\n\n${summarySkill.sections.get('Output Format') || ''}\n\n${summarySkill.sections.get('Style Guidelines') || ''}\n\nMeeting content to summarize:\n\n${contentToSummarize}`;
	}

	protected async resolveTranscriptContentForSummary(rawTranscript: string): Promise<string | null> {
		return this.resolveTranscriptContent(rawTranscript);
	}

	protected buildTranscriptSummaryPrompt(transcriptContent: string): string {
		return `You are analyzing a general meeting transcript. Generate a comprehensive summary with these exact bold section headers:\n\n**Key Points**: Main topics discussed (use sub-bullets for detail)\n**Decisions**: Decisions made during the meeting\n**Action Items**: Tasks assigned with owners\n**Follow-up**: Items requiring follow-up\n\nRules:\n- Start your response DIRECTLY with **Key Points** — no preamble, no intro sentence, no "Meeting Summary", no participant list\n- Do NOT include any markdown headings (# or ##)\n- Do NOT include "Meeting Summary", "Participants", or any introductory section\n\nTranscript:\n\n${transcriptContent}`;
	}

	protected buildCombineSummariesPrompt(copilotSummary: string, transcriptSummary: string): string {
		return `You are creating a unified summary for a meeting by combining two sources:\n\n1. **Teams Copilot Summary** (from Microsoft Teams AI):\n${copilotSummary}\n\n2. **Transcript Summary** (from meeting transcript):\n${transcriptSummary}\n\nCreate a single, cohesive summary that:\n- Merges duplicate information (don't repeat the same point twice)\n- Preserves all unique insights from both sources\n- Maintains structured format: Key Points, Decisions, Action Items, Follow-up\n- Uses clear, organized bullet points\n- Prioritizes accuracy and completeness\n\nCRITICAL: Do NOT include any markdown headings (# or ##) in your response. Start directly with the content.\n\nGenerate the unified summary:`;
	}

	private async writeExpandedTranscript(
		file: TFile,
		content: string,
		rawTranscript: string,
		resolved: string,
		allowCreateSection: boolean,
	): Promise<void> {
		const cleanResult = this.transcriptDetector.detectAndClean(resolved);
		const cleanedOk = cleanResult.cleaned.length >= 20;

		// If cleaning failed/produced nothing AND the resolved content still looks like
		// raw, un-parsed JSON (e.g. a .whisper metadata.json blob none of the cleaners
		// recognized), don't silently dump that JSON into the note as if it were the
		// transcript — leave the section untouched instead, same "avoid data loss"
		// behavior cleanTranscript() already has.
		const looksLikeRawJson = /^[{[]/.test(resolved.trim());
		if (!cleanedOk && looksLikeRawJson) {
			console.warn('[expandTranscriptEmbed] Cleaner produced no usable output and resolved content looks like raw JSON — leaving transcript section untouched to avoid data loss');
			return;
		}

		const toWrite = cleanedOk ? cleanResult.cleaned : resolved;
		console.log(`[expandTranscriptEmbed] Cleaned with: ${cleanResult.cleaner}, output length: ${toWrite.length}`);

		const finalText = this.transformExpandedTranscript(rawTranscript, toWrite);
		const updated = /# Transcript\s*\n/.test(content)
			? content.replace(/# Transcript\s*\n[\s\S]*?(?=\n# [^#]|$)/, `# Transcript\n\n${finalText}\n\n`)
			: allowCreateSection
				? content + `\n# Transcript\n\n${finalText}\n\n`
				: content;

		if (updated !== content) {
			await this.app.vault.modify(file, updated);
			console.log(`[expandTranscriptEmbed] Expanded embed to ${finalText.length} chars of inline text`);
		}
	}
}
