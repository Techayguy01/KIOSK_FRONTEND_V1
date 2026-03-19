import { buildTenantApiUrl, getTenantHeaders } from "./tenantContext";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
  category?: string;
}

type TenantFaqApiResponse = {
  faqs?: Array<{
    id: string;
    question: string;
    answer: string;
    category?: string;
  }>;
};

function normalizeFaqRows(payload: TenantFaqApiResponse): FaqItem[] {
  const rows = Array.isArray(payload?.faqs) ? payload.faqs : [];
  return rows
    .map((row) => ({
      id: String(row?.id || "").trim(),
      question: String(row?.question || "").trim(),
      answer: String(row?.answer || "").trim(),
      category: row?.category ? String(row.category).trim() : undefined,
    }))
    .filter((row) => row.id && row.question && row.answer);
}

export async function getTenantFaqs(tenantId: string, tenantSlug?: string): Promise<FaqItem[]> {
  const resolvedTenantId = String(tenantId || "").trim();
  const resolvedTenantSlug = String(tenantSlug || "").trim();
  if (!resolvedTenantId && !resolvedTenantSlug) return [];

  const baseUrl = buildTenantApiUrl("faqs");
  const withTenantId = resolvedTenantId
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}tenant_id=${encodeURIComponent(resolvedTenantId)}`
    : baseUrl;
  const withTenantSlugOnly = resolvedTenantSlug
    ? `${baseUrl.split("?")[0]}?slug=${encodeURIComponent(resolvedTenantSlug)}`
    : baseUrl;

  const primaryResponse = await fetch(withTenantId, {
    method: "GET",
    headers: getTenantHeaders(),
  });

  if (primaryResponse.ok) {
    const payload = (await primaryResponse.json()) as TenantFaqApiResponse;
    return normalizeFaqRows(payload);
  }

  if (!resolvedTenantSlug || withTenantSlugOnly === withTenantId) {
    throw new Error(`Failed to fetch FAQs (${primaryResponse.status})`);
  }

  const fallbackResponse = await fetch(withTenantSlugOnly, {
    method: "GET",
    headers: getTenantHeaders(),
  });
  if (!fallbackResponse.ok) {
    throw new Error(`Failed to fetch FAQs (${primaryResponse.status}/${fallbackResponse.status})`);
  }
  const fallbackPayload = (await fallbackResponse.json()) as TenantFaqApiResponse;
  return normalizeFaqRows(fallbackPayload);
}
