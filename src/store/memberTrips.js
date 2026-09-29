import { randomUUID } from 'node:crypto';
import { getDb } from './mongo.js';
import { config } from '../config.js';

let indexes;
async function collection() {
  const result = (await getDb()).collection('memberTrips');
  indexes ??= Promise.all([
    result.createIndex({ id: 1 }, { unique: true }),
    result.createIndex({ userId: 1, offerId: 1 }, { unique: true }),
    result.createIndex({ userId: 1, createdAt: -1 }),
  ]).catch(error => { indexes = null; throw error; });
  await indexes;
  return result;
}

export async function getById(userId, id) {
  return (await collection()).findOne({ userId, id }, { projection: { _id: 0 } });
}

export async function getByOffer(userId, offerId) {
  return (await collection()).findOne({ userId, offerId }, { projection: { _id: 0 } });
}

export async function saveQuote(userId, quote) {
  const entries = await collection();
  const now = new Date().toISOString();
  const existing = await getByOffer(userId, quote.offerId);
  if (existing) {
    return await entries.findOneAndUpdate({ userId, id: existing.id, status: 'QUOTED' }, {
      $set: { quote, version: randomUUID(), updatedAt: now },
    }, { returnDocument: 'after', projection: { _id: 0 } }) ?? await getById(userId, existing.id);
  }
  const record = {
    id: randomUUID(), userId, offerId: quote.offerId, version: randomUUID(),
    status: 'QUOTED', quote, sandbox: true, provider: 'duffel', createdAt: now, updatedAt: now,
  };
  try {
    await entries.insertOne(record);
    return record;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return getByOffer(userId, quote.offerId);
  }
}

// Only one request may leave QUOTED, even across processes or after restart.
export async function claim(userId, id, version, passenger, fingerprint) {
  return (await collection()).findOneAndUpdate({ userId, id, version, status: 'QUOTED' }, {
    $set: { status: 'BOOKING', passenger, fingerprint, updatedAt: new Date().toISOString() },
    $push: { audit: { at: new Date().toISOString(), action: 'BOOK_REQUESTED', authorisedBy: 'MEMBER_CONFIRMATION' } },
  }, { returnDocument: 'after', projection: { _id: 0 } });
}

export async function update(userId, id, statuses, fields, action, authorisedBy = 'MEMBER_CONFIRMATION') {
  const update = { $set: { ...fields, updatedAt: new Date().toISOString() } };
  if (action) update.$push = { audit: { at: new Date().toISOString(), action, authorisedBy } };
  return await (await collection()).findOneAndUpdate({ userId, id, status: { $in: statuses } }, update,
    { returnDocument: 'after', projection: { _id: 0 } }) ?? await getById(userId, id);
}

export async function listByUser(userId) {
  return (await collection()).find({ userId, status: { $nin: ['QUOTED', 'FAILED'] } }, { projection: { _id: 0 } })
    .sort({ createdAt: -1 }).limit(100).toArray();
}

export async function listConfirmedByFlight({ airline, flightNumber }) {
  const records = await (await collection()).find({
    status: 'CONFIRMED',
    sandbox: true,
    'quote.flight.airline': airline,
    'quote.flight.flightNumber': flightNumber,
    orderId: { $type: 'string' },
  }, { projection: { _id: 0 } }).sort({ createdAt: 1 }).limit(1000).toArray();
  return records;
}

export async function _resetForTests() {
  if (config.mongo.dbName !== 'travel_disruption_concierge_test') throw new Error('Test database required');
  await (await collection()).deleteMany({});
}
