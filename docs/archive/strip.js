const fs = require('fs');

const original = fs.readFileSync('restore.txt', 'utf-8');
const processed = original.replace(/^\d+: /gm, '');

fs.writeFileSync('backend/src/routes/bookingChat.ts', processed);
console.log('Successfully restored bookingChat.ts with missing edits!');
