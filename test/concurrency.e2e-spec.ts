import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('Concurrency (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  it('assigns exactly one driver when many accept simultaneously', async () => {
    const pickup = { lat: 12.9716, lng: 77.5946 };

    const driverIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/drivers')
        .send({
          name: `E2E Driver ${i}`,
          phone: `+9199${Date.now()}${i}`,
          latitude: pickup.lat + i * 0.001,
          longitude: pickup.lng + i * 0.0005,
        })
        .expect(201);
      driverIds.push(res.body.id);
    }

    const rideRes = await request(app.getHttpServer())
      .post('/rides')
      .send({
        riderId: 'e2e-rider',
        pickupLatitude: pickup.lat,
        pickupLongitude: pickup.lng,
      })
      .expect(201);

    const rideId = rideRes.body.id;

    await new Promise((r) => setTimeout(r, 300));

    const acceptResults = await Promise.all(
      driverIds.map((driverId) =>
        request(app.getHttpServer())
          .post(`/rides/${rideId}/accept/${driverId}`)
          .send({ round: 1 }),
      ),
    );

    const successes = acceptResults.filter((r) => r.body.success === true);
    const failures = acceptResults.filter((r) => r.body.success === false);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(4);

    const ride = await request(app.getHttpServer())
      .get(`/rides/${rideId}`)
      .expect(200);

    expect(ride.body.status).toBe('ASSIGNED');
    expect(ride.body.assignedDriverId).toBe(successes[0].body.ride.assignedDriverId);
  });
});
