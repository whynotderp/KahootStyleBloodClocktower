import { Routes, Route, Navigate } from 'react-router-dom';
import HostApp from './host/HostApp.jsx';
import PlayerApp from './player/PlayerApp.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HostApp />} />
      <Route path="/join" element={<PlayerApp />} />
      <Route path="/play" element={<PlayerApp />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
