/**
 * Game Configuration Constants
 * All game parameters are defined here for easy configuration
 */

// Player and Round Configuration
export const MAX_PLAYERS = 6;
export const MAX_ROUNDS = 1;
export const MIN_PLAYERS_TO_START = 3;

// Mafia Kill Configuration
export const KILL_COOLDOWN_MS = 15 * 1000; // 15 seconds in milliseconds
export const KILL_SUCCESS_CHANCE = 0.5; // 50% success rate (0-1)
export const MAX_KILL_ATTEMPTS = 3; // Maximum kill attempts per round

// Phase Duration Configuration (in milliseconds)
export const TASK_PHASE_DURATION_MS = 60 * 1000; // 60 seconds
export const DISCUSSION_PHASE_DURATION_MS = 45 * 1000; // 45 seconds
export const VOTING_PHASE_DURATION_MS = 60 * 1000; // 60 seconds

// Lobby Configuration
export const JOIN_WINDOW_DURATION_MS = 1 * 60 * 1000; // 2 minutes
export const CANCEL_GAME_WINDOW_MS = 10 * 1000; // 10 seconds

// Helper functions to convert to seconds for display
export const KILL_COOLDOWN_SECONDS = KILL_COOLDOWN_MS / 1000;
export const TASK_PHASE_DURATION_SECONDS = TASK_PHASE_DURATION_MS / 1000;
export const DISCUSSION_PHASE_DURATION_SECONDS = DISCUSSION_PHASE_DURATION_MS / 1000;
export const VOTING_PHASE_DURATION_SECONDS = VOTING_PHASE_DURATION_MS / 1000;
export const JOIN_WINDOW_DURATION_SECONDS = JOIN_WINDOW_DURATION_MS / 1000;

