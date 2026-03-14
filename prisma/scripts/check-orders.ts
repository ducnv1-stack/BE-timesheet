import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: todayStart }
    },
    select: {
      id: true,
      totalAmount: true,
      orderDate: true,
      createdAt: true,
      isPaymentConfirmed: true,
      confirmedAt: true,
      status: true
    }
  });

  console.log(JSON.stringify(orders, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
