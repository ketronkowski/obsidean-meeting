/** Minimal mock of the Obsidian module for Jest tests. */

// Polyfill Obsidian's createEl augmentation on HTMLElement
if (typeof HTMLElement !== 'undefined') {
	(HTMLElement.prototype as any).createEl = function (
		tag: string,
		attrs?: Record<string, unknown>,
	): HTMLElement {
		const el = document.createElement(tag);
		if (attrs) {
			const { text, cls, type, placeholder, attr, ...rest } = attrs;
			if (text !== undefined) el.textContent = String(text);
			if (cls !== undefined) el.className = String(cls);
			if (type !== undefined) (el as HTMLInputElement).type = String(type);
			if (placeholder !== undefined) (el as HTMLInputElement).placeholder = String(placeholder);
			if (attr && typeof attr === 'object') {
				for (const [k, v] of Object.entries(attr)) {
					if (v != null) el.setAttribute(k, String(v));
				}
			}
			for (const [k, v] of Object.entries(rest)) {
				if (k === 'value') (el as HTMLOptionElement).value = String(v);
				else el.setAttribute(k, String(v));
			}
		}
		this.appendChild(el);
		return el;
	};

	(HTMLElement.prototype as any).createDiv = function (
		attrs?: Record<string, unknown>,
	): HTMLDivElement {
		return (this as any).createEl('div', attrs);
	};

	(HTMLElement.prototype as any).empty = function () {
		this.innerHTML = '';
	};

	(HTMLElement.prototype as any).addClass = function (cls: string) {
		this.classList.add(cls);
	};
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement;

	constructor(app: unknown) {
		this.app = app;
		this.contentEl = typeof document !== 'undefined'
			? document.createElement('div')
			: { innerHTML: '', appendChild: () => {}, createEl: () => ({}) } as any;
	}

	open() {}
	close() {}
	setTitle(_title: string) {}
}

export class Notice {
	constructor(public message: string) {}
}

export class TFile {}

export class FileSystemAdapter {
	getFullPath(path: string) {
		return `/vault/${path}`;
	}
}

export const App = jest.fn();
export const normalizePath = (path: string) => path.replace(/^\/+|\/+$/g, '');
export const setIcon = jest.fn((element: HTMLElement, icon: string) => element.setAttribute('data-icon', icon));
