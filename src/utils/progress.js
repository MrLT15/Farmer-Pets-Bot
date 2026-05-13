function makeProgressBar(current, goal, width = 10) {
  const safeGoal = Math.max(Number(goal || 0), 1);
  const filled = Math.min(
    width,
    Math.floor((Number(current || 0) / safeGoal) * width)
  );

  return "█".repeat(filled) + "░".repeat(width - filled);
}

module.exports = { makeProgressBar };
