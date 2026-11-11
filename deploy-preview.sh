#!/bin/sh
# Copy the site files to a static web root: ./deploy-preview.sh <target-dir>
set -eu
target="${1:?target directory}"
mkdir -p "$target"
rsync -a --delete --include='/index.html' --include='/favicon.svg' --include='/css/***' --include='/js/***' --include='/vendor/***' --exclude='*' ./ "$target"/
chmod -R o+rX "$target"
