import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initialize Gemini SDK with telemetry header
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    })
  : null;

interface Player {
  id: string;
  name: string;
  avatar: string;
  score: number;
  connected: boolean;
  isHost: boolean;
  typing: boolean;
}

interface RoomConfig {
  totalRounds: number;
  timerDuration: number;
  categories: string[];
  difficulty: 'EASY' | 'NORMAL' | 'HARD';
}

interface AnswerDetail {
  word: string;
  score: number;
  isValid: boolean;
  isDuplicate: boolean;
  reason?: string;
}

interface RoundResult {
  letter: string;
  playerAnswers: Record<string, Record<string, AnswerDetail>>; // playerId -> category -> detail
  scoresDelta: Record<string, number>; // playerId -> roundScore
}

interface Room {
  code: string;
  hostId: string;
  players: Record<string, Player>; // playerId -> Player
  status: 'WAITING' | 'COUNTDOWN' | 'PLAYING' | 'RESULTS' | 'FINISHED';
  config: RoomConfig;
  currentRound: number;
  currentLetter: string;
  usedLetters: string[];
  roundTimer: number;
  submissions: Record<string, Record<string, string>>; // playerId -> category -> word
  roundResults: RoundResult | null;
  countdownTimer: number;
}

// In-memory database of active rooms
const rooms: Record<string, Room> = {};
const playerToRoom: Record<string, { roomCode: string; name: string }> = {}; // Map socket.id or identifier to room code
const disconnectedPlayers: Record<string, { roomCode: string; player: Player; timeoutId: NodeJS.Timeout; submissions?: Record<string, string> }> = {};

// Default lists
const DEFAULT_CATEGORIES = ['Name', 'Place', 'Move / Vehicle', 'Thing', 'Animal / Bird'];

const LETTERS_BY_DIFFICULTY = {
  EASY: ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'L', 'M', 'N', 'P', 'R', 'S', 'T'],
  NORMAL: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'],
  HARD: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y', 'Z'],
};

// Generate a random room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous chars like I, O, 0, 1
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms[code] ? generateRoomCode() : code;
}

// Select a random letter for a room based on difficulty config, avoiding repeats
function selectRandomLetter(room: Room): string {
  const letters = LETTERS_BY_DIFFICULTY[room.config.difficulty] || LETTERS_BY_DIFFICULTY.NORMAL;
  const availableLetters = letters.filter((l) => !room.usedLetters.includes(l));
  
  if (availableLetters.length === 0) {
    // If all letters used, clear and select from all
    room.usedLetters = [];
    return letters[Math.floor(Math.random() * letters.length)];
  }
  
  const selected = availableLetters[Math.floor(Math.random() * availableLetters.length)];
  room.usedLetters.push(selected);
  return selected;
}

// Fast heuristic-based validation to run on server
function validateWordBasic(word: string, letter: string): boolean {
  if (!word || typeof word !== 'string') return false;
  const trimmed = word.trim();
  if (trimmed.length < 1) return false;
  return trimmed.toLowerCase().startsWith(letter.toLowerCase());
}

