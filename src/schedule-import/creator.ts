import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { PeopleManager } from '../people-manager';
import { ParsedScheduleItem } from './parser';
import { sanitizeMeetingTitle } from './filename';

export interface CreateScheduleNoteResult {
	status: 'created' | 'duplicate';
	path: string;
	file?: TFile;
}

const TEMPLATER_WHEN_PATTERN = /when:\s*<%.*?%>/;

/**
 * Builds the target `Meetings/{date} - {title}.md` path for a parsed item.
 * The note keeps the meeting's real title as its filename (e.g. "Green Team
 * Daily Meeting") even when it's the Green Standup — see
 * `settings.standupKeywords`, which must include that title for
 * `detectMeetingType()` to still route it to `StandupMeetingHandler`.
 */
export function buildTargetPath(meetingsFolder: string, date: string, item: ParsedScheduleItem): string {
	const sanitizedTitle = sanitizeMeetingTitle(item.title);
	return `${meetingsFolder}/${date} - ${sanitizedTitle}.md`;
}

/**
 * Reads the appropriate vault template (Meeting Notes or Green Standup Notes)
 * and substitutes the single Templater `when:` date expression with the
 * note's real date, leaving the rest of the template (attendee defaults,
 * # JIRA section, etc.) exactly as authored so future template edits apply
 * automatically.
 */
async function loadTemplateBody(app: App, settings: MeetingProcessorSettings, date: string, isGreenStandup: boolean): Promise<string> {
	const templatesFolder = (settings.templatesFolder ?? 'Templates').replace(/^\/|\/$/g, '');
	const templateName = isGreenStandup ? 'Green Standup Notes.md' : 'Meeting Notes.md';
	const templatePath = `${templatesFolder}/${templateName}`;

	const templateFile = app.vault.getAbstractFileByPath(templatePath);
	if (!(templateFile instanceof TFile)) {
		throw new Error(`Template not found: ${templatePath}`);
	}

	const raw = await app.vault.read(templateFile);
	return raw.replace(TEMPLATER_WHEN_PATTERN, `when: ${date}`);
}

/**
 * Injects `start`/`end`/`organizer` frontmatter keys just before the closing
 * `---` of the template's frontmatter block.
 */
function injectFrontmatter(content: string, extraLines: string[]): string {
	const closingIdx = content.indexOf('\n---', content.indexOf('---') + 3);
	if (closingIdx === -1) {
		// No closing frontmatter delimiter found — leave content untouched.
		return content;
	}
	return content.slice(0, closingIdx) + '\n' + extraLines.join('\n') + content.slice(closingIdx);
}

/**
 * Creates a single meeting note for a parsed schedule item:
 *  - loads the correct vault template (Green Standup vs. general Meeting Notes)
 *  - stamps `when`, `start`, `end` (simple 12-hour clock times, e.g. "11:00 AM"),
 *    and `organizer` frontmatter
 *  - resolves (or creates) the organizer's People profile and links it via the
 *    `organizer` frontmatter key only — the organizer is NOT added to the
 *    `# Attendees` section; regular attendee processing (screenshots/content
 *    scan) handles that section independently
 *  - skips creation if the target path already exists (duplicate handling)
 */
export async function createScheduleNote(
	app: App,
	settings: MeetingProcessorSettings,
	peopleManager: PeopleManager,
	date: string,
	item: ParsedScheduleItem,
): Promise<CreateScheduleNoteResult> {
	const meetingsFolder = (settings.meetingsFolder ?? 'Meetings').replace(/^\/|\/$/g, '');
	const targetPath = buildTargetPath(meetingsFolder, date, item);

	if (app.vault.getAbstractFileByPath(targetPath)) {
		return { status: 'duplicate', path: targetPath };
	}

	let body = await loadTemplateBody(app, settings, date, item.isGreenStandup);

	const frontmatterLines = [
		`start: "${item.startTime}"`,
		`end: "${item.endTime}"`,
	];

	if (item.organizer) {
		const organizerProfile = await peopleManager.getOrCreateProfile(item.organizer);
		const organizerLink = peopleManager.generateLink(organizerProfile);
		frontmatterLines.push(`organizer: "${organizerLink}"`);
	}

	body = injectFrontmatter(body, frontmatterLines);

	const folder = app.vault.getAbstractFileByPath(meetingsFolder);
	if (!folder) {
		await app.vault.createFolder(meetingsFolder);
	}

	const file = await app.vault.create(targetPath, body);
	return { status: 'created', path: targetPath, file };
}
