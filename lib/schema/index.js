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

      DECLARE encryption_key UUID;

      BEGIN
        IF NEW.sequence_nr = 1 THEN

          encryption_key := MD5(random()::text)::uuid;

          INSERT INTO ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption (
            persistence_key,
            encryption_key,
            created_at
          ) VALUES (
            NEW.persistence_key,
            encryption_key,
            NEW.created_at
          );

        ELSE

          encryption_key := (
            SELECT e.encryption_key FROM ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption e
            WHERE e.persistence_key = NEW.persistence_key
            LIMIT 1
          );

        END IF;

        NEW.data := encrypt_${tablePrefix}${eventTable}(NEW.data, NEW.annotations, encryption_key);

        RETURN NEW;
      END;
      $$;
  `;

  const triggerEncryptFunctionQuery = `
    CREATE OR REPLACE FUNCTION encrypt_${tablePrefix}${eventTable}(data jsonb, annotations jsonb, encryption_key uuid)
      RETURNS JSONB
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        encrypting jsonb;
        _key       text;
        _value     text;

      /*
        encrypting each data key eg: { "my_key": "jsonb", "my_nested.key": "text" }
      */

      BEGIN

        encrypting := COALESCE(
          CASE
            WHEN (annotations #> '{encrypt}') IS NULL then NULL
            ELSE (annotations #> '{encrypt}')
          END,
          '{}'::jsonb
        );

        FOR _key, _value IN
            SELECT * FROM jsonb_each_text(encrypting)
        LOOP
           -- data[_key] = pgp_sym_encrypt(data[_key], encryption_key, 'compress-algo=1, cipher-algo=aes256')::text
        END LOOP;

        RETURN data;
      END;
      $$;
  `;

  const triggerDecryptFunctionQuery = `
    CREATE OR REPLACE FUNCTION decrypt_${tablePrefix}${eventTable}(data jsonb, annotations jsonb, encryption_key uuid)
      RETURNS JSONB
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        decrypting jsonb;
        _key       text;
        _value     text;

      /*
        decrypting each data key and casting back to type eg: { "my_key": "jsonb", "my_nested.key": "text" }
      */

      BEGIN
        decrypting := COALESCE(
          CASE
            WHEN (annotations #> '{encrypt}') IS NULL then NULL
            ELSE (annotations #> '{encrypt}')
          END,
          '{}'::jsonb
        );

        FOR _key, _value IN
            SELECT * FROM jsonb_each_text(decrypting)
        LOOP
           -- data[_key] = pgp_sym_decrypt(data[_key], encryption_key, 'compress-algo=1, cipher-algo=aes256')
        END LOOP;

        RETURN data;
      END;
      $$;
  `;

  const triggerEventGenEncryptQuery = `
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${eventTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};

    CREATE TRIGGER generate_${tablePrefix}${eventTable}_encryption
    BEFORE INSERT ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}
    FOR EACH ROW
    EXECUTE PROCEDURE generate_${tablePrefix}${eventTable}_encryption();
  `;

  const triggerSnapshotGenEncryptQuery = `
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${snapshotTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable};

    CREATE TRIGGER generate_${tablePrefix}${snapshotTable}_encryption
    BEFORE INSERT ON ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable}
    FOR EACH ROW
    EXECUTE PROCEDURE generate_${tablePrefix}${eventTable}_encryption();
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
      encryption_key UUID NOT NULL,
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
    triggerEncryptFunctionQuery,
    triggerDecryptFunctionQuery,
    triggerGenFunctionQuery,
    triggerEventGenEncryptQuery,
    triggerSnapshotGenEncryptQuery
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
    DROP FUNCTION IF EXISTS encrypt_${tablePrefix}${eventTable};
  `;

  const triggerDecryptQuery = `
    DROP FUNCTION IF EXISTS decrypt_${tablePrefix}${eventTable};
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
    triggerDecryptQuery,
    eventTableQuery,
    eventTableEncryptionQuery,
    snapshotTableQuery
  ].filter(n => n).join('\n');
};
