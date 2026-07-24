import { App, TFile, TFolder } from 'obsidian';

export interface PersonProfile {
	file: TFile | null;
	displayName: string;
	firstName: string;
	lastName: string;
	exists: boolean;
}

/**
 * Returns true if the string looks like a real human name:
 * - Only letters, spaces, hyphens, apostrophes, periods, and commas
 * - No wikilink brackets, pipes, JIRA-key patterns, or long sentences
 * - At least 2 characters
 */
export function isValidPersonName(name: string): boolean {
	if (!name || name.length < 2 || name.length > 60) return false;
	// Reject wikilink fragments, brackets, pipes, angle brackets, etc.
	if (/[\[\]|{}<>!]/.test(name)) return false;
	// Reject JIRA keys like GLCP-12345
	if (/^[A-Z]+-\d+$/.test(name)) return false;
	// Reject obvious non-name patterns: starts with lowercase, contains sentence punctuation
	if (/[.?!]/.test(name)) return false;
	// Must contain at least one letter
	if (!/[a-zA-Z]/.test(name)) return false;
	// Must look roughly like a name: letters, spaces, hyphens, apostrophes, commas only
	if (/[^a-zA-ZÀ-ÖØ-öø-ÿ\s',\-.]/.test(name)) return false;
	return true;
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
	 * Create a new People profile with an explicit body (content below frontmatter).
	 * Used by the email handler to inject Copilot-generated profile text.
	 */
	async createProfileWithBody(fullName: string, email: string, body: string): Promise<PersonProfile> {
		const { firstName, lastName } = this.parseName(fullName);

		const folder = this.app.vault.getAbstractFileByPath(this.peopleFolder);
		if (!folder) {
			await this.app.vault.createFolder(this.peopleFolder);
		}

		const fileName = `${lastName}, ${firstName}.md`;
		const filePath = `${this.peopleFolder}/${fileName}`;

		const emailLine = email ? `email: ${email}\n` : '';
		const content = `---
aliases:
  - ${firstName} ${lastName}
${emailLine}tags:
  - People
---
${body ? body.trim() + '\n' : ''}`;

		const file = await this.app.vault.create(filePath, content);
		console.log(`Created People profile with context: ${filePath}`);

		return {
			file,
			displayName: `${firstName} ${lastName}`,
			firstName,
			lastName,
			exists: true,
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
		// Skip generic speaker labels and anything that doesn't look like a real name
		if (/^Speaker\s+\d+$/i.test(fullName) || !isValidPersonName(fullName)) {
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
	 * Return all People profiles in the vault as AttendeeLink-compatible objects.
	 * Used to populate the speaker resolution modal with the full roster of known people.
	 */
	getAllPeople(): Array<{ displayName: string; wikiLink: string }> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const peopleFiles = allFiles.filter(f => f.path.startsWith(this.peopleFolder + '/'));

		return peopleFiles.map(f => {
			// Prefer alias "First Last" over filename "Last, First"
			const meta = this.app.metadataCache.getFileCache(f);
			const aliases: string[] = meta?.frontmatter?.aliases ?? [];
			const firstAlias = aliases[0]?.trim();
			const displayName = firstAlias || f.basename.replace(',', '').replace(/\s+/, ' ').trim();
			return { displayName, wikiLink: `[[${f.basename}|${displayName}]]` };
		}).filter(p =>
			p.displayName.length > 0 &&
			isValidPersonName(p.displayName) &&
			// Skip files whose basenames start with special chars (corrupted filenames)
			!/^[\[{(,|!]/.test(p.wikiLink.slice(2))
		);
	}

	generateLink(profile: PersonProfile): string {
		if (!profile.exists || !profile.file) {
			// No profile, return plain text
			return profile.displayName;
		}
		
		// Generate link with display text — no folder prefix in Obsidian wikilinks
		const fileName = profile.file.basename; // "Last, First"
		const displayName = `${profile.firstName} ${profile.lastName}`;
		
		return `[[${fileName}|${displayName}]]`;
	}
}
