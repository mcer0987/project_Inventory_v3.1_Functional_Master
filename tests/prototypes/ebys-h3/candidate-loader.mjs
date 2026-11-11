// Node preload for unchanged test files: replace only reads of the root Rules file.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { buildRules } from './build-rules.mjs';
const candidate = buildRules();
const original = fs.readFileSync;
fs.readFileSync = function (file, options) {
    const path = file instanceof URL ? fileURLToPath(file) : typeof file === 'string' ? file : '';
    if (path && resolve(path) === resolve('firestore.rules')) {
        return typeof options === 'string' || options?.encoding ? candidate : Buffer.from(candidate);
    }
    return original.apply(this, arguments);
};
syncBuiltinESMExports();
