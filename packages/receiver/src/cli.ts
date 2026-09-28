#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { PROTOCOL_VERSION } from "./index.js";

process.stdout.write(
  `sessionpipe protocol ${PROTOCOL_VERSION}: this command lands in a later milestone (see ROADMAP.md)\n`,
);
