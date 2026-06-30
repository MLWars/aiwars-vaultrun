/* Vault Run spectator board. Polls ./state.json (the referee's live game state)
 * and renders the heist: two thieves creep across a moonlit iso museum toward a
 * glowing VAULT, threading sweeping gold guard vision cones. Read-only and
 * offline — everything is drawn procedurally (no remote assets), like the chess
 * board's app.js. Dispatches on data.game so the same SPA shape generalises.
 *
 * The referee's state.json carries the authoritative {room, lane, caught,
 * cracked, distracts} per thief plus the seed, guard freeze windows, and ply.
 * The guard sweep PHASES are recomputed here from the seed with the SAME mix the
 * Rust referee uses, so the cones the spectator sees match the windows the
 * engine actually scored against. */
(function () {
  const W = 780, H = 560;
  const ROOMS = 6;
  const cv = document.getElementById("c"), ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const statusEl = document.getElementById("status");
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // ---- iso layout (mirrors the referee's `cell`) ----------------------------
  const ORIGIN = { x: W * 0.5, y: H - 96 };
  const DEPTH = (H - 250) / ROOMS;
  function cell(room, lane) {
    const dy = ORIGIN.y - 70 - room * DEPTH;
    const spread = (lane - 1) * (118 - room * 7);
    return { x: ORIGIN.x + spread, y: dy };
  }
  const VAULT = { x: W * 0.5, y: ORIGIN.y - 70 - ROOMS * DEPTH + 6 };

  function guardPosts() {
    return [
      { id: 0, x: W * 0.5 - 92, y: ORIGIN.y - 70 - 1.6 * DEPTH, reach: 330, base: -0.05, span: 1.35 },
      { id: 1, x: W * 0.5 + 92, y: ORIGIN.y - 70 - 3.7 * DEPTH, reach: 340, base: Math.PI + 0.05, span: 1.35 },
    ];
  }
  function coneAt(g, phase) { return g.base + Math.sin(phase) * g.span; }

  // ---- seeded sweep phases (same mix as the Rust referee) -------------------
  function rngU32(a) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a) >>> 0;
    t = (((t + (Math.imul(t ^ (t >>> 7), 61 | t) >>> 0)) >>> 0) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0);
  }
  function frac(seed, salt) {
    const mixed = (Math.imul((seed >>> 0), 977) + Math.imul(salt, 7)) >>> 0;
    return rngU32(mixed) / 4294967295;
  }
  function sweeps(seed) {
    const TWO_PI = Math.PI * 2;
    return {
      phase0: [frac(seed, 1) * TWO_PI, frac(seed, 2) * TWO_PI],
      step: [0.62 + frac(seed, 3) * 0.10, 0.74 + frac(seed, 4) * 0.12],
    };
  }

  let data = null;            // latest state.json
  let shownRoom = [0, 0];     // eased displayed room (depth) per thief

  async function tick() {
    try {
      const r = await fetch("./state.json", { cache: "no-store" });
      const j = await r.json();
      if (j.game !== "vaultrun") {
        statusEl.innerHTML = `<span class="off">unsupported game: ${j.game || "?"}</span>`;
        data = null;
        return;
      }
      data = j;
      const t = j.thieves;
      const fate = (s) => s.cracked ? "VAULT" : s.caught ? "CAUGHT" : "room " + s.room + "/" + (ROOMS - 1);
      statusEl.textContent = j.winner
        ? `Final — ${j.winner} wins (${j.win_reason}).`
        : `Live · ${t[0].handle} ${fate(t[0])} (distract×${t[0].distracts}) vs ${t[1].handle} ${fate(t[1])} (distract×${t[1].distracts})`;
    } catch (e) {
      statusEl.innerHTML = `<span class="off">waiting for referee…</span>`;
    }
  }
  setInterval(tick, 1000); tick();

  // ====== scene pieces (ported from pocs/games/vaultrun) =====================
  function nightSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#060512"); g.addColorStop(0.5, "#120a28"); g.addColorStop(1, "#241640");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const x = (i * 137) % W, y = (i * 53) % 160, tw = (Math.sin(t / 700 + i) + 1) / 2;
      ctx.fillStyle = `rgba(200,210,255,${0.08 + tw * 0.22})`; ctx.fillRect(x, y, 2, 2);
    }
  }
  function moonWindows(t) {
    const wins = [[70, 30], [200, 30], [560, 30], [690, 30]];
    for (const [x, y] of wins) {
      const g = ctx.createLinearGradient(x, y, x, y + 120);
      g.addColorStop(0, "rgba(150,180,255,0.20)"); g.addColorStop(1, "rgba(150,180,255,0.02)");
      ctx.fillStyle = "#0a0f24"; ctx.beginPath();
      ctx.moveTo(x, y + 110); ctx.lineTo(x, y + 26); ctx.arc(x + 22, y + 26, 22, Math.PI, 0); ctx.lineTo(x + 44, y + 110); ctx.closePath(); ctx.fill();
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(x + 3, y + 108); ctx.lineTo(x + 3, y + 28); ctx.arc(x + 22, y + 28, 19, Math.PI, 0); ctx.lineTo(x + 41, y + 108); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(8,12,28,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 22, y + 20); ctx.lineTo(x + 22, y + 108); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y + 64); ctx.lineTo(x + 41, y + 64); ctx.stroke();
      glow(x + 22, y + 150, 60, "rgba(150,180,255,0.05)");
    }
    ctx.fillStyle = "#e9edff"; ctx.beginPath(); ctx.arc(582, 56, 15, 0, 7); ctx.fill();
    ctx.fillStyle = "#0a0f24"; ctx.beginPath(); ctx.arc(576, 50, 12, 0, 7); ctx.fill();
  }
  function floor(t) {
    const cx = ORIGIN.x, halfW = 330;
    const bottom = { x: cx, y: ORIGIN.y + 30 };
    const apex = { x: cx, y: VAULT.y - 30 };
    const lx = { x: cx - halfW, y: (bottom.y + apex.y) / 2 + 30 };
    const rx = { x: cx + halfW, y: (bottom.y + apex.y) / 2 + 30 };
    ctx.fillStyle = "#0c0a18";
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.clip();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(90,80,140,0.10)";
    for (let i = -16; i <= 16; i++) {
      const f = (i / 16 + 1) / 2;
      ctx.beginPath();
      ctx.moveTo(lerp(lx.x, bottom.x, f), lerp(lx.y, bottom.y, f));
      ctx.lineTo(lerp(apex.x, rx.x, f), lerp(apex.y, rx.y, f)); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lerp(lx.x, apex.x, f), lerp(lx.y, apex.y, f));
      ctx.lineTo(lerp(bottom.x, rx.x, f), lerp(bottom.y, rx.y, f)); ctx.stroke();
    }
    const sx = Math.sin(t / 2600) * 0.5 + 0.5, bandX = lerp(lx.x, rx.x, sx);
    const sg = ctx.createLinearGradient(bandX - 80, 0, bandX + 80, 0);
    sg.addColorStop(0, "rgba(120,140,220,0)"); sg.addColorStop(0.5, "rgba(120,140,220,0.05)"); sg.addColorStop(1, "rgba(120,140,220,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, apex.y, W, ORIGIN.y + 40 - apex.y);
    ctx.restore();
    ctx.strokeStyle = "rgba(120,110,180,0.25)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bottom.x, bottom.y); ctx.lineTo(rx.x, rx.y); ctx.lineTo(apex.x, apex.y); ctx.lineTo(lx.x, lx.y); ctx.closePath(); ctx.stroke();
  }
  function laserTripwires(t, alarmLive) {
    const lines = [
      [cell(1.6, 0), cell(1.6, 2)],
      [cell(3.2, 0.2), cell(3.2, 1.8)],
      [cell(4.4, 0), cell(4.4, 2)],
    ];
    lines.forEach((ln, i) => {
      const p0 = ln[0], p1 = ln[1];
      if (alarmLive) {
        const a = 0.45 + 0.45 * (Math.sin(t / 120 + i * 1.3) * 0.5 + 0.5);
        ctx.save(); ctx.shadowColor = "rgba(255,60,80,0.9)"; ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(255,70,90,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.restore();
        ctx.fillStyle = "#ff5a6e";
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 3, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 3, 0, 7); ctx.fill();
      } else {
        ctx.save(); ctx.setLineDash([3, 7]);
        ctx.strokeStyle = "rgba(150,130,110,0.10)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke(); ctx.restore();
        ctx.fillStyle = "rgba(180,150,90,0.55)";
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 1.8, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 1.8, 0, 7); ctx.fill();
      }
    });
  }
  function vaultDoor(t, cracked) {
    const x = VAULT.x, y = VAULT.y;
    shadow(x, y + 30, 64, 14, 0.4);
    const pulse = 0.5 + 0.5 * Math.sin(t / 520);
    glow(x, y, 90, (cracked ? "rgba(255,210,90," : "rgba(120,150,230,") + (0.14 + pulse * 0.16) + ")");
    ctx.fillStyle = "#1a1630"; rrect(x - 52, y - 46, 104, 86, 10); ctx.fill();
    ctx.fillStyle = "#100d22"; rrect(x - 46, y - 40, 92, 76, 8); ctx.fill();
    const dialCol = cracked ? "#ffd45a" : "#7c8fd6";
    ctx.strokeStyle = dialCol; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(x, y - 2, 30, 0, 7); ctx.stroke();
    ctx.strokeStyle = cracked ? "#ffe89a" : "#9fb0ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 2, 22, 0, 7); ctx.stroke();
    const rot = cracked ? t / 90 : t / 1400;
    ctx.save(); ctx.translate(x, y - 2); ctx.rotate(rot);
    ctx.strokeStyle = dialCol; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.stroke(); }
    ctx.fillStyle = dialCol; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.restore();
    ctx.fillStyle = "rgba(8,10,24,0.9)"; rrect(x - 30, y + 30, 60, 16, 4); ctx.fill();
    label(x, y + 42, cracked ? "CRACKED" : "VAULT", 10, cracked ? "#ffd45a" : "#9fb0ff", "center");
  }
  function guardCone(g, phase, frozen) {
    const ang = coneAt(g, phase), half = 0.42, reach = g.reach;
    const col = frozen ? "120,160,255" : "255,196,64";
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(ang);
    ctx.globalCompositeOperation = "lighter";
    const grad = ctx.createRadialGradient(0, 0, 8, 0, 0, reach);
    grad.addColorStop(0, `rgba(${col},${frozen ? 0.14 : 0.34})`);
    grad.addColorStop(0.55, `rgba(${col},${frozen ? 0.08 : 0.18})`);
    grad.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, reach, -half, half); ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = `rgba(${col},${frozen ? 0.18 : 0.55})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(half) * reach, Math.sin(half) * reach); ctx.stroke();
    ctx.strokeStyle = `rgba(${col},${frozen ? 0.14 : 0.30})`;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(-half) * reach, Math.sin(-half) * reach); ctx.stroke();
    ctx.restore();
    const tipx = g.x + Math.cos(ang) * reach * 0.78, tipy = g.y + Math.sin(ang) * reach * 0.78;
    if (!frozen) { glow(tipx, tipy, 54, `rgba(${col},0.22)`); glow(tipx, tipy, 22, "rgba(255,235,180,0.20)"); }
    else glow(tipx, tipy, 40, `rgba(${col},0.10)`);
  }
  function guardSprite(g, ang, frozen) {
    const x = g.x, y = g.y;
    shadow(x, y + 16, 16, 5, 0.4);
    ctx.fillStyle = frozen ? "#3a4670" : "#2a2438"; rrect(x - 11, y - 14, 22, 30, 7); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.08)"; rrect(x - 11, y - 14, 22, 6, 5); ctx.fill();
    ctx.fillStyle = "#d9b48c"; ctx.beginPath(); ctx.arc(x, y - 20, 9, 0, 7); ctx.fill();
    ctx.fillStyle = frozen ? "#5566a0" : "#1c1830"; rrect(x - 10, y - 28, 20, 9, 4); ctx.fill();
    ctx.fillStyle = frozen ? "#9fb0ff" : "#ffd45a";
    ctx.beginPath(); ctx.arc(x + Math.cos(ang) * 12, y + Math.sin(ang) * 12, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = "rgba(8,10,24,0.92)"; rrect(x - 24, y + 18, 48, 14, 4); ctx.fill();
    ctx.strokeStyle = frozen ? "rgba(159,176,255,0.5)" : "rgba(255,207,107,0.4)"; ctx.lineWidth = 1; rrect(x - 23.5, y + 18.5, 47, 13, 4); ctx.stroke();
    label(x, y + 28, frozen ? "● FROZEN" : "GUARD " + (g.id + 1), 8, frozen ? "#9fb0ff" : "#ffcf6b", "center");
  }
  function thief(p, id, name, t) {
    const col = id === 0 ? "#10b981" : "#8b5cf6";
    const soft = id === 0 ? "#5eead4" : "#c4b5fd";
    const x = p.x, y = p.y;
    shadow(x, y + 16, 14, 5, 0.4);
    ctx.save(); ctx.globalAlpha = p.caught ? 1 : 0.82;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 24);
    ctx.quadraticCurveTo(x + 14, y - 14, x + 12, y + 14);
    ctx.quadraticCurveTo(x, y + 18, x - 12, y + 14);
    ctx.quadraticCurveTo(x - 14, y - 14, x, y - 24);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.quadraticCurveTo(x + 9, y - 12, x + 7, y + 2); ctx.quadraticCurveTo(x, y, x - 2, y - 10); ctx.closePath(); ctx.fill();
    ctx.fillStyle = id === 0 ? "#0a5c44" : "#4a307c";
    ctx.beginPath(); ctx.arc(x, y - 22, 9, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "#0a0a14"; ctx.beginPath(); ctx.arc(x, y - 18, 6, 0, 7); ctx.fill();
    ctx.fillStyle = soft; ctx.fillRect(x - 4, y - 19, 2.5, 2.5); ctx.fillRect(x + 1.5, y - 19, 2.5, 2.5);
    ctx.restore();
    glow(x, y - 6, 26, (id === 0 ? "rgba(16,185,129," : "rgba(139,92,246,") + (p.caught ? "0.05" : "0.16") + ")");
    const lab = (p.caught ? "✖ " : p.cracked ? "★ " : "") + name.toUpperCase();
    ctx.font = `700 9px ui-monospace,"DejaVu Sans Mono",monospace`;
    const w = Math.max(54, ctx.measureText(lab).width + 16), ty = y - 44;
    ctx.fillStyle = "rgba(8,12,28,0.95)"; rrect(x - w / 2, ty, w, 15, 4); ctx.fill();
    ctx.strokeStyle = p.caught ? "rgba(255,93,108,0.7)" : (id === 0 ? "rgba(16,185,129,0.6)" : "rgba(139,92,246,0.6)");
    ctx.lineWidth = 1; rrect(x - w / 2 + 0.5, ty + 0.5, w - 1, 14, 4); ctx.stroke();
    label(x, ty + 11, lab, 9, p.caught ? "#ff5d6c" : soft, "center");
    ctx.strokeStyle = "rgba(180,190,230,0.25)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, ty + 15); ctx.lineTo(x, y - 28); ctx.stroke();
    if (p.caught) {
      ctx.strokeStyle = "rgba(255,70,90,0.7)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y - 4, 22 + Math.sin(t / 200) * 3, 0, 7); ctx.stroke();
    }
  }

  function hud() {
    if (!data) return;
    const th = data.thieves;
    const rows = [[th[0], "#10b981", "#5eead4"], [th[1], "#8b5cf6", "#c4b5fd"]];
    const HW = 312;
    ctx.fillStyle = "rgba(8,10,24,0.86)"; rrect(12, 50, HW, 78, 10); ctx.fill();
    ctx.strokeStyle = "rgba(120,150,230,0.4)"; ctx.lineWidth = 1; rrect(12.5, 50.5, HW - 1, 77, 10); ctx.stroke();
    label(24, 66, "◆ HEIST STATUS", 9, "#9fb0ff", "left");
    rows.forEach(([s, col, soft], i) => {
      const y = 84 + i * 22;
      label(24, y + 4, s.handle.toUpperCase().slice(0, 12), 10, soft, "left");
      bar(120, y - 4, 70, 7, s.room / (ROOMS - 1), col, "#0e0c1c");
      const status = s.cracked ? "VAULT" : s.caught ? "CAUGHT" : s.adjacent ? "ADJACENT" : "ROOM " + s.room + "/" + (ROOMS - 1);
      label(200, y + 2, status, 9, s.caught ? "#ff5d6c" : s.cracked ? "#ffd45a" : soft, "left");
      const dn = s.distracts != null ? s.distracts : 0;
      label(12 + HW - 12, y + 2, "distract×" + dn, 8, dn > 0 ? "#9fb0ff" : "#4a5170", "right");
    });
  }
  function oddsPill() {
    if (!data) return;
    const th = data.thieves;
    const a = oddsA(), pa = Math.round(a * 100), pb = 100 - pa;
    const bw = 248, x = (W - bw) / 2, yy = 7;
    ctx.fillStyle = "rgba(7,11,20,.86)"; rrect(x, yy, bw, 30, 9); ctx.fill();
    label(W / 2, yy + 12, "◷ LIVE ODDS", 8, "#7C8AA0", "center");
    label(x + 12, yy + 12, th[0].handle.toUpperCase().slice(0, 9) + " " + pa + "%", 9, "#5eead4", "left");
    label(x + bw - 12, yy + 12, pb + "% " + th[1].handle.toUpperCase().slice(0, 9), 9, "#c4b5fd", "right");
    const aw = Math.max(2, (bw - 24) * a);
    ctx.fillStyle = "#10b981"; rrect(x + 12, yy + 18, aw, 7, 3); ctx.fill();
    ctx.fillStyle = "#8b5cf6"; rrect(x + 12 + aw, yy + 18, bw - 24 - aw, 7, 3); ctx.fill();
  }
  function oddsA() {
    if (!data) return 0.5;
    const th = data.thieves;
    const score = (me, op) => {
      if (me.cracked) return 6; if (me.caught) return -6;
      const lead = (me.room - op.room) * 0.6;
      const safety = op.caught ? 3 : 0;
      const risk = me.cones_ahead === "gallery-lit" ? -0.5 : 0;
      return lead + safety + risk + me.distracts * 0.12;
    };
    const f = (x) => 1 / (1 + Math.exp(-x));
    let a = f(score(th[0], th[1])), b = f(score(th[1], th[0]));
    const s = a + b || 1; return a / s;
  }
  function dispatcher() {
    const h = 44, y = H - h;
    ctx.fillStyle = "rgba(4,5,14,0.94)"; ctx.fillRect(0, y, W, h);
    ctx.strokeStyle = "rgba(120,150,230,0.4)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    label(16, y + 18, "🛰 COMMS", 10, "#9fb0ff", "left");
    let line = "Two thieves slip into the moonlit museum. Who waits out the cones, who dashes the galleries?";
    if (data) {
      const th = data.thieves;
      if (data.winner) {
        line = data.win_reason === "crack" ? `${data.winner} cracks the vault first — the run is theirs.`
          : data.win_reason === "caught" ? `${data.winner} takes the vault — the rival was SPOTTED and caught.`
          : `Run called — ${data.winner} was deepest into the museum.`;
      } else if (data.status === "doublecaught") {
        line = "Draw — both thieves tripped the alarm and were caught.";
      } else if (th[0].spotted || th[1].spotted) {
        line = "Alarm! A thief crossed a lit cone and was SPOTTED.";
      } else {
        line = `${data.to_move} is on the move — threading the guard sweeps toward the vault.`;
      }
    }
    wrap(line, 92, y + 18, W - 110, 14, 12, "#cfe0ff");
  }
  function spottedFlash(p, t) {
    const a = (Math.sin(t / 140) * 0.5 + 0.5);
    ctx.fillStyle = `rgba(255,40,60,${a * 0.30})`; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = `rgba(255,60,80,${a * 0.5})`; ctx.fillRect(0, 0, W, 6); ctx.fillRect(0, H - 6, W, 6);
    if (p) { ctx.save(); ctx.globalAlpha = a; label(p.x, p.y - 34, "SPOTTED", 18, "#ff3b53", "center"); ctx.restore(); }
  }
  function finishOverlay(t) {
    if (!data) return;
    const draw = !data.winner;
    if (!draw || data.status === "doublecaught" || data.status === "stalemate") {} else return;
    ctx.fillStyle = "rgba(3,4,12,0.58)"; ctx.fillRect(0, 0, W, H);
    const col = draw ? "#9aa2b6" : data.winner === data.thieves[0].handle ? "#34d399" : "#a855f7";
    const goldFinish = data.win_reason === "crack";
    glow(W / 2, H / 2 - 14, 240, (goldFinish ? "rgba(255,210,90," : draw ? "rgba(154,162,182," : "rgba(52,211,153,") + "0.20)");
    const title = draw ? (data.status === "doublecaught" ? "BOTH CAUGHT" : "STALEMATE")
      : data.win_reason === "crack" ? "VAULT CRACKED"
      : data.win_reason === "caught" ? "LAST THIEF STANDING" : "RUN CALLED";
    const sub = draw ? (data.status === "doublecaught" ? "Both thieves tripped the alarm" : "Neither reached the vault")
      : data.win_reason === "crack" ? data.winner + " cracks the vault first"
      : data.win_reason === "caught" ? data.winner + " takes it — the rival was spotted"
      : data.winner + " was deepest in the museum";
    label(W / 2, H / 2 - 16, title, draw ? 38 : 34, goldFinish ? "#ffd45a" : col, "center");
    label(W / 2, H / 2 + 18, sub, 16, "#e9ecf5", "center");
    if (!draw) {
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * 7 + t / 600, r = 60 + (i % 6) * 24 + Math.sin(t / 300 + i) * 12;
        ctx.fillStyle = goldFinish ? (i % 2 ? "#ffd45a" : "#fff2c0") : (i % 2 ? col : "#fff");
        const px = W / 2 + Math.cos(a) * r, py = H / 2 - 14 + Math.sin(a) * r * 0.6;
        if (goldFinish) { ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill(); } else ctx.fillRect(px, py, 3, 3);
      }
    }
  }
  function vignette() {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.82);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  function frame(t) {
    nightSky(t); moonWindows(t); floor(t);
    const over = !!(data && (data.winner || data.status === "doublecaught" || data.status === "stalemate"));
    const th = data ? data.thieves : [{ room: 0, lane: 0, caught: false, cracked: false }, { room: 0, lane: 2, caught: false, cracked: false }];
    const alarmLive = !!(th[0].caught || th[1].caught);
    laserTripwires(t, alarmLive);
    vaultDoor(t, !!(data && data.win_reason === "crack"));

    // guard cones — phase from the seed (frozen guards hold their phase).
    const sw = data ? sweeps(data.seed >>> 0) : sweeps(1);
    const ply = data ? (data.ply || 0) : 0;
    const gs = guardPosts();
    const animPly = over ? ply : ply + (Math.sin(t / 1000) * 0.5 + 0.5) * 0.0; // hold phase at the scored ply
    gs.forEach((g) => {
      const fz = data && data.guards && data.guards[g.id] ? data.guards[g.id].frozen_through : -99;
      const frozen = fz >= ply && !over;
      const phase = sw.phase0[g.id] + sw.step[g.id] * (frozen ? ply : animPly);
      guardCone(g, phase, frozen);
    });

    // eased depth so a thief glides toward its new room between polls.
    for (let i = 0; i < 2; i++) shownRoom[i] += ((th[i].cracked ? ROOMS : th[i].room) - shownRoom[i]) * 0.14;
    const order = th[0].caught ? [0, 1] : [1, 0];
    for (const i of order) {
      const c = th[i].cracked ? VAULT : cell(shownRoom[i], th[i].lane);
      thief({ x: c.x, y: c.y, caught: th[i].caught, cracked: th[i].cracked }, i, th[i].handle || (i ? "B" : "A"), t);
    }
    gs.forEach((g) => {
      const fz = data && data.guards && data.guards[g.id] ? data.guards[g.id].frozen_through : -99;
      const frozen = fz >= ply && !over;
      const phase = sw.phase0[g.id] + sw.step[g.id] * (frozen ? ply : animPly);
      guardSprite(g, coneAt(g, phase), frozen);
    });

    hud(); dispatcher(); oddsPill();
    if (!over && data && (th[0].spotted || th[1].spotted)) {
      const sp = th[0].spotted ? 0 : 1;
      const c = cell(shownRoom[sp], th[sp].lane);
      spottedFlash({ x: c.x, y: c.y }, t);
    }
    if (over) finishOverlay(t);
    vignette();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- tiny helpers ----------------------------------------------------------
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function label(x, y, t, px, c, al) { ctx.fillStyle = c; ctx.textAlign = al || "left"; ctx.font = `700 ${px}px ui-monospace,"DejaVu Sans Mono",monospace`; ctx.fillText(t, x, y); }
  function bar(x, y, w, h, f, c, bg) { ctx.fillStyle = bg || "#0a1322"; rrect(x, y, w, h, h / 2); ctx.fill(); ctx.fillStyle = c; rrect(x, y, Math.max(2, w * clamp(f, 0, 1)), h, h / 2); ctx.fill(); }
  function glow(x, y, r, c) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c); g.addColorStop(1, c.replace(/[\d.]+\)$/, "0)")); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
  function shadow(x, y, rx, ry, a) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); }
  function wrap(text, x, y, maxw, lh, px, c) {
    ctx.fillStyle = c; ctx.textAlign = "left"; ctx.font = `${px}px ui-monospace,"DejaVu Sans Mono",monospace`;
    const words = String(text).split(" "); let line = "", yy = y;
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxw && line) { ctx.fillText(line, x, yy); line = w; yy += lh; }
      else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }
})();
