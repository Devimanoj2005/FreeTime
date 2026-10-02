import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import confetti from 'canvas-confetti';
import { 
  Users, 
  Crown, 
  Settings, 
  Play, 
  Volume2, 
  VolumeX, 
  HelpCircle, 
  Plus, 
  Trash2, 
  RotateCcw, 
  LogOut, 
  UserPlus, 
  Hourglass, 
  Award, 
  CheckCircle2, 
  AlertCircle, 
  Activity,
  ArrowRight,
  Sparkles,
  RefreshCw,
  Clock,
  BookOpen,
  Dices,
  ShieldCheck,
  Check,
  ChevronRight
} from 'lucide-react';

// Profile Avatars list
const AVATARS = ['🦖', '🦊', '🦁', '🐨', '🐯', '🐼', '🦄', '🦉', '🐙', '🦀', '🥑', '🍩', '🛸', '🎮', '👑', '🚀', '🧩', '🐱', '🐸', '🐹'];

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
  players: Record<string, Player>;
  status: 'WAITING' | 'COUNTDOWN' | 'PLAYING' | 'RESULTS' | 'FINISHED';
  config: RoomConfig;
  currentRound: number;
  currentLetter: string;
  usedLetters: string[];
  roundTimer: number;
  submissions: Record<string, Record<string, string>>;
  roundResults: RoundResult | null;
  countdownTimer: number;
}

