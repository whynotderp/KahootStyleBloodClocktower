import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { networkInterfaces } from 'os';

import { ROLES } from './shared/gameData.js';
import {
  assignRoles, setupDrunk, shuffle,
  generateFirstNightInfo, generateAllNightInfo,
  resolveNight, checkWin, getDisplayRole,
} from './shared/gameLogic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Serve built client
app.use(express.static(join(__dirname, 'client/dist')));
app.get('*', (_, res) => res.sendFile(join(__dirname, 'client/dist/index.html')));

// ─── Room management ───────────────────────────────────────────────────────

const rooms = new Map();

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function publicPlayers(players) {
  return players.map(p => ({ id: p.id, name: p.name, alive: p.alive }));
}

function privateRoleInfo(room, player) {
  const displayRoleId = getDisplayRole(player);
  const role = ROLES[displayRoleId];
  const actualTeam = ROLES[player.roleId]?.team;
  return {
    playerId: player.id,
    name: player.name,
    roleId: displayRoleId,
    roleName: role?.name || displayRoleId,
    team: role?.team,
    description: role?.description,
    minionNames: actualTeam === 'demon'
      ? room.players.filter(p => ROLES[p.roleId]?.team === 'minion').map(p => p.name) : null,
    demonNames: actualTeam === 'minion'
      ? room.players.filter(p => ROLES[p.roleId]?.team === 'demon').map(p => p.name) : null,
    startInfo: room.nightInfo?.[player.id]?.result || null,
    isActualDrunk: player.isActualDrunk,
    drunkRoleName: player.isActualDrunk ? ROLES[player.drunkRole]?.name : null,
  };
}

function hasR1Action(room, player) {
  if (!player.alive) return false;
  const rid = getDisplayRole(player);
  const role = ROLES[rid];
  const isN1 = room.nightNum === 1;
  const acts = role && ((isN1 && role.nightOrder.firstNight !== null) || (!isN1 && role.nightOrder.otherNights !== null));
  return acts && ['monk', 'butler', 'poisoner', 'imp', 'fangGu', 'fortuneTeller'].includes(rid);
}

function playerSocket(room, player) {
  // player.id is 1-based index from assignRoles; joinedPlayers is 0-based
  const idx = player.id - 1;
  return room.joinedPlayers[idx]?.socketId || null;
}

function emitToPlayer(room, player, event, data) {
  const sid = playerSocket(room, player);
  if (sid) io.to(sid).emit(event, data);
}

function processR1(room) {
  // Apply monk protection
  room.players = room.players.map(p => ({ ...p, protected: false }));
  if (room.nightActions.monk) {
    room.players = room.players.map(p =>
      p.id === room.nightActions.monk ? { ...p, protected: true } : p
    );
  }
  // Apply poison
  room.players = room.players.map(p => ({ ...p, poisoned: false }));
  if (room.nightActions.poisoner) {
    room.players = room.players.map(p =>
      p.id === room.nightActions.poisoner ? { ...p, poisoned: true } : p
    );
  }
  // Generate Round 2 info
  room.nightInfo = generateAllNightInfo(
    room.players, room.nightActions, room.nightNum, room.executedToday, room.redHerringId
  );
  // Detect Ravenkeeper dying
  const demonTarget = room.nightActions.imp ?? room.nightActions.fangGu ?? null;
  const rk = room.players.find(p => p.roleId === 'ravenkeeper' && p.alive);
  room.ravenKeeperDying = (rk && demonTarget === rk.id && !rk.protected) ? rk.id : null;
}

function processR2(room) {
  const result = resolveNight(room.players, room.nightActions, room.nightNum);
  room.players = result.players;
  room.pendingDeaths = result.deaths;
  room.nightEvents = result.events;
}

function checkAndEmitWin(room, code, afterExecution = false) {
  const win = checkWin(room.players, afterExecution);
  if (win) {
    room.winResult = win;
    room.phase = 'game_over';
    io.to(code).emit('game_over', {
      winner: win.winner, reason: win.reason,
      players: room.players,
      redHerringId: room.redHerringId,
    });
    return true;
  }
  return false;
}

