/**
 * A single speaker's profile extracted from the transcript
 */
export interface SpeakerProfile {
	speakerId: string;      // e.g. "Speaker 1"
	sampleQuotes: string[]; // 3–5 representative lines
	lineCount: number;      // total number of utterances
	allLines: string[];     // all utterance lines (for heuristics)
}

/**
 * A resolved mapping from a generic speaker label to an attendee
 */
export interface SpeakerMapping {
	speakerId: string;      // e.g. "Speaker 1"
	attendeeName: string;   // display name e.g. "Paul Lloyd"
	wikiLink: string;       // [[Lloyd, Paul|Paul Lloyd]]
	confidence: number;     // 0–1
	autoDetected: boolean;
}

/**
 * Best-guess match for an unresolved speaker (may be below auto-map threshold)
 */
export interface SpeakerBestGuess {
	attendeeName: string;
	confidence: number;     // 0–1
}

/**
 * Parse the raw transcript text and extract a profile for each [Speaker N] label.
 * Works on the raw file content (reads the # Transcript section).
 */
export function extractSpeakerProfiles(transcriptText: string): SpeakerProfile[] {
	console.log('[extractSpeakerProfiles] Parsing transcript, length:', transcriptText.length);

	// Match blocks: [Speaker N] followed by content until the next speaker block (any [Name])
	// or end of string. Speaker blocks are separated by \n\n in the cleaned transcript format,
	// so we stop at \n\n[ to avoid capturing dialogue from other (named) speakers between turns.
	const blockPattern = /\[Speaker (\d+)\]\r?\n([\s\S]*?)(?=\n\n\[|$)/g;
	const profileMap = new Map<string, { lines: string[] }>();

	let match: RegExpExecArray | null;
	while ((match = blockPattern.exec(transcriptText)) !== null) {
		const speakerId = `Speaker ${match[1]}`;
		const blockText = match[2].trim();

		if (!blockText) continue;

		// Split into individual sentences / lines, skip pure filler
		const lines = blockText
			.split(/\r?\n/)
			.map(l => l.trim())
			.filter(l => l.length > 0);

		if (!profileMap.has(speakerId)) {
			profileMap.set(speakerId, { lines: [] });
		}
		profileMap.get(speakerId)!.lines.push(...lines);
	}

	console.log('[extractSpeakerProfiles] Found speaker IDs:', Array.from(profileMap.keys()));

	const profiles: SpeakerProfile[] = [];
	for (const [speakerId, data] of profileMap.entries()) {
		const substantiveLines = data.lines.filter(l => l.length > 30 && !/^(um|uh|yeah|okay|right|no|yes|sure|oh)\b/i.test(l));
		const sampleQuotes = substantiveLines.slice(0, 4);

		console.log(`[extractSpeakerProfiles] ${speakerId}: ${data.lines.length} lines, ${substantiveLines.length} substantive, ${sampleQuotes.length} sample quotes`);

		profiles.push({
			speakerId,
			sampleQuotes,
			lineCount: data.lines.length,
			allLines: data.lines
		});
	}

	// Sort numerically by speaker number
	profiles.sort((a, b) => {
		const numA = parseInt(a.speakerId.replace('Speaker ', ''));
		const numB = parseInt(b.speakerId.replace('Speaker ', ''));
		return numA - numB;
	});

	return profiles;
}

/**
 * Extract display names and wiki-links from the Attendees section of note content.
 * Returns array of { displayName, wikiLink } objects.
 */
export function extractAttendeeLinks(content: string): Array<{ displayName: string; wikiLink: string }> {
	// Use (?:^|\n) instead of ^m so $ means end-of-string (not end-of-line),
	// ensuring the full section (including sub-headings like ## In Meeting) is captured.
	const attendeesMatch = content.match(/(?:^|\n)# Attendees\n([\s\S]*?)(?=\n# (?!#)|$)/);
	if (!attendeesMatch) {
		console.log('[extractAttendeeLinks] No Attendees section found');
		return [];
	}

	const attendeesText = attendeesMatch[1];
	const result: Array<{ displayName: string; wikiLink: string }> = [];

	// Match wikilinks with a pipe alias, with or without leading "- " (but NOT image embeds ![[...]]):
	//   [[Last, First|First Last]]  or  - [[Last, First|First Last]]
	const wikiLinkWithPipePattern = /^-? ?(?<!!)(?<!!)\[\[([^\]|]+)\|([^\]]+)\]\]/gm;
	let match: RegExpExecArray | null;
	while ((match = wikiLinkWithPipePattern.exec(attendeesText)) !== null) {
		result.push({
			displayName: match[2].trim(),
			wikiLink: `[[${match[1].trim()}|${match[2].trim()}]]`
		});
	}

	// Match wikilinks WITHOUT a pipe, with or without leading "- " (but NOT image embeds):
	//   [[First Last]]  or  - [[First Last]]  (excludes ![[image.png]])
	const wikiLinkNoPipePattern = /^-? ?(?<!!)\[\[([^\]|]+)\]\]/gm;
	while ((match = wikiLinkNoPipePattern.exec(attendeesText)) !== null) {
		const name = match[1].trim();
		// Skip image file references
		if (/\.(png|jpg|jpeg|gif|svg|webp|txt|md)$/i.test(name)) continue;
		// Only add if not already covered by a piped wiki-link
		if (!result.some(a => a.wikiLink.startsWith(`[[${name}`))) {
			result.push({ displayName: name, wikiLink: `[[${name}]]` });
		}
	}

	// Also match plain names (no wiki-link at all), with or without leading "- ":
	const plainNamePattern = /^-? ?([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)$/gm;
	while ((match = plainNamePattern.exec(attendeesText)) !== null) {
		const name = match[1].trim();
		// Only add if not already covered by any wiki-link entry
		if (!result.some(a => a.displayName === name)) {
			result.push({ displayName: name, wikiLink: name });
		}
	}

	console.log('[extractAttendeeLinks] Extracted attendees:', result.map(a => a.displayName));
	return result;
}

