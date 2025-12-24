const PIECES = {
  K: { name: "帥", color: "red", value: 10000 },
  A: { name: "仕", color: "red", value: 180 },
  E: { name: "相", color: "red", value: 180 },
  H: { name: "馬", color: "red", value: 320 },
  R: { name: "車", color: "red", value: 600 },
  C: { name: "炮", color: "red", value: 380 },
  P: { name: "兵", color: "red", value: 100 },
  k: { name: "將", color: "black", value: 10000 },
  a: { name: "士", color: "black", value: 180 },
  e: { name: "象", color: "black", value: 180 },
  h: { name: "馬", color: "black", value: 320 },
  r: { name: "車", color: "black", value: 600 },
  c: { name: "炮", color: "black", value: 380 },
  p: { name: "卒", color: "black", value: 100 },
};

const BOARD_ROWS = 10;
const BOARD_COLS = 9;
const DRAW_REPETITION = 3;

let board = createEmptyBoard();
let sideToMove = "r";
const EMPTY_TOKEN = "_";
let selectedPalette = null;
let selectedFrom = null;
let legalMovesCache = [];
let transpositionTable = new Map();
let killerMoves = [];
let historyHeuristic = { r: [], b: [] };
let zobrist = null;
let currentHash = 0n;
let repetitionTable = new Map();
let repetitionStack = [];

const boardEl = document.getElementById("board");
const pieceLayerEl = document.getElementById("piece-layer");
const markerLayerEl = document.getElementById("marker-layer");
const hitmapEl = document.getElementById("hitmap");
const paletteEl = document.getElementById("palette");
const analysisEl = document.getElementById("analysis");
const progressBarEl = document.getElementById("progress-bar");
const progressTextEl = document.getElementById("progress-text");
const suggestBtn = document.getElementById("suggest");
const depthSelectEl = document.getElementById("depth-select");
const boardCodeEl = document.getElementById("boardcode");

function createEmptyBoard() {
  return Array.from({ length: BOARD_ROWS }, () => Array(BOARD_COLS).fill(null));
}

function rand64() {
  const hi = Math.floor(Math.random() * 0x100000000);
  const lo = Math.floor(Math.random() * 0x100000000);
  return (BigInt(hi) << 32n) | BigInt(lo);
}

function initZobrist() {
  zobrist = { pieces: {}, side: rand64() };
  Object.keys(PIECES).forEach((piece) => {
    zobrist.pieces[piece] = Array.from({ length: BOARD_ROWS }, () =>
      Array.from({ length: BOARD_COLS }, () => rand64())
    );
  });
}

function computeHash(side) {
  let h = 0n;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (piece) h ^= zobrist.pieces[piece][r][c];
    }
  }
  if (side === "b") h ^= zobrist.side;
  return h;
}

function resetSearchState(maxDepth) {
  transpositionTable = new Map();
  killerMoves = Array.from({ length: maxDepth + 2 }, () => [null, null]);
  historyHeuristic = {
    r: Array.from({ length: BOARD_ROWS * BOARD_COLS }, () => Array(BOARD_ROWS * BOARD_COLS).fill(0)),
    b: Array.from({ length: BOARD_ROWS * BOARD_COLS }, () => Array(BOARD_ROWS * BOARD_COLS).fill(0)),
  };
  currentHash = computeHash(sideToMove);
  repetitionTable = new Map([[currentHash, 1]]);
  repetitionStack = [currentHash];
}

function setupBoard() {
  board = createEmptyBoard();
  const initial = [
    "rheakaehr",
    ".........",
    ".c.....c.",
    "p.p.p.p.p",
    ".........",
    ".........",
    "P.P.P.P.P",
    ".C.....C.",
    ".........",
    "RHEAKAEHR",
  ];
  initial.forEach((row, r) => {
    row.split("").forEach((ch, c) => {
      if (ch !== ".") board[r][c] = ch;
    });
  });
}

function buildPalette() {
  const pieceOrder = ["K", "A", "E", "H", "R", "C", "P", "k", "a", "e", "h", "r", "c", "p"];
  paletteEl.innerHTML = "";
  const emptyBtn = document.createElement("button");
  emptyBtn.textContent = "清除";
  emptyBtn.addEventListener("click", () => selectPalette(EMPTY_TOKEN, emptyBtn));
  paletteEl.appendChild(emptyBtn);
  pieceOrder.forEach((id) => {
    const btn = document.createElement("button");
    btn.textContent = PIECES[id].name + (id === id.toUpperCase() ? "(紅)" : "(黑)");
    btn.addEventListener("click", () => selectPalette(id, btn));
    paletteEl.appendChild(btn);
  });
}

function selectPalette(id, button) {
  selectedFrom = null;
  legalMovesCache = [];
  Array.from(paletteEl.querySelectorAll("button")).forEach((b) => b.classList.remove("active"));
  if (selectedPalette === id) {
    selectedPalette = null;
    renderBoard();
    return;
  }
  selectedPalette = id;
  button.classList.add("active");
  renderBoard();
}

function renderBoard() {
  boardEl.innerHTML = "";
  pieceLayerEl.innerHTML = "";
  markerLayerEl.innerHTML = "";
  hitmapEl.innerHTML = "";
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "cell" + (r === 4 || r === 5 ? " river" : "");
      boardEl.appendChild(cell);
    }
  }
  renderHitmap();
  renderMarkers();
  renderPieces();
}

function renderHitmap() {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const hit = document.createElement("div");
      hit.className = "hit";
      hit.dataset.row = r;
      hit.dataset.col = c;
      hit.style.left = `${(c / (BOARD_COLS - 1)) * 100}%`;
      hit.style.top = `${(r / (BOARD_ROWS - 1)) * 100}%`;
      hit.addEventListener("click", handleCellClick);
      hitmapEl.appendChild(hit);
    }
  }
}

