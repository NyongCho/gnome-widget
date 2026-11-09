import type { Snapshot } from '../types.js';
import { snapshot } from '../../generated/validators/snapshot.js';
import { parse } from './validation.js';
export function parseSnapshot(input: string): Snapshot {
    return parse(input, snapshot);
}
