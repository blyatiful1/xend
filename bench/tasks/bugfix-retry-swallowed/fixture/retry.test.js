const assert = require('assert');
const { fetchWithRetry } = require('./retry');

let calls = 0;
function flaky() {
  calls++;
  if (calls < 3) {
    throw new Error('temporary failure');
  }
  return 'ok';
}

const result = fetchWithRetry(flaky, 5);
assert.strictEqual(result, 'ok', 'expected eventual success after retries');
assert.strictEqual(calls, 3, `expected exactly 3 attempts, got ${calls}`);

calls = 0;
function alwaysFails() {
  calls++;
  throw new Error('permanent failure');
}
assert.throws(
  () => fetchWithRetry(alwaysFails, 4),
  /permanent failure/,
  'expected the final error to propagate once attempts are exhausted'
);
assert.strictEqual(calls, 4, `expected exactly 4 attempts, got ${calls}`);

console.log('all tests passed');
