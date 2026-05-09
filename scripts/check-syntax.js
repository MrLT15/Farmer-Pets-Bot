const { readdirSync, statSync } = require("fs");
const { join, relative } = require("path");
const { spawnSync } = require("child_process");

const repoRoot = join(__dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);

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

const files = collectJavaScriptFiles(repoRoot).sort();
let hasFailure = false;

for (const file of files) {
  const displayPath = relative(repoRoot, file);
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: repoRoot,
    encoding: "utf8"
  });

  if (result.status === 0) {
    console.log(`✓ ${displayPath}`);
    continue;
  }

  hasFailure = true;
  console.error(`✗ ${displayPath}`);

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

if (hasFailure) {
  process.exit(1);
}
