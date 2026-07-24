import { App } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';
import { CopilotWorkingModal } from './ui/copilot-working-modal';

/**
 * Drives the Copilot CLI (spawned via `-p`) for prompt and vision requests.
 */
export class CopilotClientManager {
	private app: App;
	private settings: MeetingProcessorSettings;
	private workingModal: CopilotWorkingModal | null = null;
	private pendingCalls: number = 0;

	constructor(app: App, settings: MeetingProcessorSettings) {
		this.app = app;
		this.settings = settings;
	}

	/**
	 * Show or update the working modal. Opens the modal on the first
	 * concurrent call and keeps it open until every call has finished.
	 */
	private showWorking(message: string) {
		this.pendingCalls++;
		if (!this.workingModal) {
			this.workingModal = new CopilotWorkingModal(this.app, message);
			this.workingModal.open();
		} else {
			this.workingModal.updateStatus(message);
		}
	}

	/**
	 * Decrement the pending-call counter and close the modal once all
	 * outstanding Copilot calls have completed (or failed).
	 */
	private hideWorking() {
		this.pendingCalls--;
		if (this.pendingCalls <= 0) {
			if (this.workingModal) {
				this.workingModal.close();
				this.workingModal = null;
			}
			this.pendingCalls = 0;
		}
	}

	/**
	 * Update the status message in the working modal without affecting
	 * the pending-call counter.
	 */
	updateWorkingStatus(message: string) {
		if (this.workingModal) {
			this.workingModal.updateStatus(message);
		}
	}

	/**
	 * Build the CLI args array, prepending `--model <model>` when a model is
	 * configured (settings.model defaults to 'auto', which the CLI itself
	 * supports as "let Copilot pick automatically").
	 */
	private buildArgs(prompt: string): string[] {
		const args: string[] = [];
		if (this.settings.model) {
			args.push('--model', this.settings.model);
		}
		args.push('-p', prompt);
		return args;
	}

	/**
	 * Use Copilot CLI directly for vision analysis
	 * The CLI supports vision when files are referenced in the prompt
	 */
	async analyzeImageWithCLI(imagePath: string, prompt: string, description?: string): Promise<string> {
		this.showWorking(description || 'Analyzing image…');
		const { spawn } = require('child_process');
		
		return new Promise((resolve, reject) => {
			const cliPath = this.settings.copilotCliPath || 'copilot';
			
			console.log('Spawning CLI for image analysis:', cliPath);
			console.log('Image path:', imagePath);
			
			// Reference the file directly in the prompt - this is how CLI does vision
			const fullPrompt = `process the file [📷 ${imagePath}] to determine the names of people listed. Output ONLY a comma-separated list of full names with no other text.`;
			
			// Use non-interactive mode with -p flag
			const process = spawn(cliPath, this.buildArgs(fullPrompt), {
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
				this.hideWorking();
				if (code !== 0) {
					console.error('CLI error:', stderr);
					reject(new Error(`CLI exited with code ${code}: ${stderr}`));
				} else {
					console.log('CLI raw response:', stdout);
					resolve(stdout.trim());
				}
			});
			
			process.on('error', (error: Error) => {
				this.hideWorking();
				console.error('Failed to spawn CLI:', error);
				reject(error);
			});
		});
	}

	/**
	 * Send a prompt and wait for complete response.
	 * Uses the CLI directly via -p flag to avoid SDK stdio/JSON-RPC startup issues.
	 */
	async sendPrompt(prompt: string, attachments?: Array<{ type: 'file' | 'directory'; path: string }>, description?: string): Promise<string> {
		this.showWorking(description || 'Generating response…');
		const { spawn } = require('child_process');

		return new Promise((resolve, reject) => {
			const cliPath = this.settings.copilotCliPath || 'copilot';

			console.log('Sending prompt via CLI:', cliPath);

			// Build final prompt - append any file references for the CLI to load
			let fullPrompt = prompt;
			if (attachments?.length) {
				const refs = attachments.map(a => `[📄 ${a.path}]`).join('\n');
				fullPrompt = `${prompt}\n\n${refs}`;
			}

			const proc = spawn(cliPath, this.buildArgs(fullPrompt), {
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';

			proc.stdout.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			proc.stderr.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			proc.on('close', (code: number) => {
				this.hideWorking();
				if (code !== 0) {
					console.error('CLI error:', stderr);
					reject(new Error(`CLI exited with code ${code}: ${stderr}`));
				} else {
					console.log('Prompt response received, length:', stdout.trim().length);
					resolve(stdout.trim());
				}
			});

			proc.on('error', (error: Error) => {
				this.hideWorking();
				console.error('Failed to spawn CLI:', error);
				reject(error);
			});
		});
	}

	/**
	 * Cleanup. No persistent client/session to tear down since every
	 * call spawns and exits its own CLI process, but this closes any
	 * lingering working-modal state.
	 */
	async stop(): Promise<void> {
		if (this.workingModal) {
			this.workingModal.close();
			this.workingModal = null;
		}
		this.pendingCalls = 0;
	}
}
