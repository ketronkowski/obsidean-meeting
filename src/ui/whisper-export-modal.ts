import { App, Modal } from 'obsidian';
import { basename, dirname } from 'path';

export class WhisperExportModal extends Modal {
	private selected: string | null = null;

	constructor(app: App, private meeting: string, private paths: string[], private finish: (path: string | null) => void) {
		super(app);
	}

	onOpen() {
		this.setTitle('Choose a MacWhisper transcript');
		const { contentEl } = this;
		contentEl.createEl('p', { text: `No exact transcript match for ${this.meeting}. Choose an export or skip transcript processing.` });
		const filter = contentEl.createEl('input', {
			type: 'search',
			attr: { placeholder: 'Filter by export name or folder', 'aria-label': 'Filter exports' },
		});
		const list = contentEl.createDiv({ cls: 'whisper-export-results' });
		const render = () => {
			list.empty();
			const query = filter.value.trim().toLowerCase();
			const matches = this.paths.filter(path => path.toLowerCase().includes(query));
			if (!matches.length) list.createEl('p', { text: 'No exports match this filter.' });
			for (const path of matches.slice(0, 30)) {
				const button = list.createEl('button', { type: 'button', text: basename(path), attr: { title: path } });
				button.createEl('small', { text: dirname(path) });
				button.addEventListener('click', () => {
					this.selected = path;
					this.close();
				});
			}
			if (matches.length > 30) list.createEl('p', { text: 'Filter by name or folder to see more exports.' });
		};
		filter.addEventListener('input', render);
		render();
		contentEl.createEl('button', { type: 'button', text: 'Skip transcript' }).addEventListener('click', () => this.close());
		filter.focus();
	}

	onClose() {
		this.contentEl.empty();
		this.finish(this.selected);
	}
}
