// Loads every hole JSON in packages/courses/holes, checks the schema and that tee and cup sit on
// a floor, and that a ball rests on the tee in the physics sim. Run via `pnpm validate-courses` (builds the libs first). Exits non-zero on any problem.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { GolfSim, initPhysics } from '../packages/shared/dist/index.js';
import { holeSchema, validateHoleGeometry } from '../packages/courses/dist/src/index.js';

const dir = fileURLToPath(new URL('../packages/courses/holes/', import.meta.url));
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();

await initPhysics();
let failures = 0;
const ids = new Set();

for (const file of files) {
  const problems = [];
  let hole;
  try {
    const parsed = holeSchema.safeParse(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (parsed.success) hole = parsed.data;
    else
      for (const issue of parsed.error.issues)
        problems.push(`schema: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  } catch (err) {
    problems.push(`cannot read/parse JSON: ${err.message}`);
  }
  if (hole) {
    problems.push(...validateHoleGeometry(hole));
    if (problems.length === 0) {
      // Physics smoke test: a ball dropped on the tee must stay on the floor and come to rest.
      const sim = new GolfSim(hole);
      for (let i = 0; i < 120; i++) sim.step();
      const [, y] = sim.position();
      if (sim.state !== 'resting' || y < hole.tee[1])
        problems.push(`ball does not rest on the tee (state ${sim.state}, y ${y.toFixed(3)})`);
      sim.dispose();
    }
    if (ids.has(hole.id)) problems.push(`duplicate hole id "${hole.id}"`);
    ids.add(hole.id);
  }
  if (problems.length) {
    failures++;
    console.error(`FAIL ${file}`);
    for (const p of problems) console.error(`  - ${p}`);
  } else {
    console.log(`ok   ${file} (${hole.id}, par ${hole.par}, ${hole.pieces.length} pieces)`);
  }
}

if (files.length === 0) {
  console.error('no hole files found');
  process.exit(1);
}
process.exit(failures ? 1 : 0);
