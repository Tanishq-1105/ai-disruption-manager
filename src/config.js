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
  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017',
    dbName: process.env.MONGO_DB_NAME || 'travel_disruption_concierge',
  },
};
