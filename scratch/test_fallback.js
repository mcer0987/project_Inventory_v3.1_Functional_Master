// [WHY]: Test the performance guard and fallback logic in an isolated Node.js script.
// [HOW]: Run assertions verifying that deep copies are correctly created both when structuredClone is present and when it is undefined/mocked out.

const assert = require('assert');

// Mock data
const mockItems = [
    { id: '1', name: 'Item A', details: { category: 'Hardware', stock: 10 } },
    { id: '2', name: 'Item B', details: { category: 'Software', stock: 5 } }
];

function testClone(structuredCloneFn) {
    const window = {
        _dbMirror: {}
    };
    const colName = 'inventory';
    const items = mockItems;

    // Implementation under test
    window._dbMirror[colName] = typeof structuredCloneFn === "function" 
        ? structuredCloneFn(items) 
        : JSON.parse(JSON.stringify(items));

    // Assert deep copy structure is identical
    assert.deepStrictEqual(window._dbMirror[colName], items, "Deep copy structure should match original");

    // Assert that it is a deep copy (mutating copy doesn't mutate original)
    window._dbMirror[colName][0].details.stock = 999;
    assert.notStrictEqual(items[0].details.stock, 999, "Mutating deep copy must not affect original items");

    console.log(`Success with: ${typeof structuredCloneFn === "function" ? "structuredClone" : "JSON fallback"}`);
}

try {
    // Test 1: Native structuredClone (or fallback if older Node, but Node 17+ has it)
    console.log("Running Test 1 (with structuredClone capability verification)...");
    const testCloneFn = typeof structuredClone === "function" ? structuredClone : undefined;
    testClone(testCloneFn);

    // Test 2: Force fallback to JSON.parse(JSON.stringify)
    console.log("Running Test 2 (forcing JSON fallback)...");
    testClone(undefined);

    console.log("\nAll self-test assertions passed successfully in isolated scope!");
    process.exit(0);
} catch (error) {
    console.error("Self-test assertion failed!", error);
    process.exit(1);
}
