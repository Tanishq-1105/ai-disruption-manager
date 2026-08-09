import { randomUUID } from 'node:crypto';
import { getDb } from './mongo.js';

let indexesEnsured = false;

async function historyCollection() {
  const db = await getDb();
  const collection = db.collection('history');
  if (!indexesEnsured) {
    await collection.createIndex({ userId: 1, createdAt: -1 });
    indexesEnsured = true;
  }
  return collection;
}

export async function addEntry({ userId, category, query, resultCount }) {
  const collection = await historyCollection();
  const entry = {
    id: randomUUID(),
    userId,
    category,
    query,
    resultCount,
    createdAt: new Date().toISOString(),
  };
  await collection.insertOne(entry);
  return entry;
}

export async function listByUser(userId) {
  const collection = await historyCollection();
  return collection
    .find({ userId }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray();
}

export async function _resetForTests() {
  const collection = await historyCollection();
  await collection.deleteMany({});
}
