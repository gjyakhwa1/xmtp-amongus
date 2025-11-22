import { Agent, AgentMiddleware, filter } from "@xmtp/agent-sdk";
import { GameManager } from "./gameManager.js";
import { GameState } from "./types.js";
import fs from "fs";

process.loadEnvFile(".env");

// Create agent using environment variables (Agent SDK best practice)

const getDbPath = (description = "xmtp"): string => {
  let volumePath = ".data/xmtp";

  if (!fs.existsSync(volumePath)) fs.mkdirSync(volumePath, { recursive: true });

  return `${volumePath}/${description}.db3`;
};

const agent = await Agent.createFromEnv({
  env: (process.env.XMTP_ENV as "local" | "dev" | "production") || "dev",
  dbPath: getDbPath(),
});

// Game manager instance
const gameManager = new GameManager(agent);

// Helper to extract username from inboxId or message
async function getUsername(ctx: any): Promise<string> {
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

// Helper to send message with join button in original group
async function sendJoinMessageToOriginalGroup(
  originalGroup: any,
  lobbyGroup: any,
  message: string
) {
  try {
    // Get share link from the lobby group for the join button
    let joinLink = "";
    try {
      if (lobbyGroup && typeof lobbyGroup.share === "function") {
        joinLink = await lobbyGroup.share();
      } else if (lobbyGroup?.id) {
        joinLink = `xmtp://conversation/${lobbyGroup.id}`;
      }
    } catch (error) {
      console.error("Error getting lobby share link:", error);
    }

    // Send message with join button to original group
    let messageText = message;
    
    if (joinLink) {
      // Send with clickable join link (XMTP clients will render as button)
      messageText += `\n\n🔘 [Join Game](${joinLink})\n\nClick the button above to join the game lobby!`;
    } else {
      messageText += `\n\n🔘 Use the join link to join the game lobby!`;
    }
    
    await originalGroup.send(messageText);
  } catch (error) {
    console.error("Error sending join message to original group:", error);
    // Fallback to regular message
    await originalGroup.send(message);
  }
}

// Helper to check if message mentions the agent
function isMentioned(content: string, agentAddress: string): boolean {
  // Check for @AgentName pattern or commands starting with /
  const mentionPattern = new RegExp(`@\\w+|@0x[a-fA-F0-9]{40}`, "i");
  const hasMention = mentionPattern.test(content);
  const hasCommand = content.trim().startsWith("/");

  // For DMs, always allow (no mention needed)
  // For groups, require mention or command
  return hasMention || hasCommand;
}

// Helper to parse command from message
function parseCommand(
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

// Timer management
const timers = new Map<string, NodeJS.Timeout>();

function setPhaseTimer(
  phaseName: string,
  duration: number,
  callback: () => void
) {
  // Clear existing timer for this phase
  const existing = timers.get(phaseName);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    callback();
    timers.delete(phaseName);
  }, duration);

  timers.set(phaseName, timer);
}

function clearPhaseTimer(phaseName: string) {
  const timer = timers.get(phaseName);
  if (timer) {
    clearTimeout(timer);
    timers.delete(phaseName);
  }
}

// Helper to check if agent is a member of the group
async function isAgentInGroup(conversation: any, agentInboxId: string): Promise<boolean> {
  try {
    if (!conversation || !("members" in conversation)) {
      return false; // Not a group or can't check members
    }
    
    const members = await conversation.members();
    return members.some((m: any) => m.inboxId.toLowerCase() === agentInboxId.toLowerCase());
  } catch (error) {
    console.error("Error checking if agent is in group:", error);
    return false;
  }
}

