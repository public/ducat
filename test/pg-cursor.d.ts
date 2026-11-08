// pg-cursor ships no types. The tests only hand the class to Kysely's PostgresDialect, which
// declares the shape it needs, so this is all they use.
declare module 'pg-cursor' {
  import type { PostgresCursorConstructor } from 'kysely';

  const Cursor: PostgresCursorConstructor;
  export default Cursor;
}
