#!/bin/sh
# Junis kit bootstrap: puts the kit on this machine and runs its installer,
# which registers the skill and the MCP server with every coding agent found.
#
#   sh install.sh                      every agent found on this machine
#   sh install.sh --agents claude-code  only the named agents
#   sh install.sh --dry-run            show the plan, change nothing
#
# Run as a file from inside a checkout, it installs that checkout. Run on its own (for
# example through `curl … | sh`), it clones JUNIS_KIT_REPO into ~/.junis-kit/src
# first, or updates the clone that is already there.
set -eu

# Everything runs from main, called by the last line inside a { …; } group: a
# download cut off midway (curl … | sh) is then a syntax error that runs nothing,
# instead of half a script or main without the flags that were asked for.
# zsh sets $0 to the function name inside a function (FUNCTION_ARGZERO), so the
# script path is read here, before main runs.
self=$0

main() {

REPO="${JUNIS_KIT_REPO:-https://github.com/TOOEASY-crew/junis-kit.git}"
REF="${JUNIS_KIT_REF:-main}"
# A ref is a branch or tag name: never empty, never an option, never several words.
case "$REF" in
  ''|-*|*[[:space:]]*)
    echo "JUNIS_KIT_REF must be a branch or tag name, got '$REF'." >&2
    exit 1 ;;
esac
case "$REPO" in
  ''|-*|*[[:space:]]*)
    echo "JUNIS_KIT_REPO must be a repository URL or path, got '$REPO'." >&2
    exit 1 ;;
esac
if [ -z "${HOME:-}" ]; then
  echo "HOME is not set; cannot decide where to install." >&2
  exit 1
fi
KIT_HOME="${JUNIS_KIT_HOME:-$HOME/.junis-kit}"

need() { command -v "$1" >/dev/null 2>&1; }

if ! need node; then
  echo "Node.js 18 or newer is required. Install it from https://nodejs.org and run this again." >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 18 ]; then
  echo "Node.js $major found; 18 or newer is required." >&2
  exit 1
fi

# Only a script run as a file can sit inside a checkout. Piped (`curl … | sh`),
# $0 is the shell and the current directory says nothing about the kit.
here=
case "$self" in
  *install.sh) here=$(cd "$(dirname "$self")" 2>/dev/null && pwd || true) ;;
esac
if [ -n "$here" ] && [ -f "$here/skills/junis/scripts/junis.mjs" ]; then
  src="$here"
else
  if ! need git; then
    echo "git is required to download the kit." >&2
    exit 1
  fi
  src="$KIT_HOME/src"
  # Never prompt for credentials: a private or missing repository is an error.
  export GIT_TERMINAL_PROMPT=0
  if [ -d "$src/.git" ]; then
    # The clone follows JUNIS_KIT_REPO: a repository changed since the first
    # install is switched to, and said so, instead of being ignored.
    current=$(git -C "$src" remote get-url origin 2>/dev/null || true)
    if [ "$current" != "$REPO" ]; then
      echo "junis-kit clone at $src came from $current; switching it to $REPO (JUNIS_KIT_REPO)." >&2
      git -C "$src" remote set-url origin -- "$REPO"
    fi
    git -C "$src" fetch -q --depth 1 -- origin "$REF"
    git -C "$src" checkout -q --detach FETCH_HEAD
  else
    mkdir -p "$KIT_HOME"
    chmod 700 "$KIT_HOME"
    # "--" keeps a REPO value that starts with "-" from being read as an option.
    if ! git clone -q --depth 1 --branch "$REF" -- "$REPO" "$src"; then
      echo "Could not download the kit from $REPO ($REF). Set JUNIS_KIT_REPO to a reachable repository, or run install.sh from a checkout." >&2
      exit 1
    fi
  fi
  echo "junis-kit at $(git -C "$src" rev-parse --short HEAD) ($REF)" >&2
fi

exec node "$src/skills/junis/scripts/junis.mjs" install "$@"
}

{ main "$@"; }
