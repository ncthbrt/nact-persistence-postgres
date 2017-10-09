const { AbstractPersistenceEngine } = require('nact/lib/extensions/persistence');
const PgRx = require('pg-reactive');
require('rxjs');
const { create } = require('./schema');

class PostgresPersistenceEngine extends AbstractPersistenceEngine {
  constructor (connectionString, settings = { createIfNotExists: true }) {
    super();
    this.db = new PgRx(connectionString);
    this.tablePrefix = settings.tablePrefix;
    if (this.createIfNotExists) {
      this.db.query(create(settings.tablePrefix));
    }
  }

  events (persistenceKey, offset, limit, tags) {
    const query = ` SELECT * from ${this.tablePrefix ? `${this.tablePrefix}_` : ''}event_journal 
                    WHERE persistence_key = $1 
                    AND is_deleted = false
                    ${tags ? 'AND tags @> ($4::text[])' : ''}
                    ORDER BY sequence_nr
                    ${offset ? 'OFFSET $2' : ''}
                    ${limit ? 'LIMIT $3' : ''};
                  `;
    return this.db.query(query, [persistenceKey, offset, limit, tags]);
  }

  persist (persistedEvent) {
    return new Promise((resolve, reject) => {
      const query = ` INSERT INTO ${this.tablePrefix ? `${this.tablePrefix}_` : ''}event_journal (          
          persistence_id,
          sequence_nr,    
          created_at,   
          data,          
          tags          
        )
        VALUES ($1, $2, $3, $4, $5::text[])
      `;
      this.db.query(
        query,
        [persistedEvent.persistenceId,
          persistedEvent.sequenceNumber,
          persistedEvent.createdAt,
          persistedEvent.data,
          persistedEvent.tags
        ]).catch(reject).subscribe(resolve);
    });
  }
}

module.exports.PostgresPersistenceEngine = PostgresPersistenceEngine;