// Helper to check if command should be rejected in DMs
async function rejectCommandInDM(ctx: any): Promise<boolean> {
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

// Helper to check if command is being used in the lobby group
function isCommandInLobbyGroup(ctx: any): boolean {
  const currentGroupId = ctx.conversation?.id;
  const lobbyGroupId = gameManager.getGame().lobbyGroupId;
  return currentGroupId === lobbyGroupId;
}

// Helper to send error if command not in lobby group
async function requireLobbyGroup(ctx: any, commandName: string): Promise<boolean> {
  if (!isCommandInLobbyGroup(ctx)) {
    await ctx.sendText(
      `❌ The \`/${commandName}\` command can only be used in the game lobby group.\n\n` +
      `Please join the game lobby first using the join button from the original group.`
    );
    return false; // Command rejected
  }
  return true; // Command allowed
}

// Middleware to handle mentions and route commands
const commandMiddleware: AgentMiddleware = async (ctx, next) => {
  // Log all incoming messages
  console.log("=".repeat(60));
  console.log("📨 Message received:");
  console.log(`   Sender: ${ctx.message.senderInboxId}`);
  console.log(`   Content: ${ctx.message.content}`);
  console.log(`   Conversation ID: ${ctx.conversation?.id || "N/A"}`);
  console.log(`   Is Text: ${filter.isText(ctx.message)}`);
  console.log(`   From Self: ${filter.fromSelf(ctx.message, ctx.client)}`);

  if (!filter.isText(ctx.message) || filter.fromSelf(ctx.message, ctx.client)) {
    console.log("   ⏭️  Skipped: Not a text message or from self");
    console.log("=".repeat(60));
    return;
  }

  const content = ctx.message.content;
  const agentAddress = agent.address?.toLowerCase() || "";
  const agentInboxId = agent.client.inboxId;

  // Check if this is a DM (always process DMs)
  const isDM = ctx.conversation && !("addMembers" in ctx.conversation);
  console.log(`   Is DM: ${isDM}`);

  // For groups, verify agent is a member and require mention
  if (!isDM) {
    // Check if agent is in the group
    const agentInGroup = await isAgentInGroup(ctx.conversation, agentInboxId);
    console.log(`   Agent in group: ${agentInGroup}`);
    
    if (!agentInGroup) {
      console.log("   ⏭️  Skipped: Agent is not a member of this group");
      console.log("=".repeat(60));
      // Send error message to user
      try {
        await ctx.sendText("❌ I'm not a member of this group. Please add me to the group first.");
      } catch (error) {
        console.error("Error sending message:", error);
      }
      return;
    }

    // Require mention for group commands
    if (!isMentioned(content, agentAddress)) {
      console.log("   ⏭️  Skipped: No mention in group message");
      console.log("=".repeat(60));
      return;
    }
  }

  const parsed = parseCommand(content);
  if (!parsed) {
    console.log("   ℹ️  Simple message (not a command) - will be handled by intro handler");
    console.log("=".repeat(60));
    // Still call next() so simple message handlers can process it
    await next();
    return;
  }

  console.log(`   ✅ Command parsed: ${parsed.command} with args: [${parsed.args.join(", ")}]`);
  console.log("=".repeat(60));

  // Store parsed command in context for handlers
  (ctx as any).parsedCommand = parsed;
  await next();
};

agent.use(commandMiddleware);

// Handle simple messages (non-commands) with friendly intro
agent.on("text", async (ctx: any) => {
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
      `👋 Hey there! I'm the IMPOST0R Game Agent 🎮\n\n` +
      `🎯 What I do:\n` +
      `• Host text-based social deduction games (like Among Us!)\n` +
      `• Manage game lobbies and player interactions\n` +
      `• Coordinate tasks, voting, and eliminations\n\n` +
      `🚀 Get Started:\n` +
      `Type \`@AgentName /start\` to create a new game lobby!\n\n` +
      `🎲 Game Features:\n` +
      `• Up to 6 players per game\n` +
      `• Crewmates complete tasks\n` +
      `• Impostor tries to eliminate everyone\n` +
      `• Vote out suspects to win!\n\n` +
      `Ready to play? Let's go! 🎉`;

    await ctx.sendText(introMessage);
  } catch (error) {
    console.error("Error sending intro message:", error);
  }
});

