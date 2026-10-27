// Calls to the daily chess API, notifications, vacation and flair.

import type { Color } from 'chess.js';
import { call } from '../account/api';

export interface ShownRating {
  rating: number;
  provisional: boolean;
}

export interface DailyPlayer {
  id: string;
  name: string;
  flair: string | null;
  rating: ShownRating | null;
}

export interface DailyGameView {
  id: string;
  status: 'playing' | 'ended';
  days: number;
  rated: boolean;
  white: DailyPlayer;
  black: DailyPlayer;
  /** UCI moves from the start position. */
  moves: string[];
  turn: Color;
  turnStarted: number;
  deadline: number;
  drawOffer: Color | null;
  you: Color | null;
  /** Your conditional lines (only for you, while playing). */
  lines: string[][] | null;
  tour: { id: string; name: string } | null;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  reason: string | null;
}

export interface MyDailyGame {
  id: string;
  opponent: string;
  opponentFlair: string | null;
  you: Color;
  yourMove: boolean;
  moves: string[];
  days: number;
  rated: boolean;
  deadline: number;
  tourId: string | null;
}

export interface DailySeek {
  id: string;
  name: string;
  flair: string | null;
  rating: ShownRating;
  days: number;
  color: Color | 'random';
  rated: boolean;
  mine: boolean;
}

export interface DailyChallenge {
  id: string;
  incoming: boolean;
  name: string;
  flair: string | null;
  days: number;
  color: Color | 'random';
  rated: boolean;
  createdAt: number;
}

export interface Notification {
  id: string;
  kind: 'move' | 'reminder' | 'started' | 'ended' | 'challenge' | 'conditional' | 'tour';
  link: string | null;
  text: string;
  createdAt: number;
  seen: boolean;
}

export interface VacationInfo {
  on: boolean;
  until: number | null;
  left: number;
  perYear: number;
}

export interface DailyTourSummary {
  id: string;
  kind: 'swiss' | 'arena';
  name: string;
  days: number;
  rated: boolean;
  status: 'created' | 'started' | 'finished';
  startsAt: number;
  endsAt: number | null;
  nbRounds: number | null;
  round: number;
  players: number;
}

export interface DailyTourView extends DailyTourSummary {
  standings: { rank: number; id: string; name: string; rating: number; withdrawn: boolean; points: number; detail: string[] }[];
  games: { id: string; white: string; black: string; whiteName: string; blackName: string; round: number; result: string | null }[];
}

export interface TourForm {
  kind: 'swiss' | 'arena';
  name: string;
  days: number;
  rated: boolean;
  startInHours: number;
  nbRounds?: number;
  durationDays?: number;
}

const enc = encodeURIComponent;

export const fetchDailyGames = async () => (await call<{ games: MyDailyGame[] }>('/api/daily/games')).games;
export const fetchDailyGame = async (id: string) => (await call<{ game: DailyGameView }>(`/api/daily/games/${enc(id)}`)).game;
export const playDailyMove = async (id: string, uci: string, ply: number) => (await call<{ game: DailyGameView }>(`/api/daily/games/${enc(id)}/move`, { uci, ply })).game;
export const resignDaily = async (id: string) => (await call<{ game: DailyGameView }>(`/api/daily/games/${enc(id)}/resign`, {})).game;
export const dailyDraw = async (id: string, action: 'offer' | 'accept' | 'decline') => (await call<{ game: DailyGameView }>(`/api/daily/games/${enc(id)}/draw`, { action })).game;
export const saveLines = async (id: string, lines: string[][]) => (await call<{ lines: string[][] }>(`/api/daily/games/${enc(id)}/lines`, { lines })).lines;

export const fetchDailySeeks = async () => (await call<{ seeks: DailySeek[] }>('/api/daily/seeks')).seeks;
export const createDailySeek = (days: number, color: Color | 'random', rated: boolean) => call<{ id: string }>('/api/daily/seeks', { days, color, rated });
export const acceptDailySeek = async (id: string) => (await call<{ game: string }>(`/api/daily/seeks/${enc(id)}/accept`, {})).game;
export const cancelDailySeek = (id: string) => call<{ ok: true }>(`/api/daily/seeks/${enc(id)}/cancel`, {});

export const fetchChallenges = async () => (await call<{ challenges: DailyChallenge[] }>('/api/daily/challenges')).challenges;
export const sendChallenge = (to: string, days: number, color: Color | 'random', rated: boolean) => call<{ id: string }>('/api/daily/challenges', { to, days, color, rated });
export const answerChallenge = async (id: string, action: 'accept' | 'decline' | 'cancel') =>
  (await call<{ game: string | null }>(`/api/daily/challenges/${enc(id)}/${action}`, {})).game;

export const fetchNotifications = () => call<{ list: Notification[]; unseen: number }>('/api/notifications');
export const markNotificationsSeen = (ids: string[] | null) => call<{ list: Notification[]; unseen: number }>('/api/notifications/seen', { ids });

export const fetchVacation = async () => (await call<{ vacation: VacationInfo }>('/api/account/vacation')).vacation;
export const setVacation = async (days: number | null) => (await call<{ vacation: VacationInfo }>('/api/account/vacation', days === null ? { end: true } : { days })).vacation;

export const setFlair = (flair: string | null) => call<{ flair: string | null }>('/api/account/flair', { flair });

export const fetchDailyTours = async () => (await call<{ tours: DailyTourSummary[] }>('/api/daily/tours')).tours;
export const fetchDailyTour = async (id: string) => (await call<{ tour: DailyTourView }>(`/api/daily/tours/${enc(id)}`)).tour;
export const createDailyTour = async (form: TourForm) => (await call<{ id: string }>('/api/daily/tours', form)).id;
export const joinDailyTour = async (id: string, join: boolean) => (await call<{ tour: DailyTourView }>(`/api/daily/tours/${enc(id)}/${join ? 'join' : 'leave'}`, {})).tour;
