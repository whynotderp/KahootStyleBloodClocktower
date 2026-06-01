import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket.js';
import { ROLES, TEAM_COLORS } from '../gameData.js';

export default function PlayerApp() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('join'); // join | waiting | role | night_r1 | night_r2 | day | game_over
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [codeValid, setCodeValid] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [myIndex, setMyIndex] = useState(null);
  const [myName, setMyName] = useState('');
  const [myRole, setMyRole] = useState(null);
  const [roleRevealed, setRoleRevealed] = useState(false);

  // Night state
  const [nightData, setNightData] = useState(null); // { nightNum, hasAction, roleId, players }
  const [nightInfo, setNightInfo] = useState(null);  // { nightNum, info, isRavenKeeperDying, players }
  const [actionState, setActionState] = useState({});
  const [r2Acknowledged, setR2Acknowledged] = useState(false);

  // Day state
  const [dayData, setDayData] = useState(null);
  const [slayerResult, setSlayerResult] = useState(null);
  const [slayerTargetId, setSlayerTargetId] = useState(null);
  const [slayerConfirming, setSlayerConfirming] = useState(false);

  // End state
  const [winResult, setWinResult] = useState(null);
  const [endPlayers, setEndPlayers] = useState([]);

  useEffect(() => {
    socket.on('joined_ok', ({ playerIndex, name }) => {
      setMyIndex(playerIndex);
      setMyName(name);
      setPhase('waiting');
      navigate('/play');
      localStorage.setItem('botc_code', code || '');
    });
    socket.on('join_error', (msg) => { setJoinError(msg); });

    socket.on('your_role', (data) => {
      setMyRole(data);
      setRoleRevealed(false);
      setPhase('role');
    });

    socket.on('night_r1', (data) => {
      setNightData(data);
      setActionState({});
      setPhase('night_r1');
    });

    socket.on('night_r2', (data) => {
      setNightInfo(data);
      setR2Acknowledged(false);
      setPhase('night_r2');
    });

    socket.on('day_start', ({ dayNum, players }) => {
      setDayData({ dayNum, players });
      setSlayerResult(null);
      setSlayerTargetId(null);
      setSlayerConfirming(false);
      setPhase('day');
    });
    socket.on('day_update', (data) => setDayData(data));
    socket.on('execution_result', ({ players }) => setDayData(d => ({ ...d, players })));
    socket.on('slayer_public', ({ players }) => setDayData(d => ({ ...d, players })));
    socket.on('slayer_result', (data) => {
      setSlayerResult(data);
      setSlayerConfirming(false);
    });
    socket.on('night_summary', ({ players }) => setDayData(d => d ? { ...d, players } : d));

    socket.on('game_over', ({ winner, reason, players }) => {
      setWinResult({ winner, reason });
      setEndPlayers(players);
      setPhase('game_over');
    });

    return () => socket.removeAllListeners();
  }, [navigate]);

  // ── Join: Step 1 — enter code ────────────────────────────────────────────

  if (phase === 'join' && !codeValid) {
    return (
      <div className="screen">
        <div className="card">
          <h2 className="title">Join Game</h2>
          <p className="hint">Enter the 4-letter room code shown on the central screen.</p>
          <div className="field">
            <label className="label">Room Code</label>
            <input
              className="input code-input"
              value={code}
              onChange={e => { setCode(e.target.value.toUpperCase()); setJoinError(''); }}
              placeholder="ABCD"
              maxLength={4}
              onKeyDown={e => e.key === 'Enter' && code.length === 4 && checkCode()}
            />
          </div>
          {joinError && <p className="hint" style={{ color: '#e87070' }}>{joinError}</p>}
          <button className="btn-primary btn-wide" disabled={code.length !== 4}
            onClick={checkCode}>
            Find Room →
          </button>
        </div>
      </div>
    );

    function checkCode() {
      socket.emit('check_room', { code }, ({ exists, phase: rPhase }) => {
        if (!exists) { setJoinError('Room not found. Check the code and try again.'); return; }
        if (rPhase !== 'lobby') { setJoinError('That game has already started.'); return; }
        setJoinError('');
        setCodeValid(true);
      });
    }
  }

  // ── Join: Step 2 — enter name ─────────────────────────────────────────────

  if (phase === 'join' && codeValid) {
    return (
      <div className="screen">
        <div className="card">
          <h2 className="title">Enter Your Name</h2>
          <p className="hint">Room code: <strong>{code}</strong></p>
          <div className="field" style={{ marginTop: '1rem' }}>
            <label className="label">Your Name</label>
            <input
              className="input"
              value={name}
              onChange={e => { setName(e.target.value); setJoinError(''); }}
              placeholder="Enter your name"
              maxLength={20}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && name.trim() && joinGame()}
            />
          </div>
          {joinError && <p className="hint" style={{ color: '#e87070' }}>{joinError}</p>}
          <button className="btn-primary btn-wide" disabled={!name.trim()} onClick={joinGame}>
            Join →
          </button>
          <button className="btn-ghost btn-wide" onClick={() => { setCodeValid(false); setJoinError(''); }}>
            ← Change Code
          </button>
        </div>
      </div>
    );

    function joinGame() {
      socket.emit('join_room', { code, name: name.trim() });
    }
  }

  // ── Waiting ─────────────────────────────────────────────────────────────

  if (phase === 'waiting') {
    return (
      <div className="screen screen-dark">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2 className="player-name-big">{myName}</h2>
          <div className="moon-icon" style={{ fontSize: '3rem', margin: '1.5rem 0' }}>🕰️</div>
          <p className="hint">Waiting for the host to start the game...</p>
        </div>
      </div>
    );
  }

  // ── Role Reveal ──────────────────────────────────────────────────────────

  if (phase === 'role') {
    const role = myRole;
    const teamColor = TEAM_COLORS[role?.team] || '#666';

    if (!roleRevealed) return (
      <div className="screen screen-dark">
        <div className="card" style={{ textAlign: 'center' }}>
          <h2 className="subtitle">Your role is ready</h2>
          <h1 className="player-name-big">{myName}</h1>
          <p className="hint">Make sure nobody else can see your screen.</p>
          <button className="btn-primary btn-wide btn-large" onClick={() => setRoleRevealed(true)}>
            Reveal My Role
          </button>
        </div>
      </div>
    );

    return (
      <div className="screen screen-dark">
        <div className="card">
          <div className="role-reveal-card" style={{ borderColor: teamColor }}>
            <div className="role-reveal-team" style={{ backgroundColor: teamColor }}>{role?.team?.toUpperCase()}</div>
            <div className="role-reveal-name">{role?.roleName}</div>
            <p className="role-reveal-desc">{role?.description}</p>
          </div>

          {role?.minionNames?.length > 0 && (
            <div className="evil-info-box">
              <div className="evil-info-label">🔴 Your Minion{role.minionNames.length > 1 ? 's' : ''}:</div>
              <div className="evil-info-names">{role.minionNames.map((n, i) => <span key={i} className="evil-name-chip">{n}</span>)}</div>
              <div className="evil-info-note">Name only — you don't know their specific role.</div>
            </div>
          )}
          {role?.minionNames !== null && role?.minionNames?.length === 0 && (
            <div className="evil-info-box"><div className="evil-info-label">🔴 You have no Minions this game.</div></div>
          )}
          {role?.demonNames?.length > 0 && (
            <div className="evil-info-box">
              <div className="evil-info-label">🔴 The Demon:</div>
              <div className="evil-info-names">{role.demonNames.map((n, i) => <span key={i} className="evil-name-chip">{n}</span>)}</div>
              <div className="evil-info-note">Name only — you don't know their demon type.</div>
            </div>
          )}

          {role?.startInfo && (
            <div className="info-box">
              <div className="info-label">Your starting information:</div>
              <div className="info-text">{role.startInfo}</div>
            </div>
          )}

          <p className="hint-small">Memorize your role. The game will begin soon.</p>
        </div>
      </div>
    );
  }

  // ── Night Round 1 ────────────────────────────────────────────────────────

  if (phase === 'night_r1') {
    const { nightNum, hasAction, roleId, players } = nightData;
    const locked = actionState.locked === true;

    function submitAction() {
      socket.emit('r1_submit', {
        code: code || localStorage.getItem('botc_code'),
        playerId: myRole?.playerId,
        roleId: hasAction ? roleId : null,
        targetId: actionState.targetId ?? null,
        secondTargetId: actionState.secondTargetId ?? null,
      });
      setPhase('night_r1_waiting');
    }

    const alive = players.filter(p => p.alive);
    const othersAlive = alive.filter(p => p.id !== myRole?.playerId);
    const needsLock = hasAction;
    const isReady = !needsLock || locked;

    return (
      <div className="screen screen-dark">
        <div className="card">
          <div className="night-header">
            <span className="night-badge">Night {nightNum}</span>
            <span className="phase-badge">Part 1 of 2</span>
          </div>
          <h2 className="subtitle" style={{ textAlign: 'left', marginBottom: '0.5rem' }}>{myName}</h2>

          {hasAction
            ? <NightActionPicker
                roleId={roleId} players={players} alive={alive} othersAlive={othersAlive}
                myId={myRole?.playerId}
                actionState={actionState} setActionState={setActionState}
                alreadyJumped={players.some(p => p.fangGuJumped)}
              />
            : <div className="no-action-box"><div className="moon-icon">🌙</div><p>Nothing to do this phase.</p></div>
          }

          <button className="btn-primary btn-wide" disabled={!isReady} onClick={submitAction}>
            {hasAction ? 'Submit & Wait' : 'Ready — Waiting for others'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'night_r1_waiting') {
    return (
      <div className="screen screen-dark">
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="night-badge" style={{ margin: '0 auto 1rem' }}>Night {nightData?.nightNum}</span>
          <div className="moon-icon" style={{ fontSize: '2.5rem', margin: '1.5rem 0' }}>⏳</div>
          <p className="hint">Waiting for all players to submit...</p>
        </div>
      </div>
    );
  }

  // ── Night Round 2 ────────────────────────────────────────────────────────

  if (phase === 'night_r2') {
    const { nightNum, info, isRavenKeeperDying, players } = nightInfo;
    const locked = actionState.locked === true;

    function acknowledge() {
      socket.emit('r2_acknowledge', {
        code: code || localStorage.getItem('botc_code'),
        playerId: myRole?.playerId,
        rkTargetId: isRavenKeeperDying && locked ? actionState.targetId : null,
      });
      setR2Acknowledged(true);
      setPhase('night_r2_waiting');
    }

    const isReady = !isRavenKeeperDying || locked;

    return (
      <div className="screen screen-dark">
        <div className="card">
          <div className="night-header">
            <span className="night-badge">Night {nightNum}</span>
            <span className="phase-badge">Part 2 of 2</span>
          </div>
          <h2 className="subtitle" style={{ textAlign: 'left', marginBottom: '0.5rem' }}>{myName}</h2>

          {isRavenKeeperDying
            ? <RavenKeeperPicker players={players} actionState={actionState} setActionState={setActionState} />
            : info
              ? <div className="action-box">
                  <h3 className="action-title">Your Information</h3>
                  <div className="info-box"><div className="info-text">{info}</div></div>
                </div>
              : <div className="no-action-box"><div className="moon-icon">🌙</div><p>Nothing to report this phase.</p></div>
          }

          <button className="btn-primary btn-wide" disabled={!isReady} onClick={acknowledge}>
            {isRavenKeeperDying ? 'Confirm & Submit' : 'Acknowledged — Continue'}
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'night_r2_waiting') {
    return (
      <div className="screen screen-dark">
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="moon-icon" style={{ fontSize: '2.5rem', margin: '1.5rem 0' }}>⏳</div>
          <p className="hint">Waiting for all players to acknowledge...</p>
        </div>
      </div>
    );
  }

  // ── Day phase ────────────────────────────────────────────────────────────

  if (phase === 'day') {
    const isSlayer = myRole?.roleId === 'slayer' && !myRole?.usedSlayer && dayData?.isSlayer;
    const alive = dayData?.players?.filter(p => p.alive) || [];
    const othersAlive = alive.filter(p => p.id !== myRole?.playerId);
    const myPlayer = dayData?.players?.find(p => p.id === myRole?.playerId);

    return (
      <div className="screen">
        <div className="card">
          <div className="day-header">
            <span className="day-badge">Day {dayData?.dayNum}</span>
            {myPlayer && <span className={`player-badge`} style={{ backgroundColor: TEAM_COLORS[myRole?.team] }}>{myName}</span>}
          </div>

          {!myPlayer?.alive && (
            <div className="no-action-box" style={{ marginBottom: '1rem' }}>
              <p>☠️ You have died. You may observe but cannot act.</p>
            </div>
          )}

          {isSlayer && !slayerResult && !slayerConfirming && (
            <div className="ability-section">
              <h3 className="section-title">Your Ability</h3>
              <button className="btn-ability" onClick={() => setSlayerConfirming(true)}>
                🎯 Use Slayer Ability (once per game)
              </button>
            </div>
          )}

          {slayerConfirming && (
            <div className="action-box">
              <h3 className="action-title">Slayer — Choose Target</h3>
              <p className="hint-small">This is your one shot. If they're the Demon, they die.</p>
              <div className="player-picker">
                {othersAlive.map(p => (
                  <button key={p.id} className={`pick-btn ${slayerTargetId === p.id ? 'pick-selected' : ''}`} onClick={() => setSlayerTargetId(p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
              {slayerTargetId && (
                <>
                  <p className="hint-small">Shoot <strong>{alive.find(p => p.id === slayerTargetId)?.name}</strong>?</p>
                  <div className="btn-row">
                    <button className="btn-secondary" onClick={() => { setSlayerConfirming(false); setSlayerTargetId(null); }}>Cancel</button>
                    <button className="btn-danger" onClick={() => {
                      socket.emit('slayer_shot', { code, playerId: myRole?.playerId, targetId: slayerTargetId });
                    }}>🎯 Fire!</button>
                  </div>
                </>
              )}
            </div>
          )}

          {slayerResult && (
            <div className="info-box" style={{ marginTop: '0.75rem' }}>
              <div className="info-text">
                {slayerResult.hit
                  ? `✓ ${slayerResult.targetName} was the Demon — they died!`
                  : `${slayerResult.targetName} is not the Demon. Nothing happens.`}
              </div>
            </div>
          )}

          <div className="alive-list" style={{ marginTop: '1rem' }}>
            <h3 className="section-title">Alive Players</h3>
            <div className="player-chips">
              {alive.map(p => <span key={p.id} className="player-chip">{p.name}</span>)}
            </div>
          </div>

          <p className="hint-small" style={{ marginTop: '1rem' }}>Execution and voting are managed on the central screen.</p>
        </div>
      </div>
    );
  }

  // ── Game over ─────────────────────────────────────────────────────────────

  if (phase === 'game_over') {
    const goodWin = winResult?.winner === 'good';
    return (
      <div className="screen">
        <div className="card">
          <div className={`win-banner ${goodWin ? 'win-good' : 'win-evil'}`}>
            <div className="win-icon">{goodWin ? '☀️' : '💀'}</div>
            <h1 className="win-title">{goodWin ? 'Good Wins!' : 'Evil Wins!'}</h1>
            <p className="win-reason">{winResult?.reason}</p>
          </div>
          <p className="hint">Check the central screen for the full role reveal!</p>
          {myRole && (
            <div className="info-box">
              <div className="info-label">You were:</div>
              <div className="info-text"><strong>{myRole.roleName}</strong> ({myRole.team})</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

// ─── Night action picker (phone) ──────────────────────────────────────────

function NightActionPicker({ roleId, players, alive, othersAlive, myId, actionState, setActionState, alreadyJumped }) {
  const locked = actionState.locked === true;
  const selectedId = actionState.targetId;
  const selectedPlayer = players.find(p => p.id === selectedId);

  if (roleId === 'fortuneTeller') {
    const picks = [actionState.targetId, actionState.secondTargetId].filter(id => id != null);
    const bothPicked = picks.length === 2;

    return (
      <div className="action-box">
        <h3 className="action-title">Fortune Teller — Choose 2 Players</h3>
        <p className="hint-small">Choose 2 players to divine. Lock in to confirm. You'll get your answer in Part 2.</p>
        {!locked ? (
          <>
            <div className="player-picker">
              {players.map(p => (
                <button key={p.id}
                  className={`pick-btn ${picks.includes(p.id) ? 'pick-selected' : ''}`}
                  onClick={() => {
                    if (picks.includes(p.id)) {
                      const next = picks.filter(x => x !== p.id);
                      setActionState({ targetId: next[0] ?? null, secondTargetId: next[1] ?? null, locked: false });
                    } else if (picks.length < 2) {
                      setActionState({ targetId: picks[0] ?? p.id, secondTargetId: picks.length === 1 ? p.id : null, locked: false });
                    } else {
                      setActionState({ targetId: picks[1], secondTargetId: p.id, locked: false });
                    }
                  }}>
                  {p.alive ? p.name : `${p.name} †`}
                </button>
              ))}
            </div>
            {bothPicked && (
              <button className="btn-ability" style={{ marginTop: '0.5rem' }}
                onClick={() => setActionState(s => ({ ...s, locked: true }))}>
                🔮 Lock In Picks
              </button>
            )}
          </>
        ) : (
          <div className="info-box">
            <div className="info-text">
              ✓ Locked: <strong>{players.find(p => p.id === picks[0])?.name}</strong> &amp; <strong>{players.find(p => p.id === picks[1])?.name}</strong>
            </div>
          </div>
        )}
      </div>
    );
  }

  const title = {
    monk: 'Monk — Choose Protection',
    butler: 'Butler — Choose Master',
    poisoner: 'Poisoner — Choose Target',
    imp: 'Imp — Choose Victim',
    fangGu: 'Fang Gu — Choose Victim',
  }[roleId] || roleId;

  const desc = {
    monk: 'Choose a player to protect from the Demon tonight.',
    butler: 'Choose your master. You may only vote tomorrow if they vote.',
    poisoner: 'Choose a player to poison.',
    imp: 'Choose a player to kill. (Choosing yourself passes the Imp to a Minion.)',
    fangGu: alreadyJumped ? 'Choose a player to kill.' : 'Choose a player to kill. If they\'re an Outsider, you die instead and they become Fang Gu.',
  }[roleId] || '';

  const pool = ['monk', 'butler'].includes(roleId) ? othersAlive : alive;

  return (
    <div className="action-box">
      <h3 className="action-title">{title}</h3>
      <p className="hint-small">{desc}</p>
      {!locked ? (
        <>
          <div className="player-picker">
            {pool.map(p => (
              <button key={p.id} className={`pick-btn ${selectedId === p.id ? 'pick-selected' : ''}`}
                onClick={() => setActionState({ targetId: p.id, locked: false })}>
                {p.name}
              </button>
            ))}
          </div>
          {selectedPlayer && (
            <button className="btn-ability" style={{ marginTop: '0.5rem' }}
              onClick={() => setActionState(s => ({ ...s, locked: true }))}>
              🔒 Confirm: {selectedPlayer.name}
            </button>
          )}
        </>
      ) : (
        <div className="info-box"><div className="info-text">✓ Locked: <strong>{selectedPlayer?.name}</strong></div></div>
      )}
    </div>
  );
}

function RavenKeeperPicker({ players, actionState, setActionState }) {
  const locked = actionState.locked === true;
  const picked = players.find(p => p.id === actionState.targetId);
  return (
    <div className="action-box">
      <h3 className="action-title">Ravenkeeper — You die tonight</h3>
      <p className="hint-small">Choose any player to learn their character.</p>
      {!locked ? (
        <>
          <div className="player-picker">
            {players.map(p => (
              <button key={p.id} className={`pick-btn ${actionState.targetId === p.id ? 'pick-selected' : ''}`}
                onClick={() => setActionState({ targetId: p.id, locked: false })}>
                {p.alive ? p.name : `${p.name} †`}
              </button>
            ))}
          </div>
          {picked && (
            <button className="btn-ability" style={{ marginTop: '0.5rem' }}
              onClick={() => setActionState(s => ({ ...s, locked: true }))}>
              🦅 Reveal {picked.name}'s Role
            </button>
          )}
        </>
      ) : (
        <div className="info-box">
          <div className="info-text">
            <strong>{picked?.name}</strong> is the <strong>{ROLES[picked?.roleId]?.name ?? picked?.roleId}</strong>.
          </div>
        </div>
      )}
    </div>
  );
}
