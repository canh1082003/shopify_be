/**
 * Test Environment Isolation Bootstrap
 * 
 * Step 1: Preload pure environment settings without imports.
 * Step 2: Activate database driver isolation and in-memory guards.
 */

// Explicit import boundary: setupEnv has zero imports and evaluates first
import './setupEnv';

import { setTestDatabaseIsolation } from '../databases';

// Activate database isolation guard
setTestDatabaseIsolation(true);

export const IS_TEST_BOOTSTRAPPED = true;
