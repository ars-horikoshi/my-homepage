#!/bin/bash
set -e
mkdir -p public/src
cp index.html app.js style.css schedule.json public/
cp src/utils.js public/src/
echo "Build complete: public/"
