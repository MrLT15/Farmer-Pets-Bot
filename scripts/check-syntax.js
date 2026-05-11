const { readdirSync, readFileSync, statSync } = require("fs");
const { join, relative } = require("path");
const { spawnSync } = require("child_process");

const repoRoot = join(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);
const mergeConflictMarkerPattern = /^(<<<<<<<|=======|>>>>>>>)($|\s|[\w./-])/;

function collectJavaScriptFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory)) {
    if (ignoredDirectories.has(entry)) continue;

    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath));
      continue;
    }

    if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

function findMergeConflictMarker(source) {
  const lines = source.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (mergeConflictMarkerPattern.test(line)) {
      return { line: index + 1, text: line };
    }
  }

  return null;
}

function checkJavaScriptFile(file, { root = repoRoot } = {}) {
  const displayPath = relative(root, file);
  const conflictMarker = findMergeConflictMarker(readFileSync(file, "utf8"));

  if (conflictMarker) {
    return {
      ok: false,
      displayPath,
      conflictMarker
    };
  }

  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    encoding: "utf8"
  });

  return {
    ok: result.status === 0,
    displayPath,
    result
  };
}

function runSyntaxCheck({ root = repoRoot } = {}) {
  const files = collectJavaScriptFiles(root).sort();
  let hasFailure = false;

  for (const file of files) {
    const check = checkJavaScriptFile(file, { root });

    if (check.ok) {
      console.log(`✓ ${check.displayPath}`);
      continue;
    }

    hasFailure = true;
    console.error(`✗ ${check.displayPath}`);

    if (check.conflictMarker) {
      console.error(
        `Merge conflict marker found at line ${check.conflictMarker.line}: ${check.conflictMarker.text}`
      );
      console.error("Resolve the Git conflict markers before deploying.");
      continue;
    }

    if (check.result.stdout) process.stdout.write(check.result.stdout);
    if (check.result.stderr) process.stderr.write(check.result.stderr);
  }

  return hasFailure ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = runSyntaxCheck();
}

module.exports = {
  checkJavaScriptFile,
  collectJavaScriptFiles,
  findMergeConflictMarker,
  runSyntaxCheck
};
