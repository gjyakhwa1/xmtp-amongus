export enum GameState {
  IDLE = "IDLE",
  LOBBY_CREATED = "LOBBY_CREATED",
  WAITING_FOR_PLAYERS = "WAITING_FOR_PLAYERS",
  ASSIGN_ROLES = "ASSIGN_ROLES",
  ROUND_1_TASKS = "ROUND_1_TASKS",
  ROUND_1_KILL = "ROUND_1_KILL",
  ROUND_1_DISCUSSION = "ROUND_1_DISCUSSION",
  ROUND_1_VOTING = "ROUND_1_VOTING",
  ROUND_2_TASKS = "ROUND_2_TASKS",
  ROUND_2_KILL = "ROUND_2_KILL",
  ROUND_2_DISCUSSION = "ROUND_2_DISCUSSION",
  ROUND_2_VOTING = "ROUND_2_VOTING",
  ROUND_3_TASKS = "ROUND_3_TASKS",
  ROUND_3_KILL = "ROUND_3_KILL",
  ROUND_3_DISCUSSION = "ROUND_3_DISCUSSION",
  ROUND_3_VOTING = "ROUND_3_VOTING",
  GAME_END = "GAME_END",
  CLEANUP = "CLEANUP",
}

export enum Role {
  CREW = "CREW",
  IMPOSTOR = "IMPOSTOR",
}

export interface Player {
  inboxId: string;
  username: string;
  role: Role | null;
  isAlive: boolean;
  completedTasks: number;
  killAttempts: number;
  lastKillAttempt: number | null; // timestamp
  voted: boolean;
  voteTarget: string | null;
}

export interface Game {
  state: GameState;
  lobbyGroupId: string | null;
  originalGroupId: string | null; // The group where /start was called
  players: Map<string, Player>;
  round: number;
  startTime: number | null;
  joinDeadline: number | null;
  currentPhaseDeadline: number | null;
  impostorInboxId: string | null;
  eliminatedPlayers: Set<string>;
  killCooldown: number; // milliseconds
  killSuccessChance: number; // 0-1
  maxKillAttempts: number;
  taskAssignments: Map<string, Task>; // inboxId -> Task
}

export interface Task {
  id: string;
  type: "PIN" | "WORD" | "MATH" | "UNSCRAMBLE" | "COUNT";
  question: string;
  answer: string;
  completed: boolean;
}

export interface VoteResult {
  target: string;
  votes: number;
}

