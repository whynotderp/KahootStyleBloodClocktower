import { useState, useEffect } from 'react';
import socket from '../socket.js';
import { ROLES, TEAM_ORDER, TEAM_LABELS, TEAM_COLORS, getDistribution } from '../gameData.js';
import SeatingCircle from '../components/SeatingCircle.jsx';

// ─── Top-level host state machine ─────────────────────────────────────────

export default function HostApp() {
  const [phase, setPhase] = useState('setup_players'); // setup_players | setup_roles | lobby | seating | night | day | summary | game_over
  const [playerNames, setPlayerNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem('botc_names') || '[]'); } catch { return []; }
  });
  const [playerCount, setPlayerCount] = useState(() => {
    const saved = JSON.parse(localStorage.getItem('botc_names') || '[]');
    return saved.length >= 4 ? saved.length : 5;
  });
  const [rolePool, setRolePool] = useState(() => {
    try { return JSON.parse(localStorage.getItem('botc_roles') || '[]'); } catch { return []; }
  });
  const [roomCode, setRoomCode] = useState(null);
  const [joinedPlayers, setJoinedPlayers] = useState([]);
  const [players, setPlayers] = useState([]);
  const [nightNum, setNightNum] = useState(0);
  const [nightRound, setNightRound] = useState(1);
  const [r1Progress, setR1Progress] = useState({ ready: 0, total: 0 });
  const [r2Progress, setR2Progress] = useState({ ready: 0, total: 0 });
  const [deaths, setDeaths] = useState([]);
  const [executionLog, setExecutionLog] = useState([]);
  const [executionHappenedToday, setExecutionHappenedToday] = useState(false);
  const [winResult, setWinResult] = useState(null);
  const [endPlayers, setEndPlayers] = useState([]);
  const [redHerringId, setRedHerringId] = useState(null);

  useEffect(() => {
    socket.on('room_created', ({ code }) => {
      setRoomCode(code);
      setPhase('lobby');
    });
    socket.on('player_joined', ({ playerIndex, name, joined, total }) => {
      setJoinedPlayers(prev => {
        const next = [...prev];
        next[playerIndex] = name;
        return next;
      });
    });
    socket.on('all_players_joined', () => {}); // optional indicator
    socket.on('game_started', ({ players, seatingOrder }) => {
      setPlayers(players);
      setPhase('seating');
    });
    socket.on('night_start', ({ nightNum, ready, total }) => {
      setNightNum(nightNum);
      setNightRound(1);
      setR1Progress({ ready, total });
      setR2Progress({ ready: 0, total });
      setPhase('night');
    });
    socket.on('r1_progress', ({ ready, total }) => setR1Progress({ ready, total }));
    socket.on('night_r2_start', ({ nightNum, ready, total }) => {
      setNightRound(2);
      setR2Progress({ ready, total });
    });
    socket.on('r2_progress', ({ ready, total }) => setR2Progress({ ready, total }));
    socket.on('night_summary', ({ nightNum, deaths, players }) => {
      setDeaths(deaths);
      setPlayers(players);
      setPhase('summary');
    });
    socket.on('day_start', ({ dayNum, players }) => {
      setPlayers(players);
      setExecutionLog([]);
      setExecutionHappenedToday(false);
      setPhase('day');
    });
    socket.on('execution_result', ({ log, players, executionHappenedToday }) => {
      setPlayers(players);
      setExecutionLog(log);
      setExecutionHappenedToday(executionHappenedToday);
    });
    socket.on('slayer_public', ({ shooterName, targetName, hit, players }) => {
      setPlayers(players);
      setExecutionLog(prev => [...prev, hit
        ? `${shooterName} shot ${targetName} — they were the Demon and died!`
        : `${shooterName} shot ${targetName} — nothing happens.`]);
    });
    socket.on('game_over', ({ winner, reason, players, redHerringId }) => {
      setEndPlayers(players);
      setWinResult({ winner, reason });
      setRedHerringId(redHerringId);
      setPhase('game_over');
    });
    socket.on('day_ended', () => {}); // host controls night start

    return () => socket.removeAllListeners();
  }, []);

  // Persist settings
  useEffect(() => {
    if (playerNames.length) localStorage.setItem('botc_names', JSON.stringify(playerNames));
  }, [playerNames]);
  useEffect(() => {
    if (rolePool.length) localStorage.setItem('botc_roles', JSON.stringify(rolePool));
  }, [rolePool]);

  function createRoom() {
    socket.emit('create_room', { playerNames, rolePool });
  }

  if (phase === 'setup_players') return (
    <SetupPlayers
      count={playerCount} setCount={setPlayerCount}
      names={playerNames} setNames={setPlayerNames}
      onNext={() => setPhase('setup_roles')}
    />
  );

  if (phase === 'setup_roles') return (
    <SetupRoles
      playerCount={playerCount}
      pool={rolePool} setPool={setRolePool}
      onBack={() => setPhase('setup_players')}
      onNext={createRoom}
    />
  );

  if (phase === 'lobby') return (
    <Lobby
      code={roomCode}
      playerNames={playerNames}
      joined={joinedPlayers}
      onStart={() => socket.emit('start_game', { code: roomCode })}
    />
  );

  if (phase === 'seating') return (
    <SeatingScreen
      players={players}
      onBegin={() => socket.emit('start_night', { code: roomCode })}
    />
  );

  if (phase === 'night') return (
    <NightScreen
      nightNum={nightNum} nightRound={nightRound}
      r1Progress={r1Progress} r2Progress={r2Progress}
    />
  );

  if (phase === 'summary') return (
    <SummaryScreen
      nightNum={nightNum} deaths={deaths} players={players}
      onContinue={() => socket.emit('end_summary', { code: roomCode })}
    />
  );

  if (phase === 'day') return (
    <DayScreen
      players={players} nightNum={nightNum}
      executionLog={executionLog}
      executionHappenedToday={executionHappenedToday}
      onExecute={(nomineeId, nominatorId) => socket.emit('execute_player', { code: roomCode, nomineeId, nominatorId })}
      onEndDay={() => { socket.emit('end_day', { code: roomCode }); socket.emit('start_night', { code: roomCode }); }}
    />
  );

  if (phase === 'game_over') return (
    <GameOverScreen
      winResult={winResult}
      players={endPlayers}
      redHerringId={redHerringId}
      onReset={() => { setPhase('setup_players'); setRoomCode(null); setJoinedPlayers([]); setPlayers([]); setWinResult(null); }}
    />
  );

  return null;
}

