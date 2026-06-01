export default function SeatingCircle({ players }) {
  const n = players.length;
  const cx = 140, cy = 140, r = 105;

  const seats = players.map((p, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return {
      ...p,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  });

  return (
    <svg viewBox="0 0 280 280" className="seating-svg">
      {/* Lines between neighbours */}
      {seats.map((s, i) => {
        const next = seats[(i + 1) % n];
        return (
          <line
            key={i}
            x1={s.x} y1={s.y}
            x2={next.x} y2={next.y}
            stroke="#3a2010" strokeWidth="1.5"
          />
        );
      })}
      {/* Player nodes */}
      {seats.map((s) => (
        <g key={s.id}>
          <circle
            cx={s.x} cy={s.y} r="18"
            fill={s.alive ? '#2a1208' : '#0d0804'}
            stroke={s.alive ? '#d4a843' : '#4a3020'}
            strokeWidth="1.5"
            opacity={s.alive ? 1 : 0.5}
          />
          <text
            x={s.x} y={s.y + (s.alive ? 1 : -2)}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            fill={s.alive ? '#f0e8d8' : '#6a5a4a'}
            fontFamily="Georgia, serif"
          >
            {s.name.length > 6 ? s.name.slice(0, 5) + '…' : s.name}
          </text>
          {!s.alive && (
            <text
              x={s.x} y={s.y + 7}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="8"
              fill="#6a4040"
              fontFamily="Georgia, serif"
            >
              †
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
