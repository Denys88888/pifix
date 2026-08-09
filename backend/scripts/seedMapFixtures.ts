/**
 * Throwaway fixtures for exercising GET /api/nearby by hand.
 *
 * Places pins at known distances from a reference point so the haversine
 * result can be checked against a number someone worked out separately,
 * rather than against whatever the code happens to return.
 *
 *   npx tsx scripts/seedMapFixtures.ts          seed
 *   npx tsx scripts/seedMapFixtures.ts --clean  remove everything it created
 */
import { OrderStatus, PrismaClient, VerificationStatus } from '@prisma/client';

const prisma = new PrismaClient();

/** Kyiv, Maidan. Everything below is offset from here. */
const ORIGIN = { lat: 50.45, lng: 30.5234 };
const TAG = 'mapfixture';

/** 1 degree of latitude ≈ 111.32 km, so this is a clean north-south offset. */
const kmNorth = (km: number) => ORIGIN.lat + km / 111.32;

const TASKS = [
  { title: 'Fix a leaking tap', km: 0.5, budget: '25' },
  { title: 'Rewire two sockets', km: 2, budget: '40' },
  { title: 'Move a fridge', km: 4.5, budget: '60' },
  // Outside a 5 km radius on purpose: proves the circle is applied and not
  // just the bounding box, which would let this one through.
  { title: 'Paint a fence (far away)', km: 12, budget: '90' },
];

const WORKERS = [
  { name: 'Anna the plumber', km: 1, available: true, online: true },
  { name: 'Boris the electrician', km: 3, available: true, online: false },
  // Available but far: must be excluded by distance.
  { name: 'Clara far-away', km: 30, available: true, online: true },
  // Near but not taking work: must be excluded by the availability filter.
  { name: 'Dmytro unavailable', km: 1.5, available: false, online: true },
];

async function clean() {
  await prisma.order.deleteMany({ where: { title: { contains: TAG } } });
  const users = await prisma.user.findMany({ where: { username: { startsWith: TAG } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.masterProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`cleaned ${ids.length} fixture users and their orders`);
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }
  await clean();

  const category = await prisma.category.findFirstOrThrow({ where: { slug: 'plumbing' } });

  const client = await prisma.user.create({
    data: { piUid: `${TAG}-client`, username: `${TAG}_client`, lastSeenAt: new Date() },
  });

  for (const [i, task] of TASKS.entries()) {
    await prisma.order.create({
      data: {
        publicId: `${TAG}-${i}`,
        clientId: client.id,
        categoryId: category.id,
        title: `${task.title} [${TAG}]`,
        description: 'Fixture order for map testing. Safe to delete.',
        budgetPi: task.budget,
        address: 'Kyiv',
        lat: kmNorth(task.km),
        lng: ORIGIN.lng,
        status: OrderStatus.OPEN,
      },
    });
  }

  for (const [i, w] of WORKERS.entries()) {
    const user = await prisma.user.create({
      data: {
        piUid: `${TAG}-w${i}`,
        username: `${TAG}_w${i}`,
        // upsertProfile sets this in the real flow; fixtures write the profile
        // straight to the database, so it has to be set explicitly or the
        // dashboard still offers "become a master".
        isMaster: true,
        // Offline means "last seen well outside the online window".
        lastSeenAt: w.online ? new Date() : new Date(Date.now() - 60 * 60 * 1000),
      },
    });
    await prisma.masterProfile.create({
      data: {
        userId: user.id,
        displayName: w.name,
        bio: 'Fixture master for map testing. Safe to delete.',
        lat: kmNorth(w.km),
        lng: ORIGIN.lng,
        address: 'Kyiv',
        isAvailable: w.available,
        verificationStatus: VerificationStatus.VERIFIED,
        categories: { create: [{ categoryId: category.id }] },
      },
    });
  }

  console.log(`seeded ${TASKS.length} orders and ${WORKERS.length} masters around ${ORIGIN.lat},${ORIGIN.lng}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
