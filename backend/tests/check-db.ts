import { prisma } from './src/db/prisma.js';
import * as fs from 'fs';

async function main() {
    const bookings = await prisma.booking.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { roomType: true }
    });

    fs.writeFileSync('bookings-output.json', JSON.stringify(bookings, null, 2));
    console.log("Wrote bookings to bookings-output.json");
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
