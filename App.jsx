import React, { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import {
  EMPTY, WHITE, BLACK, WHITE_KING, BLACK_KING,
  createBoard, allMoves, applyMove, getWinner
} from './gameLogic.js';
import { getBestMove, formatMove, evaluate } from './aiLogic.js';
import './App.css';

function scoreToPct(score) {
  const clamped = Math.max(-150, Math.min(150, score));
  return 50 - (clamped / 150) * 45;
}

const DIFFICULTY_DEPTHS = [1, 2, 3, 4, 5, 7, 9, 20];
const DIFFICULTY_LABELS = ['Makkelijkst', 'Heel makkelijk', 'Makkelijk', 'Gemiddeld', 'Uitdagend', 'Moeilijk', 'Heel moeilijk', 'Perfect'];

function freshBoard() { return createBoard(); }

function cloneSnapshot(snapshot) {
  return {
    board: snapshot.board.slice(),
    turn: snapshot.turn,
    winner: snapshot.winner,
    moves: snapshot.moves,
    history: snapshot.history.map(entry => ({ ...entry })),
    evalScore: snapshot.evalScore,
    selected: snapshot.selected,
    validDests: [...snapshot.validDests],
    aiThinking: snapshot.aiThinking,
    opponentLeft: snapshot.opponentLeft,
  };
}

function makeSnapshot(state) {
  return {
    board: state.board,
    turn: state.turn,
    winner: state.winner,
    moves: state.moves,
    history: state.history,
    evalScore: state.evalScore,
    selected: state.selected,
    validDests: state.validDests,
    aiThinking: state.aiThinking,
    opponentLeft: state.opponentLeft,
  };
}

export default function App() {
  const [board, setBoard] = useState(freshBoard);
  const [selected, setSelected] = useState(null);
  const [turn, setTurn] = useState(WHITE);
  const [winner, setWinner] = useState(null);
  const [validDests, setValidDests] = useState([]);
  const [moves, setMoves] = useState(() => allMoves(freshBoard(), WHITE));
  const [history, setHistory] = useState([]);
  const [aiThinking, setAiThinking] = useState(false);
  const [evalScore, setEvalScore] = useState(() => evaluate(freshBoard()));
  const [difficulty, setDifficulty] = useState(4);

  const [appMode, setAppMode] = useState(null);
  const [myColor, setMyColor] = useState(null);
  const [lobbyPhase, setLobbyPhase] = useState('menu');
  const [roomCode, setRoomCode] = useState('');
  const [joinInput, setJoinInput] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [opponentLeft, setOpponentLeft] = useState(false);

  const [pendingRequest, setPendingRequest] = useState(null);
  const [approvalPrompt, setApprovalPrompt] = useState(null);
  const [snackbar, setSnackbar] = useState('');
  const [snapshots, setSnapshots] = useState([]);
  const [pendingUndoSnapshot, setPendingUndoSnapshot] = useState(null);

  const boardRef = useRef(board);
  const myColorRef = useRef(myColor);
  const socketRef = useRef(null);
  const historyListRef = useRef(null);
  const pendingRequestRef = useRef(null);
  const approvalPromptRef = useRef(null);
  const snapshotsRef = useRef(snapshots);

  useEffect(() => { boardRef.current = board; }, [board]);
  useEffect(() => { myColorRef.current = myColor; }, [myColor]);
  useEffect(() => { snapshotsRef.current = snapshots; }, [snapshots]);
  useEffect(() => { pendingRequestRef.current = pendingRequest; }, [pendingRequest]);
  useEffect(() => { approvalPromptRef.current = approvalPrompt; }, [approvalPrompt]);

  useEffect(() => {
    if (historyListRef.current) historyListRef.current.scrollTop = historyListRef.current.scrollHeight;
  }, [history]);

  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(''), 2500);
    return () => clearTimeout(timer);
  }, [snackbar]);

  useEffect(() => {
    if (appMode !== 'ai') return;
    if (turn !== BLACK || winner || pendingRequest) return;
    setAiThinking(true);
    const timer = setTimeout(() => {
      const depth = DIFFICULTY_DEPTHS[difficulty];
      const bestMove = getBestMove(board, depth);
      if (!bestMove) { setWinner(WHITE); setAiThinking(false); return; }
      applyLocalMove(bestMove, BLACK, true);
      setAiThinking(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [turn, winner, board, appMode, difficulty, pendingRequest]);

  useEffect(() => {
    if (appMode !== 'online') return;

    const sock = io();
    socketRef.current = sock;

    sock.on('room-created', ({ code }) => {
      setRoomCode(code);
      setMyColor('white');
      myColorRef.current = 'white';
      setLobbyPhase('waiting');
    });

    sock.on('room-joined', ({ code }) => {
      setRoomCode(code);
      setMyColor('black');
      myColorRef.current = 'black';
    });

    sock.on('game-start', () => {
      const b = freshBoard();
      setBoard(b);
      boardRef.current = b;
      setTurn(WHITE);
      setMoves(allMoves(b, WHITE));
      setHistory([]);
      setWinner(null);
      setEvalScore(evaluate(b));
      setSelected(null);
      setValidDests([]);
      setSnapshots([]);
      setPendingRequest(null);
      setApprovalPrompt(null);
      setPendingUndoSnapshot(null);
      setOpponentLeft(false);
      setLobbyPhase('playing');
    });

    sock.on('room-error', (msg) => setLobbyError(msg));

    sock.on('request-action', (data) => {
      setApprovalPrompt(data);
      if (data.type === 'undo') setPendingUndoSnapshot(data.snapshot || null);
    });

    sock.on('action-response', (data) => {
      setPendingRequest(null);
      setApprovalPrompt(null);
      if (data.type === 'undo' && data.accepted) {
        if (data.snapshot) restoreSnapshot(data.snapshot);
        setSnapshots(s => s.slice(0, -1));
        setSnackbar('Terugzetten uitgevoerd');
      }
      if (data.type === 'draw' && data.accepted) {
        setWinner('draw');
        setSnackbar('Gelijkspel bevestigd');
      }
      if (data.type === 'resign' && data.accepted) {
        setWinner(data.winner);
      }
    });

    sock.on('opponent-move', (rawMove) => {
      const b = boardRef.current;
      const mc = myColorRef.current;
      const opponentConst = mc === 'white' ? BLACK : WHITE;
      const myConst = mc === 'white' ? WHITE : BLACK;
      const moveStart = Array.isArray(rawMove[0]) ? rawMove[0][0] : rawMove[0];
      const movingPiece = b[moveStart];
      const kingMoved = movingPiece === WHITE_KING || movingPiece === BLACK_KING;
      const newBoard = applyMove(b, rawMove);
      pushSnapshot();
      setBoard(newBoard);
      boardRef.current = newBoard;
      setEvalScore(evaluate(newBoard));
      setHistory(h => [...h, { player: opponentConst, move: formatMove(rawMove), isKing: kingMoved }]);
      if (kingMoved) { setWinner(opponentConst); return; }
      const nextMoves = allMoves(newBoard, myConst);
      setTurn(myConst);
      setMoves(nextMoves);
      const w = getWinner(newBoard);
      if (w) setWinner(w);
    });

    sock.on('opponent-left', () => setOpponentLeft(true));

    return () => { sock.disconnect(); socketRef.current = null; };
  }, [appMode]);

  const myColorConst = myColor === 'white' ? WHITE : BLACK;

  function pushSnapshot() {
    setSnapshots(s => [...s, makeSnapshot({ board, turn, winner, moves, history, evalScore, selected, validDests, aiThinking, opponentLeft })]);
  }

  function restoreSnapshot(snapshot) {
    const snap = cloneSnapshot(snapshot);
    setBoard(snap.board);
    boardRef.current = snap.board;
    setTurn(snap.turn);
    setWinner(snap.winner);
    setMoves(snap.moves);
    setHistory(snap.history);
    setEvalScore(snap.evalScore);
    setSelected(snap.selected);
    setValidDests(snap.validDests);
    setAiThinking(snap.aiThinking);
    setOpponentLeft(snap.opponentLeft);
  }

  function applyLocalMove(move, player, fromAi = false) {
    const currentBoard = boardRef.current;
    const moveStart = Array.isArray(move[0]) ? move[0][0] : move[0];
    const movingPiece = currentBoard[moveStart];
    const kingMoved = movingPiece === WHITE_KING || movingPiece === BLACK_KING;
    const newBoard = applyMove(currentBoard, move);
    pushSnapshot();
    setBoard(newBoard);
    boardRef.current = newBoard;
    setEvalScore(evaluate(newBoard));
    setHistory(h => [...h, { player, move: formatMove(move), isKing: kingMoved }]);
    setSelected(null);
    setValidDests([]);
    if (kingMoved) {
      setWinner(player);
      return;
    }
    const nextPlayer = player === WHITE ? BLACK : WHITE;
    setTurn(nextPlayer);
    setMoves(allMoves(newBoard, nextPlayer));
    const w = getWinner(newBoard);
    if (w) setWinner(w);
    if (appMode === 'online' && socketRef.current && !fromAi) socketRef.current.emit('move', move);
  }

  const handleClick = useCallback((pos) => {
    if (winner || pendingRequest) return;
    if (appMode === 'ai' && (turn !== WHITE || aiThinking)) return;
    if (appMode === 'online' && turn !== myColorConst) return;
    const piece = board[pos];
    if (selected === null) {
      if (piece === EMPTY || piece.toLowerCase() !== turn) return;
      const pieceMoves = moves.filter(m => (Array.isArray(m[0]) ? m[0][0] : m[0]) === pos);
      if (pieceMoves.length === 0) return;
      setSelected(pos);
      setValidDests(pieceMoves.map(m => Array.isArray(m[0]) ? m[m.length - 1][1] : m[1]));
      return;
    }
    if (selected === pos) { setSelected(null); setValidDests([]); return; }
    if (piece !== EMPTY && piece.toLowerCase() === turn) {
      const pieceMoves = moves.filter(m => (Array.isArray(m[0]) ? m[0][0] : m[0]) === pos);
      if (pieceMoves.length > 0) {
        setSelected(pos);
        setValidDests(pieceMoves.map(m => Array.isArray(m[0]) ? m[m.length - 1][1] : m[1]));
        return;
      }
    }
    const matchingMove = moves.find(m => {
      const start = Array.isArray(m[0]) ? m[0][0] : m[0];
      const end = Array.isArray(m[0]) ? m[m.length - 1][1] : m[1];
      return start === selected && end === pos;
    });
    if (!matchingMove) { setSelected(null); setValidDests([]); return; }
    applyLocalMove(matchingMove, turn);
  }, [board, selected, turn, moves, winner, aiThinking, appMode, myColorConst, pendingRequest]);

  const resetGame = () => {
    const b = freshBoard();
    setBoard(b);
    boardRef.current = b;
    setSelected(null);
    setTurn(WHITE);
    setWinner(null);
    setValidDests([]);
    setMoves(allMoves(b, WHITE));
    setHistory([]);
    setAiThinking(false);
    setEvalScore(evaluate(b));
    setOpponentLeft(false);
    setSnapshots([]);
    setPendingRequest(null);
    setApprovalPrompt(null);
  };

  const startAiMode = () => { resetGame(); setAppMode('ai'); };
  const startLocalMode = () => { resetGame(); setAppMode('local'); };
  const startOnlineMode = () => { resetGame(); setAppMode('online'); setLobbyPhase('menu'); setMyColor(null); setRoomCode(''); setJoinInput(''); setLobbyError(''); };
  const leaveGame = () => { if (socketRef.current) socketRef.current.disconnect(); setAppMode(null); setLobbyPhase('menu'); setMyColor(null); setRoomCode(''); setJoinInput(''); setLobbyError(''); resetGame(); };
  const createRoom = () => { if (socketRef.current) socketRef.current.emit('create-room'); };
  const joinRoom = () => { if (socketRef.current && joinInput.trim()) { setLobbyError(''); socketRef.current.emit('join-room', joinInput.trim().toUpperCase()); } };

  const requestUndo = () => {
    if (appMode === 'ai') {
      if (snapshots.length === 0 || aiThinking) return;
      const last = snapshots[snapshots.length - 1];
      restoreSnapshot(last);
      setSnapshots(s => s.slice(0, -1));
      return;
    }
    if (!socketRef.current || pendingRequest) return;
    setPendingRequest({ type: 'undo' });
    socketRef.current.emit('request-action', { type: 'undo', roomCode, snapshot: snapshots[snapshots.length - 1] || null });
  };

  const requestDraw = () => {
    if (appMode !== 'online' || !socketRef.current || pendingRequest || winner) return;
    setPendingRequest({ type: 'draw' });
    socketRef.current.emit('request-action', { type: 'draw', roomCode });
  };

  const requestResign = () => {
    if (appMode === 'online') {
      if (!socketRef.current || winner) return;
      socketRef.current.emit('request-action', { type: 'resign', roomCode });
      setWinner(myColorConst === WHITE ? BLACK : WHITE);
      setSnackbar('Je hebt opgegeven');
      return;
    }
    if (appMode === 'ai' && !winner) {
      setWinner(BLACK);
      setSnackbar('Je hebt opgegeven');
    }
  };

  const respondApproval = (accepted) => {
    if (!socketRef.current || !approvalPrompt) return;
    socketRef.current.emit('action-response', { ...approvalPrompt, accepted });
    if (approvalPrompt.type === 'draw' && accepted) setWinner('draw');
    if (approvalPrompt.type === 'resign' && accepted) setWinner(approvalPrompt.from === 'white' ? BLACK : WHITE);
    if (approvalPrompt.type === 'undo' && accepted && pendingUndoSnapshot) {
      restoreSnapshot(pendingUndoSnapshot);
      setSnapshots(s => s.slice(0, -1));
    }
    setApprovalPrompt(null);
    setPendingUndoSnapshot(null);
  };

  const validDestsSet = new Set(validDests);
  const dividerPct = scoreToPct(evalScore);
  const cells = [];
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const isDark = (row + col) % 2 === 1;
      let playPos = null;
      if (isDark) {
        if (row % 2 === 0 && col % 2 === 0) playPos = null;
        else if (row % 2 === 1 && col % 2 === 1) playPos = null;
        else playPos = row * 5 + Math.floor(col / 2) + 1;
      }
      cells.push({ row, col, isDark, playPos });
    }
  }

  const winnerLabel = winner === WHITE ? 'Wit wint! 🎉' : winner === BLACK ? 'Zwart wint!' : 'Gelijkspel!';
  const isMyTurnOnline = appMode === 'online' && turn === myColorConst;
  const turnText = winner ? winnerLabel : appMode === 'online' && lobbyPhase === 'playing' ? isMyTurnOnline ? `Jij (${myColor === 'white' ? 'Wit' : 'Zwart'}) aan zet` : 'Wachten op tegenstander...' : appMode === 'ai' && aiThinking ? 'AI denkt...' : turn === WHITE ? appMode === 'online' ? 'Wit aan zet' : 'Jij (Wit) aan zet' : appMode === 'online' ? 'Zwart aan zet' : 'Zwart (AI) aan zet';

  if (appMode === null) {
    return (
      <div className="full-screen-overlay">
        <div className="mode-box">
          <h1 className="title" style={{ textAlign: 'center' }}><span>Bevrijdings</span><span>dammen</span></h1>
          <p className="mode-subtitle">Kies een speelmodus</p>
          <button className="mode-btn" onClick={startAiMode}><span className="mode-btn-icon">🤖</span><span><strong>Tegen de computer</strong><small>Speel alleen tegen de AI</small></span></button>
          <button className="mode-btn mode-btn-local" onClick={startLocalMode}><span className="mode-btn-icon">👥</span><span><strong>Lokale multiplayer</strong><small>Speel met 2 spelers op 1 apparaat</small></span></button>
          <button className="mode-btn mode-btn-online" onClick={startOnlineMode}><span className="mode-btn-icon">🌐</span><span><strong>Online multiplayer</strong><small>Speel tegen een vriend</small></span></button>
        </div>
      </div>
    );
  }

  if (appMode === 'online' && lobbyPhase !== 'playing') {
    return (
      <div className="full-screen-overlay">
        <div className="mode-box">
          <h1 className="title" style={{ textAlign: 'center' }}>Online spelen</h1>
          {lobbyPhase === 'menu' && (<>
            <button className="lobby-big-btn" onClick={createRoom}>Kamer aanmaken</button>
            <div className="lobby-divider">of</div>
            <div className="lobby-join-row">
              <input className="lobby-input" placeholder="Voer kamercode in" value={joinInput} onChange={e => setJoinInput(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && joinRoom()} maxLength={5} />
              <button className="lobby-join-btn" onClick={joinRoom}>Deelnemen</button>
            </div>
            {lobbyError && <div className="lobby-error">{lobbyError}</div>}
            <button className="lobby-back-btn" onClick={leaveGame}>← Terug</button>
          </>)}
          {lobbyPhase === 'waiting' && (<>
            <p className="lobby-waiting-text">Wachten op tegenstander...</p>
            <div className="lobby-code-box"><div className="lobby-code-label">Jouw kamercode</div><div className="lobby-code">{roomCode}</div><div className="lobby-code-hint">Stuur deze code naar je vriend</div></div>
            <div className="lobby-spinner" />
            <button className="lobby-back-btn" onClick={leaveGame}>Annuleren</button>
          </>)}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="sidebar">
        {appMode && <button className="mode-switch-btn mode-top-btn" onClick={leaveGame}>← Mode</button>}
        <h1 className="title">Bevrijdingsdammen</h1>
        {appMode === 'online' && <div className="online-badge">🌐 Online — kamer <strong>{roomCode}</strong><br /><small>Jij bent <strong>{myColor === 'white' ? 'Wit ⬜' : 'Zwart ⬛'}</strong></small></div>}
        <div className="turn-indicator"><div className={`turn-dot ${turn === WHITE ? 'white' : 'black'}`} /><span>{turnText}</span></div>
        <div className="goal-box"><div className="goal-title">Doel</div><p>Beweeg jouw dam (★) om te winnen!</p></div>
        {appMode === 'online' && <button className="mode-switch-btn" onClick={() => { const next = myColor === 'white' ? 'black' : 'white'; setMyColor(next); myColorRef.current = next; setSnackbar('Van kleur gewisseld'); }} disabled={!!winner}>Wissel van kleur</button>}
        <div className="board-actions">
          {appMode === 'ai' && <button className="reset-btn board-action-btn" onClick={requestUndo} disabled={aiThinking || snapshots.length === 0}>Terugzetten</button>}
          {appMode === 'online' && <button className="reset-btn board-action-btn" onClick={requestUndo} disabled={!!pendingRequest}>Terugzetten vragen</button>}
          {appMode === 'online' && <button className="mode-switch-btn board-action-btn" onClick={requestDraw} disabled={!!pendingRequest || !!winner}>Gelijkspel vragen</button>}
          {appMode === 'online' && <button className="mode-switch-btn board-action-btn" onClick={leaveGame}>← mode</button>}
        </div>
        {appMode === 'ai' && (<div className="difficulty-section"><div className="difficulty-label">Moeilijkheidsgraad</div><div className="difficulty-name">{DIFFICULTY_LABELS[difficulty]}</div><div className="difficulty-buttons">{DIFFICULTY_DEPTHS.map((_, i) => (<button key={i} className={`diff-btn${i === difficulty ? ' active' : ''}${i === 7 ? ' diff-max' : ''}`} onClick={() => setDifficulty(i)} title={DIFFICULTY_LABELS[i]}>{i + 1}</button>))}</div></div>)}
        <div className="history-panel"><div className="history-title">Zetten</div><div className="history-list" ref={historyListRef}>{history.length === 0 && <div className="history-empty">Nog geen zetten</div>}{Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => { const white = history[i * 2]; const black = history[i * 2 + 1]; return (<div key={i} className="history-full-move"><span className="history-num">{i + 1}.</span><span className="history-white-move">{white.move}{white.isKing ? <span className="history-king-star"> ★</span> : ''}</span>{black && <span className="history-black-move">{black.move}{black.isKing ? <span className="history-king-star"> ★</span> : ''}</span>}</div>); })}</div></div>
      </div>

      <div className={`board-and-eval ${appMode === 'online' ? 'no-eval-bar' : ''}`}>
        <div className="board-wrapper">
          {(winner || opponentLeft) && <div className="overlay"><div className="overlay-box"><div className="overlay-title">{opponentLeft ? 'Tegenstander heeft de verbinding verbroken' : winnerLabel}</div><button className="reset-btn" onClick={appMode === 'ai' ? resetGame : leaveGame}>{appMode === 'ai' ? 'Nieuw spel' : 'Terug naar menu'}</button></div></div>}
          <div className="board">{(myColor === 'black' ? [...cells].reverse() : cells).map(({ row, col, isDark, playPos }) => {const piece = playPos ? board[playPos] : null; const isSelected = playPos === selected; const isValidDest = playPos && validDestsSet.has(playPos); return (<div key={`${row}-${col}`} className={`cell ${isDark ? 'dark' : 'light'} ${isSelected ? 'selected' : ''} ${isValidDest ? 'valid-dest' : ''}`} onClick={() => playPos && handleClick(playPos)}>{piece && piece !== EMPTY && (<div className={`piece ${getPieceClass(piece)}`}>{isKingPiece(piece) && <span className="crown">♛</span>}</div>)}{isValidDest && !piece && <div className="move-hint" />}{playPos && <span className="pos-label">{playPos}</span>}</div>); })}</div>
        </div>
        {appMode !== 'online' && <div className="eval-bar-wrap"><div className="eval-label eval-label-top">Zwart</div><div className="eval-bar"><div className="eval-bar-black" style={{ height: `${dividerPct}%` }} /><div className="eval-bar-white" style={{ height: `${100 - dividerPct}%` }} /><div className="eval-divider" style={{ top: `${dividerPct}%` }} /></div><div className="eval-label eval-label-bottom">Wit</div><div className="eval-score">{evalScore > 0 ? `+${evalScore.toFixed(0)}` : evalScore.toFixed(0)}</div></div>}
      </div>

      {approvalPrompt && (
        <div className="approval-overlay">
          <div className="approval-box">
            <div className="approval-title">{approvalPrompt.type === 'undo' ? 'Terugzetten verzoek' : approvalPrompt.type === 'draw' ? 'Gelijkspel verzoek' : 'Opgeven verzoek'}</div>
            <div className="approval-text">{approvalPrompt.type === 'undo' ? 'Tegenstander wil de laatste zet terugdraaien.' : approvalPrompt.type === 'draw' ? 'Tegenstander vraagt om een gelijkspel.' : 'Tegenstander wil opgeven.'}</div>
            <div className="approval-actions"><button className="approval-yes" onClick={() => respondApproval(true)}>Accepteren</button><button className="approval-no" onClick={() => respondApproval(false)}>Weigeren</button></div>
          </div>
        </div>
      )}

      {snackbar && <div className="snackbar">{snackbar}</div>}
    </div>
  );
}

function getPieceClass(piece) {
  switch (piece) {
    case WHITE: return 'white-piece';
    case BLACK: return 'black-piece';
    case WHITE_KING: return 'white-king-piece';
    case BLACK_KING: return 'black-king-piece';
    default: return '';
  }
}

function isKingPiece(piece) {
  return piece === WHITE_KING || piece === BLACK_KING;
}
