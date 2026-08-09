import { verifyToken } from '../auth/tokens.js';
import { extractToken } from './requireAuth.js';

export function optionalAuth(req, res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      // No valid session — proceed unauthenticated rather than blocking a browse request.
    }
  }
  next();
}
