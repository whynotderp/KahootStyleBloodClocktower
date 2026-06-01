import { ROLES, getDistribution } from './gameData';

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function assignRoles(playerNames, rolePool) {
  const n = playerNames.length;
  const [tfCount, outCount, minCount, demCount] = getDistribution(n);

  const byTeam = { townsfolk: [], outsider: [], minion: [], demon: [], traveller: [] };
  for (const r of rolePool) {
    const team = ROLES[r]?.team;
    if (team) byTeam[team].push(r);
  }
  for (const t of Object.keys(byTeam)) byTeam[t] = shuffle(byTeam[t]);

  const drawn = [
    ...byTeam.demon.slice(0, demCount),
    ...byTeam.minion.slice(0, minCount),
    ...byTeam.outsider.slice(0, outCount),
    ...byTeam.townsfolk.slice(0, tfCount),
    ...byTeam.traveller,
  ];

  if (drawn.length < n) {
    const remaining = [...rolePool];
    for (const r of drawn) {
      const idx = remaining.indexOf(r);
      if (idx !== -1) remaining.splice(idx, 1);
    }
    drawn.push(...shuffle(remaining).slice(0, n - drawn.length));
  }

  const hasDemon = drawn.some(r => ROLES[r]?.team === 'demon');
  if (!hasDemon && byTeam.demon.length > 0) {
    const demonFromPool = byTeam.demon[Math.floor(Math.random() * byTeam.demon.length)];
    const replaceIdx = drawn.map(r => ROLES[r]?.team).lastIndexOf('townsfolk');
    if (replaceIdx !== -1) drawn[replaceIdx] = demonFromPool;
    else drawn[drawn.length - 1] = demonFromPool;
  }

  const finalRoles = shuffle(drawn.slice(0, n));
  const shuffledPlayers = shuffle(playerNames.map((name, i) => ({ name, index: i })));

  return shuffledPlayers.map((p, i) => ({
    id: p.index + 1, // 1-based — avoids falsy id=0 in boolean checks
    name: p.name,
    roleId: finalRoles[i],
    alive: true,
    poisoned: false,
    protected: false,
    butlerMaster: null,
    usedOnceAbility: false,
    virginNominated: false,
    drunkRole: null,
    isActualDrunk: false,
    fangGuJumped: false,
  }));
}

export function setupDrunk(players, rolePool) {
  const drunk = players.find(p => p.roleId === 'drunk');
  if (!drunk) return players;

  const townsfolkInPool = rolePool.filter(r => ROLES[r]?.team === 'townsfolk');
  const taken = players.map(p => p.roleId);
  const available = townsfolkInPool.filter(r => !taken.includes(r));
  const allTownsfolk = Object.keys(ROLES).filter(r => ROLES[r].team === 'townsfolk');
  const fakeRole = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : allTownsfolk[Math.floor(Math.random() * allTownsfolk.length)];

  return players.map(p =>
    p.id === drunk.id ? { ...p, drunkRole: fakeRole, isActualDrunk: true } : p
  );
}

export function getDisplayRole(player) {
  if (player.isActualDrunk && player.drunkRole) return player.drunkRole;
  return player.roleId;
}

export function alivePlayers(players) {
  return players.filter(p => p.alive);
}

export function getNeighbors(players, playerId) {
  const alive = alivePlayers(players);
  const idx = alive.findIndex(p => p.id === playerId);
  if (idx === -1) return [];
  const left = alive[(idx - 1 + alive.length) % alive.length];
  const right = alive[(idx + 1) % alive.length];
  return [left, right];
}

export function empathCount(players, playerId) {
  const neighbors = getNeighbors(players, playerId);
  return neighbors.filter(p => isEvil(p)).length;
}

function isEvil(player) {
  if (player.roleId === 'spy') return false;
  if (player.roleId === 'recluse') return true;
  return ROLES[player.roleId]?.team === 'minion' || ROLES[player.roleId]?.team === 'demon';
}

export function chefCount(players) {
  const alive = alivePlayers(players);
  let pairs = 0;
  for (let i = 0; i < alive.length; i++) {
    const next = alive[(i + 1) % alive.length];
    if (isEvil(alive[i]) && isEvil(next)) pairs++;
  }
  return pairs;
}

export function fortuneTellerCheck(players, pick1Id, pick2Id, redHerringId) {
  const p1 = players.find(p => p.id === pick1Id);
  const p2 = players.find(p => p.id === pick2Id);
  if (!p1 || !p2) return false;
  const isDemon = (p) => {
    if (p.id === redHerringId) return true;
    if (p.roleId === 'recluse') return true;
    return ROLES[p.roleId]?.team === 'demon';
  };
  return isDemon(p1) || isDemon(p2);
}

