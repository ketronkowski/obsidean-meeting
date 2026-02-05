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
			
			// Try to connect to existing CLI server first (recommended for Obsidian)
			try {
				this.client = new CopilotClient({
					cliUrl: 'localhost:8080',
					logLevel: 'warning'
				});
				
				await this.client.start();
				console.log('Connected to existing Copilot CLI server on port 8080');
				return;
			} catch (connectError) {
				console.log('No existing CLI server found, trying to spawn...');
			}
			
			// Fall back to spawning CLI (may not work well in Obsidian)
			this.client = new CopilotClient({
				autoStart: true,
				useStdio: false, // Use TCP instead of stdio
				port: 8080,
				logLevel: 'warning'
			});
			
			await this.client.start();
			console.log('Copilot CLI server started on port 8080');
		} catch (error) {
			console.error('Failed to initialize Copilot client:', error);
			
			// Provide helpful error message
			const errorMsg = error.message || String(error);
			
			if (errorMsg.includes('stream was destroyed') || errorMsg.includes('ECONNREFUSED')) {
				throw new Error(
					'Could not connect to Copilot CLI. Please start the CLI server manually:\n\n' +
					'  copilot server --port 8080\n\n' +
					'Then reload the plugin and try again.'
				);
			} else if (errorMsg.includes('ENOENT') || errorMsg.includes('not found')) {
				throw new Error('Copilot CLI not found. Please ensure GitHub Copilot CLI is installed and in your PATH.');
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