function checkAllR1Done(room, code) {
  const alive = room.players.filter(p => p.alive);
  if (alive.every(p => room.r1Submitted.has(p.id))) {
    processR1(room);
    room.nightRound = 2;
    room.r2Acknowledged = new Set();

    // Push Round 2 info to each alive player
    for (const player of alive) {
      const info = room.nightInfo[player.id]?.result || null;
      const isRK = room.ravenKeeperDying === player.id;
      emitToPlayer(room, player, 'night_r2', {
        nightNum: room.nightNum,
        info,
        isRavenKeeperDying: isRK,
        roleId: getDisplayRole(player),
        players: publicPlayers(room.players),
      });
    }
    io.to(room.hostSocketId).emit('night_r2_start', {
      nightNum: room.nightNum,
      ready: 0, total: alive.length,
    });
  }
}

function checkAllR2Done(room, code) {
  const alive = room.players.filter(p => p.alive);
  if (alive.every(p => room.r2Acknowledged.has(p.id))) {
    processR2(room);
    if (!checkAndEmitWin(room, code, false)) {
      room.phase = 'night_summary';
      io.to(code).emit('night_summary', {
        nightNum: room.nightNum,
        deaths: room.pendingDeaths,
        players: publicPlayers(room.players),
      });
    }
  }
}

