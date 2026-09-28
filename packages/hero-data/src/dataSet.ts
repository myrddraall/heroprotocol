import type { AwardInfo, HeroData, HeroDataSet, HeroInfo, MapInfo } from './types.js';

/** Wrap one build's data with the tolerant lookups a replay needs. */
export function createHeroDataSet(
  data: HeroData,
  requestedBuild: number = data.build,
): HeroDataSet {
  const heroIndex = new Map<string, HeroInfo>();
  for (const h of Object.values(data.heroes)) {
    for (const key of [h.id, h.attributeId, h.unitId, h.hyperlinkId, h.name]) {
      if (key) heroIndex.set(key.toLowerCase(), h);
    }
  }
  const awardIndex = new Map<string, AwardInfo>();
  for (const a of Object.values(data.awards)) {
    awardIndex.set(a.id.toLowerCase(), a);
    awardIndex.set(a.gameLink.toLowerCase(), a);
    // the stripped score-screen name: EndOfMatchAward<Name>Boolean → <Name>
    const stripped = a.gameLink.replace(/^EndOfMatchAward/, '').replace(/Boolean$/, '');
    awardIndex.set(stripped.toLowerCase(), a);
  }
  const mapIndex = new Map<string, MapInfo>();
  // map ids are shared by variants (Volskaya Foundry and its sandbox), so the first one keeps it
  for (const m of Object.values(data.maps)) {
    for (const key of [m.id, m.name, m.normalizedId, m.mapLink, m.mapId]) {
      if (key && !mapIndex.has(key.toLowerCase())) mapIndex.set(key.toLowerCase(), m);
    }
  }
  const set: HeroDataSet = {
    ...data,
    requestedBuild,
    exact: requestedBuild === data.build,
    hero: (idOrName) => heroIndex.get(idOrName.toLowerCase()),
    talent: (id) => data.talents[id],
    ability: (id) => data.abilities[id],
    award: (idOrLink) => awardIndex.get(idOrLink.toLowerCase()),
    map: (nameOrId) => mapIndex.get(nameOrId.toLowerCase()),
    heroName: (id) => heroIndex.get(id.toLowerCase())?.name ?? id,
    talentName: (id) => data.talents[id]?.name ?? id,
  };
  return set;
}
