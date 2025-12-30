import { io } from "socket.io-client";

// Set this in Vercel + local .env
// Example: VITE_KARGO_SERVER_URL="https://your-render-service.onrender.com"
const URL = import.meta.env.VITE_KARGO_SERVER_URL || "http://localhost:3001";

export const socket = io(URL, {
  transports: ["websocket"],
  withCredentials: true
});