// Handle /start command
agent.on("text", async (ctx: any) => {
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
    const addResult = await gameManager.addPlayer(ctx.message.senderInboxId, username);
    
    if (!addResult.success) {
      await ctx.sendText("❌ Error: Could not add you to the lobby. Please try again.");
      return;
    }

    // Get both groups
    const originalGroup = await agent.client.conversations.getConversationById(originalGroupId);
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
        originalGroup,
        lobbyGroup,
        "🚀 IMPOST0R Game Lobby Created!\n\nUp to 6 players may join within 2 minutes."
      );

      // Send confirmation to starter in original group
      await ctx.sendText("✅ Game lobby created! Check the group for the join button.");

      // Set timer to start game after join window
      setPhaseTimer("joinWindow", 2 * 60 * 1000, async () => {
        if (gameManager.getState() === GameState.WAITING_FOR_PLAYERS) {
          if (gameManager.canStartGame()) {
            await startGame();
          } else {
            await lobbyGroup.send("Not enough players joined. Game cancelled.");
            await gameManager.cleanup();
          }
        }
      });
    }
  } catch (error: any) {
    await ctx.sendText(`❌ Error creating lobby: ${error.message}`);
  }
});

// Handle /join command (only works in lobby group)
agent.on("text", async (ctx: any) => {
  const parsed = ctx.parsedCommand;
  if (!parsed || parsed.command !== "join") {
    return;
  }

  // Reject command if sent in DM
  if (await rejectCommandInDM(ctx)) {
    return;
  }

  // Only allow /join in the lobby group
  if (!await requireLobbyGroup(ctx, "join")) {
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
        const lobbyGroup = await agent.client.conversations.getConversationById(lobbyId);
        const originalGroup = await agent.client.conversations.getConversationById(originalGroupId);
        
        if (lobbyGroup && originalGroup) {
          // Notify removed player if one was removed
          if (result.removedPlayer) {
            try {
              const dm = await agent.client.conversations.newDm(result.removedPlayer.inboxId);
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
            originalGroup,
            lobbyGroup,
            `🚀 IMPOST0R LOBBY\n\nPlayers joined: ${playerList} (${players.length}/6)`
          );

          // Send confirmation to player in lobby group
          await ctx.sendText(`✅ You joined the game! Players: ${playerList} (${players.length}/6)`);

          // If lobby is full, start immediately
          if (players.length >= 6) {
            clearPhaseTimer("joinWindow");
            await startGame();
          }
        }
      }
    }
  } catch (error: any) {
    await ctx.sendText(`❌ Error joining: ${error.message}`);
  }
});

// // Handle /task command
// agent.on("text", async (ctx: any) => {
//   const parsed = ctx.parsedCommand;
//   if (!parsed || parsed.command !== "task") {
//     return;
//   }

//   try {
//     if (!parsed.args || parsed.args.length === 0) {
//       await ctx.sendText("Usage: @AgentName /task <value>");
//       return;
//     }

//     const answer = parsed.args.join(" ");
//     const player = gameManager.getPlayer(ctx.message.senderInboxId);

//     if (!player || !player.isAlive) {
//       await ctx.sendText(
//         "You are not part of an active game or have been eliminated."
//       );
//       return;
//     }

//     // Impostors can fake tasks but they don't actually complete
//     if (player.role === "IMPOSTOR") {
//       await ctx.sendText("✅ Task completed! (faked)");
//       return;
//     }

//     // Crew members must complete real tasks
//     const completed = await gameManager.completeTask(
//       ctx.message.senderInboxId,
//       answer
//     );

//     if (completed) {
//       await ctx.sendText("✅ Task completed!");
//     } else {
//       await ctx.sendText("❌ Task answer incorrect. Try again.");
//     }
//   } catch (error: any) {
//     await ctx.sendText(`Error: ${error.message}`);
//   }
// });

// // Handle kill command (DM only)
// agent.on("text", async (ctx: any) => {
//   const parsed = ctx.parsedCommand;
//   if (!parsed || parsed.command !== "kill") {
//     return;
//   }

