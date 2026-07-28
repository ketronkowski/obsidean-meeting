import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { detectTeam } from '../validators';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { JiraManager } from '../jira/manager';
import { JiraKeyExtractor } from '../jira/extractor';
import { getSection, upsertSection, isSectionEmpty } from '../section-utils';
import { BaseMeetingHandler } from './base-meeting-handler';

/**
 * Handles processing of standup meetings
 */
export class StandupMeetingHandler extends BaseMeetingHandler {
	private jiraManager: JiraManager;
	private jiraExtractor: JiraKeyExtractor;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		super(app, settings, copilotClient, skillLoader, statusBar);
		this.jiraManager = new JiraManager(copilotClient, settings);
		this.jiraExtractor = new JiraKeyExtractor();
	}

	/**
	 * Process a standup meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing standup meeting:', file.basename);

		try {
			const team = detectTeam(file);
			if (!team) {
				throw new Error('Could not determine team from filename');
			}

			const boardId = this.settings.greenBoardId;
			console.log(`Detected ${team} team standup (board ${boardId})`);

			const content = await this.app.vault.read(file);
			const jiraSectionEmpty = this.isJiraSectionEmpty(content);
			const hasTranscript = this.hasProcessableTranscript(file, content);

			// These two are independent, not mutually exclusive: if the JIRA section is
			// empty (e.g. a note went straight from "just created" to "has a locatable
			// whisper export" without a pre-meeting pass ever running), pre-meeting JIRA
			// population must still happen — even though post-meeting processing is also
			// about to run. Running pre-meeting first means extractJiraUpdates() (the last
			// step of processPostMeeting) has real JIRA items to check off against.
			if (jiraSectionEmpty) {
				await this.processPreMeeting(file, boardId, team);
			}

			if (hasTranscript) {
				await this.processPostMeeting(file, boardId);
			} else if (!jiraSectionEmpty) {
				console.log('Standup: nothing to process (JIRA already populated, no transcript/whisper content found)');
			}

			this.statusBar.show('Complete!', 2000);
			console.log('Standup meeting processing complete');
		} catch (error) {
			this.statusBar.show('Error processing standup', 3000);
			throw error;
		}
	}

	/**
	 * Whether the `# JIRA` section is missing or blank — used to decide whether the
	 * pre-meeting sprint query needs to (re-)run, independent of whether post-meeting
	 * transcript/summary processing is also going to run in this same pass.
	 */
	private isJiraSectionEmpty(content: string): boolean {
		return isSectionEmpty(content, 'JIRA');
	}

	/**
	 * Whether there is transcript content to process — either inline text/embed already
	 * in `# Transcript`, or a `.whisper` file MacWhisper exported directly to
	 * `macWhisperTranscriptsDir` that can be auto-located by meeting filename (no embed
	 * link required in the note at all).
	 */
	private hasProcessableTranscript(file: TFile, content: string): boolean {
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n# [^#]|$)/);
		const transcriptContent = transcriptMatch ? transcriptMatch[1].trim() : '';

		if (transcriptContent.length > 50 ||
			transcriptContent.includes('.txt') ||
			transcriptContent.includes('.docx') ||
			transcriptContent.includes('.json') ||
			transcriptContent.includes('.whisper') ||
			transcriptContent.includes('![[')) {
			return true;
		}

		return this.voiceResolver.resolveWhisperForMeeting(file, transcriptContent) !== null;
	}

	private async processPreMeeting(file: TFile, boardId: string, teamName: string): Promise<void> {
		console.log('Pre-meeting mode: populating JIRA section...');
		this.statusBar.show('Querying JIRA...', 0);

		try {
			const jiraSection = await this.jiraManager.queryAndFormatSprint(
				boardId,
				this.settings.jiraProjectKey,
				teamName,
			);

			await this.insertJiraSection(file, jiraSection);
			console.log('JIRA section populated successfully');
		} catch (error) {
			console.error('Error populating JIRA section:', error);
			throw error;
		}
	}

	private async insertJiraSection(file: TFile, jiraSection: string): Promise<void> {
		const content = await this.app.vault.read(file);
		const jiraBody = getSection(jiraSection, 'JIRA') || jiraSection.replace(/^# JIRA\s*\n?/, '').trim();

		let newContent = upsertSection(content, 'JIRA', jiraBody, {
			insertAfterHeading: 'Attendees',
			appendToEnd: false,
		});

		if (newContent !== content) {
			console.log(content.includes('# JIRA') ? 'Replaced existing JIRA section' : 'Inserted JIRA section after Attendees');
		} else {
			const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
			if (frontmatterRegex.test(content)) {
				newContent = content.replace(frontmatterRegex, match => match + `\n# JIRA\n\n${jiraBody}\n\n`);
				console.log('Inserted JIRA section after frontmatter');
			} else {
				newContent = `# JIRA\n\n${jiraBody}\n\n${content}`;
				console.log('Inserted JIRA section at top');
			}
		}

		await this.app.vault.modify(file, newContent);
	}

	private async processPostMeeting(file: TFile, _boardId: string): Promise<void> {
		console.log('Post-meeting mode: processing transcript and summary...');

		const content = await this.app.vault.read(file);
		const screenshotAttendees = await this.peekScreenshotAttendees(file, content);
		console.log('[processPostMeeting] Pre-extracted screenshot attendees:', screenshotAttendees);

		if (this.settings.voiceServiceEnabled) {
			this.statusBar.show('Identifying speakers by voice...', 0);
			await this.voiceResolver.identifyWhisperSpeakers(file, screenshotAttendees);
		}

		this.statusBar.show('Processing attendees...', 0);
		await this.processAttendees(file, content);

		this.statusBar.show('Expanding transcript...', 0);
		await this.expandTranscriptEmbed(file);

		this.statusBar.show('Identifying speakers...', 0);
		await this.resolveSpeakers(file);

		const hasCopilotSummary = this.hasCopilotSummary(content);
		if (!hasCopilotSummary && this.settings.autoCleanTranscript) {
			this.statusBar.show('Cleaning transcript...', 0);
			await this.cleanTranscript(file);
		}

		this.statusBar.show('Generating summary...', 0);
		await this.generateSummary(file);

		await this.extractJiraUpdates(file, content);
	}

	private async peekScreenshotAttendees(file: TFile, content: string): Promise<string[]> {
		const attendeesContent = getSection(content, 'Attendees');
		const screenshots = this.extractScreenshotReferences(attendeesContent);
		if (screenshots.length === 0) return [];
		return this.extractFromScreenshots(file, screenshots);
	}

	private async extractWhisperSpeakers(file: TFile, content: string): Promise<string[]> {
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n# [^#]|$)/);
		const rawTranscript = transcriptMatch ? transcriptMatch[1].trim() : '';

		let filename: string | null = null;
		if (rawTranscript.includes('.whisper')) {
			const candidate = rawTranscript.replace(/!?\[\[/g, '').replace(/\]\]/g, '').trim();
			if (candidate.toLowerCase().endsWith('.whisper')) {
				filename = candidate;
			}
		}

		// No inline .whisper reference (or an empty/short # Transcript section) — fall back
		// to a MacWhisper export auto-located by meeting filename in macWhisperTranscriptsDir,
		// the same mechanism used for transcript expansion.
		if (!filename) {
			filename = this.voiceResolver.resolveWhisperForMeeting(file, rawTranscript);
			if (!filename) return [];
		}

		try {
			let buf: Buffer;
			const isAbsolutePath = filename.startsWith('/');
			const isHomePath = filename.startsWith('~');

			if (isAbsolutePath || isHomePath) {
				const fullPath = isHomePath ? filename.replace(/^~/, require('os').homedir()) : filename;
				buf = await require('fs/promises').readFile(fullPath);
			} else {
				const possiblePaths = [filename, `Media/${filename}`, `Attachments/${filename}`, `Files/${filename}`];
				let docFile: TFile | null = null;
				for (const path of possiblePaths) {
					const f = this.app.vault.getAbstractFileByPath(path);
					if (f instanceof TFile) {
						docFile = f;
						break;
					}
				}
				if (!docFile) {
					console.warn('[extractWhisperSpeakers] .whisper file not found in vault:', filename);
					return [];
				}
				const arrayBuffer = await this.app.vault.readBinary(docFile);
				buf = Buffer.from(arrayBuffer);
			}

			const zip = await require('jszip').loadAsync(buf);
			const metaEntry = zip.file('metadata.json');
			if (!metaEntry) return [];

			const data = JSON.parse(await metaEntry.async('text'));
			if (!Array.isArray(data.speakers)) return [];

			const genericPattern = /^Speaker \d+$/i;
			const names: string[] = data.speakers
				.map((s: any) => (s.name ?? '').trim())
				.filter((name: string) =>
					name.length > 0 &&
					name.toLowerCase() !== 'unknown' &&
					!genericPattern.test(name),
				);

			console.log('[extractWhisperSpeakers] Identified speakers:', names);
			return names;
		} catch (error) {
			console.warn('[extractWhisperSpeakers] Failed to read .whisper file:', error);
			return [];
		}
	}

	private async extractJiraUpdates(file: TFile, content: string): Promise<void> {
		console.log('Extracting JIRA updates...');
		this.statusBar.show('Checking JIRA mentions...', 0);

		try {
			const relevantContent = this.jiraExtractor.extractRelevantContent(content);
			if (!relevantContent || relevantContent.trim().length < 20) {
				console.log('No content to analyze for JIRA keys');
				return;
			}

			const matches = this.jiraExtractor.extractKeys(relevantContent);
			if (matches.length === 0) {
				console.log('No JIRA keys found in content');
				return;
			}

			const mentionedKeys = matches.map(m => m.key);
			console.log(`Found ${mentionedKeys.length} JIRA keys:`, mentionedKeys);

			const updatedContent = this.jiraExtractor.updateJiraSection(content, mentionedKeys, matches);
			if (updatedContent !== content) {
				await this.app.vault.modify(file, updatedContent);
				console.log('JIRA section updated with checked items and notes');
			} else {
				console.log('No JIRA items were checked (keys may not match items in JIRA section)');
			}
		} catch (error) {
			console.error('Error extracting JIRA updates:', error);
		}
	}

	// transformExpandedTranscript() and shouldSkipSpeakerResolution() are inherited from
	// BaseMeetingHandler — the <!-- whisper-source --> sentinel logic is meeting-type-agnostic
	// and now lives there so GeneralMeetingHandler gets the same behavior.

	/**
	 * When the # Transcript section has no embed and no inline text, try to auto-locate a
	 * MacWhisper export matching this meeting's filename in macWhisperTranscriptsDir — the
	 * same mechanism GeneralMeetingHandler already uses. This lets standup meetings reach
	 * post-meeting processing purely from an exported .whisper file, with no ![[...]] embed
	 * ever typed into the note.
	 */
	protected async resolveNonEmbedTranscript(file: TFile, _content: string, _rawTranscript: string): Promise<{ text: string; sourceRef: string } | null> {
		const whisperPath = this.voiceResolver.resolveWhisperForMeeting(file);
		if (!whisperPath) {
			console.log('[expandTranscriptEmbed] No embed and no matching whisper file, skipping');
			return null;
		}

		console.log('[expandTranscriptEmbed] Found whisper file by meeting name:', whisperPath);
		const resolved = await this.resolveTranscriptContent(whisperPath, true);
		return resolved && resolved.length >= 20 ? { text: resolved, sourceRef: whisperPath } : null;
	}

	protected shouldUseMacWhisperSource(): boolean {
		return true;
	}

	protected async getAdditionalSpeakerCandidates(): Promise<Array<{ displayName: string; wikiLink: string }>> {
		return [];
	}

	protected shouldStripDisclaimerForCopilotSummaryCheck(): boolean {
		return false;
	}

	protected getCopilotSummaryMinLength(): number {
		return 1;
	}

	protected async getAttendeeProcessingContent(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	protected async mergeSupplementalAttendees(file: TFile, content: string, extractedNames: string[]): Promise<string[]> {
		const whisperNames = await this.extractWhisperSpeakers(file, content);
		if (whisperNames.length === 0) {
			return extractedNames;
		}

		if (extractedNames.length === 0) {
			console.log('[processAttendees] No screenshots, using .whisper identified speakers:', whisperNames);
			return whisperNames;
		}

		const nameSet = new Set(extractedNames.map(n => n.toLowerCase()));
		const extra = whisperNames.filter(n => !nameSet.has(n.toLowerCase()));
		if (extra.length > 0) {
			console.log('[processAttendees] Merging additional .whisper speakers:', extra);
			return [...extractedNames, ...extra];
		}

		return extractedNames;
	}

	protected isScreenshotVisionFailure(response: string): boolean {
		return response.includes("don't see") || response.includes('cannot see') ||
			response.includes('no image') || response.includes('Please provide') ||
			response.includes('error') || response.length === 0;
	}

	protected parseScreenshotNames(namesList: string): string[] {
		return namesList.split(',').map(n => n.trim()).filter(n =>
			n.length > 0 &&
			n.length < 60 &&
			!/don't|cannot|please/i.test(n) &&
			/^[A-Za-z]/.test(n) &&
			!/[\/\(\)\+\[\]]/.test(n) &&
			n.split(' ').length >= 2,
		);
	}

	protected async extractFromContent(content: string): Promise<string[]> {
		console.log('Extracting attendees from content...');

		const transcriptStart = content.search(/^# Transcript/m);
		const searchContent = transcriptStart > 0 ? content.substring(0, transcriptStart) : content;
		const names: Set<string> = new Set();
		const speakerPattern = /(?:\[([^\]]+)\]|^\*\*([^:*]+):\*\*)/gm;
		const jiraKeyPattern = /^[A-Z]+-\d+$/;
		const speakerNumberPattern = /^Speaker \d+$/i;
		const fileExtPattern = /\.\w{2,10}$/;
		let match;

		while ((match = speakerPattern.exec(searchContent)) !== null) {
			const name = (match[1] || match[2]).trim();
			if (name &&
				name.length > 2 &&
				name.length < 50 &&
				!name.startsWith('[') &&
				!fileExtPattern.test(name) &&
				!jiraKeyPattern.test(name) &&
				!speakerNumberPattern.test(name) &&
				name !== 'Learn more') {
				names.add(name);
			}
		}

		return Array.from(names);
	}

	protected async buildUpdatedAttendeesContent(content: string, names: string[]): Promise<string | null> {
		const attendeeLinks: string[] = [];

		for (const name of names) {
			if (this.settings.autoCreateProfiles) {
				const profile = await this.peopleManager.getOrCreateProfile(name);
				attendeeLinks.push(`- [[${profile.displayName}]]`);
			} else {
				const profile = await this.peopleManager.findProfile(name);
				if (profile.exists) {
					attendeeLinks.push(`- [[${profile.displayName}]]`);
				} else {
					attendeeLinks.push(`- ${name}`);
				}
			}
		}

		const attendeesSection = `# Attendees\n\n${attendeeLinks.join('\n')}`;
		const attendeesRegex = /# Attendees[^\n]*\n[\s\S]*?(?=\n#|$)/;
		if (attendeesRegex.test(content)) {
			return content.replace(attendeesRegex, attendeesSection + '\n');
		}

		const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
		if (frontmatterRegex.test(content)) {
			return content.replace(frontmatterRegex, match => match + '\n' + attendeesSection + '\n');
		}

		return attendeesSection + '\n\n' + content;
	}

	protected shouldSkipSummaryGeneration(content: string): boolean {
		return this.hasUnifiedSummary(content);
	}

	protected shouldRunStandardSummary(hasCopilotSummary: boolean, hasTranscript: boolean): boolean {
		return hasCopilotSummary || hasTranscript;
	}

	protected getStandardSummaryContent(content: string): string {
		const copilotSummary = getSection(content, 'Copilot Summary');
		if (copilotSummary) {
			return copilotSummary;
		}
		return getSection(content, 'Transcript');
	}

	protected buildStandardSummaryPrompt(summarySkill: any, contentToSummarize: string): string {
		return `This is a standup meeting. ${summarySkill.purpose}\n\n${summarySkill.sections.get('Analysis Points') || ''}\n${summarySkill.sections.get('Output Format') || ''}\n\nMeeting content to summarize:\n\n${contentToSummarize}\n\nPlease generate a summary focused on: what was completed yesterday, what's planned for today, and any blockers mentioned.`;
	}

	protected async resolveTranscriptContentForSummary(rawTranscript: string): Promise<string | null> {
		const transcriptContent = await this.resolveTranscriptContent(rawTranscript);
		if (!transcriptContent) {
			return null;
		}

		if (rawTranscript.includes('.whisper')) {
			const cleanResult = this.transcriptDetector.detectAndClean(transcriptContent);
			return cleanResult.cleaned.length >= 20 ? cleanResult.cleaned : transcriptContent;
		}

		return transcriptContent;
	}

	protected buildTranscriptSummaryPrompt(transcriptContent: string): string {
		return `You are analyzing a standup meeting transcript. Generate a concise summary focused on:\n- What each person completed yesterday\n- What each person is planning for today  \n- Any blockers or issues mentioned\n- Key decisions or action items\n\nFormat as clear bullet points organized by team member when possible.\n\nRules:\n- Start your response DIRECTLY with content — no preamble, no "Meeting Summary", no participant list\n- Do NOT include any markdown headings (# or ##)\n\nTranscript:\n\n${transcriptContent}`;
	}

	protected buildCombineSummariesPrompt(copilotSummary: string, transcriptSummary: string): string {
		return `You are creating a unified summary for a standup meeting by combining two sources:\n\n1. **Teams Copilot Summary** (from Microsoft Teams AI):\n${copilotSummary}\n\n2. **Transcript Summary** (from meeting transcript):\n${transcriptSummary}\n\nCreate a single, cohesive summary that:\n- Merges duplicate information (don't repeat the same point twice)\n- Preserves all unique insights from both sources\n- Maintains focus on: completed work, planned work, blockers\n- Uses clear, organized bullet points\n- Prioritizes accuracy and completeness\n\nCRITICAL: Do NOT include any markdown headings (# or ##) in your response. Start directly with the content.\n\nGenerate the unified summary:`;
	}
}
