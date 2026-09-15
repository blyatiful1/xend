#!/usr/bin/env bash
# xend installer: registers the marketplace and installs the plugin at user scope.
#   curl -fsSL https://raw.githubusercontent.com/blyatiful1/xend/main/install.sh | bash
# Options: XEND_PROFILE=lite|balanced|aggressive (default balanced), XEND_SCOPE=user|project (default user)
set -euo pipefail

REPO="${XEND_REPO:-blyatiful1/xend}"
PROFILE="${XEND_PROFILE:-balanced}"
SCOPE="${XEND_SCOPE:-user}"

say() { printf '%s\n' "$*"; }
die() { printf 'xend: %s\n' "$*" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || die "claude CLI not found. Install Claude Code first: https://code.claude.com/docs/en/quickstart"
command -v node >/dev/null 2>&1 || die "node (>=18) not found; xend hooks run on Node.js"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node >= 18 required (found $(node --version))"

if claude plugin marketplace --help >/dev/null 2>&1; then
  say "Registering marketplace $REPO ..."
  claude plugin marketplace add "$REPO" >/dev/null 2>&1 || claude plugin marketplace update xend >/dev/null 2>&1 || true
  say "Installing plugin xend@xend (scope: $SCOPE) ..."
  claude plugin install "xend@xend" -s "$SCOPE" -y
else
  say "Your claude CLI has no 'plugin' subcommand. Inside Claude Code run:"
  say "  /plugin marketplace add $REPO"
  say "  /plugin install xend@xend"
  exit 0
fi

CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xend"
mkdir -p "$CFG_DIR"
if [ ! -f "$CFG_DIR/config.json" ]; then
  printf '{ "profile": "%s" }\n' "$PROFILE" > "$CFG_DIR/config.json"
  say "Profile: $PROFILE (written to $CFG_DIR/config.json)"
else
  say "Profile config exists at $CFG_DIR/config.json (left unchanged)"
fi

say ""
say "Done. Start a new Claude Code session, then:"
say "  /xend:doctor                 audit this environment for token waste"
say "  /xend:setup $PROFILE --with-recommended   apply recommended native settings (dry-run first without the flag)"
say "  /xend:stats                  see what a session spent and what shaping saved"
