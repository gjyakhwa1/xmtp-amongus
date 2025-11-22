import { filter } from "@xmtp/agent-sdk";
import type { Agent } from "@xmtp/agent-sdk";
import { isMentioned, isAgentInGroup } from "../utils/helpers.js";
import { MAX_PLAYERS } from "../config/gameConfig.js";

// Handle simple messages (non-commands) with friendly intro
export function setupIntroHandler(agent: Agent) {
  return async (ctx: any) => {
    // Skip if it's a command (commands are handled separately)
    if ((ctx as any).parsedCommand) {
      return;
    }

    // Skip if not a text message or from self
    if (!filter.isText(ctx.message) || filter.fromSelf(ctx.message, ctx.client)) {
      return;
    }

    const content = ctx.message.content;
    const agentAddress = agent.address?.toLowerCase() || "";
    const agentInboxId = agent.client.inboxId;

    // Check if this is a DM (always respond to DMs)
    const isDM = ctx.conversation && !("addMembers" in ctx.conversation);

    // For groups, only respond if agent is mentioned
    if (!isDM) {
      const agentInGroup = await isAgentInGroup(ctx.conversation, agentInboxId);
      if (!agentInGroup || !isMentioned(content, agentAddress)) {
        return; // Not mentioned or agent not in group
      }
    }

    // Send friendly intro message
    try {
      const introMessage =
        `👋 Hey there! I'm the Mafia Game Agent 🎮\n\n` +
        `🎯 What I do:\n` +
        `• Host text-based social deduction games (like Mafia!)\n` +
        `• Manage game lobbies and player interactions\n` +
        `• Coordinate tasks, voting, and eliminations\n\n` +
        `🚀 Get Started:\n` +
        `Type \`@mafia /start\` to create a new game lobby!\n\n` +
        `🎲 Game Features:\n` +
        `• Up to ${MAX_PLAYERS} players per game\n` +
        `• Town members complete tasks\n` +
        `• Mafia tries to eliminate everyone\n` +
        `• Vote out suspects to win!\n\n` +
        `Ready to play? Let's go! 🎉`;

      await ctx.sendText(introMessage);
    } catch (error) {
      console.error("Error sending intro message:", error);
    }
  };
}

