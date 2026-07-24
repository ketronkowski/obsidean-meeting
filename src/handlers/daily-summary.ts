import { App, Notice, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { cleanCopilotOutput } from '../output-cleaner';

const MAX_CONTENT_CHARS = 8000;

export class DailySummaryHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private statusBar: StatusBarManager;

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
	}

	async process(file: TFile): Promise<void> {
		console.log(`[DailySummaryHandler] Processing daily note: ${file.basename}`);

		// basename is the filename without extension, e.g. "2026-05-22"
		const date = file.basename;

		this.statusBar.show('Scanning for linked meetings and notes...', 0);
		const { meetings, notes } = this.getLinkedFiles(date);
		console.log(`[DailySummaryHandler] Found ${meetings.length} meetings, ${notes.length} notes for ${date}`);

		const dailyNoteContent = await this.app.vault.read(file);

		this.statusBar.show('Reading linked content...', 0);
		const context = await this.buildContext(dailyNoteContent, meetings, notes);

		this.statusBar.show('Generating daily summary...', 0);
		const summary = await this.generateSummary(date, context);

		const newContent = upsertDailySummarySection(dailyNoteContent, summary);
		await this.app.vault.modify(file, newContent);

		this.statusBar.show('Daily summary generated', 3000);
		new Notice('Daily summary generated!');
	}

	/**
	 * Find meeting and note files in the vault that belong to the given date.
	 * Meetings: files in meetingsFolder whose name starts with "YYYY-MM-DD - "
	 * Notes: files in notesFolder whose name starts with "YYYY-MM-DD"
	 */
	getLinkedFiles(date: string): { meetings: TFile[], notes: TFile[] } {
		const allFiles = this.app.vault.getMarkdownFiles();
		const meetingsFolder = this.settings.meetingsFolder.replace(/^\/|\/$/g, '');
		const notesFolder = (this.settings.notesFolder ?? 'Notes').replace(/^\/|\/$/g, '');

		const meetings = allFiles.filter(f =>
			f.path.startsWith(meetingsFolder + '/') &&
			f.name.startsWith(date + ' - ')
		);

		const notes = allFiles.filter(f =>
			f.path.startsWith(notesFolder + '/') &&
			f.name.startsWith(date)
		);

		return { meetings, notes };
	}

	private async buildContext(
		dailyNoteContent: string,
		meetings: TFile[],
		notes: TFile[],
	): Promise<string> {
		const parts: string[] = [];

		const shortConv = this.extractSection(dailyNoteContent, 'Short Conversations and Notes');
		if (shortConv && shortConv !== '-') {
			parts.push(`## Short Conversations and Notes\n\n${shortConv}`);
		}

		for (const meetingFile of meetings) {
			try {
				const raw = await this.app.vault.read(meetingFile);
				const summary = this.extractSummaryFromContent(raw);
				parts.push(`## Meeting: ${meetingFile.basename}\n\n${summary}`);
			} catch (err) {
				console.warn(`[DailySummaryHandler] Could not read meeting: ${meetingFile.path}`, err);
			}
		}

		for (const noteFile of notes) {
			try {
				const raw = await this.app.vault.read(noteFile);
				const summary = this.extractSummaryFromContent(raw);
				parts.push(`## Note: ${noteFile.basename}\n\n${summary}`);
			} catch (err) {
				console.warn(`[DailySummaryHandler] Could not read note: ${noteFile.path}`, err);
			}
		}

		return parts.length > 0
			? parts.join('\n\n---\n\n')
			: '(No meeting notes, general notes, or conversations found for this day.)';
	}

	/**
	 * Extract the content of a `## Heading` section (level-2 headings used in daily notes).
	 */
	private extractSection(content: string, heading: string): string {
		const headingIdx = content.indexOf(`## ${heading}`);
		if (headingIdx === -1) return '';

		const afterHeading = content.indexOf('\n', headingIdx);
		if (afterHeading === -1) return '';

		const nextHeadingMatch = /\n## /g;
		nextHeadingMatch.lastIndex = afterHeading;
		const nextMatch = nextHeadingMatch.exec(content);
		const sectionEnd = nextMatch ? nextMatch.index : content.length;

		return content.slice(afterHeading + 1, sectionEnd).trim();
	}

	/**
	 * Extract the most useful summary text from a meeting or note file.
	 *
	 * Priority:
	 * 1. `# Summary` — canonical summary written by this plugin
	 * 2. `# Copilot Summary` — Teams AI summary
	 * 3. Fallback: first MAX_CONTENT_CHARS chars of content (truncated)
	 */
	extractSummaryFromContent(content: string): string {
		// Try # Summary (level-1, written by the meeting processor)
		const summaryMatch = /^# Summary\b[^\n]*/m.exec(content);
		if (summaryMatch) {
			const bodyStart = content.indexOf('\n', summaryMatch.index + summaryMatch[0].length) + 1;
			const remaining = content.slice(bodyStart);
			const nextSection = /^# (?!#)/m.exec(remaining);
			const body = nextSection ? remaining.slice(0, nextSection.index) : remaining;
			const trimmed = body.trim();
			if (trimmed) return trimmed;
		}

		// Try # Copilot Summary (Teams AI)
		const copilotMatch = /^# Copilot Summary\b[^\n]*/m.exec(content);
		if (copilotMatch) {
			const bodyStart = content.indexOf('\n', copilotMatch.index + copilotMatch[0].length) + 1;
			const remaining = content.slice(bodyStart);
			const nextSection = /^# (?!#)/m.exec(remaining);
			const body = nextSection ? remaining.slice(0, nextSection.index) : remaining;
			const trimmed = body.trim();
			if (trimmed) return trimmed;
		}

		// Fallback: truncated raw content
		return content.length > MAX_CONTENT_CHARS
			? content.slice(0, MAX_CONTENT_CHARS) + '\n[... truncated — no summary section found]'
			: content;
	}

	private async generateSummary(date: string, context: string): Promise<string> {
		const skill = this.skillLoader.getSkill('daily-summary');
		if (!skill) {
			console.warn('[DailySummaryHandler] daily-summary skill not found, using fallback prompt');
		}

		const workflow = skill?.sections.get('Workflow') ?? '';
		const outputFormat = skill?.sections.get('Output Format') ?? '';
		const handlingSparse = skill?.sections.get('Handling Sparse Days') ?? '';

		const prompt =
			`You are generating a daily work summary for ${date}.\n\n` +
			`${workflow}\n\n` +
			`${outputFormat}\n\n` +
			`${handlingSparse}\n\n` +
			`IMPORTANT: Output ONLY the content that goes inside the ## Daily Summary section.\n` +
			`Do NOT include "## Daily Summary" in your output — start directly with the ### subsections.\n\n` +
			`Content from this day:\n\n${context}`;

		try {
			const raw = await this.copilotClient.sendPrompt(
				prompt, undefined, 'Generating daily summary...'
			);
			return cleanCopilotOutput(raw).trim();
		} catch (err) {
			console.error('[DailySummaryHandler] Error generating summary:', err);
			throw err;
		}
	}
}

