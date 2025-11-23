import type { Agent } from "@xmtp/agent-sdk";
import type { GameManager } from "../gameManager.js";
import {
  ContentTypeActions,
  type ActionsContent,
} from "../xmtp-inline-actions/types/index.js";
import { setPhaseTimer, clearPhaseTimer } from "../utils/timers.js";
import { GameState, type Player } from "../types.js";
import {
  TASK_PHASE_DURATION_MS,
  KILL_PHASE_DURATION_MS,
  DISCUSSION_PHASE_DURATION_MS,
  VOTING_PHASE_DURATION_MS,
  MAX_ROUNDS,
  KILL_SUCCESS_CHANCE,
  MAX_KILL_ATTEMPTS,
  KILL_COOLDOWN_SECONDS,
  CANCEL_GAME_WINDOW_MS,
  DISCUSSION_PHASE_DURATION_SECONDS,
  KILL_PHASE_DURATION_SECONDS,
  TASKS_PER_PLAYER,
  TASK_DISPATCH_BUFFER_MS,
} from "../config/gameConfig.js";
import { getPlayerAddress, formatAddressForMention } from "../utils/playerAddress.js";
import { sendKillButtons } from "../utils/killButtons.js";
import { sendVotingButtons } from "../utils/voteButtons.js";

export async function startGame(agent: Agent, gameManager: GameManager) {
  try {
    await gameManager.assignRoles();
    const lobbyId = gameManager.getGame().lobbyGroupId;

    if (lobbyId) {
      const group = await agent.client.conversations.getConversationById(lobbyId);
      if (group) {
        await group.send("Roles assigned.\n\nRound 1 is starting.");

        // Send game started message with cancel button (only works if game hasn't fully started)
        try {
          const cancelActionsContent: ActionsContent = {
            id: `cancel-game-${Date.now()}`,
            description: "🎮 Game Started!\n\nYou can cancel the game before Round 1 begins:",
            actions: [
              {
                id: "cancel-game",
                label: "❌ Cancel Game",
                style: "danger",
              },
            ],
            // Expire after cancel window (only allow cancellation briefly)
            expiresAt: new Date(Date.now() + CANCEL_GAME_WINDOW_MS).toISOString(),
          };

          // Try to send with content type using underlying client
          try {
            const client = (agent as any).client;
            if (client && client.conversations) {
              const conv = await client.conversations.getConversationById(lobbyId);
              if (conv) {
                await conv.send(cancelActionsContent, ContentTypeActions);
              } else {
                throw new Error("Could not get conversation");
              }
            } else {
              throw new Error("Could not access client");
            }
          } catch (error) {
            // Fallback to text message
            console.error("Error sending cancel button:", error);
            await group.send("🎮 Game Started! (Cancel option available for 10 seconds)");
          }
        } catch (error) {
          console.error("Error sending cancel button:", error);
        }

        // Start round 1
        await gameManager.startRound(1);
        // Start combined task and kill phase
        await startTaskAndKillPhase(1, agent, gameManager);
      }
    }
  } catch (error) {
    console.error("Error starting game:", error);
  }
}

export async function startTaskAndKillPhase(
  round: number,
  agent: Agent,
  gameManager: GameManager
) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  // Announce combined phase
  await group.send(
    `🛠️🔪 Round ${round} — Task & Kill Phase\n\n` +
    `Complete your assigned task by mentioning @mafia with your answer: @mafia /task <value>\n` +
    `Phase duration: ${Math.max(TASK_PHASE_DURATION_MS, KILL_PHASE_DURATION_MS) / 1000} seconds.`
  );

  // Send tasks one by one to all players
  // Each player gets TASKS_PER_PLAYER tasks
  // All tasks must be sent 15 seconds before phase ends
  const players = gameManager.getAlivePlayers();
  const totalTasks = players.length * TASKS_PER_PLAYER;
  const combinedPhaseDuration = Math.max(TASK_PHASE_DURATION_MS, KILL_PHASE_DURATION_MS);
  const availableTime = combinedPhaseDuration - TASK_DISPATCH_BUFFER_MS;
  const intervalBetweenTasks = Math.floor(availableTime / totalTasks);
  
  // Create a flat list of all tasks to send
  const taskQueue: Array<{ player: Player; taskIndex: number }> = [];
  for (const player of players) {
    for (let taskIndex = 0; taskIndex < TASKS_PER_PLAYER; taskIndex++) {
      taskQueue.push({ player, taskIndex });
    }
  }
  
  // Send tasks one by one with calculated intervals
  for (let i = 0; i < taskQueue.length; i++) {
    const { player, taskIndex } = taskQueue[i];
    const task = gameManager.getTaskForPlayer(player.inboxId, taskIndex);
    
    if (task) {
      try {
        // Get player address for mention
        const playerAddress = await getPlayerAddress(agent, player.inboxId, group);
        const addressMention = playerAddress
          ? `@${formatAddressForMention(playerAddress)}`
          : `@${player.username}`;

        // Send task to group with player mention
        // Mafia also gets tasks that they can fake complete
        await group.send(
          `${addressMention}\n\n🛠️ Task ${taskIndex + 1}/${TASKS_PER_PLAYER}:\n\n${task.question}\n\nSubmit your answer: @mafia /task <answer>`
        );
      } catch (error) {
        console.error(`Failed to send task to ${player.username}:`, error);
        // Fallback: send without address mention
        try {
          await group.send(
            `@${player.username}\n\n🛠️ Task ${taskIndex + 1}/${TASKS_PER_PLAYER}:\n\n${task.question}\n\nSubmit your answer: @mafia /task <answer>`
          );
        } catch (fallbackError) {
          console.error(`Failed to send fallback task message:`, fallbackError);
        }
      }
    }
    
    // Wait for the calculated interval before sending next task
    // Don't wait after the last task
    if (i < taskQueue.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalBetweenTasks));
    }
  }

  // Send kill instructions to mafia via DM
  const impostorInboxId = gameManager.getGame().impostorInboxId;
  if (impostorInboxId) {
    const impostor = gameManager.getPlayer(impostorInboxId);
    if (impostor && impostor.isAlive) {
      try {
        const dm = await agent.client.conversations.newDm(impostorInboxId);
        
        // Send kill instructions
        await dm.send(
          `Round ${round} — Task & Kill Phase\n\n` +
          `You must fake complete tasks while also attempting kills.\n\n` +
          `Success chance: ${(KILL_SUCCESS_CHANCE * 100).toFixed(0)}%\n` +
          `Max attempts: ${MAX_KILL_ATTEMPTS}\n` +
          `Cooldown: ${KILL_COOLDOWN_SECONDS} seconds per attempt\n` +
          `Phase duration: ${Math.max(TASK_PHASE_DURATION_MS, KILL_PHASE_DURATION_MS) / 1000} seconds\n\n` +
          `Select a target using the buttons below:`
        );

        // Send kill buttons
        await sendKillButtons(agent, dm, gameManager, round, impostorInboxId);
      } catch (error) {
        console.error("Failed to send kill phase DM:", error);
      }
    }
  }

  // After combined phase duration, move to discussion phase
  const phaseDuration = Math.max(TASK_PHASE_DURATION_MS, KILL_PHASE_DURATION_MS);
  setPhaseTimer(`taskAndKillPhase-${round}`, phaseDuration, async () => {
    // Only advance if we're still in task phase (not already advanced)
    const currentState = gameManager.getState();
    const isTaskPhase =
      currentState === GameState.ROUND_1_TASKS ||
      currentState === GameState.ROUND_2_TASKS ||
      currentState === GameState.ROUND_3_TASKS;

    if (isTaskPhase) {
      await gameManager.advancePhase();
      await startDiscussionPhase(round, agent, gameManager);
    }
  }, gameManager);
}

