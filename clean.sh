#!/bin/bash

echo "🧹 Cleaning unused runtimes and caches..."

rm -rf ~/.python
rm -rf ~/.sdkman
rm -rf ~/go
rm -rf ~/.cache ~/.npm ~/.gradle ~/.m2

echo "✅ Cleanup complete. Lean system ready!"