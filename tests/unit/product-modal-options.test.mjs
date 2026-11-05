import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = fs.readFileSync(new URL('../../src/ui/ui-components.js', import.meta.url), 'utf8');
const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const declaration = ast.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === '_productShelfOptions');
const helper = source.slice(declaration.start, declaration.end);
const context = vm.createContext({});
vm.runInContext(helper, context);

test('ürün modalı sabit rafları ve depoya ait kayıtlı rafları listeler; mevcut ürün rafını da korur', () => {
    const options = Array.from(context._productShelfOptions(
        'b2',
        ['Zemin', 'Raf-1', 'Raf-2'],
        [
            { depot: 'b2', code: 'B2-R07' },
            { depot: 'b1', code: 'B1-R03' },
            { depot: 'b2', code: 'raf-1' },
        ],
        'LEGACY-SHELF',
        value => String(value).trim().toLocaleUpperCase('tr-TR')
    ));
    assert.deepEqual(options, ['Zemin', 'Raf-1', 'Raf-2', 'B2-R07', 'LEGACY-SHELF']);
});
