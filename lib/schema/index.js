module.exports.create = (tablePrefix) => `
  CREATE TABLE IF NOT EXISTS ${tablePrefix ? `${tablePrefix}_` : ''}event_journal (
    ordering BIGSERIAL NOT NULL PRIMARY KEY,
    persistence_id VARCHAR(255) NOT NULL,
    sequence_nr BIGINT NOT NULL,    
    created_at BIGINT NOT NULL,   
    data JSONB NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,    
    tags TEXT ARRAY DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT event_journal_uq UNIQUE (persistence_id, sequence_nr)
  );  
  `;

module.exports.destroy = (tablePrefix) => `DROP TABLE ${tablePrefix ? `${tablePrefix}_` : ''}event_journal CASCADE;`;
