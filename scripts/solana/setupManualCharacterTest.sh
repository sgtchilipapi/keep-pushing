#!/usr/bin/env bash
set -euo pipefail

for candidate_bin in \
  "$HOME/.local/share/solana/install/active_release/bin" \
  "$HOME/.cargo/bin"
do
  if [[ -d "$candidate_bin" && ":$PATH:" != *":$candidate_bin:"* ]]; then
    PATH="$candidate_bin:$PATH"
  fi
done
export PATH

KEEP_PUSHING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNANA_PROGRAM_ROOT="${RUNANA_PROGRAM_ROOT:-$(cd "$KEEP_PUSHING_ROOT/../runana-program" && pwd)}"
ARTIFACT_PARENT="${RUNANA_MANUAL_TEST_ROOT:-$KEEP_PUSHING_ROOT/.tmp/manual-character-test}"
RUN_ID="${RUNANA_MANUAL_TEST_RUN_ID:-$(date '+%Y%m%d-%H%M%S')}"
ARTIFACT_DIR="${RUNANA_MANUAL_TEST_DIR:-$ARTIFACT_PARENT/$RUN_ID}"
VALIDATOR_LEDGER_PATH="${RUNANA_VALIDATOR_LEDGER_PATH:-$ARTIFACT_PARENT/validator-ledger-current}"
MAX_ARTIFACT_DIRS="${RUNANA_MANUAL_TEST_MAX_ARTIFACT_DIRS:-5}"
LOG_DIR="$ARTIFACT_DIR/logs"
KEYPAIR_DIR="$ARTIFACT_DIR/keypairs"

RPC_URL="${RUNANA_SOLANA_RPC_URL:-http://127.0.0.1:8899}"
SOLANA_COMMITMENT="${RUNANA_SOLANA_COMMITMENT:-confirmed}"
SERVER_HOST="${RUNANA_SERVER_HOST:-127.0.0.1}"
SERVER_PORT="${PORT:-3000}"
SERVER_URL="http://$SERVER_HOST:$SERVER_PORT"
VALIDATOR_HOST="$(node -e "process.stdout.write(new URL(process.argv[1]).hostname)" "$RPC_URL")"
VALIDATOR_PORT="$(node -e "process.stdout.write(new URL(process.argv[1]).port || '8899')" "$RPC_URL")"

PROGRAM_KEYPAIR_PATH="${RUNANA_PROGRAM_KEYPAIR_PATH:-$RUNANA_PROGRAM_ROOT/target/deploy/runana_program-keypair.json}"
PROGRAM_SO_PATH="${RUNANA_PROGRAM_SO_PATH:-$RUNANA_PROGRAM_ROOT/target/deploy/runana_program.so}"
PROGRAM_ID="${RUNANA_PROGRAM_ID:-$(solana-keygen pubkey "$PROGRAM_KEYPAIR_PATH")}"
EXPECTED_PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR_PATH")"
PROGRAM_SOURCE_DIR="${RUNANA_PROGRAM_SOURCE_DIR:-$RUNANA_PROGRAM_ROOT/programs/runana-program/src}"

ZONE_ID="${RUNANA_BOOTSTRAP_ZONE_ID:-1}"
SEASON_ID="${RUNANA_BOOTSTRAP_SEASON_ID:-1}"
MAX_BATTLES_PER_BATCH="${RUNANA_BOOTSTRAP_MAX_BATTLES_PER_BATCH:-20}"
MAX_HISTOGRAM_ENTRIES_PER_BATCH="${RUNANA_BOOTSTRAP_MAX_HISTOGRAM_ENTRIES_PER_BATCH:-20}"

DEPLOYER_AIRDROP_SOL="${RUNANA_DEPLOYER_AIRDROP_SOL:-20}"
ADMIN_AIRDROP_SOL="${RUNANA_ADMIN_AIRDROP_SOL:-10}"
PLAYER_AIRDROP_SOL="${RUNANA_PLAYER_AIRDROP_SOL:-5}"

