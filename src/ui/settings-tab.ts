import { App, PluginSettingTab, Setting } from 'obsidian';
import MeetingProcessorPlugin from '../../main';

export interface MeetingProcessorSettings {
	// AI Settings
	model: string;
	copilotCliPath: string;
	
	// Vault Paths
	meetingsFolder: string;
	peopleFolder: string;
	mediaFolder: string;
	templatesFolder: string;
	
	// Processing Preferences
	autoCreateProfiles: boolean;
	autoCleanTranscript: boolean;
	
	// JIRA Integration
	jiraEmail: string;
	jiraApiToken: string;
	jiraBaseUrl: string;
	greenBoardId: string;
	magentaBoardId: string;
	jiraProjectKey: string;
	
	// Meeting Detection
	standupKeywords: string;
	filenamePattern: string;
}

export const DEFAULT_SETTINGS: MeetingProcessorSettings = {
	model: 'claude-sonnet-4',
	copilotCliPath: 'copilot', // Will be auto-detected or set by user
	meetingsFolder: 'Meetings',
	peopleFolder: 'People',
	mediaFolder: 'Media',
	templatesFolder: 'Templates',
	autoCreateProfiles: true,
	autoCleanTranscript: true,
	jiraEmail: '',
	jiraApiToken: '',
	jiraBaseUrl: 'https://hpe.atlassian.net',
	greenBoardId: '214',
	magentaBoardId: '317',
	jiraProjectKey: 'GLCP',
	standupKeywords: 'Green Standup, Magenta Standup',
	filenamePattern: 'YYYY-MM-DD - *.md'
};

export class MeetingProcessorSettingTab extends PluginSettingTab {
	plugin: MeetingProcessorPlugin;

	constructor(app: App, plugin: MeetingProcessorPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// AI Settings
		containerEl.createEl('h2', { text: 'AI Settings' });

		new Setting(containerEl)
			.setName('Model')
			.setDesc('AI model to use for processing')
			.addDropdown(dropdown => dropdown
				.addOption('claude-sonnet-4', 'Claude Sonnet 4')
				.addOption('claude-sonnet-4.5', 'Claude Sonnet 4.5')
				.addOption('claude-haiku-4', 'Claude Haiku 4')
				.addOption('gpt-4.1', 'GPT-4.1')
				.addOption('gpt-5', 'GPT-5')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Copilot CLI Path')
			.setDesc('Path to copilot executable (leave default or use full path like /Users/you/.nvm/versions/node/v25.2.1/bin/copilot)')
			.addText(text => text
				.setPlaceholder('copilot')
				.setValue(this.plugin.settings.copilotCliPath)
				.onChange(async (value) => {
					this.plugin.settings.copilotCliPath = value || 'copilot';
					await this.plugin.saveSettings();
				}));

		// Vault Paths
		containerEl.createEl('h2', { text: 'Vault Paths' });

		new Setting(containerEl)
			.setName('Meetings Folder')
			.setDesc('Folder containing meeting notes')
			.addText(text => text
				.setPlaceholder('Meetings')
				.setValue(this.plugin.settings.meetingsFolder)
				.onChange(async (value) => {
					this.plugin.settings.meetingsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('People Folder')
			.setDesc('Folder containing people profiles')
			.addText(text => text
				.setPlaceholder('People')
				.setValue(this.plugin.settings.peopleFolder)
				.onChange(async (value) => {
					this.plugin.settings.peopleFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Media Folder')
			.setDesc('Folder containing images and attachments')
			.addText(text => text
				.setPlaceholder('Media')
				.setValue(this.plugin.settings.mediaFolder)
				.onChange(async (value) => {
					this.plugin.settings.mediaFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Templates Folder')
			.setDesc('Folder containing note templates')
			.addText(text => text
				.setPlaceholder('Templates')
				.setValue(this.plugin.settings.templatesFolder)
				.onChange(async (value) => {
					this.plugin.settings.templatesFolder = value;
					await this.plugin.saveSettings();
				}));

		// Processing Preferences
		containerEl.createEl('h2', { text: 'Processing Preferences' });

		new Setting(containerEl)
			.setName('Auto-create People Profiles')
			.setDesc('Automatically create People profiles for extracted attendees')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCreateProfiles)
				.onChange(async (value) => {
					this.plugin.settings.autoCreateProfiles = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto-clean Transcripts')
			.setDesc('Automatically clean and format transcripts (only if no Copilot Summary exists)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoCleanTranscript)
				.onChange(async (value) => {
					this.plugin.settings.autoCleanTranscript = value;
					await this.plugin.saveSettings();
				}));

		// JIRA Integration
		containerEl.createEl('h2', { text: 'JIRA Integration' });

		new Setting(containerEl)
			.setName('JIRA Email')
			.setDesc('Your Atlassian account email address')
			.addText(text => text
				.setPlaceholder('you@example.com')
				.setValue(this.plugin.settings.jiraEmail)
				.onChange(async (value) => {
					this.plugin.settings.jiraEmail = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('JIRA API Token')
			.setDesc('Create at: https://id.atlassian.com/manage-profile/security/api-tokens (can reuse token from JIRA Issue plugin)')
			.addText(text => {
				text.inputEl.type = 'password';
				text.setPlaceholder('Your API token')
					.setValue(this.plugin.settings.jiraApiToken)
					.onChange(async (value) => {
						this.plugin.settings.jiraApiToken = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('JIRA Base URL')
			.setDesc('Your Atlassian instance URL')
			.addText(text => text
				.setPlaceholder('https://hpe.atlassian.net')
				.setValue(this.plugin.settings.jiraBaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.jiraBaseUrl = value;
					await this.plugin.saveSettings();
				}));
		
		containerEl.createEl('h3', { text: 'Board Configuration' });

		new Setting(containerEl)
			.setName('Green Team Board ID')
			.setDesc('JIRA board ID for Green Team')
			.addText(text => text
				.setPlaceholder('214')
				.setValue(this.plugin.settings.greenBoardId)
				.onChange(async (value) => {
					this.plugin.settings.greenBoardId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Magenta Team Board ID')
			.setDesc('JIRA board ID for Magenta Team')
			.addText(text => text
				.setPlaceholder('331')
				.setValue(this.plugin.settings.magentaBoardId)
				.onChange(async (value) => {
					this.plugin.settings.magentaBoardId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('JIRA Project Key')
			.setDesc('JIRA project key (e.g., GLCP)')
			.addText(text => text
				.setPlaceholder('GLCP')
				.setValue(this.plugin.settings.jiraProjectKey)
				.onChange(async (value) => {
					this.plugin.settings.jiraProjectKey = value;
					await this.plugin.saveSettings();
				}));

		// Meeting Detection
		containerEl.createEl('h2', { text: 'Meeting Detection' });

		new Setting(containerEl)
			.setName('Standup Keywords')
			.setDesc('Comma-separated keywords to identify standup meetings')
			.addText(text => text
				.setPlaceholder('Green Standup, Magenta Standup')
				.setValue(this.plugin.settings.standupKeywords)
				.onChange(async (value) => {
					this.plugin.settings.standupKeywords = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Filename Pattern')
			.setDesc('Expected meeting filename pattern')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD - *.md')
				.setValue(this.plugin.settings.filenamePattern)
				.setDisabled(true)); // Read-only for now

		// Reset button
		new Setting(containerEl)
			.setName('Reset to Defaults')
			.setDesc('Reset all settings to their default values')
			.addButton(button => button
				.setButtonText('Reset')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
					await this.plugin.saveSettings();
					this.display(); // Refresh display
				}));
	}
}
