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
        // Keep letters, combining marks, and numbers across all scripts.
        // Indic matras are Unicode marks, so dropping \p{M} corrupts Hindi/Marathi words.
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, '')
        .replace(/\s+/g, ' ');   // Collapse multiple spaces
}
