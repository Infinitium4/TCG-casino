const fs = require('node:fs');
const path = require('node:path');
fs.copyFileSync(path.join(__dirname, '../build-crs/client.js'), path.join(__dirname, '../underground/js/crs.js'));