export default function App() {
  // Socket and Connection state
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);

  // Landing Page inputs
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  
  // Modals & UI States
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  
  // Local answers state while playing
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>({});
  const [lastTypedCategory, setLastTypedCategory] = useState<string | null>(null);
  const [lastTypingStatus, setLastTypingStatus] = useState(false);

  // Settings editing state (Host only)
  const [editRounds, setEditRounds] = useState(5);
  const [editTimer, setEditTimer] = useState(30);
  const [editDifficulty, setEditDifficulty] = useState<'EASY' | 'NORMAL' | 'HARD'>('NORMAL');
  const [editCategories, setEditCategories] = useState<string[]>([]);
  const [newCategoryInput, setNewCategoryInput] = useState('');

  // Audio Context synthesis
  const playSound = (type: 'tick' | 'success' | 'fail' | 'start' | 'over' | 'pop') => {
    if (!soundEnabled) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'tick') {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'pop') {
        osc.frequency.setValueAtTime(450, ctx.currentTime);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, ctx.currentTime); // A4
        osc.frequency.setValueAtTime(554.37, ctx.currentTime + 0.1); // C#5
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.2); // E5
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === 'fail') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 0.35);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'start') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.setValueAtTime(1046.50, ctx.currentTime + 0.15); // C6
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start();
        osc.stop(ctx.currentTime + 0.5);
      } else if (type === 'over') {
        // Winning mini fanfare
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((freq, idx) => {
          const oscNode = ctx.createOscillator();
          const gainNode = ctx.createGain();
          oscNode.connect(gainNode);
          gainNode.connect(ctx.destination);
          oscNode.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
          gainNode.gain.setValueAtTime(0.1, ctx.currentTime + idx * 0.1);
          gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.1 + 0.3);
          oscNode.start(ctx.currentTime + idx * 0.1);
          oscNode.stop(ctx.currentTime + idx * 0.1 + 0.3);
        });
      }
    } catch (e) {
      console.warn('Audio synthesis failed to start:', e);
    }
  };

  // Initialize Socket Connection
  useEffect(() => {
    const socketUrl = 'https://ais-pre-hii3hyruyyej7hsrwst6f3-518523461765.asia-southeast1.run.app';

    const s = io(socketUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5
    });

    s.on('connect', () => {
      setConnected(true);
      setJoinError(null);
      // Attempt reconnection if we had active room credentials stored
      const savedCode = sessionStorage.getItem('npt_room_code');
      const savedName = sessionStorage.getItem('npt_player_name');
      if (savedCode && savedName) {
        s.emit('reconnect-player', { roomCode: savedCode, name: savedName });
      }
    });

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on('room-created', ({ roomCode, player, room: initialRoom }) => {
      setRoom(initialRoom);
      setCurrentPlayer(player);
      sessionStorage.setItem('npt_room_code', roomCode);
      sessionStorage.setItem('npt_player_name', player.name);
      setJoinError(null);
      playSound('success');

      // Initialize edit fields
      setEditRounds(initialRoom.config.totalRounds);
      setEditTimer(initialRoom.config.timerDuration);
      setEditDifficulty(initialRoom.config.difficulty);
      setEditCategories(initialRoom.config.categories);
    });

    s.on('room-joined', ({ roomCode, player, room: joinedRoom }) => {
      setRoom(joinedRoom);
      setCurrentPlayer(player);
      sessionStorage.setItem('npt_room_code', roomCode);
      sessionStorage.setItem('npt_player_name', player.name);
      setJoinError(null);
      playSound('success');

      // Sync edit fields in case they are host
      setEditRounds(joinedRoom.config.totalRounds);
      setEditTimer(joinedRoom.config.timerDuration);
      setEditDifficulty(joinedRoom.config.difficulty);
      setEditCategories(joinedRoom.config.categories);
    });

    s.on('join-error', (msg) => {
      setJoinError(msg);
      playSound('fail');
    });

    s.on('room-state', (updatedRoom: Room) => {
      setRoom(updatedRoom);
      
      // Update our player's reference
      const myId = s.id;
      if (myId && updatedRoom.players[myId]) {
        setCurrentPlayer(updatedRoom.players[myId]);
      }

      // Sync settings on updates
      setEditRounds(updatedRoom.config.totalRounds);
      setEditTimer(updatedRoom.config.timerDuration);
      setEditDifficulty(updatedRoom.config.difficulty);
      setEditCategories(updatedRoom.config.categories);
    });

    s.on('timer-tick', (timeLeft: number) => {
      setRoom(prev => {
        if (!prev) return null;
        return { ...prev, roundTimer: timeLeft };
      });
      if (timeLeft <= 5 && timeLeft > 0) {
        playSound('tick');
      }
    });

    s.on('countdown-tick', (count: number) => {
      setRoom(prev => {
        if (!prev) return null;
        return { ...prev, countdownTimer: count };
      });
      playSound('tick');
    });

    s.on('game-phase-change', ({ status, message }) => {
      if (status === 'RESULTS') {
        playSound('success');
      }
    });

    s.on('notification', (msg: string) => {
      // Could show a toast, or log in UI
      console.log('Server note:', msg);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  // Sync typing status
  useEffect(() => {
    if (!socket || !room || room.status !== 'PLAYING') return;

    // Detect if we are typing (checking if any local answer is populated)
    const isCurrentlyTyping = Object.values(localAnswers).some(val => val.trim().length > 0);
    if (isCurrentlyTyping !== lastTypingStatus) {
      setLastTypingStatus(isCurrentlyTyping);
      socket.emit('typing-status', isCurrentlyTyping);
    }
  }, [localAnswers, room?.status, socket]);

  // Clean local answers when game status changes to COUNTDOWN (new round starting)
  useEffect(() => {
    if (room?.status === 'COUNTDOWN') {
      setLocalAnswers({});
      setLastTypingStatus(false);
      playSound('start');
    }
    if (room?.status === 'FINISHED') {
      // Blast confetti!
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });
      playSound('over');
    }
  }, [room?.status]);

  // Handle game room creation
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setJoinError('Please enter your name to create a room.');
      return;
    }
    socket?.emit('create-room', { name, avatar });
  };

  // Handle joining a room
  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setJoinError('Please enter your name first.');
      return;
    }
    if (!roomCodeInput.trim()) {
      setJoinError('Please enter a 5-digit room code.');
      return;
    }
    socket?.emit('join-room', {
      name,
      roomCode: roomCodeInput.toUpperCase().trim(),
      avatar
    });
  };

  // Apply updated game configurations
  const handleSaveSettings = () => {
    if (!socket || !room || room.hostId !== socket.id) return;
    
    socket.emit('update-settings', {
      totalRounds: editRounds,
      timerDuration: editTimer,
      difficulty: editDifficulty,
      categories: editCategories
    });
    
    setShowSettingsModal(false);
    playSound('pop');
  };

  // Trigger game start (host only)
  const handleStartGame = () => {
    socket?.emit('start-game');
    playSound('pop');
  };

  // Submit local answers
  const handleSubmitAnswers = () => {
    socket?.emit('submit-answers', localAnswers);
    playSound('pop');
  };

  // Trigger next round (host only)
  const handleNextRound = () => {
    socket?.emit('next-round');
    playSound('pop');
  };

  // Request rematch/play again
  const handlePlayAgain = () => {
    socket?.emit('play-again');
    playSound('pop');
  };

  // Voluntarily leave current room
  const handleLeaveRoom = () => {
    socket?.emit('leave-room');
    setRoom(null);
    setCurrentPlayer(null);
    sessionStorage.removeItem('npt_room_code');
    sessionStorage.removeItem('npt_player_name');
    playSound('pop');
  };

  // Helper to copy room code
  const copyRoomCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    playSound('pop');
  };

  // Generate sorted players leaderboard list
  const getLeaderboard = (): Player[] => {
    if (!room) return [];
    return Object.values(room.players).sort((a, b) => b.score - a.score);
  };

  const currentLeader = getLeaderboard()[0];

  return (
    <div className="min-h-screen bg-[#082751] text-[#ECF9FF] flex flex-col font-sans selection:bg-[#ECF9FF] selection:text-[#082751] relative overflow-x-hidden">
      {/* Dynamic Background Game Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#ECF9FF_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_75%,transparent_100%)] pointer-events-none opacity-10"></div>

      {/* Header Bar */}
      <header className="relative z-10 border-b border-[#ECF9FF]/15 bg-[#082751]/80 backdrop-blur-md px-4 sm:px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {/* Custom Mini Stopwatch F/T Brand Logo */}
          <div className="bg-[#ECF9FF] text-[#082751] p-2.5 rounded-xl shadow-lg shadow-[#ECF9FF]/10 flex items-center justify-center hover:scale-105 transition duration-200">
            <svg className="w-6 h-6 text-[#082751]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              {/* stopwatch dial */}
              <circle cx="12" cy="13" r="8" />
              {/* stopwatch top button */}
              <path d="M12 2v3" />
              <path d="M10 2h4" />
              {/* F & T initials inside the dial */}
              <text x="7.5" y="16" fontSize="7.5" fontWeight="950" fontFamily="system-ui, sans-serif" fill="currentColor" stroke="none">F</text>
              <text x="12.5" y="16" fontSize="7.5" fontWeight="950" fontFamily="system-ui, sans-serif" fill="currentColor" stroke="none">T</text>
              {/* vertical center indicator */}
              <line x1="12" y1="8" x2="12" y2="10" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-black tracking-wider bg-gradient-to-r from-[#ECF9FF] via-[#ECF9FF]/80 to-[#ECF9FF]/60 bg-clip-text text-transparent">
              FREE TIME
            </h1>
            <p className="text-[10px] text-[#ECF9FF]/60 font-bold uppercase tracking-widest hidden sm:block">Real-time Adjudication Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Audio Controls */}
          <button 
            onClick={() => { setSoundEnabled(!soundEnabled); playSound('pop'); }}
            className={`p-2.5 rounded-xl border transition-all duration-200 ${
              soundEnabled 
                ? 'bg-[#082751]/80 border-[#ECF9FF]/20 text-[#ECF9FF] hover:border-[#ECF9FF]/50' 
                : 'bg-red-950/20 border-red-900/30 text-red-400 hover:text-red-300'
            }`}
            title={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* Rules info */}
          <button 
            onClick={() => { setShowHowToPlay(true); playSound('pop'); }}
            className="p-2.5 bg-[#082751]/80 border border-[#ECF9FF]/20 rounded-xl text-[#ECF9FF] hover:border-[#ECF9FF]/50 transition-all duration-200"
            title="How to Play"
          >
            <HelpCircle className="w-5 h-5" />
          </button>

          {/* Connection status badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${
            connected 
              ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-400' 
              : 'bg-amber-950/20 border-amber-900/40 text-amber-400 animate-pulse'
          }`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            {connected ? 'LIVE' : 'RECONNECTING'}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 relative z-10 flex flex-col justify-center items-center">
        
        {/* ==================================== */}
        {/* 1. LANDING PAGE                      */}
        {/* ==================================== */}
        {!room && (
          <div className="w-full max-w-5xl flex flex-col items-center justify-center py-6 sm:py-12 relative animate-fade-in">
            
            {/* Premium Floating Words & Fragments */}
            <div className="absolute bottom-12 right-6 transform rotate-6 bg-[#082751]/90 border border-[#ECF9FF]/25 text-[#ECF9FF] font-black px-4 py-2 rounded-2xl shadow-[0_0_15px_rgba(236,249,255,0.08)] backdrop-blur-md text-xs sm:text-sm tracking-wider hover:scale-110 hover:rotate-0 transition-all duration-300 flex items-center gap-1.5 select-none z-0">
              <span>📍</span> SYDNEY
            </div>
            <div className="absolute bottom-16 left-12 transform -rotate-6 bg-[#082751]/90 border border-[#ECF9FF]/25 text-[#ECF9FF] font-black px-4 py-2 rounded-2xl shadow-[0_0_15px_rgba(236,249,255,0.08)] backdrop-blur-md text-xs sm:text-sm tracking-wider hover:scale-110 hover:rotate-0 transition-all duration-300 flex items-center gap-1.5 select-none z-0">
              <span>🧸</span> SPOON
            </div>

            {/* Glowing Interactive Brand Logo (SVG + CSS) */}
            <div className="flex flex-col items-center justify-center mb-8 relative z-10 select-none">
              
              {/* Outer Stopwatch circle */}
              <div className="w-56 h-56 rounded-full border-2 border-dashed border-[#ECF9FF]/20 flex items-center justify-center relative shadow-[0_0_40px_rgba(236,249,255,0.03)] bg-[#082751]/40">
                
                {/* Stopwatch top crown element */}
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 flex flex-col items-center">
                  <div className="w-8 h-3.5 bg-[#ECF9FF] rounded-t-md shadow-lg border-b border-[#082751]"></div>
                  <div className="w-5 h-1 bg-[#ECF9FF]/60 rounded-b-sm"></div>
                </div>

                {/* Circular ticks & decorations */}
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-[#ECF9FF]/80 rounded-full"></div>
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 w-1.5 h-1.5 bg-[#ECF9FF]/80 rounded-full"></div>
                <div className="absolute left-4 top-1/2 transform -translate-y-1/2 w-1.5 h-1.5 bg-[#ECF9FF]/80 rounded-full"></div>
                <div className="absolute right-4 top-1/2 transform -translate-y-1/2 w-1.5 h-1.5 bg-[#ECF9FF]/80 rounded-full"></div>
                
                {/* Stopwatch circular hand/gauge path */}
                <div className="absolute inset-4 rounded-full border border-[#ECF9FF]/10"></div>
                <div className="absolute inset-8 rounded-full border-2 border-dashed border-[#ECF9FF]/5"></div>

                {/* Interactive bobbing Tiles */}
                <div className="flex items-center gap-2.5 z-10">
                  
                  {/* F Tile */}
                  <div className="w-18 h-18 bg-[#0c1f3c] text-white border-2 border-[#ECF9FF]/30 rounded-2xl flex flex-col items-center justify-center shadow-2xl relative transform -rotate-12 hover:-rotate-6 hover:-translate-y-1 transition duration-200">
                    <span className="font-extrabold text-4xl leading-none">F</span>
                    {/* superscript degree circle */}
                    <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-white/60"></div>
                  </div>

                  {/* Central vertical needle (Dagger / Lightning) */}
                  <div className="relative w-8 h-24 flex items-center justify-center shrink-0">
                    {/* Glowing Lightning NEEDLE */}
                    <svg className="w-6 h-20 text-[#ECF9FF] drop-shadow-[0_0_8px_rgba(236,249,255,0.8)]" viewBox="0 0 24 80">
                      <path d="M12 0 L18 30 L14 30 L16 55 L12 80 L8 55 L10 30 L6 30 Z" fill="currentColor" />
                      {/* Inner needle lightning cut */}
                      <path d="M12 15 L14 35 L11 35 L13 55" stroke="#082751" strokeWidth="2" fill="none" strokeLinecap="round" />
                    </svg>
                    {/* Needle screw spindle center pivot */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-[#082751] border-2 border-[#ECF9FF] rounded-full shadow-md z-20"></div>
                  </div>

                  {/* T Tile */}
                  <div className="w-18 h-18 bg-[#ECF9FF] text-[#082751] border-2 border-white/80 rounded-2xl flex flex-col items-center justify-center shadow-2xl relative transform rotate-12 hover:rotate-6 hover:-translate-y-1 transition duration-200">
                    <span className="font-extrabold text-4xl leading-none">T</span>
                    {/* bolt circular accent */}
                    <div className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-[#082751]/80 bg-[#082751]/10 flex items-center justify-center font-bold text-[6px]">
                      ⚡
                    </div>
                  </div>

                </div>

                {/* Sub-decorative outer corner stars */}
                <div className="absolute top-12 left-6 text-[#ECF9FF]/40 text-xs animate-pulse">✦</div>
                <div className="absolute top-12 right-6 text-[#ECF9FF]/40 text-xs animate-pulse">✦</div>
              </div>

              {/* Huge Bold Title: "FREE TIME" */}
              <h2 className="text-5xl sm:text-6xl font-black tracking-tight text-white uppercase mt-4 mb-3 drop-shadow-[0_4px_12px_rgba(0,0,0,0.4)]">
                FREE TIME
              </h2>

              {/* Pill Container button: NAME • PLACE • THINGS • ARCADE */}
              <div className="border border-[#ECF9FF]/30 px-6 py-2 rounded-full font-black text-[10px] tracking-widest text-[#ECF9FF] uppercase bg-[#082751]/60 backdrop-blur-md shadow-inner select-none hover:border-[#ECF9FF]/60 transition-colors">
                NAME • PLACE • THINGS • ARCADE
              </div>

              {/* Glowing Caption */}
              <p className="text-[11px] font-black uppercase text-[#ECF9FF]/60 mt-3 tracking-widest flex items-center gap-1.5">
                ⚡ REAL-TIME MULTIPLAYER WORD BATTLE ⚡
              </p>
            </div>

            {/* Config & Lobby setup */}
            <div className="w-full max-w-xl bg-[#082751]/80 border border-[#ECF9FF]/25 rounded-[2rem] p-6 sm:p-8 shadow-[0_0_50px_rgba(8,39,81,0.6)] backdrop-blur-xl relative z-10">
              {/* Name Setup - Customizer Removed */}
              <div className="mb-6 pb-6 border-b border-[#ECF9FF]/20">
                <label className="block text-xs uppercase tracking-widest font-black text-[#ECF9FF]/60 mb-3 text-center sm:text-left">
                  1. Enter Your Display Name
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter your nickname..."
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 16))}
                    className="w-full bg-[#082751] border border-[#ECF9FF]/30 hover:border-[#ECF9FF]/50 focus:border-[#ECF9FF] focus:ring-1 focus:ring-[#ECF9FF] text-[#ECF9FF] placeholder-[#ECF9FF]/40 rounded-2xl px-5 py-3.5 font-bold text-lg outline-none transition-all duration-200"
                  />
                </div>
              </div>

              {/* Action grid split */}
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Create Room Box */}
                <div className="bg-[#082751]/50 border border-[#ECF9FF]/10 p-4 rounded-2xl flex flex-col justify-between">
                  <div>
                    <h3 className="font-extrabold text-[#ECF9FF] text-sm">Host a Party</h3>
                    <p className="text-[11px] text-[#ECF9FF]/50 mt-1 leading-relaxed">Host a new game room, customize categories, total rounds, and difficulty.</p>
                  </div>
                  <button
                    onClick={handleCreateRoom}
                    className="w-full mt-4 bg-[#ECF9FF] text-[#082751] hover:bg-[#ECF9FF]/90 font-extrabold py-3 px-4 border-b-4 border-slate-300 hover:border-b-2 active:border-b-0 hover:translate-y-[2px] active:translate-y-[4px] rounded-xl shadow-lg transition-all duration-150 flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
                  >
                    <Plus className="w-4 h-4" /> Create Room
                  </button>
                </div>

                {/* Join Room Box */}
                <div className="bg-[#082751]/50 border border-[#ECF9FF]/10 p-4 rounded-2xl flex flex-col justify-between">
                  <div>
                    <h3 className="font-extrabold text-[#ECF9FF] text-sm">Join Friends</h3>
                    <p className="text-[11px] text-[#ECF9FF]/50 mt-1 leading-relaxed">Enter a 5-digit code shared by your friends to jump straight into their lobby.</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    <input
                      type="text"
                      placeholder="ENTER CODE"
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase().slice(0, 5))}
                      className="w-full bg-[#082751] border border-[#ECF9FF]/20 text-center tracking-widest font-mono text-[#ECF9FF] placeholder-[#ECF9FF]/30 rounded-xl py-2 uppercase outline-none focus:border-[#ECF9FF] font-bold text-sm"
                    />
                    <button
                      onClick={handleJoinRoom}
                      className="w-full bg-[#082751] hover:bg-[#082751]/75 text-[#ECF9FF] border border-[#ECF9FF]/40 font-extrabold py-3 px-4 border-b-4 border-[#082751]/90 hover:border-b-2 active:border-b-0 hover:translate-y-[2px] active:translate-y-[4px] rounded-xl shadow-lg transition-all duration-150 flex items-center justify-center gap-2 text-xs uppercase tracking-widest"
                    >
                      <UserPlus className="w-4 h-4" /> Join Room
                    </button>
                  </div>
                </div>
              </div>

              {joinError && (
                <div className="mt-4 bg-red-950/30 border border-red-900/50 rounded-xl p-3 flex items-start gap-2.5 text-red-400 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-red-300">Could not connect: </span>
                    {joinError}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ==================================== */}
        {/* 2. GAME LOBBY (WAITING ROOM)         */}
        {/* ==================================== */}
        {room && room.status === 'WAITING' && (
          <div className="w-full max-w-4xl grid md:grid-cols-12 gap-6 items-start py-4">
            
            {/* Medium Brand Logo header for Lobby */}
            <div className="md:col-span-12 flex flex-col items-center justify-center mb-6 select-none animate-fade-in shrink-0">
              <div className="w-28 h-28 rounded-full border border-dashed border-[#ECF9FF]/20 flex items-center justify-center relative shadow-[0_0_20px_rgba(236,249,255,0.02)] bg-[#082751]/40 hover:scale-105 transition duration-300">
                <div className="absolute -top-1.5 left-1/2 transform -translate-x-1/2 w-5 h-2 bg-[#ECF9FF] rounded-t-sm border-b border-[#082751]"></div>
                <div className="flex items-center gap-1.5 z-10">
                  <div className="w-9 h-9 bg-[#0c1f3c] text-white border border-[#ECF9FF]/30 rounded-xl flex flex-col items-center justify-center shadow-lg relative transform -rotate-12">
                    <span className="font-extrabold text-base leading-none">F</span>
                  </div>
                  <div className="relative w-4 h-12 flex items-center justify-center shrink-0">
                    <svg className="w-3 h-10 text-[#ECF9FF]" viewBox="0 0 24 80">
                      <path d="M12 0 L18 30 L14 30 L16 55 L12 80 L8 55 L10 30 L6 30 Z" fill="currentColor" />
                    </svg>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-[#082751] border border-[#ECF9FF] rounded-full z-20"></div>
                  </div>
                  <div className="w-9 h-9 bg-[#ECF9FF] text-[#082751] border border-white rounded-xl flex flex-col items-center justify-center shadow-lg relative transform rotate-12">
                    <span className="font-extrabold text-base leading-none">T</span>
                  </div>
                </div>
              </div>
              <h2 className="text-2xl font-black text-white uppercase tracking-wider mt-2.5">LOBBY STANDBY</h2>
            </div>
            
            {/* Left configurations panel (Host or View Only for other players) */}
            <div className="md:col-span-5 bg-slate-900/80 border border-slate-800/90 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
                <div className="flex items-center gap-2">
                  <Settings className="w-5 h-5 text-indigo-400" />
                  <h3 className="font-bold text-slate-200">Room Configurations</h3>
                </div>
                {room.hostId === socket?.id && (
                  <button 
                    onClick={() => { setShowSettingsModal(true); playSound('pop'); }}
                    className="text-xs text-indigo-400 hover:text-indigo-300 font-bold underline"
                  >
                    Edit Settings
                  </button>
                )}
              </div>

              {/* Render current settings */}
              <div className="space-y-4 text-sm">
                <div className="flex justify-between items-center bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                  <span className="text-slate-400 font-medium">Difficulty Level</span>
                  <span className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                    room.config.difficulty === 'EASY' ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' :
                    room.config.difficulty === 'NORMAL' ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400' :
                    'bg-red-500/10 border border-red-500/20 text-red-400'
                  }`}>{room.config.difficulty}</span>
                </div>

                <div className="flex justify-between items-center bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                  <span className="text-slate-400 font-medium">Timer Duration</span>
                  <span className="font-semibold text-slate-200">{room.config.timerDuration} seconds</span>
                </div>

                <div className="flex justify-between items-center bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                  <span className="text-slate-400 font-medium">Total Rounds</span>
                  <span className="font-semibold text-slate-200">{room.config.totalRounds} rounds</span>
                </div>

                <div className="space-y-2 bg-slate-950/40 p-3 rounded-xl border border-slate-800/40">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 font-medium">Active Categories ({room.config.categories.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {room.config.categories.map((cat, idx) => (
                      <span key={idx} className="bg-slate-900 border border-slate-800 text-xs px-2.5 py-1 rounded-lg text-slate-300 font-medium">{cat}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Host panel notification */}
              {room.hostId === socket?.id ? (
                <div className="bg-indigo-950/10 border border-indigo-900/30 text-indigo-300 rounded-2xl p-4 text-xs leading-relaxed">
                  💡 <span className="font-bold">Host Tip:</span> Invite friends using the room code on the right! Once they join, click the <span className="font-bold">Start Game</span> button.
                </div>
              ) : (
                <div className="bg-slate-950/60 border border-slate-800/40 text-slate-400 rounded-2xl p-4 text-xs leading-relaxed text-center animate-pulse">
                  ⌛ Waiting for host <span className="font-bold text-slate-300">{room.players[room.hostId]?.name}</span> to kick off the match...
                </div>
              )}
            </div>

            {/* Right players & invitation status */}
            <div className="md:col-span-7 space-y-6">
              {/* Invite Code card */}
              <div className="bg-gradient-to-r from-slate-900 to-slate-950 border-2 border-dashed border-indigo-500/20 rounded-3xl p-6 text-center shadow-xl space-y-4">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Invite Your Friends</span>
                
                <div className="flex items-center justify-center gap-2.5">
                  <div className="bg-slate-950 border border-slate-800 px-6 py-3.5 rounded-2xl font-mono text-3xl font-black tracking-widest text-indigo-400 select-all shadow-inner">
                    {room.code}
                  </div>
                  <button
                    onClick={copyRoomCode}
                    className={`py-3.5 px-5 rounded-2xl font-semibold transition-all duration-200 flex items-center gap-2 text-sm ${
                      copiedCode 
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-slate-100 shadow-lg shadow-indigo-600/20'
                    }`}
                  >
                    {copiedCode ? <Check className="w-5 h-5" /> : 'Copy'}
                  </button>
                </div>

                <p className="text-xs text-slate-500 font-medium">Provide this code to your friends. They will join instantly!</p>
              </div>

              {/* Active players lists */}
              <div className="bg-slate-900/80 border border-slate-800/90 rounded-3xl p-5 sm:p-6 shadow-xl">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800/60">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" />
                    <h3 className="font-bold text-slate-200">Joined Players ({Object.keys(room.players).length})</h3>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {Object.values(room.players).map((player) => (
                    <div 
                      key={player.id} 
                      className={`flex items-center justify-between p-3 rounded-2xl border transition ${
                        player.connected 
                          ? 'bg-slate-950/50 border-slate-800/85 hover:border-slate-800' 
                          : 'bg-slate-950/20 border-slate-900 text-slate-500 line-through'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="text-2xl bg-slate-900/80 border border-slate-800 p-1.5 rounded-xl">
                          {player.avatar}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                            {player.name}
                            {player.isHost && (
                              <span title="Room Host">
                                <Crown className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                            {player.id === socket?.id ? 'YOU' : player.connected ? 'READY' : 'DISCONNECTED'}
                          </span>
                        </div>
                      </div>
                      
                      {player.connected ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/40"></span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Game Action Button */}
                <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between gap-4">
                  <button
                    onClick={handleLeaveRoom}
                    className="px-4 py-2.5 bg-slate-950 border border-slate-800 text-slate-400 hover:text-red-400 hover:border-red-950 rounded-xl transition text-sm flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Leave Room
                  </button>

                  {room.hostId === socket?.id && (
                    <button
                      onClick={handleStartGame}
                      disabled={Object.values(room.players).filter(p => p.connected).length < 2}
                      className={`px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/10 transition-all duration-200 flex items-center gap-2 text-sm ${Object.values(room.players).filter(p => p.connected).length < 2 ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <Play className="w-4 h-4" /> Start Game
                    </button>
                  )}
                </div>
                {room.hostId === socket?.id && Object.values(room.players).filter(p => p.connected).length < 2 && (
                  <p className="text-right text-[10px] text-amber-500 font-medium mt-2">⚠️ Need at least 2 connected players to start!</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ==================================== */}
        {/* 3. GAME COUNTDOWN SCREEN             */}
        {/* ==================================== */}
        {room && room.status === 'COUNTDOWN' && (
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-6 flex flex-col items-center justify-center my-12 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 animate-pulse"></div>
            
            <span className="text-xs uppercase tracking-widest font-black text-slate-500">Starting Round {room.currentRound}</span>
            
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-400">YOUR LETTER IS...</h3>
              <div className="w-28 h-28 mx-auto bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-2xl shadow-xl flex items-center justify-center text-6xl font-black text-white transform animate-bounce">
                {room.currentLetter}
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-500 text-xs uppercase tracking-widest font-bold">Countdown</span>
              <div className="text-6xl font-black text-slate-100 font-mono tracking-tighter animate-ping">
                {room.countdownTimer}
              </div>
            </div>

            <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
              Think fast! Fill all categories with words starting with <span className="font-bold text-slate-200">"{room.currentLetter}"</span> before the timer hits zero.
            </p>
          </div>
        )}

        {/* ==================================== */}
        {/* 4. MAIN GAMEPLAY SCREEN (PLAYING)   */}
        {/* ==================================== */}
        {room && room.status === 'PLAYING' && (
          <div className="w-full max-w-5xl grid md:grid-cols-12 gap-6 items-start py-4 relative z-10">
            
            {/* Left inputs and fields (8 columns) */}
            <div className="md:col-span-8 bg-slate-950/80 border border-slate-800/80 rounded-[2rem] p-5 sm:p-6 shadow-2xl space-y-6 backdrop-blur-xl">
              
              {/* Premium Playing Screen Header Banner */}
              <div className="flex flex-col sm:flex-row justify-between items-center bg-slate-900/60 p-4 rounded-2xl border border-slate-800/40 gap-4">
                <div className="text-center sm:text-left">
                  <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest block">Game Stage</span>
                  <div className="text-xl font-black text-indigo-400">Round {room.currentRound} of {room.config.totalRounds}</div>
                </div>

                {/* Glowing Core Letter Indicator */}
                <div className="text-center">
                  <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest block mb-1">Target Letter</span>
                  <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 via-purple-500 to-fuchsia-500 rounded-2xl flex items-center justify-center text-4xl font-black text-white shadow-[0_0_20px_rgba(168,85,247,0.35)] transform hover:scale-105 transition-all duration-300 select-none">
                    {room.currentLetter}
                  </div>
                </div>

                {/* SVG Circular Countdown Timer */}
                <div className="flex items-center gap-3">
                  <div className="text-right hidden sm:block">
                    <span className="text-slate-500 text-[10px] font-black uppercase tracking-widest block">Seconds left</span>
                    <span className="text-xs text-slate-400 font-bold">Submit before buzzer!</span>
                  </div>
                  
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    <svg className="absolute -rotate-90 w-full h-full">
                      <circle cx="32" cy="32" r="28" className="stroke-slate-900 fill-none" strokeWidth="4" />
                      <circle 
                        cx="32" 
                        cy="32" 
                        r="28" 
                        className={`fill-none transition-all duration-1000 ${room.roundTimer <= 7 ? 'stroke-red-500 animate-pulse' : 'stroke-pink-500'}`} 
                        strokeWidth="4" 
                        strokeDasharray="175.9" 
                        strokeDashoffset={175.9 - (175.9 * room.roundTimer) / (room.config.timerDuration || 30)}
                        strokeLinecap="round" 
                      />
                    </svg>
                    <span className={`text-lg font-black font-mono tracking-tighter ${room.roundTimer <= 7 ? 'text-red-500 animate-ping' : 'text-pink-500'}`}>
                      {room.roundTimer}
                    </span>
                  </div>
                </div>
              </div>

              {/* Dynamic Answer Fields */}
              <div className="space-y-4">
                <span className="text-xs font-black uppercase tracking-widest text-slate-400 block pb-1">
                  ✍️ Enter words starting with "{room.currentLetter.toUpperCase()}"
                </span>
                
                {room.config.categories.map((category) => {
                  const val = localAnswers[category] || '';
                  const isValidLetter = val.trim() ? val.trim().toLowerCase().startsWith(room.currentLetter.toLowerCase()) : true;

                  return (
                    <div 
                      key={category} 
                      className={`bg-slate-900/40 border p-4 rounded-2xl transition-all duration-200 ${
                        val.trim() 
                          ? !isValidLetter 
                            ? 'border-red-900/60 shadow-[0_0_15px_rgba(239,68,68,0.05)]' 
                            : 'border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.05)]'
                          : 'border-slate-800/60 focus-within:border-indigo-500/40'
                      }`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <label className="font-extrabold text-slate-200 flex items-center gap-2 text-sm sm:text-base">
                          {category}
                        </label>
                        {val.trim() && (
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                            isValidLetter 
                              ? 'bg-indigo-950/30 border-indigo-900/40 text-indigo-400' 
                              : 'bg-red-950/30 border-red-900/40 text-red-400'
                          }`}>
                            {isValidLetter ? 'Match ✓' : 'Invalid start ✗'}
                          </span>
                        )}
                      </div>

                      <div className="relative">
                        <input
                          type="text"
                          placeholder={`Type a ${category.toLowerCase()} starting with '${room.currentLetter.toUpperCase()}'...`}
                          value={val}
                          onChange={(e) => {
                            setLocalAnswers(prev => ({ ...prev, [category]: e.target.value }));
                            setLastTypedCategory(category);
                          }}
                          disabled={currentPlayer?.connected === false}
                          className="w-full bg-slate-950/80 border border-slate-850 hover:border-slate-800 focus:border-indigo-500 text-slate-100 placeholder-slate-700 rounded-xl px-4 py-3 font-bold text-sm outline-none transition-all"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Submission control center */}
              <div className="pt-4 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
                <p className="text-[10px] text-slate-500 max-w-sm text-center sm:text-left leading-relaxed">
                  ⚠️ Words are validated by Gemini on submission. Be quick and creative: repeated words get fewer points than completely unique answers!
                </p>
                <button
                  onClick={handleSubmitAnswers}
                  disabled={Object.keys(localAnswers).length === 0}
                  className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-slate-900 disabled:to-slate-900 disabled:text-slate-600 text-white font-extrabold border-b-4 border-indigo-800 hover:border-b-2 active:border-b-0 hover:translate-y-[2px] active:translate-y-[4px] rounded-xl shadow-lg shadow-indigo-600/10 transition-all duration-150 text-xs uppercase tracking-widest shrink-0"
                >
                  Submit Answers
                </button>
              </div>

            </div>

            {/* Right side players connection statuses (4 columns) */}
            <div className="md:col-span-4 bg-slate-950/80 border border-slate-800/80 rounded-[2rem] p-5 shadow-2xl space-y-4 backdrop-blur-xl">
              <div className="pb-2 border-b border-slate-800/60">
                <h3 className="font-black text-slate-200 text-xs uppercase tracking-widest">Live Players Status</h3>
              </div>

              <div className="space-y-2.5">
                {Object.values(room.players).map((p) => {
                  const roundSub = room.submissions[p.id];
                  const hasSubmittedAll = roundSub && Object.keys(roundSub).length > 0;

                  return (
                    <div key={p.id} className="bg-slate-900/40 p-3 rounded-2xl border border-slate-800/50 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="text-xl bg-slate-950 border border-slate-800 p-1.5 rounded-xl">
                          {p.avatar}
                        </div>
                        <div className="min-w-0">
                          <div className="font-extrabold text-slate-200 text-xs sm:text-sm truncate">
                            {p.name}
                          </div>
                          <span className="text-[10px] text-slate-500 font-bold block">
                            Score: {p.score} pts
                          </span>
                        </div>
                      </div>

                      {hasSubmittedAll ? (
                        <span className="bg-emerald-950/30 text-emerald-400 border border-emerald-900/40 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0 select-none">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                        </span>
                      ) : p.typing ? (
                        <span className="bg-indigo-950/30 text-indigo-400 border border-indigo-900/40 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0 animate-pulse select-none">
                          <Activity className="w-3.5 h-3.5" /> Typing...
                        </span>
                      ) : (
                        <span className="bg-slate-950 text-slate-600 border border-slate-850 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0 select-none">
                          <Hourglass className="w-3.5 h-3.5" /> Thinking
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        )}

        {/* ==================================== */}
        {/* 5. ROUND RESULTS SCREEN              */}
        {/* ==================================== */}
        {room && room.status === 'RESULTS' && (
          <div className="w-full max-w-5xl space-y-6 py-4">
            
            {/* Header Result card */}
            <div className="bg-gradient-to-r from-indigo-900/20 via-slate-900 to-violet-900/10 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4 text-center sm:text-left">
                <div className="w-14 h-14 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center text-3xl font-black text-white shadow-md">
                  {room.currentLetter}
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-100 tracking-wider">🎉 ROUND {room.currentRound} RESULTS</h3>
                  <p className="text-xs text-slate-400 font-medium">Scores evaluated for letter "{room.currentLetter.toUpperCase()}"</p>
                </div>
              </div>

              <div className="flex gap-2">
                <div className="flex items-center gap-1 px-3 py-1 bg-emerald-950/20 border border-emerald-900/30 rounded-lg text-[10px] font-bold text-emerald-400">
                  🟢 Unique → 10
                </div>
                <div className="flex items-center gap-1 px-3 py-1 bg-amber-950/20 border border-amber-900/30 rounded-lg text-[10px] font-bold text-amber-400">
                  🟡 Repeated → 5
                </div>
                <div className="flex items-center gap-1 px-3 py-1 bg-red-950/20 border border-red-900/30 rounded-lg text-[10px] font-bold text-red-400">
                  🔴 Invalid → 0
                </div>
              </div>
            </div>

            {/* Answers grading grid matrix */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl overflow-hidden">
              <h4 className="font-extrabold text-slate-200 mb-4 flex items-center gap-2">
                <Award className="w-5 h-5 text-indigo-400" /> Answers & Adjudication Matrix
              </h4>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-500 font-bold uppercase tracking-wider">
                      <th className="py-3 px-4 min-w-[140px]">Category</th>
                      {Object.values(room.players).map((p) => (
                        <th key={p.id} className="py-3 px-4 min-w-[150px] text-center">
                          <div className="flex items-center justify-center gap-1.5 font-bold text-slate-300">
                            <span>{p.avatar}</span>
                            <span>{p.name}</span>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-sm">
                    {room.config.categories.map((category) => (
                      <tr key={category} className="hover:bg-slate-950/20 transition-all">
                        <td className="py-4 px-4 font-bold text-slate-200">{category}</td>
                        {Object.values(room.players).map((p) => {
                          const ansDetail: AnswerDetail | undefined = room.roundResults?.playerAnswers[p.id]?.[category];
                          
                          if (!ansDetail || !ansDetail.word) {
                            return (
                              <td key={p.id} className="py-4 px-4 text-center">
                                <span className="text-slate-600 italic text-xs">No answer</span>
                              </td>
                            );
                          }

                          return (
                            <td key={p.id} className="py-4 px-4">
                              <div className="flex flex-col items-center justify-center space-y-1">
                                <div className={`px-3 py-1.5 rounded-xl font-bold border max-w-[180px] truncate text-center ${
                                  ansDetail.isValid 
                                    ? ansDetail.isDuplicate 
                                      ? 'bg-amber-950/20 border-amber-900/40 text-amber-300' 
                                      : 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300'
                                    : 'bg-red-950/20 border-red-900/40 text-red-300 line-through'
                                }`} title={ansDetail.word}>
                                  {ansDetail.word}
                                </div>
                                
                                <div className="flex items-center gap-1.5 text-[10px] font-bold">
                                  <span className={
                                    ansDetail.isValid 
                                      ? ansDetail.isDuplicate 
                                        ? 'text-amber-400' 
                                        : 'text-emerald-400'
                                      : 'text-red-400'
                                  }>
                                    +{ansDetail.score} pts
                                  </span>
                                  {ansDetail.reason && !ansDetail.isValid && (
                                    <span className="text-slate-500 font-normal">({ansDetail.reason})</span>
                                  )}
                                </div>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    
                    {/* Totals row */}
                    <tr className="bg-slate-950/40 font-bold border-t border-slate-800 text-slate-200">
                      <td className="py-4 px-4">Round Points Total</td>
                      {Object.values(room.players).map((p) => (
                        <td key={p.id} className="py-4 px-4 text-center">
                          <span className="text-indigo-400 font-extrabold text-base">
                            +{room.roundResults?.scoresDelta[p.id] || 0} pts
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Dynamic scoreboard & Next step action (split layout) */}
            <div className="grid md:grid-cols-12 gap-6 items-start">
              
              {/* Leaderboard Cumulative standings */}
              <div className="md:col-span-7 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                <h4 className="font-extrabold text-slate-200 flex items-center gap-2 text-sm uppercase tracking-wider">
                  🏆 Cumulative Scoreboard
                </h4>

                <div className="space-y-2">
                  {getLeaderboard().map((p, idx) => (
                    <div 
                      key={p.id} 
                      className={`flex items-center justify-between p-3 rounded-2xl border ${
                        idx === 0 
                          ? 'bg-gradient-to-r from-amber-950/10 to-slate-950/80 border-amber-900/30' 
                          : 'bg-slate-950/40 border-slate-850'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs bg-slate-950 border border-slate-800">
                          {idx === 0 ? '👑' : idx + 1}
                        </div>
                        <span className="text-xl">{p.avatar}</span>
                        <div>
                          <span className="font-bold text-slate-200 text-sm">{p.name}</span>
                          {idx === 0 && <span className="text-[10px] text-amber-500 font-bold ml-2 uppercase">Leader</span>}
                        </div>
                      </div>
                      <span className="font-bold font-mono text-indigo-400 text-sm">{p.score} pts</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Next step controls card */}
              <div className="md:col-span-5 bg-slate-900 border border-slate-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                <h4 className="font-bold text-slate-200 text-sm uppercase tracking-wider">Next Step</h4>
                
                {room.currentRound >= room.config.totalRounds ? (
                  <div className="space-y-4">
                    <p className="text-slate-400 text-xs leading-relaxed">
                      All rounds have completed! Click below to review the final standings and announce the grand winner.
                    </p>
                    {room.hostId === socket?.id ? (
                      <button
                        onClick={handleNextRound}
                        className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm"
                      >
                        Proceed to Final Results <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center text-xs text-slate-400 animate-pulse">
                        ⌛ Waiting for Host to proceed to final standings...
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-slate-400 text-xs leading-relaxed">
                      Only the Host can proceed to the next round. The game will select another playable starting letter and reset inputs.
                    </p>
                    {room.hostId === socket?.id ? (
                      <button
                        onClick={handleNextRound}
                        className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-sm"
                      >
                        Start Round {room.currentRound + 1} <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <div className="p-3 bg-slate-950 border border-slate-800 rounded-2xl text-center text-xs text-slate-400 animate-pulse">
                        ⌛ Waiting for Host to start the next round...
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* ==================================== */}
        {/* 6. GAME OVER / FINAL SCREEN          */}
        {/* ==================================== */}
        {room && room.status === 'FINISHED' && (
          <div className="w-full max-w-3xl bg-slate-950/80 border border-slate-800/80 rounded-[2.5rem] p-6 sm:p-10 shadow-[0_0_50px_rgba(0,0,0,0.6)] text-center space-y-8 my-6 relative overflow-hidden backdrop-blur-xl z-10">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-amber-400 via-pink-500 to-cyan-400 animate-pulse"></div>
            
            <div className="space-y-4 flex flex-col items-center justify-center">
              {/* Custom Medium Stopwatch F/T Brand Logo */}
              <div className="w-24 h-24 rounded-full border border-dashed border-[#ECF9FF]/20 flex items-center justify-center relative shadow-[0_0_20px_rgba(236,249,255,0.02)] bg-[#082751]/40 hover:scale-105 transition duration-300">
                <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-4 h-1.5 bg-[#ECF9FF] rounded-t-sm"></div>
                <div className="flex items-center gap-1 z-10">
                  <div className="w-8 h-8 bg-[#0c1f3c] text-white border border-[#ECF9FF]/30 rounded-xl flex flex-col items-center justify-center shadow-lg relative transform -rotate-12">
                    <span className="font-extrabold text-sm leading-none">F</span>
                  </div>
                  <div className="relative w-3 h-10 flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-8 text-[#ECF9FF]" viewBox="0 0 24 80">
                      <path d="M12 0 L18 30 L14 30 L16 55 L12 80 L8 55 L10 30 L6 30 Z" fill="currentColor" />
                    </svg>
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-[#082751] border border-[#ECF9FF] rounded-full z-20"></div>
                  </div>
                  <div className="w-8 h-8 bg-[#ECF9FF] text-[#082751] border border-white rounded-xl flex flex-col items-center justify-center shadow-lg relative transform rotate-12">
                    <span className="font-extrabold text-sm leading-none">T</span>
                  </div>
                </div>
              </div>
              
              <h2 className="text-4xl sm:text-5xl font-black tracking-tighter bg-gradient-to-r from-amber-300 via-fuchsia-400 to-cyan-300 bg-clip-text text-transparent select-none">
                THE SHOWDOWN IS OVER!
              </h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto">After a thrilling, hard-fought battle of vocabulary and speed, the scores are locked in!</p>
            </div>

            {/* Premium 3D Standings Podium Block */}
            <div className="py-6 flex items-end justify-center gap-3 sm:gap-6 max-w-lg mx-auto select-none">
              
              {/* 2nd Place Podium */}
              {getLeaderboard()[1] && (
                <div className="flex flex-col items-center flex-1">
                  <span className="text-2xl mb-1">{getLeaderboard()[1].avatar}</span>
                  <div className="font-extrabold text-slate-300 text-xs sm:text-sm truncate w-20 sm:w-24 text-center">{getLeaderboard()[1].name}</div>
                  <div className="font-bold text-slate-400 text-xs mt-0.5">{getLeaderboard()[1].score} pts</div>
                  <div className="w-full mt-3 h-20 bg-slate-800/40 border-t-4 border-slate-400/60 rounded-t-xl flex flex-col items-center justify-center shadow-inner">
                    <span className="text-lg font-black text-slate-400">2nd</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Silver</span>
                  </div>
                </div>
              )}

              {/* 1st Place Podium (Tallest, Centered) */}
              {getLeaderboard()[0] && (
                <div className="flex flex-col items-center flex-1 transform -translate-y-4">
                  <div className="relative">
                    <span className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-2xl animate-pulse">👑</span>
                    <span className="text-4xl mb-1 block">{getLeaderboard()[0].avatar}</span>
                  </div>
                  <div className="font-black text-white text-sm sm:text-base truncate w-24 sm:w-28 text-center">{getLeaderboard()[0].name}</div>
                  <div className="font-black text-amber-400 text-sm mt-0.5">{getLeaderboard()[0].score} pts</div>
                  <div className="w-full mt-3 h-28 bg-amber-950/20 border-t-4 border-amber-400 rounded-t-xl flex flex-col items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.15)]">
                    <span className="text-2xl font-black text-amber-400">1st</span>
                    <span className="text-[10px] text-amber-500/80 font-black uppercase tracking-widest">Champion</span>
                  </div>
                </div>
              )}

              {/* 3rd Place Podium */}
              {getLeaderboard()[2] && (
                <div className="flex flex-col items-center flex-1">
                  <span className="text-2xl mb-1">{getLeaderboard()[2].avatar}</span>
                  <div className="font-extrabold text-slate-350 text-xs sm:text-sm truncate w-20 sm:w-24 text-center">{getLeaderboard()[2].name}</div>
                  <div className="font-bold text-slate-400 text-xs mt-0.5">{getLeaderboard()[2].score} pts</div>
                  <div className="w-full mt-3 h-14 bg-amber-900/10 border-t-4 border-amber-700 rounded-t-xl flex flex-col items-center justify-center shadow-inner">
                    <span className="text-sm font-black text-amber-700">3rd</span>
                    <span className="text-[9px] text-amber-700/80 font-bold uppercase tracking-widest">Bronze</span>
                  </div>
                </div>
              )}

            </div>

            {/* Standing Details of remaining players */}
            {getLeaderboard().length > 3 && (
              <div className="space-y-2 max-w-md mx-auto pt-2 bg-slate-900/20 border border-slate-900 p-4 rounded-2xl">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block pb-1 text-left">Runner ups</span>
                {getLeaderboard().slice(3).map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between p-2.5 bg-slate-950/40 border border-slate-900 rounded-xl">
                    <div className="flex items-center gap-3">
                      <span className="font-extrabold font-mono text-slate-650 text-xs">#{idx + 4}</span>
                      <span className="text-lg">{p.avatar}</span>
                      <span className="font-bold text-slate-300 text-xs">{p.name}</span>
                    </div>
                    <span className="font-bold font-mono text-indigo-400 text-xs">{p.score} pts</span>
                  </div>
                ))}
              </div>
            )}

            {/* Custom Interactive Rematch Buttons */}
            <div className="pt-6 border-t border-slate-800/60 max-w-md mx-auto flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={handleLeaveRoom}
                className="w-full py-3 bg-slate-900 hover:bg-slate-850 text-slate-300 font-extrabold border-b-4 border-slate-950 hover:border-b-2 active:border-b-0 hover:translate-y-[2px] active:translate-y-[4px] rounded-xl transition-all duration-150 text-xs uppercase tracking-widest flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" /> Exit Room
              </button>

              {room.hostId === socket?.id ? (
                <button
                  onClick={handlePlayAgain}
                  className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-extrabold border-b-4 border-indigo-800 hover:border-b-2 active:border-b-0 hover:translate-y-[2px] active:translate-y-[4px] rounded-xl shadow-lg transition-all duration-150 text-xs uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Rematch / Play Again
                </button>
              ) : (
                <div className="w-full p-3 bg-slate-900/60 border border-slate-850 rounded-xl text-center text-xs text-slate-500 animate-pulse font-bold uppercase tracking-widest">
                  ⌛ Waiting for host to rematch...
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer copyright */}
      <footer className="py-6 border-t border-slate-900 bg-slate-950/40 text-center relative z-10 text-xs text-slate-600 font-medium">
        © 2026 Free Time Game. Built and designed by DeviManoj.
      </footer>

      {/* ==================================== */}
      {/* 7. HOW TO PLAY INSTRUCTIONS MODAL   */}
      {/* ==================================== */}
      {showHowToPlay && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-5 relative">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="font-extrabold text-slate-200 text-lg flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-indigo-400" /> Game Manual & Rules
              </h3>
              <button 
                onClick={() => { setShowHowToPlay(false); playSound('pop'); }}
                className="text-slate-500 hover:text-slate-300 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 text-xs sm:text-sm text-slate-400 leading-relaxed overflow-y-auto max-h-[360px] pr-1">
              <p>
                “Free Time” is a fast-paced multiplayer word association challenge. Test your vocabulary speed against friends!
              </p>
              
              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold font-mono text-[10px]">1</span>
                  Starting Letters
                </h4>
                <p className="pl-6">
                  Every round, the server randomly picks one starting alphabet letter (e.g. <span className="font-bold text-slate-300">"S"</span>).
                </p>
              </div>

              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold font-mono text-[10px]">2</span>
                  Answer Categories
                </h4>
                <p className="pl-6">
                  Each player must enter words starting with that letter for the active categories (e.g. Name: <span className="italic text-slate-300">Sneha</span>, Place: <span className="italic text-slate-300">Seoul</span>, Thing: <span className="italic text-slate-300">Spoon</span>).
                </p>
              </div>

              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold font-mono text-[10px]">3</span>
                  Score Allocations
                </h4>
                <p className="pl-6 space-y-1">
                  <span>After answers submit, they are vetted by high-speed server AI rules:</span>
                  <span className="block mt-1 font-semibold text-emerald-400">🟢 Unique Answer → 10 points</span>
                  <span className="block font-semibold text-amber-400">🟡 Repeated Answer (Multiple players gave same word) → 5 points</span>
                  <span className="block font-semibold text-red-400">🔴 Invalid Answer / Empty → 0 points</span>
                </p>
              </div>

              <div className="space-y-2.5">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold font-mono text-[10px]">4</span>
                  Winning
                </h4>
                <p className="pl-6">
                  The player with the most total accumulated scoreboard points after all rounds are finished wins the game!
                </p>
              </div>
            </div>

            <button
              onClick={() => { setShowHowToPlay(false); playSound('pop'); }}
              className="w-full py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-300 font-bold rounded-xl transition text-xs"
            >
              Let's Play!
            </button>
          </div>
        </div>
      )}

      {/* ==================================== */}
      {/* 8. ROOM SETTINGS CUSTOMIZER (MODAL)  */}
      {/* ==================================== */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800">
              <h3 className="font-extrabold text-slate-200 text-lg flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" /> Customize Room Settings
              </h3>
              <button 
                onClick={() => { setShowSettingsModal(false); playSound('pop'); }}
                className="text-slate-500 hover:text-slate-300 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 text-xs sm:text-sm">
              {/* Difficulty Selector */}
              <div className="space-y-1.5">
                <label className="block text-slate-400 font-bold uppercase text-[10px] tracking-wider">Alphabet Letters Difficulty</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['EASY', 'NORMAL', 'HARD'] as const).map((diff) => (
                    <button
                      key={diff}
                      onClick={() => { setEditDifficulty(diff); playSound('pop'); }}
                      className={`py-2 px-3 rounded-xl font-bold border transition ${
                        editDifficulty === diff 
                          ? 'bg-indigo-600 border-indigo-400 text-white' 
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500">
                  {editDifficulty === 'EASY' && '🍀 Common letters with many answers: A, B, C, D, E, S, T, etc.'}
                  {editDifficulty === 'NORMAL' && '⚙️ Standard balanced letters.'}
                  {editDifficulty === 'HARD' && '🔥 Includes all letters including challenging ones (Q, U, Y, Z, etc.).'}
                </p>
              </div>

              {/* Total Rounds and timer inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="block text-slate-400 font-bold uppercase text-[10px] tracking-wider">Number of Rounds</label>
                  <select
                    value={editRounds}
                    onChange={(e) => setEditRounds(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 p-2.5 rounded-xl font-bold"
                  >
                    <option value={3}>3 Rounds</option>
                    <option value={5}>5 Rounds</option>
                    <option value={10}>10 Rounds</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-slate-400 font-bold uppercase text-[10px] tracking-wider">Round Timer</label>
                  <select
                    value={editTimer}
                    onChange={(e) => setEditTimer(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 text-slate-200 p-2.5 rounded-xl font-bold"
                  >
                    <option value={15}>15 Seconds (Quick)</option>
                    <option value={30}>30 Seconds (Classic)</option>
                    <option value={60}>60 Seconds (Relaxed)</option>
                  </select>
                </div>
              </div>

              {/* Categories customization */}
              <div className="space-y-2">
                <label className="block text-slate-400 font-bold uppercase text-[10px] tracking-wider">Categories List</label>
                
                <div className="flex flex-wrap gap-1.5 max-h-[110px] overflow-y-auto border border-slate-800 p-2 rounded-xl bg-slate-950/50">
                  {editCategories.map((cat, idx) => (
                    <span 
                      key={idx} 
                      className="bg-slate-900 border border-slate-800 text-xs px-2.5 py-1.5 rounded-lg text-slate-300 font-bold flex items-center gap-1.5"
                    >
                      {cat}
                      <button
                        onClick={() => {
                          setEditCategories(prev => prev.filter((_, i) => i !== idx));
                          playSound('pop');
                        }}
                        className="text-red-500 hover:text-red-400 font-extrabold text-[10px]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {editCategories.length === 0 && (
                    <span className="text-slate-500 italic text-xs py-1">No categories selected. Add some below!</span>
                  )}
                </div>

                {/* Add category input bar */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="E.g. Food, Movie, Brand, Superhero..."
                    value={newCategoryInput}
                    onChange={(e) => setNewCategoryInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-100 outline-none focus:border-indigo-500"
                  />
                  <button
                    onClick={() => {
                      const trimmed = newCategoryInput.trim();
                      if (trimmed && !editCategories.includes(trimmed)) {
                        setEditCategories(prev => [...prev, trimmed]);
                        setNewCategoryInput('');
                        playSound('pop');
                      }
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-xl text-xs transition"
                  >
                    Add
                  </button>
                </div>
              </div>

            </div>

            {/* Customizer actions */}
            <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowSettingsModal(false); playSound('pop'); }}
                className="px-4 py-2 bg-slate-950 border border-slate-800 text-slate-400 hover:text-slate-300 rounded-xl transition text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSettings}
                disabled={editCategories.length === 0}
                className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 disabled:from-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl shadow-lg transition text-xs"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