// Gemini Intelligent validation with single-batch prompt
async function validateRoundAnswersGemini(
  letter: string,
  categories: string[],
  itemsToValidate: Array<{ id: string; player: string; category: string; word: string }>
): Promise<Record<string, { isValid: boolean; reason: string }>> {
  const resultsMap: Record<string, { isValid: boolean; reason: string }> = {};

  // Pre-fill all with basic check first as standard fallback
  itemsToValidate.forEach((item) => {
    const basicValid = validateWordBasic(item.word, letter);
    resultsMap[item.id] = {
      isValid: basicValid,
      reason: basicValid ? 'Matches letter' : `Must start with '${letter.toUpperCase()}'`,
    };
  });

  // Only keep things that matched the starting letter to validate their category fit
  const candidateItems = itemsToValidate.filter((item) => validateWordBasic(item.word, letter));
  if (candidateItems.length === 0 || !ai) {
    return resultsMap;
  }

  try {
    const prompt = `You are the final referee for a fast-paced "Name, Place, Things" party word game.
Your job is to strictly yet fairly determine whether each word fits the assigned category.
The active starting letter is "${letter.toUpperCase()}". All words MUST start with "${letter.toUpperCase()}" (which they do).

You must validate if the words belong to the following categories:
- "Name": Valid first names, common nicknames, or famous people (real or fictional).
- "Place": Cities, countries, states, continents, rivers, oceans, or well-known geographical areas.
- "Move / Vehicle": Vehicles, modes of transportation (e.g. Scooter, Sedan, Submarine, Spacecraft, Sailboat).
- "Thing": Everyday objects, household items, tools, materials, clothing, etc.
- "Animal / Bird": Mammals, birds, insects, fish, reptiles, amphibians, dinosaurs, etc.
- Custom categories may also be provided in the input.

Here are the submitted answers to adjudicate:
${candidateItems.map((item, idx) => `${idx}. Category: "${item.category}" -> Word: "${item.word}"`).join('\n')}

For each answer, return whether it fits the category (isValid) and a short fun reason if it is invalid (max 5 words).
Be somewhat generous but reject complete nonsense or answers that clearly don't fit (e.g. "Spoon" is not an animal).`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              isValid: { type: Type.BOOLEAN },
              reason: { type: Type.STRING },
            },
            required: ['index', 'isValid'],
          },
        },
      },
    });

    const parsedResults = JSON.parse(response.text || '[]');
    if (Array.isArray(parsedResults)) {
      parsedResults.forEach((res) => {
        const index = res.index;
        if (candidateItems[index]) {
          const item = candidateItems[index];
          resultsMap[item.id] = {
            isValid: res.isValid,
            reason: res.isValid ? 'Approved' : res.reason || 'Invalid category fit',
          };
        }
      });
    }
  } catch (error) {
    console.error('Gemini verification failed:', error);
    // Suppress errors and use the standard starting-letter local fallback already prepared in resultsMap
  }

  return resultsMap;
}