function renderMarkers() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 8 9");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", "0.5");
  marker.setAttribute("markerHeight", "0.5");
  marker.setAttribute("refX", "0.45");
  marker.setAttribute("refY", "0.25");
  marker.setAttribute("orient", "auto");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowPath.setAttribute("d", "M0,0 L0.5,0.25 L0,0.5 Z");
  arrowPath.setAttribute("fill", "rgba(28, 110, 107, 0.8)");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  legalMovesCache.forEach((move) => {
    const x1 = move.from[1];
    const y1 = move.from[0];
    const x2 = move.to[1];
    const y2 = move.to[0];

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", x2);
    line.setAttribute("y2", y2);
    line.setAttribute("stroke", "rgba(28, 110, 107, 0.7)");
    line.setAttribute("stroke-width", "0.08");
    line.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(line);

    const fromDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    fromDot.setAttribute("cx", x1);
    fromDot.setAttribute("cy", y1);
    fromDot.setAttribute("r", "0.18");
    fromDot.setAttribute("fill", "rgba(180, 72, 30, 0.7)");
    svg.appendChild(fromDot);

    const toDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    toDot.setAttribute("cx", x2);
    toDot.setAttribute("cy", y2);
    toDot.setAttribute("r", "0.2");
    toDot.setAttribute("fill", "rgba(28, 110, 107, 0.75)");
    svg.appendChild(toDot);
  });

  markerLayerEl.appendChild(svg);
}

function renderPieces() {
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const color = PIECES[piece].color;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");

      circle.setAttribute("cx", c);
      circle.setAttribute("cy", r);
      circle.setAttribute("r", "0.36");
      circle.setAttribute("class", `piece-circle ${color}`);

      text.setAttribute("x", c);
      text.setAttribute("y", r);
      text.setAttribute("class", `piece-text ${color}`);
      text.textContent = PIECES[piece].name;

      group.appendChild(circle);
      group.appendChild(text);
      pieceLayerEl.appendChild(group);
    }
  }
}

function handleCellClick(e) {
  const r = Number(e.currentTarget.dataset.row);
  const c = Number(e.currentTarget.dataset.col);

  if (selectedPalette !== null) {
    board[r][c] = selectedPalette === EMPTY_TOKEN ? null : selectedPalette;
    renderBoard();
    return;
  }

  const piece = board[r][c];
  if (selectedFrom) {
    const move = legalMovesCache.find((m) => m.to[0] === r && m.to[1] === c);
    if (move) {
      applyMove(move);
      selectedFrom = null;
      legalMovesCache = [];
      renderBoard();
      updateSideLabel();
      updateAnalysis("已移動，輪到" + (sideToMove === "r" ? "紅方" : "黑方") + "。", true);
      return;
    }
  }

  if (piece && isSidePiece(piece, sideToMove)) {
    selectedFrom = [r, c];
    legalMovesCache = getLegalMoves(sideToMove).filter((m) => m.from[0] === r && m.from[1] === c);
  } else {
    selectedFrom = null;
    legalMovesCache = [];
  }
  renderBoard();
}

function applyMove(move) {
  const piece = board[move.from[0]][move.from[1]];
  board[move.from[0]][move.from[1]] = null;
  board[move.to[0]][move.to[1]] = piece;
  sideToMove = sideToMove === "r" ? "b" : "r";
}

function isSidePiece(piece, side) {
  return side === "r" ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
}

function updateSideLabel() {
  const toggleBtn = document.getElementById("toggle-side");
  toggleBtn.textContent = "輪到：" + (sideToMove === "r" ? "紅方" : "黑方");
}

function updateAnalysis(text, append = false) {
  analysisEl.textContent = append ? analysisEl.textContent + "\n" + text : text;
}

function insideBoard(r, c) {
  return r >= 0 && r < BOARD_ROWS && c >= 0 && c < BOARD_COLS;
}

function findKing(side) {
  const target = side === "r" ? "K" : "k";
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (board[r][c] === target) return [r, c];
    }
  }
  return null;
}

function getLegalMoves(side) {
  const moves = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (!piece || !isSidePiece(piece, side)) continue;
      const pseudo = getPseudoMoves(piece, r, c);
      pseudo.forEach((move) => {
        if (isLegalMove(move, side)) moves.push(move);
      });
    }
  }
  return moves;
}

function getTacticalMoves(side) {
  const moves = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (!piece || !isSidePiece(piece, side)) continue;
      const pseudo = getPseudoMoves(piece, r, c);
      pseudo.forEach((move) => {
        const target = board[move.to[0]][move.to[1]];
        if (target) {
          if (isLegalMove(move, side)) moves.push(move);
          return;
        }
        if (givesCheckQuick(move, side) && isLegalMove(move, side)) moves.push(move);
      });
    }
  }
  return moves;
}

function isLegalMove(move, side) {
  const snapshot = board[move.to[0]][move.to[1]];
  const piece = board[move.from[0]][move.from[1]];
  board[move.from[0]][move.from[1]] = null;
  board[move.to[0]][move.to[1]] = piece;
  const legal = !isInCheck(side);
  board[move.from[0]][move.from[1]] = piece;
  board[move.to[0]][move.to[1]] = snapshot;
  return legal;
}

function isInCheck(side) {
  const kingPos = findKing(side);
  if (!kingPos) return true;
  return isSquareAttacked(kingPos[0], kingPos[1], side === "r" ? "b" : "r");
}

