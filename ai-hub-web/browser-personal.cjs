'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { browserAvailable } = require('./browser-mcp.cjs');

if (require.main === module) {
  if (!browserAvailable()) {
    console.error('Chrome MCP is not installed. See BROWSER-MCP.md.');
    process.exitCode = 1;
  } else {
    require('./browser-broker.cjs').runProxy('personal').catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { personalAvailable: browserAvailable };
