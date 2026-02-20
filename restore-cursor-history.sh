#!/bin/bash
echo "Restoring Cursor chat history from ttfx to typesugar..."

OLD_DIR="$HOME/Library/Application Support/Cursor/User/workspaceStorage/ffebd054ec15022016d689e9a62ebebe"
NEW_DIR="$HOME/Library/Application Support/Cursor/User/workspaceStorage/824708caff94d3b4009b5f87deb5d482"

# CRITICAL: We must delete the Write-Ahead Log (-wal) and Shared Memory (-shm) files.
# If we don't, SQLite will apply the new empty state over our restored database!
rm -f "$NEW_DIR/state.vscdb"
rm -f "$NEW_DIR/state.vscdb-wal"
rm -f "$NEW_DIR/state.vscdb-shm"
rm -f "$NEW_DIR/state.vscdb.backup"

# Now copy the files over cleanly
cp "$OLD_DIR/state.vscdb" "$NEW_DIR/state.vscdb"
if [ -f "$OLD_DIR/state.vscdb.backup" ]; then
    cp "$OLD_DIR/state.vscdb.backup" "$NEW_DIR/state.vscdb.backup"
fi

echo "Done! You can now reopen Cursor."