function isSquareAttacked(r, c, attackerSide) {
  const isRed = attackerSide === "r";
  const enemyPawn = isRed ? "P" : "p";
  const enemyKing = isRed ? "K" : "k";
  const enemyAdvisor = isRed ? "A" : "a";
  const enemyElephant = isRed ? "E" : "e";
  const enemyHorse = isRed ? "H" : "h";
  const enemyRook = isRed ? "R" : "r";
  const enemyCannon = isRed ? "C" : "c";
  let rr;

  const pawnDir = isRed ? 1 : -1;
  const pawnR = r + pawnDir;
  if (insideBoard(pawnR, c) && board[pawnR][c] === enemyPawn) return true;
  if (isRed ? r <= 4 : r >= 5) {
    if (insideBoard(r, c - 1) && board[r][c - 1] === enemyPawn) return true;
    if (insideBoard(r, c + 1) && board[r][c + 1] === enemyPawn) return true;
  }

  const palaceRows = isRed ? [7, 9] : [0, 2];
  const palaceCols = [3, 5];
  const kingSteps = [
    [1, 0], [-1, 0], [0, 1], [0, -1]
  ];
  for (const [dr, dc] of kingSteps) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= palaceRows[0] && rr <= palaceRows[1] && cc >= palaceCols[0] && cc <= palaceCols[1]) {
      if (board[rr][cc] === enemyKing) return true;
    }
  }

  rr = r + (isRed ? 1 : -1);
  while (insideBoard(rr, c)) {
    const piece = board[rr][c];
    if (piece) {
      if (piece === enemyKing) return true;
      break;
    }
    rr += isRed ? 1 : -1;
  }

  const advisorSteps = [
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  for (const [dr, dc] of advisorSteps) {
    const ar = r + dr;
    const ac = c + dc;
    if (ar >= palaceRows[0] && ar <= palaceRows[1] && ac >= palaceCols[0] && ac <= palaceCols[1]) {
      if (board[ar][ac] === enemyAdvisor) return true;
    }
  }

  const elephantSteps = [
    [2, 2], [2, -2], [-2, 2], [-2, -2]
  ];
  const riverLimit = isRed ? 4 : 5;
  for (const [dr, dc] of elephantSteps) {
    const er = r + dr;
    const ec = c + dc;
    const eyeR = r + dr / 2;
    const eyeC = c + dc / 2;
    if (!insideBoard(er, ec) || board[eyeR][eyeC]) continue;
    if (isRed && er < riverLimit) continue;
    if (!isRed && er > riverLimit) continue;
    if (board[er][ec] === enemyElephant) return true;
  }

  const horseSteps = [
    [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
    [1, 2, 0, 1], [1, -2, 0, -1], [-1, 2, 0, 1], [-1, -2, 0, -1]
  ];
  for (const [dr, dc, br, bc] of horseSteps) {
    const hr = r + dr;
    const hc = c + dc;
    const brc = r + br;
    const bcc = c + bc;
    if (!insideBoard(hr, hc) || board[brc][bcc]) continue;
    if (board[hr][hc] === enemyHorse) return true;
  }

  const rookDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of rookDirs) {
    rr = r + dr;
    let cc = c + dc;
    while (insideBoard(rr, cc)) {
      const piece = board[rr][cc];
      if (piece) {
        if (piece === enemyRook) return true;
        break;
      }
      rr += dr;
      cc += dc;
    }
  }

  for (const [dr, dc] of rookDirs) {
    rr = r + dr;
    let cc = c + dc;
    while (insideBoard(rr, cc)) {
      const piece = board[rr][cc];
      if (piece) {
        rr += dr;
        cc += dc;
        while (insideBoard(rr, cc)) {
          const next = board[rr][cc];
          if (next) {
            if (next === enemyCannon) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
        break;
      }
      rr += dr;
      cc += dc;
    }
  }

  return false;
}

function getPseudoMovesForSide(side, attackOnly = false) {
  const moves = [];
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (!piece || !isSidePiece(piece, side)) continue;
      moves.push(...getPseudoMoves(piece, r, c, attackOnly));
    }
  }
  return moves;
}

function getPseudoMoves(piece, r, c, attackOnly = false) {
  const moves = [];
  const isRed = piece === piece.toUpperCase();
  const side = isRed ? "r" : "b";
  const own = (rr, cc) => board[rr][cc] && isSidePiece(board[rr][cc], side);
  const enemy = (rr, cc) => board[rr][cc] && !isSidePiece(board[rr][cc], side);

  const add = (rr, cc) => {
    if (!insideBoard(rr, cc) || own(rr, cc)) return;
    if (attackOnly && !enemy(rr, cc)) return;
    moves.push({ from: [r, c], to: [rr, cc] });
  };

  switch (piece.toUpperCase()) {
    case "K": {
      const palaceRows = isRed ? [7, 9] : [0, 2];
      const palaceCols = [3, 5];
      const steps = [
        [1, 0], [-1, 0], [0, 1], [0, -1]
      ];
      steps.forEach(([dr, dc]) => {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= palaceRows[0] && rr <= palaceRows[1] && cc >= palaceCols[0] && cc <= palaceCols[1]) {
          add(rr, cc);
        }
      });
      const dir = isRed ? -1 : 1;
      let rr = r + dir;
      while (insideBoard(rr, c)) {
        if (board[rr][c]) {
          if (board[rr][c].toUpperCase() === "K") {
            moves.push({ from: [r, c], to: [rr, c] });
          }
          break;
        }
        rr += dir;
      }
      break;
    }
    case "A": {
      const palaceRows = isRed ? [7, 9] : [0, 2];
      const palaceCols = [3, 5];
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([dr, dc]) => {
        const rr = r + dr;
        const cc = c + dc;
        if (rr >= palaceRows[0] && rr <= palaceRows[1] && cc >= palaceCols[0] && cc <= palaceCols[1]) {
          add(rr, cc);
        }
      });
      break;
    }
    case "E": {
      const riverLimit = isRed ? 4 : 5;
      [[2, 2], [2, -2], [-2, 2], [-2, -2]].forEach(([dr, dc]) => {
        const rr = r + dr;
        const cc = c + dc;
        const eyeR = r + dr / 2;
        const eyeC = c + dc / 2;
        if (!insideBoard(rr, cc) || board[eyeR][eyeC]) return;
        if (isRed && rr < riverLimit) return;
        if (!isRed && rr > riverLimit) return;
        add(rr, cc);
      });
      break;
    }
    case "H": {
      const candidates = [
        [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
        [1, 2, 0, 1], [1, -2, 0, -1], [-1, 2, 0, 1], [-1, -2, 0, -1]
      ];
      candidates.forEach(([dr, dc, br, bc]) => {
        const blockR = r + br;
        const blockC = c + bc;
        const rr = r + dr;
        const cc = c + dc;
        if (!insideBoard(rr, cc) || board[blockR][blockC]) return;
        add(rr, cc);
      });
      break;
    }
    case "R": {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      dirs.forEach(([dr, dc]) => {
        let rr = r + dr;
        let cc = c + dc;
        while (insideBoard(rr, cc)) {
          if (!board[rr][cc]) {
            if (!attackOnly) moves.push({ from: [r, c], to: [rr, cc] });
          } else {
            if (enemy(rr, cc)) moves.push({ from: [r, c], to: [rr, cc] });
            break;
          }
          rr += dr;
          cc += dc;
        }
      });
      break;
    }
    case "C": {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      dirs.forEach(([dr, dc]) => {
        let rr = r + dr;
        let cc = c + dc;
        let screen = false;
        while (insideBoard(rr, cc)) {
          if (!screen) {
            if (!board[rr][cc]) {
              if (!attackOnly) moves.push({ from: [r, c], to: [rr, cc] });
            } else {
              screen = true;
            }
          } else {
            if (board[rr][cc]) {
              if (enemy(rr, cc)) moves.push({ from: [r, c], to: [rr, cc] });
              break;
            }
          }
          rr += dr;
          cc += dc;
        }
      });
      break;
    }
    case "P": {
      const dir = isRed ? -1 : 1;
      const forwardR = r + dir;
      if (insideBoard(forwardR, c)) add(forwardR, c);
      const crossed = isRed ? r <= 4 : r >= 5;
      if (crossed) {
        if (insideBoard(r, c + 1)) add(r, c + 1);
        if (insideBoard(r, c - 1)) add(r, c - 1);
      }
      break;
    }
  }
  return moves;
}

