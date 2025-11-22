// Helper to extract username from inboxId or message
export async function getUsername(ctx: any): Promise<string> {
  try {
    // Try to get Ethereum address from sender
    const members = await ctx.conversation.members();
    const senderMember = members.find(
      (m: any) =>
        m.inboxId.toLowerCase() === ctx.message.senderInboxId.toLowerCase()
    );

    if (senderMember?.accountIdentifiers?.[0]?.identifier) {
      const addr = senderMember.accountIdentifiers[0].identifier;
      // Use first 6 chars of address as username
      return addr.slice(0, 8);
    }
  } catch (error) {
    console.error("Error getting username:", error);
  }

  // Fallback to first 8 chars of inboxId
  return ctx.message.senderInboxId.slice(0, 8);
}

// Helper to check if message mentions the agent
export function isMentioned(content: string, agentAddress: string): boolean {
  // Check for @mafia mention or commands starting with /
  const mentionPattern = new RegExp(`@mafia|@\\w+|@0x[a-fA-F0-9]{40}`, "i");
  const hasMention = mentionPattern.test(content);
  const hasCommand = content.trim().startsWith("/");

  // For DMs, always allow (no mention needed)
  // For groups, require mention or command
  return hasMention || hasCommand;
}

// Helper to parse command from message
export function parseCommand(
  content: string
): { command: string; args: string[] } | null {
  const trimmed = content.trim();

  // Remove @mentions
  const withoutMentions = trimmed
    .replace(/@\w+/g, "")
    .replace(/@0x[a-fA-F0-9]{40}/g, "")
    .trim();

  // Match commands like "/start", "/join", "/task 1234", "vote alice", "kill bob"
  const commandMatch = withoutMentions.match(/^\/(\w+)(?:\s+(.+))?$/);
  if (commandMatch) {
    return {
      command: commandMatch[1].toLowerCase(),
      args: commandMatch[2] ? commandMatch[2].split(/\s+/) : [],
    };
  }

  // Match non-slash commands like "vote alice", "kill bob"
  const wordMatch = withoutMentions.match(/^(\w+)(?:\s+(.+))?$/);
  if (wordMatch) {
    const cmd = wordMatch[1].toLowerCase();
    if (cmd === "vote" || cmd === "kill") {
      return {
        command: cmd,
        args: wordMatch[2] ? wordMatch[2].split(/\s+/) : [],
      };
    }
  }

  return null;
}

// Helper to check if agent is a member of the group
export async function isAgentInGroup(
  conversation: any,
  agentInboxId: string
): Promise<boolean> {
  try {
    if (!conversation || !("members" in conversation)) {
      return false; // Not a group or can't check members
    }

    const members = await conversation.members();
    return members.some(
      (m: any) => m.inboxId.toLowerCase() === agentInboxId.toLowerCase()
    );
  } catch (error) {
    console.error("Error checking if agent is in group:", error);
    return false;
  }
}

// Helper to check if command should be rejected in DMs
export async function rejectCommandInDM(ctx: any): Promise<boolean> {
  const isDM = ctx.conversation && !("addMembers" in ctx.conversation);
  if (isDM) {
    await ctx.sendText(
      "❌ Commands should be used in a group, not in private messages (DMs).\n\n" +
        "Please create or join a group and use the command there!"
    );
    return true; // Command was rejected
  }
  return false; // Command is allowed
}

