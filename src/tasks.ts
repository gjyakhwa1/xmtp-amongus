import { Task } from "./types.js";

const WORDS = [
  "equilibrium",
  "xenolith",
  "protocol",
  "algorithm",
  "synthesis",
  "quantum",
  "momentum",
  "velocity",
  "architecture",
  "compilation",
];

const SCRAMBLED_WORDS = [
  { scrambled: "ILPA", answer: "PAL" },
  { scrambled: "GHTI", answer: "THIG" },
  { scrambled: "UJMP", answer: "JUMP" },
  { scrambled: "EKBI", answer: "BIKE" },
  { scrambled: "AEPS", answer: "SPEA" },
];

export function generateTask(): Task {
  const taskTypes: Array<"PIN" | "WORD" | "MATH" | "UNSCRAMBLE" | "COUNT"> = [
    "PIN",
    "WORD",
    "MATH",
    "UNSCRAMBLE",
    "COUNT",
  ];
  const type = taskTypes[Math.floor(Math.random() * taskTypes.length)];

  switch (type) {
    case "PIN": {
      const pin = Math.floor(1000 + Math.random() * 9000).toString();
      return {
        id: `pin-${Date.now()}-${Math.random()}`,
        type: "PIN",
        question: `Enter PIN: ${pin}`,
        answer: pin,
        completed: false,
      };
    }

    case "WORD": {
      const word = WORDS[Math.floor(Math.random() * WORDS.length)];
      return {
        id: `word-${Date.now()}-${Math.random()}`,
        type: "WORD",
        question: `Type this word: ${word}`,
        answer: word.toLowerCase(),
        completed: false,
      };
    }

    case "MATH": {
      const a = Math.floor(Math.random() * 100) + 10;
      const b = Math.floor(Math.random() * 50) + 1;
      const operation = Math.random() > 0.5 ? "+" : "-";
      const answer =
        operation === "+" ? (a + b).toString() : (a - b).toString();
      return {
        id: `math-${Date.now()}-${Math.random()}`,
        type: "MATH",
        question: `Solve: ${a} ${operation} ${b}`,
        answer: answer,
        completed: false,
      };
    }

    case "UNSCRAMBLE": {
      const scrambled = SCRAMBLED_WORDS[
        Math.floor(Math.random() * SCRAMBLED_WORDS.length)
      ];
      return {
        id: `unscramble-${Date.now()}-${Math.random()}`,
        type: "UNSCRAMBLE",
        question: `Unscramble: ${scrambled.scrambled} → ?`,
        answer: scrambled.answer.toLowerCase(),
        completed: false,
      };
    }

    case "COUNT": {
      const text = "protocol";
      const answer = text.length.toString();
      return {
        id: `count-${Date.now()}-${Math.random()}`,
        type: "COUNT",
        question: `Count letters: How many letters in "${text}"?`,
        answer: answer,
        completed: false,
      };
    }

    default:
      // Fallback to PIN
      const fallbackPin = "1234";
      return {
        id: `fallback-${Date.now()}`,
        type: "PIN",
        question: `Enter PIN: ${fallbackPin}`,
        answer: fallbackPin,
        completed: false,
      };
  }
}

export function validateTaskAnswer(task: Task, answer: string): boolean {
  const normalizedAnswer = answer.trim().toLowerCase();
  const normalizedExpected = task.answer.toLowerCase();
  return normalizedAnswer === normalizedExpected;
}

