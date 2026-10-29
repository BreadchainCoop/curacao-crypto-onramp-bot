'use strict';

/**
 * Fail CI when Escrow.sol line coverage falls below the floor.
 * Reads istanbul coverage-final.json produced by `hardhat coverage`.
 * Mock contracts are excluded via .solcover.js (skipFiles).
 */

const fs = require('node:fs');
const path = require('node:path');

const MIN_LINE_PCT = 80;
const ESCROW_KEY = 'src/Escrow.sol';
const COVERAGE_PATH = path.join(__dirname, '..', 'coverage', 'coverage-final.json');

function lineCoveragePct(fileCoverage) {
  const lines = Object.values(fileCoverage.l || {});
  if (lines.length === 0) {
    return 100;
  }
  const covered = lines.filter((hits) => hits > 0).length;
  return (100 * covered) / lines.length;
}

function main() {
  if (!fs.existsSync(COVERAGE_PATH)) {
    console.error(`Missing coverage report at ${COVERAGE_PATH}`);
    console.error('Run `npx hardhat coverage` first.');
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(COVERAGE_PATH, 'utf8'));
  const escrow = report[ESCROW_KEY];
  if (!escrow) {
    const keys = Object.keys(report);
    console.error(`No coverage entry for ${ESCROW_KEY}. Found: ${keys.join(', ') || '(none)'}`);
    process.exit(1);
  }

  const pct = lineCoveragePct(escrow);
  const rounded = Number(pct.toFixed(2));
  console.log(`${ESCROW_KEY} line coverage: ${rounded}% (minimum ${MIN_LINE_PCT}%)`);

  if (pct < MIN_LINE_PCT) {
    console.error(
      `Coverage gate failed: ${ESCROW_KEY} line coverage ${rounded}% < ${MIN_LINE_PCT}%`,
    );
    process.exit(1);
  }
}

main();