// ─── Socket handlers ───────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // Host creates room — no names or roles needed yet
  socket.on('create_room', () => {
    const code = genCode();
    rooms.set(code, {
      code, phase: 'lobby',
      hostSocketId: socket.id,
      joinedPlayers: [], // { name, socketId } in join order
      players: [],
      nightNum: 0, nightRound: 1,
      nightActions: {}, nightInfo: {},
      pendingDeaths: [], nightEvents: [],
      executedToday: null, executionHappenedToday: false,
      redHerringId: null, ravenKeeperDying: null,
      winResult: null,
      r1Submitted: new Set(), r2Acknowledged: new Set(),
    });
    socket.join(code);
    socket.emit('room_created', { code });
  });

  // Check if a room code exists
  socket.on('check_room', ({ code }, callback) => {
    const room = rooms.get(code?.toUpperCase());
    callback({ exists: !!room, phase: room?.phase });
  });

  // Player joins with their own name
  socket.on('join_room', ({ code, name }) => {
    const room = rooms.get(code?.toUpperCase());
    if (!room) { socket.emit('join_error', 'Room not found'); return; }
    if (room.phase !== 'lobby') { socket.emit('join_error', 'Game already started'); return; }
    if (!name?.trim()) { socket.emit('join_error', 'Please enter your name'); return; }
    const trimmed = name.trim();
    if (room.joinedPlayers.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      socket.emit('join_error', 'That name is already taken'); return;
    }

    const playerIndex = room.joinedPlayers.length;
    room.joinedPlayers.push({ name: trimmed, socketId: socket.id });
    socket.join(code);
    socket.data = { code, playerIndex };
    socket.emit('joined_ok', { playerIndex, name: trimmed });

    io.to(room.hostSocketId).emit('player_joined', {
      playerIndex, name: trimmed,
      joined: room.joinedPlayers.length,
    });
  });

  socket.on('start_game', ({ code, rolePool }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    const playerNames = room.joinedPlayers.map(p => p.name);
    room.rolePool = rolePool;

    let players = assignRoles(playerNames, rolePool);
    players = setupDrunk(players, rolePool);
    room.players = players;

    const good = players.filter(p => ['townsfolk','outsider'].includes(ROLES[p.roleId]?.team));
    const ft = players.find(p => p.roleId === 'fortuneTeller');
    const cands = ft ? good.filter(p => p.id !== ft.id) : good;
    room.redHerringId = cands.length > 0 ? cands[Math.floor(Math.random() * cands.length)].id : null;

    // First-night info for role reveal
    room.nightInfo = {};
    for (const p of players) {
      const rid = p.isActualDrunk ? p.drunkRole : p.roleId;
      const info = generateFirstNightInfo(players, rid, p.id);
      if (info) room.nightInfo[p.id] = info;
    }

    room.phase = 'seating';
    io.to(room.hostSocketId).emit('game_started', {
      players: publicPlayers(players),
      seatingOrder: players.map(p => p.name),
    });

    // Send private role to each player (player.id is 1-based, joinedPlayers is 0-based)
    for (const player of players) {
      const sid = room.joinedPlayers[player.id - 1]?.socketId;
      if (sid) io.to(sid).emit('your_role', privateRoleInfo(room, player));
    }
  });

  socket.on('start_night', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    room.nightNum++;
    room.nightRound = 1;
    room.phase = 'night';
    room.nightActions = {};
    room.nightInfo = {};
    room.pendingDeaths = [];
    room.nightEvents = [];
    room.ravenKeeperDying = null;
    room.r1Submitted = new Set();
    room.r2Acknowledged = new Set();
    room.executedToday = null;
    room.executionHappenedToday = false;

    const alive = room.players.filter(p => p.alive);

    for (const player of alive) {
      emitToPlayer(room, player, 'night_r1', {
        nightNum: room.nightNum,
        hasAction: hasR1Action(room, player),
        roleId: getDisplayRole(player),
        players: publicPlayers(room.players),
      });
    }

    io.to(room.hostSocketId).emit('night_start', {
      nightNum: room.nightNum,
      ready: 0, total: alive.length,
    });
  });

  socket.on('r1_submit', ({ code, playerId, roleId, targetId, secondTargetId }) => {
    const room = rooms.get(code);
    if (!room || room.nightRound !== 1) return;

    if (roleId && targetId != null) {
      room.nightActions[roleId] = targetId;
      if (secondTargetId != null) room.nightActions[roleId + '_2'] = secondTargetId;
    }

    // Butler master
    const player = room.players.find(p => p.id === playerId);
    if (player?.roleId === 'butler' && targetId != null) {
      room.players = room.players.map(p =>
        p.id === playerId ? { ...p, butlerMaster: targetId } : p
      );
    }

    room.r1Submitted.add(playerId);
    const alive = room.players.filter(p => p.alive);
    io.to(room.hostSocketId).emit('r1_progress', { ready: room.r1Submitted.size, total: alive.length });
    checkAllR1Done(room, code);
  });

  socket.on('r2_acknowledge', ({ code, playerId, rkTargetId }) => {
    const room = rooms.get(code);
    if (!room || room.nightRound !== 2) return;

    if (room.ravenKeeperDying === playerId && rkTargetId != null) {
      room.nightActions.ravenkeeper = rkTargetId;
    }

    room.r2Acknowledged.add(playerId);
    const alive = room.players.filter(p => p.alive);
    io.to(room.hostSocketId).emit('r2_progress', { ready: room.r2Acknowledged.size, total: alive.length });
    checkAllR2Done(room, code);
  });

  socket.on('end_summary', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!checkAndEmitWin(room, code, false)) {
      room.phase = 'day';
      io.to(code).emit('day_start', {
        dayNum: room.nightNum,
        players: publicPlayers(room.players),
      });
      // Tell each player their day state
      for (const player of room.players) {
        const isSlayer = player.roleId === 'slayer' && player.alive && !player.usedOnceAbility;
        emitToPlayer(room, player, 'day_update', {
          dayNum: room.nightNum,
          players: publicPlayers(room.players),
          alive: player.alive,
          isSlayer,
        });
      }
    }
  });

  socket.on('execute_player', ({ code, nomineeId, nominatorId }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    const target = room.players.find(p => p.id === nomineeId);
    if (!target?.alive) return;

    room.players = room.players.map(p => p.id === nomineeId ? { ...p, alive: false } : p);
    const log = [`${target.name} was executed.`];

    // Virgin trigger
    if (target.roleId === 'virgin' && !target.virginNominated && nominatorId) {
      const nominator = room.players.find(p => p.id === nominatorId);
      if (nominator && ROLES[nominator.roleId]?.team === 'townsfolk') {
        room.players = room.players.map(p => p.id === nominatorId ? { ...p, alive: false } : p);
        log.push(`${nominator.name} was immediately executed as the nominator.`);
      }
      room.players = room.players.map(p => p.id === target.id ? { ...p, virginNominated: true } : p);
    }

    // Saint trigger
    if (target.roleId === 'saint') {
      io.to(code).emit('game_over', {
        winner: 'evil', reason: "The execution sealed evil's victory.",
        players: room.players, redHerringId: room.redHerringId,
      });
      room.phase = 'game_over';
      return;
    }

    room.executedToday = target;
    room.executionHappenedToday = true;

    if (!checkAndEmitWin(room, code, true)) {
      io.to(code).emit('execution_result', {
        log, players: publicPlayers(room.players), executionHappenedToday: true,
      });
    }
  });

  socket.on('slayer_shot', ({ code, playerId, targetId }) => {
    const room = rooms.get(code);
    if (!room) return;

    const shooter = room.players.find(p => p.id === playerId);
    const target = room.players.find(p => p.id === targetId);
    if (!shooter?.alive || shooter.usedOnceAbility || !target?.alive) return;

    room.players = room.players.map(p => p.id === playerId ? { ...p, usedOnceAbility: true } : p);

    const isDemon = ROLES[target.roleId]?.team === 'demon';
    if (isDemon) room.players = room.players.map(p => p.id === targetId ? { ...p, alive: false } : p);

    emitToPlayer(room, shooter, 'slayer_result', { hit: isDemon, targetName: target.name });

    if (!isDemon || !checkAndEmitWin(room, code, false)) {
      io.to(code).emit('slayer_public', {
        shooterName: shooter.name, targetName: target.name, hit: isDemon,
        players: publicPlayers(room.players),
      });
    }
  });

  socket.on('end_day', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;
    // Trigger night (handled by host tapping "Begin Night")
    io.to(code).emit('day_ended');
  });

  socket.on('disconnect', () => {
    const { code, playerIndex } = socket.data || {};
    if (code && playerIndex !== undefined) {
      const room = rooms.get(code);
      if (room && room.playerSockets[playerIndex] === socket.id) {
        // Don't delete — allow reconnect
      }
    }
  });
});

