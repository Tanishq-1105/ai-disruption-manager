import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    sabreConfigured: Boolean(config.sabre.clientId && config.sabre.clientSecret),
  });
});

export default router;
