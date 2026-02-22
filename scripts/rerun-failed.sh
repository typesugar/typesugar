#!/usr/bin/env bash
# Re-run only the test files that failed in the last vitest run.
#
# Usage:
#   pnpm test:failed                  # re-run all failed tests
#   pnpm test:failed cfg              # only failed tests whose path contains "cfg"
#   pnpm test:failed cfg derive       # multiple patterns (OR)
#   pnpm test:failed -- --bail 1      # pass extra flags to vitest (after --)
#   pnpm test:failed cfg -- --bail 1  # pattern + vitest flags
#
# Requires: .vitest-results/test-results.json from a prior run
#   (produced automatically by `pnpm test`)

set -euo pipefail

RESULTS_FILE=".vitest-results/test-results.json"

# Split args into patterns (before --) and vitest passthrough flags (after --)
PATTERNS=()
VITEST_ARGS=()
PASSTHROUGH=false
for arg in "$@"; do
  if [[ "$arg" == "--" ]]; then
    PASSTHROUGH=true
  elif [[ "$PASSTHROUGH" == true ]]; then
    VITEST_ARGS+=("$arg")
  else
    PATTERNS+=("$arg")
  fi
done

if [[ ! -f "$RESULTS_FILE" ]]; then
  echo "No previous test results found at $RESULTS_FILE"
  echo "Run 'pnpm test' first to generate results."
  exit 1
fi

# Write patterns array to a temp file so node can read it cleanly
PATTERNS_JSON=$(node -e "process.stdout.write(JSON.stringify($(IFS=,; printf '["%s"]' "${PATTERNS[*]+"${PATTERNS[*]}"}" | sed 's/,/","/g')))" 2>/dev/null || echo "[]")
# Simpler: just pass patterns as newline-delimited env var
PATTERN_LIST=$(IFS=$'\n'; echo "${PATTERNS[*]+"${PATTERNS[*]}"}")

FAILED_FILES=$(PATTERN_LIST="$PATTERN_LIST" node -e "
  const r = require('$RESULTS_FILE');
  const patterns = process.env.PATTERN_LIST
    ? process.env.PATTERN_LIST.split('\n').filter(Boolean)
    : [];
  let failed = r.testResults
    .filter(t => t.status === 'failed')
    .map(t => t.name.replace(process.cwd() + '/', ''));
  if (patterns.length > 0) {
    failed = failed.filter(f => patterns.some(p => f.includes(p)));
  }
  if (failed.length === 0) {
    const msg = patterns.length > 0
      ? 'No failed tests match pattern(s): ' + patterns.join(', ')
      : 'All tests passed in the last run. Nothing to re-run.';
    console.error(msg);
    process.exit(0);
  }
  process.stdout.write(failed.join('\n'));
")

if [[ -z "$FAILED_FILES" ]]; then
  exit 0
fi

FAILED_COUNT=$(echo "$FAILED_FILES" | wc -l | tr -d ' ')
echo "Re-running $FAILED_COUNT failed test file(s):"
echo "$FAILED_FILES" | sed 's/^/  /'
echo ""

# shellcheck disable=SC2046
exec npx vitest run $(echo "$FAILED_FILES" | tr '\n' ' ') "${VITEST_ARGS[@]+"${VITEST_ARGS[@]}"}"
