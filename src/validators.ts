import { TFile, App } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validates that a file is a proper meeting file
 */
export async function validateMeetingFile(
	file: TFile,
	app: App,
	settings: MeetingProcessorSettings
): Promise<ValidationResult> {
	// Check file exists and is markdown
	if (!file || file.extension !== 'md') {
		return { valid: false, error: 'Not a markdown file' };
	}

	// Check file is in Meetings folder
	const meetingsFolder = settings.meetingsFolder.replace(/^\/|\/$/g, ''); // Remove leading/trailing slashes
	if (!file.path.startsWith(meetingsFolder + '/')) {
		return {
			valid: false,
			error: `File must be in the ${meetingsFolder} folder`
		};
	}

	// Check filename pattern: YYYY-MM-DD - *.md
	const filenamePattern = /^\d{4}-\d{2}-\d{2} - .+\.md$/;
	const filename = file.name;
	if (!filenamePattern.test(filename)) {
		return {
			valid: false,
			error: 'Filename must match pattern: YYYY-MM-DD - <name>.md'
		};
	}

	// Check frontmatter has meeting tag
	const content = await app.vault.read(file);
	const hasMeetingTag = content.includes('tags: [meeting]') || 
	                       content.includes('tags:\n  - meeting') ||
	                       content.includes('tags: meeting');
	
	if (!hasMeetingTag) {
		return {
			valid: false,
			error: 'File must have "meeting" tag in frontmatter'
		};
	}

	return { valid: true };
}

/**
 * Validates that a file is a Daily Note.
 * Requirements: in the configured dailyNotesFolder, filename matches YYYY-MM-DD.md exactly.
 */
export async function validateDailyNote(
	file: TFile,
	app: App,
	settings: MeetingProcessorSettings
): Promise<ValidationResult> {
	if (!file || file.extension !== 'md') {
		return { valid: false, error: 'Not a markdown file' };
	}

	const dailyNotesFolder = (settings.dailyNotesFolder ?? 'Daily Notes').replace(/^\/|\/$/g, '');
	if (!file.path.startsWith(dailyNotesFolder + '/')) {
		return {
			valid: false,
			error: `File must be in the ${dailyNotesFolder} folder`
		};
	}

	// Filename must be exactly YYYY-MM-DD.md
	if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) {
		return {
			valid: false,
			error: 'Filename must match pattern: YYYY-MM-DD.md'
		};
	}

	return { valid: true };
}


/**
 * Validates that a file is a processable email chain note.
 * Requirements: in Notes folder, tags: note, has # Email Chain section.
 */
export async function validateEmailNote(
	file: TFile,
	app: App,
	settings: MeetingProcessorSettings
): Promise<ValidationResult> {
	if (!file || file.extension !== 'md') {
		return { valid: false, error: 'Not a markdown file' };
	}

	const notesFolder = (settings.notesFolder ?? 'Notes').replace(/^\/|\/$/g, '');
	if (!file.path.startsWith(notesFolder + '/')) {
		return { valid: false, error: `File must be in the ${notesFolder} folder` };
	}

	const content = await app.vault.read(file);

	const hasNoteTag = content.includes('tags: [note]') ||
	                   content.includes('tags:\n  - note') ||
	                   content.includes('tags: note');
	if (!hasNoteTag) {
		return { valid: false, error: 'File must have "note" tag in frontmatter' };
	}

	if (!content.includes('# Email Chain')) {
		return { valid: false, error: 'File must have a "# Email Chain" section' };
	}

	return { valid: true };
}


export function detectMeetingType(file: TFile, settings: MeetingProcessorSettings): 'standup' | 'general' {
	const keywords = settings.standupKeywords.split(',').map(k => k.trim());
	const filename = file.basename; // Without extension
	
	for (const keyword of keywords) {
		if (filename.includes(keyword)) {
			return 'standup';
		}
	}
	
	return 'general';
}

/**
 * Detects team from standup filename
 */
export function detectTeam(file: TFile): 'green' | null {
	const filename = file.basename.toLowerCase();
	
	if (filename.includes('green')) {
		return 'green';
	}
	
	return null;
}
