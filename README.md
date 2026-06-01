# Bloodless on the Clocktower — Online

Multiplayer version where players use their phones and a central computer shows the shared game state.

## Setup

```bash
# Install server deps
npm install

# Install client deps
cd client && npm install && cd ..

# Dev mode (server + client with hot reload)
npm run dev

# Production build then run
npm run build
npm start
```

## How to play

1. Run `npm start` on the host computer
2. Open `http://localhost:3000` on the central screen
3. Enter player names, select roles, create room
4. Players open `http://<host-ip>:3000/join` on their phones
5. Each player selects their name to claim their seat
6. Host taps **Start Game** — roles are sent privately to each phone
7. Game proceeds with night/day cycle fully phone-driven
