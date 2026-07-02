-- Atomic ride acceptance with round validation and idempotency.
-- KEYS[1] = ride state key
-- KEYS[2] = assigned driver key
-- KEYS[3] = allocation round key
-- KEYS[4] = idempotency key for this driver+ride
-- ARGV[1] = driverId
-- ARGV[2] = expected round number
-- ARGV[3] = SEARCHING state value
-- ARGV[4] = ASSIGNED state value
-- ARGV[5] = idempotency token
-- ARGV[6] = idempotency TTL seconds

local state = redis.call('GET', KEYS[1])
local assigned = redis.call('GET', KEYS[2])
local round = redis.call('GET', KEYS[3])
local idem = redis.call('GET', KEYS[4])

-- Idempotent replay: same driver already won this ride
if assigned == ARGV[1] then
  return 2
end

-- Duplicate accept request from same driver after a prior attempt
if idem == ARGV[5] then
  if assigned == ARGV[1] then
    return 2
  end
  return 0
end

-- Another driver already assigned
if assigned then
  return 0
end

-- State must be SEARCHING and round must match (guards against stale/late accepts)
if state ~= ARGV[3] then
  return 0
end

if tonumber(round) ~= tonumber(ARGV[2]) then
  return 0
end

-- Winner takes the ride
redis.call('SET', KEYS[1], ARGV[4])
redis.call('SET', KEYS[2], ARGV[1])
redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[6])

return 1
