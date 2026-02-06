import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';

/**
 * Handles processing of general (non-standup) meetings
 */
export class GeneralMeetingHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private transcriptDetector: TranscriptDetector;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
	}

	/**
	 * Process a general meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing general meeting:', file.basename);

		// Read the meeting content
		const content = await this.app.vault.read(file);

		// Check if already has Copilot Summary (skip transcript cleaning if so)
		const hasCopilotSummary = this.hasCopilotSummary(content);

		// 1. Extract/populate attendees
		await this.processAttendees(file, content);

		// 2. Clean transcript (if no Copilot Summary)
		if (!hasCopilotSummary) {
			await this.cleanTranscript(file);
		}

		// 3. Generate summary
		await this.generateSummary(file);

		console.log('General meeting processing complete');
	}

	/**
	 * Check if meeting has a Copilot Summary section with content
	 */
	private hasCopilotSummary(content: string): boolean {
		const summaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (!summaryMatch) return false;
		
		const summaryContent = summaryMatch[1].trim();
		return summaryContent.length > 0;
	}

	/**
	 * Extract attendees from screenshots or content
	 */
	private async processAttendees(file: TFile, content: string): Promise<void> {
		console.log('Processing attendees...');
		
		// Check for screenshot references
		const screenshotPattern = /!\[\[SCR-.*?\.png\]\]/g;
		const screenshots = content.match(screenshotPattern);

		if (screenshots && screenshots.length > 0) {
			// TODO: Use Copilot vision to extract names from screenshots
			console.log('Found screenshots for attendee extraction:', screenshots);
		} else {
			// TODO: Extract names from meeting content
			console.log('No screenshots found, will extract from content');
		}

		// TODO: Create missing People profiles
		// TODO: Update Attendees section
	}

	/**
	 * Clean transcript based on detected format
	 */
	private async cleanTranscript(file: TFile): Promise<void> {
		console.log('Cleaning transcript...');
		
		const content = await this.app.vault.read(file);
		
		// Extract transcript section
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
		if (!transcriptMatch) {
			console.log('No transcript section found');
			return;
		}

		const transcriptContent = transcriptMatch[1].trim();
		if (!transcriptContent || transcriptContent.length < 10) {
			console.log('Transcript section is empty or too short');
			return;
		}

		// Detect format and clean
		const result = this.transcriptDetector.detectAndClean(transcriptContent);
		console.log(`Cleaned transcript using: ${result.cleaner}`);

		// Replace transcript section
		const newContent = content.replace(
			/# Transcript\s*\n[\s\S]*?(?=\n#|$)/,
			`# Transcript\n\n${result.cleaned}\n\n`
		);

		await this.app.vault.modify(file, newContent);
		console.log('Transcript cleaned and saved');
	}

	/**
	 * Generate meeting summary using Copilot
	 */
	private async generateSummary(file: TFile): Promise<void> {
		console.log('Generating summary...');
		
		const content = await this.app.vault.read(file);
		
		// Get the summary generation skill
		const summarySkill = this.skillLoader.getSkill('summary-generation');
		if (!summarySkill) {
			console.warn('Summary generation skill not found');
			return;
		}

		// Extract transcript or Copilot Summary for analysis
		let contentToSummarize = '';
		
		// Check for Copilot Summary first
		const copilotSummaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n+#\s|$)/);
		console.log('Copilot Summary match found:', !!copilotSummaryMatch);
		if (copilotSummaryMatch) {
			console.log('Copilot Summary raw length:', copilotSummaryMatch[1]?.length || 0);
			console.log('Copilot Summary trimmed length:', copilotSummaryMatch[1]?.trim().length || 0);
		}
		
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim().length > 50) {
			contentToSummarize = copilotSummaryMatch[1].trim();
			console.log('Using Copilot Summary for analysis, length:', contentToSummarize.length);
		} else {
			// Use transcript
			console.log('Copilot Summary empty or too short, trying Transcript...');
			const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n+#\s|$)/);
			console.log('Transcript match found:', !!transcriptMatch);
			if (transcriptMatch) {
				console.log('Transcript raw length:', transcriptMatch[1]?.length || 0);
				console.log('Transcript trimmed length:', transcriptMatch[1]?.trim().length || 0);
			}
			
			if (transcriptMatch && transcriptMatch[1].trim()) {
				contentToSummarize = transcriptMatch[1].trim();
				console.log('Using transcript for analysis, length:', contentToSummarize.length);
			}
		}

		if (!contentToSummarize || contentToSummarize.length < 20) {
			console.log('No content available for summary generation');
			return;
		}

		try {
			// Build prompt with skill instructions
			const prompt = `You are a meeting summarization assistant. Analyze the following meeting content and generate a structured summary.

${summarySkill.sections.get('Analysis Points') || ''}

${summarySkill.sections.get('Output Format') || ''}

${summarySkill.sections.get('Style Guidelines') || ''}

Meeting content to summarize:

${contentToSummarize}

CRITICAL INSTRUCTIONS:
- Output ONLY the summary content (Key Points, Decisions, Action Items, Follow-up)
- DO NOT include the "# Transcript Summary" heading
- DO NOT wrap in markdown code fences (no \`\`\`markdown)
- DO NOT include meta-commentary like "Here is the summary"
- Start directly with "**Key Points:**"`;

			// Get summary from Copilot
			console.log('Sending prompt to Copilot...');
			const summary = await this.copilotClient.sendPrompt(prompt);
			console.log('Received summary from Copilot, length:', summary.length);
			
			// Clean the summary response
			let cleanedSummary = summary.trim();
			
			// Strip markdown code fence if present
			if (cleanedSummary.startsWith('```markdown') || cleanedSummary.startsWith('```')) {
				cleanedSummary = cleanedSummary.replace(/^```markdown?\s*\n/, '').replace(/\n```\s*$/, '').trim();
				console.log('Stripped markdown code fence');
			}
			
			// Strip the heading if Copilot included it anyway
			cleanedSummary = cleanedSummary.replace(/^#\s+Transcript Summary\s*\n+/i, '').trim();
			
			console.log('Cleaned summary length:', cleanedSummary.length);
			
			// Re-read file to get absolutely latest content
			console.log('Re-reading file to ensure fresh content...');
			const freshContent = await this.app.vault.read(file);
			console.log('Fresh content length:', freshContent.length);
			
			// Show all section headings in the file
			const headings = freshContent.match(/^#[^#\n].*$/gm);
			console.log('Sections in file:', headings);
			
			// Update Transcript Summary section
			let newContent: string;
			
			// Regex that properly stops at the next # heading (with any amount of whitespace before it)
			const summaryRegex = /# Transcript Summary\s*\n([\s\S]*?)(?=\n+#\s)/;
			const existingSummaryMatch = freshContent.match(summaryRegex);
			
			if (existingSummaryMatch) {
				console.log('Found existing Transcript Summary section');
				console.log('Full match length:', existingSummaryMatch[0]?.length || 0);
				console.log('Content capture length:', existingSummaryMatch[1]?.length || 0);
				console.log('Content trimmed length:', existingSummaryMatch[1]?.trim().length || 0);
				console.log('First 100 chars of matched content:', existingSummaryMatch[1]?.substring(0, 100));
				
				// Replace only the content within the existing section
				newContent = freshContent.replace(summaryRegex, `# Transcript Summary\n\n${cleanedSummary}\n\n`);
				console.log('Replaced existing Transcript Summary section');
			} else {
				console.log('No Transcript Summary found - will insert new section');
				const copilotSummaryRegex = /(# Copilot Summary\s*\n[\s\S]*?)(\n+# )/;
				
				if (copilotSummaryRegex.test(freshContent)) {
					// Insert after Copilot Summary section
					newContent = freshContent.replace(
						copilotSummaryRegex,
						`$1\n\n# Transcript Summary\n\n${cleanedSummary}\n\n$2`
					);
					console.log('Inserted new Transcript Summary after Copilot Summary');
				} else {
					// Fallback: add at end if no Copilot Summary found
					console.log('No Copilot Summary found - adding Transcript Summary at end');
					newContent = freshContent + `\n\n# Transcript Summary\n\n${cleanedSummary}\n`;
				}
			}

			console.log('Old content length:', freshContent.length);
			console.log('New content length:', newContent.length);
			console.log('Content changed:', freshContent !== newContent);
			console.log('File path:', file.path);
			
			// Check if file is currently open in an editor
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			const activeLeaf = leaves.find(leaf => {
				const view = leaf.view as any;
				return view.getViewType() === 'markdown' && view.file?.path === file.path;
			});
			
			if (activeLeaf) {
				console.log('File is open, using editor API...');
				const view = activeLeaf.view as any;
				const editor = view.editor;
				if (editor) {
					// Replace entire content using editor
					const lastLine = editor.lastLine();
					const lastLineLength = editor.getLine(lastLine).length;
					editor.replaceRange(
						newContent,
						{ line: 0, ch: 0 },
						{ line: lastLine, ch: lastLineLength }
					);
					console.log('Editor content updated');
				} else {
					console.warn('No editor found, falling back to vault.modify()');
					await this.app.vault.modify(file, newContent);
				}
			} else {
				console.log('File not open, using vault.modify()...');
				await this.app.vault.modify(file, newContent);
			}
			
			console.log('Summary generated and saved');
		} catch (error) {
			console.error('Error generating summary:', error);
			throw error;
		}
	}
}
