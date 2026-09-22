import type {
  ParsedReplay,
  SectionName,
  SectionStatus,
  SScoreResultEvent,
  SStatGameEvent,
} from '@myrddraall/heroprotocol';
import type {
  NormalizedReplay,
  ReplayCollectionName,
  ReplayRecord,
  Team,
} from '../model/records.js';
import { NORMALIZE_VERSION, loopsToSeconds } from '../model/records.js';
import { attribute, LOBBY_SCOPE } from './attributes.js';
import { normalizeMessageEvents } from './chat.js';
import { fingerprint } from './fingerprint.js';
import { normalizeGameEvents } from './gameEvents.js';
import { gameModeOf } from './gameMode.js';
import { PlayerLookup } from './lookup.js';
import { normalizePlayers, summarize } from './players.js';
import { normalizeScores } from './score.js';
import { normalizeStatEvent } from './stats.js';
import { filetimeToIso, ticksToHours } from './time.js';
import { normalizeTrackerEvents } from './trackerEvents.js';
import { normalizeUnits } from './units.js';

export interface NormalizeOptions {
  /** Timestamp written to `ingestedAt`; injectable so output is reproducible. */
  readonly now?: string;
}

const PICKING_ATTRIBUTE = 4010;
const PRIVACY_ATTRIBUTE = 3009;

/**
 * Turn a parsed replay into the normalized model: one `ReplayRecord` plus the rows
 * of every per-replay collection. Pure and synchronous; works with whatever
 * sections decoded (a replay without `initData` still normalizes, with a
 * `details`-sourced id and lobby-derived fields empty).
 */
export function normalizeReplay(
  parsed: ParsedReplay,
  options: NormalizeOptions = {},
): NormalizedReplay {
  const { id, source } = fingerprint(parsed);
  const lookup = new PlayerLookup(parsed);
  const tracker = parsed.trackerEvents ?? [];
  const durationLoops = parsed.header.m_elapsedGameLoops;

  const statSource = tracker.filter(
    (e): e is SStatGameEvent => e._event === 'NNet.Replay.Tracker.SStatGameEvent',
  );
  const scoreSource = tracker.filter(
    (e): e is SScoreResultEvent => e._event === 'NNet.Replay.Tracker.SScoreResultEvent',
  );

  const scores = normalizeScores(id, scoreSource, lookup);
  const units = normalizeUnits(id, tracker, lookup);
  const draft = normalizeTrackerEvents(id, tracker, lookup);
  const game = normalizeGameEvents(id, parsed.gameEvents ?? [], lookup, durationLoops);
  const messages = normalizeMessageEvents(id, parsed.messageEvents ?? [], lookup);
  const statEvents = statSource.map((e) => normalizeStatEvent(id, e, lookup));
  const players = normalizePlayers(id, parsed, lookup, statSource, scores.results, game.leftAt);

  const events = [
    ...draft.events,
    ...units.events,
    ...scores.snapshots,
    ...game.events,
    ...messages.events,
  ].sort((a, b) => a.gameloop - b.gameloop);

  const winner = players.find((p) => p.won === true && p.team !== null);
  const winningTeam: Team | null = winner ? winner.team : null;
  const region = players.find((p) => p.toon !== null)?.toon?.region ?? null;
  const details = parsed.details;
  const options_ = parsed.initData?.m_syncLobbyState.m_gameDescription.m_gameOptions;

  const sections = Object.fromEntries(
    Object.entries(parsed.diagnostics.sections).map(([k, v]) => [k, v.status]),
  ) as Record<SectionName, SectionStatus>;

  const picking = attribute(parsed.attributes, LOBBY_SCOPE, PICKING_ATTRIBUTE);

  const rowCounts: Record<ReplayCollectionName, number> = {
    players: players.length,
    scoreResults: scores.results.length,
    statEvents: statEvents.length,
    units: units.units.length,
    commands: game.commands.length,
    events: events.length,
    chat: messages.chat.length,
  };

  const replay: ReplayRecord = {
    id,
    fingerprintSource: source,
    map: details?.m_title ?? '',
    mode: gameModeOf(options_),
    ammId: options_?.m_ammId ?? 0,
    playedAt: details ? filetimeToIso(details.m_timeUTC) : new Date(0).toISOString(),
    timeZoneOffsetHours: details ? ticksToHours(details.m_timeLocalOffset) : 0,
    durationLoops,
    durationSeconds: loopsToSeconds(durationLoops),
    version: {
      baseBuild: parsed.header.m_version.m_baseBuild,
      build: parsed.header.m_version.m_build,
      major: parsed.header.m_version.m_major,
      minor: parsed.header.m_version.m_minor,
      revision: parsed.header.m_version.m_revision,
    },
    winningTeam,
    region,
    players: summarize(players),
    draft: {
      picking: picking === 'drft' ? 'draft' : picking === 'stan' ? 'standard' : 'unknown',
      private: attribute(parsed.attributes, LOBBY_SCOPE, PRIVACY_ATTRIBUTE) === 'Priv',
      bans: draft.bans,
      picks: draft.picks,
    },
    finalScoreLoop: scores.finalLoop,
    sections,
    diagnostics: parsed.diagnostics,
    fileSize: parsed.fileSize,
    rowCounts,
    normalizeVersion: NORMALIZE_VERSION,
    hasFile: false,
    status: 'ingesting',
    ingestedAt: options.now ?? new Date().toISOString(),
  };

  return {
    replay,
    players,
    scoreResults: scores.results,
    statEvents,
    units: units.units,
    commands: game.commands,
    events,
    chat: messages.chat,
  };
}
