// The TypeORM transformers against real Postgres and MySQL, when DUCAT_PG_URL and DUCAT_MYSQL_URL
// are set (CI runs both as service containers). test/typeorm.test.ts runs the same scenario on
// SQLite.
import { describe, expect, it } from 'vitest';
import { typeormScenario } from '../typeorm-scenario.js';

const pgUrl = process.env.DUCAT_PG_URL;
const mysqlUrl = process.env.DUCAT_MYSQL_URL;
const isDatabaseRequired = process.env.DUCAT_REQUIRE_DB === '1';

describe('TypeORM database configuration', () => {
  it.skipIf((Boolean(pgUrl) && Boolean(mysqlUrl)) || !isDatabaseRequired)('has both URLs', () => {
    expect([pgUrl, mysqlUrl]).not.toContain(undefined);
  });
});

// TypeORM's defaults: node-postgres returns int8 and numeric as strings and parses jsonb
typeormScenario('Postgres (node-postgres)', Boolean(pgUrl), 'postgres', () => ({
  type: 'postgres',
  url: pgUrl!,
}));

// TypeORM's defaults for mysql2: supportBigNumbers and bigNumberStrings, so BIGINT and DECIMAL
// come back as strings
typeormScenario('MySQL (mysql2)', Boolean(mysqlUrl), 'mysql', () => ({
  type: 'mysql',
  url: mysqlUrl!,
}));
