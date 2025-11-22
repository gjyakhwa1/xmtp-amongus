# Mafia Game - XMTP Agent

A text-based social deduction game (Mafia) built as an XMTP agent that runs entirely within XMTP chat groups. Players can create lobbies, join games, complete tasks, eliminate players, and vote to find the mafia - all through XMTP messaging.

## 🎮 Project Overview

This is a fully functional Mafia game bot that operates as an XMTP agent. The game combines elements of social deduction, task completion, and strategic voting. Players interact with the agent using commands and inline action buttons in XMTP group chats.

### Key Features

- **Multi-player Support**: Up to 6 players per game (configurable)
- **Role-based Gameplay**: Random assignment of Mafia and Town roles
- **Interactive Inline Actions**: Join buttons using XMTP inline actions (XIP-67)
- **Phased Gameplay**: Task phase, Kill phase, Discussion phase, and Voting phase
- **Private Messaging**: Mafia receives kill instructions via DMs
- **Configurable Parameters**: All game settings in one config file
- **Timer Management**: Automatic phase transitions with configurable durations

## 🏗️ Architecture

The project is structured into modular components:

```
src/
├── agent/
│   └── setup.ts              # Agent initialization and codec registration
├── config/
│   └── gameConfig.ts         # All game configuration constants
├── game/
│   └── gameFlow.ts           # Game flow functions (phases, rounds)
├── handlers/
│   ├── commandHandlers.ts   # Command handlers (/start, /join, /task, /kill, /vote)
│   ├── intentHandler.ts      # Intent message handler (button clicks)
│   └── messageHandlers.ts    # Intro message handler
├── middleware/
│   └── commandMiddleware.ts # Command parsing and routing
├── utils/
│   ├── helpers.ts            # Utility functions
│   ├── lobby.ts              # Lobby-related helpers
│   ├── messages.ts           # Message sending utilities
│   └── timers.ts             # Timer management
├── gameManager.ts            # Game state management
├── types.ts                  # Type definitions
├── tasks.ts                  # Task generation logic
└── index.ts                  # Main entry point
```

## 🎯 Game Flow

### 1. Lobby Creation
- Player uses `@mafia /start` in a group chat
- Agent creates a lobby group and sends a join button to the original group
- Players can join via the inline action button or `/join` command
- Join window: 1 minute (configurable)
- Minimum players: 3 (configurable)
- Maximum players: 6 (configurable)

### 2. Role Assignment
- Once enough players join or the timer expires, roles are randomly assigned
- One player becomes **Mafia**, others become **Town Members**
- Roles are sent via private DMs
- Game starts with Round 1

### 3. Game Rounds
Each round consists of 4 phases:

#### Phase 1: Task Phase (60 seconds)
- Town members receive tasks via DM
- Tasks include: PIN codes, word puzzles, math problems, unscrambling, counting
- Players complete tasks using `@mafia /task <answer>`
- Mafia can fake tasks but they don't count

#### Phase 2: Kill Phase
- Mafia receives kill instructions via DM
- Mafia can attempt kills using `@mafia kill <username>` (DM only)
- Kill success chance: 50% (configurable)
- Cooldown: 15 seconds between attempts (configurable)
- Max attempts: 3 per round (configurable)
- Successful kills eliminate players immediately

#### Phase 3: Discussion Phase (45 seconds)
- All players can discuss freely in the lobby group
- Players share information and suspicions
- Timer automatically advances to voting

#### Phase 4: Voting Phase (60 seconds)
- Players vote to eliminate suspects using `@mafia vote <username>`
- Majority vote eliminates a player
- Eliminated player's role is revealed
- Game checks win conditions

### 4. Win Conditions
- **Town Wins**: Mafia is eliminated
- **Mafia Wins**: Mafia survives all rounds (currently 1 round, configurable)

## 🎮 Commands

All commands must mention the agent (`@mafia`) in group chats:

| Command | Usage | Description |
|---------|-------|-------------|
| `/start` | `@mafia /start` | Create a new game lobby (group only) |
| `/join` | `@mafia /join` | Join the game lobby (lobby group only) |
| `/task <answer>` | `@mafia /task 1234` | Complete your assigned task |
| `kill <username>` | `@mafia kill alice` | Attempt to kill a player (DM only, Mafia only) |
| `vote <username>` | `@mafia vote bob` | Vote to eliminate a player |