//   // Only allow kills in DMs
//   const isDM = ctx.conversation && !("addMembers" in ctx.conversation);
//   if (!isDM) {
//     await ctx.sendText(
//       "Kill commands can only be used in private messages (DMs)."
//     );
//     return;
//   }

//   try {
//     if (!parsed.args || parsed.args.length === 0) {
//       await ctx.sendText("Usage: @AgentName kill <username>");
//       return;
//     }

//     const targetUsername = parsed.args.join(" ");
//     const result = await gameManager.attemptKill(
//       ctx.message.senderInboxId,
//       targetUsername
//     );

//     await ctx.sendText(result.message);

//     // If kill was successful, announce to group
//     if (result.success) {
//       const lobbyId = gameManager.getGame().lobbyGroupId;
//       if (lobbyId) {
//         const group =
//           await agent.client.conversations.getConversationById(lobbyId);
//         if (group) {
//           await group.send(result.message);

//           // Check win condition
//           const winCheck = gameManager.checkWinCondition();
//           if (winCheck.gameEnded) {
//             await endGame(winCheck.winner);
//             return;
//           }

//           // Advance to discussion phase after a short delay
//           setTimeout(async () => {
//             await gameManager.advancePhase();
//             await startDiscussionPhase(gameManager.getGame().round);
//           }, 2000);
//         }
//       }
//     }
//   } catch (error: any) {
//     await ctx.sendText(`Error: ${error.message}`);
//   }
// });

// // Handle vote command
// agent.on("text", async (ctx: any) => {
//   const parsed = ctx.parsedCommand;
//   if (!parsed || parsed.command !== "vote") {
//     return;
//   }

//   try {
//     if (!parsed.args || parsed.args.length === 0) {
//       await ctx.sendText("Usage: @AgentName vote <username>");
//       return;
//     }

//     const targetUsername = parsed.args.join(" ");
//     const voted = await gameManager.castVote(
//       ctx.message.senderInboxId,
//       targetUsername
//     );

//     if (!voted) {
//       await ctx.sendText("Cannot vote at this time or already voted.");
//       return;
//     }

//     await ctx.sendText(`✅ Voted for ${targetUsername}`);
//   } catch (error: any) {
//     await ctx.sendText(`Error: ${error.message}`);
//   }
// });

// Game flow functions
async function startGame() {
  try {
    await gameManager.assignRoles();
    const lobbyId = gameManager.getGame().lobbyGroupId;

    if (lobbyId) {
      const group =
        await agent.client.conversations.getConversationById(lobbyId);
      if (group) {
        await group.send("Roles assigned.\n\nRound 1 is starting.");

        // Start round 1
        await gameManager.startRound(1);
        await startTaskPhase(1);
      }
    }
  } catch (error) {
    console.error("Error starting game:", error);
  }
}

async function startTaskPhase(round: number) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  await group.send(
    `🛠️ Round ${round} — Task Phase\n\nComplete your assigned task using: @AgentName /task <value>`
  );

  // Send individual tasks to crew players via DM
  for (const player of gameManager.getAlivePlayers()) {
    if (player.role === "CREW") {
      const task = gameManager.getTaskForPlayer(player.inboxId);
      if (task) {
        try {
          const dm = await agent.client.conversations.newDm(player.inboxId);
          await dm.send(
            `🛠️ Task for you:\n\n${task.question}\n\nReply: @AgentName /task <answer>`
          );
        } catch (error) {
          console.error(`Failed to send task to ${player.username}:`, error);
        }
      }
    } else if (player.role === "IMPOSTOR") {
      // Impostor can fake tasks, but doesn't get a real task
      try {
        const dm = await agent.client.conversations.newDm(player.inboxId);
        await dm.send(
          `🛠️ Round ${round} — Task Phase\n\nAs impostor, you can fake completing tasks, but they won't count.\nWait for the kill phase.`
        );
      } catch (error) {
        console.error(`Failed to send impostor message:`, error);
      }
    }
  }

  // After task phase duration, move to kill phase
  setPhaseTimer(`taskPhase-${round}`, 60 * 1000, async () => {
    await gameManager.advancePhase();
    await startKillPhase(round);
  });
}

