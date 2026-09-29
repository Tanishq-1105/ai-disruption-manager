import { HttpError } from '../errors.js';

export function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(error);
  res.status(500).json({ error: error.message });
}
