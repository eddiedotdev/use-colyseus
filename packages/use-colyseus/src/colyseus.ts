import { Schema } from "@colyseus/schema";
import { Client, type Room } from "colyseus.js";
import { create } from "zustand";

export const colyseus = <S extends Schema>(
  endpoint: string,
  schema?: new (...args: unknown[]) => S,
) => {
  const client = new Client(endpoint);
  const colyseusStore = useColyseusStore<S>();

  let connecting = false;

  const connectToColyseus = async (roomName: string, options = {}) => {
    if (connecting || colyseusStore.getState().room) return;

    connecting = true;

    try {
      const room = await client.joinOrCreate<S>(roomName, options, schema);

      colyseusStore.getState().setRoom(room);
      colyseusStore.getState().setState(room.state);

      const updatedCollectionsMap: { [key in keyof S]?: boolean } = {};

      for (const [key, value] of Object.entries(room.state as Schema)) {
        if (
          typeof value !== "object" ||
          !value.clone ||
          !value.onAdd ||
          !value.onRemove
        ) {
          continue;
        }

        updatedCollectionsMap[key as keyof S] = false;

        value.onAdd(() => {
          updatedCollectionsMap[key as keyof S] = true;
        });

        value.onRemove(() => {
          updatedCollectionsMap[key as keyof S] = true;
        });
      }

      room.onStateChange((state) => {
        if (!state) return;

        const copy = { ...state };

        for (const [key, update] of Object.entries(updatedCollectionsMap)) {
          if (!update) continue;

          updatedCollectionsMap[key as keyof S] = false;

          const value = state[key as keyof S] as unknown;

          if ((value as Schema).clone) {
            //@ts-ignore
            copy[key as keyof S] = value.clone();
          }
        }

        colyseusStore.getState().setState(copy);
      });

      console.log(
        `Successfully connected to Colyseus room ${roomName} at ${endpoint}`,
      );
    } catch (e) {
      console.error("Failed to connect to Colyseus!");
      console.log(e);
    } finally {
      connecting = false;
    }
  };

  const disconnectFromColyseus = async () => {
    const room = colyseusStore.getState().room;
    if (!room) return;

    colyseusStore.getState().setRoom(undefined);
    colyseusStore.getState().setState(undefined);

    try {
      await room.leave();
      console.log("Disconnected from Colyseus!");
    } catch {}
  };

  const useColyseusRoom = () => {
    const { room } = colyseusStore((state) => ({
      room: state.room,
    }));

    return room;
  };

  function useColyseusState<T extends (state: S) => S | ReturnType<T> | undefined>(
    selector?: T,
  ): S | ReturnType<T> | undefined {
    const state = colyseusStore((state) => state.state);
    if (state === undefined) {
      return undefined;
    }
    return selector ? selector(state) : state;
  }


  return {
    client,
    connectToColyseus,
    disconnectFromColyseus,
    useColyseusRoom,
    useColyseusState,
  };
};

interface StateStore<S extends Schema> {
  room: Room<S> | undefined;
  state: S | undefined;
  setRoom: (room: Room<S> | undefined) => void;
  setState: (state: S | undefined) => void;
}

export const useColyseusStore = <S extends Schema>() =>
  create<StateStore<S>>((set) => ({
    room: undefined,
    state: undefined,
    setRoom: (room) => set({ room }),
    setState: (state) => set({ state }),
  }));