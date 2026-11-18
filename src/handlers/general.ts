import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { getSection, replaceSection, upsertSection } from '../section-utils';
import { BaseMeetingHandler } from './base-meeting-handler';
import { isValidPersonName } from '../people-manager';

/**
 * Handles processing of general (non-standup) meetings
 */
export class GeneralMeetingHandler extends BaseMeetingHandler {
	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		super(app, settings, copilotClient, skillLoader, statusBar);
	}

	/**
	 * Process a general meeting file
	 */
	async process(file: TFile): Promise<'complete' | 'transcript-not-found'> {
		console.log('Processing general meeting:', file.basename);

		try {
			const content = await this.app.vault.read(file);
			const hasCopilotSummary = this.hasCopilotSummary(content);
			const alreadyHasTranscript = !!getSection(content, 'Transcript').trim()
				|| this.voiceResolver.resolveWhisperForMeeting(file) !== null;
			const selected = !alreadyHasTranscript && await this.selectWhisperExport(file);

			this.statusBar.show('Extracting attendees...', 0);
			await this.processAttendees(file, selected ? await this.app.vault.read(file) : content);
			if (!alreadyHasTranscript && !selected) return 'transcript-not-found';

			if (this.settings.voiceServiceEnabled) {
				this.statusBar.show('Identifying speakers by voice...', 0);
				await this.voiceResolver.identifyWhisperSpeakers(file);
			}

			this.statusBar.show('Expanding transcript...', 0);
			await this.expandTranscriptEmbed(file);

			this.statusBar.show('Identifying speakers...', 0);
			await this.resolveSpeakers(file);

			if (!hasCopilotSummary && this.settings.autoCleanTranscript) {
				this.statusBar.show('Cleaning transcript...', 0);
				await this.cleanTranscript(file);
			}

			this.statusBar.show('Adding named transcript speakers to attendees...', 0);
			await this.addTranscriptAttendees(file);
			await this.warnIfSpeakerCountMismatch(file);

			this.statusBar.show('Generating summary...', 0);
			await this.generateSummary(file);

			this.statusBar.show('Complete!', 2000);
			console.log('General meeting processing complete');
			return 'complete';
		} catch (error) {
			this.statusBar.show('Error processing meeting', 3000);
			throw error;
		}
	}

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

	protected async extractFromContent(content: string): Promise<string[]> {
		return super.extractFromContent(replaceSection(content, 'Transcript', ''));
	}

	private async addTranscriptAttendees(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const transcript = getSection(content, 'Transcript');
		const attendees = getSection(content, 'Attendees');
		const nameKey = (name: string) => {
			const [last, first] = name.split(',').map(part => part.trim());
			return (first ? `${first} ${last}` : last).toLowerCase().replace(/\s+/g, ' ');
		};
		const seen = new Set(this.extractExistingAttendeeNames(attendees).map(nameKey));
		for (const [, name] of attendees.matchAll(/^[-*+][ \t]+(.+)$/gm)) seen.add(nameKey(name.trim()));

		const names: string[] = [];
		for (const [, label] of transcript.matchAll(/^\[([^\[\]\r\n]+)\][ \t]*\r?$/gm)) {
			const name = label.trim();
			if (/^(?:unknown|unidentified|speaker|spk)(?:[\s_-]|$)/i.test(name)
				|| !isValidPersonName(name) || seen.has(nameKey(name))) continue;
			seen.add(nameKey(name));
			names.push(name);
		}
		if (!names.length) return;

		const lines = await this.formatAttendeeLines(names);
		await this.app.vault.process(file, current => {
			if (getSection(current, 'Attendees') !== attendees || getSection(current, 'Transcript') !== transcript) {
				throw new Error('Attendees or transcript changed during processing. Run Process Meeting again.');
			}
			const inMeeting = /(^## In Meeting(?: \(\d+\))?[ \t]*\r?\n)([\s\S]*?)(?=^#{1,2} |(?![\s\S]))/m;
			const body = inMeeting.test(attendees)
				? attendees.replace(inMeeting, (_section, _heading, entries: string) => {
					const count = (entries.match(/^[-*+][ \t]+/gm)?.length ?? 0) + lines.length;
					return [`## In Meeting (${count})`, entries.trimEnd(), ...lines, '', ''].join('\n');
				}).trimEnd()
				: [attendees, `## In Meeting (${lines.length})\n${lines.join('\n')}`].filter(Boolean).join('\n\n');
			return upsertSection(current, 'Attendees', body, { insertBeforeHeading: 'Transcript' });
		});
	}

	private async formatAttendeeLines(names: string[]): Promise<string[]> {
		const profiles = await Promise.all(
			names.map(async name => {
				if (this.settings.autoCreateProfiles) {
					return await this.peopleManager.getOrCreateProfile(name);
				}
				return await this.peopleManager.findProfile(name);
			}),
		);

		return profiles.map(profile => {
			if (profile.exists) {
				const link = this.peopleManager.generateLink(profile);
				return `- ${link}`;
			}
			return `- ${profile.displayName}`;
		});
	}

	protected async buildUpdatedAttendeesContent(content: string, names: string[]): Promise<string | null> {
		const attendeesList = (await this.formatAttendeeLines(names)).join('\n');
		const attendeesContent = `\n## In Meeting (${names.length})\n${attendeesList}\n`;
		const attendeesRegex = /# Attendees\s*\n([\s\S]*?)(?=\n+#\s)/;
		if (!attendeesRegex.test(content)) {
			return null;
		}

		return content.replace(attendeesRegex, `# Attendees${attendeesContent}\n`);
	}

	protected shouldUseMacWhisperSource(): boolean {
		return true;
	}
}

export function upsertSummarySection(content: string, newBody: string): string {
	return upsertSection(content, 'Summary', newBody, { insertBeforeHeading: 'Notes' });
}
