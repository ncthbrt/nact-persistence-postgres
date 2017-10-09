#!/bin/bash
docker run -p 127.0.0.1:5431:5432  --rm --name postgres-nact-test -e POSTGRES_DB=testdb -e POSTGRES_PASSWORD=testpassword -d postgres