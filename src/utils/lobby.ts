import type { GameManager } from "../gameManager.js";

// Helper to check if command is being used in the lobby group
export function isCommandInLobbyGroup(ctx: any, gameManager: GameManager): boolean {
  const currentGroupId = ctx.conversation?.id;
  const lobbyGroupId = gameManager.getGame().lobbyGroupId;
  return currentGroupId === lobbyGroupId;
}

// Helper to send error if command not in lobby group
export async function requireLobbyGroup(
  ctx: any,
  commandName: string,
  gameManager: GameManager
): Promise<boolean> {
  if (!isCommandInLobbyGroup(ctx, gameManager)) {
    await ctx.sendText(
      `❌ The \`/${commandName}\` command can only be used in the game lobby group.\n\n` +
        `Please join the game lobby first using the join button from the original group.`
    );
    return false; // Command rejected
  }
  return true; // Command allowed
}

