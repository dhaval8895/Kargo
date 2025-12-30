import { useEffect, useMemo, useState } from "react";
import { socket } from "../net/socket";

export function useRoom() {
  const [connected, setConnected] = useState(socket.connected);
  const [roomId, setRoomId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [publicState, setPublicState] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }
    function onDisconnect() {
      setConnected(false);
      // keep last known roomId/playerId; don’t wipe UI on transient disconnects
    }

    function onRoomState(payload) {
      if (payload?.roomId) setRoomId(String(payload.roomId));
      if (payload?.you) setPlayerId(payload.you);
      setPublicState(payload?.state ?? null);
      setActivity(payload?.activity ?? []);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("ROOM_STATE", onRoomState);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("ROOM_STATE", onRoomState);
    };
  }, []);

  const api = useMemo(
    () => ({
      connected,
      roomId,
      playerId,
      state: publicState,
      activity,

      createRoom: (name) =>
        new Promise((resolve) => {
          socket.emit("CREATE_ROOM", { name }, (res) => {
            // ✅ set immediately from callback so UI updates even if ROOM_STATE lags
            if (res?.ok) {
              if (res.roomId) setRoomId(String(res.roomId));
              if (res.playerId) setPlayerId(res.playerId);
            }
            resolve(res);
          });
        }),

      joinRoom: (rid, name) =>
        new Promise((resolve) => {
          socket.emit("JOIN_ROOM", { roomId: rid, name }, (res) => {
            // ✅ set immediately from callback so UI updates even if ROOM_STATE lags
            if (res?.ok) {
              if (res.roomId) setRoomId(String(res.roomId));
              if (res.playerId) setPlayerId(res.playerId);
            }
            resolve(res);
          });
        }),

      action: (action) =>
        new Promise((resolve) => {
          if (!roomId || !playerId) {
            return resolve({ ok: false, error: "Not in a room yet" });
          }
          socket.emit("ACTION", { roomId, playerId, action }, (res) => resolve(res));
        }),
    }),
    [connected, roomId, playerId, publicState, activity]
  );

  return api;
}
