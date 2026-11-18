/** @jest-environment jsdom */
import { App } from 'obsidian';
import { WhisperExportModal } from '../ui/whisper-export-modal';

test('filters suggestions and reports the chosen path only after the user picks it', () => {
	const finish = jest.fn();
	const match = '/exports/Meeting - Teams 2026-11-17 17_45_34.whisper';
	const modal = new WhisperExportModal({} as App, 'Project Kick-off', [match, '/exports/Other.whisper'], finish);
	jest.spyOn(modal, 'close').mockImplementation(() => modal.onClose());
	modal.onOpen();
	expect(finish).not.toHaveBeenCalled();
	const input = modal.contentEl.querySelector('input')!;
	input.value = '17_45';
	input.dispatchEvent(new Event('input'));
	const buttons = modal.contentEl.querySelectorAll<HTMLButtonElement>('.whisper-export-results button');
	expect(buttons).toHaveLength(1);
	buttons[0].click();
	expect(finish).toHaveBeenCalledWith(match);
});

test('skipping the dialog returns no export', () => {
	const finish = jest.fn();
	const modal = new WhisperExportModal({} as App, 'Project Kick-off', ['/exports/Meeting.whisper'], finish);
	jest.spyOn(modal, 'close').mockImplementation(() => modal.onClose());
	modal.onOpen();
	modal.contentEl.querySelector<HTMLButtonElement>('button:last-child:not([title])')!.click();
	expect(finish).toHaveBeenCalledWith(null);
});