async function startKillPhase(round: number) {
  const impostorInboxId = gameManager.getGame().impostorInboxId;
  if (!impostorInboxId) return;

  const impostor = gameManager.getPlayer(impostorInboxId);
  if (!impostor || !impostor.isAlive) return;

  try {
    const dm = await agent.client.conversations.newDm(impostorInboxId);
    const aliveUsernames = gameManager
      .getAlivePlayerUsernames()
      .filter((u) => u !== impostor.username);

    await dm.send(
      `Round ${round} Kill Phase.\n\n` +
        `Try killing a player using:\n` +
        `@AgentName kill <username>\n\n` +
        `Success chance: 50%\n` +
        `Max attempts: 3\n` +
        `Cooldown: 15 seconds per attempt\n\n` +
        `Alive players: ${aliveUsernames.join(", ")}`
    );
  } catch (error) {
    console.error("Failed to send kill phase DM:", error);
  }
}

async function startDiscussionPhase(round: number) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  await group.send(`💬 Discussion Phase — 45 seconds.\n\nTalk freely.`);

  setPhaseTimer(`discussion-${round}`, 45 * 1000, async () => {
    await gameManager.advancePhase();
    await startVotingPhase(round);
  });
}

async function startVotingPhase(round: number) {
  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  const aliveUsernames = gameManager.getAlivePlayerUsernames();

  await group.send(
    `🗳️ Voting Phase\n\n` +
      `Use: @AgentName vote <username>\n\n` +
      `Alive players: ${aliveUsernames.join(", ")}`
  );

  // Reset votes
  for (const player of gameManager.getAlivePlayers()) {
    player.voted = false;
    player.voteTarget = null;
  }

  // Wait for votes, then process after timer
  setPhaseTimer(`voting-${round}`, 60 * 1000, async () => {
    await processVoting(round);
  });
}

async function processVoting(round: number) {
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
        const roleText =
          eliminated.role === "IMPOSTOR" ? "IMPOSTOR" : "CREWMATE";

        await group.send(
          `${roleEmoji} @${eliminated.username} was eliminated.\n\n` +
            `They were a ${roleText}.`
        );

        // Check win condition
        const winCheck = gameManager.checkWinCondition();
        if (winCheck.gameEnded) {
          await endGame(winCheck.winner);
          return;
        }
      }
    } else {
      await group.send("Tie or no majority. No one eliminated.");
    }
  }

  // Advance to next round or end game
  if (round < 3) {
    await gameManager.advancePhase();
    const nextRound = round + 1;
    await gameManager.startRound(nextRound);
    await startTaskPhase(nextRound);
  } else {
    // Game end - impostor wins if still alive
    const winCheck = gameManager.checkWinCondition();
    await endGame(winCheck.winner || "IMPOSTOR");
  }
}

async function endGame(winner: "CREW" | "IMPOSTOR" | null) {
  if (!winner) return;

  const lobbyId = gameManager.getGame().lobbyGroupId;
  if (!lobbyId) return;

  const group = await agent.client.conversations.getConversationById(lobbyId);
  if (!group) return;

  if (winner === "CREW") {
    await group.send("🏆 CREW WINS! Impostor was eliminated.");
  } else {
    await group.send("🔥 IMPOSTOR WINS! Survived all 3 rounds.");
  }

  await gameManager.cleanup();
}

// Start agent
agent.on("start", () => {
  console.log(`IMPOST0R Agent is running...`);
  console.log(`Address: ${agent.address}`);
  console.log(`Conversation Id: ${agent.client.inboxId}`);
  // console.log(`🔗${getTestUrl(agent)}`);
  console.log(`Send @AgentName /start to begin!`);
});

await agent.start();
