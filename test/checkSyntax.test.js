const assert = require("node:assert/strict");
const test = require("node:test");

const { findMergeConflictMarker } = require("../scripts/check-syntax");

test("findMergeConflictMarker detects unresolved Git conflict markers", () => {
  assert.deepEqual(findMergeConflictMarker("const value = 1;\n<<<<<<< branch\n"), {
    line: 2,
    text: "<<<<<<< branch"
  });
  assert.deepEqual(findMergeConflictMarker("=======\nconst value = 2;"), {
    line: 1,
    text: "======="
  });
  assert.deepEqual(findMergeConflictMarker("const value = 2;\n>>>>>>> main"), {
    line: 2,
    text: ">>>>>>> main"
  });
});

test("findMergeConflictMarker ignores normal JavaScript", () => {
  assert.equal(findMergeConflictMarker("const value = '<<<<<<< not at line start';\n"), null);
  assert.equal(findMergeConflictMarker("const value = 1;\n"), null);
});
