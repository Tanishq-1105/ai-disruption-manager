import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signToken(payload, { secret = config.auth.jwtSecret, expiresIn = config.auth.jwtExpiresIn } = {}) {
  return jwt.sign(payload, secret, { expiresIn });
}

export function verifyToken(token, { secret = config.auth.jwtSecret } = {}) {
  return jwt.verify(token, secret);
}
