export interface UpsertSectionOptions {
	level?: number;
	insertAfterHeading?: string;
	insertBeforeHeading?: string;
	appendToEnd?: boolean;
}

function getHeadingPrefix(level: number): string {
	return '#'.repeat(level);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a heading at exactly `level` (e.g. `#` but not `##`), anchored to the
 * start of a line (or the start of the string). Using a plain `indexOf` here
 * would false-positive on e.g. `## Summary` when looking for a level-1
 * `# Summary` heading, since "# Summary" is a substring of "## Summary".
 */
function findHeadingLineIndex(content: string, heading: string, level: number): number {
	const prefix = getHeadingPrefix(level);
	const match = new RegExp(`(?:^|\\n)${prefix}[ \\t]+${escapeRegExp(heading)}\\b`, '').exec(content);
	if (!match) return -1;
	// Account for the leading \n captured by the alternation when not at the very start.
	return match.index + (match[0].startsWith('\n') ? 1 : 0);
}

function findSection(content: string, heading: string, level: number): { headingIdx: number; afterHeading: number; sectionEnd: number } | null {
	const prefix = getHeadingPrefix(level);
	const headingIdx = findHeadingLineIndex(content, heading, level);
	if (headingIdx === -1) return null;

	const afterHeading = content.indexOf('\n', headingIdx);
	if (afterHeading === -1) return null;

	const nextHeadingMatch = new RegExp(`\\n${prefix}[ \\t]+[^#]`, 'g');
	nextHeadingMatch.lastIndex = afterHeading;
	const nextMatch = nextHeadingMatch.exec(content);
	const sectionEnd = nextMatch ? nextMatch.index : content.length;

	return { headingIdx, afterHeading, sectionEnd };
}

export function getSection(content: string, heading: string, level = 1): string {
	const section = findSection(content, heading, level);
	if (!section) return '';
	return content.slice(section.afterHeading + 1, section.sectionEnd).trim();
}

export function isSectionEmpty(content: string, heading: string, level = 1): boolean {
	return getSection(content, heading, level).length === 0;
}

export function replaceSection(content: string, heading: string, newBody: string, level = 1): string {
	const section = findSection(content, heading, level);
	if (!section) return content;

	return (
		content.slice(0, section.afterHeading + 1) +
		'\n' + newBody + '\n\n' +
		content.slice(section.sectionEnd)
	);
}

export function upsertSection(content: string, heading: string, newBody: string, opts: UpsertSectionOptions = {}): string {
	const level = opts.level ?? 1;
	const prefix = getHeadingPrefix(level);
	const section = findSection(content, heading, level);
	const replacement = `${prefix} ${heading}\n\n${newBody}\n\n`;

	if (section) {
		return (
			content.slice(0, section.headingIdx) +
			replacement +
			content.slice(section.sectionEnd)
		);
	}

	if (opts.insertAfterHeading) {
		const afterSection = findSection(content, opts.insertAfterHeading, level);
		if (afterSection) {
			return (
				content.slice(0, afterSection.sectionEnd) +
				'\n' + replacement +
				content.slice(afterSection.sectionEnd)
			);
		}
	}

	if (opts.insertBeforeHeading) {
		const beforeHeadingIdx = findHeadingLineIndex(content, opts.insertBeforeHeading, level);
		if (beforeHeadingIdx !== -1) {
			return (
				content.slice(0, beforeHeadingIdx) +
				replacement +
				content.slice(beforeHeadingIdx)
			);
		}
	}

	if (opts.appendToEnd === false) {
		return content;
	}

	return content.trimEnd() + `\n\n${prefix} ${heading}\n\n${newBody}\n`;
}
