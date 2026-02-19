import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const API_BASE = process.env.API_BASE_URL || "http://localhost:3002";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function fetchJson(path: string, tenantSlug: string, method: "GET" | "POST" = "GET", body?: unknown) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-tenant-slug": tenantSlug,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { response, json };
}

async function main() {
  const grand = await prisma.tenant.findUnique({ where: { slug: "grand-hotel" } });
  const budget = await prisma.tenant.findUnique({ where: { slug: "budget-inn" } });
  assert(grand && budget, "Seed tenants not found");

  const grandTenant = await fetchJson(`/api/${grand.slug}/tenant`, grand.slug);
  const budgetTenant = await fetchJson(`/api/${budget.slug}/tenant`, budget.slug);
  assert(grandTenant.response.ok, "grand-hotel tenant endpoint failed");
  assert(budgetTenant.response.ok, "budget-inn tenant endpoint failed");
  assert(grandTenant.json?.tenant?.slug === "grand-hotel", "grand-hotel tenant DTO mismatch");
  assert(budgetTenant.json?.tenant?.slug === "budget-inn", "budget-inn tenant DTO mismatch");

  const grandRooms = await fetchJson(`/api/${grand.slug}/rooms`, grand.slug);
  const budgetRooms = await fetchJson(`/api/${budget.slug}/rooms`, budget.slug);
  assert(grandRooms.response.ok, "grand-hotel rooms endpoint failed");
  assert(budgetRooms.response.ok, "budget-inn rooms endpoint failed");
  assert(Array.isArray(grandRooms.json?.rooms), "grand-hotel rooms DTO invalid");
  assert(Array.isArray(budgetRooms.json?.rooms), "budget-inn rooms DTO invalid");
  assert(grandRooms.json.rooms.length > 0, "grand-hotel rooms missing");
  assert(budgetRooms.json.rooms.length > 0, "budget-inn rooms missing");

  const grandRoomCodes = new Set(grandRooms.json.rooms.map((r: any) => r.code));
  const budgetRoomCodes = new Set(budgetRooms.json.rooms.map((r: any) => r.code));
  const overlap = [...grandRoomCodes].filter((code) => budgetRoomCodes.has(code));
  assert(overlap.length === 0, `Cross-tenant room overlap detected: ${overlap.join(", ")}`);

  const chat = await fetchJson(`/api/${grand.slug}/chat`, grand.slug, "POST", {
    transcript: "",
    currentState: "WELCOME",
    sessionId: "phase4-chat-contract-check",
  });
  assert(chat.response.ok, "chat endpoint failed");
  assert(typeof chat.json?.speech === "string", "chat DTO missing speech");
  assert(typeof chat.json?.intent === "string", "chat DTO missing intent");
  assert(typeof chat.json?.confidence === "number", "chat DTO missing confidence");

  const bookingChat = await fetchJson(`/api/${grand.slug}/chat/booking`, grand.slug, "POST", {
    transcript: "",
    currentState: "BOOKING_COLLECT",
    sessionId: "phase4-booking-contract-check",
  });
  assert(bookingChat.response.ok, "booking chat endpoint failed");
  assert(typeof bookingChat.json?.speech === "string", "booking chat DTO missing speech");
  assert(typeof bookingChat.json?.intent === "string", "booking chat DTO missing intent");
  assert(typeof bookingChat.json?.confidence === "number", "booking chat DTO missing confidence");

  const missingTenant = await fetchJson(`/api/nonexistent/rooms`, "nonexistent");
  assert(missingTenant.response.status === 404, "nonexistent tenant should return 404");
  assert(missingTenant.json?.error?.code === "TENANT_NOT_FOUND", "nonexistent tenant error code mismatch");

  console.log("Phase 4 contract/isolation checks passed");
}

main()
  .catch((error) => {
    console.error("Phase 4 verification failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
