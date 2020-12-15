![NAct Logo](https://raw.githubusercontent.com/ncthbrt/nact/master/assets/logo.svg?sanitize=true)

# NAct Postgres Encryption
A postgres persistence plugin for NAct that allows for encrypting fields on a per persisted record type basis. This allows for security and compliance in Event Sourced systems.

> NOTE: This is Community Plugin and not officially supported by the Nact maintainers.

## Usage
When persisting an event, pass an `annotations` parameter with at least the key `encrypt` to aes-256 encrypt the value of the property.

```
persist(msg, {
  annotations: {
    "encrypt": {
      "my_obj_prop": "jsonb",
      "my_nested_obj_prop.my_obj_prop": "jsonb",
      "my_array_prop": "jsonb",
      "my_string_prop": "text",
      "my_int_prop": "int",
      "my_float_prop": "double"
    }
  }
})
```

The result will look similar to this:

```
  data: {
    {
      "my_not_encrypted_prop": "Hello World",
      "my_obj_prop": "\\xc30d04090302e305761f7309aaa67fd240012c6396acd2b7cfa9d559db640559711f72bdce19dbb9fe9545eebb8f32612929d7765e2dfee91655ad87e73d25ee1c9e43cb92f7e356061d9a798ae3bc8987"}
  }
``` 

Then, if the need to ever scramble the encryption key (Effectively "Forget" a value), call the `scrambleEncryption` function.  This will rotate the encryption key and make the property value unrecoverable. When the aggregated state is rebuilt, the scrambled value will be present while keeping the event journal intact.

Additionally, this plugin adds a `metadata` column, so that environment specific variables for an event/snapshot can be stored and retrieved.

```
persist(msg, {
  metadata: {
    "ip": "127.0.0.1"
  }
})
```


<!-- Badges -->
[![Travis branch](https://img.shields.io/travis/ncthbrt/nact-persistence-postgres.svg?style=flat-square)](https://travis-ci.org/ncthbrt/nact-persistence-postgres)
[![Coveralls](https://img.shields.io/coveralls/ncthbrt/nact-persistence-postgres.svg?style=flat-square)](https://coveralls.io/github/ncthbrt/nact-persistence-postgres) [![Dependencies](https://david-dm.org/ncthbrt/nact-persistence-postgres.svg?branch=master&style=flat-square)](https://david-dm.org/ncthbrt/nact-persistence-postgres) 
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fncthbrt%2Fnact-persistence-postgres.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fncthbrt%2Fnact-persistence-postgres?ref=badge_shield)

[![npm](https://img.shields.io/npm/v/nact-persistence-postgres.svg?style=flat-square)](https://www.npmjs.com/package/nact-persistence-postgres) [![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-blue.svg?style=flat-square)](https://github.com/Flet/semistandard) 


## License
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fncthbrt%2Fnact-persistence-postgres.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fncthbrt%2Fnact-persistence-postgres?ref=badge_large)