/**
 * Upsert the `## Daily Summary` section in a daily note.
 *
 * - If `## Daily Summary` already exists: replace its content in-place.
 * - If it doesn't exist: insert before `## Short Conversations and Notes`.
 * - Fallback: append to end of file.
 */
export function upsertDailySummarySection(content: string, newBody: string): string {
	const headingMatch = /^## Daily Summary\b[^\n]*/m.exec(content);
	if (headingMatch) {
		const headingStart = headingMatch.index;
		const bodyStart = content.indexOf('\n', headingStart + headingMatch[0].length) + 1;
		const remaining = content.slice(bodyStart);
		const nextSection = /^## /m.exec(remaining);
		const bodyEnd = nextSection ? bodyStart + nextSection.index : content.length;
		return (
			content.slice(0, headingStart) +
			`## Daily Summary\n\n${newBody}\n\n` +
			content.slice(bodyEnd)
		);
	}

	// Insert before ## Short Conversations and Notes if present
	const shortConvMatch = /^## Short Conversations and Notes\b/m.exec(content);
	if (shortConvMatch) {
		return (
			content.slice(0, shortConvMatch.index) +
			`## Daily Summary\n\n${newBody}\n\n` +
			content.slice(shortConvMatch.index)
		);
	}

	// Fallback: append
	return content.trimEnd() + `\n\n## Daily Summary\n\n${newBody}\n`;
}
