import { CopilotClient } from '@github/copilot-sdk';
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
				await this.activeSession.destroy();
			} catch (error) {
				console.warn('Error closing previous session:', error);
			}
		}

		this.activeSession = await this.client!.createSession({
			model: this.settings.model
		});

		return this.activeSession;
	}

	/**
	 * Send a prompt and wait for complete response
	 */
	async sendPrompt(prompt: string, context?: any): Promise<string> {
		if (!this.activeSession) {
			await this.createSession();
		}

		return new Promise((resolve, reject) => {
			let responseContent = '';
			
			// Collect response chunks
			this.activeSession!.on('assistant.message', (event: any) => {
				if (event.data?.content) {
					responseContent += event.data.content;
				}
			});

			// Wait for session to become idle
			this.activeSession!.on('session.idle', () => {
				resolve(responseContent);
			});

			// Handle errors
			this.activeSession!.on('error', (error: any) => {
				reject(new Error(`Session error: ${error.message || error}`));
			});

			// Send the prompt
			this.activeSession!.send({ prompt, context }).catch(reject);
		});
	}

	/**
	 * Stop the client and cleanup
	 */
	async stop(): Promise<void> {
		if (this.activeSession) {
			try {
				await this.activeSession.destroy();
			} catch (error) {
				console.warn('Error destroying session:', error);
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
