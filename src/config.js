import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  sabre: {
    clientId: process.env.SABRE_CLIENT_ID,
    clientSecret: process.env.SABRE_CLIENT_SECRET,
    baseUrl: process.env.SABRE_BASE_URL || 'https://api.cert.havail.sabre.com',
  },
};
