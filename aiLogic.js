import {
  WHITE, BLACK, WHITE_KING, BLACK_KING, EMPTY,
  allMoves, applyMove, simpleMoves, captures
} from './gameLogic.js';

const MAX_DEPTH = 8;

function getMoveStart(move) {
  return Array.isArray(move[0]) ? move[0][0] : move[0];
}

function getMoveEnd(move) {
  return Array.isArray(move[0]) ? move[move.length - 1][1] : move[1];
}

function isKingMove(board, move) {
  const start = getMoveStart(move);
  return board[start] === WHITE_KING || board[start] === BLACK_KING;
}

function captureLength(move) {
  return Array.isArray(move[0]) ? move.length : 0;
}

function rowOf(pos) {
  return Math.floor((pos - 1) / 5);
}

// ============================
// STRATEGIC EVALUATION
// ============================
//
// This game's win condition is: move your King.
// So the evaluation must:
// 1. Heavily reward having BLACK_KING mobility (AI can win)
// 2. Heavily punish WHITE_KING mobility (player can win)
// 3. Reward pieces that are clearing the path for BLACK_KING's neighbors
// 4. Reward piece count and advancement

function getKingNeighborSquares(board, kingPiece) {
  let kingPos = null;
  for (let i = 1; i <= 50; i++) {
    if (board[i] === kingPiece) { kingPos = i; break; }
  }
  return kingPos;
}

function evaluate(board) {
  let score = 0;
  let whitePieces = 0;
  let blackPieces = 0;
  let whiteKingPos = null;
  let blackKingPos = null;

  for (let i = 1; i <= 50; i++) {
    const p = board[i];
    if (p === WHITE) {
      whitePieces++;
      // Bonus for white pieces closer to top (advancing toward black)
      // Penalty from AI perspective
      score -= (1 + (9 - rowOf(i)) * 0.05);
    } else if (p === BLACK) {
      blackPieces++;
      // Bonus for black pieces closer to bottom (advancing toward white)
      score += (1 + rowOf(i) * 0.05);
    } else if (p === WHITE_KING) {
      whiteKingPos = i;
    } else if (p === BLACK_KING) {
      blackKingPos = i;
    }
  }

  // Piece count advantage
  score += (blackPieces - whitePieces) * 0.3;

  // =======================
  // BLACK KING MOBILITY (AI wins by moving its king)
  // =======================
  if (blackKingPos !== null) {
    const bkSimple = simpleMoves(board, blackKingPos);
    const bkCaps = captures(board, blackKingPos, BLACK_KING, new Set());
    const bkMobility = bkSimple.length + bkCaps.length;

    // If AI king can move, this is nearly a win (AI moves it → wins)
    // Weight very heavily
    score += bkMobility * 40;

    // Even one empty neighbor square is a big deal
    // (means the king is ONE move from winning if it's AI's turn)
  } else {
    // Black King was captured — massive penalty
    score -= 200;
  }

  // =======================
  // WHITE KING MOBILITY (must keep player's king locked)
  // =======================
  if (whiteKingPos !== null) {
    const wkSimple = simpleMoves(board, whiteKingPos);
    const wkCaps = captures(board, whiteKingPos, WHITE_KING, new Set());
    const wkMobility = wkSimple.length + wkCaps.length;

    // If player's king can move, this is nearly a loss for AI
    score -= wkMobility * 40;
  } else {
    // White King captured — big bonus for AI
    score += 200;
  }

  // =======================
  // TACTICAL: Pieces near Black King's escape squares
  // Black King at 48 (odd row 9) can escape to 42 or 43.
  // Reward black pieces that can threaten/capture pieces on 42/43.
  // Penalize white pieces sitting on 42 or 43 (they block black king).
  // =======================
  if (blackKingPos !== null) {
    // The neighbors of blackKingPos are potential escape squares
    // If they're occupied by White, the black king is locked
    // Reward black pieces that can attack those squares
    const escapeSquares = [42, 43]; // neighbors of pos 48
    for (const sq of escapeSquares) {
      if (board[sq] === WHITE || board[sq] === WHITE_KING) {
        score -= 3; // white is blocking an escape square
      } else if (board[sq] === EMPTY) {
        score += 8; // escape square is open!
      }
    }
  }

  // White King at 3 (even row 0) can escape to 8 or 9.
  // Penalize those being empty (player can win), reward blocking them.
  if (whiteKingPos !== null) {
    const whiteEscapes = [8, 9]; // neighbors of pos 3
    for (const sq of whiteEscapes) {
      if (board[sq] === BLACK || board[sq] === BLACK_KING) {
        score += 3; // black is blocking white king escape
      } else if (board[sq] === EMPTY) {
        score -= 8; // white king escape square is open!
      }
    }
  }

  return score;
}

// ============================
// MOVE ORDERING
// ============================
// Best order: king-win moves → multi-captures → captures → advances toward escape
function orderMoves(board, moves, maximizing) {
  return moves.slice().sort((a, b) => {
    const aKing = isKingMove(board, a) ? 10000 : 0;
    const bKing = isKingMove(board, b) ? 10000 : 0;
    if (aKing !== bKing) return bKing - aKing;

    const aCap = captureLength(a) * 100;
    const bCap = captureLength(b) * 100;
    if (aCap !== bCap) return bCap - aCap;

    // Prefer moves that advance toward opponent's king territory
    const aEnd = getMoveEnd(a);
    const bEnd = getMoveEnd(b);
    if (maximizing) {
      // Black advances downward (higher row number)
      return rowOf(bEnd) - rowOf(aEnd);
    } else {
      // White advances upward (lower row number)
      return rowOf(aEnd) - rowOf(bEnd);
    }
  });
}