// ─── Setup: Players ───────────────────────────────────────────────────────

function SetupPlayers({ count, setCount, names, setNames, onNext }) {
  function updateCount(n) {
    n = Math.max(4, Math.min(15, n));
    setCount(n);
    setNames(prev => {
      const next = [...prev];
      while (next.length < n) next.push('');
      return next.slice(0, n);
    });
  }
  function updateName(i, v) { setNames(prev => prev.map((n, idx) => idx === i ? v : n)); }

  return (
    <div className="screen">
      <div className="card">
        <h1 className="title">Blood on the Clocktower</h1>
        <h2 className="subtitle">Online — Host Setup</h2>
        <div className="field">
          <label className="label">Number of Players</label>
          <div className="count-row">
            <button className="btn-icon" onClick={() => updateCount(count - 1)} disabled={count <= 4}>−</button>
            <span className="count-display">{count}</span>
            <button className="btn-icon" onClick={() => updateCount(count + 1)} disabled={count >= 15}>+</button>
          </div>
        </div>
        <div className="names-grid">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className="name-field">
              <label className="label-sm">Player {i + 1}</label>
              <input className="input" value={names[i] || ''} onChange={e => updateName(i, e.target.value)} placeholder={`Player ${i + 1}`} maxLength={20} />
            </div>
          ))}
        </div>
        <button className="btn-primary btn-wide" onClick={onNext}>Next: Select Roles →</button>
      </div>
    </div>
  );
}

// ─── Setup: Roles ─────────────────────────────────────────────────────────

