import { io } from 'socket.io-client';

// In dev, Vite proxies /socket.io → server:3000
// In prod, same origin
const socket = io({ autoConnect: true, reconnection: true });

export default socket;
