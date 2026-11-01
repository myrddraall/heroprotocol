import { describe, expect, it } from 'vitest';
import {
  createEmoticonSet,
  loadEmoticons,
  type EmoticonTable,
} from '../src/emoticons/emoticons.js';

const table: EmoticonTable = {
  build: 1,
  emoticons: {
    abstract_happy: { aliases: [':happy:', ':)'], expression: 'Happy' },
    abstract_cool_casesensitive: { aliases: ['B)'], caseSensitive: true, expression: 'Cool' },
    // a generic one with a picture of its own, to test case without the hero swap
    hand_wave: { aliases: [':wave:', 'o/'], caseSensitive: true, image: 'wave.png' },
    stukov_happy: {
      aliases: [':stukhappy:', ':stukovhappy:'],
      heroId: 'Stukov',
      expression: 'Happy',
      image: 'stukov_happy.png',
    },
    stukov_skin_happy: {
      aliases: [':stukskinhappy:'],
      heroId: 'Stukov',
      skinId: 'StukovSkin',
      expression: 'Happy',
      image: 'stukov_skin_happy.png',
    },
    ghost_boogie_anim: { aliases: [':ghostboogie:'], image: 'ghost_boogie.apng' },
  },
};

const shown = (pieces: ReturnType<ReturnType<typeof createEmoticonSet>['parse']>) =>
  pieces.map((p) => (p.kind === 'text' ? p.text : `[${p.emoticon.id}]`)).join('');

describe('emoticons', () => {
  const set = createEmoticonSet(table);

  it('turns codes into emotes and keeps the rest as text', () => {
    expect(shown(set.parse('gg :ghostboogie: wp', null))).toBe('gg [ghost_boogie_anim] wp');
    expect(set.parse('gg', null)).toEqual([{ kind: 'text', text: 'gg' }]);
    expect(set.parse(':stukhappy:', null)[0]).toMatchObject({
      kind: 'emoticon',
      code: ':stukhappy:',
      emoticon: { id: 'stukov_happy', image: 'stukov_happy.png' },
    });
  });

  it('finds colon codes that run together, and word codes only as whole words', () => {
    expect(shown(set.parse(':ghostboogie::ghostboogie:', null))).toBe(
      '[ghost_boogie_anim][ghost_boogie_anim]',
    );
    expect(shown(set.parse('ok:)', 'Stukov'))).toBe('ok:)');
    expect(shown(set.parse('ok :)', 'Stukov'))).toBe('ok [stukov_happy]');
  });

  it('matches codes in any case unless the emote is case-sensitive', () => {
    expect(shown(set.parse(':GHOSTBOOGIE: o/ O/', null))).toBe(
      '[ghost_boogie_anim] [hand_wave] O/',
    );
  });

  it("shows a generic emote as the sender's hero's own, never a skin's, or as text without one", () => {
    expect(shown(set.parse(':) :happy:', 'Stukov'))).toBe('[stukov_happy] [stukov_happy]');
    expect(shown(set.parse(':)', 'Valla'))).toBe(':)');
    expect(shown(set.parse(':)', null))).toBe(':)');
    expect(shown(set.parse('B)', 'Stukov'))).toBe('B)');
  });

  it('reads the generated table as the game converts what players typed', async () => {
    const real = await loadEmoticons();
    // as replays recorded them: the typed line, and the game's own conversion
    expect(shown(real.parse(':)', 'Stukov'))).toBe('[stukov_happy]');
    expect(shown(real.parse(':aplausos:', 'Leoric'))).toBe('[hand_applause]');
    expect(shown(real.parse(':ghostboogie::ghostboogie:', 'Stukov'))).toBe(
      '[ghost_boogie_anim][ghost_boogie_anim]',
    );
    expect(real.byCode(':stukhappy:')?.image).toMatch(/\.png$/);
    expect(real.byCode(':ghostboogie:')?.image).toMatch(/\.apng$/);
  });
});
