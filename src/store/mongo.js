import { MongoClient } from 'mongodb';
import { config } from '../config.js';

let client = null;
let db = null;

export async function getDb() {
  if (db) return db;
  client = new MongoClient(config.mongo.uri);
  await client.connect();
  db = client.db(config.mongo.dbName);
  return db;
}

export async function closeMongo() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
