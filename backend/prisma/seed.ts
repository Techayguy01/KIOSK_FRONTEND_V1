// backend/prisma/seed.ts
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
    console.log("🌱 Seeding Database...")

    const rooms = [
        { number: '101', type: 'Deluxe Suite', price: 45000, description: 'Ocean View, King Bed' },
        { number: '102', type: 'Standard Room', price: 20000, description: 'Garden View, Queen Bed' },
        { number: '103', type: 'Economy Twin', price: 15000, description: 'City View, 2 Single Beds' },
        { number: '201', type: 'Presidential Suite', price: 90000, description: 'Top Floor, Jacuzzi' },
    ]

    for (const r of rooms) {
        const room = await prisma.room.upsert({
            where: { number: r.number },
            update: {},
            create: {
                number: r.number,
                type: r.type,
                price: r.price,
                status: 'AVAILABLE',
                description: r.description
            },
        })
        console.log(`Created room: ${room.number}`)
    }
    console.log("✅ Seeding Complete!")
}

main()
    .then(async () => { await prisma.$disconnect() })
    .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
