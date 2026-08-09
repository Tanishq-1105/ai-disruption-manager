import { Router } from 'express';
import * as history from '../store/history.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const results = await history.listByUser(req.user.id);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

export default router;
