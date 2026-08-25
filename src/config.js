import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4001,
  sabre: {
    clientId: process.env.SABRE_CLIENT_ID,
    clientSecret: process.env.SABRE_CLIENT_SECRET,
    baseUrl: process.env.SABRE_BASE_URL || 'https://api-crt.cert.havail.sabre.com',
  },
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  // Optional providers. Absent credentials are not an error: the provider port
  // falls back to the simulator, so a missing key degrades the demo rather
  // than breaking it.
  duffel: {
    accessToken: process.env.DUFFEL_ACCESS_TOKEN,
    baseUrl: process.env.DUFFEL_BASE_URL || 'https://api.duffel.com',
  },
  aeroDataBox: {
    rapidApiKey: process.env.RAPIDAPI_KEY,
    host: process.env.AERODATABOX_HOST || 'aerodatabox.p.rapidapi.com',
  },
  openSky: {
    username: process.env.OPENSKY_USERNAME,
    password: process.env.OPENSKY_PASSWORD,
  },
  providers: {
    // Duffel is the default for search and booking: Sabre's CERT cache only
    // carries one route, while Duffel returned offers on every route tested.
    // Set either to 'sabre'/'simulator' to swap back without touching code.
    search: process.env.SEARCH_PROVIDER || 'duffel',
    booking: process.env.BOOKING_PROVIDER || 'duffel',
    status: process.env.STATUS_PROVIDER || 'simulator',
  },

  // The member's autonomy limit. Currency must match what the active search
  // provider quotes, otherwise the policy engine correctly refuses to compare
  // them rather than inventing an exchange rate. Duffel test mode quotes EUR.
  policy: {
    costCap: {
      amount: Number(process.env.POLICY_COST_CAP_AMOUNT) || 300,
      currency: process.env.POLICY_COST_CAP_CURRENCY || 'EUR',
    },
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017',
    dbName: process.env.MONGO_DB_NAME || 'travel_disruption_concierge',
  },
};
