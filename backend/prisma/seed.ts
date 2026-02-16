import { PrismaClient, Plan, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.booking.deleteMany();
  await prisma.user.deleteMany();
  await prisma.roomType.deleteMany();
  await prisma.hotelConfig.deleteMany();
  await prisma.tenant.deleteMany();

  const grandHotel = await prisma.tenant.create({
    data: {
      name: "Grand Hotel",
      slug: "grand-hotel",
      plan: Plan.ENTERPRISE,
      hotelConfig: {
        create: {
          timezone: "America/New_York",
          supportPhone: "999-999",
          checkInTime: new Date("1970-01-01T14:00:00.000Z"),
        },
      },
      users: {
        create: [
          { email: "owner@grandhotel.com", role: UserRole.TENANT_OWNER },
          { email: "kiosk@grandhotel.com", role: UserRole.KIOSK_MACHINE },
        ],
      },
      roomTypes: {
        create: [
          {
            name: "Presidential Suite",
            code: "PRESIDENTIAL",
            price: 800,
            amenities: ["Private Butler", "Panoramic Ocean View", "Premium Lounge Access"],
          },
          {
            name: "Ocean View Deluxe",
            code: "DELUXE_OCEAN",
            price: 450,
            amenities: ["Ocean View Balcony", "King Bed", "Premium Breakfast"],
          },
        ],
      },
    },
    include: {
      roomTypes: true,
    },
  });

  const budgetInn = await prisma.tenant.create({
    data: {
      name: "Budget Inn",
      slug: "budget-inn",
      plan: Plan.FREE,
      hotelConfig: {
        create: {
          timezone: "America/Chicago",
          supportPhone: "555-123",
          checkInTime: new Date("1970-01-01T12:00:00.000Z"),
        },
      },
      users: {
        create: [
          { email: "owner@budgetinn.com", role: UserRole.TENANT_OWNER },
          { email: "kiosk@budgetinn.com", role: UserRole.KIOSK_MACHINE },
        ],
      },
      roomTypes: {
        create: [
          {
            name: "Bunk Bed Dorm",
            code: "BUNK_DORM",
            price: 40,
            amenities: ["Shared Bath", "Locker", "Fast Check-In"],
          },
          {
            name: "Standard Single",
            code: "STANDARD_SINGLE",
            price: 80,
            amenities: ["Single Bed", "Private Bath", "Self-Service Checkout"],
          },
        ],
      },
    },
    include: {
      roomTypes: true,
    },
  });

  console.log("Seed complete");
  console.log(`- ${grandHotel.name}: ${grandHotel.roomTypes.map((r) => r.name).join(", ")}`);
  console.log(`- ${budgetInn.name}: ${budgetInn.roomTypes.map((r) => r.name).join(", ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