function countBetween(r1, c1, r2, c2) {
  if (r1 === r2) {
    let count = 0;
    const start = Math.min(c1, c2) + 1;
    const end = Math.max(c1, c2);
    for (let c = start; c < end; c++) if (board[r1][c]) count++;
    return count;
  }
  if (c1 === c2) {
    let count = 0;
    const start = Math.min(r1, r2) + 1;
    const end = Math.max(r1, r2);
    for (let r = start; r < end; r++) if (board[r][c1]) count++;
    return count;
  }
  return null;
}

function countAttackers(targetR, targetC, attackerSide) {
  const moves = getPseudoMovesForSide(attackerSide, true);
  let count = 0;
  for (const move of moves) {
    if (move.to[0] === targetR && move.to[1] === targetC) count++;
  }
  return count;
}

function singleBetweenOnFile(r1, c, r2) {
  if (c < 0 || c >= BOARD_COLS) return null;
  const start = Math.min(r1, r2) + 1;
  const end = Math.max(r1, r2);
  let seen = null;
  for (let r = start; r < end; r++) {
    if (board[r][c]) {
      if (seen) return null;
      seen = [r, c];
    }
  }
  return seen;
}

function singleBetweenOnRank(c1, r, c2) {
  if (r < 0 || r >= BOARD_ROWS) return null;
  const start = Math.min(c1, c2) + 1;
  const end = Math.max(c1, c2);
  let seen = null;
  for (let c = start; c < end; c++) {
    if (board[r][c]) {
      if (seen) return null;
      seen = [r, c];
    }
  }
  return seen;
}

function cannonOpenLines(cr, cc) {
  let bonus = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of dirs) {
    let rr = cr + dr;
    let cc2 = cc + dc;
    let empty = 0;
    while (insideBoard(rr, cc2) && !board[rr][cc2]) {
      empty += 1;
      rr += dr;
      cc2 += dc;
    }
    bonus += Math.min(empty, 3) * 2;
  }
  return bonus;
}

function cannonActivityBonus(cannons) {
  let bonus = 0;
  cannons.forEach(([cr, cc]) => {
    bonus += cannonOpenLines(cr, cc) * 4;
    const centerDist = Math.abs(cc - 4) + Math.abs(cr - 4.5);
    bonus += Math.max(0, 8 - centerDist) * 2;
  });
  return bonus;
}

function cannonScreenThreatScoreFrom(cr, cc, side) {
  let score = 0;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of dirs) {
    let rr = cr + dr;
    let cc2 = cc + dc;
    while (insideBoard(rr, cc2) && !board[rr][cc2]) {
      rr += dr;
      cc2 += dc;
    }
    if (!insideBoard(rr, cc2)) continue;
    rr += dr;
    cc2 += dc;
    while (insideBoard(rr, cc2) && !board[rr][cc2]) {
      rr += dr;
      cc2 += dc;
    }
    if (!insideBoard(rr, cc2)) continue;
    const target = board[rr][cc2];
    if (target && !isSidePiece(target, side)) {
      const base = Math.min(PIECES[target].value, 600);
      score += Math.round(base * 0.2);
      if (target.toUpperCase() === "K") score += 80;
    }
  }
  return score;
}

function cannonScreenThreatBonus(side, cannons) {
  let bonus = 0;
  cannons.forEach(([cr, cc]) => {
    bonus += cannonScreenThreatScoreFrom(cr, cc, side);
  });
  return bonus;
}

function threatScoreForSide(side) {
  const attacks = getPseudoMovesForSide(side, true);
  const bestTargets = new Map();
  attacks.forEach((move) => {
    const target = board[move.to[0]][move.to[1]];
    if (!target) return;
    const key = `${move.to[0]}-${move.to[1]}`;
    const val = PIECES[target].value;
    const prev = bestTargets.get(key) || 0;
    if (val > prev) bestTargets.set(key, val);
  });
  let score = 0;
  bestTargets.forEach((val) => {
    score += Math.min(val, 600) / 10;
  });
  return score;
}

function cannonRookSynergy(side, cannons, rooks, enemyKingPos) {
  let bonus = 0;
  if (!enemyKingPos) return bonus;
  const rookId = side === "r" ? "R" : "r";
  cannons.forEach(([cr, cc]) => {
    rooks.forEach(([rr, rc]) => {
      if (cr === rr || cc === rc) {
        const between = countBetween(cr, cc, rr, rc);
        if (between === 0) bonus += 8;
        if (between === 1) bonus += 16;
      }
    });
    if (cr === enemyKingPos[0]) {
      const between = countBetween(cr, cc, enemyKingPos[0], enemyKingPos[1]);
      if (between === 1) {
        const screen = singleBetweenOnRank(cc, cr, enemyKingPos[1]);
        if (screen && board[screen[0]][screen[1]] === rookId) bonus += 28;
      }
    }
    if (cc === enemyKingPos[1]) {
      const between = countBetween(cr, cc, enemyKingPos[0], enemyKingPos[1]);
      if (between === 1) {
        const screen = singleBetweenOnFile(cr, cc, enemyKingPos[0]);
        if (screen && board[screen[0]][screen[1]] === rookId) bonus += 32;
      }
    }
  });
  return bonus;
}

function cannonKingProximity(side, cannons, enemyKingPos) {
  if (!enemyKingPos) return 0;
  let bonus = 0;
  const isRed = side === "r";
  const enemyPalaceRows = isRed ? [0, 2] : [7, 9];
  cannons.forEach(([cr, cc]) => {
    const dist = Math.abs(cr - enemyKingPos[0]) + Math.abs(cc - enemyKingPos[1]);
    if (dist <= 3) bonus += 10;
    if (cc === enemyKingPos[1] && Math.abs(cr - enemyKingPos[0]) <= 4) bonus += 12;
    if (cr === enemyKingPos[0] && Math.abs(cc - enemyKingPos[1]) <= 4) bonus += 8;
    if (cr >= enemyPalaceRows[0] - 1 && cr <= enemyPalaceRows[1] + 1) bonus += 8;
  });
  return bonus;
}

