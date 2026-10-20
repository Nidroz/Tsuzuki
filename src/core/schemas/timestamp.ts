// timestamps and calendar days of stored library entries (docs/ARCHITECTURE.md §5). parsed by hand
// with a regex and a utc round trip, never with Date.parse: hermes and v8 read non-standard strings
// differently, and the result must be the same on the device and in jest
import { z } from 'zod';

// an RFC 3339 timestamp with an uppercase T, an optional fraction of 1 to 9 digits and an
// offset: Z, ±HH:MM, ±HHMM or ±HH. groups: year, month, day, hours, minutes, seconds, fraction,
// offset sign, offset hours, offset minutes
const TIMESTAMP_PATTERN =
  /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(?:Z|([+-])([0-9]{2})(?::?([0-9]{2}))?)$/;

const CALENDAR_DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

// the stored years: postgres has no year 0, and Date#toISOString writes a year outside 0..9999
// with a sign prefix and six digits
const YEAR_MIN = 1;
const YEAR_MAX = 9999;

const isStoredYear = (year: number): boolean => year >= YEAR_MIN && year <= YEAR_MAX;

// months of Date count from 0
const MONTH_OFFSET = 1;
const MILLISECOND_DIGITS = 3;
const OFFSET_HOURS_MAX = 23;
const OFFSET_MINUTES_MAX = 59;
const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
const NEGATIVE_OFFSET = '-';

interface DateTimeFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;
}

/**
 * the utc epoch milliseconds of the fields, or null when they are not a real date and time (a
 * 30 February, a 25th hour, a 60th second): Date rolls such fields over, so a field that changed
 * on the way back means the input was not real. setUTCFullYear rather than Date.UTC, which reads
 * the years 0 to 99 as 1900 to 1999.
 */
const utcMillisOf = (fields: DateTimeFields): number | null => {
  const date = new Date(0);
  date.setUTCFullYear(fields.year, fields.month - MONTH_OFFSET, fields.day);
  date.setUTCHours(fields.hours, fields.minutes, fields.seconds, fields.milliseconds);
  const isRoundTrip =
    date.getUTCFullYear() === fields.year &&
    date.getUTCMonth() === fields.month - MONTH_OFFSET &&
    date.getUTCDate() === fields.day &&
    date.getUTCHours() === fields.hours &&
    date.getUTCMinutes() === fields.minutes &&
    date.getUTCSeconds() === fields.seconds;
  return isRoundTrip ? date.getTime() : null;
};

// the offset in minutes east of utc, or null when out of range; Z and -00:00 are utc
const offsetMinutesOf = (
  sign: string | undefined,
  hours: string | undefined,
  minutes: string | undefined,
): number | null => {
  if (sign === undefined || hours === undefined) {
    return 0;
  }
  const offsetHours = Number(hours);
  const offsetMinutes = minutes === undefined ? 0 : Number(minutes);
  if (offsetHours > OFFSET_HOURS_MAX || offsetMinutes > OFFSET_MINUTES_MAX) {
    return null;
  }
  const total = offsetHours * MINUTES_PER_HOUR + offsetMinutes;
  return sign === NEGATIVE_OFFSET ? -total : total;
};

/**
 * `value` in the Date#toISOString form `YYYY-MM-DDTHH:mm:ss.sssZ` when it is an RFC 3339 timestamp
 * with an offset (Z, ±HH:MM, ±HHMM or ±HH; an uppercase T; no fraction or 1 to 9 digits) of a
 * real date and time, else null. the fraction is truncated to milliseconds, never rounded, so two
 * timestamps keep their order or become equal; a utc result whose year is outside 0001..9999 is
 * null (postgres has no year 0).
 */
export const normalizeTimestamp = (value: string): string | null => {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hours, minutes, seconds, fraction, sign, offHours, offMinutes] = match;
  const offset = offsetMinutesOf(sign, offHours, offMinutes);
  if (offset === null) {
    return null;
  }
  const local = utcMillisOf({
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds),
    // whole minutes of offset, so truncating the local fraction truncates the instant
    milliseconds: Number(
      (fraction ?? '').slice(0, MILLISECOND_DIGITS).padEnd(MILLISECOND_DIGITS, '0'),
    ),
  });
  if (local === null) {
    return null;
  }
  const instant = new Date(local - offset * MS_PER_MINUTE);
  return isStoredYear(instant.getUTCFullYear()) ? instant.toISOString() : null;
};

/** whether `value` is a calendar day `YYYY-MM-DD` of a real date, in the years 0001..9999. */
const isCalendarDate = (value: string): boolean => {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const [, year, month, day] = match;
  return (
    isStoredYear(Number(year)) &&
    utcMillisOf({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
    }) !== null
  );
};

const INVALID_TIMESTAMP = 'invalid timestamp';
const INVALID_CALENDAR_DATE = 'invalid calendar date';

/**
 * an RFC 3339 timestamp with an offset, normalized to the Date#toISOString form (see
 * normalizeTimestamp), so normalized timestamps compare as plain strings. issues hold no value.
 */
export const timestampSchema = z.string().transform((value, ctx): string => {
  const normalized = normalizeTimestamp(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: INVALID_TIMESTAMP });
    return z.NEVER;
  }
  return normalized;
});

/**
 * a calendar day `YYYY-MM-DD` of a real date in the years 0001..9999 (postgres has no year 0),
 * kept as is. issues hold no value.
 */
export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, { message: INVALID_CALENDAR_DATE });
