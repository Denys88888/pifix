/**
 * Seeds the immutable reference data:
 *   - the single platform_settings row (id = 1) with the documented defaults;
 *   - the service categories (names live in the i18n bundles, keyed by slug).
 *
 * Safe to run repeatedly: everything is an upsert.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES: Array<{ slug: string; icon: string }> = [
  { slug: 'plumbing', icon: '🚰' },
  { slug: 'electrical', icon: '💡' },
  { slug: 'mechanic', icon: '🔧' },
  { slug: 'construction', icon: '🧱' },
  { slug: 'demolition', icon: '🔨' },
  { slug: 'courier', icon: '📦' },
  { slug: 'moving', icon: '🚚' },
  { slug: 'cleaning', icon: '🧹' },
  { slug: 'furniture', icon: '🪑' },
  { slug: 'appliance_repair', icon: '🧰' },
  { slug: 'it_onsite', icon: '💻' },
  { slug: 'other', icon: '🛠️' },
];

async function main() {
  const settings = await prisma.platformSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      connectPricePi: '0.5',
      clientFeePercent: '10.00',
      masterFeePercent: '0.00',
      proSubscriptionPricePi: '10.0',
      expressFeePi: '3.0',
      profileBoostPricePi: '5.0',
      escrowTimeoutDays: 7,
      referralBonusDirectPi: '1.0',
      referralBonusIndirectPi: '0.5',
      minBudgetPi: '1.0',
      maxOpenOrdersPerClient: 5,
      maxActiveResponsesPerMaster: 10,
      connectRefundWindowMinutes: 60,
      minWithdrawalPi: '5.0',
      autoWithdrawalPi: '0',
      piUsdRate: '0',
      maintenanceMode: false,
    },
  });
  console.log(`platform_settings ready (updated ${settings.updatedAt.toISOString()})`);

  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { icon: category.icon, sortOrder: index, isActive: true },
      create: { slug: category.slug, icon: category.icon, sortOrder: index },
    });
  }
  console.log(`${CATEGORIES.length} categories ready`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
