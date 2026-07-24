import { App, Modal } from 'obsidian';

/**
 * Modal dialog that displays a spinner and status message while the plugin
 * is communicating with Copilot or the voice analysis service.
 * Opens before the first call and auto-closes when processing completes.
 */
export class CopilotWorkingModal extends Modal {
	private statusEl: HTMLElement;
	private timerEl: HTMLElement;
	private dotEl: HTMLElement;
	private startTime: number;
	private timerInterval: NodeJS.Timeout | null = null;
	private dotInterval: NodeJS.Timeout | null = null;
	private initialMessage: string;
	private title: string;

	constructor(
		app: App,
		initialMessage: string = 'Connecting to Copilot…',
		title: string = '🤖 Copilot Working',
	) {
		super(app);
		this.initialMessage = initialMessage;
		this.title = title;
		this.startTime = Date.now();
	}

	onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('copilot-working-modal');

		// Prevent closing with Escape or clicking outside
		modalEl.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') e.stopPropagation();
		});

		// Spinner
		const spinnerBox = contentEl.createDiv({ cls: 'copilot-working-spinner-container' });
		spinnerBox.createDiv({ cls: 'copilot-working-spinner' });

		// Title
		const titleRow = contentEl.createDiv({ cls: 'copilot-working-title-row' });
		titleRow.createEl('h2', { text: this.title });
		this.dotEl = titleRow.createEl('span', { text: '', cls: 'copilot-working-dots' });

		// Animated dots
		let dotCount = 0;
		this.dotInterval = setInterval(() => {
			dotCount = (dotCount + 1) % 4;
			this.dotEl.setText('.'.repeat(dotCount));
		}, 500);

		// Status message
		this.statusEl = contentEl.createEl('p', {
			text: this.initialMessage,
			cls: 'copilot-working-status'
		});

		// Elapsed time
		this.timerEl = contentEl.createEl('p', {
			text: '0s elapsed',
			cls: 'copilot-working-timer'
		});
		this.timerInterval = setInterval(() => {
			const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
			if (elapsed < 60) {
				this.timerEl.setText(`${elapsed}s elapsed`);
			} else {
				const mins = Math.floor(elapsed / 60);
				const secs = elapsed % 60;
				this.timerEl.setText(`${mins}m ${secs}s elapsed`);
			}
		}, 1000);
	}

	/**
	 * Update the status line shown in the modal.
	 */
	updateStatus(message: string) {
		if (this.statusEl) {
			this.statusEl.setText(message);
		}
	}

	onClose() {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
		if (this.dotInterval) {
			clearInterval(this.dotInterval);
			this.dotInterval = null;
		}
		const { contentEl } = this;
		contentEl.empty();
	}
}
