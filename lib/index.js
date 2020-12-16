const { AbstractPersistenceEngine, PersistedEvent, PersistedSnapshot } = require('nact/lib/persistence');
const pgp = require('pg-promise');
const { v4: uuid } = require('uuid');
const { create } = require('./schema');
const assert = require('assert');

class Result {
  constructor (promise) {
    this.promise = promise;
  }
  then (...args) {
    return this.promise.then(...args);
  }
  reduce (...args) {
    return this.promise.then(result => result.reduce(...args));
  }
}

// class PersistedEvent {
//   constructor (data, sequenceNumber, key, tags = [], createdAt = new Date().getTime(), isDeleted = false, annotations = {}, metadata = {}) {
//     // Tags should be an array of strings
//     if (!tags || !(tags instanceof Array) || !(tags.reduce((isStrArray, tag) => isStrArray && typeof (tag) === 'string', true))) {
//       throw new Error('tags should be a string array');
//     }
//
//     // Sequence number should be a number.
//     // This is an internal error if this is not the case as this is defined by the engine and hence shouldn't
//     // be exposed to users of the framework
//     assert(typeof (sequenceNumber) === 'number');
//
//     this.data = data;
//     this.tags = tags.sort();
//     this.sequenceNumber = sequenceNumber;
//     this.key = key;
//     this.createdAt = createdAt;
//     this.isDeleted = isDeleted;
//     this.annotations = annotations;
//     this.metadata = metadata;
//   }
// }

class PersistedEventEncryption {
  constructor (key, encryption, createdAt, deletedAt, isDeleted) {
    this.key = key;
    this.encryption = encryption;
    this.createdAt = createdAt;
    this.deletedAt = deletedAt;
    this.isDeleted = isDeleted;
  }
}

class PostgresPersistenceEngine extends AbstractPersistenceEngine {
  constructor (connectionStringOrConnection, {createIfNotExists = true, tablePrefix = '', schema = null, eventTable = 'event_journal', snapshotTable = 'snapshot_store'} = {}) {
    super();
    this.tablePrefix = tablePrefix;
    this.schema = schema;
    this.eventTable = eventTable;
    this.snapshotTable = snapshotTable;
    this.db = (async () => {
      let db = connectionStringOrConnection;
      if (typeof (connectionStringOrConnection) === 'string') {
        db = pgp()(connectionStringOrConnection);
      }
      if (createIfNotExists) {
        await db.none(create(tablePrefix, schema, eventTable, snapshotTable)).catch(console.error);
      }
      return db;
    })();
  }

  static mapDbModelToDomainModel (dbEvent) {
    return new PersistedEvent(
      dbEvent.data,
      Number.parseInt(dbEvent.sequence_nr),
      dbEvent.persistence_key,
      dbEvent.tags,
      Number.parseInt(dbEvent.created_at),
      !!dbEvent.is_deleted,
      dbEvent.annotations,
      dbEvent.metadata
    );
  }

  static mapDbModelToDomainModelEncryption (dbEncryption) {
    return new PersistedEventEncryption(
      dbEncryption.key,
      dbEncryption.encryption,
      Number.parseInt(dbEncryption.created_at),
      Number.parseInt(dbEncryption.deleted_at),
      !!dbEncryption.is_deleted
    );
  }

  static mapDbModelToSnapshotDomainModel (dbSnapshot) {
    if (dbSnapshot) {
      return new PersistedSnapshot(
        dbSnapshot.data,
        Number.parseInt(dbSnapshot.sequence_nr),
        dbSnapshot.persistence_key,
        Number.parseInt(dbSnapshot.created_at)
      );
    }
  }

  events (persistenceKey, offset = 0, limit = null, tags) {
    assert(typeof (persistenceKey) === 'string');
    assert(Number.isInteger(offset));
    assert(Number.isInteger(limit) || limit === null);
    assert(tags === undefined || (tags instanceof Array && tags.reduce((isStrArr, curr) => isStrArr && typeof (curr) === 'string', true)));

    const query = `
      SELECT
        vals.ordering, vals.persistence_key, vals.sequence_nr, vals.created_at, vals.metadata, vals.annotations, vals.is_deleted, vals.tags,
        decrypt_${this.tablePrefix}${this.eventTable}(vals.data, vals.annotations, enc.encryption_key, enc.is_deleted) AS data
      FROM ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable} vals
        LEFT OUTER JOIN
          (SELECT
            persistence_key,
            encryption_key,
            is_deleted
          FROM
            ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}_encryption
          ) AS enc
          ON enc.persistence_key = vals.persistence_key
      WHERE
        vals.persistence_key = $1 AND vals.sequence_nr > $2
      ${tags ? 'AND vals.tags @> ($4::text[])' : ''}
      ORDER BY vals.sequence_nr
      LIMIT $3
    `;

    const args = [persistenceKey, offset, limit, tags].filter(x => x !== undefined);
    const result = this.db.then(db => db.any(query, args)).then(results => results.map(PostgresPersistenceEngine.mapDbModelToDomainModel));
    return new Result(result);
  }

