/**
 * Preload for a CLI run under test (`node --import ./test/support/record-random.js ...`): records
 * every value node:crypto's randomBytes hands out in that process, in hex, one per line, in the
 * file that RECORD_RANDOM_BYTES names. A test can then check that none of them shows up in what
 * the CLI printed (system-account-passwords.test.js). Test support only: nothing in src/ loads it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const file = process.env.RECORD_RANDOM_BYTES;
if (!file) throw new Error('record-random.js: RECORD_RANDOM_BYTES must name the file to record into');

const record = (bytes) => fs.appendFileSync(file, `${Buffer.from(bytes).toString('hex')}\n`);
const original = crypto.randomBytes;

crypto.randomBytes = function recordedRandomBytes(size, callback) {
  if (typeof callback === 'function') {
    return original.call(crypto, size, (err, bytes) => {
      if (!err) record(bytes);
      callback(err, bytes);
    });
  }
  const bytes = original.call(crypto, size);
  record(bytes);
  return bytes;
};

// `import { randomBytes } from 'node:crypto'` gets the recording function too.
syncBuiltinESMExports();
