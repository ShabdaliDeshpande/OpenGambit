import { parseUci } from './csv.ts';
import type { Puzzle } from './types.ts';

/**
 * Original puzzles: positions composed from standard mating patterns or taken
 * from engine self-play games, with every solution derived and verified by the
 * engine (see derive.ts and builtin.test.ts).
 *
 * Each row: [fen, solution in UCI (solver moves and replies), rating, themes].
 */
const RAW: [string, string, number, string][] = [
  ["6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "d1d8", 1050, "mateIn1 endgame"], // composed
  ["6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1", "g5f7", 1050, "mateIn1 endgame"], // composed
  ["3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1", "d8d1", 1050, "mateIn1 endgame"], // composed
  ["rnbqkbnr/ppppp2p/5p2/6p1/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3", "d1h5", 1050, "mateIn1"], // composed
  ["k7/pp6/8/8/8/8/8/K5Q1 w - - 0 1", "g1g8", 1050, "mateIn1 endgame"], // composed
  ["7k/7p/5N2/8/8/8/8/6RK w - - 0 1", "g1g8", 1050, "mateIn1 endgame"], // composed
  ["8/4N1pk/8/8/8/8/8/K2R4 w - - 0 1", "d1h1", 1050, "mateIn1 endgame"], // composed
  ["6k1/8/8/8/4n3/8/6PP/6RK b - - 0 1", "e4f2", 1050, "mateIn1 endgame"], // composed
  ["8/8/8/8/8/k7/2q5/K7 b - - 0 1", "c2d1", 1050, "mateIn1 endgame"], // composed
  ["6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1", "b1b8", 1050, "mateIn1 endgame"], // composed
  ["1r4k1/8/8/8/8/8/r7/6K1 b - - 0 1", "b8b1", 1050, "mateIn1 endgame"], // composed
  ["r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", "h5f7", 1050, "mateIn1"], // composed
  ["5rk1/5ppp/7B/8/8/8/1Q3PPP/6K1 w - - 0 1", "b2g7", 1050, "mateIn1"], // composed
  ["2r3k1/5ppp/8/8/8/8/2Q2PPP/2R3K1 w - - 0 1", "c2c8", 1050, "mateIn1"], // composed
  ["5k2/8/5K2/8/8/8/8/R7 w - - 0 1", "a1a8", 1050, "mateIn1 endgame"], // composed
  ["8/k7/2K5/1Q6/8/8/8/8 w - - 0 1", "b5b7", 1050, "mateIn1 endgame"], // composed
  ["r5k1/5ppp/8/8/8/8/1Q6/1R4K1 w - - 0 1", "b2b8 a8b8 b1b8", 1550, "mateIn2 sacrifice"], // composed
  ["r6k/6pp/7N/8/8/1Q6/8/6K1 w - - 0 1", "b3g8 a8g8 h6f7", 1550, "mateIn2 sacrifice"], // composed
  ["1r4k1/1q6/8/8/8/8/5PPP/R5K1 b - - 0 1", "b7b1 a1b1 b8b1", 1550, "mateIn2 sacrifice"], // composed
  ["2b3kr/8/1p2pQ1p/p7/2P3p1/1P4P1/P1Nb1K1P/3R1B1R w - - 0 31", "d1d2 c8d7 d2d7 h6h5 f6d8", 1750, "mateIn3"], // self-play
  ["3R4/p2nN1p1/k1b4p/2P1P2P/1Q4P1/p7/8/2K5 w - - 3 37", "e7c6 a3a2 c6b8 d7b8 d8d6 b8c6 d6c6", 2100, "mateIn4"], // self-play
  ["4k1nQ/pr1p2P1/1p6/1P3p2/PbP5/8/8/2BK4 w - - 0 49", "h8g8 e8e7 g8f8 e7e6 g7g8q e6e5 g8d5", 2100, "mateIn4 promotion"], // self-play
  ["3rkb2/6p1/1pb5/2p5/1pn5/5nN1/R2PK1pr/2B3R1 b - - 3 41", "f3g1 e2f2 g1f3 g3e4 g2g1q f2f3 h2f2", 2100, "mateIn4 promotion"], // self-play
  ["knQ5/5p2/r5pp/3Pp3/5P2/P2P1BPN/7P/4K1R1 w - - 0 35", "d5d6 e5e4 f3e4 a6c6 e4c6 a8a7 c8b7", 2100, "mateIn4"], // self-play
  ["r1b1kb2/pp1nn1p1/5q2/2pPNP2/8/1P1P1P1r/PB1N4/R2QKB2 b Qq - 0 16", "f6h4 e1e2 h3h2 f1g2 h2g2 e2f1 h4f2", 2100, "mateIn4"], // self-play
  ["3r2k1/7r/6p1/1pqp4/p1P2PPp/P2n3P/4N1nK/1R3N1R b - - 0 44", "c5f2 h1g1 g2f4 h2h1 f2f3 h1h2 f3h3", 2100, "mateIn4"], // self-play
  ["r1b1k2r/p1p5/4q1p1/1p3p1p/1Pn4P/P1NPb1P1/2PQ2R1/1RK2BN1 b kq - 6 24", "e3d2 g2d2 e6e1 d2d1 e1e3 d1d2 e3d2", 2100, "mateIn4"], // self-play
  ["Q7/8/6P1/2k5/1R6/1P6/8/7K w - - 1 57", "a8a5 c5c6 b4b6 c6c7 a5a7 c7c8 b6b8", 2100, "mateIn4"], // self-play
  ["4kbr1/2pb4/3p4/P7/1r2B2P/3R4/1P2K3/1NB3Q1 b - - 0 35", "g8g1", 1200, "advantage"], // self-play
  ["8/5p2/R7/r2p1k2/8/P7/3K2p1/8 b - - 3 57", "a5a6", 1200, "advantage endgame"], // self-play
  ["r1q1k1nr/pbppnpp1/3b4/Pp1N2Pp/4Q3/8/1PP1PP1P/R1B1KBNR b KQkq - 4 11", "b7d5", 1200, "advantage"], // self-play
  ["6k1/rpp4n/p2p1p1p/P2PpP1P/1BN1P3/P1P2B2/1Rb2b2/1K4N1 w - - 9 36", "b2c2", 1200, "advantage"], // self-play
  ["r2r2k1/5pb1/1p5Q/p2P4/2P2PnP/P7/1P6/3R2RK w - - 2 38", "g1g4", 1200, "advantage"], // self-play
  ["2rq1k2/2pbp1r1/2n2np1/1B1p1pN1/RP1P1P1P/1Q2P1P1/2N5/3K3R w - - 3 26", "b5c6", 1200, "advantage"], // self-play
  ["r3k3/pp3ppp/8/3N4/8/8/PPP2PPP/4K3 w - - 0 1", "d5c7 e8d7 c7a8", 1200, "advantage fork"], // composed (replaced a self-play puzzle with two winning moves)
  ["k5r1/1p1r4/8/2p1P1pp/pqP2p2/1Pb2P2/3N4/1R1K2QR b - - 3 45", "d7d2", 1200, "advantage"], // self-play
  ["3kb2r/p3b1R1/1pn4p/3p4/3P1QBq/5N2/PPP2P2/R1BK4 w - - 0 32", "f3h4", 1200, "advantage"], // self-play
  ["8/2r1k3/4p3/NQ1p4/1P1qp2p/4R2P/2P3P1/4K1R1 b - - 1 50", "d4e3", 1200, "advantage fork"], // self-play
  ["r3kb1r/6p1/1pb5/2p1q2p/1pP1B1Pn/3p3R/1RnP4/2BQ1KNN b kq - 0 27", "e5e4", 1200, "advantage"], // self-play
  ["rn1R1rk1/p3b2b/2p5/P3P1p1/6pp/2P2NPR/1P1B4/5K2 b - - 1 29", "e7d8", 1200, "advantage"], // self-play
  ["rnbqkr2/3p1pQp/2p1pP1B/ppb5/1P2P1P1/2PP4/P6P/RN2KB1R w KQq - 4 17", "b4c5", 1200, "advantage"], // self-play
  ["8/8/1p1n4/pP6/P4k2/3K3p/6RP/8 b - - 0 58", "h3g2", 1200, "advantage endgame"], // self-play
  ["3r1qk1/7r/6p1/1pBp4/p4PPp/P1Pn3P/4N1nK/1R3N1R b - - 0 43", "f8c5", 1200, "advantage"], // self-play
  ["rn2k1n1/1b5Q/p3q1p1/4N1P1/1P1Bp3/8/P5RP/1R2K3 w - - 1 27", "h7b7", 1200, "advantage fork"], // self-play
  ["4k3/3qpr2/1p6/7Q/PN3b1P/RP1P2P1/1B6/5K2 w - - 1 37", "g3f4", 1200, "advantage"], // self-play
  ["r7/8/8/3k4/8/8/4B3/4K3 w - - 0 1", "e2f3 d5d4 f3a8", 1500, "advantage endgame"], // composed
  ["4k1q1/8/8/8/4N3/8/8/4RK2 w - - 0 1", "e4f6 e8f7 f6g8", 1500, "advantage fork"], // composed
  ["r4rk1/1p1b1pp1/4p3/4qn1p/PP6/3Q3P/6P1/2R2K1R b - - 2 32", "e5f4 f1g1 f4c1", 1500, "advantage fork"], // self-play
  ["8/5k1r/p2bp1p1/rn2p1Pp/3p4/P1pPnP2/RB2PR2/2K3N1 b - - 1 38", "c3b2 a2b2 d6a3", 1500, "advantage"], // self-play
  ["2kr1bnr/1q3ppp/1p6/3pp1PP/P3P3/Np1Q1P2/4N2R/2BK4 b - - 1 23", "d5e4 d3d8 c8d8", 1500, "advantage"], // self-play
  ["1r2k1n1/p2pbpP1/1pn5/1P2p2q/P1P2P2/6N1/1QNB3r/3RKR2 b - - 2 33", "e7h4 f1f2 h4g3", 1500, "advantage"], // self-play
  ["8/2r1k1q1/4p3/NQ1p4/1P1Pp2p/4R2P/2P3P1/3K2R1 b - - 0 49", "g7d4 d1c1 d4e3", 1500, "advantage fork"], // self-play
  ["7r/2k1bp2/rNb1pnpp/2n5/2P2P2/P2Pp1PN/1Q5P/1R2KBR1 w - - 4 25", "b2e5 e7d6 e5f6", 1500, "advantage fork"], // self-play
  ["1r2k1r1/q2b1p1p/Qb2p3/2p1P1pP/1P2p1P1/PP3P2/2R1B1R1/3N1K2 b - - 0 31", "e4f3 g2g3 f3e2", 1500, "advantage fork"], // self-play
  ["qr1k3r/1pn4p/2nb4/p1p1p3/P1P1P2P/BP1P1Q2/3NB1K1/4R2R w - - 16 30", "f3f6 d6e7 f6h8", 1500, "advantage fork"], // self-play
  ["qr5r/1pnk3p/2nb1Q2/p1p1p3/P1P1P2P/BP1P4/3NB1K1/4R2R w - - 18 31", "e2g4 c7e6 f6e6", 1500, "advantage"], // self-play
  ["3r1k1r/3bqppp/1RnB4/Pn6/2N1p2P/2P1P3/2Q2PP1/4KBNR w K - 1 22", "b6b5 e7d6 c4d6", 1500, "advantage"], // self-play
  ["4qk1r/4bn2/1R2Qp2/1r2p2p/1p2P1pP/3N2P1/3B1PR1/7K b - - 8 44", "f7d8 e6f5 b5b6", 1500, "advantage"], // self-play
  ["8/7k/3b1n1r/p3r3/2R4N/1P2P3/R4PKp/8 b - - 17 51", "e5g5 g2f3 h2h1q", 1500, "advantage promotion"], // self-play
  ["5k1r/2Q2p2/4p1p1/p2r2P1/Pq3P1p/1P5P/4K3/R1B2R2 w - - 0 45", "c1a3 b4a3 a1a3", 1650, "advantage sacrifice"], // self-play
  ["r1bk3r/1q1nnpbp/ppp1p1p1/8/P2PNPPP/2P5/1PQB4/RNK2B1R w - - 1 18", "e4d6 b7c7 d6f7 d8e8 f7h8", 1800, "advantage fork"], // self-play
  ["r1b1kbr1/1p3p2/n1p5/p1qpN3/P4P1P/1PNP4/3QB3/R1B2K1R b q - 0 27", "c8h3 f1e1 g8g1 e2f1 g1h1", 1950, "advantage sacrifice"], // self-play
  ["5b2/1r3k1r/p2qp1p1/Q1p1p1Pp/3p3n/P1nP1P1N/3NP3/R1B1KR2 b - - 9 30", "b7b5 d2c4 b5a5 c4d6 f8d6", 1950, "advantage sacrifice"], // self-play
  ["3Q4/2N2r2/8/5k2/P2P3P/RPK5/1B3q2/8 w - - 13 51", "d8g5 f5e4 g5d5 e4f4 d5f7", 1950, "advantage sacrifice"], // self-play
  ["3k2b1/4b3/1pn2rN1/p2p1B1Q/3P4/2P2PR1/PP1B4/R1K5 w - - 1 42", "g6e5 c6e5 g3g8 f6f8 g8f8 e7f8 d4e5", 2250, "advantage sacrifice"], // self-play
];

export const BUILTIN_PUZZLES: Puzzle[] = RAW.map(([fen, moves, rating, themes], i) => ({
  id: `b${String(i + 1).padStart(3, '0')}`,
  fen,
  solution: moves.split(' ').map(m => parseUci(m)!),
  rating,
  themes: themes.split(' '),
  source: 'builtin',
}));
