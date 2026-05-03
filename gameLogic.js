export const EMPTY = '.';
export const WHITE = 'w';
export const BLACK = 'b';
export const WHITE_KING = 'W';
export const BLACK_KING = 'B';

export const TARGET_WHITE = 3;
export const TARGET_BLACK = 48;

export function createBoard() {
  const board = new Array(51).fill(EMPTY);
  for (let i = 1; i <= 20; i++) board[i] = BLACK;
  for (let i = 31; i <= 50; i++) board[i] = WHITE;
  board[TARGET_WHITE] = WHITE_KING;
  board[TARGET_BLACK] = BLACK_KING;
  return board;
}

export function opponent(p) {
  return p.toLowerCase() === WHITE ? BLACK : WHITE;
}

export function isKing(p) {
  return p === WHITE_KING || p === BLACK_KING;
}

export function valid(p) {
  return p >= 1 && p <= 50;
}

export function promote(piece, pos) {
  if (piece === WHITE && pos <= 5) return WHITE_KING;
  if (piece === BLACK && pos >= 46) return BLACK_KING;
  return piece;
}

// =====================
// CORRECT DUTCH DRAUGHTS ADJACENCY
// =====================
//
// The 10x10 board has 50 dark squares numbered 1-50.
// Positions 1-5 are row 0 (top), 6-10 are row 1, etc.
//
// Even rows (0,2,4,6,8): dark squares are in odd columns (1,3,5,7,9)
// Odd rows (1,3,5,7,9): dark squares are in even columns (0,2,4,6,8)
//
// Because of this stagger, the diagonal neighbor offsets differ by row parity:
//
//   Even row piece: up-left=-5, up-right=-4, down-left=+5, down-right=+6
//   Odd row piece:  up-left=-6, up-right=-5, down-left=+4, down-right=+5
//
// A capture jumps over one adjacent piece, so the offsets to the landing square are:
//   Always: -11, -9, +9, +11 (regardless of row parity)

function rowOf(pos) {
  return Math.floor((pos - 1) / 5);
}

function isEvenRow(pos) {
  return rowOf(pos) % 2 === 0;
}

// Returns [[step, jump], ...] for each diagonal direction from pos.
// step  = offset to the adjacent (neighboring) square
// jump  = offset to the landing square for a capture over that neighbor
function getDiagonals(pos) {
  if (isEvenRow(pos)) {
    return [
      [-5, -11],  // up-left
      [-4,  -9],  // up-right
      [ 5,   9],  // down-left
      [ 6,  11],  // down-right
    ];
  } else {
    return [
      [-6, -11],  // up-left
      [-5,  -9],  // up-right
      [ 4,   9],  // down-left
      [ 5,  11],  // down-right
    ];
  }
}

// The neighbor must be exactly one row away (guards against board wrap-around)
function validAdjacent(from, to) {
  return to >= 1 && to <= 50 && Math.abs(rowOf(to) - rowOf(from)) === 1;
}

// The landing square must be exactly two rows away
function validJump(from, to) {
  return to >= 1 && to <= 50 && Math.abs(rowOf(to) - rowOf(from)) === 2;
}

// Compute the mid (captured) square given start and end of a capture.
// Cannot use (s+e)/2 because of the row-stagger.
function getMid(pos, end) {
  const jump = end - pos;
  if (isEvenRow(pos)) {
    if (jump === -11) return pos - 5;
    if (jump ===  -9) return pos - 4;
    if (jump ===   9) return pos + 5;
    if (jump ===  11) return pos + 6;
  } else {
    if (jump === -11) return pos - 6;
    if (jump ===  -9) return pos - 5;
    if (jump ===   9) return pos + 4;
    if (jump ===  11) return pos + 5;
  }
  return null;
}

// =====================
// MOVES
// =====================

export function simpleMoves(board, pos) {
  const piece = board[pos];
  if (piece === EMPTY) return [];

  const king = isKing(piece);
  const moves = [];

  for (const [step] of getDiagonals(pos)) {
    if (!king) {
      if (piece === WHITE && step > 0) continue; // white moves up (negative steps)
      if (piece === BLACK && step < 0) continue; // black moves down (positive steps)
    }
    const to = pos + step;
    if (validAdjacent(pos, to) && board[to] === EMPTY) {
      moves.push([pos, to]);
    }
  }

  return moves;
}

export function captures(board, pos, piece, visited) {
  const results = [];

  for (const [step, jump] of getDiagonals(pos)) {
    const mid = pos + step;
    const end = pos + jump;

    if (
      validAdjacent(pos, mid) &&
      validJump(pos, end) &&
      board[mid] !== EMPTY &&
      board[mid].toLowerCase() === opponent(piece).toLowerCase() &&
      board[end] === EMPTY &&
      !visited.has(mid)
    ) {
      const newBoard = board.slice();
      newBoard[pos] = EMPTY;
      newBoard[mid] = EMPTY;
      newBoard[end] = piece;

      const newVisited = new Set(visited);
      newVisited.add(mid);

      const sub = captures(newBoard, end, piece, newVisited);

      if (sub.length > 0) {
        for (const s of sub) {
          results.push([[pos, end], ...s]);
        }
      } else {
        results.push([[pos, end]]);
      }
    }
  }

  return results;
}

export function allMoves(board, player) {
  const caps = [];
  const norm = [];

  for (let pos = 1; pos <= 50; pos++) {
    const piece = board[pos];
    if (piece === EMPTY || piece.toLowerCase() !== player) continue;

    const c = captures(board, pos, piece, new Set());
    if (c.length > 0) {
      caps.push(...c);
    } else {
      norm.push(...simpleMoves(board, pos));
    }
  }

  if (caps.length > 0) {
    const maxLen = Math.max(...caps.map(m => m.length));
    return caps.filter(m => m.length === maxLen);
  }
  return norm;
}

export function applyMove(board, move) {
  const b = board.slice();

  if (Array.isArray(move[0])) {
    for (const [s, e] of move) {
      const piece = b[s];
      b[s] = EMPTY;
      const mid = getMid(s, e);
      if (mid !== null) b[mid] = EMPTY;
      b[e] = piece;
    }
    const end = move[move.length - 1][1];
    b[end] = promote(b[end], end);
  } else {
    const [s, e] = move;
    const piece = b[s];
    b[s] = EMPTY;
    b[e] = promote(piece, e);
  }

  return b;
}

export function hasAnyMove(board, player) {
  return allMoves(board, player).length > 0;
}

export function getWinner(board) {
  const whiteMoves = allMoves(board, WHITE).length;
  const blackMoves = allMoves(board, BLACK).length;

  if (whiteMoves === 0 && blackMoves === 0) return 'draw';
  if (whiteMoves === 0) return BLACK;
  if (blackMoves === 0) return WHITE;
  return null;
}