/**
 * Auto-detect speaker-to-attendee mappings using heuristics.
 * Returns mappings with confidence scores; callers should use ≥ 0.8 as auto-map threshold.
 */
export function autoDetectMappings(
	profiles: SpeakerProfile[],
	attendees: Array<{ displayName: string; wikiLink: string }>
): SpeakerMapping[] {
	console.log('[autoDetectMappings] Running heuristics for', profiles.length, 'speakers against', attendees.length, 'attendees');
	const mappings: SpeakerMapping[] = [];
	const usedAttendees = new Set<string>();

	for (const profile of profiles) {
		let bestMatch: { attendee: { displayName: string; wikiLink: string }; confidence: number } | null = null;

		for (const attendee of attendees) {
			const confidence = scoreSpeakerAttendee(profile, attendee);
			// Only log candidates with an actual signal — with the full vault's People
			// list as candidates (not just meeting attendees), this loop can run
			// hundreds of iterations per speaker; logging every zero-confidence miss
			// floods the console and buries the useful output.
			if (confidence > 0) {
				console.log(`[autoDetectMappings]   ${profile.speakerId} vs "${attendee.displayName}": confidence=${confidence.toFixed(2)}`);
			}
			if (!bestMatch || confidence > bestMatch.confidence) {
				bestMatch = { attendee, confidence };
			}
		}

		if (bestMatch) {
			console.log(`[autoDetectMappings] ${profile.speakerId} best match: "${bestMatch.attendee.displayName}" (${bestMatch.confidence.toFixed(2)})`);
		}

		if (bestMatch && bestMatch.confidence >= 0.8) {
			console.log(`[autoDetectMappings] AUTO-MAPPED: ${profile.speakerId} → ${bestMatch.attendee.displayName}`);
			mappings.push({
				speakerId: profile.speakerId,
				attendeeName: bestMatch.attendee.displayName,
				wikiLink: bestMatch.attendee.wikiLink,
				confidence: bestMatch.confidence,
				autoDetected: true
			});
			usedAttendees.add(bestMatch.attendee.displayName);
		}
	}

	// Single-speaker heuristic: if only one Speaker N and only one unmatched attendee
	const unmappedProfiles = profiles.filter(p => !mappings.some(m => m.speakerId === p.speakerId));
	const unmappedAttendees = attendees.filter(a => !usedAttendees.has(a.displayName));
	if (unmappedProfiles.length === 1 && unmappedAttendees.length === 1) {
		console.log(`[autoDetectMappings] Single-remaining heuristic: ${unmappedProfiles[0].speakerId} → ${unmappedAttendees[0].displayName} (0.6)`);
		mappings.push({
			speakerId: unmappedProfiles[0].speakerId,
			attendeeName: unmappedAttendees[0].displayName,
			wikiLink: unmappedAttendees[0].wikiLink,
			confidence: 0.6,
			autoDetected: true
		});
	}

	console.log('[autoDetectMappings] Result:', mappings.map(m => `${m.speakerId}→${m.attendeeName}(${m.confidence.toFixed(2)})`));
	return mappings;
}

/**
 * For each speaker profile, compute the best-matching attendee and confidence score
 * regardless of threshold. Used to show hints in the manual assignment dialog.
 */
