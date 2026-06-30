/* Vault Run — a moonlit isometric museum heist. Two thieves (Champions) creep
 * across a dark marble gallery toward a glowing VAULT, threading sweeping gold
 * guard VISION CONES. Their PUBLIC PROMPT is a doctrine: stay patient and quiet
 * (sneak hall-to-hall, wait out the sweeps) or go bold and fast (dash the open
 * galleries — but MOVE while a lit cone crosses you and you're SPOTTED → alarm →
 * caught). distract:guard briefly freezes a sweep to buy a window. grab:vault
 * (only when adjacent) wins. First to crack the vault wins; both caught = draw.
 *
 * Faithful to the engine Game-trait model: turn-based, opaque move-strings, the
 * agent plays via get_state → legal_moves → make_move(mv, ply). The prompt
 * decides which legal move it takes each turn. A HIDDEN seeded twist randomizes
 * one guard's patrol phase so the safe windows differ per match — identical
 * prompts don't always resolve the same way, keeping the odds live.
 */
(function () {
  const A = window.AW;
  const W = 780, H = 560;
  const ROOMS = 6;          // rooms 0..5; vault is reached at room ROOMS
  const GRID = ROOMS;       // number of advance steps to the vault

  // ---- iso layout -----------------------------------------------------------
  // The floor is an iso diamond. A thief lives at a "room" index (depth) and a
  // "lane" (0 = left hall, 1 = center gallery, 2 = right hall). Galleries (lane
  // 1) are open/lit (fast + exposed); halls (0,2) are along the walls (slow +
  // safe). The vault sits at the far (top) center.
  const ORIGIN = { x: W * 0.5, y: H - 96 };
  const TILE = 58;          // iso tile half-width
  const TILEH = 30;         // iso tile half-height
  const DEPTH = (H - 250) / ROOMS;
  // map a (room, lane) to screen. room advances "up" the diamond; lane spreads
  // across. We bias center lane to be the long open gallery corridor.
  function cell(room, lane) {
    const dy = ORIGIN.y - 70 - room * DEPTH;
    const spread = (lane - 1) * (118 - room * 7); // narrows toward the vault
    const x = ORIGIN.x + spread;
    return { x, y: dy };
  }
  const VAULT = { x: W * 0.5, y: ORIGIN.y - 70 - ROOMS * DEPTH + 6 };

  // Two guards sweep gold cones. Each has a fixed post (pivot) + a base sweep.
  // Guard 1 covers the lower-center galleries; guard 2 the upper-center. Their
  // phase advances each ply; one guard's phase offset is seeded (the twist).
  function guardPosts() {
    return [
      { id: 0, x: W * 0.5 - 92, y: ORIGIN.y - 70 - 1.6 * DEPTH, reach: 330, base: -0.05, span: 1.35 },
      { id: 1, x: W * 0.5 + 92, y: ORIGIN.y - 70 - 3.7 * DEPTH, reach: 340, base: Math.PI + 0.05, span: 1.35 },
    ];
  }

  // ---- doctrine -------------------------------------------------------------
  const KW = {
    bold: ["fast", "dash", "bold", "rush", "speed", "quick", "sprint", "aggressive", "gallery", "sprint", "race", "charge", "blitz"],
    patient: ["patient", "stealth", "quiet", "wait", "careful", "slow", "shadow", "cautious", "hall", "hold", "creep", "sneak"],
  };
  function doctrine(prompt) {
    const p = (prompt || "").toLowerCase();
    let b = 0, pt = 0;
    for (const k of KW.bold) if (p.includes(k)) b++;
    for (const k of KW.patient) if (p.includes(k)) pt++;
    if (b === 0 && pt === 0) return { kind: "balanced", tag: "opportunist", aggro: 0.5 };
    if (b > pt) return { kind: "bold", tag: "gallery sprinter", aggro: 0.9 };
    if (pt > b) return { kind: "patient", tag: "shadow ghost", aggro: 0.12 };
    return { kind: "balanced", tag: "opportunist", aggro: 0.5 };
  }
  function highlight(prompt) {
    let h = prompt || "";
    h = h.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
    for (const k of [...new Set([...KW.bold, ...KW.patient])]) {
      h = h.replace(new RegExp("\\b(" + k + ")\\b", "ig"), "<b>$1</b>");
    }
    return h;
  }

  const DEF_A = "Stay patient and quiet. Creep hall to hall in the shadows, wait out every guard sweep, and only break for the vault when the cone is dark. Careful beats caught.";
  const DEF_B = "Go bold and fast. Dash straight through the open galleries, distract a guard if I must, and rush the vault before they ever lock their sweep on me. Speed wins.";

  // ---- cone math: is a point lit by a guard at a given phase? ----------------
  function coneAt(g, phase) {
    // sweep angle oscillates around base by span*sin(phase)
    const a = g.base + Math.sin(phase) * g.span;
    return a;
  }
  function pointLit(g, ang, px, py) {
    const dx = px - g.x, dy = py - g.y;
    const dist = Math.hypot(dx, dy);
    if (dist > g.reach || dist < 6) return false;
    let pa = Math.atan2(dy, dx);
    let d = Math.abs(((pa - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    return d < 0.42; // half-cone width
  }

  // ---- the deterministic engine --------------------------------------------
  function build(seed, opts) {
    const rng = A.rng(seed);
    const prompts = { A: (opts.prompts && opts.prompts.A) || DEF_A, B: (opts.prompts && opts.prompts.B) || DEF_B };
    const doc = { A: doctrine(prompts.A), B: doctrine(prompts.B) };
    const guards = guardPosts();

    // HIDDEN TWIST: seed each guard's starting phase + per-ply phase step. One
    // guard gets a fully seeded random offset so the lit windows differ each
    // match. The phase a thief is exposed to at a given ply is deterministic but
    // unknowable from the prompts alone — keeps odds live.
    const phase0 = [rng() * Math.PI * 2, rng() * Math.PI * 2];
    const step = [0.62 + rng() * 0.10, 0.74 + rng() * 0.12];
    const twistGuard = rng() < 0.5 ? 0 : 1;       // which guard is "the wild one"
    // phase used to evaluate exposure at a given global ply
    const guardPhase = (gi, ply) => phase0[gi] + step[gi] * ply;

    // helper: at ply P, is cell (room,lane) swept by any guard?
    function litness(room, lane, ply) {
      const c = cell(room, lane);
      let lit = 0, near = 0, byG = null;
      for (const g of guards) {
        if (frozen[g.id] >= ply) continue;        // a frozen sweep lights nothing
        const ang = coneAt(g, guardPhase(g.id, ply));
        if (pointLit(g, ang, c.x, c.y)) { lit++; if (byG == null) byG = g.id; }
        const dist = Math.hypot(c.x - g.x, c.y - g.y);
        if (dist < g.reach) near++;
      }
      return { lit, near, byG };
    }

    const st = {
      A: { room: 0, lane: 0, caught: false, cracked: false, distracts: 2, spotted: false, lastPly: 0 },
      B: { room: 0, lane: 2, caught: false, cracked: false, distracts: 2, spotted: false, lastPly: 0 },
    };
    const beats = [];
    const oddsHist = [];
    let ply = 1, winner = undefined, winReason = "closer", done = false;
    let frozen = { 0: -99, 1: -99 }; // guard id -> ply until which it's frozen

    function legalFor(me, id) {
      const mv = [];
      const adjacent = me.room >= ROOMS - 1;
      // sneak:hall — move up staying in/towards a wall hall (safe, +1 room, lane->0/2)
      mv.push("sneak:hall");
      // dash:gallery — move up through center gallery (fast, +1 room but lit risk)
      mv.push("dash:gallery");
      // distract:guard — freeze a sweep (only if charges left and not adjacent-win)
      if (me.distracts > 0) mv.push("distract:guard");
      // wait:cover — hold in shadow, let the sweep pass (loses tempo, always safe)
      mv.push("wait:cover");
      // grab:vault — only when adjacent
      if (adjacent) mv.push("grab:vault");
      return mv;
    }

    function snapOdds() {
      const f = (me, op) => {
        if (st[me].cracked) return 6;
        if (st[me].caught) return -6;
        const lead = (st[me].room - st[op].room) * 0.6;
        const safety = (st[op].caught ? 3 : 0);
        // exposure: how lit is my next likely cell this ply
        const ln = litness(Math.min(ROOMS - 1, st[me].room + 1), doc[me].kind === "bold" ? 1 : 0, ply);
        const risk = -ln.lit * 0.5;
        return lead + safety + risk + (st[me].distracts) * 0.12;
      };
      let a = 1 / (1 + Math.exp(-f("A", "B")));
      let b = 1 / (1 + Math.exp(-f("B", "A")));
      const s = a + b || 1; a /= s; b /= s;
      return { A: a * 100, B: b * 100 };
    }
    oddsHist.push(snapOdds());

    function nameOf(id) { return id === "A" ? "Ghost" : "Cipher"; }

    // choose a move from doctrine + current exposure
    function choose(id) {
      const me = st[id], op = st[id === "A" ? "B" : "A"];
      const d = doc[id];
      const adjacent = me.room >= ROOMS - 1;
      if (adjacent) return { move: "grab:vault", lane: me.lane };

      const nextRoom = me.room + 1;
      const galleryLit = litness(nextRoom, 1, ply);
      const hallLane = me.lane === 2 ? 2 : 0;
      const hallLit = litness(nextRoom, hallLane, ply);

      if (d.kind === "bold") {
        // bold rushes the gallery EVERY turn — speed is the whole plan. It only
        // burns a distract if the gallery is lit right now AND it has a charge;
        // out of charges, it dashes anyway and risks the alarm.
        if (galleryLit.lit > 0 && me.distracts > 0) return { move: "distract:guard", lane: 1, target: galleryLit.byG };
        return { move: "dash:gallery", lane: 1 };
      }
      if (d.kind === "patient") {
        // patient is CAUTIOUS: it only commits to a hall when the sweep is well
        // clear — not merely dark this instant, but dark this ply AND the next
        // (it won't step into a cone that's about to arrive). That extra caution
        // is exactly why it's slow: most plies it has to hold in cover. With a
        // charge it can buy a window by freezing the watcher.
        const soonLit = litness(nextRoom, hallLane, ply + 1);
        const safeNow = hallLit.lit === 0 && soonLit.lit === 0;
        if (!safeNow) {
          if (me.distracts > 0) return { move: "distract:guard", lane: hallLane, target: (hallLit.byG != null ? hallLit.byG : soonLit.byG) };
          return { move: "wait:cover", lane: me.lane };
        }
        return { move: "sneak:hall", lane: hallLane };
      }
      // balanced: take whichever next cell is dark; prefer gallery (faster) if dark
      if (galleryLit.lit === 0) return { move: "dash:gallery", lane: 1 };
      if (hallLit.lit === 0) return { move: "sneak:hall", lane: hallLane };
      if (me.distracts > 0) return { move: "distract:guard", lane: 1, target: galleryLit.byG != null ? galleryLit.byG : 0 };
      return { move: "wait:cover", lane: me.lane };
    }

    function turn(id) {
      const me = st[id], op = st[id === "A" ? "B" : "A"];
      if (me.caught || me.cracked) return;
      const legal = legalFor(me, id);
      const ch = choose(id);
      let move = ch.move;
      if (!legal.includes(move)) move = legal[0];

      const fromCell = cell(me.room, me.lane);
      let result, ok = true, events;
      let spottedNow = false, toLane = me.lane, toRoom = me.room;
      const d = doc[id];

      if (move === "grab:vault") {
        me.cracked = true;
        toLane = 1; toRoom = ROOMS;
        result = "VAULT CRACKED · loot secured";
        events = [`${nameOf(id)} reaches the vault and cracks it open!`];
      } else if (move === "distract:guard") {
        const tgt = ch.target != null ? ch.target : (id === "A" ? 0 : 1);
        frozen[tgt] = ply + 1;            // that guard's sweep freezes for this+next ply
        me.distracts--;
        result = "ok · guard " + (tgt + 1) + " sweep frozen · " + me.distracts + " left";
        events = [`${nameOf(id)} lobs a distraction — guard ${tgt + 1}'s sweep freezes.`];
        // stays in place this turn
      } else if (move === "wait:cover") {
        // hold position in shadow until the sweep rotates away — safe, costs tempo
        result = "ok · held in cover · waiting out the sweep";
        events = [`${nameOf(id)} freezes in a shadow, letting the cone sweep past.`];
      } else {
        // a move: sneak:hall or dash:gallery → advance one room into a lane.
        toRoom = me.room + 1;
        toLane = move === "dash:gallery" ? 1 : (me.lane === 2 ? 2 : 0);
        const dest = cell(toRoom, toLane);
        // exposure check: is the destination lit at THIS ply (unless guard frozen)?
        let lit = false, byGuard = -1;
        for (const g of guards) {
          if (frozen[g.id] >= ply) continue;          // frozen sweep can't catch
          const ang = coneAt(g, guardPhase(g.id, ply));
          if (pointLit(g, ang, dest.x, dest.y)) { lit = true; byGuard = g.id; }
        }
        // halls are along walls: a small chance the cone clips them; galleries
        // are dead-center and far more exposed. Patient doctrine also "peeks"
        // and only commits if it believes dark — but the seeded phase can fool
        // it (the twist), so patient can still very occasionally get caught.
        if (lit) {
          // patient doctrine reads the sweep and may abort into a freeze instead
          // of crossing — but only if it still has charges. If it has none, it
          // crosses and gets caught.
          me.room = toRoom; me.lane = toLane;
          me.caught = true; me.spotted = true; spottedNow = true;
          ok = false;
          result = "SPOTTED · alarm · caught by guard " + (byGuard + 1);
          events = [`${nameOf(id)} ${move === "dash:gallery" ? "dashes the lit gallery" : "slips into a lit hall"} — SPOTTED! Alarm screams, caught.`];
        } else {
          me.room = toRoom; me.lane = toLane;
          result = "ok · room " + toRoom + "/" + ROOMS + (toRoom >= ROOMS - 1 ? " · vault adjacent" : "");
          events = [`${nameOf(id)} ${move === "dash:gallery" ? "dashes the dark gallery" : "creeps the shadowed hall"} to room ${toRoom}.`];
        }
      }

      const toCell = me.cracked ? VAULT : cell(me.room, me.lane);
      const thought = d.kind === "bold"
        ? "Open gallery, straight line — speed before they lock the sweep."
        : d.kind === "patient" ? "Wait for the cone to pass; only move through the dark."
        : "Take whichever path is dark right now — thread the windows.";

      // observe: what get_state shows this agent
      const nextGalleryLit = litness(Math.min(ROOMS - 1, me.room + 1), 1, ply + 1).lit > 0;
      beats.push({
        ply: ply++, agent: id,
        thought,
        observe: {
          room: me.cracked ? "VAULT" : me.room + "/" + ROOMS,
          lane: toLane === 1 ? "gallery" : "hall",
          cones_ahead: nextGalleryLit ? "gallery-lit" : "dark-window",
          distracts: me.distracts,
        },
        legal,
        move, ok, result,
        state: {
          A: { ...st.A }, B: { ...st.B }, mover: id,
          fromCell, toCell, move, spottedNow,
          frozen: { ...frozen }, ply: ply - 1,
          phase0, step, guards,
        },
        events,
      });
      oddsHist.push(snapOdds());

      if (me.cracked) { winner = id; winReason = "crack"; done = true; }
      else if (st.A.caught && st.B.caught) { winner = null; winReason = "doublecaught"; done = true; }
      else if (op.caught && !me.caught) {
        // rival caught — opponent eliminated; this thief keeps going (not auto-win)
      }
    }

    // play rounds, alternating A then B, until someone cracks or both caught
    const MAXR = ROOMS + 4;
    for (let r = 0; r < MAXR && !done; r++) {
      for (const id of ["A", "B"]) {
        if (done) break;
        if (st[id].caught || st[id].cracked) continue;
        turn(id);
      }
      // decay freezes that have expired handled inline via >= ply check
    }

    if (winner === undefined) {
      if (st.A.caught && st.B.caught) { winner = null; winReason = "doublecaught"; }
      else if (st.A.caught && !st.B.caught) { winner = "B"; winReason = "caught"; }
      else if (st.B.caught && !st.A.caught) { winner = "A"; winReason = "caught"; }
      else { winner = st.A.room === st.B.room ? null : st.A.room > st.B.room ? "A" : "B"; winReason = winner == null ? "stalemate" : "closer"; }
    }

    function finalLine() {
      if (winner == null) return winReason === "doublecaught" ? "Draw — both thieves tripped the alarm and were caught." : "Stalemate — neither thief reached the vault.";
      const loser = winner === "A" ? "B" : "A";
      if (winReason === "crack") return `${nameOf(winner)} cracks the vault first — the run is theirs.`;
      if (winReason === "caught") return `${nameOf(loser)} was SPOTTED and caught — ${nameOf(winner)} takes the vault by default.`;
      return `Run called — ${nameOf(winner)} was deepest into the museum.`;
    }

    beats.push({
      ply: ply++, agent: "ref", move: "resolve", legal: null,
      observe: { winner: winner == null ? "draw" : nameOf(winner), reason: winReason },
      result: winner == null ? "draw — " + winReason : nameOf(winner) + " wins · " + winReason,
      events: [finalLine()],
      state: { A: { ...st.A }, B: { ...st.B }, mover: null, final: true, phase0, step, guards, ply: ply - 1, frozen: { ...frozen } },
    });

    return {
      seed, beats, winner, winReason,
      names: { A: nameOf("A"), B: nameOf("B") },
      promptOf: (id) => highlight(prompts[id]),
      tagOf: (id) => doc[id].tag,
      oddsAt: (b) => oddsHist[Math.min(b, oddsHist.length - 1)] || { A: 50, B: 50 },
      _doc: doc, _twistGuard: twistGuard, _phase0: phase0, _step: step,
    };
  }

  // ====== RENDER =============================================================
  function thiefPos(res, beat, beatT) {
    const out = { A: null, B: null };
    for (const id of ["A", "B"]) {
      let cur = null;
      for (let k = 0; k <= beat; k++) {
        const bt = res.beats[k];
        if (bt.agent === id && bt.state) cur = bt;
      }
      if (!cur) { const c = cell(0, id === "A" ? 0 : 2); out[id] = { x: c.x, y: c.y, moving: false, caught: false }; continue; }
      const from = cur.state.fromCell, to = cur.state.toCell;
      const active = res.beats[beat] && res.beats[beat].agent === id && res.beats[beat].state && !res.beats[beat].state.final;
      const tt = active ? A.easeOut(beatT) : 1;
      const s = cur.state[id];
      out[id] = {
        x: A.lerp(from.x, to.x, tt), y: A.lerp(from.y, to.y, tt),
        moving: active && beatT < 0.95 && (from.x !== to.x || from.y !== to.y),
        caught: s.caught, cracked: s.cracked,
      };
    }
    return out;
  }

  function draw(ctx, v) {
    const t = v.t, res = v.result, beat = v.beat, bt = res.beats[beat];
    const stt = bt && bt.state ? bt.state : { A: { room: 0, lane: 0 }, B: { room: 0, lane: 2 } };
    const curPly = stt.ply != null ? stt.ply : 0;
    const frozen = stt.frozen || { 0: -99, 1: -99 };
    const guards = stt.guards || guardPosts();
    const phase0 = stt.phase0 || res._phase0;
    const step = stt.step || res._step;

    // animated phase for live cones (interpolate the guard sweep between plies)
    const animPly = curPly + (res.beats[beat] && res.beats[beat].agent !== "ref" ? v.beatT : 0);

    A.nightSky(ctx, W, H, t, ["#060512", "#120a28", "#241640"]);
    moonWindows(ctx, t);
    floor(ctx, res.seed, t);
    // alarm is live whenever a thief is currently caught/spotted in this state
    const alarmLive = !!(stt && ((stt.A && stt.A.caught) || (stt.B && stt.B.caught)));
    laserTripwires(ctx, res.seed, t, alarmLive);
    plinths(ctx, res.seed, t);
    vaultDoor(ctx, t, res.winner != null && v.over, v);

    const thieves = thiefPos(res, beat, v.beatT);

    // guard cones (under thieves so thieves read on top, but glow over floor)
    guards.forEach((g) => {
      const isFrozen = frozen[g.id] >= curPly && !v.over;
      const phase = phase0[g.id] + step[g.id] * (isFrozen ? curPly : animPly);
      guardCone(ctx, g, phase, t, isFrozen);
    });

    // ambient: dust motes
    dust(ctx, t);

    // thieves (caught/leader ordering: draw caught first/under)
    const order = (thieves.A && thieves.A.caught) ? ["A", "B"] : ["B", "A"];
    for (const id of order) if (thieves[id]) thief(ctx, thieves[id], id, res.names[id], t, v);

    // guard sprites on top of cones
    guards.forEach((g) => guardSprite(ctx, g, phase0[g.id] + step[g.id] * (frozen[g.id] >= curPly && !v.over ? curPly : animPly), t, frozen[g.id] >= curPly && !v.over));

    hud(ctx, res, stt, t);
    dispatcher(ctx, res, bt, v);

    // spotted flash
    if (!v.over && bt && bt.state && bt.state.spottedNow) {
      spottedFlash(ctx, thieves[bt.agent], v.beatT);
    }

    if (v.over) finishOverlay(ctx, res, t);
    vignette(ctx);
  }

  // --- scene pieces ----------------------------------------------------------
  function moonWindows(ctx, t) {
    // tall arched museum windows along the back wall with moonlight pouring in
    const wins = [[70, 30], [200, 30], [560, 30], [690, 30]];
    for (const [x, y] of wins) {
      const g = ctx.createLinearGradient(x, y, x, y + 120);
      g.addColorStop(0, "rgba(150,180,255,0.20)"); g.addColorStop(1, "rgba(150,180,255,0.02)");
      ctx.fillStyle = "#0a0f24"; ctx.beginPath();
      ctx.moveTo(x, y + 110); ctx.lineTo(x, y + 26); ctx.arc(x + 22, y + 26, 22, Math.PI, 0); ctx.lineTo(x + 44, y + 110); ctx.closePath(); ctx.fill();
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x + 3, y + 108); ctx.lineTo(x + 3, y + 28); ctx.arc(x + 22, y + 28, 19, Math.PI, 0); ctx.lineTo(x + 41, y + 108); ctx.closePath(); ctx.fill();
      // mullions
      ctx.strokeStyle = "rgba(8,12,28,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 22, y + 20); ctx.lineTo(x + 22, y + 108); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y + 64); ctx.lineTo(x + 41, y + 64); ctx.stroke();
      // moonlight pool on the floor below
      A.glow(ctx, x + 22, y + 150, 60, "rgba(150,180,255,0.05)");
    }
    // the moon itself in one window
    ctx.fillStyle = "#e9edff"; ctx.beginPath(); ctx.arc(582, 56, 15, 0, 7); ctx.fill();
    ctx.fillStyle = "#0a0f24"; ctx.beginPath(); ctx.arc(576, 50, 12, 0, 7); ctx.fill();
  }

  function floor(ctx, seed, t) {
    // dark marble iso floor: a big diamond with a subtle checker grid + sheen.
    const top = cell(ROOMS + 0.4, 1);
    const cx = ORIGIN.x;
    // floor polygon corners
    const halfW = 330, halfH = 215;
    const bottom = { x: cx, y: ORIGIN.y + 30 };
    const apex = { x: cx, y: VAULT.y - 30 };
    const lx = { x: cx - halfW, y: (bottom.y + apex.y) / 2 + 30 };
    const rx = { x: cx + halfW, y: (bottom.y + apex.y) / 2 + 30 };
    ctx.fillStyle = "#0c0a18";
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.fill();
    // grid lines (iso). draw two families of parallel lines.
    ctx.save();
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.clip();
    ctx.lineWidth = 1;
    for (let i = -16; i <= 16; i++) {
      const f = i / 16;
      ctx.strokeStyle = "rgba(90,80,140,0.10)";
      // family 1: bottom-left edge direction
      ctx.beginPath();
      ctx.moveTo(A.lerp(lx.x, bottom.x, (f + 1) / 2), A.lerp(lx.y, bottom.y, (f + 1) / 2));
      ctx.lineTo(A.lerp(apex.x, rx.x, (f + 1) / 2), A.lerp(apex.y, rx.y, (f + 1) / 2));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(A.lerp(lx.x, apex.x, (f + 1) / 2), A.lerp(lx.y, apex.y, (f + 1) / 2));
      ctx.lineTo(A.lerp(bottom.x, rx.x, (f + 1) / 2), A.lerp(bottom.y, rx.y, (f + 1) / 2));
      ctx.stroke();
    }
    // marble sheen sweeping band
    const sx = (Math.sin(t / 2600) * 0.5 + 0.5);
    const bandX = A.lerp(lx.x, rx.x, sx);
    const sg = ctx.createLinearGradient(bandX - 80, 0, bandX + 80, 0);
    sg.addColorStop(0, "rgba(120,140,220,0)"); sg.addColorStop(0.5, "rgba(120,140,220,0.05)"); sg.addColorStop(1, "rgba(120,140,220,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, apex.y, W, ORIGIN.y + 40 - apex.y);
    ctx.restore();
    // edge rim light
    ctx.strokeStyle = "rgba(120,110,180,0.25)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.stroke();
  }

  function laserTripwires(ctx, seed, t, alarmLive) {
    // Static perimeter security beams. In a calm run they're DORMANT — emitters
    // idle amber, the beam barely a hairline (purely set dressing, so they don't
    // tease a mechanic that never fires). The instant the alarm trips (a thief is
    // SPOTTED) the whole grid arms HOT red and pulses — a real, visible
    // consequence of the only state that can fire it.
    const lines = [
      [cell(1.6, 0), cell(1.6, 2)],
      [cell(3.2, 0.2), cell(3.2, 1.8)],
      [cell(4.4, 0), cell(4.4, 2)],
    ];
    lines.forEach((ln, i) => {
      const p0 = ln[0], p1 = ln[1];
      if (alarmLive) {
        const pulse = Math.sin(t / 120 + i * 1.3) * 0.5 + 0.5;
        const a = 0.45 + 0.45 * pulse;
        ctx.save();
        ctx.shadowColor = "rgba(255,60,80,0.9)"; ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(255,70,90,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "#ff5a6e";
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 3, 0, 7); ctx.fill();
      } else {
        // dormant: faint dashed hairline + dim amber emitter nubs
        ctx.save();
        ctx.setLineDash([3, 7]);
        ctx.strokeStyle = "rgba(150,130,110,0.10)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = "rgba(180,150,90,0.55)";
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 1.8, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 1.8, 0, 7); ctx.fill();
      }
    });
  }

  function plinths(ctx, seed, t) {
    // display plinths with little glowing artefacts, scattered on the wings.
    const spots = [
      [0, 0.7], [2, 0.5], [4, 0.6], [0, 2.6], [2, 3.4], [4, 4.5], [1.2, 5.1],
    ];
    spots.forEach(([lane, room], i) => {
      const c = cell(room, lane);
      const r = A.rng(seed * 53 + i * 11);
      const w = 22, h = 16, d = 30;
      // plinth box
      A.shadow(ctx, c.x + d / 2, c.y + 6, 20, 6, 0.4);
      A.box(ctx, c.x - w / 2, c.y - d, w, d, 8, "#15122a", "#211a3e", "#0d0a1c");
      // glass case
      ctx.fillStyle = "rgba(120,150,220,0.08)";
      A.rrect(ctx, c.x - w / 2 + 2, c.y - d - 22, w - 4, 22, 3); ctx.fill();
      ctx.strokeStyle = "rgba(150,180,240,0.18)"; ctx.lineWidth = 1; ctx.stroke();
      // artefact: a glowing gem / mask, type by index
      const ty = i % 3;
      const gx = c.x, gy = c.y - d - 11;
      const pulse = 0.5 + 0.5 * Math.sin(t / 700 + i);
      const col = ty === 0 ? "255,200,90" : ty === 1 ? "120,220,255" : "200,120,255";
      A.glow(ctx, gx, gy, 16, `rgba(${col},${0.10 + pulse * 0.14})`);
      ctx.fillStyle = `rgba(${col},0.9)`;
      if (ty === 0) { ctx.beginPath(); ctx.moveTo(gx, gy - 6); ctx.lineTo(gx + 5, gy); ctx.lineTo(gx, gy + 6); ctx.lineTo(gx - 5, gy); ctx.closePath(); ctx.fill(); }
      else if (ty === 1) { ctx.beginPath(); ctx.arc(gx, gy, 5, 0, 7); ctx.fill(); }
      else { ctx.fillRect(gx - 4, gy - 6, 8, 12); }
    });
  }

  function vaultDoor(ctx, t, cracked, v) {
    const x = VAULT.x, y = VAULT.y;
    // back wall recess
    A.shadow(ctx, x, y + 30, 64, 14, 0.4);
    // pulsing aura
    const pulse = 0.5 + 0.5 * Math.sin(t / 520);
    const auraCol = cracked ? "rgba(255,210,90," : "rgba(120,150,230,";
    A.glow(ctx, x, y, 90, auraCol + (0.14 + pulse * 0.16) + ")");
    // door frame
    ctx.fillStyle = "#1a1630"; A.rrect(ctx, x - 52, y - 46, 104, 86, 10); ctx.fill();
    ctx.fillStyle = "#100d22"; A.rrect(ctx, x - 46, y - 40, 92, 76, 8); ctx.fill();
    // big circular vault dial
    const dialCol = cracked ? "#ffd45a" : "#7c8fd6";
    ctx.strokeStyle = dialCol; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y - 2, 30, 0, 7); ctx.stroke();
    ctx.strokeStyle = cracked ? "#ffe89a" : "#9fb0ff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - 2, 22, 0, 7); ctx.stroke();
    // spokes (rotate slowly; spin fast on crack)
    const rot = cracked ? t / 90 : t / 1400;
    ctx.save(); ctx.translate(x, y - 2); ctx.rotate(rot);
    ctx.strokeStyle = dialCol; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.stroke(); }
    ctx.fillStyle = dialCol; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
    ctx.restore();
    // tick marks
    ctx.fillStyle = cracked ? "#ffe89a" : "#5b6aa8";
    for (let i = 0; i < 12; i++) { const a = i / 12 * 7; ctx.fillRect(x + Math.cos(a) * 33 - 1, y - 2 + Math.sin(a) * 33 - 1, 2, 2); }
    // VAULT label plate
    ctx.fillStyle = "rgba(8,10,24,0.9)"; A.rrect(ctx, x - 30, y + 30, 60, 16, 4); ctx.fill();
    A.label(ctx, x, y + 42, cracked ? "CRACKED" : "VAULT", 10, cracked ? "#ffd45a" : "#9fb0ff", "center");
  }

  function guardCone(ctx, g, phase, t, frozen) {
    const ang = coneAt(g, phase);
    const half = 0.42, reach = g.reach;
    const col = frozen ? "120,160,255" : "255,196,64";
    // gradient cone — stronger fill in calm so the sweep danger reads frame-to-frame
    ctx.save();
    ctx.translate(g.x, g.y); ctx.rotate(ang);
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(0, 0, 8, 0, 0, reach);
    grad.addColorStop(0, `rgba(${col},${frozen ? 0.14 : 0.34})`);
    grad.addColorStop(0.55, `rgba(${col},${frozen ? 0.08 : 0.18})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -half, half); ctx.closePath(); ctx.fill();
    // a sharp BRIGHT leading edge wedge (the dangerous front of the sweep)
    if (!frozen) {
      const lead = ctx.createLinearGradient(0, 0, Math.cos(half) * reach, Math.sin(half) * reach);
      lead.addColorStop(0, `rgba(${col},0)`); lead.addColorStop(1, `rgba(${col},0.30)`);
      ctx.fillStyle = lead;
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.arc(0, 0, reach, half - 0.13, half); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    // crisp edge lines
    ctx.strokeStyle = `rgba(${col},${frozen ? 0.18 : 0.55})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(half) * reach, Math.sin(half) * reach); ctx.stroke();
    ctx.strokeStyle = `rgba(${col},${frozen ? 0.14 : 0.30})`;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(-half) * reach, Math.sin(-half) * reach); ctx.stroke();
    ctx.restore();
    // a clear LIT FLOOR POOL where the cone lands — brighter, two-ring so the
    // swept ground reads as genuinely lit (danger) not just a faint smudge.
    const tipx = g.x + Math.cos(ang) * reach * 0.78, tipy = g.y + Math.sin(ang) * reach * 0.78;
    if (!frozen) {
      A.glow(ctx, tipx, tipy, 54, `rgba(${col},0.22)`);
      A.glow(ctx, tipx, tipy, 22, `rgba(255,235,180,0.20)`);
    } else {
      A.glow(ctx, tipx, tipy, 40, `rgba(${col},0.10)`);
    }
  }

  function guardSprite(ctx, g, phase, t, frozen) {
    const ang = coneAt(g, phase);
    const x = g.x, y = g.y;
    A.shadow(ctx, x, y + 16, 16, 5, 0.4);
    // body
    ctx.fillStyle = frozen ? "#3a4670" : "#2a2438";
    A.rrect(ctx, x - 11, y - 14, 22, 30, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)"; A.rrect(ctx, x - 11, y - 14, 22, 6, 5); ctx.fill();
    // head
    ctx.fillStyle = "#d9b48c"; ctx.beginPath(); ctx.arc(x, y - 20, 9, 0, 7); ctx.fill();
    // cap
    ctx.fillStyle = frozen ? "#5566a0" : "#1c1830"; A.rrect(ctx, x - 10, y - 28, 20, 9, 4); ctx.fill();
    ctx.fillRect(x - 2, y - 31, 4, 4);
    // facing chevron (a flashlight nub) pointing along the cone
    ctx.fillStyle = frozen ? "#9fb0ff" : "#ffd45a";
    ctx.beginPath(); ctx.arc(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12, 3.5, 0, 7); ctx.fill();
    // "GUARD" / "FROZEN" tag — below the guard, with a border so it stays legible
    ctx.fillStyle = "rgba(8,10,24,0.92)"; A.rrect(ctx, x - 24, y + 18, 48, 14, 4); ctx.fill();
    ctx.strokeStyle = frozen ? "rgba(159,176,255,0.5)" : "rgba(255,207,107,0.4)";
    ctx.lineWidth = 1; A.rrect(ctx, x - 23.5, y + 18.5, 47, 13, 4); ctx.stroke();
    A.label(ctx, x, y + 28, frozen ? "● FROZEN" : "GUARD " + (g.id + 1), 8, frozen ? "#9fb0ff" : "#ffcf6b", "center");
  }

  function thief(ctx, p, id, name, t, v) {
    const col = id === "A" ? "#10b981" : "#8b5cf6";
    const soft = id === "A" ? "#5eead4" : "#c4b5fd";
    const x = p.x, y = p.y;
    A.shadow(ctx, x, y + 16, 14, 5, 0.4);
    // translucent "ghost" thief body
    const alpha = p.caught ? 1 : 0.82;
    ctx.save();
    ctx.globalAlpha = alpha;
    // trailing wisp when moving
    if (p.moving && !A.reduced) {
      const g = ctx.createLinearGradient(x, y + 16, x, y - 16);
      g.addColorStop(0, col + "00"); g.addColorStop(1, col + "55");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, 9, 18, 0, 0, 7); ctx.fill();
    }
    // cloak body
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.quadraticCurveTo(x + 14, y - 14, x + 12, y + 14);
    ctx.quadraticCurveTo(x, y + 18, x - 12, y + 14);
    ctx.quadraticCurveTo(x - 14, y - 14, x, y - 24);
    ctx.closePath(); ctx.fill();
    // sheen
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.quadraticCurveTo(x + 9, y - 12, x + 7, y + 2); ctx.quadraticCurveTo(x, y, x - 2, y - 10); ctx.closePath(); ctx.fill();
    // hood + face shadow
    ctx.fillStyle = id === "A" ? "#0a5c44" : "#4a307c";
    ctx.beginPath(); ctx.arc(x, y - 22, 9, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#0a0a14"; ctx.beginPath(); ctx.arc(x, y - 18, 6, 0, 7); ctx.fill();
    // glowing eyes
    ctx.fillStyle = soft; ctx.fillRect(x - 4, y - 19, 2.5, 2.5); ctx.fillRect(x + 1.5, y - 19, 2.5, 2.5);
    ctx.restore();
    // soft aura
    A.glow(ctx, x, y - 6, 26, (id === "A" ? "rgba(16,185,129," : "rgba(139,92,246,") + (p.caught ? "0.05" : "0.16") + ")");

    // name tag — ABOVE the sprite so it never collides with the GUARD plates
    // (which sit below their guards). Solid bg + thin border so it never
    // truncates against a cone or a plate even when a thief stands on a pivot.
    const label = (p.caught ? "✖ " : p.cracked ? "★ " : "") + name.toUpperCase();
    ctx.font = `700 9px ui-monospace,"DejaVu Sans Mono",monospace`;
    const w = Math.max(54, ctx.measureText(label).width + 16);
    const ty = y - 44;
    ctx.fillStyle = "rgba(8,12,28,0.95)"; A.rrect(ctx, x - w / 2, ty, w, 15, 4); ctx.fill();
    ctx.strokeStyle = (p.caught ? "rgba(255,93,108,0.7)" : (id === "A" ? "rgba(16,185,129,0.6)" : "rgba(139,92,246,0.6)"));
    ctx.lineWidth = 1; A.rrect(ctx, x - w / 2 + 0.5, ty + 0.5, w - 1, 14, 4); ctx.stroke();
    A.label(ctx, x, ty + 11, label, 9, p.caught ? "#ff5d6c" : soft, "center");
    // little stem connecting tag to the hood
    ctx.strokeStyle = "rgba(180,190,230,0.25)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, ty + 15); ctx.lineTo(x, y - 28); ctx.stroke();

    if (p.caught) {
      // handcuff / alarm ring
      ctx.strokeStyle = "rgba(255,70,90,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4, 22 + Math.sin(t / 200) * 3, 0, 7); ctx.stroke();
    }
  }

  function dust(ctx, t) {
    if (A.reduced) return;
    for (let i = 0; i < 26; i++) {
      const x = (i * 173 + Math.sin(t / 2000 + i) * 40) % W;
      const y = 140 + ((i * 97 + t * 0.012) % (H - 220));
      const a = 0.05 + 0.05 * (Math.sin(t / 900 + i) * 0.5 + 0.5);
      ctx.fillStyle = `rgba(200,210,255,${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }

  function hud(ctx, res, stt, t) {
    const rows = [["A", res.names.A, "#10b981", "#5eead4"], ["B", res.names.B, "#8b5cf6", "#c4b5fd"]];
    const HW = 312;
    ctx.fillStyle = "rgba(8,10,24,0.86)"; A.rrect(ctx, 12, 12, HW, 78, 10); ctx.fill();
    ctx.strokeStyle = "rgba(120,150,230,0.4)"; ctx.lineWidth = 1; A.rrect(ctx, 12.5, 12.5, HW - 1, 77, 10); ctx.stroke();
    A.label(ctx, 24, 28, "◆ HEIST STATUS", 9, "#9fb0ff", "left");
    rows.forEach(([id, nm, col, soft], i) => {
      const y = 46 + i * 22; const s = stt[id] || { room: 0, caught: false, cracked: false, distracts: 0 };
      A.label(ctx, 24, y + 4, nm.toUpperCase(), 10, soft, "left");
      // progress bar (rooms to vault)
      bar(ctx, 90, y - 4, 70, 7, s.room / ROOMS, col, "#0e0c1c");
      // spelled-out status: ROOM n/6 · ADJACENT · VAULT · CAUGHT
      const status = s.cracked ? "VAULT" : s.caught ? "CAUGHT" : s.room >= ROOMS - 1 ? "ADJACENT" : "ROOM " + s.room + "/" + ROOMS;
      A.label(ctx, 170, y + 2, status, 9, s.caught ? "#ff5d6c" : s.cracked ? "#ffd45a" : soft, "left");
      // distract charges, clearly labelled, right-aligned in its own column
      const dn = s.distracts != null ? s.distracts : 0;
      A.label(ctx, 12 + HW - 12, y + 2, "distract×" + dn, 8, dn > 0 ? "#9fb0ff" : "#4a5170", "right");
    });
  }
  function bar(ctx, x, y, w, h, frac, col, bg) {
    ctx.fillStyle = bg; A.rrect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = col; A.rrect(ctx, x, y, Math.max(2, w * A.clamp(frac, 0, 1)), h, h / 2); ctx.fill();
  }

  function dispatcher(ctx, res, bt, v) {
    const h = 44, y = H - h;
    ctx.fillStyle = "rgba(4,5,14,0.94)"; ctx.fillRect(0, y, W, h);
    ctx.strokeStyle = "rgba(120,150,230,0.4)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    A.label(ctx, 16, y + 18, "🛰 COMMS", 10, "#9fb0ff", "left");
    let line = "Two thieves slip into the moonlit museum. Read each prompt — who waits out the cones, who dashes the galleries?";
    if (bt && bt.events && bt.events[0]) line = bt.events[0];
    if (v.over && res.beats.length) line = res.beats[res.beats.length - 1].events[0];
    A.wrap(ctx, line, 92, y + 18, W - 110, 14, 12, "#cfe0ff", "ui-monospace,monospace");
  }

  function spottedFlash(ctx, p, beatT) {
    const a = Math.sin(beatT * Math.PI);
    ctx.fillStyle = `rgba(255,40,60,${a * 0.42})`; ctx.fillRect(0, 0, W, H);
    // alarm strobe bars
    ctx.fillStyle = `rgba(255,60,80,${a * 0.5})`;
    ctx.fillRect(0, 0, W, 6); ctx.fillRect(0, H - 6, W, 6);
    if (p) {
      ctx.save(); ctx.globalAlpha = a;
      A.label(ctx, p.x, p.y - 34, "SPOTTED", 18, "#ff3b53", "center");
      ctx.restore();
    }
  }

  function finishOverlay(ctx, res, t) {
    const draw = res.winner == null;
    const won = res.winReason === "crack" || res.winReason === "caught";
    ctx.fillStyle = "rgba(3,4,12,0.58)"; ctx.fillRect(0, 0, W, H);
    const col = draw ? "#9aa2b6" : res.winner === "A" ? "#34d399" : "#a855f7";
    const goldFinish = res.winReason === "crack";
    A.glow(ctx, W / 2, H / 2 - 14, 240, (goldFinish ? "rgba(255,210,90," : draw ? "rgba(154,162,182," : res.winner === "A" ? "rgba(52,211,153," : "rgba(168,85,247,") + "0.20)");
    const loser = res.winner === "A" ? "B" : "A";
    const title = draw ? (res.winReason === "doublecaught" ? "BOTH CAUGHT" : "STALEMATE")
      : res.winReason === "crack" ? "VAULT CRACKED"
      : res.winReason === "caught" ? "LAST THIEF STANDING" : "RUN CALLED";
    const sub = draw ? (res.winReason === "doublecaught" ? "Both thieves tripped the alarm" : "Neither reached the vault")
      : res.winReason === "crack" ? res.names[res.winner] + " cracks the vault first"
      : res.winReason === "caught" ? res.names[loser] + " was spotted — " + res.names[res.winner] + " takes it"
      : res.names[res.winner] + " was deepest in the museum";
    A.label(ctx, W / 2, H / 2 - 16, title, draw ? 38 : 34, goldFinish ? "#ffd45a" : col, "center", "ui-monospace,monospace");
    A.label(ctx, W / 2, H / 2 + 18, sub, 16, "#e9ecf5", "center");
    // HOW it ended: surface each thief's final depth/fate, so the result is read
    // not just asserted (e.g. "Ghost cracked the vault · Cipher CAUGHT at room 3").
    const fs = res.beats[res.beats.length - 1].state || {};
    const fate = (id) => {
      const s = fs[id] || { room: 0 };
      if (s.cracked) return res.names[id] + " cracked the vault";
      if (s.caught) return res.names[id] + " CAUGHT at room " + s.room + "/" + ROOMS;
      return res.names[id] + " reached room " + s.room + "/" + ROOMS;
    };
    const winId = res.winner, loseId = winId === "A" ? "B" : (winId === "B" ? "A" : null);
    const how = winId ? fate(winId) + "  ·  " + fate(loseId) : fate("A") + "  ·  " + fate("B");
    ctx.fillStyle = "rgba(6,8,20,0.72)";
    ctx.font = `700 12px ui-monospace,"DejaVu Sans Mono",monospace`;
    const hw = ctx.measureText(how).width + 28;
    A.rrect(ctx, W / 2 - hw / 2, H / 2 + 36, hw, 22, 6); ctx.fill();
    A.label(ctx, W / 2, H / 2 + 51, how, 12, "#aeb9d6", "center");
    // gold coin shower on a crack, sparks otherwise
    if (!draw && !A.reduced) {
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * 7 + t / 600; const r = 60 + (i % 6) * 24 + Math.sin(t / 300 + i) * 12;
        ctx.fillStyle = goldFinish ? (i % 2 ? "#ffd45a" : "#fff2c0") : (i % 2 ? col : "#fff");
        const px = W / 2 + Math.cos(a) * r, py = H / 2 - 14 + Math.sin(a) * r * 0.6;
        if (goldFinish) { ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill(); }
        else ctx.fillRect(px, py, 3, 3);
      }
    }
  }

  function vignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.82);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  window.VAULTRUN = {
    id: "vaultrun", name: "Vault Run", W, H,
    tag: "Two thieves infiltrate a moonlit museum toward a glowing vault, past sweeping guard vision cones. Wait out the sweeps in the shadows, or dash the open galleries — move while a cone lights you and you're SPOTTED. First to crack the vault wins.",
    champions: [{ id: "A", name: "Ghost", color: "#10b981" }, { id: "B", name: "Cipher", color: "#8b5cf6" }],
    prompts: { A: DEF_A, B: DEF_B },
    mcp: {
      kickoff: "You are a thief infiltrating a refereed museum, played entirely through your tools. Each turn: get_state, legal_moves, then make_move with a path and the current ply. Slip past the guards' sweeping vision cones to the vault — but MOVE while a lit cone crosses you and the alarm catches you. Crack the vault first. Win.",
      tools: [
        { name: "get_state", args: "", ret: "{room, lane, cones_ahead, distracts}", desc: "Read the room: your depth, lane, whether the gallery ahead is lit, distractions left." },
        { name: "legal_moves", args: "", ret: "[move, …]", desc: "What you can do here: sneak a hall, dash a gallery, distract a guard, or grab the vault when adjacent." },
        { name: "make_move", args: "move, expected_ply", desc: "Commit a move. Halls are slow but shadowed; galleries are fast but lit; cross a lit cone and you're SPOTTED.", ret: "new state | error" },
        { name: "resign", args: "", ret: "forfeit", desc: "Abandon the run." },
      ],
      vocab: "sneak:hall · dash:gallery · distract:guard · grab:vault",
    },
    build, draw,
  };
})();
