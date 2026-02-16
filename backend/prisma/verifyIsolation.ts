import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const grandHotel = await prisma.tenant.findUnique({
    where: { slug: "grand-hotel" },
  });
  const budgetInn = await prisma.tenant.findUnique({
    where: { slug: "budget-inn" },
  });

  if (!grandHotel || !budgetInn) {
    throw new Error("Seed data missing for one or more tenants.");
  }

  const grandRooms = await prisma.roomType.findMany({
    where: { tenantId: grandHotel.id },
    select: { name: true, price: true, code: true },
    orderBy: { price: "desc" },
  });

  const budgetRooms = await prisma.roomType.findMany({
    where: { tenantId: budgetInn.id },
    select: { name: true, price: true, code: true },
    orderBy: { price: "asc" },
  });

  console.log("Grand Hotel rooms:", grandRooms);
  console.log("Budget Inn rooms:", budgetRooms);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
