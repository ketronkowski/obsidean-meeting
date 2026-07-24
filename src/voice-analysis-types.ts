export interface VoiceSpeakerResult {
	speakerUuid: string;
	displayName: string;      // e.g. "Speaker 1"
	bestMatch: string | null; // e.g. "Kevin Tronkowski", or null if no reference match
	score: number;            // 0–1 cosine similarity
	action: 'auto' | 'confirm' | 'skip';
}

export interface VoiceAnalysisResponse {
	speakers: VoiceSpeakerResult[];
	knownSpeakers: string[];  // all names currently in the reference library
}

export interface VoiceNameAssignment {
	speakerUuid: string;
	name: string;
}
