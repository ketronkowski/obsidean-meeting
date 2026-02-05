import { App } from 'obsidian';

export interface Skill {
	name: string;
	purpose: string;
	content: string;
	sections: Map<string, string>;
}

/**
 * Loads and parses skill definition files from the skills/ directory
 */
export class SkillLoader {
	private app: App;
	private pluginDir: string;
	private skills: Map<string, Skill> = new Map();

	constructor(app: App, pluginDir: string) {
		this.app = app;
		this.pluginDir = pluginDir;
	}

	/**
	 * Load all skill files from the skills/ directory
	 */
	async loadAll(): Promise<void> {
		const skillFiles = [
			'meeting-router.md',
			'general-meeting.md',
			'standup-meeting.md',
			'transcript-cleanup.md',
			'summary-generation.md',
			'jira-population.md',
			'attendee-extraction.md'
		];

		for (const filename of skillFiles) {
			try {
				await this.loadSkill(filename);
			} catch (error) {
				console.error(`Failed to load skill ${filename}:`, error);
			}
		}

		console.log(`Loaded ${this.skills.size} skills`);
	}

	/**
	 * Load a single skill file
	 */
	private async loadSkill(filename: string): Promise<void> {
		// Construct path relative to vault root
		// Plugin dir is something like: .obsidian/plugins/obsidean-meeting
		const path = `${this.pluginDir}/skills/${filename}`;
		
		// Use vault adapter to read file from plugin directory
		const adapter = this.app.vault.adapter;
		const content = await adapter.read(path);
		
		const skill = this.parseSkill(filename, content);
		
		const skillName = filename.replace('.md', '');
		this.skills.set(skillName, skill);
		
		console.log(`Loaded skill: ${skillName}`);
	}

	/**
	 * Parse markdown skill file into structured data
	 */
	private parseSkill(filename: string, content: string): Skill {
		const sections = new Map<string, string>();
		
		// Extract title and purpose
		const titleMatch = content.match(/^#\s+(.+)$/m);
		const name = titleMatch ? titleMatch[1] : filename.replace('.md', '');
		
		const purposeMatch = content.match(/##\s+Purpose\s*\n+([\s\S]*?)(?=\n##|$)/);
		const purpose = purposeMatch ? purposeMatch[1].trim() : '';

		// Extract all sections
		const sectionRegex = /##\s+(.+?)\s*\n+([\s\S]*?)(?=\n##|$)/g;
		let match;
		
		while ((match = sectionRegex.exec(content)) !== null) {
			const sectionTitle = match[1].trim();
			const sectionContent = match[2].trim();
			sections.set(sectionTitle, sectionContent);
		}

		return {
			name,
			purpose,
			content,
			sections
		};
	}

	/**
	 * Get a loaded skill by name
	 */
	getSkill(name: string): Skill | undefined {
		return this.skills.get(name);
	}

	/**
	 * Get all loaded skills
	 */
	getAllSkills(): Map<string, Skill> {
		return this.skills;
	}

	/**
	 * Get a specific section from a skill
	 */
	getSkillSection(skillName: string, sectionName: string): string | undefined {
		const skill = this.skills.get(skillName);
		return skill?.sections.get(sectionName);
	}
}
