import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { StatusBarManager } from '../ui/status-bar';
import { upsertSection } from '../section-utils';
import { BaseMeetingHandler } from './base-meeting-handler';

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
	async process(file: TFile): Promise<void> {
		console.log('Processing general meeting:', file.basename);

		try {
			const content = await this.app.vault.read(file);
			const hasCopilotSummary = this.hasCopilotSummary(content);

			this.statusBar.show('Extracting attendees...', 0);
			await this.processAttendees(file, content);

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

			this.statusBar.show('Generating summary...', 0);
			await this.generateSummary(file);

			this.statusBar.show('Complete!', 2000);
			console.log('General meeting processing complete');
		} catch (error) {
			this.statusBar.show('Error processing meeting', 3000);
			throw error;
		}
	}

	protected async resolveNonEmbedTranscript(file: TFile, _content: string, _rawTranscript: string): Promise<string | null> {
		const whisperPath = this.voiceResolver.resolveWhisperForMeeting(file);
		if (!whisperPath) {
			console.log('[expandTranscriptEmbed] No embed and no matching whisper file, skipping');
			return null;
		}

		console.log('[expandTranscriptEmbed] Found whisper file by meeting name:', whisperPath);
		const resolved = await this.resolveTranscriptContent(whisperPath, true);
		return resolved && resolved.length >= 20 ? resolved : null;
	}

	protected async buildUpdatedAttendeesContent(content: string, names: string[]): Promise<string | null> {
		const profiles = await Promise.all(
			names.map(async name => {
				if (this.settings.autoCreateProfiles) {
					return await this.peopleManager.getOrCreateProfile(name);
				}
				return await this.peopleManager.findProfile(name);
			}),
		);

		const attendeesList = profiles.map(profile => {
			if (profile.exists) {
				const link = this.peopleManager.generateLink(profile);
				return `- ${link}`;
			}
			return `- ${profile.displayName}`;
		}).join('\n');

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
