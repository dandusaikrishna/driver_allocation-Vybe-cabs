# Vybe Cabs — Technical Write-Up

**Real-Time Driver Allocation System**  
Author: Saikrishna | July 2026

---

## 1. What I Built

I implemented a NestJS backend that handles the full ride allocation workflow: a rider requests a ride, the system discovers nearby available drivers via Redis GEO, notifies multiple drivers at once, and assigns the ride to whoever accepts first — with hard guarantees that only one driver wins under concurrent load.

**Stack:** NestJS + TypeScript, PostgreSQL (durable state), Redis (geo index + concurrency control).

**Ride states:** `REQUESTED` → `SEARCHING` → `ASSIGNED` | `TIMEOUT` (+ `CANCELLED` enum reserved).

**Key endpoints:**
- `POST /rides` — triggers allocation
- `GET /drivers/:id/notifications` — drivers poll for offers
- `POST /rides/:rideId/accept/:driverId` — atomic acceptance

---

## 2. Design Choices

### 2.1 Geo Search — Redis GEO

Drivers are indexed in a Redis sorted set (`drivers:geo`) via `GEOADD`. On every location update or status change, the service syncs Postgres → Redis. Search uses `GEOSEARCH ... BYRADIUS ... ASC COUNT N` to return nearest drivers within a configurable radius (default 5 km).

Already-notified drivers are excluded via a Redis set (`ride:{id}:notified`), so retry rounds reach fresh candidates. Availability is tracked separately (`driver:{id}:available`) so a driver marked `BUSY` or `OFFLINE` is filtered out even if still in the geo index momentarily.

**Why Redis GEO over PostGIS?** Sub-millisecond radius queries at scale, which matches how ride-hailing platforms typically handle hot-path driver discovery. Postgres holds the source of truth; Redis holds the search-optimised view.

### 2.2 Notifications — Polling + Redis Lists

I chose **polling** (`GET /drivers/:id/notifications`) backed by Redis lists rather than WebSockets or SSE.

**Rationale:**
- Simpler to demo and test — curl works end-to-end
- Notification log is inspectable (`LRANGE` in Redis CLI)
- Concurrency guarantees live in the accept path, not the notification channel
- Production would add push (FCM/APNs) or WebSockets; the accept API contract stays the same

Each notification payload includes `rideId`, `round`, pickup coordinates, and `expiresAt` so drivers know which round to send back on accept.

### 2.3 Concurrency — Lua Script (Critical)

The hardest requirement: **only one driver assigned per ride**, even when many accept simultaneously.

I rejected a naive "check-then-set" in application code because two Node.js requests can both read `SEARCHING` before either writes `ASSIGNED`. Database row locks would work but add latency and couple hot-path logic to Postgres connection pool contention.

**Solution:** A Lua script (`accept-ride.lua`) executed via `EVAL` runs atomically on the Redis server:

```
1. If assigned_driver == this driver → return 2 (idempotent success)
2. If idempotency token already used → return 0 or 2
3. If assigned_driver exists (other winner) → return 0
4. If state != SEARCHING → return 0
5. If round != expected round → return 0  (stale accept after timeout)
6. SET state=ASSIGNED, assigned_driver=driverId → return 1
```

Redis executes Lua scripts exclusively — no interleaving. This is the same pattern used in production systems for inventory deduction, seat booking, and ride matching.

**Round numbers** guard the timeout edge case: when a round expires, `tryAdvanceRound` atomically increments the round only if the ride is still unassigned. A driver accepting with `round=1` after the system moved to `round=2` gets rejected, even if they clicked accept milliseconds after the timeout.

### 2.4 Idempotency

Mobile clients retry on network failure. Without idempotency, a retry could fail confusingly or worse, behave inconsistently.

- Clients may send `Idempotency-Key` header
- Server stores the token in Redis (`accept:{rideId}:{driverId}`) with TTL inside the Lua script
- Duplicate requests with the same key return success if this driver already won

### 2.5 Timeout & Retry

Each allocation round schedules an in-process timer (`ALLOCATION_TIMEOUT_SECONDS`, default 10s). On fire:

1. `tryAdvanceRound` — atomic check that ride is still `SEARCHING` on the expected round and unassigned
2. If max rounds exceeded → `TIMEOUT` in Postgres + Redis
3. Else → increment round, `GEOSEARCH` next drivers (excluding already notified), push new notifications

**Limitation (documented):** In-process timers don't survive process restarts and don't coordinate across multiple API instances. Production fix: BullMQ delayed jobs or Redis keyspace expiry events.

### 2.6 State Split — Postgres + Redis

| Data | Store | Why |
|------|-------|-----|
| Rides, drivers | Postgres | Durability, querying, relations |
| Geo index, allocation state | Redis | Speed, atomic ops |
| Notifications | Redis lists | Ephemeral, fast push/read |

After a successful accept, Postgres is updated (`ASSIGNED`, `assignedDriverId`) and the driver is marked `BUSY` in both stores.

---

## 3. What I'd Improve With More Time

1. **Distributed scheduling** — BullMQ for timeout/retry jobs; survives restarts and scales horizontally
2. **Outbox pattern** — if Postgres write fails after Redis assignment, publish to a reconciliation queue rather than leaving inconsistent state
3. **WebSocket gateway** — NestJS `@WebSocketGateway` for real-time offers; keep Lua accept path unchanged
4. **Integration tests with Testcontainers** — spin Postgres + Redis in CI without manual Docker
5. **Observability** — structured logs with `rideId`/`round` correlation; Prometheus metrics on accept success/reject rates, round latency
6. **PostGIS fallback** — for complex polygon/service-area queries beyond radius search

---

## 4. Production Hardening Recommendations

**Scaling**
- Horizontally scale stateless API pods behind a load balancer
- Redis Cluster or ElastiCache for geo + state; read replicas for notification polling bursts
- Partition ride allocation keys by `rideId` hash — already natural

**Failure recovery**
- Redis persistence (AOF) — already in docker-compose
- Idempotent accept API — already implemented
- Saga/outbox for Postgres ↔ Redis consistency
- Graceful degradation: if Redis is down, reject new rides (don't fall back to non-atomic assignment)

**Security**
- JWT auth for drivers and riders
- Rate limiting on accept endpoint (prevent abuse)
- Validate driver was actually notified for this ride+round (notification signature)

**Observability**
- Trace each allocation round as a span
- Alert on high `TIMEOUT` rate or accept-reject ratio anomalies
- Dashboard: p50/p99 time-to-assign

**Load testing**
- k6 scenario: 500 ride requests/min, 3 drivers each, 30% simultaneous accept collision rate
- Verify zero double-assignments via audit query: `SELECT assignedDriverId, COUNT(*) FROM rides GROUP BY id HAVING COUNT(*) > 1`

---

## 5. Concurrency Verification

Two runnable proofs are included:

1. **`npm run test:concurrency`** — creates 5 drivers, 1 ride, fires 5 parallel accepts, asserts exactly 1 success
2. **`npm run test:e2e`** — Jest test with the same scenario

Both are designed for reviewers to run locally with `docker compose up -d && npm run start:dev`.

---

*End of write-up (~2 pages)*
