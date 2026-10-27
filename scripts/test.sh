#!/usr/bin/env bash
# Usage: scripts/test.sh [pytest args]   - run the test suite under the emulators
#        scripts/test.sh --seed          - load the 200-player sample competition and keep
#                                          the emulators (and UI at :4000) running to browse it
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x functions/venv/bin/python ]; then
    python3.12 -m venv functions/venv
    functions/venv/bin/pip install -q -r requirements-dev.txt
fi

if [ "${1:-}" = "--seed" ]; then
    firebase emulators:start --only auth,firestore &
    trap 'kill %1' EXIT
    until curl -s -o /dev/null http://127.0.0.1:8080/; do sleep 1; done
    functions/venv/bin/python scripts/seed.py
    echo "Browse the data at http://127.0.0.1:4000/firestore - Ctrl+C to stop."
    wait
else
    firebase emulators:exec --only auth,firestore "functions/venv/bin/pytest -q $*"
fi