DEPLOYER_KEYPAIR_PATH="$KEYPAIR_DIR/deployer.json"
ADMIN_KEYPAIR_PATH="$KEYPAIR_DIR/admin.json"
SERVER_SIGNER_KEYPAIR_PATH="$KEYPAIR_DIR/server.json"
PLAYER_KEYPAIR_PATH="$KEYPAIR_DIR/player.json"
SPONSOR_KEYPAIR_PATH="${RUNANA_SPONSOR_KEYPAIR_PATH:-$ADMIN_KEYPAIR_PATH}"
VALIDATOR_LOG_PATH="$LOG_DIR/validator.log"
VALIDATOR_INTERNAL_LOG_PATH="$VALIDATOR_LEDGER_PATH/validator.log"
SERVER_LOG_PATH="$LOG_DIR/server.log"
VALIDATOR_PID_PATH="$ARTIFACT_DIR/validator.pid"
SERVER_PID_PATH="$ARTIFACT_DIR/server.pid"
BOOTSTRAP_CONFIG_PATH="$ARTIFACT_DIR/bootstrap.json"
ANON_USER_RESPONSE_PATH="$ARTIFACT_DIR/anon-user.json"
PREPARE_REQUEST_PATH="$ARTIFACT_DIR/character-create-prepare.request.json"
STOP_SCRIPT_PATH="$ARTIFACT_DIR/stop-stack.sh"

mkdir -p "$LOG_DIR" "$KEYPAIR_DIR"
mkdir -p "$ARTIFACT_PARENT"

function note() {
  printf '[setup] %s\n' "$*"
}

function fail() {
  printf '[setup] ERROR: %s\n' "$*" >&2
  exit 1
}