function cannonStrategicBonus(side, ownKingPos, enemyKingPos, cannons) {
  if (!ownKingPos || !enemyKingPos) return 0;
  const isRed = side === "r";
  const cannonId = isRed ? "C" : "c";
  let bonus = 0;

  cannons.forEach(([cr, cc]) => {
    if (board[cr][cc] !== cannonId) return;
    bonus += cannonOpenLines(cr, cc);
    if (cc === enemyKingPos[1]) {
      const between = countBetween(cr, cc, enemyKingPos[0], enemyKingPos[1]);
      if (between === 1) {
        bonus += 45;
        const screen = singleBetweenOnFile(cr, cc, enemyKingPos[0]);
        if (screen) {
          const screenPiece = board[screen[0]][screen[1]];
          bonus += screenPiece && isSidePiece(screenPiece, side) ? 8 : 15;
          if (Math.abs(screen[0] - enemyKingPos[0]) === 1) bonus += 20;
        }
      }
    }
    if (cr === enemyKingPos[0]) {
      const between = countBetween(cr, cc, enemyKingPos[0], enemyKingPos[1]);
      if (between === 1) {
        bonus += 35;
        const screen = singleBetweenOnRank(cc, cr, enemyKingPos[1]);
        if (screen) {
          const screenPiece = board[screen[0]][screen[1]];
          bonus += screenPiece && isSidePiece(screenPiece, side) ? 6 : 12;
          if (Math.abs(screen[1] - enemyKingPos[1]) === 1) bonus += 16;
        }
      }
    }
  });

  if (ownKingPos[1] === enemyKingPos[1]) {
    const betweenPos = singleBetweenOnFile(ownKingPos[0], ownKingPos[1], enemyKingPos[0]);
    if (betweenPos && board[betweenPos[0]][betweenPos[1]] === cannonId) {
      bonus += 60;
    }
  }

  return bonus;
}

function pawnStructureBonus(pawns) {
  const fileCounts = Array(BOARD_COLS).fill(0);
  const pawnSet = new Set();
  pawns.forEach(([r, c]) => {
    fileCounts[c] += 1;
    pawnSet.add(`${r}-${c}`);
  });
  let bonus = 0;
  pawns.forEach(([r, c]) => {
    if (pawnSet.has(`${r}-${c - 1}`) || pawnSet.has(`${r}-${c + 1}`)) bonus += 8;
  });
  fileCounts.forEach((count) => {
    if (count > 1) bonus -= (count - 1) * 10;
  });
  return bonus;
}

function openFileBonus(side, rooks, cannons, redPawnCount, blackPawnCount, enemyKingPos) {
  let bonus = 0;
  const ownPawnCount = side === "r" ? redPawnCount : blackPawnCount;
  const enemyPawnCount = side === "r" ? blackPawnCount : redPawnCount;
  rooks.forEach(([, c]) => {
    if (ownPawnCount[c] === 0 && enemyPawnCount[c] === 0) bonus += 18;
    else if (ownPawnCount[c] === 0) bonus += 10;
    if (enemyKingPos && c === enemyKingPos[1]) bonus += 6;
  });
  cannons.forEach(([, c]) => {
    if (ownPawnCount[c] === 0 && enemyPawnCount[c] === 0) bonus += 10;
    else if (ownPawnCount[c] === 0) bonus += 6;
  });
  return bonus;
}

function kingActivityBonus(side, kingPos, totalMaterial) {
  if (!kingPos) return 0;
  const threshold = 2000;
  if (totalMaterial >= threshold) return 0;
  const phase = (threshold - totalMaterial) / threshold;
  const center = side === "r" ? [8, 4] : [1, 4];
  const dist = Math.abs(kingPos[0] - center[0]) + Math.abs(kingPos[1] - center[1]);
  return Math.max(0, 6 - dist) * 8 * phase;
}

function isPassedPawn(side, r, c) {
  if (side === "r") {
    for (let rr = r - 1; rr >= 0; rr--) {
      if (board[rr][c] === "p") return false;
    }
  } else {
    for (let rr = r + 1; rr < BOARD_ROWS; rr++) {
      if (board[rr][c] === "P") return false;
    }
  }
  return true;
}

function coordinationBonus(positions) {
  let bonus = 0;
  const rooks = positions.R;
  const cannons = positions.C;

  if (rooks.length >= 2) {
    for (let i = 0; i < rooks.length; i++) {
      for (let j = i + 1; j < rooks.length; j++) {
        const [r1, c1] = rooks[i];
        const [r2, c2] = rooks[j];
        const between = countBetween(r1, c1, r2, c2);
        if (between === 0) bonus += 26;
      }
    }
  }

  if (cannons.length >= 2) {
    for (let i = 0; i < cannons.length; i++) {
      for (let j = i + 1; j < cannons.length; j++) {
        const [r1, c1] = cannons[i];
        const [r2, c2] = cannons[j];
        const between = countBetween(r1, c1, r2, c2);
        if (between === 0) bonus += 14;
      }
    }
  }

  if (rooks.length >= 1 && cannons.length >= 1) {
    rooks.forEach(([rr, rc]) => {
      cannons.forEach(([cr, cc]) => {
        const between = countBetween(rr, rc, cr, cc);
        if (between === 0) bonus += 12;
      });
    });
  }

  return bonus;
}

function kingSafety(side, kingPos, own, enemy) {
  if (!kingPos) return -9999;
  let score = 0;
  const advisors = own.A.length;
  const elephants = own.E.length;
  score += advisors * 12 + elephants * 8;
  score -= (2 - advisors) * 18;
  if (elephants === 0) score -= 10;

  enemy.R.forEach(([er, ec]) => {
    const between = countBetween(kingPos[0], kingPos[1], er, ec);
    if (between === 0) score -= 80;
  });
  enemy.C.forEach(([er, ec]) => {
    const between = countBetween(kingPos[0], kingPos[1], er, ec);
    if (between === 1) score -= 60;
  });

  const attackerSide = side === "r" ? "b" : "r";
  const attackCount = countAttackers(kingPos[0], kingPos[1], attackerSide);
  score -= attackCount * 12;

  return score;
}

