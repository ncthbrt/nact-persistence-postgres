const { AbstractPersistenceEngine, PersistedEvent, PersistedSnapshot } = require('nact/lib/persistence');
const pgp = require('pg-promise')();
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

class PostgresPersistenceEngine extends AbstractPersistenceEngine {
  constructor (connectionString, {createIfNotExists = true, tablePrefix = ''} = {}) {
    super();
    this.tablePrefix = tablePrefix;
    this.db = (async () => {
      let db = pgp(connectionString);
      if (createIfNotExists) {
        await db.none(create(tablePrefix)).catch(console.error);
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
      !!dbEvent.is_deleted
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

    const query = ` SELECT * from ${this.tablePrefix}event_journal
                    WHERE persistence_key = $1 AND sequence_nr > $2                    
                    ${tags ? 'AND tags @> ($4::text[])' : ''}
                    ORDER BY sequence_nr                    
                    LIMIT $3
                  `;

    const args = [persistenceKey, offset, limit, tags].filter(x => x !== undefined);
    const result = this.db.then(db => db.any(query, args)).then(results => results.map(PostgresPersistenceEngine.mapDbModelToDomainModel));
    return new Result(result);
  }

  async persist (persistedEvent) {
    const query = `
      INSERT INTO ${this.tablePrefix}event_journal (
        persistence_key,
        sequence_nr,
        created_at,
        data,
        tags
      ) VALUES ($/key/, $/sequenceNumber/, $/createdAt/, $/data:json/, $/tags/)
      RETURNING ordering;
    `;
    return (await this.db).one(
      query, {
        key: persistedEvent.key,
        sequenceNumber: persistedEvent.sequenceNumber,
        createdAt: persistedEvent.createdAt,
        data: persistedEvent.data,
        tags: persistedEvent.tags
      }
    );
  }

  async latestSnapshot (persistenceKey) {
    assert(typeof (persistenceKey) === 'string');

    const query = ` SELECT * from ${this.tablePrefix}snapshot_store
    WHERE persistence_key = $1
    AND is_deleted = false
    ORDER BY sequence_nr DESC
    LIMIT 1
  `;

    return (await this.db).oneOrNone(query, [persistenceKey]).then(PostgresPersistenceEngine.mapDbModelToSnapshotDomainModel);
  }

  async takeSnapshot (persistedSnapshot) {
    const query = ` INSERT INTO ${this.tablePrefix}snapshot_store (
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
