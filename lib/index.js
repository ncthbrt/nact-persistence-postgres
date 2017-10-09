const { AbstractPersistenceEngine, PersistedEvent } = require('nact/lib/extensions/persistence');
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
      this.db.query(create(settings.tablePrefix)).catch(console.error).subscribe(x => console.log('created'));
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

  events (persistenceKey, offset, limit, tags) {
    const query = ` SELECT * from ${this.tablePrefix}event_journal 
                    WHERE persistence_key = $1 
                    AND is_deleted = false
                    ${tags ? 'AND tags @> ($4::text[])' : ''}
                    ORDER BY sequence_nr
                    ${offset ? 'OFFSET $2' : ''}
                    ${limit ? 'LIMIT $3' : ''};
                  `;
    const args = [persistenceKey, offset, limit, tags].filter(x => !!x);
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
        [ persistedEvent.key,
          persistedEvent.sequenceNumber,
          persistedEvent.createdAt,
          persistedEvent.data,
          persistedEvent.tags
        ]).catch(e => { reject(e); return e; }).subscribe(resolve);
    });
  }
}

module.exports.PostgresPersistenceEngine = PostgresPersistenceEngine;
