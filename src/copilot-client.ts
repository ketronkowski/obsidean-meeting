import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { MeetingProcessorSettings } from './ui/settings-tab';

/**
 * Manages Copilot SDK client lifecycle
 */
export class CopilotClientManager {
	private settings: MeetingProcessorSettings;
	private client: CopilotClient | null = null;
	private activeSession: any | null = null;

	constructor(settings: MeetingProcessorSettings) {
		this.settings = settings;
	}

	/**
	 * Initialize the Copilot client
	 */
	async initialize(): Promise<void> {
		if (this.client) {
			return; // Already initialized
		}

		try {
			console.log('Initializing Copilot client...');
			console.log('CLI path:', this.settings.copilotCliPath);
			
			// Use TCP mode (not stdio) which works better in Electron
			this.client = new CopilotClient({
				cliPath: this.settings.copilotCliPath,
				autoStart: true,
				useStdio: false, // Important: stdio doesn't work in Obsidian
				port: 0, // Use random available port
				logLevel: 'warning'
			});
			
			await this.client.start();
			console.log('Copilot client initialized and started successfully');
		} catch (error) {
			console.error('Failed to initialize Copilot client:', error);
			
			// Provide helpful error message
			const errorMsg = error.message || String(error);
			
			if (errorMsg.includes('ENOENT') || errorMsg.includes('not found') || errorMsg.includes('spawn')) {
				throw new Error(
					`Copilot CLI not found at: ${this.settings.copilotCliPath}\n\n` +
					'Please:\n' +
					'1. Find your copilot path: which copilot\n' +
					'2. Add the full path to plugin settings\n' +
					'3. Ensure you are authenticated (run: copilot auth login)'
				);
			} else if (errorMsg.includes('auth')) {
				throw new Error('Copilot authentication failed. Please run: copilot auth login');
			} else {
				throw new Error(`Copilot client initialization failed: ${errorMsg}`);
			}
		}
	}

	/**
	 * Create a new session with the configured model
	 */
	async createSession(): Promise<any> {
		if (!this.client) {
			await this.initialize();
		}

		// Close previous session if exists
		if (this.activeSession) {
			try {
				await this.activeSession.disconnect();
			} catch (error) {
				console.warn('Error closing previous session:', error);
			}
		}

		this.activeSession = await this.client!.createSession({
			model: this.settings.model,
			onPermissionRequest: approveAll
		});

		return this.activeSession;
	}

	/**
	 * Use Copilot CLI directly for JIRA queries via Atlassian MCP
	 * The CLI has access to MCP servers that the SDK doesn't expose
	 */
	async queryJiraWithCLI(cloudId: string, jql: string): Promise<string> {
		const { spawn } = require('child_process');
		
		return new Promise((resolve, reject) => {
			const cliPath = this.settings.copilotCliPath || 'copilot';
			
			console.log('Spawning CLI for JIRA query:', cliPath);
			console.log('JQL:', jql);
			
			// Construct prompt to use Atlassian MCP tools
			const fullPrompt = `Use the Atlassian MCP searchJiraIssuesUsingJql tool to query JIRA:
- cloudId: "${cloudId}"
- jql: "${jql}"
- fields: ["summary", "status", "assignee"]
- maxResults: 100

For each issue in the results, extract and format as JSON:
- key: the issue key (e.g., "GLCP-12345")
- summary: the issue summary/title
- status: the status name (e.g., "In Progress", "To Do")
- assignee: the assignee display name (or "Unassigned" if null)

Return ONLY a valid JSON array of issues with no explanation, markdown formatting, or code fences. Example:
[{"key":"GLCP-123","summary":"Fix bug","status":"In Progress","assignee":"John Smith"}]`;
			
			// Use non-interactive mode with -p flag
			const process = spawn(cliPath, ['-p', fullPrompt], {
				stdio: ['pipe', 'pipe', 'pipe']
			});
			
			let stdout = '';
			let stderr = '';
			
			process.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});
			
			process.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});
			
			process.on('close', (code: number) => {
				if (code !== 0) {
					console.error('CLI error:', stderr);
					reject(new Error(`CLI exited with code ${code}: ${stderr}`));
				} else {
					console.log('CLI raw response:', stdout);
					resolve(stdout.trim());
				}
			});
			
			process.on('error', (error: Error) => {
				console.error('Failed to spawn CLI:', error);
				reject(error);
			});
		});
	}

	/**
	 * Use Copilot CLI directly for vision analysis
	 * The CLI supports vision when files are referenced in the prompt
	 */
	async analyzeImageWithCLI(imagePath: string, prompt: string): Promise<string> {
		const { spawn } = require('child_process');
		
		return new Promise((resolve, reject) => {
			const cliPath = this.settings.copilotCliPath || 'copilot';
			
			console.log('Spawning CLI for image analysis:', cliPath);
			console.log('Image path:', imagePath);
			
			// Reference the file directly in the prompt - this is how CLI does vision
			const fullPrompt = `process the file [📷 ${imagePath}] to determine the names of people listed. Output ONLY a comma-separated list of full names with no other text.`;
			
			// Use non-interactive mode with -p flag
			const process = spawn(cliPath, ['-p', fullPrompt], {
				stdio: ['pipe', 'pipe', 'pipe']
			});
			
			let stdout = '';
			let stderr = '';
			
			process.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});
			
			process.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});
			
			process.on('close', (code: number) => {
				if (code !== 0) {
					console.error('CLI error:', stderr);
					reject(new Error(`CLI exited with code ${code}: ${stderr}`));
				} else {
					console.log('CLI raw response:', stdout);
					resolve(stdout.trim());
				}
			});
			
			process.on('error', (error: Error) => {
				console.error('Failed to spawn CLI:', error);
				reject(error);
			});
		});
	}

	/**
	 * Send a prompt with an image file for vision analysis
	 */
	async sendVisionPrompt(prompt: string, imagePathOrBase64: string, isFilePath: boolean = false): Promise<string> {
		if (!this.activeSession) {
			await this.createSession();
		}

		if (isFilePath) {
			console.log('Attempting vision with file path:', imagePathOrBase64);
			return this.sendPrompt(prompt, [{ type: 'file' as const, path: imagePathOrBase64 }]);
		}

		// Base64 images are not supported as attachments - fall back to CLI
		return this.sendPrompt(prompt);
	}

	/**
	 * Send a prompt and wait for complete response
	 */
	async sendPrompt(prompt: string, attachments?: Array<{ type: 'file' | 'directory'; path: string }>): Promise<string> {
		// Create new session for each request to avoid stale sessions
		await this.createSession();

		const options: any = { prompt };
		if (attachments?.length) {
			options.attachments = attachments;
		}

		console.log('Sending prompt to session...');
		const response = await this.activeSession!.sendAndWait(options, 60000);
		const content = response?.data?.content ?? '';
		console.log('Response received, length:', content.length);
		return content;
	}

	/**
	 * Stop the client and cleanup
	 */
	async stop(): Promise<void> {
		if (this.activeSession) {
			try {
				await this.activeSession.disconnect();
			} catch (error) {
				console.warn('Error disconnecting session:', error);
			}
			this.activeSession = null;
		}

		if (this.client) {
			try {
				await this.client.stop();
			} catch (error) {
				console.warn('Error stopping client:', error);
			}
			this.client = null;
		}
	}
}
