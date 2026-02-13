/**
 * Room Inventory — Source of Truth for Available Rooms
 * 
 * This data is injected into the LLM prompt when the user
 * is browsing or booking rooms.
 */

export interface RoomInventoryItem {
    type: string;
    name: string;
    pricePerNight: number;
    maxAdults: number;
    maxChildren: number;
    amenities: string[];
    description: string;
}

export const ROOM_INVENTORY: RoomInventoryItem[] = [
    {
        type: "STANDARD",
        name: "Standard Room",
        pricePerNight: 2500,
        maxAdults: 2,
        maxChildren: 1,
        amenities: ["Free Wi-Fi", "Queen Bed", "Garden View", "Pool Access", "Gym Access"],
        description: "A cozy and comfortable room with all essential amenities. Perfect for solo travelers or couples."
    },
    {
        type: "DELUXE",
        name: "Deluxe Suite",
        pricePerNight: 4500,
        maxAdults: 3,
        maxChildren: 2,
        amenities: ["Free Wi-Fi", "King Bed", "City View", "Pool Access", "Complimentary Breakfast", "Mini Bar", "Room Service"],
        description: "A spacious suite with premium amenities and a stunning city view. Includes complimentary breakfast."
    },
    {
        type: "PRESIDENTIAL",
        name: "Presidential Suite",
        pricePerNight: 8000,
        maxAdults: 4,
        maxChildren: 3,
        amenities: ["Free Wi-Fi", "King Bed", "Panoramic View", "Jacuzzi", "Private Lounge", "24hr Butler", "All Meals Included", "Airport Transfer"],
        description: "Our finest accommodation — 800 sq ft of luxury with panoramic views, private jacuzzi, and dedicated butler service."
    }
];

/** Get room by type string (case-insensitive partial match) */
export function findRoom(query: string): RoomInventoryItem | undefined {
    const q = query.toLowerCase();
    return ROOM_INVENTORY.find(r =>
        r.type.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
    );
}

/** Format inventory as a string for LLM prompt injection */
export function formatInventoryForPrompt(): string {
    return ROOM_INVENTORY.map(r =>
        `- ${r.name} (${r.type}): ₹${r.pricePerNight}/night | Max: ${r.maxAdults} adults, ${r.maxChildren} children | ${r.amenities.join(", ")} | ${r.description}`
    ).join("\n");
}
