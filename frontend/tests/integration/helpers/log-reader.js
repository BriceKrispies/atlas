import { readFileSync } from 'fs';
import { join } from 'path';

const LOG_DIR = process.env.TEST_LOG_DIR || '/test-logs';

/**
 * Reads and parses structured JSON log files from the backend.
 * Use mark() before an action, then entriesSinceMark() to get only new entries.
 */
export class LogReader {
  constructor(service = 'ingress') {
    this.path = join(LOG_DIR, `${service}.log`);
    this._lastOffset = 0;
  }

  /** Record the current end of the log file. Call before the action under test. */
  mark() {
    try {
      const content = readFileSync(this.path, 'utf-8');
      this._lastOffset = content.length;
    } catch {
      this._lastOffset = 0;
    }
  }

  /** Return all structured log entries appended since the last mark(). */
  entriesSinceMark() {
    try {
      const content = readFileSync(this.path, 'utf-8');
      const newContent = content.slice(this._lastOffset);
      return newContent
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return { raw: line };
          }
        });
    } catch {
      return [];
    }
  }

  /** Find log entries matching a predicate since last mark. */
  find(predicate) {
    return this.entriesSinceMark().filter(predicate);
  }

  /**
   * Assert that at least one log entry since mark matches the predicate.
   * Throws with a dump of all entries if no match is found.
   */
  assertLogged(predicate, description = 'expected log entry') {
    const matches = this.find(predicate);
    if (matches.length === 0) {
      const all = this.entriesSinceMark();
      throw new Error(
        `${description}: no matching log entry found.\n` +
          `Entries since mark (${all.length}):\n` +
          all.map((e) => `  ${JSON.stringify(e)}`).join('\n')
      );
    }
    return matches;
  }
}
