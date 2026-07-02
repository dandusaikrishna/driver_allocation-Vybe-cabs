export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'vybe',
    password: process.env.DB_PASSWORD ?? 'vybe_secret',
    database: process.env.DB_DATABASE ?? 'vybe_cabs',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  allocation: {
    driversPerRound: parseInt(process.env.DRIVERS_PER_ROUND ?? '3', 10),
    timeoutSeconds: parseInt(process.env.ALLOCATION_TIMEOUT_SECONDS ?? '10', 10),
    maxRounds: parseInt(process.env.MAX_ALLOCATION_ROUNDS ?? '3', 10),
    geoSearchRadiusKm: parseFloat(process.env.GEO_SEARCH_RADIUS_KM ?? '5'),
  },
});
