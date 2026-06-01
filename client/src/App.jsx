import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import HostApp from './host/HostApp.jsx';
import PlayerApp from './player/PlayerApp.jsx';

function LandingPage() {
  const navigate = useNavigate();
  return (
    <div className="screen screen-dark">
      <div className="card" style={{ textAlign: 'center', maxWidth: '380px' }}>
        <h1 className="title" style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>Blood on the Clocktower</h1>
        <p className="hint" style={{ marginBottom: '2rem' }}>Online — Trouble Brewing</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button
            className="btn-primary btn-wide"
            style={{ padding: '1.2rem', fontSize: '1.1rem' }}
            onClick={() => navigate('/host')}
          >
            🕰️ Host a Game
          </button>
          <button
            className="btn-secondary btn-wide"
            style={{ padding: '1.2rem', fontSize: '1.1rem' }}
            onClick={() => navigate('/join')}
          >
            👤 Join a Game
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/host" element={<HostApp />} />
      <Route path="/join" element={<PlayerApp />} />
      <Route path="/play" element={<PlayerApp />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
