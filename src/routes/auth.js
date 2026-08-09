import { Router } from 'express';
import * as users from '../store/users.js';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../auth/passwords.js';
import { signToken } from '../auth/tokens.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

function toPublicUser(user) {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function issueToken(user) {
  return signToken({ sub: user.id, email: user.email });
}

router.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !validatePasswordStrength(password)) {
      return res.status(400).json({ error: 'Valid email and a password of at least 8 characters are required' });
    }

    const existing = await users.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await hashPassword(password);
    const user = await users.createUser({ email, passwordHash });

    res.status(201).json({ token: issueToken(user), user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = email && (await users.findByEmail(email));
    const valid = user && (await verifyPassword(password || '', user.passwordHash));
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    res.json({ token: issueToken(user), user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await users.findById(req.user.id);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    res.json({ user: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
});

export default router;
