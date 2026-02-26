const NUMBER_WORDS: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
};

const TENS_WORDS: Record<string, number> = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
};

const FILLER_WORDS = new Set([
    "and",
    "adults",
    "adult",
    "children",
    "child",
    "kids",
    "kid",
    "guest",
    "guests",
]);

function parseNumberWords(raw: string): number | null {
    const tokens = raw
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/-/g, " ")
        .split(/\s+/)
        .filter(Boolean);

    if (tokens.length === 0) return null;

    let total = 0;
    let current = 0;
    let consumed = false;

    for (const token of tokens) {
        if (FILLER_WORDS.has(token)) {
            continue;
        }
        if (NUMBER_WORDS[token] !== undefined) {
            current += NUMBER_WORDS[token];
            consumed = true;
            continue;
        }
        if (TENS_WORDS[token] !== undefined) {
            current += TENS_WORDS[token];
            consumed = true;
            continue;
        }
        if (token === "hundred") {
            current = Math.max(1, current) * 100;
            consumed = true;
            continue;
        }
        if (token === "thousand") {
            total += Math.max(1, current) * 1000;
            current = 0;
            consumed = true;
            continue;
        }
        return null;
    }

    if (!consumed) return null;
    return total + current;
}

function getNumericUpperBoundForSlot(activeSlot?: string | null): number | null {
    if (activeSlot === "adults") return 4;
    if (activeSlot === "children") return 3;
    return null;
}

function normalizeNumericOutlier(value: number, activeSlot?: string | null): number {
    const bound = getNumericUpperBoundForSlot(activeSlot);
    if (bound === null || value <= bound) {
        return value;
    }

    // Common ASR duplication: "5" misheard as "55".
    if (value >= 10 && value <= 99 && value % 11 === 0) {
        const collapsed = value / 11;
        if (collapsed <= bound) {
            return collapsed;
        }
    }

    return value;
}

export function extractNormalizedNumber(transcript: string, activeSlot?: string | null): number | null {
    const text = String(transcript || "").trim();
    if (!text) return null;

    const directNumberMatch = text.match(/\d+/);
    if (directNumberMatch) {
        const parsed = Number.parseInt(directNumberMatch[0], 10);
        if (Number.isFinite(parsed)) {
            return normalizeNumericOutlier(parsed, activeSlot);
        }
    }

    const wordNumber = parseNumberWords(text);
    if (wordNumber !== null) {
        return normalizeNumericOutlier(wordNumber, activeSlot);
    }

    return null;
}

export function normalizeForSlot(
    transcript: string,
    expectedType?: string | null,
    activeSlot?: string | null
): string {
    if (!transcript) return transcript;
    if (expectedType !== "number") {
        return transcript;
    }

    const normalized = extractNormalizedNumber(transcript, activeSlot);
    return normalized === null ? transcript : String(normalized);
}
