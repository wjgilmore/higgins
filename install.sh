#!/bin/bash
#
# Higgins installer. Usage:
#   curl -fsSL https://raw.githubusercontent.com/wjgilmore/higgins/main/install.sh | bash
#
# Environment variables:
#   HIGGINS_DIR     Install destination (default: $HOME/higgins)
#   HIGGINS_BRANCH  Git branch to check out (default: main)
#   HIGGINS_REPO    Git repo URL (default: https://github.com/wjgilmore/higgins.git)

set -euo pipefail

REPO="${HIGGINS_REPO:-https://github.com/wjgilmore/higgins.git}"
BRANCH="${HIGGINS_BRANCH:-main}"
INSTALL_DIR="${HIGGINS_DIR:-$HOME/higgins}"

blue()  { printf "\033[1;34m%s\033[0m\n" "$*"; }
green() { printf "\033[1;32m%s\033[0m\n" "$*"; }
red()   { printf "\033[1;31m%s\033[0m\n" "$*" >&2; }
step()  { printf "\n\033[1;34m==>\033[0m \033[1m%s\033[0m\n" "$*"; }

fail() { red "✗ $1"; exit 1; }
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 not found. $2"
}

step "Higgins installer"

# --- OS check ---
OS="$(uname)"
case "$OS" in
  Darwin) green "✓ macOS" ;;
  Linux)  green "✓ Linux" ;;
  *)      fail "Unsupported OS: $OS. Higgins supports macOS and Linux." ;;
esac

# --- git ---
if [[ "$OS" == "Darwin" ]]; then
  require_cmd git "Install with: xcode-select --install"
else
  require_cmd git "Install with: sudo apt install git  (or your package manager)"
fi
green "✓ git"

# --- Node ---
if [[ "$OS" == "Darwin" ]]; then
  require_cmd node "Install with: brew install node  (or download from https://nodejs.org)"
else
  require_cmd node "Install with: sudo apt install nodejs  (or download from https://nodejs.org)"
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  if [[ "$OS" == "Darwin" ]]; then
    fail "Node.js 20+ required (found v$(node -v | sed 's/^v//')). Upgrade: brew upgrade node"
  else
    fail "Node.js 20+ required (found v$(node -v | sed 's/^v//')). See https://nodejs.org for install instructions."
  fi
fi
green "✓ Node.js $(node -v)"

# --- LLM backend ---
# Ollama is checked by default, but users can skip this with HIGGINS_SKIP_OLLAMA=1
# if they plan to use an OpenAI-compatible server (llama.cpp, vLLM, LM Studio, etc.)
if [[ "${HIGGINS_SKIP_OLLAMA:-}" == "1" ]]; then
  blue "⊘ Skipping Ollama check (HIGGINS_SKIP_OLLAMA=1)"
  blue "  Make sure your LLM server is running and set OLLAMA_URL in the setup wizard."
elif command -v ollama >/dev/null 2>&1; then
  if ! ollama list >/dev/null 2>&1; then
    red "✗ Ollama is installed but not running."
    if [[ "$OS" == "Darwin" ]]; then
      red "   Start it with: open -a Ollama    (or run 'ollama serve' in another terminal)"
    else
      red "   Start it with: systemctl start ollama    (or run 'ollama serve' in another terminal)"
    fi
    red "   Or set HIGGINS_SKIP_OLLAMA=1 if using a different LLM server."
    exit 1
  fi
  green "✓ Ollama running"
else
  blue "⊘ Ollama not found — that's OK if you're using another LLM server (llama.cpp, vLLM, etc.)"
  blue "  Set OLLAMA_URL to your server's address during setup."
fi

# --- Clone ---
step "Cloning Higgins to $INSTALL_DIR"
if [ -e "$INSTALL_DIR" ]; then
  fail "$INSTALL_DIR already exists. Remove it, or set HIGGINS_DIR to a different path."
fi
git clone --quiet --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
cd "$INSTALL_DIR"
green "✓ Cloned $(git rev-parse --short HEAD)"

# --- Dependencies ---
step "Installing Node dependencies"
npm install --silent
green "✓ Dependencies installed"

# --- Setup wizard ---
step "Running setup wizard"
node bin/higgins.mjs setup

echo
green "✓ Higgins installed to $INSTALL_DIR"
echo
echo "Useful commands:"
echo "  higgins doctor              — check your config"
echo "  higgins logs                — tail the agent log"
echo "  higgins uninstall-service   — stop the background service"
echo
echo "If you skipped service install, start Higgins with:"
echo "  cd $INSTALL_DIR && node index.mjs"
