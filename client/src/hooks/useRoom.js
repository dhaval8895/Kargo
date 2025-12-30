import { useEffect, useMemo, useState } from "react";
import { socket } from "../net/socket";

export function useRoom() {
  const [connected, setConnected] = useState(socket.connected);
  const [roomId, setRoomId] = useState(null);
  const [playerId, setPlayerId] = useState(null);
  const [publicState, setPublicState] = useState(null);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    function onConnect() { setConnected(true); }
    function onDisconnect() { setConnected(false); }
    function onRoomState(payload) {
      setRoomId(payload.roomId);
      setPlayerId(payload.you);
      setPublicState(payload.state);
      setActivity(payload.activity || []);
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

  const api = useMemo(() => ({
    connected,
    roomId,
    playerId,
    state: publicState,
    activity,

    createRoom: (name) =>
      new Promise((resolve) => {
        socket.emit("CREATE_ROOM", { name }, (res) => resolve(res));
      }),

    joinRoom: (roomId, name) =>
      new Promise((resolve) => {
        socket.emit("JOIN_ROOM", { roomId, name }, (res) => resolve(res));
      }),

    action: (action) =>
      new Promise((resolve) => {
        socket.emit("ACTION", { roomId, playerId, action }, (res) => resolve(res));
      })
  }), [connected, roomId, playerId, publicState, activity]);

  return api;
}
