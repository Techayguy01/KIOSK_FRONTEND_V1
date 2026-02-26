/**
 * Transcript Normalization (Hygiene Layer)
 * 
 * This is NOT intelligence. This is text cleaning only.
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces
 * - Remove punctuation
 */
export function normalizeTranscript(text: string): string {
    return text
        .toLowerCase()
        .trim()
        // Keep letters/numbers across all scripts (Hindi, etc.), drop punctuation/symbols.
        .replace(/[^\p{L}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ');   // Collapse multiple spaces
}
