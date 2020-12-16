module.exports.create = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const crypto = `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  `;

  const triggerGenEventFunctionQuery = `
    CREATE OR REPLACE FUNCTION generate_${tablePrefix}${eventTable}_encryption()
      RETURNS TRIGGER
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        encryption_key UUID;

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

        NEW.data := encrypt_${tablePrefix}${eventTable}(NEW.data, NEW.annotations, encryption_key, false);

        RETURN NEW;
      END;
      $$;
  `;

  const triggerGenSnapshotFunctionQuery = `
    CREATE OR REPLACE FUNCTION generate_${tablePrefix}${snapshotTable}_encryption()
      RETURNS TRIGGER
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        encryption_key UUID;
        annotations jsonb;

      BEGIN

        encryption_key := (
          SELECT e.encryption_key FROM ${schema ? schema + '.' : ''}${tablePrefix}${eventTable}_encryption e
          WHERE e.persistence_key = NEW.persistence_key
          LIMIT 1
        );

        annotations := (
          SELECT e.annotations FROM ${schema ? schema + '.' : ''}${tablePrefix}${eventTable} e
          WHERE e.persistence_key = NEW.persistence_key AND e.sequence_nr = NEW.sequence_nr
          LIMIT 1
        );

        NEW.data := encrypt_${tablePrefix}${eventTable}(NEW.data, annotations, encryption_key, false);

        RETURN NEW;
      END;
      $$;
  `;

  const triggerEncryptFunctionQuery = `
    CREATE OR REPLACE FUNCTION encrypt_${tablePrefix}${eventTable}(data jsonb, annotations jsonb, encryption_key uuid, is_deleted boolean)
      RETURNS JSONB
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        encrypting jsonb;
        _key       text;
        _value     text;
        _current   bytea;
        allowed_types CONSTANT text[] := ARRAY[
          ('jsonb'::text),
          ('text'::text),
          ('boolean'::text),
          ('int'::text),
          ('bigint'::text),
          ('numeric'::text),
          ('double precision'::text),
          ('date'::text)
        ];
        default_type CONSTANT text := 'jsonb'::text;

      /*
        encrypting each data key eg: { "my_key": "jsonb", "my_nested.key": "text" }
      */

      BEGIN
        IF is_deleted = false THEN

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
             IF data ? _key AND data ->> _key IS NOT NULL THEN
               _current := pgp_sym_encrypt((data ->> _key)::text, encryption_key::text, 'compress-algo=1, cipher-algo=aes256');

                data := data || jsonb_build_object(_key, _current::text);
               /*
               data := jsonb_set(
                 data,
                 CONCAT('{', _key, '}')::text[],
                 to_jsonb(
                   CASE
                     WHEN _value = 'jsonb' THEN
                       CAST(_current AS text)
                     WHEN _value = 'text' THEN
                       CAST(_current AS text)
                     WHEN _value = 'boolean' THEN
                       CAST(_current AS text)
                     WHEN _value = 'date' THEN
                       CAST(_current AS text)
                     WHEN _value = 'int' THEN
                       CAST(_current AS text)
                     WHEN _value = 'bigint' THEN
                       CAST(_current AS text)
                     WHEN _value = 'numeric' THEN
                       CAST(_current AS text)
                     WHEN _value = 'double precision' THEN
                       CAST(_current AS text)
                     ELSE
                       CAST(_current AS text)
                   END
                 )
               );
               */
             END IF;
          END LOOP;

          /* This could also just encrypt the entire data property, but that is dangerous when a key is scrambled */
          -- data := jsonb_build_object('encrypted', pgp_sym_encrypt(data::text, encryption_key::text, 'compress-algo=1, cipher-algo=aes256')::text);

        END IF;

        RETURN data;
      END;
      $$;
  `;

  const triggerDecryptFunctionQuery = `
    CREATE OR REPLACE FUNCTION decrypt_${tablePrefix}${eventTable}(data jsonb, annotations jsonb, encryption_key uuid, is_deleted boolean)
      RETURNS JSONB
      LANGUAGE PLPGSQL

      AS

      $$

      DECLARE
        decrypting jsonb;
        _key       text;
        _value     text;
        _current   bytea;
        allowed_types CONSTANT text[] := ARRAY[
          ('jsonb'::text),
          ('text'::text),
          ('boolean'::text),
          ('int'::text),
          ('bigint'::text),
          ('numeric'::text),
          ('double precision'::text),
          ('date'::text)
        ];
        default_type CONSTANT text := 'jsonb'::text;

      /*
        decrypting each data key and casting back to type eg: { "my_key": "jsonb", "my_nested.key": "text" }
      */

      BEGIN
        IF is_deleted = false THEN
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
             IF data ? _key AND data ->> _key IS NOT NULL THEN
               _current := pgp_sym_decrypt((data ->> _key)::text::bytea, encryption_key::text, 'compress-algo=1, cipher-algo=aes256');
               data := data || jsonb_build_object(_key, _current::text);

               /* jsonb_set(
                 data,
                 CONCAT('{', _key, '}')::text[],
                 to_jsonb(
                   CASE
                     WHEN _value = 'jsonb' THEN
                       CAST(_current AS text)
                     ELSE
                       CAST(_current AS text)
                   END
                 )
               ); */
             END IF;
          END LOOP;

          /* This could also just decrypt the entire data property, but that is dangerous when a key is scrambled */
          -- data := pgp_sym_decrypt((data ->> 'encrypted')::text::bytea, encryption_key::text, 'compress-algo=1, cipher-algo=aes256')::jsonb;

        END IF;

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
    EXECUTE PROCEDURE generate_${tablePrefix}${snapshotTable}_encryption();
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
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE
    );
  `;

  return [
    // Schemas
    schema ? schemaQuery : null,

    // Plugins
    crypto,

    // Tables
    eventTableQuery,
    eventTableEncryptionQuery,
    snapshotTableQuery,

    // Functions
    triggerEncryptFunctionQuery,
    triggerDecryptFunctionQuery,

    // Event Triggers
    triggerGenEventFunctionQuery,
    triggerEventGenEncryptQuery,

    // Snapshot Triggers
    triggerGenSnapshotFunctionQuery,
    triggerSnapshotGenEncryptQuery
  ].filter(n => n).join('\n');
};

module.exports.destroy = (tablePrefix, schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store') => {
  const schemaQuery = `
    DROP SCHEMA IF EXISTS ${schema} CASCADE;
  `;

  const triggerQuery = `
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${eventTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${eventTable};
    DROP TRIGGER IF EXISTS generate_${tablePrefix}${snapshotTable}_encryption ON ${schema ? schema + '.' : ''}${tablePrefix}${snapshotTable};
    DROP FUNCTION IF EXISTS generate_${tablePrefix}${eventTable}_encryption;
    DROP FUNCTION IF EXISTS generate_${tablePrefix}${snapshotTable}_encryption;
  `;

  const functionEncryptQuery = `
    DROP FUNCTION IF EXISTS encrypt_${tablePrefix}${eventTable};
  `;

  const functionDecryptQuery = `
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
    // Schemas
    schema ? schemaQuery : null,

    // Plugins

    // Triggers
    triggerQuery,
    functionEncryptQuery,
    functionDecryptQuery,

    // Tables
    eventTableQuery,
    eventTableEncryptionQuery,
    snapshotTableQuery
  ].filter(n => n).join('\n');
};
