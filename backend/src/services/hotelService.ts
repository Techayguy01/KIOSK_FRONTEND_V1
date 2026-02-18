// backend/src/services/hotelService.ts
import { prisma } from '../db';

export const hotelService = {
    async getAvailableRooms() {
        return await prisma.room.findMany({
            where: { status: 'AVAILABLE' },
            select: {
                number: true,
                type: true,
                price: true,
                description: true,
                amenities: true
            }
        });
    },

    async getRoomByNumber(number: string) {
        return await prisma.room.findUnique({
            where: { number }
        });
    }
};
