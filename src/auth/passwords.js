import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function validatePasswordStrength(password) {
  return typeof password === 'string' && password.length >= 8;
}