function evaluateBoard() {
  let score = 0;
  let redKingPos = null;
  let blackKingPos = null;
  let totalMaterial = 0;
  const positions = {
    r: { A: [], E: [], H: [], R: [], C: [], P: [] },
    b: { A: [], E: [], H: [], R: [], C: [], P: [] },
  };

  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const isRed = piece === piece.toUpperCase();
      const val = PIECES[piece].value;
      score += isRed ? val : -val;
      score += isRed ? positionalBonus(piece, r, c) : -positionalBonus(piece, r, c);
      if (piece.toUpperCase() !== "K") totalMaterial += val;
      const bucket = isRed ? positions.r : positions.b;
      const key = piece.toUpperCase();
      if (bucket[key]) bucket[key].push([r, c]);
      if (piece === "K") redKingPos = [r, c];
      if (piece === "k") blackKingPos = [r, c];
    }
  }

  if (!redKingPos) return -99999;
  if (!blackKingPos) return 99999;

  positions.r.P.forEach(([r, c]) => {
    if (isPassedPawn("r", r, c)) {
      score += 20 + Math.max(0, 6 - r) * 4;
    }
  });
  positions.b.P.forEach(([r, c]) => {
    if (isPassedPawn("b", r, c)) {
      score -= 20 + Math.max(0, r - 3) * 4;
    }
  });

  score += coordinationBonus(positions.r);
  score -= coordinationBonus(positions.b);
  score += pawnStructureBonus(positions.r.P);
  score -= pawnStructureBonus(positions.b.P);

  score += kingSafety("r", redKingPos, positions.r, positions.b);
  score -= kingSafety("b", blackKingPos, positions.b, positions.r);
  score += cannonStrategicBonus("r", redKingPos, blackKingPos, positions.r.C);
  score -= cannonStrategicBonus("b", blackKingPos, redKingPos, positions.b.C);
  score += cannonActivityBonus(positions.r.C);
  score -= cannonActivityBonus(positions.b.C);
  score += cannonScreenThreatBonus("r", positions.r.C);
  score -= cannonScreenThreatBonus("b", positions.b.C);
  score += cannonRookSynergy("r", positions.r.C, positions.r.R, blackKingPos);
  score -= cannonRookSynergy("b", positions.b.C, positions.b.R, redKingPos);
  score += cannonKingProximity("r", positions.r.C, blackKingPos);
  score -= cannonKingProximity("b", positions.b.C, redKingPos);
  const redPawnCount = Array(BOARD_COLS).fill(0);
  const blackPawnCount = Array(BOARD_COLS).fill(0);
  positions.r.P.forEach(([, c]) => (redPawnCount[c] += 1));
  positions.b.P.forEach(([, c]) => (blackPawnCount[c] += 1));
  score += openFileBonus("r", positions.r.R, positions.r.C, redPawnCount, blackPawnCount, blackKingPos);
  score -= openFileBonus("b", positions.b.R, positions.b.C, redPawnCount, blackPawnCount, redKingPos);
  score += kingActivityBonus("r", redKingPos, totalMaterial);
  score -= kingActivityBonus("b", blackKingPos, totalMaterial);

  const redPressure = countAttackers(blackKingPos[0], blackKingPos[1], "r");
  const blackPressure = countAttackers(redKingPos[0], redKingPos[1], "b");
  score += (redPressure - blackPressure) * 14;

  const mobility = getPseudoMovesForSide("r").length - getPseudoMovesForSide("b").length;
  score += mobility * 2;
  return score;
}

function positionalBonus(piece, r, c) {
  const isRed = piece === piece.toUpperCase();
  const rr = isRed ? r : 9 - r;
  const centerDist = Math.abs(c - 4) + Math.abs(rr - 4.5);
  const centerBonus = Math.max(0, 10 - centerDist * 2);
  switch (piece.toUpperCase()) {
    case "P": {
      const advance = (9 - rr) * 2;
      const crossed = rr <= 4 ? 6 : 0;
      return advance + crossed;
    }
    case "R":
    case "C":
    case "H":
      return centerBonus;
    case "K":
      return rr <= 2 ? 6 : 0;
    default:
      return 0;
  }
}

function timeBudgetForDepth(maxDepth) {
  const base = 700;
  return base + maxDepth * 420;
}

function countPieces() {
  let count = 0;
  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      if (board[r][c]) count += 1;
    }
  }
  return count;
}

function estimateDynamicDepth(baseDepth) {
  const pieceCount = countPieces();
  const moveCount = getLegalMoves(sideToMove).length;
  let depth = baseDepth;

  if (pieceCount <= 10) depth += 2;
  else if (pieceCount <= 16) depth += 1;
  else if (pieceCount >= 26) depth -= 1;

  if (moveCount <= 10) depth += 1;
  else if (moveCount >= 32) depth -= 1;

  if (isInCheck(sideToMove)) depth += 1;

  const lowerCap = Math.max(2, baseDepth - 1);
  const upperCap = Math.min(7, baseDepth + 2);
  depth = Math.max(lowerCap, Math.min(upperCap, depth));

  return { depth, pieceCount, moveCount };
}

function searchBestMove(depth) {
  const side = sideToMove;
  const moves = getLegalMoves(side);
  if (moves.length === 0) {
    const status = isInCheck(side) ? "被將死" : "無子可走";
    return { move: null, score: side === "r" ? -99999 : 99999, status };
  }

  let bestScore = side === "r" ? -Infinity : Infinity;
  let bestMoves = [];
  const rootScores = [];

  const rootEntry = transpositionTable.get(currentHash);
  const ordered = orderMoves(moves, side, 0, rootEntry?.bestKey || null);
  ordered.forEach((move) => {
    const captured = makeSearchMove(move);
    const score = minimax(depth - 1, side === "r" ? "b" : "r", -Infinity, Infinity, 1);
    undoSearchMove(move, captured);
    rootScores.push({ move, score });

    if ((side === "r" && score > bestScore) || (side === "b" && score < bestScore)) {
      bestScore = score;
      bestMoves = [{ move, score }];
    } else if (score === bestScore) {
      bestMoves.push({ move, score });
    }
  });

  const bestKey = bestMoves[0] ? moveKey(bestMoves[0].move) : null;
  transpositionTable.set(currentHash, { depth, score: bestScore, flag: "exact", bestKey });
  rootScores.sort((a, b) => (side === "r" ? b.score - a.score : a.score - b.score));
  return { move: bestMoves[0].move, score: bestScore, candidates: rootScores.slice(0, 3) };
}

