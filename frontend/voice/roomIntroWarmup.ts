import type { RoomDTO } from "@contracts/api.contract";

import { getCurrentTenantLanguage } from "../services/tenantContext";
import { buildSiyaIntro } from "../mocks/room-narrations.mock";
import { PremiumAudioPlayer } from "./premiumPlayer";

export const ROOM_SELECT_POST_INTRO_PROMPT = "Please select a room, or do you have any questions regarding the rooms?";

type WarmOptions = {
  sequential?: boolean;
};

export function buildRoomIntroQueue(rooms: RoomDTO[]): string[] {
  return rooms.map((room, index) => buildSiyaIntro(room, index, rooms.length));
}

export async function warmRoomIntroQueue(
  queue: string[],
  language = getCurrentTenantLanguage(),
  options?: WarmOptions,
): Promise<void> {
  const uniqueQueue = Array.from(new Set(queue.map((speech) => String(speech || "").trim()).filter(Boolean)));
  if (uniqueQueue.length === 0) return;

  if (options?.sequential) {
    for (const speech of uniqueQueue) {
      await PremiumAudioPlayer.prefetch(speech, language);
    }
    return;
  }

  await Promise.all(uniqueQueue.map((speech) => PremiumAudioPlayer.prefetch(speech, language)));
}

export async function warmRoomIntroNarrations(
  rooms: RoomDTO[],
  language = getCurrentTenantLanguage(),
): Promise<void> {
  if (!Array.isArray(rooms) || rooms.length === 0) return;
  await warmRoomIntroQueue(
    [...buildRoomIntroQueue(rooms), ROOM_SELECT_POST_INTRO_PROMPT],
    language,
    { sequential: true },
  );
}

export async function ensureWarmNarration(
  text: string,
  language = getCurrentTenantLanguage(),
): Promise<void> {
  if (!text?.trim()) return;
  await PremiumAudioPlayer.prefetch(text, language);
}
