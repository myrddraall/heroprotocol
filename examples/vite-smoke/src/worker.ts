// The consumer's worker entry: a few lines around createWorker.
import { createWorker } from '@myrddraall/heroprotocol-db/worker';
import { commandsPerPlayer, deathsNear, heroCount } from './analysers';

createWorker({ analysers: [heroCount, commandsPerPlayer, deathsNear as never] });