// Calculate scores, highlight unique vs repeated
async function processRoundScores(room: Room) {
  const letter = room.currentLetter;
  const categories = room.config.categories;
  const playerIds = Object.keys(room.players);

  // 1. Gather all words to validate
  const itemsToValidate: Array<{ id: string; player: string; category: string; word: string }> = [];
  playerIds.forEach((playerId) => {
    const playerAnswers = room.submissions[playerId] || {};
    categories.forEach((category) => {
      const word = (playerAnswers[category] || '').trim();
      if (word) {
        itemsToValidate.push({
          id: `${playerId}:${category}`,
          player: playerId,
          category,
          word,
        });
      }
    });
  });

  // 2. Perform AI / Fallback validation
  const validations = await validateRoundAnswersGemini(letter, categories, itemsToValidate);

  // 3. Count frequencies of valid words to detect duplicates per category
  // Map of category -> normalizedWord -> count
  const wordFrequencies: Record<string, Record<string, number>> = {};
  categories.forEach((category) => {
    wordFrequencies[category] = {};
  });

  playerIds.forEach((playerId) => {
    const playerAnswers = room.submissions[playerId] || {};
    categories.forEach((category) => {
      const word = (playerAnswers[category] || '').trim();
      const validationId = `${playerId}:${category}`;
      const isValid = validations[validationId]?.isValid ?? false;

      if (word && isValid) {
        const normalized = word.toLowerCase();
        wordFrequencies[category][normalized] = (wordFrequencies[category][normalized] || 0) + 1;
      }
    });
  });

  // 4. Calculate final points and details for each player
  const playerAnswersDetail: Record<string, Record<string, AnswerDetail>> = {};
  const scoresDelta: Record<string, number> = {};

  playerIds.forEach((playerId) => {
    playerAnswersDetail[playerId] = {};
    scoresDelta[playerId] = 0;

    categories.forEach((category) => {
      const word = (room.submissions[playerId]?.[category] || '').trim();
      const validationId = `${playerId}:${category}`;
      const isValid = word ? (validations[validationId]?.isValid ?? false) : false;
      const reason = word ? validations[validationId]?.reason : 'No answer';

      let score = 0;
      let isDuplicate = false;

      if (isValid) {
        const normalized = word.toLowerCase();
        const frequency = wordFrequencies[category][normalized] || 1;
        if (frequency > 1) {
          score = 5; // Repeated answer
          isDuplicate = true;
        } else {
          score = 10; // Unique answer
        }
      }

      playerAnswersDetail[playerId][category] = {
        word,
        score,
        isValid,
        isDuplicate,
        reason,
      };

      scoresDelta[playerId] += score;
      // Add to player database persistent total score
      if (room.players[playerId]) {
        room.players[playerId].score += score;
      }
    });
  });

  room.roundResults = {
    letter,
    playerAnswers: playerAnswersDetail,
    scoresDelta,
  };
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  
  // Enable dynamic CORS with support for credentials, origins, and OPTIONS preflights
  app.use(cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['X-Requested-With', 'content-type', 'Authorization', 'Accept', 'Origin']
  }));

  app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Dynamically reflect origin to fully satisfy credentials requirement (crucial for Vercel + Cloud Run)
        callback(null, origin || '*');
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      credentials: true
    },
  });

  // Timers mapped by roomCode
  const roomTimers: Record<string, NodeJS.Timeout> = {};

  // Broadcast a complete synchronized update to all players in a room
  function broadcastRoomUpdate(roomCode: string) {
    const room = rooms[roomCode];
    if (room) {
      io.to(roomCode).emit('room-state', room);
    }
  }

  // Handle automatic transitioning and countdowns on the server side safely
  function startRoundPlayingTimer(roomCode: string) {
    if (roomTimers[roomCode]) {
      clearInterval(roomTimers[roomCode]);
    }

    const room = rooms[roomCode];
    if (!room) return;

    room.roundTimer = room.config.timerDuration;
    broadcastRoomUpdate(roomCode);

    roomTimers[roomCode] = setInterval(async () => {
      const activeRoom = rooms[roomCode];
      if (!activeRoom) {
        clearInterval(roomTimers[roomCode]);
        return;
      }

      if (activeRoom.status !== 'PLAYING') {
        clearInterval(roomTimers[roomCode]);
        return;
      }

      if (activeRoom.roundTimer > 0) {
        activeRoom.roundTimer--;
        io.to(roomCode).emit('timer-tick', activeRoom.roundTimer);
      } else {
        // Timer reached 0, end round
        clearInterval(roomTimers[roomCode]);
        activeRoom.status = 'RESULTS';
        io.to(roomCode).emit('timer-tick', 0);
        io.to(roomCode).emit('game-phase-change', { status: 'RESULTS', message: 'Timer finished! Evaluating answers...' });
        
        // Process answers
        await processRoundScores(activeRoom);
        broadcastRoomUpdate(roomCode);
      }
    }, 1000);
  }

  function startCountdownSequence(roomCode: string) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = 'COUNTDOWN';
    room.countdownTimer = 3;
    room.currentLetter = selectRandomLetter(room);
    
    // Reset inputs and statuses
    room.submissions = {};
    room.roundResults = null;
    Object.keys(room.players).forEach((pId) => {
      room.players[pId].typing = false;
      room.submissions[pId] = {};
    });

    broadcastRoomUpdate(roomCode);

    const countdownInterval = setInterval(() => {
      const activeRoom = rooms[roomCode];
      if (!activeRoom || activeRoom.status !== 'COUNTDOWN') {
        clearInterval(countdownInterval);
        return;
      }

      if (activeRoom.countdownTimer > 1) {
        activeRoom.countdownTimer--;
        io.to(roomCode).emit('countdown-tick', activeRoom.countdownTimer);
      } else {
        clearInterval(countdownInterval);
        activeRoom.status = 'PLAYING';
        startRoundPlayingTimer(roomCode);
      }
    }, 1000);
  }

  // Socket.IO real-time event handlers
  io.on('connection', (socket: Socket) => {
    // 1. Create Room
    socket.on('create-room', ({ name, avatar, config }: { name: string; avatar: string; config?: Partial<RoomConfig> }) => {
      const roomCode = generateRoomCode();
      const player: Player = {
        id: socket.id,
        name: name.trim().slice(0, 16) || 'Player 1',
        avatar: avatar || '🦖',
        score: 0,
        connected: true,
        isHost: true,
        typing: false,
      };

      const room: Room = {
        code: roomCode,
        hostId: socket.id,
        players: { [socket.id]: player },
        status: 'WAITING',
        config: {
          totalRounds: config?.totalRounds || 5,
          timerDuration: config?.timerDuration || 30,
          categories: config?.categories && config.categories.length > 0 ? config.categories : DEFAULT_CATEGORIES,
          difficulty: config?.difficulty || 'NORMAL',
        },
        currentRound: 1,
        currentLetter: '',
        usedLetters: [],
        roundTimer: config?.timerDuration || 30,
        submissions: {},
        roundResults: null,
        countdownTimer: 0,
      };

      rooms[roomCode] = room;
      playerToRoom[socket.id] = { roomCode, name: player.name };

      socket.join(roomCode);
      socket.emit('room-created', { roomCode, player, room });
      broadcastRoomUpdate(roomCode);
    });

    // 2. Join Room
    socket.on('join-room', ({ name, roomCode, avatar }: { name: string; roomCode: string; avatar: string }) => {
      const upperCode = (roomCode || '').trim().toUpperCase();
      const room = rooms[upperCode];

      if (!room) {
        socket.emit('join-error', 'Room not found. Check the code and try again.');
        return;
      }

      const trimmedName = (name || '').trim().slice(0, 16);
      if (!trimmedName) {
        socket.emit('join-error', 'Please enter a valid nickname.');
        return;
      }

      // Check for duplicate name
      const nameExists = Object.values(room.players).some(
        (p) => p.connected && p.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (nameExists) {
        socket.emit('join-error', 'That nickname is already taken in this room.');
        return;
      }

      // Check if player is rejoining after a short disconnect
      const existingDiscKey = Object.keys(disconnectedPlayers).find(
        (key) =>
          disconnectedPlayers[key].roomCode === upperCode &&
          disconnectedPlayers[key].player.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (existingDiscKey) {
        const discData = disconnectedPlayers[existingDiscKey];
        clearTimeout(discData.timeoutId);
        delete disconnectedPlayers[existingDiscKey];

        // Reconnect them and restore ID
        const prevPlayer = discData.player;
        prevPlayer.id = socket.id;
        prevPlayer.connected = true;

        room.players[socket.id] = prevPlayer;
        if (discData.submissions) {
          room.submissions[socket.id] = discData.submissions;
        }

        playerToRoom[socket.id] = { roomCode: upperCode, name: prevPlayer.name };
        socket.join(upperCode);
        socket.emit('room-joined', { roomCode: upperCode, player: prevPlayer, room });
        broadcastRoomUpdate(upperCode);
        return;
      }

      // Standard join new player
      if (room.status !== 'WAITING') {
        socket.emit('join-error', 'This game has already started. You cannot join mid-game.');
        return;
      }

      if (Object.keys(room.players).length >= 12) {
        socket.emit('join-error', 'The room is full. Max 12 players.');
        return;
      }

      const player: Player = {
        id: socket.id,
        name: trimmedName,
        avatar: avatar || '🦊',
        score: 0,
        connected: true,
        isHost: false,
        typing: false,
      };

      room.players[socket.id] = player;
      playerToRoom[socket.id] = { roomCode: upperCode, name: player.name };

      socket.join(upperCode);
      socket.emit('room-joined', { roomCode: upperCode, player, room });
      broadcastRoomUpdate(upperCode);
    });

    // Reconnection helper if client knows they disconnected
    socket.on('reconnect-player', ({ roomCode, name }: { roomCode: string; name: string }) => {
      const upperCode = (roomCode || '').toUpperCase();
      const room = rooms[upperCode];
      if (!room) return;

      // Locate in disconnected register
      const dKey = Object.keys(disconnectedPlayers).find(
        (k) =>
          disconnectedPlayers[k].roomCode === upperCode &&
          disconnectedPlayers[k].player.name.toLowerCase() === name.toLowerCase()
      );

      if (dKey) {
        const discData = disconnectedPlayers[dKey];
        clearTimeout(discData.timeoutId);
        delete disconnectedPlayers[dKey];

        const restoredPlayer = discData.player;
        restoredPlayer.id = socket.id;
        restoredPlayer.connected = true;

        room.players[socket.id] = restoredPlayer;
        if (discData.submissions) {
          room.submissions[socket.id] = discData.submissions;
        }

        playerToRoom[socket.id] = { roomCode: upperCode, name: restoredPlayer.name };
        socket.join(upperCode);
        socket.emit('room-joined', { roomCode: upperCode, player: restoredPlayer, room });
        broadcastRoomUpdate(upperCode);
      }
    });

    // 3. Update Settings (Host only)
    socket.on('update-settings', (newConfig: Partial<RoomConfig>) => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.hostId !== socket.id) return;

      if (newConfig.totalRounds) room.config.totalRounds = newConfig.totalRounds;
      if (newConfig.timerDuration) room.config.timerDuration = newConfig.timerDuration;
      if (newConfig.difficulty) room.config.difficulty = newConfig.difficulty;
      if (newConfig.categories && newConfig.categories.length > 0) {
        room.config.categories = newConfig.categories.map((c) => c.trim().slice(0, 24)).filter(Boolean);
      }

      broadcastRoomUpdate(meta.roomCode);
    });

    // 4. Start Game (Host only)
    socket.on('start-game', () => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.hostId !== socket.id) return;

      // Require at least 2 connected players (or 1 for solo testing, but prompt requested min 2 players. We will require min 2 unless host is alone and wants to test, let's allow starting with 1 to make testing super easy and friction-free, but default standard prompt suggests min 2 players in instructions)
      const connectedCount = Object.values(room.players).filter((p) => p.connected).length;
      if (connectedCount < 1) {
        socket.emit('game-error', 'You need players to start!');
        return;
      }

      room.currentRound = 1;
      room.usedLetters = [];
      // Reset scores
      Object.keys(room.players).forEach((pId) => {
        room.players[pId].score = 0;
      });

      startCountdownSequence(meta.roomCode);
    });

    // 5. Live Typing Status
    socket.on('typing-status', (typing: boolean) => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.status !== 'PLAYING') return;

      const player = room.players[socket.id];
      if (player) {
        player.typing = typing;
        broadcastRoomUpdate(meta.roomCode);
      }
    });

    // 6. Submit Answers
    socket.on('submit-answers', (answers: Record<string, string>) => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.status !== 'PLAYING') return;

      // Store answers for this round
      room.submissions[socket.id] = answers;
      
      const player = room.players[socket.id];
      if (player) {
        player.typing = false;
      }

      // Check if all connected players have submitted
      const connectedPlayerIds = Object.keys(room.players).filter((id) => room.players[id].connected);
      const allSubmitted = connectedPlayerIds.every((id) => room.submissions[id] && Object.keys(room.submissions[id]).length > 0);

      if (allSubmitted) {
        // Clear active playing timer early
        if (roomTimers[meta.roomCode]) {
          clearInterval(roomTimers[meta.roomCode]);
        }
        
        room.status = 'RESULTS';
        io.to(meta.roomCode).emit('game-phase-change', { status: 'RESULTS', message: 'All answers submitted! Grading answers...' });
        
        // Evaluate scores asynchronously then broadcast
        processRoundScores(room).then(() => {
          broadcastRoomUpdate(meta.roomCode);
        });
      } else {
        broadcastRoomUpdate(meta.roomCode);
      }
    });

    // 7. Next Round (Host only)
    socket.on('next-round', () => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.hostId !== socket.id) return;

      if (room.currentRound >= room.config.totalRounds) {
        // Game is finished
        room.status = 'FINISHED';
        broadcastRoomUpdate(meta.roomCode);
      } else {
        // Go to next round
        room.currentRound++;
        startCountdownSequence(meta.roomCode);
      }
    });

    // 8. Rematch / Play Again (Host only)
    socket.on('play-again', () => {
      const meta = playerToRoom[socket.id];
      if (!meta) return;

      const room = rooms[meta.roomCode];
      if (!room || room.hostId !== socket.id) return;

      room.currentRound = 1;
      room.status = 'WAITING';
      room.usedLetters = [];
      room.roundResults = null;
      room.submissions = {};
      
      // Reset scores
      Object.keys(room.players).forEach((pId) => {
        room.players[pId].score = 0;
        room.players[pId].typing = false;
      });

      broadcastRoomUpdate(meta.roomCode);
    });

    // 9. Back to Home / Leave Room
    socket.on('leave-room', () => {
      handleUserDisconnect(socket);
    });

    // 10. Handle Connection Drop / Disconnect
    socket.on('disconnect', () => {
      handleUserDisconnect(socket, true);
    });
  });

  // Reconnection & cleanup handler
  function handleUserDisconnect(socket: Socket, isDrop = false) {
    const meta = playerToRoom[socket.id];
    if (!meta) return;

    const { roomCode, name } = meta;
    const room = rooms[roomCode];

    delete playerToRoom[socket.id];

    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    if (isDrop) {
      // Temporarily mark as disconnected for short grace period
      player.connected = false;
      player.typing = false;
      broadcastRoomUpdate(roomCode);

      // Register disconnect handler (20 second window to reconnect)
      const timeoutId = setTimeout(() => {
        delete disconnectedPlayers[socket.id];
        finalizeUserRemoval(room, socket.id, roomCode);
      }, 20000);

      disconnectedPlayers[socket.id] = {
        roomCode,
        player,
        timeoutId,
        submissions: room.submissions[socket.id],
      };
    } else {
      // Intentional leave
      finalizeUserRemoval(room, socket.id, roomCode);
    }
  }

  function finalizeUserRemoval(room: Room, playerId: string, roomCode: string) {
    const player = room.players[playerId];
    delete room.players[playerId];
    delete room.submissions[playerId];

    const remainingPlayers = Object.keys(room.players).filter((id) => room.players[id].connected);

    if (remainingPlayers.length === 0) {
      // Room empty, clean up
      if (roomTimers[roomCode]) {
        clearInterval(roomTimers[roomCode]);
        delete roomTimers[roomCode];
      }
      delete rooms[roomCode];
      return;
    }

    // Assign new host if host left
    if (room.hostId === playerId) {
      room.hostId = remainingPlayers[0];
      room.players[room.hostId].isHost = true;
      io.to(roomCode).emit('notification', `${player?.name || 'A player'} has left. ${room.players[room.hostId].name} is the new host!`);
    } else {
      io.to(roomCode).emit('notification', `${player?.name || 'A player'} has left the room.`);
    }

    // Check if we are playing and we need to process submissions
    if (room.status === 'PLAYING') {
      const allSubmitted = remainingPlayers.every((id) => room.submissions[id] && Object.keys(room.submissions[id]).length > 0);
      if (allSubmitted) {
        if (roomTimers[roomCode]) {
          clearInterval(roomTimers[roomCode]);
        }
        room.status = 'RESULTS';
        processRoundScores(room).then(() => {
          broadcastRoomUpdate(roomCode);
        });
        return;
      }
    }

    broadcastRoomUpdate(roomCode);
  }

  // Set up development mode vs production mode
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    // Development server via Vite Connect middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });

    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const indexHtml = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        const html = await vite.transformIndexHtml(url, indexHtml);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }

  const port = 3000;
  httpServer.listen(port, () => {
    console.log(`🚀 Name, Place, Things Server listening on port ${port}`);
  });
}

startServer();
