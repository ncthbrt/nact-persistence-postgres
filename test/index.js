/* eslint-env mocha */
/* eslint-disable no-unused-expressions */
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
chai.should();
const { PostgresPersistenceEngine } = require('../lib');

describe('PostgresPersistenceEngine', function () {
  beforeEach(() => {

  });
  it('should allow only valid connection strings', function () {
    const engine = new PostgresPersistenceEngine('postgres://root_user:testpassword@localhost:5431/test_db');
    console.log(engine);
  });
});