## ⚙️ Configuration

All game parameters are configurable in `src/config/gameConfig.ts`:

```typescript
// Player and Round Configuration
export const MAX_PLAYERS = 6;
export const MAX_ROUNDS = 1;
export const MIN_PLAYERS_TO_START = 3;

// Mafia Kill Configuration
export const KILL_COOLDOWN_MS = 15 * 1000; // 15 seconds
export const KILL_SUCCESS_CHANCE = 0.5; // 50%
export const MAX_KILL_ATTEMPTS = 3;

// Phase Duration Configuration
export const TASK_PHASE_DURATION_MS = 60 * 1000; // 60 seconds
export const DISCUSSION_PHASE_DURATION_MS = 45 * 1000; // 45 seconds
export const VOTING_PHASE_DURATION_MS = 60 * 1000; // 60 seconds

// Lobby Configuration
export const JOIN_WINDOW_DURATION_MS = 1 * 60 * 1000; // 1 minute
export const CANCEL_GAME_WINDOW_MS = 10 * 1000; // 10 seconds
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 20 < 24
- XMTP account and wallet
- Environment variables configured

### Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run in development mode
npm run dev

# Run in production mode
npm start
```

### Environment Variables

Create a `.env` file with:

```env
XMTP_ENV=dev  # or "local" or "production"
WALLET_KEY=your_private_key_here
DB_ENCRYPTION_KEY=your_encryption_key_here
```

### Running the Agent

1. Start the agent: `npm run dev`
2. Add the agent to an XMTP group chat
3. Use `@mafia /start` to create a game lobby
4. Players join using the join button or `/join` command
5. Game starts automatically when conditions are met

## 🛠️ Technical Details

### XMTP Features Used

- **Agent SDK**: For building the XMTP agent
- **Inline Actions (XIP-67)**: For interactive join buttons
- **Content Codecs**: ActionsCodec and IntentCodec for button interactions
- **Group Conversations**: For lobby management
- **Direct Messages**: For private role assignments and kill commands

### Code Structure

- **Modular Design**: Separated into logical modules for maintainability
- **Type Safety**: Full TypeScript implementation
- **Timer Management**: Centralized timer system with automatic cleanup
- **State Management**: GameManager handles all game state
- **Error Handling**: Comprehensive error handling throughout

## 📝 Development

### Project Structure

- **Agent Setup**: Handles XMTP agent creation and codec registration
- **Game Manager**: Core game logic and state management
- **Handlers**: Command and message handlers
- **Middleware**: Command parsing and routing
- **Utils**: Helper functions and utilities
- **Config**: Centralized configuration

### Adding New Features

1. **New Commands**: Add handler in `src/handlers/commandHandlers.ts`
2. **New Phases**: Extend `src/game/gameFlow.ts`
3. **Configuration**: Update `src/config/gameConfig.ts`
4. **New Tasks**: Extend `src/tasks.ts`

## 🎯 Game Mechanics

### Task System
- Multiple task types: PIN, WORD, MATH, UNSCRAMBLE, COUNT
- Tasks are validated server-side
- Mafia can fake tasks but they don't count toward completion

### Kill System
- Mafia can attempt kills during kill phase
- 50% success chance (configurable)
- 15-second cooldown between attempts
- Maximum 3 attempts per round
- Successful kills eliminate players immediately

### Voting System
- Majority vote required to eliminate
- Ties result in no elimination
- Eliminated player's role is revealed
- Win conditions checked after each elimination

## 📚 Dependencies

- `@xmtp/agent-sdk`: XMTP Agent SDK
- `@xmtp/content-type-primitives`: Content type primitives
- `@xmtp/content-type-remote-attachment`: Remote attachment support
- `@xmtp/content-type-transaction-reference`: Transaction references
- `@xmtp/content-type-wallet-send-calls`: Wallet send calls
- `better-sqlite3`: Local database for XMTP client

## 🤝 Contributing

This is a modular, well-structured codebase. When contributing:

1. Follow the existing module structure
2. Update configuration in `gameConfig.ts` for game parameters
3. Add proper error handling
4. Maintain type safety with TypeScript
5. Update this README for significant changes

## 📄 License

Private project

## 🎉 Enjoy Playing!

Start a game with `@mafia /start` and enjoy the social deduction experience!
