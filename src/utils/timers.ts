import type { GameManager } from "../gameManager.js";

// Timer management
const timers = new Map<string, NodeJS.Timeout>();

export function setPhaseTimer(
  phaseName: string,
  duration: number,
  callback: () => void,
  gameManager: GameManager
) {
  // Clear existing timer for this phase
  const existing = timers.get(phaseName);
  if (existing) {
    clearTimeout(existing);
    timers.delete(phaseName);
  }

  // Set deadline in game manager if applicable
  const deadline = Date.now() + duration;
  const game = gameManager.getGame();
  if (game) {
    game.currentPhaseDeadline = deadline;
  }

  const timer = setTimeout(() => {
    try {
      callback();
    } catch (error) {
      console.error(`Error in phase timer callback for ${phaseName}:`, error);
    } finally {
      timers.delete(phaseName);
      // Clear deadline if timer completed
      if (game) {
        game.currentPhaseDeadline = null;
      }
    }
  }, duration);

  timers.set(phaseName, timer);
  console.log(`⏰ Set phase timer: ${phaseName} for ${duration}ms`);
}

export function clearPhaseTimer(phaseName: string, gameManager: GameManager) {
  const timer = timers.get(phaseName);
  if (timer) {
    clearTimeout(timer);
    timers.delete(phaseName);
    console.log(`⏰ Cleared phase timer: ${phaseName}`);

    // Clear deadline in game manager
    const game = gameManager.getGame();
    if (game) {
      game.currentPhaseDeadline = null;
    }
  }
}

export function clearAllTimers(gameManager: GameManager) {
  console.log(`⏰ Clearing all timers (${timers.size} active)`);
  for (const [phaseName, timer] of timers.entries()) {
    clearTimeout(timer);
    timers.delete(phaseName);
  }

  // Clear deadline in game manager
  const game = gameManager.getGame();
  if (game) {
    game.currentPhaseDeadline = null;
  }
}