// ─── Tunnel URL (set by localtunnel process via TUNNEL_URL env var) ────────

let tunnelUrl = process.env.TUNNEL_URL || null;
app.get('/api/tunnel-url', (_, res) => res.json({ url: tunnelUrl }));

// Allow the tunnel helper to register its URL at runtime
app.post('/api/tunnel-url', express.json(), (req, res) => {
  tunnelUrl = req.body?.url || null;
  if (tunnelUrl) console.log(`\n  🌐 Tunnel URL: ${tunnelUrl}\n`);
  res.json({ ok: true });
});

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`\nBlood on the Clocktower — Online server running\n`);
  console.log(`  Local        : http://localhost:${PORT}`);
  const nets = networkInterfaces();
  for (const iface of Object.values(nets).flat()) {
    if (iface.family === 'IPv4' && !iface.internal) {
      console.log(`  Local network: http://${iface.address}:${PORT}`);
    }
  }

  // Auto-start Cloudflare tunnel if LT=1 env var is set (used by npm run tunnel)
  if (process.env.LT === '1') {
    try {
      const { tunnel } = await import('cloudflared');
      const { url, connections, child } = tunnel({ '--url': `http://localhost:${PORT}` });
      tunnelUrl = await url;
      console.log(`\n  🌐 Tunnel URL: ${tunnelUrl}`);
      console.log(`  Share this with players joining over the internet.\n`);
      child.on('exit', () => { tunnelUrl = null; });
    } catch (e) {
      console.warn(`  ⚠ Could not start tunnel: ${e.message}`);
      console.warn(`  Run: npm install\n`);
    }
  } else {
    console.log(`\n  For internet play: run  npm run tunnel\n`);
  }
});
