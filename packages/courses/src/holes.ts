import { parseHole, type Hole } from './schema.js';
import hole1 from '../holes/hole1-straight.json' with { type: 'json' };
import hole2 from '../holes/hole2-dogleg.json' with { type: 'json' };
import hole3 from '../holes/hole3-bumpers.json' with { type: 'json' };

/** The "Kitchen Table" course, in play order. Parsed (and so validated) at import time. */
export const KITCHEN_TABLE: Hole[] = [hole1, hole2, hole3].map((h) => parseHole(h));

/** Display name of the course above. */
export const KITCHEN_TABLE_NAME = 'Kitchen Table';