// ============================
// TRANSPOSITION TABLE
// ============================
const transpositionTable = new Map();
const TT_MAX_SIZE = 500000;

function boardKey(board, depth, maximizing) {
  return board.slice(1).join('') + depth + (maximizing ? '1' : '0');
}

// ============================
// MINIMAX WITH ALPHA-BETA PRUNING
// ============================
function minimax(board, depth, alpha, beta, maximizing) {
  const key = boardKey(board, depth, maximizing);
  const cached = transpositionTable.get(key);
  if (cached !== undefined) return cached;

  const player = maximizing ? BLACK : WHITE;
  const rawMoves = allMoves(board, player);
  const moves = orderMoves(board, rawMoves, maximizing);

  // Immediate king-move is a terminal win
  for (const move of moves) {
    if (isKingMove(board, move)) {
      const val = maximizing ? 999999 : -999999;
      if (transpositionTable.size < TT_MAX_SIZE) transpositionTable.set(key, val);
      return val;
    }
  }

  if (depth === 0 || moves.length === 0) {
    const val = evaluate(board);
    if (transpositionTable.size < TT_MAX_SIZE) transpositionTable.set(key, val);
    return val;
  }

  if (maximizing) {
    let maxScore = -Infinity;
    for (const move of moves) {
      const newBoard = applyMove(board, move);
      const score = minimax(newBoard, depth - 1, alpha, beta, false);
      if (score > maxScore) maxScore = score;
      if (score > alpha) alpha = score;
      if (beta <= alpha) break;
    }
    if (transpositionTable.size < TT_MAX_SIZE) transpositionTable.set(key, maxScore);
    return maxScore;
  } else {
    let minScore = Infinity;
    for (const move of moves) {
      const newBoard = applyMove(board, move);
      const score = minimax(newBoard, depth - 1, alpha, beta, true);
      if (score < minScore) minScore = score;
      if (score < beta) beta = score;
      if (beta <= alpha) break;
    }
    if (transpositionTable.size < TT_MAX_SIZE) transpositionTable.set(key, minScore);
    return minScore;
  }
}

// ============================
// PUBLIC: GET BEST MOVE
// ============================
export function getBestMove(board, depth = MAX_DEPTH) {
  transpositionTable.clear();

  const moves = allMoves(board, BLACK);
  if (moves.length === 0) return null;

  for (const move of moves) {
    if (isKingMove(board, move)) return move;
  }

  const ordered = orderMoves(board, moves, true);
  let bestMove = ordered[0];
  let bestScore = -Infinity;

  for (const move of ordered) {
    const newBoard = applyMove(board, move);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return bestMove;
}

// Returns best move + score for White (minimising player)
function getBestWhiteMove(board) {
  const moves = allMoves(board, WHITE);
  if (moves.length === 0) return { move: null, score: Infinity };

  for (const move of moves) {
    if (isKingMove(board, move)) return { move, score: -999999 };
  }

  const ordered = orderMoves(board, moves, false);
  let bestMove = ordered[0];
  let bestScore = Infinity;

  for (const move of ordered) {
    const newBoard = applyMove(board, move);
    const score = minimax(newBoard, MAX_DEPTH - 1, -Infinity, Infinity, true);
    if (score < bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  return { move: bestMove, score: bestScore };
}

export { evaluate };

export function analyzePosition(board) {
  transpositionTable.clear();

  // Score from Black's perspective after best play from both sides
  // Black moves first from the starting position? No — White (player) goes first.
  // So we evaluate as if it's White's turn: minimizing player moves first.
  const { move: whiteBest, score: scoreAfterWhite } = getBestWhiteMove(board);

  // Now also get Black's best reply
  transpositionTable.clear();
  const blackBestMove = getBestMove(board);

  // Raw static eval of the starting position
  const staticScore = evaluate(board);

  // Score after White plays best — from Black's perspective
  // Positive = Black advantage, Negative = White advantage
  const positionScore = scoreAfterWhite;

  let verdict;
  let advantageFor;
  if (Math.abs(positionScore) < 15) {
    verdict = 'De beginstand is nagenoeg gelijk.';
    advantageFor = 'equal';
  } else if (positionScore > 0) {
    verdict = `Zwart (AI) heeft een voordeel (score: ${positionScore.toFixed(1)}).`;
    advantageFor = 'black';
  } else {
    verdict = `Wit (jij) heeft een voordeel (score: ${Math.abs(positionScore).toFixed(1)}).`;
    advantageFor = 'white';
  }

  return {
    verdict,
    advantageFor,
    score: positionScore,
    staticScore,
    whiteBestFirst: whiteBest ? formatMove(whiteBest) : '—',
    blackBestFirst: blackBestMove ? formatMove(blackBestMove) : '—',
    depth: MAX_DEPTH,
  };
}

export function formatMove(move) {
  if (Array.isArray(move[0])) {
    const start = move[0][0];
    const end = move[move.length - 1][1];
    return `${start}x${end}`;
  }
  return `${move[0]}-${move[1]}`;
}
