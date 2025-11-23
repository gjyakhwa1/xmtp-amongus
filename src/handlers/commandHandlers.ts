import type { Agent } from "@xmtp/agent-sdk";
import { GameState } from "../types.js";
import type { GameManager } from "../gameManager.js";
import {
  getUsername,
  rejectCommandInDM,
} from "../utils/helpers.js";
import { requireLobbyGroup } from "../utils/lobby.js";
import { sendJoinMessageToOriginalGroup } from "../utils/messages.js";
import { setPhaseTimer, clearPhaseTimer } from "../utils/timers.js";
import { startGame } from "../game/gameFlow.js";
import {
  MAX_PLAYERS,
  JOIN_WINDOW_DURATION_MS,
  JOIN_WINDOW_DURATION_SECONDS,
  KILL_PHASE_DURATION_MS,
} from "../config/gameConfig.js";
import { ContentTypeActions, type ActionsContent } from "../xmtp-inline-actions/types/index.js";

// Handle /start command
export function setupStartHandler(agent: Agent, gameManager: GameManager) {
  return async (ctx: any) => {
    const parsed = ctx.parsedCommand;
    console.log("parsed", parsed);
    if (!parsed || parsed.command !== "start") {
      return;
    }

    // Reject command if sent in DM
    if (await rejectCommandInDM(ctx)) {
      return;
    }

    try {
      const username = await getUsername(ctx);
      const originalGroupId = ctx.conversation?.id;

      if (!originalGroupId) {
        await ctx.sendText("❌ Error: Could not identify the group.");
        return;
      }

      // Create lobby with original group ID
      const lobbyId = await gameManager.createLobby(originalGroupId);

      // Add the player who started the game
      const addResult = await gameManager.addPlayer(
        ctx.message.senderInboxId,
        username
      );

      if (!addResult.success) {
        await ctx.sendText(
          "❌ Error: Could not add you to the lobby. Please try again."
        );
        return;
      }

      // Get both groups
      const originalGroup =
        await agent.client.conversations.getConversationById(originalGroupId);
      const lobbyGroup = await agent.client.conversations.getConversationById(lobbyId);

      if (originalGroup && lobbyGroup) {
        // Add starter to the lobby group if not already added
        if ("addMembers" in lobbyGroup) {
          try {
            await (lobbyGroup as any).addMembers([ctx.message.senderInboxId]);
          } catch (error) {
            // Member might already be added, ignore
          }
        }

        // Send join message to the ORIGINAL group (where /start was called)
        await sendJoinMessageToOriginalGroup(
          agent,
          originalGroup,
          lobbyGroup,
          `🚀 MAFIA Game Lobby Created!\n\nUp to ${MAX_PLAYERS} players may join within ${JOIN_WINDOW_DURATION_SECONDS / 60} minutes.`
        );

        // Set timer to start game after join window
        setPhaseTimer("joinWindow", JOIN_WINDOW_DURATION_MS, async () => {
          if (gameManager.getState() === GameState.WAITING_FOR_PLAYERS) {
            if (gameManager.canStartGame()) {
              await startGame(agent, gameManager);
            } else {
              await lobbyGroup.send("Not enough players joined. Game cancelled.");
              const { clearAllTimers } = await import("../utils/timers.js");
              clearAllTimers(gameManager);
              await gameManager.cleanup();
            }
          }
        }, gameManager);
      }
    } catch (error: any) {
      await ctx.sendText(`❌ Error creating lobby: ${error.message}`);
    }
  };
}

