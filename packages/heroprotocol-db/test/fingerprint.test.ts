import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ParsedReplay } from '@myrddraall/heroprotocol';
import { fingerprint } from '../src/normalize/fingerprint.js';
import { sha1Hex } from '../src/util/sha1.js';
import { localReplays, parseLocal } from './util/node.js';

describe('sha1Hex', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    ['The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
    // 55, 56 and 64 bytes straddle the padding boundary
    ['a'.repeat(55), createHash('sha1').update('a'.repeat(55)).digest('hex')],
    ['a'.repeat(56), createHash('sha1').update('a'.repeat(56)).digest('hex')],
    ['a'.repeat(64), createHash('sha1').update('a'.repeat(64)).digest('hex')],
    ['ünïcödé ~ 日本語', createHash('sha1').update('ünïcödé ~ 日本語', 'utf8').digest('hex')],
  ])('hashes %j like the reference implementation', (input, expected) => {
    expect(sha1Hex(input)).toBe(expected);
  });
});

describe('fingerprint', () => {
  const header = {
    m_elapsedGameLoops: 19371,
    m_replayCompatibilityHash: { m_data: 'cafe' },
    m_signature: 'sig',
  } as unknown as ParsedReplay['header'];

  it('falls back to details, then the header, when the lobby is missing', () => {
    const details = {
      m_timeUTC: 1,
      m_playerList: [
        { m_hero: 'Genji', m_teamId: 0, m_toon: { m_region: 1, m_realm: 1, m_id: 42 } },
      ],
    } as unknown as ParsedReplay['details'];
    const withDetails = fingerprint({ header, details, fileSize: 10 } as unknown as ParsedReplay);
    expect(withDetails.source).toBe('details');
    expect(withDetails.id).toBe(createHash('sha1').update('4bab|1|Genji~0~1-1-42').digest('hex'));

    const headerOnly = fingerprint({ header, fileSize: 10 } as unknown as ParsedReplay);
    expect(headerOnly.source).toBe('header');
    expect(headerOnly.id).toBe(createHash('sha1').update('4bab|cafe|sig|10').digest('hex'));
  });

  describe.skipIf(localReplays().length === 0)('against real replays', () => {
    it.each(localReplays())('%s reproduces the 2018 heroesbrowser id', async (file) => {
      const parsed = await parseLocal(file);
      const init = parsed.initData!;
      const desc = init.m_syncLobbyState.m_gameDescription;
      // The exact string BasicReplayAnalyser.fingerPrint built, hashed by Node's sha1.
      const legacy =
        parsed.header.m_elapsedGameLoops.toString(16) +
        '|' +
        desc.m_randomValue +
        '|' +
        desc.m_gameOptions.m_ammId +
        '|' +
        init.m_syncLobbyState.m_lobbyState.m_slots
          .map((s) => `${s.m_hero}~${s.m_teamId}~${s.m_toonHandle}`)
          .join('#');
      const fp = fingerprint(parsed);
      expect(fp.source).toBe('lobby');
      expect(fp.id).toBe(createHash('sha1').update(legacy, 'utf8').digest('hex'));
    });
  });
});
