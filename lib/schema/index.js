module.exports.create = (tablePrefix = '') => `
  CREATE TABLE IF NOT EXISTS ${tablePrefix}event_journal (
    ordering BIGSERIAL NOT NULL PRIMARY KEY,
    persistence_key VARCHAR(255) NOT NULL,
    sequence_nr BIGINT NOT NULL,    
    created_at BIGINT NOT NULL,   
    data JSONB NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,    
    tags TEXT ARRAY DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT event_journal_uq UNIQUE (persistence_key, sequence_nr)
  );  
  CREATE TABLE IF NOT EXISTS ${tablePrefix}snapshot_store (
    ordering BIGSERIAL NOT NULL PRIMARY KEY,
    persistence_key VARCHAR(255) NOT NULL,
    sequence_nr BIGINT NOT NULL,    
    created_at BIGINT NOT NULL,   
    data JSONB NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE    
  );  
  `;

module.exports.destroy = (tablePrefix = '') => `DROP TABLE IF EXISTS ${tablePrefix}event_journal CASCADE; 
DROP TABLE IF EXISTS ${tablePrefix}snapshot_store CASCADE;`;
