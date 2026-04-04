#!/usr/bin/env bash
set -euo pipefail

KEEP_PUSHING_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNANA_PROGRAM_ROOT="${RUNANA_PROGRAM_ROOT:-$(cd "$KEEP_PUSHING_ROOT/../runana-program" && pwd)}"
ARTIFACT_PARENT="${RUNANA_MANUAL_TEST_ROOT:-$KEEP_PUSHING_ROOT/.tmp/manual-character-test}"
RUN_ID="${RUNANA_MANUAL_TEST_RUN_ID:-$(date '+%Y%m%d-%H%M%S')}"
ARTIFACT_DIR="${RUNANA_MANUAL_TEST_DIR:-$ARTIFACT_PARENT/$RUN_ID}"
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
VALIDATOR_LOG_PATH="$LOG_DIR/validator.log"
SERVER_LOG_PATH="$LOG_DIR/server.log"
VALIDATOR_PID_PATH="$ARTIFACT_DIR/validator.pid"
SERVER_PID_PATH="$ARTIFACT_DIR/server.pid"
BOOTSTRAP_CONFIG_PATH="$ARTIFACT_DIR/bootstrap.json"
ANON_USER_RESPONSE_PATH="$ARTIFACT_DIR/anon-user.json"
PREPARE_REQUEST_PATH="$ARTIFACT_DIR/character-create-prepare.request.json"
STOP_SCRIPT_PATH="$ARTIFACT_DIR/stop-stack.sh"

mkdir -p "$LOG_DIR" "$KEYPAIR_DIR"

function note() {
  printf '[setup] %s\n' "$*"
}

function fail() {
  printf '[setup] ERROR: %s\n' "$*" >&2
  exit 1
}

function require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
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
    attempts=$((attempts + 1))
    sleep 1
  done

  fail "validator at $RPC_URL did not become ready in time; check $VALIDATOR_LOG_PATH"
}

function server_health_code() {
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request GET \
    "$SERVER_URL/api/auth/anon" || true
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

  note "Starting solana-test-validator at $RPC_URL"
  nohup solana-test-validator \
    --reset \
    --bind-address "$VALIDATOR_HOST" \
    --rpc-port "$VALIDATOR_PORT" \
    --ledger "$ARTIFACT_DIR/validator-ledger" >"$VALIDATOR_LOG_PATH" 2>&1 &
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

function write_bootstrap_config() {
  local trusted_server_signer="$1"

  node - "$BOOTSTRAP_CONFIG_PATH" "$trusted_server_signer" "$SEASON_ID" "$ZONE_ID" "$MAX_BATTLES_PER_BATCH" "$MAX_HISTOGRAM_ENTRIES_PER_BATCH" <<'NODE'
const fs = require('node:fs');

const [
  outputPath,
  trustedServerSigner,
  seasonId,
  zoneId,
  maxBattlesPerBatch,
  maxHistogramEntriesPerBatch,
] = process.argv.slice(2);

const now = Math.floor(Date.now() / 1000);
const config = {
  programConfig: {
    trustedServerSigner,
    settlementPaused: false,
    maxBattlesPerBatch: Number(maxBattlesPerBatch),
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
  zoneRegistries: [
    {
      zoneId: Number(zoneId),
      expMultiplierNum: 1,
      expMultiplierDen: 1,
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
    RUNANA_SERVER_SIGNER_KEYPAIR_PATH="$SERVER_SIGNER_KEYPAIR_PATH" \
    RUNANA_SOLANA_RPC_URL="$RPC_URL" \
    RUNANA_SOLANA_COMMITMENT="$SOLANA_COMMITMENT" \
    RUNANA_PROGRAM_ID="$PROGRAM_ID" \
    npm run solana:bootstrap -- --config "$BOOTSTRAP_CONFIG_PATH"
  )
}

function start_server_if_needed() {
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
      RUNANA_SERVER_SIGNER_KEYPAIR_PATH="$SERVER_SIGNER_KEYPAIR_PATH" \
      PORT="$SERVER_PORT" \
      npm run dev -- --hostname "$SERVER_HOST" --port "$SERVER_PORT" >"$SERVER_LOG_PATH" 2>&1 &
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

  node - "$PREPARE_REQUEST_PATH" "$user_id" "$player_pubkey" "$SEASON_ID" "$ZONE_ID" <<'NODE'
const fs = require('node:fs');

const [outputPath, userId, playerPubkey, seasonId, zoneId] = process.argv.slice(2);

const request = {
  userId,
  authority: playerPubkey,
  feePayer: playerPubkey,
  name: 'Manual Localnet',
  seasonIdAtCreation: Number(seasonId),
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
require_command solana
require_command solana-keygen
require_command solana-test-validator

[[ -f "$PROGRAM_KEYPAIR_PATH" ]] || fail "program keypair not found at $PROGRAM_KEYPAIR_PATH"
[[ -f "$PROGRAM_SO_PATH" ]] || fail "program binary not found at $PROGRAM_SO_PATH"

if [[ -n "${RUNANA_DB_CLEANUP_CMD:-}" ]]; then
  note "Running DB cleanup command"
  bash -lc "$RUNANA_DB_CLEANUP_CMD"
fi

create_keypair_if_missing "$DEPLOYER_KEYPAIR_PATH"
create_keypair_if_missing "$ADMIN_KEYPAIR_PATH"
create_keypair_if_missing "$SERVER_SIGNER_KEYPAIR_PATH"
create_keypair_if_missing "$PLAYER_KEYPAIR_PATH"

start_validator_if_needed

DEPLOYER_PUBKEY="$(solana-keygen pubkey "$DEPLOYER_KEYPAIR_PATH")"
ADMIN_PUBKEY="$(solana-keygen pubkey "$ADMIN_KEYPAIR_PATH")"
SERVER_SIGNER_PUBKEY="$(solana-keygen pubkey "$SERVER_SIGNER_KEYPAIR_PATH")"
PLAYER_PUBKEY="$(solana-keygen pubkey "$PLAYER_KEYPAIR_PATH")"

airdrop_if_needed "$DEPLOYER_AIRDROP_SOL" "$DEPLOYER_PUBKEY"
airdrop_if_needed "$ADMIN_AIRDROP_SOL" "$ADMIN_PUBKEY"
airdrop_if_needed "$PLAYER_AIRDROP_SOL" "$PLAYER_PUBKEY"

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
printf 'Anon user: %s\n' "$USER_ID"
printf 'Player pubkey: %s\n' "$PLAYER_PUBKEY"
printf 'Prepare request: %s\n' "$PREPARE_REQUEST_PATH"
printf 'Anon user response: %s\n' "$ANON_USER_RESPONSE_PATH"
printf 'Validator log: %s\n' "$VALIDATOR_LOG_PATH"
printf 'Server log: %s\n' "$SERVER_LOG_PATH"
printf 'Stop helper: %s\n' "$STOP_SCRIPT_PATH"
printf '\n'
printf 'Next: POST %s/api/solana/character/create/prepare with the JSON from %s\n' "$SERVER_URL" "$PREPARE_REQUEST_PATH"