function minimax(depth, side, alpha, beta, ply) {
  if ((repetitionTable.get(currentHash) || 0) >= DRAW_REPETITION) return 0;
  if (depth === 0) return quiescence(side, alpha, beta, 3);
  const moves = getLegalMoves(side);
  if (moves.length === 0) {
    if (isInCheck(side)) return side === "r" ? -99999 : 99999;
    return 0;
  }

  const alphaOrig = alpha;
  const betaOrig = beta;
  const ttEntry = transpositionTable.get(currentHash);
  if (ttEntry && ttEntry.depth >= depth) {
    if (ttEntry.flag === "exact") return ttEntry.score;
    if (ttEntry.flag === "lower") alpha = Math.max(alpha, ttEntry.score);
    if (ttEntry.flag === "upper") beta = Math.min(beta, ttEntry.score);
    if (alpha >= beta) return ttEntry.score;
  }

  if (side === "r") {
    let value = -Infinity;
    let bestKey = null;
    const ordered = orderMoves(moves, side, ply, ttEntry?.bestKey || null);
    for (const move of ordered) {
      const piece = board[move.from[0]][move.from[1]];
      const extend = depth > 1 && piece && piece.toUpperCase() === "C" && givesCheckQuick(move, side) ? 1 : 0;
      const captured = makeSearchMove(move);
      const score = minimax(depth - 1 + extend, "b", alpha, beta, ply + 1);
      undoSearchMove(move, captured);
      if (score > value) {
        value = score;
        bestKey = moveKey(move);
      }
      if (value > alpha) alpha = value;
      if (alpha >= beta) {
        const cutKey = moveKey(move);
        if (!captured && killerMoves[ply]) {
          if (killerMoves[ply][0] !== cutKey) {
            killerMoves[ply][1] = killerMoves[ply][0];
            killerMoves[ply][0] = cutKey;
          }
        }
        if (!captured) {
          const fromIdx = move.from[0] * BOARD_COLS + move.from[1];
          const toIdx = move.to[0] * BOARD_COLS + move.to[1];
          historyHeuristic[side][fromIdx][toIdx] += depth * depth;
        }
        break;
      }
    }
    storeTTEntry(depth, value, alphaOrig, betaOrig, bestKey);
    return value;
  }

  let value = Infinity;
  let bestKey = null;
  const ordered = orderMoves(moves, side, ply, ttEntry?.bestKey || null);
  for (const move of ordered) {
    const piece = board[move.from[0]][move.from[1]];
    const extend = depth > 1 && piece && piece.toUpperCase() === "C" && givesCheckQuick(move, side) ? 1 : 0;
    const captured = makeSearchMove(move);
    const score = minimax(depth - 1 + extend, "r", alpha, beta, ply + 1);
    undoSearchMove(move, captured);
    if (score < value) {
      value = score;
      bestKey = moveKey(move);
    }
    if (value < beta) beta = value;
    if (alpha >= beta) {
      const cutKey = moveKey(move);
      if (!captured && killerMoves[ply]) {
        if (killerMoves[ply][0] !== cutKey) {
          killerMoves[ply][1] = killerMoves[ply][0];
          killerMoves[ply][0] = cutKey;
        }
      }
      if (!captured) {
        const fromIdx = move.from[0] * BOARD_COLS + move.from[1];
        const toIdx = move.to[0] * BOARD_COLS + move.to[1];
        historyHeuristic[side][fromIdx][toIdx] += depth * depth;
      }
      break;
    }
  }
  storeTTEntry(depth, value, alphaOrig, betaOrig, bestKey);
  return value;
}

function applyTempMove(move) {
  const piece = board[move.from[0]][move.from[1]];
  const captured = board[move.to[0]][move.to[1]];
  board[move.from[0]][move.from[1]] = null;
  board[move.to[0]][move.to[1]] = piece;
  return captured;
}

function undoTempMove(move, captured) {
  const piece = board[move.to[0]][move.to[1]];
  board[move.to[0]][move.to[1]] = captured;
  board[move.from[0]][move.from[1]] = piece;
}

function givesCheckQuick(move, side) {
  const captured = applyTempMove(move);
  const opponent = side === "r" ? "b" : "r";
  const check = isInCheck(opponent);
  undoTempMove(move, captured);
  return check;
}

function quiescence(side, alpha, beta, depth) {
  if ((repetitionTable.get(currentHash) || 0) >= DRAW_REPETITION) return 0;
  const standPat = evaluateBoard();
  if (depth === 0) return standPat;
  if (side === "r") {
    if (standPat > alpha) alpha = standPat;
    if (alpha >= beta) return beta;
  } else {
    if (standPat < beta) beta = standPat;
    if (alpha >= beta) return alpha;
  }

  const tactical = getTacticalMoves(side);
  const ordered = orderMoves(tactical, side, 0, null);
  for (const move of ordered) {
    const captured = makeSearchMove(move);
    const score = quiescence(side === "r" ? "b" : "r", alpha, beta, depth - 1);
    undoSearchMove(move, captured);
    if (side === "r") {
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    } else {
      if (score < beta) beta = score;
      if (alpha >= beta) break;
    }
  }
  return side === "r" ? alpha : beta;
}

function moveKey(move) {
  return `${move.from[0]}${move.from[1]}${move.to[0]}${move.to[1]}`;
}

function orderMoves(moves, side, ply, ttMoveKey) {
  const enemyKingPos = findKing(side === "r" ? "b" : "r");
  return moves
    .slice()
    .sort((a, b) => scoreMove(b, side, ply, ttMoveKey, enemyKingPos) - scoreMove(a, side, ply, ttMoveKey, enemyKingPos));
}

function scoreMove(move, side, ply, ttMoveKey, enemyKingPos) {
  const attacker = board[move.from[0]][move.from[1]];
  const target = board[move.to[0]][move.to[1]];
  let score = 0;
  const key = moveKey(move);
  if (ttMoveKey && key === ttMoveKey) score += 1_000_000_000;
  if (target) {
    score += 1_000_000 + (PIECES[target].value * 10 - PIECES[attacker].value);
  } else if (killerMoves[ply]) {
    if (killerMoves[ply][0] === key) score += 500_000;
    else if (killerMoves[ply][1] === key) score += 300_000;
  }
  if (historyHeuristic[side]) {
    const fromIdx = move.from[0] * BOARD_COLS + move.from[1];
    const toIdx = move.to[0] * BOARD_COLS + move.to[1];
    score += historyHeuristic[side][fromIdx][toIdx];
  }
  if (side === "r" && move.to[0] <= 2) score += 15;
  if (side === "b" && move.to[0] >= 7) score += 15;
  if (ply <= 1 && givesCheckQuick(move, side)) score += 220_000;
  if (!target && ply <= 1) {
    const beforeThreat = threatScoreForSide(side);
    const captured = applyTempMove(move);
    const afterThreat = threatScoreForSide(side);
    undoTempMove(move, captured);
    const delta = afterThreat - beforeThreat;
    score += delta * 40;
    if (delta <= 0) score -= 3_000;
  }
  return score;
}

function storeTTEntry(depth, value, alphaOrig, betaOrig, bestKey) {
  let flag = "exact";
  if (value <= alphaOrig) flag = "upper";
  else if (value >= betaOrig) flag = "lower";
  transpositionTable.set(currentHash, { depth, score: value, flag, bestKey });
}

