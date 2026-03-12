/**
 * Frontend FAQ Similarity Matcher.
 * Searches KioskDB's 'faqs' store using string similarity (Dice's Coefficient)
 * and keyword overlap to find best matches for user queries.
 */

import { normalizeQuestion } from "./faqCache.service";

interface LocalFaq {
    faq_key: string;
    id: string;
    tenant_id: string;
    tenant_slug: string;
    question: string;
    question_normalized: string;
    answer: string;
    is_active: boolean;
}

const DB_NAME = "KioskDB";
const STORE_NAME = "faqs";
const MATCH_THRESHOLD = 0.55; // Fairly liberal threshold for local fallback

/**
 * Calculates similarity between two strings using Bigram-based Dice's Coefficient.
 */
function getSimilarityScore(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1.0;

    const getBigrams = (str: string) => {
        const bigrams = new Set<string>();
        for (let i = 0; i < str.length - 1; i++) {
            bigrams.add(str.substring(i, i + 2));
        }
        return bigrams;
    };

    const b1 = getBigrams(s1);
    const b2 = getBigrams(s2);

    let intersect = 0;
    for (const bigram of b1) {
        if (b2.has(bigram)) intersect++;
    }

    return (2.0 * intersect) / (b1.size + b2.size);
}

/**
 * Calculates keyword overlap score.
 */
function getKeywordScore(query: string, candidate: string): number {
    const qTokens = new Set(query.split(/\s+/));
    const cTokens = new Set(candidate.split(/\s+/));

    if (qTokens.size === 0) return 0;

    let overlap = 0;
    for (const token of qTokens) {
        if (cTokens.has(token)) overlap++;
    }

    return overlap / qTokens.size;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Finds the best FAQ match in IndexedDB for the given tenant and query.
 */
export async function findBestLocalFaqMatch(
    tenantSlug: string,
    query: string
): Promise<{ faqId: string; answer: string; confidence: number } | null> {
    const normalizedQuery = normalizeQuestion(query);
    if (!normalizedQuery) return null;

    try {
        const db = await openDb();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const index = store.index("tenant_slug");

        return new Promise((resolve) => {
            const request = index.getAll(tenantSlug);

            request.onsuccess = () => {
                const faqs = request.result as LocalFaq[];
                let bestMatch: { faqId: string; answer: string; confidence: number } | null = null;
                let maxScore = 0;

                for (const faq of faqs) {
                    if (!faq.is_active) continue;

                    const faqNorm = faq.question_normalized || normalizeQuestion(faq.question);

                    // Hybrid scoring: Dice similarity + Keyword overlap
                    const simScore = getSimilarityScore(normalizedQuery, faqNorm);
                    const keyScore = getKeywordScore(normalizedQuery, faqNorm);

                    const combinedScore = (simScore * 0.6) + (keyScore * 0.4);

                    if (combinedScore > maxScore) {
                        maxScore = combinedScore;
                        bestMatch = {
                            faqId: faq.id,
                            answer: faq.answer,
                            confidence: combinedScore
                        };
                    }
                }

                if (bestMatch && maxScore >= MATCH_THRESHOLD) {
                    console.log(`[FAQMatcher] Local Hit: score=${maxScore.toFixed(3)} q="${normalizedQuery}"`);
                    resolve(bestMatch);
                } else {
                    console.log(`[FAQMatcher] Local Miss: top_score=${maxScore.toFixed(3)}`);
                    resolve(null);
                }
            };

            request.onerror = () => {
                console.error("[FAQMatcher] DB read error", request.error);
                resolve(null);
            };

            tx.oncomplete = () => db.close();
        });
    } catch (err) {
        console.error("[FAQMatcher] Failed to search local FAQs", err);
        return null;
    }
}
