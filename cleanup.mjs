import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();

function walkDir(dir) {
    if (dir.includes('.agent') || dir.includes('.ai') || dir.includes('.git')) {
        return;
    }
    
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip hidden folders and git
        if (entry.isDirectory() && ['.git', '.agent', '.ai'].includes(entry.name)) {
            continue;
        }

        if (entry.isDirectory()) {
            if (entry.name.toLowerCase() === 'docs') {
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 3 });
                    console.log('Deleted dir:', fullPath);
                } catch (e) {
                    console.error('Failed to delete dir:', fullPath, e.message);
                }
            } else {
                walkDir(fullPath);
            }
        } else if (entry.isFile()) {
            if (entry.name.toLowerCase().endsWith('.md') || entry.name.toLowerCase().endsWith('.docs') || entry.name.toLowerCase() === 'docs') {
                try {
                    fs.rmSync(fullPath, { force: true });
                } catch (e) {
                    console.error('Failed to delete file:', fullPath, e.message);
                }
            }
        }
    }
}

walkDir(rootDir);
console.log("Cleanup complete.");
