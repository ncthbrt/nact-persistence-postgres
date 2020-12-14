module.exports.create = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const crypto = `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `;

  const triggerGenFunctionQuery = `
    CREATE OR REPLACE FUNCTION generate_${tablePrefix}${eventTable}_encryption()
      RETURNS TRIGGER
      LANGUAGE PLPGSQL

      AS

      $$
      BEGIN
        IF NEW.sequence_nr = 1 THEN
          INSERT INTO ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption (
            persistence_key,
            encryption_key,
            created_at
          ) VALUES (
            NEW.persistence_key,
            MD5(random()::text),
            NEW.created_at
          );
        END IF;
        RETURN NEW;
      END;
      $$;
  `;

  const triggerEncryptFunctionQuery = `
    CREATE OR REPLACE FUNCTION encrypt_${tablePrefix}${eventTable}()
      RETURNS TRIGGER
      LANGUAGE PLPGSQL

      AS

      $$
      BEGIN
        RETURN NEW;
      END;
      $$;
  `;

  const triggerGenEncryptQuery = `
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${eventTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};

    CREATE TRIGGER generate_${tablePrefix}${eventTable}_encryption
    BEFORE INSERT ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}
    FOR EACH ROW
    EXECUTE PROCEDURE generate_${tablePrefix}${eventTable}_encryption();
  `;

  const triggerEncryptQuery = `
    DROP TRIGGER IF EXISTS encrypt_${tablePrefix}${eventTable} ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};

    CREATE TRIGGER encrypt_${tablePrefix}${eventTable}
    BEFORE INSERT ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}
    FOR EACH ROW
    EXECUTE PROCEDURE encrypt_${tablePrefix}${eventTable}();
  `;

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
      metadata JSONB DEFAULT '{}'::jsonb,
      annotations JSONB DEFAULT '{}'::jsonb,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      tags TEXT ARRAY DEFAULT ARRAY[]::TEXT[],
      CONSTRAINT ${tablePrefix}${eventTable}_uq UNIQUE (persistence_key, sequence_nr)
    );
  `;

  const eventTableEncryptionQuery = `
    CREATE TABLE IF NOT EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption (
      persistence_key VARCHAR(255) NOT NULL,
      encryption_key VARCHAR(255) NOT NULL,
      created_at BIGINT NOT NULL,
      deleted_at BIGINT,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      tags TEXT ARRAY DEFAULT ARRAY[]::TEXT[],
      CONSTRAINT ${tablePrefix}${eventTable}_encryption_uq UNIQUE (persistence_key)
    );
  `;

  const snapshotTableQuery = `
    CREATE TABLE IF NOT EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable} (
      ordering BIGSERIAL NOT NULL PRIMARY KEY,
      persistence_key VARCHAR(255) NOT NULL,
      sequence_nr BIGINT NOT NULL,
      created_at BIGINT NOT NULL,
      data JSONB NOT NULL,
      metadata JSONB DEFAULT '{}'::jsonb,
      annotations JSONB DEFAULT '{}'::jsonb,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  return [
    schema ? schemaQuery : null,
    crypto,
    eventTableQuery,
    eventTableEncryptionQuery,
    snapshotTableQuery,
    triggerGenFunctionQuery,
    triggerGenEncryptQuery,
    triggerEncryptFunctionQuery,
    triggerEncryptQuery
  ].filter(n => n).join('\n');
};

module.exports.destroy = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const schemaQuery = `
    DROP SCHEMA IF EXISTS ${schema} CASCADE;
  `;

  const triggerQuery = `
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${eventTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};
  `;
  const triggerEncryptQuery = `
    DROP TRIGGER IF EXISTS encrypt_${tablePrefix}${eventTable} ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};
  `;

  const eventTableQuery = `
    DROP TABLE IF EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${eventTable} CASCADE;
  `;

  const eventTableEncryptionQuery = `
    DROP TABLE IF EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption CASCADE;
  `;

  const snapshotTableQuery = `
    DROP TABLE IF EXISTS ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable} CASCADE;
  `;

  // IF the schema is dropped cascade, then it will by default also drop the tables on the schema
  return [
    schema ? schemaQuery : null,
    triggerQuery,
    triggerEncryptQuery,
    eventTableQuery,
    eventTableEncryptionQuery,
    snapshotTableQuery
  ].filter(n => n).join('\n');
};
