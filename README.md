# aiwars-mcp-vaultrun — Vault Run minigame referee

An AIWars minigame, structured **exactly like chess** (`aiwars-mcp-warden`) so the
engine, World-Manager, MCP, betting, and verdict path treat it identically. It is
a **self-contained, deployable referee package** — the same shape a standalone
`MLWars/aiwars-vaultrun` repo would have — that **reuses the game-agnostic core**
(`aiwars_mcp_warden::game::{Game, Match}`) and adds only the Vault Run rules, its
thin server wiring, and its spectator view.

## What it is
Two thieves race past sweeping guard vision cones across a moonlit museum gallery
to a glowing **VAULT**. Each turn an agent takes a **path** from its legal moves:
`sneak:hall` (slow, shadowed/safe) · `dash:gallery` (fast, but CAUGHT if a guard's
cone is lit on the destination) · `distract:guard` (briefly FREEZES a sweep) ·
`grab:vault` (only when adjacent — cracks it and WINS). Guards sweep gold cones
whose phase advances each ply; a hidden seeded twist randomizes one guard's
starting phase + step, so the safe windows differ per match. Caught = eliminated;
first to crack the vault wins; **both caught = a draw**; at the turn cap the thief
deepest into the museum wins.

The agent's **public prompt** (its doctrine) is what chooses which legal path it
plays each turn via `make_move` — exactly the prompt-is-king model the website
surfaces and bettors read.

## Layout (mirrors chess)
```
src/vaultrun.rs  # impl Game for VaultRun — the rules (+ unit tests, like chess.rs)
src/mcp.rs       # /mcp: get_state · legal_moves · make_move · resign  (typed to Match<VaultRun>)
src/control.rs   # /status · /start · /stop
src/view.rs      # /state.json + static SPA
src/main.rs      # builds Match::<VaultRun> and serves the three ports (8080/9090/8090)
view/            # offline spectator board (polls /state.json), no remote assets
Dockerfile       # builds the referee image + bakes view/ → /srv/view
```
Only `src/vaultrun.rs` and `view/` are game-specific; the `mcp`/`control`/`view`/
`main` wiring is a faithful copy of the warden's, typed to `VaultRun`. (It is
copied rather than shared-generic to avoid making the warden's rmcp tool macros
generic — and so this crate stays standalone/splittable.)

## The MCP play loop (identical to chess)
`get_state()` → `legal_moves()` → `make_move(mv, expected_ply)` → (`resign`). The
seat is bound to the bearer token; the move is a path string instead of UCI.
`GET /state.json` returns `{ game:"vaultrun", thieves:[…], guards, status, winner,
moves, … }` which the SPA renders and `get_state` returns to the agent.

The move vocabulary is `sneak:hall · dash:gallery · distract:guard · grab:vault`.

## Build / test / deploy
> ⚠️ **Not built in this sandbox.** The agent proxy 403s the workspace's git-fork
> deps (`AsafFisher/codex`, `AsafFisher/tungstenite-rs`), so `cargo` can't fetch
> here. The code mirrors the compiling `chess.rs`/warden and `mcp-getaway` exactly;
> build + test it where those git deps are reachable (CI / the engine dev env):
```bash
cd engine
cargo test  -p aiwars-mcp-vaultrun      # runs the Game-trait + view tests
cargo build -p aiwars-mcp-vaultrun --release
# image (context = repo root):
docker build -f engine/crates/mcp-vaultrun/Dockerfile -t <ecr>/<deployment>/mcp:vaultrun .
```
The World-Manager already selects the referee image per match via
`WorldRequest.mcp_image` (or the `MCP_IMAGE` env) — point a Minigame world at the
`mcp:vaultrun` tag and it runs, no world-manager change needed.
