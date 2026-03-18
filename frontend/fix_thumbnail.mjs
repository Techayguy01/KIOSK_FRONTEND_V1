import { readFileSync, writeFileSync } from 'fs';

const file = 'components/ui/room-preview-story-carousel.tsx';
let content = readFileSync(file, 'utf8');

// Try both line ending styles
const targets = [
  `onClick={() => {\r\n                        setStep(index);\r\n                        setIsExpanded(false);\r\n                      }}`,
  `onClick={() => {\n                        setStep(index);\n                        setIsExpanded(false);\n                      }}`,
];

const replacement = `onClick={() => setStep(index)}`;

let found = false;
for (const target of targets) {
  if (content.includes(target)) {
    content = content.replace(target, replacement);
    writeFileSync(file, content, 'utf8');
    console.log('SUCCESS: Removed setIsExpanded(false) from thumbnail click handler');
    found = true;
    break;
  }
}

if (!found) {
  // Dump the actual bytes around the area for debugging
  const lines = content.split(/\r?\n/);
  console.log('Could not find target. Lines 480-490:');
  lines.slice(479, 490).forEach((line, i) => {
    console.log(`${480 + i}: ${JSON.stringify(line)}`);
  });
}
