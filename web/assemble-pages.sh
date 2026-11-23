#!/usr/bin/env bash
set -euo pipefail
web_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
site_dir="${1:?Pass the output directory}"

mkdir -p "$site_dir/node_modules/replicad-opencascadejs"
mkdir -p "$site_dir/node_modules/@nasedkinpv/opensubdiv-wasm"
cp "$web_dir/index.html" "$site_dir/"
cp -r "$web_dir/src" "$site_dir/"
cp -r "$web_dir/node_modules/replicad-opencascadejs/dist" "$site_dir/node_modules/replicad-opencascadejs/"
cp -r "$web_dir/node_modules/@nasedkinpv/opensubdiv-wasm/dist" "$site_dir/node_modules/@nasedkinpv/opensubdiv-wasm/"
test -s "$site_dir/node_modules/replicad-opencascadejs/dist/replicad_single.js"
test -s "$site_dir/node_modules/replicad-opencascadejs/dist/replicad_single.wasm"
test -s "$site_dir/node_modules/@nasedkinpv/opensubdiv-wasm/dist/opensubdiv.mjs"
touch "$site_dir/.nojekyll"