export function computeBestGuesses(
	profiles: SpeakerProfile[],
	attendees: Array<{ displayName: string; wikiLink: string }>
): Map<string, SpeakerBestGuess> {
	const result = new Map<string, SpeakerBestGuess>();
	for (const profile of profiles) {
		let best: { attendeeName: string; confidence: number } | null = null;
		for (const attendee of attendees) {
			const confidence = scoreSpeakerAttendee(profile, attendee);
			if (!best || confidence > best.confidence) {
				best = { attendeeName: attendee.displayName, confidence };
			}
		}
		if (best && best.confidence > 0) {
			result.set(profile.speakerId, best);
		}
	}
	return result;
}

/**
 * Score how well a speaker profile matches an attendee.
 */
function scoreSpeakerAttendee(
	profile: SpeakerProfile,
	attendee: { displayName: string }
): number {
	const allText = profile.allLines.join(' ').toLowerCase();
	const fullName = attendee.displayName.toLowerCase();
	const parts = fullName.split(/\s+/);
	const firstName = parts[0];
	const lastName = parts[parts.length - 1];

	let score = 0;

	// Self-introduction patterns (broad set to catch real-world transcript styles)
	const introPatterns = [
		// "I'm Kevin" / "I am Kevin"
		new RegExp(`\\bI(?:'m| am)\\s+${escapeRegex(firstName)}\\b`, 'i'),
		// "my name is Kevin" / "my name's Kevin"
		new RegExp(`\\bmy name(?:'s| is)\\s+${escapeRegex(firstName)}\\b`, 'i'),
		// Full name appears anywhere (self-identification in 3rd person or name-drop)
		new RegExp(`\\b${escapeRegex(fullName)}\\b`, 'i'),
		// "Kevin Tronkowski. I am" (name then self-description)
		new RegExp(`\\b${escapeRegex(firstName)}\\s+${escapeRegex(lastName)}\\b`, 'i'),
		// "this is Kevin" / "it's Kevin"
		new RegExp(`\\b(?:this is|it'?s)\\s+${escapeRegex(firstName)}\\b`, 'i'),
	];
	for (const pattern of introPatterns) {
		if (pattern.test(allText)) {
			score += 0.9;
			break;
		}
	}

	// First/last name partial matches (weaker signals)
	if (score === 0) {
		const firstNamePattern = new RegExp(`\\b${escapeRegex(firstName)}\\b`, 'i');
		if (firstNamePattern.test(allText)) {
			score += 0.4;
		}
		// Last name match
		if (lastName !== firstName) {
			const lastNamePattern = new RegExp(`\\b${escapeRegex(lastName)}\\b`, 'i');
			if (lastNamePattern.test(allText)) {
				score += 0.3;
			}
		}
	}

	return Math.min(score, 1.0);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite the transcript section of content, replacing [Speaker N] labels
 * with the mapped attendee wiki-links (or display names if no wiki-link).
 * Unmapped speakers are left as-is.
 */
export function rewriteTranscript(content: string, mappings: SpeakerMapping[]): string {
	if (mappings.length === 0) return content;

	console.log('[rewriteTranscript] Applying', mappings.length, 'mappings');
	let result = content;
	for (const mapping of mappings) {
		// Replace [Speaker N] with the display name (keep as plain text in transcript,
		// not a wiki-link, since Obsidian doesn't render links inside code-block-style transcript)
		const escapedId = escapeRegex(mapping.speakerId);
		const pattern = new RegExp(`\\[${escapedId}\\]`, 'g');
		const before = result;
		result = result.replace(pattern, `[${mapping.attendeeName}]`);
		const changed = result !== before;
		console.log(`[rewriteTranscript] ${mapping.speakerId} → [${mapping.attendeeName}]: ${changed ? 'replaced' : 'no matches found'}`);
	}
	return result;
}

/**
 * Extract just the transcript text from full note content (the # Transcript section).
 */
export function extractTranscriptText(content: string): string {
	const match = content.match(/(?:^|\n)# Transcript\s*\n([\s\S]*?)(?=\n# [^#]|$)/);
	const result = match ? match[1].trim() : '';
	console.log('[extractTranscriptText] Extracted length:', result.length, result ? '— preview: ' + result.substring(0, 60) : '(empty)');
	return result;
}

/**
 * Count the number of distinct top-level "[Speaker Name]" labels in a cleaned
 * transcript. Used to detect the "everyone got merged into one speaker" failure
 * mode (e.g. when a transcription engine didn't diarize multiple speakers).
 */
export function countDistinctSpeakerLabels(transcript: string): number {
	const speakerLabels = new Set<string>();
	const labelPattern = /^\[([^\]]+)\]\s*$/gm;
	let match: RegExpExecArray | null;
	while ((match = labelPattern.exec(transcript)) !== null) {
		speakerLabels.add(match[1].trim().toLowerCase());
	}
	return speakerLabels.size;
}
