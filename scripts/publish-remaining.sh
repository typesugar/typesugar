#!/bin/bash
# Publish remaining typesugar packages
# Run this after rate limit resets (wait a few hours)

set -e

PACKAGES=(
  "testing"
  "contracts-refined"
  "fp"
  "std"
  "macros"
  "effect"
  "validate"
)

echo "Publishing remaining @typesugar packages..."

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "=== Publishing @typesugar/$pkg ==="
  cd "/Users/deapovey/src/typesugar/packages/$pkg"
  npm publish --access public
  echo "Waiting 5 seconds..."
  sleep 5
done

echo ""
echo "=== Publishing main typesugar package ==="
cd "/Users/deapovey/src/typesugar/packages/typesugar"
npm publish --access public

echo ""
echo "Done! All packages published."
echo ""
echo "All packages published!"
