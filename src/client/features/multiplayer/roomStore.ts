import { create } from 'zustand';
import type { CompletionInfo, ErrorCode, NewPuzzleRequest, PlayerInfo, PuzzleInfo, RoomInfo } from '../../../shared/protocol';
import type { ConnectionStatus } from '../../net/RoomConnection';

interface RoomState {
  code: string | null;
  status: ConnectionStatus;
  attempt: number;
  error: { code?: ErrorCode; message?: string } | null;
  selfId: string | null;
  room: RoomInfo | null;
  players: PlayerInfo[];
  puzzle: PuzzleInfo | null;
  completion: CompletionInfo | null;
  latency: number | null;
  /** Actions provided by the active room page. */
  actions: {
    setCapacity(max: number): void;
    newPuzzle(req: NewPuzzleRequest): void;
    leave(): void;
    retry(): void;
  } | null;
  patch(p: Partial<RoomState>): void;
  reset(code: string | null): void;
}

export const useRoom = create<RoomState>((set) => ({
  code: null,
  status: 'connecting',
  attempt: 0,
  error: null,
  selfId: null,
  room: null,
  players: [],
  puzzle: null,
  completion: null,
  latency: null,
  actions: null,
  patch: (p) => set(p),
  reset: (code) =>
    set({ code, status: 'connecting', attempt: 0, error: null, selfId: null, room: null, players: [], puzzle: null, completion: null, latency: null, actions: null }),
}));

export function inviteLink(code: string): string {
  return `${window.location.origin}/room/${code}`;
}
