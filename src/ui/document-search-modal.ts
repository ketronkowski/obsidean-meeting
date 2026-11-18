import { App, Modal, normalizePath, Notice, setIcon, TFile } from 'obsidian';
import { DocumentSearch, DocumentSearchMatch } from '../document-search';
import type { MeetingProcessorSettings } from './settings-tab';

export class DocumentSearchModal extends Modal {
	private controller?: AbortController;
	private activityTimer?: ReturnType<typeof setInterval>;

	constructor(
		app: App,
		private searcher: DocumentSearch,
		private settings: Pick<MeetingProcessorSettings, 'documentSearchResultLimit' | 'meetingsFolder'>,
		private onDismiss?: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('document-search-modal');
		this.contentEl.createEl('h2', { text: 'Search vault documents' });
		const form = this.contentEl.createEl('form');
		const label = form.createEl('label', { text: 'Describe the documents you want to find' });
		const query = label.createEl('input', { type: 'text' });
		query.placeholder = 'What did we decide about X?';
		query.required = true;
		const option = form.createEl('label', { cls: 'document-search-option' });
		const screenshots = option.createEl('input', { type: 'checkbox' });
		screenshots.checked = false;
		option.createEl('span', { text: 'Search screenshots if no notes match' });
		const deepOption = form.createEl('label', { cls: 'document-search-option' });
		const deep = deepOption.createEl('input', { type: 'checkbox' });
		deepOption.createEl('span', { text: 'Search more deeply (scan all notes)' });
		const activity = form.createDiv({ cls: 'document-search-activity' });
		const spinner = activity.createEl('span', {
			cls: 'document-search-spinner',
			attr: { 'aria-hidden': 'true' },
		});
		spinner.hidden = true;
		const elapsed = activity.createEl('small');
		const status = form.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
		const results = form.createEl('ol', {
			cls: 'document-search-results',
			attr: { 'aria-label': 'Ranked document matches' },
		});
		const actions = form.createDiv({ cls: 'document-search-actions' });
		const submit = actions.createEl('button', { text: 'Search', type: 'submit', cls: 'mod-cta' });
		const close = actions.createEl('button', { text: 'Close', type: 'button' });
		close.addEventListener('click', () => this.close());
		form.addEventListener('submit', async event => {
			event.preventDefault();
			if (submit.disabled || !query.value.trim()) return;
			const controller = new AbortController();
			this.controller = controller;
			submit.disabled = true;
			results.empty();
			results.scrollTop = 0;
			const limit = this.settings.documentSearchResultLimit;
			const updateResults = (matches: DocumentSearchMatch[]) => {
				if (controller.signal.aborted) return;
				const scrollTop = results.scrollTop;
				results.empty();
				for (const match of matches.slice(0, limit)) this.renderMatch(results, match);
				results.scrollTop = scrollTop;
			};
			status.textContent = 'Starting GitHub Copilot CLI...';
			spinner.hidden = false;
			const started = Date.now();
			const updateElapsed = () => {
				const seconds = Math.floor((Date.now() - started) / 1000);
				elapsed.textContent = `Elapsed: ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
			};
			updateElapsed();
			this.activityTimer = setInterval(updateElapsed, 1000);
			try {
				const response = await this.searcher.search(
					query.value.trim(),
					screenshots.checked,
					controller.signal,
					message => {
						if (!controller.signal.aborted) status.textContent = message;
					},
					updateResults,
					deep.checked,
				);
				if (controller.signal.aborted) return;
				if (response.ignored) {
					status.textContent = 'Ignored: enter a request to find vault documents, not a general request.';
					new Notice(status.textContent);
				} else {
					const count = response.matches.length;
					status.textContent = count
						? (count > limit ? `Showing the top ${limit} of ${count} matches.` : `${count} ${count === 1 ? 'match' : 'matches'}, ranked by relevance.`)
							+ (response.scope === 'indexed' && count < limit ? ' Try deep search for more results.' : '')
						: response.scope === 'indexed'
							? 'No indexed matches. Try deep search to scan all notes.'
							: 'No matching documents found.';
					updateResults(response.matches);
				}
			} catch (error) {
				if (controller.signal.aborted) return;
				console.error('Document search failed:', error);
				status.textContent = `Search failed: ${error instanceof Error ? error.message : String(error)}`;
				if (results.childElementCount) status.textContent += ' Matches found so far remain available below.';
				new Notice(status.textContent);
			} finally {
				if (this.controller === controller) {
					this.stopActivity();
					spinner.hidden = true;
					if (!controller.signal.aborted) {
						updateElapsed();
						submit.disabled = false;
					}
				}
			}
		});
		query.focus();
	}

	private renderMatch(results: HTMLElement, match: DocumentSearchMatch) {
		const row = results.createEl('li');
		const headings = this.app.metadataCache.getFileCache(match.file)?.headings;
		const isEmail = headings?.some(({ heading }) => heading.trim().toLowerCase() === 'email chain');
		const folder = normalizePath(this.settings.meetingsFolder);
		const isMeeting = folder && match.file.path.startsWith(`${folder}/`);
		const [icon, type] = isEmail ? ['mail', 'Email'] : isMeeting ? ['calendar', 'Meeting'] : ['file-text', 'Note'];
		const source = match.source === 'screenshot' ? ' (screenshot match)' : '';
		const open = row.createEl('button', {
			type: 'button',
			cls: 'document-search-result-title',
			attr: {
				title: `${type}: ${match.file.path}${source}`,
				'aria-label': `${type}: ${match.file.basename}${source}`,
			},
		});
		const typeIcon = open.createEl('span', { cls: 'document-search-result-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(typeIcon, icon);
		open.createEl('span', { cls: 'document-search-result-name', text: match.file.basename });
		row.createEl('p', { text: source ? `Screenshot match: ${match.reason}` : match.reason });
		open.addEventListener('click', async () => {
			try {
				const file = this.app.vault.getAbstractFileByPath(match.file.path);
				if (!(file instanceof TFile) || file.extension !== 'md') {
					throw new Error('This note is no longer available. Search again.');
				}
				await this.app.workspace.getLeaf(false).openFile(file);
				this.close();
			} catch (error) {
				console.error('Could not open document search result:', error);
				new Notice(`Could not open note: ${error instanceof Error ? error.message : String(error)}`);
			}
		});
	}

	onClose() {
		this.controller?.abort();
		this.stopActivity();
		this.contentEl.empty();
		this.onDismiss?.();
	}

	private stopActivity() {
		if (this.activityTimer !== undefined) {
			clearInterval(this.activityTimer);
			this.activityTimer = undefined;
		}
	}
}
