// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting database seed...');

    // 1. Clean the database (Optional: careful in production!)
    await prisma.booking.deleteMany();
    await prisma.guest.deleteMany();
    await prisma.room.deleteMany();
    await prisma.session.deleteMany();

    // 2. Create Rooms
    const rooms = await prisma.room.createMany({
        data: [
            {
                number: "101",
                type: "DELUXE",
                price: 150.00,
                status: "AVAILABLE",
                description: "A cozy room with a city view.",
                amenities: ["Wi-Fi", "TV", "Coffee Machine"]
            },
            {
                number: "102",
                type: "DELUXE",
                price: 150.00,
                status: "DIRTY", // To test logic later
                description: "A cozy room with a city view.",
                amenities: ["Wi-Fi", "TV", "Coffee Machine"]
            },
            {
                number: "201",
                type: "SUITE",
                price: 350.00,
                status: "AVAILABLE",
                description: "Luxury suite with ocean view and jacuzzi.",
                amenities: ["Wi-Fi", "TV", "Jacuzzi", "Mini Bar", "Ocean View"]
            }
        ]
    });

    // 3. Create a Test Guest (You!)
    const guest = await prisma.guest.create({
        data: {
            firstName: "Antigravity",
            lastName: "User",
            email: "test@example.com"
        }
    });

    console.log(`✅ Seeded ${rooms.count} rooms and guest: ${guest.firstName}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