export async function startDiscussionPhase(
  round: number,
  agent: Agent,
  gameManager: GameManager
) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  await group.send(`💬 Discussion Phase — ${DISCUSSION_PHASE_DURATION_SECONDS} seconds.\n\nTalk freely.`);

  setPhaseTimer(`discussion-${round}`, DISCUSSION_PHASE_DURATION_MS, async () => {
    await gameManager.advancePhase();
    await startVotingPhase(round, agent, gameManager);
  }, gameManager);
}

export async function startVotingPhase(
  round: number,
  agent: Agent,
  gameManager: GameManager
) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  // Send voting phase announcement
  await group.send(
    `🗳️ Voting Phase\n\n` +
      `Vote to eliminate a player using the buttons below:`
  );

  // Send voting buttons
  await sendVotingButtons(agent, group, gameManager, round);

  // Reset votes
  for (const player of gameManager.getAlivePlayers()) {
    player.voted = false;
    player.voteTarget = null;
  }

  // Wait for votes, then process after timer
  setPhaseTimer(`voting-${round}`, VOTING_PHASE_DURATION_MS, async () => {
    await processVoting(round, agent, gameManager);
  }, gameManager);
}

export async function processVoting(
  round: number,
  agent: Agent,
  gameManager: GameManager
) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  const results = gameManager.getVoteResults();

  if (results.length === 0) {
    await group.send("No votes cast. No one eliminated.");
  } else {
    const topResult = results[0];
    const aliveCount = gameManager.getAlivePlayers().length;
    const majority = Math.ceil(aliveCount / 2);

    if (topResult.votes >= majority) {
      const eliminated = gameManager.getPlayer(topResult.target);
      if (eliminated) {
        await gameManager.eliminatePlayer(topResult.target);

        const roleEmoji = eliminated.role === "IMPOSTOR" ? "🔥" : "❌";
        const roleText = eliminated.role === "IMPOSTOR" ? "MAFIA" : "TOWN";

        await group.send(
          `${roleEmoji} @${eliminated.username} was eliminated.\n\n` +
            `They were a ${roleText}.`
        );

        // Check win condition
        const winCheck = gameManager.checkWinCondition();
        if (winCheck.gameEnded) {
          await endGame(winCheck.winner, agent, gameManager);
          return;
        }
      }
    } else {
      await group.send("Tie or no majority. No one eliminated.");
    }
  }

  // Check win condition before advancing to next round
  // If mafia was eliminated, game should have already ended
  const winCheck = gameManager.checkWinCondition();
  if (winCheck.gameEnded) {
    await endGame(winCheck.winner, agent, gameManager);
    return;
  }

  // Advance to next round or end game
  if (round < MAX_ROUNDS) {
    await gameManager.advancePhase();
    const nextRound = round + 1;
    await gameManager.startRound(nextRound);
    // Start combined task and kill phase
    await startTaskAndKillPhase(nextRound, agent, gameManager);
  } else {
    // Game end - mafia wins if still alive
    const finalWinCheck = gameManager.checkWinCondition();
    await endGame(finalWinCheck.winner || "IMPOSTOR", agent, gameManager);
  }
}

export async function endGame(
  winner: "CREW" | "IMPOSTOR" | null,
  agent: Agent,
  gameManager: GameManager
) {
  if (!winner) return;

  // Clear all timers when game ends
  const { clearAllTimers } = await import("../utils/timers.js");
  clearAllTimers(gameManager);

  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  if (winner === "CREW") {
    await group.send("🏆 TOWN WINS! Mafia was eliminated.");
  } else {
    await group.send(`🔥 MAFIA WINS! Survived all ${MAX_ROUNDS} rounds.`);
  }

  await gameManager.cleanup();
}

