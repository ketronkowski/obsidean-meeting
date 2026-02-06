import { App, TFile, TFolder } from 'obsidian';

export interface PersonProfile {
	file: TFile | null;
	displayName: string;
	firstName: string;
	lastName: string;
	exists: boolean;
}

/**
 * Manages People profiles in the vault
 */
export class PeopleManager {
	private app: App;
	private peopleFolder: string = 'People';

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Parse a full name into first and last name
	 * Handles: "First Last", "Last, First"
	 */
	parseName(fullName: string): { firstName: string; lastName: string } {
		fullName = fullName.trim();
		
		// Handle "Last, First" format
		if (fullName.includes(',')) {
			const parts = fullName.split(',').map(p => p.trim());
			return {
				lastName: parts[0],
				firstName: parts[1] || ''
			};
		}
		
		// Handle "First Last" format (assume last word is last name)
		const parts = fullName.split(/\s+/);
		if (parts.length === 1) {
			return { firstName: parts[0], lastName: '' };
		}
		
		const lastName = parts[parts.length - 1];
		const firstName = parts.slice(0, -1).join(' ');
		
		return { firstName, lastName };
	}

	/**
	 * Search for an existing People profile
	 * Returns the profile if found, or null if not found
	 */
	async findProfile(fullName: string): Promise<PersonProfile> {
		const { firstName, lastName } = this.parseName(fullName);
		
		// Generate expected filename: "Last, First.md"
		const expectedFileName = `${lastName}, ${firstName}.md`;
		const expectedPath = `${this.peopleFolder}/${expectedFileName}`;
		
		// Check if file exists
		const file = this.app.vault.getAbstractFileByPath(expectedPath);
		
		if (file instanceof TFile) {
			return {
				file,
				displayName: fullName,
				firstName,
				lastName,
				exists: true
			};
		}
		
		// Try searching by alias (in case name format is different)
		const allFiles = this.app.vault.getMarkdownFiles();
		const peopleFiles = allFiles.filter(f => f.path.startsWith(this.peopleFolder + '/'));
		
		for (const f of peopleFiles) {
			const metadata = this.app.metadataCache.getFileCache(f);
			const aliases = metadata?.frontmatter?.aliases || [];
			
			// Check if any alias matches the full name
			if (aliases.some((alias: string) => 
				alias.toLowerCase() === fullName.toLowerCase() ||
				alias.toLowerCase() === `${firstName} ${lastName}`.toLowerCase()
			)) {
				return {
					file: f,
					displayName: fullName,
					firstName,
					lastName,
					exists: true
				};
			}
		}
		
		// Not found
		return {
			file: null,
			displayName: fullName,
			firstName,
			lastName,
			exists: false
		};
	}

	/**
	 * Create a new People profile
	 * Uses template format: frontmatter with aliases and tags
	 */
	async createProfile(fullName: string): Promise<PersonProfile> {
		const { firstName, lastName } = this.parseName(fullName);
		
		// Ensure People folder exists
		const folder = this.app.vault.getAbstractFileByPath(this.peopleFolder);
		if (!folder) {
			await this.app.vault.createFolder(this.peopleFolder);
		}
		
		// Generate filename: "Last, First.md"
		const fileName = `${lastName}, ${firstName}.md`;
		const filePath = `${this.peopleFolder}/${fileName}`;
		
		// Create frontmatter content
		const content = `---
aliases:
  - ${firstName} ${lastName}
tags:
  - People
---
`;
		
		// Create the file
		const file = await this.app.vault.create(filePath, content);
		
		console.log(`Created People profile: ${filePath}`);
		
		return {
			file,
			displayName: fullName,
			firstName,
			lastName,
			exists: true
		};
	}

	/**
	 * Get or create a profile for a name
	 * Searches first, creates if not found
	 */
	async getOrCreateProfile(fullName: string): Promise<PersonProfile> {
		// Skip generic speaker labels
		if (/^Speaker\s+\d+$/i.test(fullName)) {
			return {
				file: null,
				displayName: fullName,
				firstName: fullName,
				lastName: '',
				exists: false
			};
		}
		
		// Search for existing profile
		const existing = await this.findProfile(fullName);
		
		if (existing.exists) {
			console.log(`Found existing profile for: ${fullName}`);
			return existing;
		}
		
		// Create new profile
		console.log(`Creating new profile for: ${fullName}`);
		return await this.createProfile(fullName);
	}

	/**
	 * Generate a wiki link to a profile
	 * Returns [[People/Last, First|First Last]] or just the name if no profile
	 */
	generateLink(profile: PersonProfile): string {
		if (!profile.exists || !profile.file) {
			// No profile, return plain text
			return profile.displayName;
		}
		
		// Generate link with display text
		const fileName = profile.file.basename; // "Last, First"
		const displayName = `${profile.firstName} ${profile.lastName}`;
		
		return `[[${this.peopleFolder}/${fileName}|${displayName}]]`;
	}
}