// Generate first-night info for the role reveal phase (no poison accounted for yet)
export function generateFirstNightInfo(players, roleId, playerId) {
  switch (roleId) {
    case 'washerwoman': {
      const townsfolk = players.filter(p => ROLES[p.roleId]?.team === 'townsfolk' && p.id !== playerId);
      if (townsfolk.length === 0) return { result: 'No Townsfolk detected.' };
      const target = townsfolk[Math.floor(Math.random() * townsfolk.length)];
      const other = players.filter(p => p.id !== target.id && p.id !== playerId);
      const decoy = other.length > 0 ? other[Math.floor(Math.random() * other.length)] : null;
      const pair = shuffle([target, decoy].filter(Boolean)).slice(0, 2);
      return { result: `One of these players is the ${ROLES[target.roleId]?.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'librarian': {
      const outsiders = players.filter(p => ROLES[p.roleId]?.team === 'outsider' && p.id !== playerId);
      if (outsiders.length === 0) return { result: 'There are no Outsiders in play.' };
      const target = outsiders[Math.floor(Math.random() * outsiders.length)];
      const other = players.filter(p => p.id !== target.id && p.id !== playerId);
      const decoy = other.length > 0 ? other[Math.floor(Math.random() * other.length)] : null;
      const pair = shuffle([target, decoy].filter(Boolean)).slice(0, 2);
      return { result: `One of these players is the ${ROLES[target.roleId]?.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'investigator': {
      const minions = players.filter(p => ROLES[p.roleId]?.team === 'minion' && p.id !== playerId);
      if (minions.length === 0) return { result: 'No Minions detected.' };
      const target = minions[Math.floor(Math.random() * minions.length)];
      const other = players.filter(p => p.id !== target.id && p.id !== playerId);
      const decoy = other.length > 0 ? other[Math.floor(Math.random() * other.length)] : null;
      const pair = shuffle([target, decoy].filter(Boolean)).slice(0, 2);
      return { result: `One of these players is the ${ROLES[target.roleId]?.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'chef': {
      const count = chefCount(players);
      return { result: `There are ${count} pair${count !== 1 ? 's' : ''} of evil players sitting next to each other.` };
    }
    default:
      return null;
  }
}

// Generate all night info for Round 2 — called AFTER poison and protection are applied.
// Poisoned players receive potentially wrong information without being told why.
export function generateAllNightInfo(players, nightActions, nightNum, executedToday, redHerringId) {
  const nightInfo = {};

  for (const player of players) {
    if (!player.alive) continue;

    const displayRole = player.isActualDrunk ? player.drunkRole : player.roleId;
    const poisoned = player.poisoned || player.isActualDrunk; // Drunk always gets unreliable info
    let info = null;

    if (nightNum === 1) {
      if (['washerwoman', 'librarian', 'investigator', 'chef'].includes(displayRole)) {
        if (poisoned) {
          info = generateWrongFirstNightInfo(players, displayRole, player.id);
        } else {
          info = generateFirstNightInfo(players, displayRole, player.id);
        }
      }
    }

    if (displayRole === 'empath') {
      const correct = empathCount(players, player.id);
      const shown = poisoned ? Math.floor(Math.random() * 3) : correct;
      const [left, right] = getNeighbors(players, player.id);
      info = { result: `${shown} of your 2 alive neighbours (${left?.name ?? '?'}, ${right?.name ?? '?'}) are evil.` };
    }

    if (displayRole === 'fortuneTeller') {
      const p1id = nightActions.fortuneTeller;
      const p2id = nightActions['fortuneTeller_2'];
      if (p1id != null && p2id != null) {
        const p1 = players.find(p => p.id === p1id);
        const p2 = players.find(p => p.id === p2id);
        const correct = fortuneTellerCheck(players, p1id, p2id, redHerringId);
        const shown = poisoned ? !correct : correct;
        info = {
          result: shown
            ? `⚠️ Yes — at least one of them (${p1?.name}, ${p2?.name}) is the Demon.`
            : `✓ No — neither ${p1?.name} nor ${p2?.name} is the Demon.`,
        };
      }
    }

    if (displayRole === 'undertaker' && nightNum > 1) {
      if (!poisoned && executedToday) {
        info = { result: `${executedToday.name} was executed today.` };
      }
      // Poisoned undertaker or no execution: nothing shown
    }

    if (info) nightInfo[player.id] = info;
  }

  return nightInfo;
}

// Produce plausible but wrong info for a poisoned/drunk player
function generateWrongFirstNightInfo(players, roleId, playerId) {
  switch (roleId) {
    case 'washerwoman': {
      // Point to two random players, claim one is a Townsfolk (pick any role name)
      const others = players.filter(p => p.id !== playerId);
      if (others.length < 2) return { result: 'No Townsfolk detected.' };
      const pair = shuffle(others).slice(0, 2);
      const fakeTf = Object.values(ROLES).filter(r => r.team === 'townsfolk');
      const fakeRole = fakeTf[Math.floor(Math.random() * fakeTf.length)];
      return { result: `One of these players is the ${fakeRole.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'librarian': {
      const others = players.filter(p => p.id !== playerId);
      if (others.length < 2) return { result: 'There are no Outsiders in play.' };
      const pair = shuffle(others).slice(0, 2);
      const fakeOut = Object.values(ROLES).filter(r => r.team === 'outsider');
      const fakeRole = fakeOut[Math.floor(Math.random() * fakeOut.length)];
      return { result: `One of these players is the ${fakeRole.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'investigator': {
      const others = players.filter(p => p.id !== playerId);
      if (others.length < 2) return { result: 'No Minions detected.' };
      const pair = shuffle(others).slice(0, 2);
      const fakeMin = Object.values(ROLES).filter(r => r.team === 'minion');
      const fakeRole = fakeMin[Math.floor(Math.random() * fakeMin.length)];
      return { result: `One of these players is the ${fakeRole.name}: ${pair.map(p => p.name).join(' or ')}` };
    }
    case 'chef': {
      const correct = chefCount(players);
      const wrong = correct === 0 ? 1 : 0;
      return { result: `There are ${wrong} pair${wrong !== 1 ? 's' : ''} of evil players sitting next to each other.` };
    }
    default:
      return null;
  }
}

// Resolve night kills — Monk protection and Poison are already applied to players before this call.
export function resolveNight(players, actions, nightNum) {
  let newPlayers = [...players];
  const events = [];
  const deaths = [];

  // Fang Gu kills
  if (actions.fangGu && nightNum > 1) {
    const fangGuPlayer = newPlayers.find(p => p.roleId === 'fangGu' && p.alive);
    const target = newPlayers.find(p => p.id === actions.fangGu);
    if (fangGuPlayer && target && target.alive) {
      const targetIsOutsider = ROLES[target.roleId]?.team === 'outsider';
      const alreadyJumped = newPlayers.some(p => p.fangGuJumped);
      if (targetIsOutsider && !alreadyJumped && !target.protected && target.roleId !== 'soldier') {
        newPlayers = newPlayers.map(p => {
          if (p.id === fangGuPlayer.id) return { ...p, alive: false };
          if (p.id === target.id) return { ...p, roleId: 'fangGu', fangGuJumped: true };
          return p;
        });
        deaths.push(fangGuPlayer.name);
        events.push({ type: 'fanggu_jump' });
      } else {
        if (!target.protected && target.roleId !== 'soldier') {
          newPlayers = newPlayers.map(p => p.id === target.id ? { ...p, alive: false } : p);
          deaths.push(target.name);
        } else {
          events.push({ type: 'attack_failed' });
        }
      }
    }
  }

  // Imp kills
  if (actions.imp && nightNum > 1) {
    const target = newPlayers.find(p => p.id === actions.imp);
    if (target) {
      if (!target.protected && target.roleId !== 'soldier') {
        const impPlayer = newPlayers.find(p => p.roleId === 'imp');
        if (impPlayer && target.id === impPlayer.id) {
          // Imp killed themselves — pass to a minion
          const minions = newPlayers.filter(p => p.alive && ROLES[p.roleId]?.team === 'minion');
          if (minions.length > 0) {
            const newImp = minions[Math.floor(Math.random() * minions.length)];
            newPlayers = newPlayers.map(p =>
              p.id === newImp.id ? { ...p, roleId: 'imp' } : p
            );
            events.push({ type: 'imp_suicide' });
          }
          newPlayers = newPlayers.map(p => p.id === target.id ? { ...p, alive: false } : p);
          deaths.push(target.name);
        } else {
          // Mayor redirect
          if (target.roleId === 'mayor') {
            const others = newPlayers.filter(p => p.alive && p.id !== target.id);
            if (others.length > 0) {
              const redirect = others[Math.floor(Math.random() * others.length)];
              newPlayers = newPlayers.map(p => p.id === redirect.id ? { ...p, alive: false } : p);
              deaths.push(redirect.name);
              events.push({ type: 'mayor_bounce' });
            }
          } else {
            newPlayers = newPlayers.map(p => p.id === target.id ? { ...p, alive: false } : p);
            deaths.push(target.name);
          }
        }
      } else {
        events.push({ type: 'attack_failed' });
      }
    }
  }

  // Scarlet Woman check
  const demon = newPlayers.find(p => ROLES[p.roleId]?.team === 'demon' && p.alive);
  if (!demon) {
    const sw = newPlayers.find(p => p.roleId === 'scarletWoman' && p.alive);
    const aliveCount = newPlayers.filter(p => p.alive).length;
    if (sw && aliveCount >= 5) {
      newPlayers = newPlayers.map(p => p.id === sw.id ? { ...p, roleId: 'imp' } : p);
      events.push({ type: 'scarlet_woman' });
    }
  }

  return { players: newPlayers, deaths, events };
}

export function checkWin(players, executionHappened) {
  const alive = alivePlayers(players);
  const demon = alive.find(p => ROLES[p.roleId]?.team === 'demon');

  if (!demon) {
    return { winner: 'good', reason: 'The Demon is dead!' };
  }

  const mayorAlive = alive.find(p => p.roleId === 'mayor');
  if (mayorAlive && alive.length === 3 && !executionHappened) {
    return { winner: 'good', reason: 'The town wins — only 3 remain and no execution occurred.' };
  }

  if (alive.length <= 2) {
    return { winner: 'evil', reason: 'Only 2 players remain. Evil wins!' };
  }

  return null;
}
