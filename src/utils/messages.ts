import type { Agent } from "@xmtp/agent-sdk";
import {
  ContentTypeActions,
  type ActionsContent,
} from "../xmtp-inline-actions/types/index.js";
import { JOIN_WINDOW_DURATION_MS } from "../config/gameConfig.js";

// Helper to send message with join button in original group using inline actions
// IMPORTANT: This function ONLY sends to the original/main group, NOT the lobby group
export async function sendJoinMessageToOriginalGroup(
  agent: Agent,
  originalGroup: any,
  lobbyGroup: any,
  message: string
) {
  try {
    const originalGroupId = originalGroup?.id;
    const lobbyId = lobbyGroup?.id;

    if (!originalGroupId) {
      console.error("Cannot send join message: no original group ID");
      return;
    }

    if (!lobbyId) {
      // Fallback to regular message if no lobby ID
      console.log(`Sending text message to original group: ${originalGroupId}`);
      await originalGroup.send(message);
      return;
    }

    // Create inline actions with join button
    const actionsContent: ActionsContent = {
      id: `join-lobby-${Date.now()}`,
      description: message,
      actions: [
        {
          id: "join-game",
          label: "🚀 Join Game",
          style: "primary",
        },
      ],
      // Set expiration to join window duration
      expiresAt: new Date(Date.now() + JOIN_WINDOW_DURATION_MS).toISOString(),
    };

    // Try to send as inline actions to the ORIGINAL group only
    try {
      // Use the underlying client's send method with content type
      // Agent SDK wraps the node-sdk client, so we access it directly
      const client = (agent as any).client;
      if (client && client.conversations) {
        // IMPORTANT: Get the ORIGINAL group conversation, not the lobby group
        const conv = await client.conversations.getConversationById(originalGroupId);
        if (conv) {
          console.log(
            `Sending join button to original group: ${originalGroupId} (NOT lobby: ${lobbyId})`
          );
          // Use node-sdk's send method which supports content types
          await conv.send(actionsContent, ContentTypeActions);
        } else {
          throw new Error(
            `Could not get original group conversation: ${originalGroupId}`
          );
        }
      } else {
        throw new Error("Could not access client");
      }
    } catch (error) {
      console.error("Error sending inline actions, falling back to text:", error);
      // Fallback to text message with instructions - still to original group
      console.log(`Sending fallback text to original group: ${originalGroupId}`);
      await originalGroup.send(
        `${message}\n\nClick the "Join Game" button above to join!`
      );
    }
  } catch (error) {
    console.error("Error sending join message to original group:", error);
    // Final fallback to regular message - still to original group
    try {
      await originalGroup.send(message);
    } catch (fallbackError) {
      console.error("Failed to send fallback message:", fallbackError);
    }
  }
}