// Handle /join command (only works in lobby group)
export function setupJoinHandler(agent: Agent, gameManager: GameManager) {
  return async (ctx: any) => {
    const parsed = ctx.parsedCommand;
    if (!parsed || parsed.command !== "join") {
      return;
    }

    // Reject command if sent in DM
    if (await rejectCommandInDM(ctx)) {
      return;
    }

    // Only allow /join in the lobby group
    if (!(await requireLobbyGroup(ctx, "join", gameManager))) {
      return;
    }

    try {
      const username = await getUsername(ctx);
      const result = await gameManager.addPlayer(
        ctx.message.senderInboxId,
        username
      );

      if (!result.success) {
        await ctx.sendText(
          "❌ Cannot join at this time. The game may be full or already in progress."
        );
        return;
      }

      const state = gameManager.getState();
      if (state === GameState.WAITING_FOR_PLAYERS) {
        const lobbyId = gameManager.getGame().lobbyGroupId;
        const originalGroupId = gameManager.getGame().originalGroupId;

        if (lobbyId && originalGroupId) {
          const lobbyGroup =
            await agent.client.conversations.getConversationById(lobbyId);
          const originalGroup = await agent.client.conversations.getConversationById(
            originalGroupId
          );

          if (lobbyGroup && originalGroup) {
            // Notify removed player if one was removed
            if (result.removedPlayer) {
              try {
                const dm = await agent.client.conversations.newDm(
                  result.removedPlayer.inboxId
                );
                await dm.send(
                  "⚠️ You were removed from the lobby to make room for a new player.\n\nYou can join again if there's space."
                );
              } catch (error) {
                console.error(`Failed to notify removed player:`, error);
              }

              // Notify lobby group about the removal
              await lobbyGroup.send(
                `⚠️ ${result.removedPlayer.username} was removed to make room for ${username}.`
              );
            }

            const players = Array.from(gameManager.getGame().players.values());
            const playerList = players.map((p) => p.username).join(", ");

            // Send updated lobby status to original group
            await sendJoinMessageToOriginalGroup(
              agent,
              originalGroup,
              lobbyGroup,
              `🚀 MAFIA LOBBY\n\nPlayers joined: ${playerList} (${players.length}/${MAX_PLAYERS})`
            );

            // Send confirmation to player in lobby group
            await ctx.sendText(
              `✅ You joined the game! Players: ${playerList} (${players.length}/${MAX_PLAYERS})`
            );

            // Send time remaining message to lobby group
            const { formatTimeRemaining } = await import("../utils/helpers.js");
            const joinDeadline = gameManager.getGame().joinDeadline;
            const timeMessage = formatTimeRemaining(joinDeadline);
            if (timeMessage && lobbyGroup) {
              await lobbyGroup.send(
                `⏰ Time remaining to start: ${timeMessage}\n\n` +
                `Players: ${playerList} (${players.length}/${MAX_PLAYERS})`
              );
            }

            // If lobby is full, start immediately
            if (players.length >= MAX_PLAYERS) {
              clearPhaseTimer("joinWindow", gameManager);
              await startGame(agent, gameManager);
            }
          }
        }
      }
    } catch (error: any) {
      await ctx.sendText(`❌ Error joining: ${error.message}`);
    }
  };
}

// Handle /task command
// Note: This command requires agent mention (handled by middleware)
export function setupTaskHandler(gameManager: GameManager) {
  return async (ctx: any) => {
    const parsed = ctx.parsedCommand;
    if (!parsed || parsed.command !== "task") {
      return;
    }

    // Ensure this is in a group (not DM) - tasks should be submitted in the lobby group
    const isDM = ctx.conversation && !("addMembers" in ctx.conversation);
    if (isDM) {
      await ctx.sendText(
        "❌ Task submissions should be done in the game lobby group, not in private messages.\n\nUse: @mafia /task <answer> in the lobby group."
      );
      return;
    }

    try {
      if (!parsed.args || parsed.args.length === 0) {
        await ctx.sendText("Usage: @mafia /task <value>");
        return;
      }

      const answer = parsed.args.join(" ").trim();
      const player = gameManager.getPlayer(ctx.message.senderInboxId);

      if (!player || !player.isAlive) {
        await ctx.sendText(
          "You are not part of an active game or have been eliminated."
        );
        return;
      }

      // All players (including mafia) can submit tasks
      // Mafia needs to fake complete tasks by guessing the correct answer
      const completed = await gameManager.completeTask(
        ctx.message.senderInboxId,
        answer
      );

      if (completed) {
        await ctx.sendText("✅ Task completed!");
      } else {
        await ctx.sendText("❌ Task answer incorrect. Try again.");
      }
    } catch (error: any) {
      await ctx.sendText(`Error: ${error.message}`);
    }
  };
}

