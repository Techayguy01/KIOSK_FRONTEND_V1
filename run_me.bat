@echo off
echo Starting cleanup > output.txt
node cleanup.mjs >> output.txt 2>&1
echo Done >> output.txt
