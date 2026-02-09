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
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ');   // Collapse multiple spaces
}