function makeSearchMove(move) {
  const piece = board[move.from[0]][move.from[1]];
  const captured = board[move.to[0]][move.to[1]];
  currentHash ^= zobrist.pieces[piece][move.from[0]][move.from[1]];
  if (captured) currentHash ^= zobrist.pieces[captured][move.to[0]][move.to[1]];
  currentHash ^= zobrist.pieces[piece][move.to[0]][move.to[1]];
  currentHash ^= zobrist.side;
  board[move.from[0]][move.from[1]] = null;
  board[move.to[0]][move.to[1]] = piece;
  repetitionStack.push(currentHash);
  repetitionTable.set(currentHash, (repetitionTable.get(currentHash) || 0) + 1);
  return captured;
}

function undoSearchMove(move, captured) {
  const piece = board[move.to[0]][move.to[1]];
  currentHash ^= zobrist.side;
  currentHash ^= zobrist.pieces[piece][move.to[0]][move.to[1]];
  if (captured) currentHash ^= zobrist.pieces[captured][move.to[0]][move.to[1]];
  currentHash ^= zobrist.pieces[piece][move.from[0]][move.from[1]];
  board[move.from[0]][move.from[1]] = piece;
  board[move.to[0]][move.to[1]] = captured;
  const last = repetitionStack.pop();
  if (last !== undefined) {
    const next = (repetitionTable.get(last) || 1) - 1;
    if (next <= 0) repetitionTable.delete(last);
    else repetitionTable.set(last, next);
  }
}

function formatMove(move) {
  const file = (c) => String.fromCharCode(97 + c);
  const from = file(move.from[1]) + (9 - move.from[0]);
  const to = file(move.to[1]) + (9 - move.to[0]);
  return from + "→" + to;
}

function exportBoard() {
  const rows = board.map((row) => row.map((cell) => (cell ? cell : ".")).join(""));
  boardCodeEl.value = rows.join("/");
}

function importBoard() {
  const raw = boardCodeEl.value.trim();
  const rows = raw.split("/");
  if (rows.length !== 10) {
    updateAnalysis("盤面碼格式錯誤：需要 10 行。", false);
    return;
  }
  const next = createEmptyBoard();
  for (let r = 0; r < 10; r++) {
    const row = rows[r];
    if (row.length !== 9) {
      updateAnalysis("盤面碼格式錯誤：第 " + (r + 1) + " 行需要 9 格。", false);
      return;
    }
    for (let c = 0; c < 9; c++) {
      const ch = row[c];
      if (ch === ".") continue;
      if (!PIECES[ch]) {
        updateAnalysis("盤面碼格式錯誤：未知棋子 " + ch + "。", false);
        return;
      }
      next[r][c] = ch;
    }
  }
  board = next;
  selectedFrom = null;
  legalMovesCache = [];
  renderBoard();
  updateAnalysis("已匯入盤面。", false);
}

document.getElementById("clear").addEventListener("click", () => {
  board = createEmptyBoard();
  selectedFrom = null;
  legalMovesCache = [];
  renderBoard();
  updateAnalysis("盤面已清空。", false);
});

document.getElementById("reset").addEventListener("click", () => {
  setupBoard();
  selectedFrom = null;
  legalMovesCache = [];
  renderBoard();
  updateAnalysis("已回到標準開局。", false);
});

document.getElementById("toggle-side").addEventListener("click", (e) => {
  sideToMove = sideToMove === "r" ? "b" : "r";
  updateSideLabel();
  updateAnalysis("輪到" + (sideToMove === "r" ? "紅方" : "黑方") + "。", false);
});

let isThinking = false;

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  progressBarEl.style.width = `${percent}%`;
  progressTextEl.textContent = `深度 ${current}/${total}（${percent}%）`;
}

function waitFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function suggestMoveAsync(maxDepth) {
  isThinking = true;
  suggestBtn.disabled = true;
  const dynamicInfo = estimateDynamicDepth(maxDepth);
  const dynamicDepth = dynamicInfo.depth;
  resetSearchState(dynamicDepth);
  progressBarEl.style.width = "0%";
  progressTextEl.textContent = `計算中... (動態深度 ${dynamicDepth})`;
  updateAnalysis(`計算中，請稍候… (動態深度 ${dynamicDepth})`, false);
  let best = null;
  const start = performance.now();
  const timeLimit = timeBudgetForDepth(dynamicDepth);
  let finishedDepth = 0;
  for (let depth = 1; depth <= dynamicDepth; depth++) {
    if (performance.now() - start > timeLimit) break;
    await waitFrame();
    best = searchBestMove(depth);
    finishedDepth = depth;
    updateProgress(depth, dynamicDepth);
    if (best && Math.abs(best.score) > 90000) break;
    if (performance.now() - start > timeLimit) break;
    await waitFrame();
  }
  const elapsed = Math.round(performance.now() - start);
  progressTextEl.textContent = `完成深度 ${finishedDepth}/${dynamicDepth}（${elapsed}ms）`;
  suggestBtn.disabled = false;
  isThinking = false;
  return best;
}

suggestBtn.addEventListener("click", async () => {
  if (isThinking) return;
  const depth = Number(depthSelectEl.value) || 3;
  const result = await suggestMoveAsync(depth);
  if (!result || !result.move) {
    updateAnalysis("無法建議：" + (result?.status || "無合法步"), false);
    return;
  }
  const piece = board[result.move.from[0]][result.move.from[1]];
  const sideName = isSidePiece(piece, "r") ? "紅" : "黑";
  const lines = [`建議：${sideName}${PIECES[piece].name} ${formatMove(result.move)}（評分 ${result.score}）`];
  if (result.candidates && result.candidates.length > 1) {
    const options = result.candidates.map((item, idx) => {
      const cpiece = board[item.move.from[0]][item.move.from[1]];
      const cname = isSidePiece(cpiece, "r") ? "紅" : "黑";
      return `${idx + 1}. ${cname}${PIECES[cpiece].name} ${formatMove(item.move)}（評分 ${item.score}）`;
    });
    lines.push("候選：");
    lines.push(...options);
  }
  updateAnalysis(lines.join("\n"), false);
  legalMovesCache = [result.move];
  selectedFrom = result.move.from;
  renderBoard();
});

document.getElementById("export").addEventListener("click", exportBoard);
document.getElementById("import").addEventListener("click", importBoard);

initZobrist();
buildPalette();
setupBoard();
renderBoard();
exportBoard();
