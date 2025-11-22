import type { Agent } from "@xmtp/agent-sdk";
import type { IntentContent } from "../xmtp-inline-actions/types/index.js";
import { GameState } from "../types.js";
import type { GameManager } from "../gameManager.js";
import { getUsername } from "../utils/helpers.js";
import { sendJoinMessageToOriginalGroup } from "../utils/messages.js";
import { clearPhaseTimer, clearAllTimers } from "../utils/timers.js";
import { startGame } from "../game/gameFlow.js";
import { MAX_PLAYERS } from "../config/gameConfig.js";

// Handle intent messages (inline action button clicks)
// This handles button clicks from BOTH original group and lobby group
export async function handleIntentMessage(
  ctx: any,
  intentContent: IntentContent,
  agent: Agent,
  gameManager: GameManager
) {
  try {
    const actionId = intentContent.actionId;
    const senderInboxId = ctx.message.senderInboxId;
    const currentConversationId = ctx.conversation?.id;

    console.log(
      `🎯 Processing intent: ${actionId} from ${senderInboxId} in conversation ${currentConversationId}`
    );

    if (actionId === "join-game") {
      // Handle join game button click
      // This can be clicked from the original group (where the button is shown)
      const username = await getUsername(ctx);
      const result = await gameManager.addPlayer(senderInboxId, username);

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

            // Add player to lobby group if not already added
            if ("addMembers" in lobbyGroup) {
              try {
                await (lobbyGroup as any).addMembers([senderInboxId]);
              } catch (error) {
                // Member might already be added, ignore
              }
            }

            const players = Array.from(gameManager.getGame().players.values());
            const playerList = players.map((p) => p.username).join(", ");

            // IMPORTANT: Send updated lobby status with join button to ORIGINAL group only
            // This ensures the join button always appears in the main group, not the lobby group
            await sendJoinMessageToOriginalGroup(
              agent,
              originalGroup,
              lobbyGroup,
              `🚀 MAFIA LOBBY\n\nPlayers joined: ${playerList} (${players.length}/${MAX_PLAYERS})`
            );

            // Send confirmation to player in the conversation where they clicked the button
            // If they clicked from original group, they'll see it there
            // If they clicked from lobby group (shouldn't happen, but handle it), they'll see it there
            await ctx.sendText(
              `✅ You joined the game! Players: ${playerList} (${players.length}/${MAX_PLAYERS})`
            );

            // If lobby is full, start immediately
            if (players.length >= MAX_PLAYERS) {
              clearPhaseTimer("joinWindow", gameManager);
              await startGame(agent, gameManager);
            }
          }
        }
      }
    } else if (actionId === "cancel-game") {
      // Handle cancel game button click
      const state = gameManager.getState();
      if (
        state === GameState.WAITING_FOR_PLAYERS ||
        state === GameState.LOBBY_CREATED
      ) {
        // Only allow cancellation if game hasn't started
        const lobbyId = gameManager.getGame().lobbyGroupId;
        if (lobbyId) {
          const lobbyGroup =
            await agent.client.conversations.getConversationById(lobbyId);
          if (lobbyGroup) {
            await lobbyGroup.send("❌ Game cancelled by player.");
            clearAllTimers(gameManager);
            await gameManager.cleanup();
          }
        }
        await ctx.sendText("✅ Game cancelled.");
      } else {
        await ctx.sendText("❌ Cannot cancel game. Game has already started.");
      }
    } else {
      await ctx.sendText(`❌ Unknown action: ${actionId}`);
    }
  } catch (error: any) {
    console.error("Error handling intent message:", error);
    await ctx.sendText(`❌ Error processing action: ${error.message}`);
  }
}

