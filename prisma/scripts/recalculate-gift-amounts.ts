import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import * as readline from 'readline';

const prisma = new PrismaClient();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

async function main() {
  console.log('🚀 Starting Pre-check for Recalculation of Gift Amounts (March 2026)...');

  const startDate = new Date('2026-03-01T00:00:00Z');
  const now = new Date();

  // 1. Fetch all orders in March 2026
  const orders = await prisma.order.findMany({
    where: {
      orderDate: {
        gte: startDate,
        lte: now,
      },
    },
    include: {
      gifts: {
        include: {
          gift: true,
        },
      },
    },
  });

  console.log(`📦 Found ${orders.length} orders in the period.`);

  const changes: any[] = [];

  for (const order of orders) {
    let newTotalGiftAmount = new Decimal(0);

    if (order.gifts.length > 0) {
      for (const orderGift of order.gifts) {
        if (orderGift.gift) {
          const giftPrice = new Decimal(orderGift.gift.price);
          const quantity = new Decimal(orderGift.quantity);
          newTotalGiftAmount = newTotalGiftAmount.add(giftPrice.mul(quantity));
        }
      }
    }

    const currentGiftAmount = new Decimal(order.giftAmount);
    if (!newTotalGiftAmount.equals(currentGiftAmount)) {
      changes.push({
        id: order.id,
        customer: (order as any).customerName || 'N/A',
        oldAmount: currentGiftAmount.toNumber(),
        newAmount: newTotalGiftAmount.toNumber(),
        orderDate: order.orderDate
      });
    }
  }

  if (changes.length === 0) {
    console.log('✅ No changes detected. All orders are up to date.');
    return;
  }

  console.log('\n⚠️ THE FOLLOWING CHANGES WILL BE APPLIED:');
  console.log('--------------------------------------------------------------------------------');
  console.log('| Order ID (Short) | Customer      | Old Gift   | New Gift   | Date       |');
  console.log('--------------------------------------------------------------------------------');
  changes.forEach(c => {
    const shortId = c.id.substring(0, 8) + '...';
    const dateStr = c.orderDate.toISOString().split('T')[0];
    console.log(`| ${shortId.padEnd(16)} | ${c.customer.substring(0, 13).padEnd(13)} | ${c.oldAmount.toLocaleString().padStart(10)} | ${c.newAmount.toLocaleString().padStart(10)} | ${dateStr} |`);
  });
  console.log('--------------------------------------------------------------------------------');
  console.log(`Total orders to update: ${changes.length}\n`);

  const answer = await askQuestion('❓ Do you want to apply these changes? (yes/no): ');

  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    console.log('\n🚀 Applying changes...');
    let updatedCount = 0;
    for (const c of changes) {
      await prisma.order.update({
        where: { id: c.id },
        data: { giftAmount: new Decimal(c.newAmount) }
      });
      process.stdout.write('.');
      updatedCount++;
    }
    console.log(`\n\n✅ Finished! Updated ${updatedCount} orders.`);
    console.log('📝 Please check the Dashboard to see updated commissions.');
  } else {
    console.log('\n❌ Operation cancelled by user.');
  }
}

main()
  .catch((e) => {
    console.error('\n❌ Script failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
