#!/usr/bin/env bash
# Run the app locally at http://localhost:8000 (service workers work on localhost)
cd "$(dirname "$0")/web" && python3 -m http.server 8000
