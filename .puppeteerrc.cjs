const { join } = require('path');

/**
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
    // Paksa Puppeteer untuk mengunduh Chrome di dalam folder project (.cache)
    cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