// Handle kill command (DM only)
export function setupKillHandler(agent: Agent, gameManager: GameManager) {
  return async (ctx: any) => {
    const parsed = ctx.parsedCommand;
    if (!parsed || parsed.command !== "kill") {
      return;
    }

    // Only allow kills in DMs
    const isDM = ctx.conversation && !("addMembers" in ctx.conversation);
    if (!isDM) {
      await ctx.sendText(
        "Kill commands can only be used in private messages (DMs)."
      );
      return;
    }

    try {
      // If no arguments, send kill buttons with all available targets
      if (!parsed.args || parsed.args.length === 0) {
        const alivePlayers = gameManager.getAlivePlayers();
        const mafiaInboxId = gameManager.getGame().impostorInboxId;
        const killablePlayers = alivePlayers.filter(
          (p) => p.inboxId !== mafiaInboxId
        );

        if (killablePlayers.length === 0) {
          await ctx.sendText("❌ No players left to kill.");
          return;
        }

        // Get the lobby group to resolve addresses
        const lobbyId = gameManager.getGame().lobbyGroupId;
        const lobbyGroup = lobbyId
          ? await agent.client.conversations.getConversationById(lobbyId)
          : null;

        // Create kill buttons for each player
        const { getPlayerAddress } = await import("../utils/playerAddress.js");

        const killActions = await Promise.all(
          killablePlayers.map(async (player) => {
            // Try to get player address for display
            const playerAddress = lobbyGroup
              ? await getPlayerAddress(agent, player.inboxId, lobbyGroup)
              : null;
            const displayName = playerAddress
              ? `${player.username} (${playerAddress.slice(0, 6)}...${playerAddress.slice(-4)})`
              : player.username;

            return {
              id: `kill-${player.inboxId}`,
              label: `🔪 ${displayName}`,
              style: "danger" as const,
            };
          })
        );

        const actionsContent: ActionsContent = {
          id: `kill-command-${Date.now()}`,
          description: `🔪 Select a target to kill:\n\nClick a button below to attempt a kill.`,
          actions: killActions,
          expiresAt: new Date(Date.now() + KILL_PHASE_DURATION_MS).toISOString(),
        };

        // Send using underlying client
        try {
          const client = (agent as any).client;
          if (client && client.conversations) {
            const conv = await client.conversations.getConversationById(ctx.conversation.id);
            if (conv) {
              await conv.send(actionsContent, ContentTypeActions);
              return;
            }
          }
        } catch (error) {
          console.error("Error sending kill buttons, falling back to text:", error);
        }

        // Fallback to text message if buttons fail
        const targetList = killablePlayers.map((p) => p.username).join(", ");
        await ctx.sendText(
          `🔪 Available targets: ${targetList}\n\n` +
          `Use: kill <username> or kill <address> or kill`
        );
        return;
      }

      const target = parsed.args.join(" ");
      // Try to find player by address first, then by username
      const result = await gameManager.attemptKill(
        ctx.message.senderInboxId,
        target
      );

      await ctx.sendText(result.message);

      // If kill was successful, announce to group
      if (result.success) {
        const lobbyId = gameManager.getGame().lobbyGroupId;
        if (lobbyId) {
          const group =
            await agent.client.conversations.getConversationById(lobbyId);
          if (group) {
            await group.send(result.message);

            // Check win condition
            const winCheck = gameManager.checkWinCondition();
            if (winCheck.gameEnded) {
              const { endGame } = await import("../game/gameFlow.js");
              await endGame(winCheck.winner, agent, gameManager);
              return;
            }

            // Clear the combined phase timer since we're advancing early
            const { clearPhaseTimer } = await import("../utils/timers.js");
            const currentRound = gameManager.getGame().round;
            clearPhaseTimer(`taskAndKillPhase-${currentRound}`, gameManager);

            // Advance to discussion phase after a short delay
            setTimeout(async () => {
              await gameManager.advancePhase();
              const { startDiscussionPhase } = await import("../game/gameFlow.js");
              await startDiscussionPhase(
                gameManager.getGame().round,
                agent,
                gameManager
              );
            }, 2000);
          }
        }
      }
    } catch (error: any) {
      await ctx.sendText(`Error: ${error.message}`);
    }
  };
}

// Handle vote command
export function setupVoteHandler(gameManager: GameManager) {
  return async (ctx: any) => {
    const parsed = ctx.parsedCommand;
    if (!parsed || parsed.command !== "vote") {
      return;
    }

    try {
      if (!parsed.args || parsed.args.length === 0) {
        await ctx.sendText("Usage: @mafia vote <username>");
        return;
      }

      const targetUsername = parsed.args.join(" ");
      const voted = await gameManager.castVote(
        ctx.message.senderInboxId,
        targetUsername
      );

      if (!voted) {
        await ctx.sendText("Cannot vote at this time or already voted.");
        return;
      }

      await ctx.sendText(`✅ Voted for ${targetUsername}`);
    } catch (error: any) {
      await ctx.sendText(`Error: ${error.message}`);
    }
  };
}

