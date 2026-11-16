import { describe, expect, it } from 'vitest';

import { adyenRate } from '../src/adyen-fx.js';

// Wall times at a clock change resolve as Temporal's 'compatible' disambiguation: a fold (the
// clocks go back) is the earlier instant, a gap (they go forward) the wall time pushed forward.
const asOf = (created: string, timeZone: string) =>
  adyenRate(
    {
      'Gross Currency': 'USD',
      'Net Currency': 'EUR',
      'Exchange Rate': '0.9',
      'Creation Date': created,
    },
    { timeZone },
  )?.asOf;

describe('Adyen account zones at clock changes', () => {
  it.each([
    ['America/New_York', '2026-03-08 02:30:00', '2026-03-08T07:30:00.000Z'],
    ['America/New_York', '2026-11-01 01:30:00', '2026-11-01T05:30:00.000Z'],
    ['Europe/Berlin', '2026-03-29 02:30:00', '2026-03-29T01:30:00.000Z'],
    ['Europe/Berlin', '2026-10-25 02:30:00', '2026-10-25T00:30:00.000Z'],
    ['Europe/London', '2026-03-29 01:30:00', '2026-03-29T01:30:00.000Z'],
    ['Europe/London', '2026-10-25 01:30:00', '2026-10-25T00:30:00.000Z'],
  ])('%s %s (a gap, then a fold)', (zone, created, expected) => {
    expect(asOf(created, zone)).toBe(expected);
  });

  // The wall times whose instant changed with 'compatible' (the earlier reading of a fold east of
  // UTC, and the later reading of a gap west of it, were taken before).
  it.each([
    ['Europe/Amsterdam', '2026-10-25 02:30:00', '2026-10-25T00:30:00.000Z'],
    ['America/New_York', '2026-03-08 02:30:00', '2026-03-08T07:30:00.000Z'],
    ['America/Los_Angeles', '2026-03-08 02:30:00', '2026-03-08T10:30:00.000Z'],
    ['Australia/Sydney', '2026-04-05 02:30:00', '2026-04-04T15:30:00.000Z'],
    ['Australia/Lord_Howe', '2026-04-05 01:45:00', '2026-04-04T14:45:00.000Z'],
    ['Pacific/Chatham', '2026-04-05 03:15:00', '2026-04-04T13:30:00.000Z'],
    ['America/Santiago', '2026-09-06 00:30:00', '2026-09-06T04:30:00.000Z'],
    ['Europe/London', '2026-10-25 01:30:00', '2026-10-25T00:30:00.000Z'],
    ['America/Sao_Paulo', '2018-11-04 00:30:00', '2018-11-04T03:30:00.000Z'],
  ])('%s %s', (zone, created, expected) => {
    expect(asOf(created, zone)).toBe(expected);
  });

  it('leaves other wall times and numeric offsets as they were', () => {
    expect(asOf('2026-07-06 12:00:00', 'America/New_York')).toBe('2026-07-06T16:00:00.000Z');
    // the day of a change, away from it
    expect(asOf('2026-03-08 12:00:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z');
    expect(asOf('2026-10-25 03:30:00', 'Europe/Amsterdam')).toBe('2026-10-25T02:30:00.000Z');
    expect(
      adyenRate({
        'Gross Currency': 'USD',
        'Net Currency': 'EUR',
        'Exchange Rate': '0.9',
        'Creation Date': '2026-10-25 02:30:00',
        TimeZone: '+01:00',
      })?.asOf,
    ).toBe('2026-10-25T01:30:00.000Z');
  });
});
