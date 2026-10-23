#!/bin/bash
# Recria o banco local e aplica stub + migrações + testes
set -e
P="psql -h /tmp -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -t"
D=$(dirname "$0")/..
$P -c "drop database if exists rh" -c "create database rh"
$P -d rh -f $D/tests/00_stub_supabase.sql
for f in $D/migrations/*.sql; do echo ">> $(basename $f)"; $P -d rh -f $f; done
for f in $D/tests/[1-9]*.sql; do [ -f "$f" ] && { echo ">> TESTE $(basename $f)"; $P -d rh -f $f; }; done
echo "OK"
