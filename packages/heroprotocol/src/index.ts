/**
 * @myrddraall/heroprotocol — parse Heroes of the Storm replays.
 *
 * Protocols are data (36 bundled definitions covering every published build),
 * decoding is best-effort per section, and nothing is ever evaluated.
 */
export { openReplay, BOOTSTRAP_BUILD } from './replay/openReplay.js';
export type { OpenReplayOptions, ParsedReplay, ReplayProgress } from './replay/openReplay.js';
export { ALL_SECTIONS, SECTION_FILES } from './replay/diagnostics.js';
export type { Diagnostics, SectionDiagnostic, SectionName, SectionStatus, Provenance, DecodeAttempt } from './replay/diagnostics.js';
export { stringifyBlobs } from './replay/strings.js';

export { Protocol, unitTag, unitTagIndex, unitTagRecycle } from './protocol/runtime.js';
export type { RawEvent, EventEnvelope, EventStreamOptions, RawAttributes, RawAttributeValue } from './protocol/runtime.js';
export type { ProtocolDefinition, TypeInfo, IntBounds, StructField, ChoiceField, EventTable, BuildIndex } from './protocol/definition.js';
export { convertPythonProtocol } from './protocol/convert.js';
export { ProtocolRegistry } from './protocol/registry.js';
export { bundledSource, fetchSource, compositeSource, onlineSource, defaultSource } from './protocol/source.js';
export type { ProtocolSource, FetchSourceOptions } from './protocol/source.js';
export { BUILD_INDEX, REPRESENTATIVES } from './protocol/data/index.js';

export { BitPackedBuffer, BitPackedDecoder, VersionedDecoder, Decoder } from './decoder/index.js';

export * from './types/index.js';
export * from './errors.js';
