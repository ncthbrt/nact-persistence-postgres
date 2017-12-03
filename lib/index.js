const { AbstractPersistenceEngine, PersistedEvent } = require('nact/lib/persistence');
const PgRx = require('pg-reactive');
const { Promise } = require('bluebird');
require('rxjs');
const { create } = require('./schema');
const assert = require('assert');

class PostgresPersistenceEngine extends AbstractPersistenceEngine {
  constructor (connectionString, { createIfNotExists = true, tablePrefix = '', ...settings } = {}) {
    super();
    this.db = new PgRx(connectionString);
    this.tablePrefix = tablePrefix;
    if (createIfNotExists) {
      this.db.query(create(settings.tablePrefix)).catch(console.error).subscribe();
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

  static mapDbModelToSnapshotDomainModel (dbEvent) {
    return new PersistedEvent(
      dbEvent.data,
      Number.parseInt(dbEvent.sequence_nr),
      dbEvent.persistence_key,
      dbEvent.tags,
      Number.parseInt(dbEvent.created_at)
    );
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

    return this.db.query(query, args)
      .retry(5)
      .map(PostgresPersistenceEngine.mapDbModelToDomainModel);
  }

  persist (persistedEvent) {
    assert(persistedEvent instanceof PersistedEvent);

    return new Promise((resolve, reject) => {
      const query = ` INSERT INTO ${this.tablePrefix}event_journal (          
          persistence_key,
          sequence_nr,    
          created_at,   
          data,          
          tags          
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ordering;
      `;
      this.db.query(
        query,
        [persistedEvent.key,
          persistedEvent.sequenceNumber,
          persistedEvent.createdAt,
          persistedEvent.data,
          persistedEvent.tags
        ]).catch(e => { reject(e); return e; }).subscribe(resolve);
    });
  }

  latestSnapshot (persistenceKey) {
    assert(typeof (persistenceKey) === 'string');

    const query = ` SELECT * from ${this.tablePrefix}snapshot_store 
    WHERE persistence_key = $1
    AND is_deleted = false   
    ORDER BY sequence_nr DESC    
    LIMIT 1
  `;

    return this.db.query(query, [persistenceKey]).retry(5).map(PostgresPersistenceEngine.mapDbModelToDomainModel);
  }

  takeSnapshot (persistedSnapshot) {
    throw new Error('#takeSnapshot() is yet implemented');
  }
}

module.exports.PostgresPersistenceEngine = PostgresPersistenceEngine;
