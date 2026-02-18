// backend/src/services/sessionService.ts
import { prisma } from '../db';

// Define the interface locally if not available in contracts yet, 
// or import if it exists. The user provided snippet imports from contracts.
// I will check `backend.contract.ts` or define it here to be safe, 
// but the user said "Ensure this path matches your structure".
// I'll assume the structure is consistent with `chat.ts` which defines ChatMessage internally currently.
// Wait, `chat.ts` defined:
// interface ChatMessage { role: "user" | "assistant"; content: string; }
// The user's snippet imports `ChatMessage` from `../contracts/backend.contract`.
// I should check if that contract exists. `shared/contracts/backend.contract.ts` exists.
// But in backend/src, the relative path would be `../../shared/contracts...` or similar if mapped.
// However, the backend likely has its own contracts or I should define it here for now to match `chat.ts`.
// BUT, the user's snippet specifically used: `import { ChatMessage } from '../contracts/backend.contract';`
// I need to be careful about imports.
// Let's look at `backend/src/routes/chat.ts`. It imports from `../llm/contracts` (LLMResponseSchema).
// I'll stick to defining ChatMessage interface here or importing from a known location if confirmed.
// Actually, `chat.ts` used:
// interface ChatMessage { role: "user" | "assistant"; content: string; }
// The user's snippet uses `text` in `addMessage` ({ role, text, timestamp }).
// So the structure is changing!
// I'll follow the user's snippet exactly for logic but I might need to adjust the interface definition if the import fails.
// I'll try to use `any` for `messages` in `findUnique` types if strictness is an issue, 
// or verify `../contracts/backend.contract` exists.
// The user said: `import { ChatMessage } from '../contracts/backend.contract'; // Ensure this path matches your structure`
// I don't see `backend/src/contracts/backend.contract.ts` in the file list earlier.
// I saw `backend/src/llm/contracts.ts` and `shared/contracts/backend.contract.ts`.
// I'll assume I should create `backend/src/contracts/backend.contract.ts` or fix the import.
// OR, I can define the interface inline to avoid import errors, as this is a new file.
// I'll define it inline to be safe and avoid "File not found" errors, 
// matching the structure used in `addMessage`: { id, role, text, timestamp }.

export interface ChatMessage {
    id?: string;
    role: "user" | "assistant" | "system";
    text: string;     // User snippet uses 'text', chat.ts used 'content'
    timestamp?: number;
    content?: string; // Backwards compatibility if needed
}

export const sessionService = {
    async getHistory(sessionId: string): Promise<ChatMessage[]> {
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
        });

        if (!session || !session.messages) return [];

        // Prisma stores JSON, we cast it back to our type
        return session.messages as unknown as ChatMessage[];
    },

    async addMessage(sessionId: string, message: ChatMessage) {
        const history = await this.getHistory(sessionId);
        const newHistory = [...history, message];

        // Upsert = Update if exists, Insert if new
        await prisma.session.upsert({
            where: { id: sessionId },
            update: { messages: newHistory as any },
            create: {
                id: sessionId,
                messages: newHistory as any
            }
        });
    },

    async clearSession(sessionId: string) {
        await prisma.session.delete({
            where: { id: sessionId }
        }).catch(() => { }); // Ignore if already deleted
    }
};
