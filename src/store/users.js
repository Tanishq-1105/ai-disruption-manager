import { randomUUID } from 'node:crypto';
import { getDb } from './mongo.js';

let indexesEnsured = false;

async function usersCollection() {
  const db = await getDb();
  const collection = db.collection('users');
  if (!indexesEnsured) {
    await collection.createIndex({ email: 1 }, { unique: true });
    indexesEnsured = true;
  }
  return collection;
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export async function createUser({ email, passwordHash }) {
  const collection = await usersCollection();
  const user = {
    id: randomUUID(),
    email: normalizeEmail(email),
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  await collection.insertOne(user);
  return user;
}

export async function findByEmail(email) {
  const collection = await usersCollection();
  return collection.findOne({ email: normalizeEmail(email) }, { projection: { _id: 0 } });
}

export async function findById(id) {
  const collection = await usersCollection();
  return collection.findOne({ id }, { projection: { _id: 0 } });
}

export async function _resetForTests() {
  const collection = await usersCollection();
  await collection.deleteMany({});
}
