import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMockHotels } from '../src/mock/hotels.js';

test('every hotel has the required fields, is tagged mock, and has a valid price', () => {
  const hotels = searchMockHotels({ destination: 'SFO', checkIn: '2026-09-01', checkOut: '2026-09-03' });

  assert.ok(hotels.length > 0);
  for (const hotel of hotels) {
    assert.equal(hotel.mock, true);
    assert.ok(hotel.id);
    assert.ok(hotel.name.includes('SFO'));
    assert.equal(hotel.checkIn, '2026-09-01');
    assert.equal(hotel.checkOut, '2026-09-03');
    assert.equal(typeof hotel.pricePerNight.amount, 'number');
    assert.ok(!Number.isNaN(hotel.pricePerNight.amount));
    assert.ok(hotel.rating >= 0 && hotel.rating <= 5);
  }
});

test('ids are unique and stable for repeated calls with the same destination', () => {
  const a = searchMockHotels({ destination: 'SFO' });
  const b = searchMockHotels({ destination: 'SFO' });

  assert.deepEqual(a.map((h) => h.id), b.map((h) => h.id));
  assert.equal(new Set(a.map((h) => h.id)).size, a.length);
});
