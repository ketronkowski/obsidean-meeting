import { readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';

export function whisperExportDirectories(configured: string, home = homedir()): string[] {
	const dir = configured.trim().replace(/^~(?=\/|$)/, home);
	return [...new Set([...(dir ? [resolve(dir)] : []), join(home, 'Documents', 'Mac Whisper', 'Auto Exported')])];
}

function minutes(value: string): number | undefined {
	const match = value.match(/^(\d{1,2})[:_](\d{2})(?:\s*([AP]M))?$/i);
	if (!match) return;
	const [, h, m, period] = match;
	const hour = Number(h);
	if (Number(m) > 59 || (period ? hour < 1 || hour > 12 : hour > 23)) return;
	return (period ? hour % 12 + (period.toUpperCase() === 'PM' ? 12 : 0) : hour) * 60 + Number(m);
}

export async function suggestWhisperExports(directories: string[], meetingName: string, start?: string, end?: string) {
	const meetingDate = /^\d{4}-\d{2}-\d{2}/.exec(meetingName)?.[0];
	const meetingStart = start ? minutes(start) : undefined;
	const meetingEnd = end ? minutes(end) : undefined;
	const titleWords = (value: string) => value.toLowerCase().match(/\p{L}{3,}/gu) ?? [];
	const title = new Set(titleWords(meetingName.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, '')));
	const files = await Promise.all(directories.map(async directory => {
		try {
			const entries = await readdir(directory, { withFileTypes: true });
			return entries.filter(entry => entry.isFile() && /\.whisper$/i.test(entry.name) && !/[\]\r\n]/.test(entry.name))
				.map(entry => join(directory, entry.name));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not list MacWhisper exports:', error);
			return [];
		}
	}));
	const ranked = await Promise.all(files.flat().map(async path => {
		const name = basename(path, '.whisper');
		const stamp = /(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}[:_]\d{2}))?/.exec(name);
		let date = stamp?.[1];
		let mtime = 0;
		if (!date) {
			try {
				const info = await stat(path);
				mtime = info.mtimeMs;
				date = `${info.mtime.getFullYear()}-${String(info.mtime.getMonth() + 1).padStart(2, '0')}-${String(info.mtime.getDate()).padStart(2, '0')}`;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not inspect MacWhisper export:', error);
			}
		}
		const time = stamp?.[2] ? minutes(stamp[2]) : undefined;
		const sameDay = meetingDate !== undefined && date === meetingDate;
		const inWindow = sameDay && time !== undefined && meetingStart !== undefined && meetingEnd !== undefined
			&& time >= meetingStart && time <= meetingEnd;
		const overlap = [...new Set(titleWords(name))].filter(word => title.has(word)).length;
		return { path, date: date ?? '', time: time ?? -1, mtime, sameDay, inWindow, overlap,
			distance: sameDay && time !== undefined && meetingStart !== undefined ? Math.abs(time - meetingStart) : Infinity };
	}));
	return ranked.sort((a, b) => Number(b.inWindow) - Number(a.inWindow) || Number(b.sameDay) - Number(a.sameDay)
		|| b.overlap - a.overlap || a.distance - b.distance || b.date.localeCompare(a.date)
		|| b.time - a.time || b.mtime - a.mtime || a.path.localeCompare(b.path)).map(entry => entry.path);
}
