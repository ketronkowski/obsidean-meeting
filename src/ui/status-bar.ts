import { setIcon } from 'obsidian';

export class StatusBarManager {
	private statusBarItem: HTMLElement;
	private hideTimeout: NodeJS.Timeout | null = null;

	constructor(statusBarItem: HTMLElement) {
		this.statusBarItem = statusBarItem;
		this.hide();
	}

	/**
	 * Show a message in the status bar
	 * @param message Message to display
	 * @param duration Duration in ms to show (0 = indefinite)
	 */
	show(message: string, duration: number = 0) {
		// Clear any pending hide
		if (this.hideTimeout) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}

		this.statusBarItem.setText(message);
		this.statusBarItem.style.display = 'inline-block';

		// Auto-hide after duration
		if (duration > 0) {
			this.hideTimeout = setTimeout(() => {
				this.hide();
			}, duration);
		}
	}

	/**
	 * Hide the status bar message
	 */
	hide() {
		this.statusBarItem.setText('');
		this.statusBarItem.style.display = 'none';
	}
}