function SetupRoles({ playerCount, pool, setPool, onBack, onNext }) {
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const minimum = playerCount + 2;
  const counts = {};
  for (const r of pool) counts[r] = (counts[r] || 0) + 1;
  const teamCounts = {};
  for (const r of pool) { const t = ROLES[r]?.team; if (t) teamCounts[t] = (teamCounts[t] || 0) + 1; }
  const hasDemon = (teamCounts.demon || 0) >= 1;
  const canStart = pool.length >= minimum && hasDemon;

  function toggle(id) {
    if ((counts[id] || 0) === 0) { setPool(p => [...p, id]); }
    else if (allowDuplicates) { setPool(p => [...p, id]); }
    else { setPool(p => { const n = [...p]; n.splice(n.indexOf(id), 1); return n; }); }
  }
  function removeCopy(id) { setPool(p => { const n = [...p]; n.splice(n.lastIndexOf(id), 1); return n; }); }

  return (
    <div className="screen">
      <div className="card">
        <h2 className="title">Select Roles</h2>
        <p className="hint">Select at least <strong>{minimum}</strong> roles. Must include ≥ 1 Demon.</p>
        <div className="setup-controls">
          <div className="selected-count" style={{ color: canStart ? '#16a34a' : '#d97706' }}>
            {pool.length} selected (need ≥ {minimum}){!hasDemon ? ' · ⚠ need ≥ 1 Demon' : ''}
          </div>
          <label className="duplicate-toggle">
            <input type="checkbox" checked={allowDuplicates} onChange={e => setAllowDuplicates(e.target.checked)} />
            <span>Allow duplicates</span>
          </label>
        </div>
        {TEAM_ORDER.map(team => {
          const roles = Object.values(ROLES).filter(r => r.team === team);
          return (
            <div key={team} className="team-section">
              <h3 className="team-header" style={{ color: TEAM_COLORS[team] }}>{TEAM_LABELS[team]} <span className="team-count">({teamCounts[team] || 0})</span></h3>
              <div className="roles-grid">
                {roles.map(role => {
                  const cnt = counts[role.id] || 0;
                  return (
                    <div key={role.id} className={`role-card ${cnt > 0 ? 'role-selected' : ''}`} style={cnt > 0 ? { borderColor: TEAM_COLORS[team], backgroundColor: `${TEAM_COLORS[team]}18` } : {}}>
                      <div className="role-card-header" onClick={() => toggle(role.id)}>
                        <span className="role-name">{role.name}</span>
                        <div className="role-card-right">
                          {cnt > 0 && <span className="check">✓{cnt > 1 ? ` ×${cnt}` : ''}</span>}
                          {cnt > 1 && <button className="btn-sm btn-danger" onClick={e => { e.stopPropagation(); removeCopy(role.id); }}>−</button>}
                        </div>
                      </div>
                      <p className="role-desc">{role.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="footer-actions">
          <button className="btn-secondary" onClick={onBack}>← Back</button>
          <button className="btn-primary" disabled={!canStart} onClick={onNext}>Create Room →</button>
        </div>
      </div>
    </div>
  );
}

// ─── Lobby ────────────────────────────────────────────────────────────────

function Lobby({ code, playerNames, joined, onStart }) {
  const joinedCount = joined.filter(Boolean).length;
  const total = playerNames.length;
  const origin = window.location.origin;

  return (
    <div className="screen">
      <div className="card">
        <h2 className="title">Room Ready</h2>
        <div className="room-code-display">{code}</div>
        <p className="hint">Players open their browser and go to:</p>
        <div className="join-url">{origin}/join</div>
        <p className="hint" style={{ marginTop: '0.5rem' }}>Then enter code <strong>{code}</strong> and select their name.</p>

        <div className="player-join-list">
          {playerNames.map((name, i) => (
            <div key={i} className={`join-row ${joined[i] ? 'joined' : ''}`}>
              <span className="join-num">{i + 1}</span>
              <span className="join-name">{name}</span>
              <span className="join-status">{joined[i] ? '✓ Joined' : 'Waiting...'}</span>
            </div>
          ))}
        </div>

        <p className="hint">{joinedCount} / {total} players joined</p>
        <button className="btn-primary btn-wide" disabled={joinedCount === 0} onClick={onStart}>
          Start Game ({joinedCount}/{total} joined) →
        </button>
        <p className="hint-small">You can start with fewer players joined — they'll receive their roles when they connect.</p>
      </div>
    </div>
  );
}

// ─── Seating ──────────────────────────────────────────────────────────────

function SeatingScreen({ players, onBegin }) {
  const n = players.length;
  return (
    <div className="screen">
      <div className="card">
        <h2 className="title">Seating Order</h2>
        <p className="hint">Players sit in this circle. Neighbour relationships are based on physical seating.</p>
        <div className="seating-circle-wrap">
          <SeatingCircle players={players} />
        </div>
        <div className="seating-list-wrap">
          <p className="label">Reading clockwise:</p>
          <div className="seating-list">
            {players.map((p, i) => {
              const prev = players[(i - 1 + n) % n];
              const next = players[(i + 1) % n];
              return (
                <div key={p.id} className="seating-row">
                  <span className="seating-num">{i + 1}</span>
                  <span className="seating-name">{p.name}</span>
                  <span className="seating-neighbours">between <em>{prev.name}</em> and <em>{next.name}</em></span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="hint-small">Players are viewing their roles privately on their phones. Once everyone is ready, begin Night 1.</p>
        <button className="btn-primary btn-wide" onClick={onBegin}>Begin Night 1 →</button>
      </div>
    </div>
  );
}

// ─── Night progress ───────────────────────────────────────────────────────

function NightScreen({ nightNum, nightRound, r1Progress, r2Progress }) {
  const progress = nightRound === 1 ? r1Progress : r2Progress;
  const allDone = progress.ready >= progress.total && progress.total > 0;

  return (
    <div className="screen screen-dark">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="night-badge" style={{ margin: '0 auto 1rem' }}>Night {nightNum}</span>
        <h2 className="title" style={{ marginBottom: '0.5rem' }}>
          {nightRound === 1 ? 'Part 1 — Selections' : 'Part 2 — Information'}
        </h2>
        <p className="hint">
          {nightRound === 1
            ? 'Players are submitting their night actions on their phones.'
            : 'Players are receiving and acknowledging their information.'}
        </p>

        <div className="progress-ring-wrap">
          <div className="progress-count">{progress.ready} / {progress.total}</div>
          <div className="progress-label">players ready</div>
        </div>

        <div className="progress-bar-wrap">
          <div className="progress-bar" style={{ width: progress.total > 0 ? `${(progress.ready / progress.total) * 100}%` : '0%' }} />
        </div>

        {allDone && <p className="hint" style={{ color: '#4ade80', marginTop: '1rem' }}>✓ All players done — resolving...</p>}
      </div>
    </div>
  );
}

// ─── Night summary ────────────────────────────────────────────────────────

function SummaryScreen({ nightNum, deaths, players, onContinue }) {
  return (
    <div className="screen">
      <div className="card">
        <h2 className="title">Dawn breaks...</h2>
        <p className="subtitle">Night {nightNum} Summary</p>
        {deaths.length === 0
          ? <div className="summary-box safe"><div className="summary-icon">🌅</div><h3>No deaths last night.</h3></div>
          : <div className="summary-box danger">
              <div className="summary-icon">💀</div>
              <h3>{deaths.length === 1 ? '1 player' : `${deaths.length} players`} died:</h3>
              <ul className="death-list">{deaths.map((n, i) => <li key={i} className="death-entry">{n}</li>)}</ul>
            </div>}
        <div className="alive-list">
          <h3 className="section-title">Alive ({players.filter(p => p.alive).length})</h3>
          <div className="player-chips">{players.filter(p => p.alive).map(p => <span key={p.id} className="player-chip">{p.name}</span>)}</div>
        </div>
        <button className="btn-primary btn-wide" onClick={onContinue}>Begin Day {nightNum} →</button>
      </div>
    </div>
  );
}

// ─── Day phase ────────────────────────────────────────────────────────────

function DayScreen({ players, nightNum, executionLog, executionHappenedToday, onExecute, onEndDay }) {
  const [nominateStep, setNominateStep] = useState(null);
  const [nomineeId, setNomineeId] = useState(null);
  const [nominatorId, setNominatorId] = useState(null);
  const alive = players.filter(p => p.alive);

  function cancelNomination() { setNominateStep(null); setNomineeId(null); setNominatorId(null); }
  function handleExecute() {
    onExecute(nomineeId, nominatorId);
    cancelNomination();
  }

  const nominee = players.find(p => p.id === nomineeId);

  return (
    <div className="screen">
      <div className="card">
        <div className="day-header">
          <span className="day-badge">Day {nightNum}</span>
          <span className="alive-count">{alive.length} alive</span>
        </div>

        <div className="seating-circle-wrap"><SeatingCircle players={players} /></div>

        {executionLog.length > 0 && (
          <div className="events-box" style={{ marginTop: '0.75rem' }}>
            {executionLog.map((e, i) => <div key={i} className="event-entry">{e}</div>)}
          </div>
        )}

        {!executionHappenedToday && (
          <div className="execution-section">
            <h3 className="section-title">Execution</h3>
            {nominateStep === null && (
              <button className="btn-secondary btn-wide" onClick={() => setNominateStep('pick_nominee')}>⚖️ Nominate for Execution</button>
            )}
            {nominateStep === 'pick_nominee' && (
              <div className="nominate-box">
                <p className="label">Who is being nominated?</p>
                <div className="player-picker">
                  {alive.map(p => <button key={p.id} className={`pick-btn pick-danger ${nomineeId === p.id ? 'pick-selected' : ''}`} onClick={() => { setNomineeId(p.id); setNominateStep('pick_nominator'); }}>{p.name}</button>)}
                </div>
                <button className="btn-ghost" onClick={cancelNomination}>Cancel</button>
              </div>
            )}
            {nominateStep === 'pick_nominator' && nominee && (
              <div className="nominate-box">
                <p className="label"><strong>{nominee.name}</strong> nominated. Who is nominating?</p>
                <div className="player-picker">
                  {alive.filter(p => p.id !== nomineeId).map(p => <button key={p.id} className={`pick-btn ${nominatorId === p.id ? 'pick-selected' : ''}`} onClick={() => { setNominatorId(p.id); setNominateStep('confirm'); }}>{p.name}</button>)}
                </div>
                <button className="btn-ghost" onClick={() => setNominateStep('pick_nominee')}>← Back</button>
              </div>
            )}
            {nominateStep === 'confirm' && nominee && (
              <div className="nominate-box">
                <div className="execution-confirm-row">
                  <span className="execution-name">{nominee.name}</span>
                  <span className="hint-small">nominated by {players.find(p => p.id === nominatorId)?.name}</span>
                </div>
                <div className="btn-row">
                  <button className="btn-secondary" onClick={cancelNomination}>Cancel</button>
                  <button className="btn-danger" onClick={handleExecute}>⚖️ Execute {nominee.name}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {executionHappenedToday && <div className="executed-notice">⚖️ An execution has already taken place today.</div>}

        <div className="footer-actions">
          <button className="btn-primary" onClick={onEndDay}>End Day → Begin Night {nightNum + 1}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Game over ────────────────────────────────────────────────────────────

function GameOverScreen({ winResult, players, redHerringId, onReset }) {
  const goodWin = winResult?.winner === 'good';
  const ftInGame = players.some(p => p.roleId === 'fortuneTeller');
  const rh = redHerringId ? players.find(p => p.id === redHerringId) : null;

  return (
    <div className="screen">
      <div className="card">
        <div className={`win-banner ${goodWin ? 'win-good' : 'win-evil'}`}>
          <div className="win-icon">{goodWin ? '☀️' : '💀'}</div>
          <h1 className="win-title">{goodWin ? 'Good Wins!' : 'Evil Wins!'}</h1>
          <p className="win-reason">{winResult?.reason}</p>
        </div>
        <h3 className="section-title">All Roles Revealed</h3>
        <div className="reveal-list">
          {players.map(p => {
            const role = ROLES[p.roleId];
            return (
              <div key={p.id} className={`reveal-row ${!p.alive ? 'dead' : ''}`}>
                <span className="reveal-name">{p.name}{!p.alive ? ' †' : ''}</span>
                <span className="reveal-role" style={{ color: TEAM_COLORS[role?.team] }}>{role?.name || p.roleId}</span>
                {p.id === redHerringId && ftInGame && <span className="reveal-tag tag-herring">🔮 FT Red Herring</span>}
                {p.isActualDrunk && <span className="reveal-tag tag-drunk">Drunk (thought: {p.drunkRole})</span>}
              </div>
            );
          })}
        </div>
        {rh && ftInGame && (
          <div className="footnote-box">
            <span className="footnote-icon">🔮</span>
            <div><strong>FT Red Herring:</strong> {rh.name} always registered as Demon to the Fortune Teller.</div>
          </div>
        )}
        <button className="btn-primary btn-wide" style={{ marginTop: '1rem' }} onClick={onReset}>Play Again</button>
      </div>
    </div>
  );
}
