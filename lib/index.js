const { AbstractPersistenceEngine, PersistedEvent, PersistedSnapshot } = require('nact/lib/persistence');
require('rxjs');
const pgp = require('pg-promise')();
const Rx = require('rxjs');
const { create } = require('./schema');
const assert = require('assert');

class PostgresPersistenceEngine extends AbstractPersistenceEngine {
  constructor (connectionString, { createIfNotExists = true, tablePrefix = '', ...settings } = {}) {
    super();
    this.db = pgp(connectionString);
    this.tablePrefix = tablePrefix;
    if (createIfNotExists) {
      this.db.none(create(settings.tablePrefix)).catch(console.error);
    }
  }

  static mapDbModelToDomainModel (dbEvent) {
    return new PersistedEvent(
      dbEvent.data,
      Number.parseInt(dbEvent.sequence_nr),
      dbEvent.persistence_key,
      dbEvent.tags,
      Number.parseInt(dbEvent.created_at)
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
                    WHERE persistence_key = $1
                    AND is_deleted = false
                    ${tags ? 'AND tags @> ($4::text[])' : ''}
                    ORDER BY sequence_nr
                    OFFSET $2
                    LIMIT $3
                  `;

    const args = [persistenceKey, offset, limit, tags].filter(x => x !== undefined);

    return Rx.Observable
      .of([1])
      // Perform query
      .mergeMap((_) => this.db.any(query, args))
      // Retry the query if it fails
      .retry(5)
      // Flatten array so that it is returned as a stream of events
      .mergeMap(x => x)
      .map(PostgresPersistenceEngine.mapDbModelToDomainModel);
  }

  persist (persistedEvent) {
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
    return this.db.one(
      query, {
        key: persistedEvent.key,
        sequenceNumber: persistedEvent.sequenceNumber,
        createdAt: persistedEvent.createdAt,
        data: persistedEvent.data,
        tags: persistedEvent.tags
      }
    );
  }

  latestSnapshot (persistenceKey) {
    assert(typeof (persistenceKey) === 'string');

    const query = ` SELECT * from ${this.tablePrefix}snapshot_store 
    WHERE persistence_key = $1
    AND is_deleted = false   
    ORDER BY sequence_nr DESC    
    LIMIT 1
  `;

    return this.db.oneOrNone(query, [persistenceKey]).then(PostgresPersistenceEngine.mapDbModelToSnapshotDomainModel);
  }

  takeSnapshot (persistedSnapshot) {
    const query = ` INSERT INTO ${this.tablePrefix}snapshot_store (          
          persistence_key,
          sequence_nr,    
          created_at,   
          data
        )
        VALUES ($1, $2, $3, $4)
        RETURNING ordering;
      `;
    return this.db.one(
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
