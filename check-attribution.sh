#!/bin/bash
# Rejects AI attribution trailers/lines in commit messages and PR
# descriptions. CLAUDE.md says not to add these, but an agent has followed a
# conflicting session-level instruction and added them anyway more than once
# (dashboard #17, nixfleet #88, dashboard #20) - each time only caught because
# a person happened to read the diff. This is the backstop for when nobody
# does.
set -euo pipefail

pattern='(Co-Authored-By:[^\n]*[Cc]laude|Generated with \[?Claude Code)'

usage() {
  echo "usage: $(basename "$0") commits <git-log-range-args...> | body <file>" >&2
  exit 2
}

mode="${1:-}"
[ -n "$mode" ] || usage
shift

case "$mode" in
  commits)
    hits=$(git log "$@" --format='%B' | grep -Eio "$pattern" || true)
    if [ -n "$hits" ]; then
      echo "AI attribution found in commit message(s):"
      git log "$@" --format='  %h %s'
      echo "Remove Co-Authored-By/\"Generated with\" lines - see CLAUDE.md."
      exit 1
    fi
    ;;
  body)
    file="${1:-}"
    [ -n "$file" ] || usage
    if [ -f "$file" ] && grep -Eioq "$pattern" "$file"; then
      echo "AI attribution found in the PR description."
      echo "Remove Co-Authored-By/\"Generated with\" lines - see CLAUDE.md."
      exit 1
    fi
    ;;
  *)
    usage
    ;;
esac

echo "No AI attribution found."
