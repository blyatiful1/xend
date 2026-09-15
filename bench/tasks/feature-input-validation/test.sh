#!/usr/bin/env bash
node - <<'JSEOF'
const assert = require('assert');
const { createUser } = require('./validate_user');

let failures = 0;

function expectThrows(fn, message, label) {
  try {
    fn();
  } catch (e) {
    if (e.message !== message) {
      console.log(`FAIL [${label}]: expected message "${message}", got "${e.message}"`);
      failures++;
    }
    return;
  }
  console.log(`FAIL [${label}]: expected a throw with message "${message}", but nothing was thrown`);
  failures++;
}

expectThrows(() => createUser({ email: 'a@b.com', age: 5 }), 'name is required', 'missing name');
expectThrows(() => createUser({ name: '   ', email: 'a@b.com', age: 5 }), 'name is required', 'blank name');
expectThrows(() => createUser({ name: 'Al', age: 5 }), 'email is invalid', 'missing email');
expectThrows(() => createUser({ name: 'Al', email: 'noatsign', age: 5 }), 'email is invalid', 'no @ in email');
expectThrows(() => createUser({ name: 'Al', email: 'a@b.com' }), 'age must be a non-negative integer', 'missing age');
expectThrows(() => createUser({ name: 'Al', email: 'a@b.com', age: -1 }), 'age must be a non-negative integer', 'negative age');
expectThrows(() => createUser({ name: 'Al', email: 'a@b.com', age: 2.5 }), 'age must be a non-negative integer', 'non-integer age');
expectThrows(() => createUser({ email: 'a@b.com' }), 'name is required', 'name checked before age');

try {
  const u = createUser({ name: 'Al', email: 'a@b.com', age: 30 });
  assert.deepStrictEqual(u, { name: 'Al', email: 'a@b.com', age: 30 });
} catch (e) {
  console.log('FAIL [valid input]: unexpected throw or wrong shape:', e.message);
  failures++;
}

if (failures > 0) {
  console.log(`FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('PASS');
JSEOF
exit $?
