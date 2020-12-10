module.exports.create = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const schemaQuery = `
    CREATE SCHEMA IF NOT EXISTS ${schema};
  `;

  const eventTableQuery = `
    CREATE TABLE IF NOT EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${eventTable} (
      ordering BIGSERIAL NOT NULL PRIMARY KEY,
      persistence_key VARCHAR(255) NOT NULL,
      sequence_nr BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      data JSONB NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      tags TEXT ARRAY DEFAULT ARRAY[]::TEXT[],
      CONSTRAINT ${tablePrefix}event_journal_uq UNIQUE (persistence_key, sequence_nr)
    );
  `;

  const snapshotTableQuery = `
    CREATE TABLE IF NOT EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable} (
      ordering BIGSERIAL NOT NULL PRIMARY KEY,
      persistence_key VARCHAR(255) NOT NULL,
      sequence_nr BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      data JSONB NOT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  return [schema ? schemaQuery : null, eventTableQuery, snapshotTableQuery].filter(n => n).join('\n');
};

module.exports.destroy = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const schemaQuery = `
    DROP SCHEMA IF EXISTS ${schema} CASCADE;
  `;

  const eventTableQuery = `
    DROP TABLE IF EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${eventTable} CASCADE;
  `;

  const snapshotTableQuery = `
    DROP TABLE IF EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable} CASCADE;
  `;

  // IF the schema is dropped cascade, then it will by default also drop the tables on the schema
  return [schema ? schemaQuery : null, eventTableQuery, snapshotTableQuery].filter(n => n).join('\n');
};