  async persist (persistedEvent, annotations = {}, metadata = {}) {
    const query = `
      INSERT INTO ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable} (
        persistence_key,
        sequence_nr,
        created_at,
        data,
        metadata,
        annotations,
        tags
      ) VALUES ($/key/, $/sequenceNumber/, $/createdAt/, $/data:json/, $/metadata:json/, $/annotations:json/, $/tags/)
      RETURNING ordering;
    `;
    return (await this.db).one(
      query, {
        key: persistedEvent.key,
        sequenceNumber: persistedEvent.sequenceNumber,
        createdAt: persistedEvent.createdAt,
        data: persistedEvent.data,
        metadata: metadata,
        annotations: annotations,
        tags: persistedEvent.tags
      }
    );
  }

  async persistEncryption (persistedEncryption) {
    const query = `
      INSERT INTO ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}_encryption (
        persistence_key,
        encryption_key,
        created_at
      ) VALUES ($/key/, $/encryption/, $/createdAt/)
      RETURNING encryption_key;
    `;
    return (await this.db).one(
      query, {
        key: persistedEncryption.key,
        encryption: persistedEncryption.encryption,
        createdAt: persistedEncryption.createdAt
      }
    );
  }

  async scrambleEncryption (persistedEncryption) {
    // Set a new encryption key or generate a new one
    persistedEncryption.encryption = persistedEncryption.encryption || uuid();

    const query = `
      UPDATE ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}_encryption
      SET (
        encryption_key,
        deleted_at,
        is_deleted
      ) VALUES ($/encryption/, $/deletedAt/, $/isDeleted/)
      WHERE persistence_key = $/key/
      RETURNING encryption_key;
    `;
    return (await this.db).one(
      query, {
        key: persistedEncryption.key,
        encryption: persistedEncryption.encryption,
        deletedAt: persistedEncryption.deletedAt,
        isDeleted: true
      }
    );
  }

  async latestEncryption (persistenceKey) {
    assert(typeof (persistenceKey) === 'string');

    const query = `
      SELECT * from ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}_encryption
      WHERE persistence_key = $1
      LIMIT 1
    `;

    return (await this.db).oneOrNone(query, [persistenceKey]).then(PostgresPersistenceEngine.mapDbModelToDomainModelEncryption);
  }

  async latestSnapshot (persistenceKey) {
    assert(typeof (persistenceKey) === 'string');

    const query = `
     SELECT
       vals.ordering, vals.persistence_key, vals.sequence_nr, vals.created_at, evn.metadata, evn.annotations, vals.is_deleted,
       decrypt_${this.tablePrefix}${this.eventTable}(vals.data, evn.annotations, enc.encryption_key, enc.is_deleted) AS data
     FROM ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.snapshotTable} vals
      LEFT OUTER JOIN
        (SELECT
          persistence_key,
          sequence_nr,
          annotations,
          metadata
        FROM
          ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}
        ) AS evn
      ON evn.persistence_key = vals.persistence_key AND evn.sequence_nr = vals.sequence_nr
      LEFT OUTER JOIN
        (SELECT
          persistence_key,
          encryption_key,
          is_deleted
        FROM
          ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.eventTable}_encryption
        ) AS enc
      ON enc.persistence_key = vals.persistence_key
    WHERE
      vals.persistence_key = $1 AND vals.is_deleted = false
    ORDER BY sequence_nr DESC
    LIMIT 1
  `;

    return (await this.db).oneOrNone(query, [persistenceKey]).then(PostgresPersistenceEngine.mapDbModelToSnapshotDomainModel);
  }

  async takeSnapshot (persistedSnapshot) {
    const query = ` INSERT INTO ${this.schema ? this.schema + '.' : ''}${this.tablePrefix}${this.snapshotTable} (
          persistence_key,
          sequence_nr,
          created_at,
          data
        )
        VALUES ($1, $2, $3, $4:json)
        RETURNING ordering;
      `;
    return (await this.db).one(
      query, [
        persistedSnapshot.key,
        persistedSnapshot.sequenceNumber,
        persistedSnapshot.createdAt,
        persistedSnapshot.data
      ]
    );
  }
}

module.exports.PostgresPersistenceEngine = PostgresPersistenceEngine;
