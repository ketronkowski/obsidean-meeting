import { App, Notice, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { PeopleManager } from '../people-manager';
import { parseEmailParticipants } from '../email-parser';
import { cleanCopilotOutput } from '../output-cleaner';

export class EmailChainHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private statusBar: StatusBarManager;
	private peopleManager: PeopleManager;

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
		this.statusBar = statusBar;
		this.peopleManager = new PeopleManager(app);
	}

	async process(file: TFile): Promise<void> {
		console.log(`[EmailChainHandler] Processing: ${file.basename}`);

		const content = await this.app.vault.read(file);
		const emailChainContent = this.extractSection(content, 'Email Chain');

		if (!emailChainContent) {
			new Notice('No Email Chain section content found');
			return;
		}

		let newContent = content;

		// Participants — skip if already populated
		if (this.isSectionEmpty(content, 'Participants')) {
			this.statusBar.show('Extracting email participants…', 0);
			newContent = await this.processParticipants(file, newContent, emailChainContent);
		} else {
			console.log('[EmailChainHandler] Participants already populated, skipping');
		}

		// Summary — skip if already populated
		if (this.isSectionEmpty(content, 'Summary')) {
			this.statusBar.show('Generating email summary…', 0);
			newContent = await this.processSummary(file, newContent, emailChainContent);
		} else {
			console.log('[EmailChainHandler] Summary already populated, skipping');
		}

		this.statusBar.show('Email chain processed', 3000);
		new Notice('Email chain processing complete!');
	}

	// ---------------------------------------------------------------------------
	// Participants
	// ---------------------------------------------------------------------------

	private async processParticipants(
		file: TFile,
		content: string,
		emailChainContent: string,
	): Promise<string> {
		const participants = parseEmailParticipants(emailChainContent);
		console.log(`[EmailChainHandler] Found ${participants.length} HPE participants`);

		if (participants.length === 0) {
			console.warn('[EmailChainHandler] No HPE participants parsed from email headers');
			return content;
		}

		const links: string[] = [];

		for (const p of participants) {
			try {
				// Check for existing profile first
				let profile = await this.peopleManager.findProfile(p.mailboxName);

				if (!profile.exists) {
					console.log(`[EmailChainHandler] Creating profile for: ${p.displayName}`);
					const body = await this.generatePersonProfile(p.displayName, p.email, emailChainContent);
					profile = await this.peopleManager.createProfileWithBody(p.mailboxName, p.email, body);
				} else {
					console.log(`[EmailChainHandler] Found existing profile for: ${p.displayName}`);
				}

				links.push(`- ${this.peopleManager.generateLink(profile)}`);
			} catch (err) {
				console.error(`[EmailChainHandler] Error processing participant ${p.displayName}:`, err);
				// Fall back to plain text if profile creation fails
				links.push(`- ${p.displayName}`);
			}
		}

		const newBody = links.join('\n');
		const newContent = this.replaceSection(content, 'Participants', newBody);
		await this.app.vault.modify(file, newContent);
		console.log(`[EmailChainHandler] Participants section updated with ${links.length} entries`);
		return newContent;
	}

	/**
	 * Ask Copilot to infer role/context for a person from the email thread.
	 * Returns markdown text to insert below the frontmatter in their People profile.
	 */
	private async generatePersonProfile(
		displayName: string,
		email: string,
		emailContext: string,
	): Promise<string> {
		const contextSnippet = emailContext.slice(0, 3000);
		const prompt =
			`Given the following HPE email thread, write a brief People profile for ${displayName} (${email}). ` +
			`Infer their role, team, or relevant context from the thread if possible. ` +
			`Output ONLY the markdown body text (no frontmatter, no headings, 1-3 sentences max).\n\n` +
			`Email thread:\n${contextSnippet}`;

		try {
			const raw = await this.copilotClient.sendPrompt(
				prompt, undefined, `Generating profile for ${displayName}…`
			);
			return cleanCopilotOutput(raw).trim();
		} catch (err) {
			console.warn(`[EmailChainHandler] Copilot profile generation failed for ${displayName}:`, err);
			return '';
		}
	}

	// ---------------------------------------------------------------------------
	// Summary
	// ---------------------------------------------------------------------------

	private async processSummary(
		file: TFile,
		content: string,
		emailChainContent: string,
	): Promise<string> {
		const skill = this.skillLoader.getSkill('email-summary');
		if (!skill) {
			console.warn('[EmailChainHandler] email-summary skill not found, using fallback prompt');
		}

		const outputFormat = skill?.sections.get('Output Format') ?? '';
		const styleGuidelines = skill?.sections.get('Style Guidelines') ?? '';

		const prompt =
			`You are an email summarization assistant. Analyze the following email thread and produce a concise structured summary.\n\n` +
			`${outputFormat}\n\n` +
			`${styleGuidelines}\n\n` +
			`Email thread to summarize:\n\n${emailChainContent}`;

		try {
			const raw = await this.copilotClient.sendPrompt(
				prompt, undefined, 'Generating email summary…'
			);
			const summary = cleanCopilotOutput(raw);

			const newContent = this.replaceSection(content, 'Summary', summary);
			await this.app.vault.modify(file, newContent);
			console.log('[EmailChainHandler] Summary section updated');
			return newContent;
		} catch (err) {
			console.error('[EmailChainHandler] Error generating summary:', err);
			throw err;
		}
	}

	// ---------------------------------------------------------------------------
	// Section utilities
	// ---------------------------------------------------------------------------

	/**
	 * Extract the content of a `# Heading` section.
	 * Returns empty string if section is absent.
	 */
	extractSection(content: string, heading: string): string {
		const headingIdx = content.indexOf(`# ${heading}`);
		if (headingIdx === -1) return '';

		const afterHeading = content.indexOf('\n', headingIdx);
		if (afterHeading === -1) return '';

		// Find the next top-level heading (# but not ##)
		const nextHeadingMatch = /\n# [^#]/g;
		nextHeadingMatch.lastIndex = afterHeading;
		const nextMatch = nextHeadingMatch.exec(content);
		const sectionEnd = nextMatch ? nextMatch.index : content.length;

		return content.slice(afterHeading + 1, sectionEnd).trim();
	}

	/**
	 * Returns true if the named `# Heading` section is empty (no non-whitespace content).
	 */
	isSectionEmpty(content: string, heading: string): boolean {
		return this.extractSection(content, heading).length === 0;
	}

	/**
	 * Replace the body of a `# Heading` section with newBody.
	 * If the section does not exist, the content is returned unchanged.
	 */
	replaceSection(content: string, heading: string, newBody: string): string {
		const headingIdx = content.indexOf(`# ${heading}`);
		if (headingIdx === -1) return content;

		const afterHeading = content.indexOf('\n', headingIdx);
		if (afterHeading === -1) return content;

		const nextHeadingMatch = /\n# [^#]/g;
		nextHeadingMatch.lastIndex = afterHeading;
		const nextMatch = nextHeadingMatch.exec(content);
		const sectionEnd = nextMatch ? nextMatch.index : content.length;

		return (
			content.slice(0, afterHeading + 1) +
			'\n' + newBody + '\n\n' +
			content.slice(sectionEnd)
		);
	}
}