function validator_process_running() {
  if [[ ! -f "$VALIDATOR_PID_PATH" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$VALIDATOR_PID_PATH")"
  kill -0 "$pid" >/dev/null 2>&1
}

function require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

function prune_old_artifact_dirs() {
  [[ "$MAX_ARTIFACT_DIRS" =~ ^[0-9]+$ ]] || fail "RUNANA_MANUAL_TEST_MAX_ARTIFACT_DIRS must be a non-negative integer"

  if (( MAX_ARTIFACT_DIRS == 0 )); then
    note "Skipping artifact pruning because RUNANA_MANUAL_TEST_MAX_ARTIFACT_DIRS=0"
    return
  fi

  local keep_older_count=$((MAX_ARTIFACT_DIRS - 1))
  mapfile -t artifact_dirs < <(
    find "$ARTIFACT_PARENT" -mindepth 1 -maxdepth 1 -type d \
      ! -path "$ARTIFACT_DIR" \
      ! -path "$VALIDATOR_LEDGER_PATH" \
      -printf '%P\n' | sort -r
  )

  if (( ${#artifact_dirs[@]} <= keep_older_count )); then
    return
  fi

  local dir_name
  for dir_name in "${artifact_dirs[@]:keep_older_count}"; do
    note "Removing stale artifact bundle $ARTIFACT_PARENT/$dir_name"
    rm -rf "$ARTIFACT_PARENT/$dir_name"
  done
}

function create_keypair_if_missing() {
  local target_path="$1"
  if [[ -f "$target_path" ]]; then
    return
  fi

  note "Creating keypair $(basename "$target_path")"
  solana-keygen new --no-bip39-passphrase --silent -o "$target_path" >/dev/null
}

function wait_for_rpc() {
  local attempts=0
  while (( attempts < 60 )); do
    if solana block-height --url "$RPC_URL" >/dev/null 2>&1; then
      return
    fi
    if [[ -f "$VALIDATOR_PID_PATH" ]] && ! validator_process_running; then
      if [[ -f "$VALIDATOR_INTERNAL_LOG_PATH" ]]; then
        printf '[setup] validator ledger log tail (%s):\n' "$VALIDATOR_INTERNAL_LOG_PATH" >&2
        tail -n 40 "$VALIDATOR_INTERNAL_LOG_PATH" >&2 || true
      fi
      fail "validator process exited before RPC became ready; check $VALIDATOR_LOG_PATH and $VALIDATOR_INTERNAL_LOG_PATH"
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  if [[ -f "$VALIDATOR_INTERNAL_LOG_PATH" ]]; then
    printf '[setup] validator ledger log tail (%s):\n' "$VALIDATOR_INTERNAL_LOG_PATH" >&2
    tail -n 40 "$VALIDATOR_INTERNAL_LOG_PATH" >&2 || true
  fi
  fail "validator at $RPC_URL did not become ready in time; check $VALIDATOR_LOG_PATH and $VALIDATOR_INTERNAL_LOG_PATH"
}

function server_health_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request GET \
    "$SERVER_URL/api/auth/anon" || true
}

function apply_prisma_migrations() {
  [[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL must be set before applying Prisma migrations"

  note "Applying Prisma migrations"
  (
    cd "$KEEP_PUSHING_ROOT"
    npx prisma migrate deploy >/dev/null
  )
}

function wait_for_server() {
  local attempts=0
  while (( attempts < 90 )); do
    local status
    status="$(server_health_code)"
    if [[ "$status" == "405" || "$status" == "400" || "$status" == "404" ]]; then
      return
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  fail "server at $SERVER_URL did not become ready in time; check $SERVER_LOG_PATH"
}

function start_validator_if_needed() {
  if solana block-height --url "$RPC_URL" >/dev/null 2>&1; then
    note "Reusing existing validator at $RPC_URL"
    return
  fi

  if [[ "${RUNANA_SKIP_VALIDATOR_START:-0}" == "1" ]]; then
    fail "RUNANA_SKIP_VALIDATOR_START=1 was set, but no validator is reachable at $RPC_URL"
  fi

  pkill -f solana-faucet >/dev/null 2>&1 || true
  note "Starting solana-test-validator at $RPC_URL using reusable ledger $VALIDATOR_LEDGER_PATH"
  nohup solana-test-validator \
    --reset \
    --quiet \
    --bind-address "$VALIDATOR_HOST" \
    --rpc-port "$VALIDATOR_PORT" \
    --ledger "$VALIDATOR_LEDGER_PATH" >"$VALIDATOR_LOG_PATH" 2>&1 &
  echo "$!" >"$VALIDATOR_PID_PATH"
  wait_for_rpc
}

function airdrop_if_needed() {
  local amount="$1"
  local pubkey="$2"

  note "Airdropping $amount SOL to $pubkey"
  solana airdrop "$amount" "$pubkey" --url "$RPC_URL" >/dev/null
}

function deploy_program_if_needed() {
  if solana program show "$PROGRAM_ID" --url "$RPC_URL" >/dev/null 2>&1; then
    note "Program $PROGRAM_ID already deployed"
    return
  fi

  note "Deploying program $PROGRAM_ID"
  solana program deploy \
    --url "$RPC_URL" \
    --keypair "$DEPLOYER_KEYPAIR_PATH" \
    --program-id "$PROGRAM_KEYPAIR_PATH" \
    "$PROGRAM_SO_PATH" >/dev/null
}

function build_program_if_needed() {
  if [[ "${RUNANA_SKIP_PROGRAM_BUILD:-0}" == "1" ]]; then
    note "Skipping runana-program rebuild because RUNANA_SKIP_PROGRAM_BUILD=1"
    return
  fi

  local needs_build=0
  if [[ ! -f "$PROGRAM_SO_PATH" ]]; then
    needs_build=1
  elif [[ -d "$PROGRAM_SOURCE_DIR" ]] && find "$PROGRAM_SOURCE_DIR" -type f -newer "$PROGRAM_SO_PATH" | grep -q .; then
    needs_build=1
  elif [[ -f "$RUNANA_PROGRAM_ROOT/Anchor.toml" && "$RUNANA_PROGRAM_ROOT/Anchor.toml" -nt "$PROGRAM_SO_PATH" ]]; then
    needs_build=1
  elif [[ -f "$RUNANA_PROGRAM_ROOT/Cargo.lock" && "$RUNANA_PROGRAM_ROOT/Cargo.lock" -nt "$PROGRAM_SO_PATH" ]]; then
    needs_build=1
  elif [[ -f "$RUNANA_PROGRAM_ROOT/programs/runana-program/Cargo.toml" && "$RUNANA_PROGRAM_ROOT/programs/runana-program/Cargo.toml" -nt "$PROGRAM_SO_PATH" ]]; then
    needs_build=1
  fi

  if [[ "$needs_build" != "1" ]]; then
    note "Using existing program build at $PROGRAM_SO_PATH"
    return
  fi

  note "Building latest runana-program artifact"
  (
    cd "$RUNANA_PROGRAM_ROOT"
    if command -v anchor >/dev/null 2>&1; then
      anchor build -p runana-program >/dev/null
    else
      require_command cargo-build-sbf
      cargo-build-sbf \
        --manifest-path programs/runana-program/Cargo.toml \
        --sbf-out-dir target/deploy >/dev/null
    fi
  )
}

function write_bootstrap_config() {
  local trusted_server_signer="$1"

  node - "$BOOTSTRAP_CONFIG_PATH" "$trusted_server_signer" "$SEASON_ID" "$MAX_BATTLES_PER_BATCH" "$MAX_HISTOGRAM_ENTRIES_PER_BATCH" <<'NODE'
const fs = require('node:fs');

const [
  outputPath,
  trustedServerSigner,
  seasonId,
  maxBattlesPerBatch,
  maxHistogramEntriesPerBatch,
] = process.argv.slice(2);

const now = Math.floor(Date.now() / 1000);
const config = {
  programConfig: {
    trustedServerSigner,
    settlementAuthorizationMode: 0,
    settlementPaused: false,
    maxBattlesPerBatch: Number(maxBattlesPerBatch),
    maxRunsPerBatch: 4,
    maxHistogramEntriesPerBatch: Number(maxHistogramEntriesPerBatch),
  },
  seasons: [
    {
      seasonId: Number(seasonId),
      seasonStartTs: now - 3600,
      seasonEndTs: now + 86400,
      commitGraceEndTs: now + 172800,
    },
  ],
};

fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
NODE
}

function seed_bootstrap() {
  note "Seeding bootstrap accounts"
  (
    cd "$KEEP_PUSHING_ROOT"
    RUNANA_ADMIN_KEYPAIR_PATH="$ADMIN_KEYPAIR_PATH" \
    RUNANA_PAYER_KEYPAIR_PATH="$ADMIN_KEYPAIR_PATH" \
    RUNANA_SPONSOR_KEYPAIR_PATH="$SPONSOR_KEYPAIR_PATH" \
    RUNANA_SERVER_SIGNER_KEYPAIR_PATH="$SERVER_SIGNER_KEYPAIR_PATH" \
    RUNANA_SOLANA_RPC_URL="$RPC_URL" \
    RUNANA_SOLANA_COMMITMENT="$SOLANA_COMMITMENT" \
    RUNANA_PROGRAM_ID="$PROGRAM_ID" \
    npm run solana:bootstrap -- --config "$BOOTSTRAP_CONFIG_PATH"
  )
}

function start_server_if_needed() {
  apply_prisma_migrations

  local status
  status="$(server_health_code)"
  if [[ "$status" == "405" || "$status" == "400" || "$status" == "404" ]]; then
    note "Reusing existing backend server at $SERVER_URL"
    return
  fi

  if [[ "${RUNANA_SKIP_SERVER_START:-0}" == "1" ]]; then
    fail "RUNANA_SKIP_SERVER_START=1 was set, but no server is reachable at $SERVER_URL"
  fi

  [[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL must be set before starting the backend server"

  note "Starting backend server at $SERVER_URL"
  (
    cd "$KEEP_PUSHING_ROOT"
    nohup env \
      DATABASE_URL="$DATABASE_URL" \
      RUNANA_SOLANA_RPC_URL="$RPC_URL" \
      RUNANA_SOLANA_COMMITMENT="$SOLANA_COMMITMENT" \
      RUNANA_PROGRAM_ID="$PROGRAM_ID" \
      RUNANA_PAYER_KEYPAIR_PATH="$ADMIN_KEYPAIR_PATH" \
      RUNANA_SPONSOR_KEYPAIR_PATH="$SPONSOR_KEYPAIR_PATH" \
      RUNANA_SERVER_SIGNER_KEYPAIR_PATH="$SERVER_SIGNER_KEYPAIR_PATH" \
      RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES="${RUNANA_AUTO_CREATE_SETTLEMENT_LOOKUP_TABLES:-0}" \
      PORT="$SERVER_PORT" \
      sh -lc 'npx prisma migrate deploy && npm run dev -- --hostname "$0" --port "$1"' \
      "$SERVER_HOST" "$SERVER_PORT" >"$SERVER_LOG_PATH" 2>&1 &
    echo "$!" >"$SERVER_PID_PATH"
  )

  wait_for_server
}

function create_anon_user() {
  note "Creating anon user"
  curl --silent --show-error \
    --fail \
    --request POST \
    --header 'content-type: application/json' \
    "$SERVER_URL/api/auth/anon" >"$ANON_USER_RESPONSE_PATH"
}

function write_prepare_request() {
  local user_id="$1"
  local player_pubkey="$2"

  node - "$PREPARE_REQUEST_PATH" "$user_id" "$player_pubkey" "$ZONE_ID" <<'NODE'
const fs = require('node:fs');

const [outputPath, userId, playerPubkey, zoneId] = process.argv.slice(2);

const request = {
  userId,
  authority: playerPubkey,
  feePayer: playerPubkey,
  name: 'Manual Localnet',
  initialUnlockedZoneId: Number(zoneId),
};

fs.writeFileSync(outputPath, JSON.stringify(request, null, 2));
NODE
}

function write_stop_script() {
  cat >"$STOP_SCRIPT_PATH" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for pid_file in "$SCRIPT_DIR/server.pid" "$SCRIPT_DIR/validator.pid"; do
  if [[ ! -f "$pid_file" ]]; then
    continue
  fi

  pid="$(cat "$pid_file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid"
    echo "stopped process $pid from $(basename "$pid_file")"
  else
    echo "process $pid from $(basename "$pid_file") is not running"
  fi
done
EOF
  chmod +x "$STOP_SCRIPT_PATH"
}

require_command curl
require_command node
require_command npm
require_command cargo-build-sbf
require_command solana
require_command solana-keygen
require_command solana-test-validator

prune_old_artifact_dirs

[[ -f "$PROGRAM_KEYPAIR_PATH" ]] || fail "program keypair not found at $PROGRAM_KEYPAIR_PATH"

if [[ "$PROGRAM_ID" != "$EXPECTED_PROGRAM_ID" ]]; then
  fail "RUNANA_PROGRAM_ID ($PROGRAM_ID) does not match program keypair pubkey ($EXPECTED_PROGRAM_ID) from $PROGRAM_KEYPAIR_PATH"
fi

build_program_if_needed
[[ -f "$PROGRAM_SO_PATH" ]] || fail "program binary not found at $PROGRAM_SO_PATH"

if [[ -n "${RUNANA_DB_CLEANUP_CMD:-}" ]]; then
  note "Running DB cleanup command"
  bash -lc "$RUNANA_DB_CLEANUP_CMD"
fi

create_keypair_if_missing "$DEPLOYER_KEYPAIR_PATH"
create_keypair_if_missing "$ADMIN_KEYPAIR_PATH"
create_keypair_if_missing "$SERVER_SIGNER_KEYPAIR_PATH"
create_keypair_if_missing "$PLAYER_KEYPAIR_PATH"
create_keypair_if_missing "$SPONSOR_KEYPAIR_PATH"

start_validator_if_needed

DEPLOYER_PUBKEY="$(solana-keygen pubkey "$DEPLOYER_KEYPAIR_PATH")"
ADMIN_PUBKEY="$(solana-keygen pubkey "$ADMIN_KEYPAIR_PATH")"
SERVER_SIGNER_PUBKEY="$(solana-keygen pubkey "$SERVER_SIGNER_KEYPAIR_PATH")"
PLAYER_PUBKEY="$(solana-keygen pubkey "$PLAYER_KEYPAIR_PATH")"
SPONSOR_PUBKEY="$(solana-keygen pubkey "$SPONSOR_KEYPAIR_PATH")"

airdrop_if_needed "$DEPLOYER_AIRDROP_SOL" "$DEPLOYER_PUBKEY"
airdrop_if_needed "$ADMIN_AIRDROP_SOL" "$ADMIN_PUBKEY"
airdrop_if_needed "$PLAYER_AIRDROP_SOL" "$PLAYER_PUBKEY"
if [[ "$SPONSOR_PUBKEY" != "$ADMIN_PUBKEY" && "$SPONSOR_PUBKEY" != "$DEPLOYER_PUBKEY" && "$SPONSOR_PUBKEY" != "$PLAYER_PUBKEY" ]]; then
  airdrop_if_needed "$ADMIN_AIRDROP_SOL" "$SPONSOR_PUBKEY"
fi

deploy_program_if_needed
write_bootstrap_config "$SERVER_SIGNER_PUBKEY"
seed_bootstrap
start_server_if_needed
create_anon_user

USER_ID="$(node -e "const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); if (!data.userId) { process.exit(1); } process.stdout.write(String(data.userId));" "$ANON_USER_RESPONSE_PATH")" \
  || fail "failed to parse anon user response from $ANON_USER_RESPONSE_PATH"

write_prepare_request "$USER_ID" "$PLAYER_PUBKEY"
write_stop_script

note "Manual character test stack is ready"
printf '\n'
printf 'Artifacts: %s\n' "$ARTIFACT_DIR"
printf 'RPC URL: %s\n' "$RPC_URL"
printf 'Server URL: %s\n' "$SERVER_URL"
printf 'Program ID: %s\n' "$PROGRAM_ID"
printf 'Validator ledger: %s\n' "$VALIDATOR_LEDGER_PATH"
printf 'Anon user: %s\n' "$USER_ID"
printf 'Player pubkey: %s\n' "$PLAYER_PUBKEY"
printf 'Sponsor pubkey: %s\n' "$SPONSOR_PUBKEY"
printf 'Prepare request: %s\n' "$PREPARE_REQUEST_PATH"
printf 'Anon user response: %s\n' "$ANON_USER_RESPONSE_PATH"
printf 'Validator log: %s\n' "$VALIDATOR_LOG_PATH"
printf 'Server log: %s\n' "$SERVER_LOG_PATH"
printf 'Stop helper: %s\n' "$STOP_SCRIPT_PATH"
printf '\n'
printf 'Next: POST %s/api/solana/character/create/prepare with the JSON from %s\n' "$SERVER_URL" "$PREPARE_REQUEST_PATH"
