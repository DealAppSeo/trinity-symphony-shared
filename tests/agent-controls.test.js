// node tests/agent-controls.test.js
const assert = require('assert');
const { toControlName } = require('../lib/agent-controls');

assert.strictEqual(toControlName('trinity-mel'), 'mel');
assert.strictEqual(toControlName('MEL'), 'mel');
assert.strictEqual(toControlName('trinity-veritas'), 'veritas');
console.log('agent-controls.test.js: OK');