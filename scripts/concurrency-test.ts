/**
 * Concurrency verification script.
 *
 * Prerequisites:
 *   docker compose up -d
 *   npm run start:dev
 *
 * Run: npm run test:concurrency
 */
const BASE_URL = process.env.API_URL ?? 'http://localhost:3000';

interface Driver {
  id: string;
}

interface Ride {
  id: string;
  allocationRound?: number;
}

interface AcceptResponse {
  success: boolean;
  idempotent: boolean;
  message: string;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

async function createDriver(name: string, lat: number, lng: number): Promise<Driver> {
  return request<Driver>('POST', '/drivers', {
    name,
    phone: `+1${Date.now()}${Math.floor(Math.random() * 1000)}`,
    latitude: lat,
    longitude: lng,
  });
}

async function main(): Promise<void> {
  console.log('=== Vybe Cabs Concurrency Test ===\n');
  console.log(`API: ${BASE_URL}\n`);

  // Bangalore CBD coordinates — drivers clustered nearby
  const pickup = { lat: 12.9716, lng: 77.5946 };
  const offsets = [
    { lat: 0.001, lng: 0.001 },
    { lat: 0.002, lng: 0.0005 },
    { lat: 0.0005, lng: 0.002 },
    { lat: 0.003, lng: 0.001 },
    { lat: 0.0015, lng: 0.0025 },
  ];

  console.log('Creating 5 drivers near pickup...');
  const drivers = await Promise.all(
    offsets.map((o, i) =>
      createDriver(`Driver ${i + 1}`, pickup.lat + o.lat, pickup.lng + o.lng),
    ),
  );
  console.log(`  Created: ${drivers.map((d) => d.id.slice(0, 8)).join(', ')}\n`);

  console.log('Requesting ride...');
  const ride = await request<Ride>('POST', '/rides', {
    riderId: 'concurrency-test-rider',
    pickupLatitude: pickup.lat,
    pickupLongitude: pickup.lng,
  });
  console.log(`  Ride ID: ${ride.id}\n`);

  // Brief pause so allocation can notify drivers
  await new Promise((r) => setTimeout(r, 500));

  const round = 1;
  console.log(`Firing ${drivers.length} simultaneous accept requests (round ${round})...\n`);

  const results = await Promise.all(
    drivers.map((driver) =>
      request<AcceptResponse>('POST', `/rides/${ride.id}/accept/${driver.id}`, {
        round,
      }).then((res) => ({ driverId: driver.id, ...res })),
    ),
  );

  const winners = results.filter((r) => r.success);
  const losers = results.filter((r) => !r.success);

  console.log('Results:');
  for (const r of results) {
    const tag = r.success ? 'WIN' : 'LOSE';
    console.log(`  [${tag}] ${r.driverId.slice(0, 8)}... — ${r.message}`);
  }

  console.log('\n--- Summary ---');
  console.log(`  Total accepts:  ${results.length}`);
  console.log(`  Successful:     ${winners.length}`);
  console.log(`  Rejected:       ${losers.length}`);

  const finalRide = await request<Ride & { status: string; assignedDriverId: string }>(
    'GET',
    `/rides/${ride.id}`,
  );
  console.log(`  Final status:   ${finalRide.status}`);
  console.log(`  Assigned to:    ${finalRide.assignedDriverId?.slice(0, 8)}...`);

  if (winners.length !== 1) {
    console.error('\nFAILED: Expected exactly 1 successful assignment.');
    process.exit(1);
  }

  if (finalRide.status !== 'ASSIGNED') {
    console.error('\nFAILED: Ride should be in ASSIGNED state.');
    process.exit(1);
  }

  if (finalRide.assignedDriverId !== winners[0].driverId) {
    console.error('\nFAILED: Assigned driver mismatch.');
    process.exit(1);
  }

  // Idempotency check — winner retries with same key
  console.log('\nIdempotency check (winner retries)...');
  const idemKey = 'test-idempotency-key';
  const retry1 = await fetch(`${BASE_URL}/rides/${ride.id}/accept/${winners[0].driverId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': idemKey,
    },
    body: JSON.stringify({ round }),
  }).then((r) => r.json() as Promise<AcceptResponse>);

  const retry2 = await fetch(`${BASE_URL}/rides/${ride.id}/accept/${winners[0].driverId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': idemKey,
    },
    body: JSON.stringify({ round }),
  }).then((r) => r.json() as Promise<AcceptResponse>);

  if (!retry1.success || !retry2.success) {
    console.error('FAILED: Idempotent retries should succeed.');
    process.exit(1);
  }

  console.log('  Both idempotent retries succeeded.\n');
  console.log('PASSED: Concurrency guarantees verified.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
