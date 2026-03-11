#!/bin/bash
set -e
mkdir -p public
cp index.html app.js style.css schedule.json public/
echo "Build complete: public/"
