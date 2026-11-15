import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spreadTimes } from '../engine/schedule.mjs';

const D = '2026-11-20';
const times = (r) => r.map((x) => x.time);
const dates = (r) => r.map((x) => x.date);

test('one post goes to the middle of the window', () => {
  assert.deepEqual(spreadTimes(1, { date: D }), [{ date: D, time: '15:00' }]);
});

test('three posts: both ends and the middle', () => {
  assert.deepEqual(spreadTimes(3, { date: D }), [
    { date: D, time: '09:00' },
    { date: D, time: '15:00' },
    { date: D, time: '21:00' },
  ]);
});

test('two posts sit on the window ends', () => {
  assert.deepEqual(times(spreadTimes(2, { date: D })), ['09:00', '21:00']);
});

test('times are rounded to 5 minutes', () => {
  // 8 posts over 720 min are 102.857 min apart, so the raw times are off the 5-minute grid
  const r = spreadTimes(8, { date: D });
  assert.equal(r.length, 8);
  for (const { time } of r) assert.equal(Number(time.slice(3)) % 5, 0);
  assert.equal(r[0].time, '09:00');
  assert.equal(r[7].time, '21:00');
});

test('a custom window is respected', () => {
  assert.deepEqual(times(spreadTimes(3, { date: D, from: '10:00', to: '12:00' })), ['10:00', '11:00', '12:00']);
  assert.deepEqual(times(spreadTimes(1, { date: D, from: '10:00', to: '12:00' })), ['11:00']);
});

test('25 posts fit one 12 h day, 30 minutes apart', () => {
  const r = spreadTimes(25, { date: D });
  assert.equal(new Set(dates(r)).size, 1);
  assert.equal(r[0].time, '09:00');
  assert.equal(r[1].time, '09:30');
  assert.equal(r[24].time, '21:00');
});

test('n=30 spills: 25 on the first day, 5 on the next, same window', () => {
  const r = spreadTimes(30, { date: D });
  assert.equal(r.length, 30);
  assert.equal(dates(r).filter((d) => d === D).length, 25);
  assert.equal(dates(r).filter((d) => d === '2026-11-21').length, 5);
  assert.deepEqual(times(r.slice(25)), ['09:00', '12:00', '15:00', '18:00', '21:00']);
});

test('spill respects a narrow window: 3 h gives 7 per day', () => {
  const r = spreadTimes(10, { date: D, from: '09:00', to: '12:00' });
  assert.equal(dates(r).filter((d) => d === D).length, 7);
  assert.equal(dates(r).filter((d) => d === '2026-11-21').length, 3);
});

test('no two posts on one day are under 30 minutes apart', () => {
  const r = spreadTimes(80, { date: D });
  const byDay = new Map();
  for (const { date, time } of r) {
    const m = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    byDay.set(date, [...(byDay.get(date) ?? []), m]);
  }
  for (const ms of byDay.values()) for (let i = 1; i < ms.length; i++) assert.ok(ms[i] - ms[i - 1] >= 30);
});

test('spill rolls over month and year ends', () => {
  assert.equal(spreadTimes(26, { date: '2026-11-30' })[25].date, '2026-12-01');
  assert.equal(spreadTimes(26, { date: '2026-12-31' })[25].date, '2027-01-01');
  assert.equal(spreadTimes(26, { date: '2028-02-28' })[25].date, '2028-02-29');
  assert.equal(spreadTimes(26, { date: '2027-02-28' })[25].date, '2027-03-01');
});

test('rounding never overshoots a window end that is off the 5-minute grid', () => {
  assert.deepEqual(times(spreadTimes(2, { date: D, from: '09:00', to: '10:03' })), ['09:00', '10:00']);
});

test('n <= 0 gives an empty list', () => {
  assert.deepEqual(spreadTimes(0, { date: D }), []);
  assert.deepEqual(spreadTimes(-3, { date: D }), []);
});

test('bad dates and times throw', () => {
  for (const date of ['2026-13-01', '2026-02-30', '26-11-20', '2026-11-2', 'tomorrow', '', undefined, 20261120]) {
    assert.throws(() => spreadTimes(1, { date }), /date/, String(date));
  }
  for (const from of ['9:00', '25:00', '09:60', 'noon', '']) {
    assert.throws(() => spreadTimes(1, { date: D, from }), /time/, String(from));
  }
  assert.throws(() => spreadTimes(1, { date: D, to: '24:00' }), /time/);
  assert.throws(() => spreadTimes(1, { date: D, from: '21:00', to: '09:00' }), /before/);
  assert.throws(() => spreadTimes(1), /date/);
});

test('a non-integer or non-numeric n throws', () => {
  assert.throws(() => spreadTimes(1.5, { date: D }), /integer/);
  assert.throws(() => spreadTimes('3', { date: D }), /integer/);
  assert.throws(() => spreadTimes(NaN, { date: D }), /integer/);
});
